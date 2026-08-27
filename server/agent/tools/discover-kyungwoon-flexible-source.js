"use strict";

/**
 * UNI PICK - Kyungwoon University Flexible Source Discovery v2
 *
 * 목적
 * ---------------------------------------------------------
 * 경운대학교 공식 홈페이지/게시판 discovery.
 *
 * 특징
 * ---------------------------------------------------------
 * Node fetch 대신 curl.exe 사용.
 *
 * 이유:
 * - Node 22 --use-system-ca 에서도
 *   UNABLE_TO_VERIFY_LEAF_SIGNATURE 발생
 * - Windows curl.exe에서는 HTTP 200 정상
 *
 * 보안:
 * - curl -k 사용 금지
 * - 인증서 검증 비활성화 없음
 * - read-only
 *
 * 허용 source 범위:
 * - 공지
 * - 학사
 * - 모집
 * - 입학
 * - 장학
 * - 취업/채용
 * - 프로그램
 * - 행사
 * - 대학소식
 * - 학생지원
 * - 일반 안내
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(
  __dirname,
  "../../.."
);

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungwoon-flexible-source-discovery.json"
);

const UNIVERSITY_ID =
  "kyungwoon-university-본교";

const UNIVERSITY_NAME =
  "경운대학교";

const HOMEPAGE =
  "https://www.ikw.ac.kr/";

const REQUEST_TIMEOUT_MS = 30000;
const MAX_CANDIDATE_REQUESTS = 20;


/* =========================================================
 * 운영 파일 보호
 * ========================================================= */

const OPERATIONAL_FILES = [
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-sources.final.json"
  ),

  path.join(
    ROOT,
    "server",
    "agent",
    "data",
    "agent-news-store.json"
  ),

  path.join(
    ROOT,
    "data",
    "university-news-preview.json"
  )
];


/* =========================================================
 * Utilities
 * ========================================================= */

function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const tmp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      tmp,
      "utf8"
    )
  );

  fs.renameSync(
    tmp,
    file
  );
}


function plain(value) {
  return String(value || "")
    .replace(
      /<script\b[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /&nbsp;|&#160;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  const text =
    String(value)
      .trim()
      .replace(
        /&amp;/gi,
        "&"
      )
      .replace(
        /\\&/g,
        "&"
      );

  if (
    /^javascript:/i.test(
      text
    )
  ) {
    return null;
  }

  try {
    const url =
      new URL(
        text,
        base
      );

    url.hash = "";

    return /^https?:$/.test(
      url.protocol
    )
      ? url.href
      : null;

  } catch {
    return null;
  }
}


function officialDomain(url) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    return (
      host === "ikw.ac.kr"
      ||
      host.endsWith(
        ".ikw.ac.kr"
      )
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * Hash
 * ========================================================= */

function sha256(file) {
  if (
    !fs.existsSync(file)
  ) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(file)
    )
    .digest("hex");
}


function operationalHashes() {
  return Object.fromEntries(
    OPERATIONAL_FILES.map(
      file => [
        path.relative(
          ROOT,
          file
        ),
        sha256(file)
      ]
    )
  );
}


/* =========================================================
 * curl HTTP adapter
 * ========================================================= */

function curlPage(url) {
  const args = [
    "-L",
    "--max-redirs",
    "10",

    "--connect-timeout",
    "20",

    "--max-time",
    "30",

    "--silent",
    "--show-error",

    "--compressed",

    "-A",
    "Mozilla/5.0 compatible UNI-PICK Kyungwoon Curl Discovery",

    "-H",
    "Accept: text/html,application/xhtml+xml",

    "-H",
    "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

    "-w",
    "\n__UNI_PICK_META__%{http_code}|%{url_effective}|%{content_type}",

    url
  ];


  const result =
    spawnSync(
      "curl.exe",
      args,
      {
        encoding:
          "utf8",

        timeout:
          REQUEST_TIMEOUT_MS + 5000,

        windowsHide:
          true,

        maxBuffer:
          20 * 1024 * 1024
      }
    );


  if (
    result.error
  ) {
    return {
      ok: false,

      status: null,

      finalUrl: null,

      contentType: "",

      bytes: 0,

      html: "",

      error: {
        name:
          result.error.name,

        message:
          result.error.message,

        code:
          result.error.code || null
      }
    };
  }


  const stdout =
    String(
      result.stdout || ""
    );


  const marker =
    "\n__UNI_PICK_META__";


  const index =
    stdout.lastIndexOf(
      marker
    );


  if (
    index < 0
  ) {
    return {
      ok: false,

      status: null,

      finalUrl: null,

      contentType: "",

      bytes:
        Buffer.byteLength(
          stdout,
          "utf8"
        ),

      html:
        stdout,

      error: {
        name:
          "CurlMetaError",

        message:
          "curl metadata marker not found",

        code:
          result.status
      }
    };
  }


  const html =
    stdout.slice(
      0,
      index
    );


  const meta =
    stdout.slice(
      index + marker.length
    ).trim();


  const [
    rawStatus,
    finalUrl,
    contentType
  ] =
    meta.split("|");


  const status =
    Number(
      rawStatus
    );


  const ok =
    result.status === 0
    &&
    Number.isFinite(
      status
    )
    &&
    status >= 200
    &&
    status < 400;


  return {
    ok,

    status:
      Number.isFinite(status)
        ? status
        : null,

    finalUrl:
      finalUrl || null,

    contentType:
      contentType || "",

    bytes:
      Buffer.byteLength(
        html,
        "utf8"
      ),

    html,

    curlExitCode:
      result.status,

    error:
      ok
        ? null
        : {
            name:
              "CurlError",

            message:
              String(
                result.stderr || ""
              ).trim()
              ||
              `curl exit code ${result.status}`,

            code:
              result.status
          }
  };
}


/* =========================================================
 * 날짜
 * ========================================================= */

function countDates(html) {
  const text =
    plain(
      html
    );

  const longDates =
    (
      text.match(
        /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
      )
      || []
    ).length;


  const shortDates =
    (
      text.match(
        /(?:^|\D)\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\D|$)/g
      )
      || []
    ).length;


  return (
    longDates
    +
    shortDates
  );
}


/* =========================================================
 * Anchor 추출
 * ========================================================= */

function extractAnchors(
  html,
  baseUrl
) {
  const output = [];

  const matcher =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (
      match =
        matcher.exec(
          html
        )
    )
  ) {
    const attrs =
      match[1] || "";

    const href =
      (
        attrs.match(
          /\bhref\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;


    const onclick =
      (
        attrs.match(
          /\bonclick\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;


    const title =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;


    const url =
      href
        ? normalizeUrl(
            href,
            baseUrl
          )
        : null;


    output.push({
      label:
        plain(
          match[2]
        ),

      title:
        title
        ? plain(
            title
          )
        : null,

      href,

      url,

      onclick
    });
  }


  return output;
}


/* =========================================================
 * 후보 점수
 * ========================================================= */

function scoreLink(link) {
  const value =
    `${link.label || ""} ${link.title || ""} ${link.url || ""}`
      .toLowerCase();


  let score = 0;

  const reasons = [];


  const rules = [
    ["공지사항", 60],
    ["학사공지", 58],
    ["공지", 50],
    ["대학소식", 50],
    ["뉴스", 45],
    ["소식", 40],
    ["행사", 35],
    ["프로그램", 30],
    ["장학", 30],
    ["채용", 30],
    ["취업", 28],
    ["모집", 28],
    ["학생지원", 25],
    ["입학", 22],
    ["안내", 20]
  ];


  for (
    const [word, points]
    of rules
  ) {
    if (
      value.includes(
        word
      )
    ) {
      score += points;

      reasons.push(
        `${word}:${points}`
      );
    }
  }


  if (
    /board|bbs|notice|news|community|article|post/.test(
      value
    )
  ) {
    score += 20;

    reasons.push(
      "BOARD_SIGNAL:20"
    );
  }


  if (
    /login|privacy|sitemap|조직도|총장|history|faculty|department/.test(
      value
    )
  ) {
    score -= 100;

    reasons.push(
      "EXCLUDE:-100"
    );
  }


  return {
    score,
    reasons
  };
}


/* =========================================================
 * 반복 구조
 * ========================================================= */

function analyzeStructures(
  html,
  baseUrl
) {
  const definitions = [
    {
      type:
        "TR",

      regex:
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    },

    {
      type:
        "LI",

      regex:
        /<li\b[^>]*>[\s\S]*?<\/li>/gi
    },

    {
      type:
        "ARTICLE",

      regex:
        /<article\b[^>]*>[\s\S]*?<\/article>/gi
    }
  ];


  const results = [];


  for (
    const definition
    of definitions
  ) {
    const containers =
      html.match(
        definition.regex
      )
      || [];


    let useful = 0;
    let withDate = 0;
    let withOfficialLink = 0;
    let withClickable = 0;


    const samples = [];


    for (
      const raw
      of containers
    ) {
      const text =
        plain(
          raw
        );


      if (
        text.length < 5
      ) {
        continue;
      }


      const anchors =
        extractAnchors(
          raw,
          baseUrl
        );


      const clickable =
        anchors.filter(
          anchor =>
            anchor.url
            ||
            anchor.onclick
        );


      const officialLinks =
        clickable.filter(
          anchor =>
            anchor.url
            &&
            officialDomain(
              anchor.url
            )
        );


      const dateCount =
        countDates(
          raw
        );


      if (
        clickable.length > 0
      ) {
        useful += 1;
        withClickable += 1;


        if (
          dateCount > 0
        ) {
          withDate += 1;
        }


        if (
          officialLinks.length > 0
        ) {
          withOfficialLink += 1;
        }


        if (
          samples.length < 5
        ) {
          samples.push({
            text:
              text.slice(
                0,
                500
              ),

            dateCount,

            anchors:
              clickable.slice(
                0,
                5
              )
          });
        }
      }
    }


    results.push({
      type:
        definition.type,

      total:
        containers.length,

      useful,

      withDate,

      withOfficialLink,

      withClickable,

      samples
    });
  }


  return results;
}


/* =========================================================
 * 후보 페이지 평가
 * ========================================================= */

function evaluatePage(
  candidate,
  page
) {
  let score =
    candidate.initialScore;


  const reasons =
    [
      ...candidate.reasons
    ];


  if (
    page.ok
    &&
    page.status === 200
  ) {
    score += 20;

    reasons.push(
      "HTTP_200:20"
    );
  }


  if (
    page.finalUrl
    &&
    officialDomain(
      page.finalUrl
    )
  ) {
    score += 20;

    reasons.push(
      "OFFICIAL_DOMAIN:20"
    );
  }


  const dates =
    countDates(
      page.html
    );


  if (
    dates >= 3
  ) {
    score += 15;

    reasons.push(
      "DATES_3_PLUS:15"
    );
  }


  if (
    dates >= 10
  ) {
    score += 10;

    reasons.push(
      "DATES_10_PLUS:10"
    );
  }


  const structures =
    analyzeStructures(
      page.html,
      page.finalUrl
      ||
      candidate.url
    );


  const bestStructure =
    [...structures]
      .sort(
        (a, b) =>
          (
            b.withDate * 5
            +
            b.withOfficialLink * 3
            +
            b.useful
          )
          -
          (
            a.withDate * 5
            +
            a.withOfficialLink * 3
            +
            a.useful
          )
      )[0]
      || null;


  if (
    bestStructure
    &&
    bestStructure.useful >= 5
  ) {
    score += 20;

    reasons.push(
      "REPEATING_ITEMS:20"
    );
  }


  if (
    bestStructure
    &&
    bestStructure.withDate >= 3
  ) {
    score += 25;

    reasons.push(
      "ROWS_WITH_DATE:25"
    );
  }


  if (
    bestStructure
    &&
    bestStructure.withOfficialLink >= 3
  ) {
    score += 20;

    reasons.push(
      "DETAIL_LINKS_3_PLUS:20"
    );
  }


  return {
    ...candidate,

    finalScore:
      score,

    httpStatus:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    contentType:
      page.contentType,

    curlExitCode:
      page.curlExitCode ?? null,

    dateLikeCount:
      dates,

    structures,

    bestStructure,

    reasons,

    error:
      page.error || null
  };
}


/* =========================================================
 * Main
 * ========================================================= */

function main() {
  const beforeHashes =
    operationalHashes();


  let requests = 0;


  /* -------------------------------------------------------
   * 홈페이지
   * ----------------------------------------------------- */

  requests += 1;


  const home =
    curlPage(
      HOMEPAGE
    );


  if (
    !home.ok
    ||
    home.status !== 200
  ) {
    const report = {
      schemaVersion:
        "2.0",

      generatedAt:
        new Date()
          .toISOString(),

      universityId:
        UNIVERSITY_ID,

      universityName:
        UNIVERSITY_NAME,

      decision:
        "HOMEPAGE_UNREACHABLE",

      homepage:
        HOMEPAGE,

      homepageResult: {
        status:
          home.status,

        finalUrl:
          home.finalUrl,

        bytes:
          home.bytes,

        curlExitCode:
          home.curlExitCode ?? null,

        error:
          home.error
      },

      requests,

      operationalHashUnchanged:
        true,

      nextAction:
        "RECHECK_CANONICAL_OR_SERVER_STATE",

      safety: {
        readOnly: true,

        curlTlsBypass:
          false,

        sourceModified:
          false,

        storeModified:
          false,

        previewModified:
          false,

        queueModified:
          false,

        gitTriggered:
          false,

        deploymentTriggered:
          false
      }
    };


    atomic(
      OUTPUT_FILE,
      report
    );


    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );


    return;
  }


  if (
    !officialDomain(
      home.finalUrl
    )
  ) {
    throw new Error(
      "KYUNGWOON_HOMEPAGE_NON_OFFICIAL"
    );
  }


  const anchors =
    extractAnchors(
      home.html,
      home.finalUrl
    );


  const candidates = [];


  for (
    const anchor
    of anchors
  ) {
    if (
      !anchor.url
      ||
      !officialDomain(
        anchor.url
      )
    ) {
      continue;
    }


    const scoring =
      scoreLink(
        anchor
      );


    if (
      scoring.score <= 0
    ) {
      continue;
    }


    candidates.push({
      label:
        anchor.title
        ||
        anchor.label,

      url:
        anchor.url,

      initialScore:
        scoring.score,

      reasons:
        scoring.reasons
    });
  }


  const uniqueCandidates =
    [
      ...new Map(
        candidates.map(
          item => [
            item.url,
            item
          ]
        )
      ).values()
    ]
      .sort(
        (a, b) =>
          b.initialScore
          -
          a.initialScore
      )
      .slice(
        0,
        MAX_CANDIDATE_REQUESTS
      );


  const tested = [];


  for (
    const candidate
    of uniqueCandidates
  ) {
    requests += 1;


    const page =
      curlPage(
        candidate.url
      );


    tested.push(
      evaluatePage(
        candidate,
        page
      )
    );
  }


  tested.sort(
    (a, b) =>
      b.finalScore
      -
      a.finalScore
  );


  const best =
    tested[0]
    || null;


  let decision =
    "NO_CANDIDATE";


  if (
    best
    &&
    best.finalScore >= 110
    &&
    best.bestStructure
    &&
    best.bestStructure.withDate >= 3
    &&
    best.bestStructure.withOfficialLink >= 3
  ) {
    decision =
      "CANDIDATE_DISCOVERED";
  }

  else if (
    best
    &&
    best.finalScore >= 70
  ) {
    decision =
      "REVIEW_CANDIDATE";
  }


  const proposedSource =
    (
      decision
      === "CANDIDATE_DISCOVERED"
      ||
      decision
      === "REVIEW_CANDIDATE"
    )
      ? {
          id:
            "kyungwoon-general-feed",

          name:
            `경운대학교 ${best.label || "공식 소식"}`,

          category:
            "school_news",

          sourceType:
            "official",

          collectionType:
            "html_or_custom",

          listUrl:
            best.finalUrl
            ||
            best.url,

          campusScope:
            "CAMPUS_SPECIFIC",

          contentScope:
            "GENERAL_UNIVERSITY_UPDATES",

          preferredStructure:
            best.bestStructure?.type
            || null,

          verified:
            false,

          enabled:
            false,

          status:
            "candidate_pending_validation",

          autoActivate:
            false
        }
      : null;


  let nextAction =
    "DEEP_DISCOVERY_REQUIRED";


  if (
    decision
    === "CANDIDATE_DISCOVERED"
  ) {
    nextAction =
      "VALIDATE_KYUNGWOON_SOURCE";
  }

  else if (
    decision
    === "REVIEW_CANDIDATE"
  ) {
    nextAction =
      "INSPECT_KYUNGWOON_CANDIDATE_STRUCTURE";
  }


  const afterHashes =
    operationalHashes();


  const hashSafe =
    JSON.stringify(
      beforeHashes
    )
    ===
    JSON.stringify(
      afterHashes
    );


  if (
    !hashSafe
  ) {
    throw new Error(
      "OPERATIONAL_FILE_MUTATION_DETECTED"
    );
  }


  const report = {
    schemaVersion:
      "2.0",

    generatedAt:
      new Date()
        .toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    transport: {
      type:
        "curl.exe",

      tlsVerificationDisabled:
        false,

      reason:
        "Node fetch fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE while Windows curl validates the site successfully."
    },

    homepage:
      HOMEPAGE,

    homepageStatus:
      home.status,

    homepageFinalUrl:
      home.finalUrl,

    homepageBytes:
      home.bytes,

    homepageAnchors:
      anchors.length,

    candidateCount:
      uniqueCandidates.length,

    testedCount:
      tested.length,

    testedCandidates:
      tested,

    bestCandidate:
      best,

    decision,

    proposedSource,

    nextAction,

    requests,

    operationalHashUnchanged:
      hashSafe,

    safety: {
      readOnly:
        true,

      curlTlsBypass:
        false,

      sourceModified:
        false,

      storeModified:
        false,

      previewModified:
        false,

      queueModified:
        false,

      gitTriggered:
        false,

      deploymentTriggered:
        false
    }
  };


  atomic(
    OUTPUT_FILE,
    report
  );


  console.log(
    JSON.stringify(
      {
        decision:
          report.decision,

        transport:
          report.transport,

        homepageStatus:
          report.homepageStatus,

        homepageFinalUrl:
          report.homepageFinalUrl,

        homepageBytes:
          report.homepageBytes,

        homepageAnchors:
          report.homepageAnchors,

        candidates:
          report.candidateCount,

        tested:
          report.testedCount,

        best:
          report.bestCandidate
            ? {
                label:
                  report.bestCandidate.label,

                url:
                  report.bestCandidate.url,

                finalUrl:
                  report.bestCandidate.finalUrl,

                score:
                  report.bestCandidate.finalScore,

                status:
                  report.bestCandidate.httpStatus,

                bytes:
                  report.bestCandidate.bytes,

                dates:
                  report.bestCandidate.dateLikeCount,

                structure:
                  report.bestCandidate.bestStructure
                    ? {
                        type:
                          report.bestCandidate.bestStructure.type,

                        useful:
                          report.bestCandidate.bestStructure.useful,

                        withDate:
                          report.bestCandidate.bestStructure.withDate,

                        withOfficialLink:
                          report.bestCandidate.bestStructure.withOfficialLink
                      }
                    : null,

                reasons:
                  report.bestCandidate.reasons
              }
            : null,

        top5:
          report.testedCandidates
            .slice(
              0,
              5
            )
            .map(
              item => ({
                label:
                  item.label,

                url:
                  item.url,

                score:
                  item.finalScore,

                status:
                  item.httpStatus,

                bytes:
                  item.bytes,

                dates:
                  item.dateLikeCount,

                structure:
                  item.bestStructure
                    ? {
                        type:
                          item.bestStructure.type,

                        useful:
                          item.bestStructure.useful,

                        withDate:
                          item.bestStructure.withDate,

                        withOfficialLink:
                          item.bestStructure.withOfficialLink
                      }
                    : null
              })
            ),

        proposedSource:
          report.proposedSource,

        nextAction:
          report.nextAction,

        requests:
          report.requests,

        hashSafe:
          report.operationalHashUnchanged
      },
      null,
      2
    )
  );
}


if (
  require.main === module
) {
  main();
}


module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  curlPage,
  countDates,
  extractAnchors,
  scoreLink,
  analyzeStructures,
  evaluatePage
};