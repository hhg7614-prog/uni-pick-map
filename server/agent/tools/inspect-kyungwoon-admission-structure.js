"use strict";

/**
 * UNI PICK - Kyungwoon Admission Structure Inspector v1
 *
 * 목적
 * ---------------------------------------------------------
 * 경운대학교 입학 홈페이지
 * https://www.ikw.ac.kr/ipsi/main.tc
 *
 * 에서 실제 반복 게시물/공지 영역을 좁혀 찾는다.
 *
 * 정책
 * ---------------------------------------------------------
 * 정확히 "공지사항"일 필요는 없다.
 * 입학/모집/전형/안내/행사/프로그램 등
 * 공식 학교 소식성 게시판이면 허용한다.
 *
 * 현재 문제
 * ---------------------------------------------------------
 * 메인 입학 페이지 자체는:
 * - HTTP 200
 * - 공식 도메인
 * - 날짜 7개
 * - LI 98개
 *
 * 하지만 LI가 메뉴까지 섞여 있어
 * 실제 게시물 container로 쓰기엔 너무 넓다.
 *
 * 이번 단계
 * ---------------------------------------------------------
 * 1. curl.exe로 입학 홈페이지 요청
 * 2. 링크 전체 추출
 * 3. 입학공지/모집/전형/안내 관련 후보 URL 점수화
 * 4. 상위 후보 최대 15개 실제 요청
 * 5. TR/LI/DIV/ARTICLE 반복 구조 분석
 * 6. 같은 container 안에 제목+날짜+상세링크가 있는지 확인
 * 7. 가장 안정적인 게시판 후보 선정
 *
 * 안전
 * ---------------------------------------------------------
 * - read-only
 * - curl -k 사용 안 함
 * - catalog/store/preview/queue 수정 없음
 * - git/deploy 없음
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

const PREVIOUS_FILE = path.join(
  DATA,
  "kyungwoon-flexible-source-discovery.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungwoon-admission-structure-inspection.json"
);

const START_URL =
  "https://www.ikw.ac.kr/ipsi/main.tc";

const UNIVERSITY_ID =
  "kyungwoon-university-본교";

const UNIVERSITY_NAME =
  "경운대학교";

const REQUEST_TIMEOUT_MS = 30000;
const MAX_CANDIDATES = 15;


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

function read(file, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}


function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  const temp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      temp,
      "utf8"
    )
  );

  fs.renameSync(
    temp,
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
  if (!fs.existsSync(file)) {
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
 * curl adapter
 * ========================================================= */

function curlPage(url) {
  const result =
    spawnSync(
      "curl.exe",
      [
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
        "Mozilla/5.0 compatible UNI-PICK Kyungwoon Admission Inspector",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__UNI_PICK_META__%{http_code}|%{url_effective}|%{content_type}",

        url
      ],
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

      html: "",

      bytes: 0,

      error: {
        name:
          result.error.name,

        message:
          result.error.message
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

      html:
        stdout,

      bytes:
        Buffer.byteLength(
          stdout,
          "utf8"
        ),

      error: {
        name:
          "CurlMetaError",

        message:
          "curl metadata marker missing"
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


  return {
    ok:
      result.status === 0
      &&
      status >= 200
      &&
      status < 400,

    status,

    finalUrl:
      finalUrl || null,

    contentType:
      contentType || "",

    html,

    bytes:
      Buffer.byteLength(
        html,
        "utf8"
      ),

    curlExitCode:
      result.status,

    error:
      result.status === 0
        ? null
        : {
            name:
              "CurlError",

            message:
              String(
                result.stderr || ""
              ).trim(),

            code:
              result.status
          }
  };
}


/* =========================================================
 * 날짜
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(
      value
    );


  let match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );


  if (match) {
    return normalizeDateParts(
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );
  }


  match =
    text.match(
      /(?:^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\D|$)/
    );


  if (match) {
    return normalizeDateParts(
      2000 + Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );
  }


  return null;
}


function normalizeDateParts(
  year,
  month,
  day
) {
  if (
    month < 1
    ||
    month > 12
    ||
    day < 1
    ||
    day > 31
  ) {
    return null;
  }


  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


/* =========================================================
 * Anchor
 * ========================================================= */

function extractAnchors(
  html,
  baseUrl
) {
  const output = [];


  for (
    const match
    of html.matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
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


    const title =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
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
        ? plain(title)
        : null,

      href,

      url,

      onclick
    });
  }


  return output;
}


/* =========================================================
 * Candidate scoring
 * ========================================================= */

function scoreCandidateLink(anchor) {
  const value =
    `${anchor.label || ""} ${anchor.title || ""} ${anchor.url || ""}`
      .toLowerCase();


  let score = 0;

  const reasons = [];


  const rules = [
    ["입학공지", 70],
    ["공지사항", 65],
    ["공지", 55],
    ["수시", 45],
    ["정시", 45],
    ["모집", 40],
    ["입학", 35],
    ["전형", 35],
    ["합격", 30],
    ["안내", 25],
    ["자료실", 20],
    ["소식", 20],
    ["행사", 20]
  ];


  for (
    const [word, points]
    of rules
  ) {
    if (
      value.includes(word)
    ) {
      score += points;

      reasons.push(
        `${word}:${points}`
      );
    }
  }


  if (
    /board|bbs|notice|list|article|post|community/.test(
      value
    )
  ) {
    score += 20;

    reasons.push(
      "BOARD_SIGNAL:20"
    );
  }


  if (
    /login|privacy|sitemap|main\.tc$/.test(
      value
    )
  ) {
    score -= 30;

    reasons.push(
      "WEAK_OR_MENU:-30"
    );
  }


  return {
    score,
    reasons
  };
}


/* =========================================================
 * Detail-like link 판정
 * ========================================================= */

function looksLikeDetailUrl(
  url,
  listUrl
) {
  if (
    !url
    ||
    !officialDomain(
      url
    )
  ) {
    return false;
  }


  try {
    const target =
      new URL(url);

    const list =
      new URL(listUrl);


    if (
      target.href
      === list.href
    ) {
      return false;
    }


    const joined =
      `${target.pathname}${target.search}`
        .toLowerCase();


    return Boolean(
      /view|detail|read|article|post/.test(
        joined
      )
      ||
      /(?:idx|seq|no|id|article|bbs|board)[^=]*=\d+/.test(
        joined
      )
      ||
      target.pathname
        .split("/")
        .filter(Boolean)
        .some(
          part =>
            /^\d{2,}$/.test(
              part
            )
        )
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * Container 분석
 * ========================================================= */

function analyzeContainerType(
  html,
  baseUrl,
  type,
  regex
) {
  const containers =
    html.match(
      regex
    )
    || [];


  const items = [];


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


    const detailAnchors =
      anchors.filter(
        anchor =>
          anchor.url
          &&
          looksLikeDetailUrl(
            anchor.url,
            baseUrl
          )
      );


    if (
      detailAnchors.length === 0
    ) {
      continue;
    }


    const publishedAt =
      parseDate(
        raw
      );


    const titleCandidates =
      detailAnchors
        .map(
          anchor => ({
            title:
              anchor.title
              ||
              anchor.label,

            url:
              anchor.url
          })
        )
        .filter(
          item =>
            item.title
            &&
            item.title.length >= 4
        )
        .sort(
          (a, b) =>
            b.title.length
            -
            a.title.length
        );


    if (
      titleCandidates.length === 0
    ) {
      continue;
    }


    items.push({
      type,

      title:
        titleCandidates[0].title,

      url:
        titleCandidates[0].url,

      publishedAt,

      text:
        text.slice(
          0,
          700
        )
    });
  }


  const unique =
    [
      ...new Map(
        items.map(
          item => [
            item.url,
            item
          ]
        )
      ).values()
    ];


  return {
    type,

    totalContainers:
      containers.length,

    extracted:
      items.length,

    unique:
      unique.length,

    withDate:
      unique.filter(
        item =>
          Boolean(
            item.publishedAt
          )
      ).length,

    distinctTitles:
      new Set(
        unique.map(
          item =>
            item.title
        )
      ).size,

    sampleItems:
      unique.slice(
        0,
        8
      )
  };
}


function analyzePageStructure(
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
    },

    {
      type:
        "DIV",

      regex:
        /<div\b[^>]*>[\s\S]{0,5000}?<\/div>/gi
    }
  ];


  const reports =
    definitions.map(
      definition =>
        analyzeContainerType(
          html,
          baseUrl,
          definition.type,
          definition.regex
        )
    );


  const best =
    [...reports]
      .sort(
        (a, b) =>
          (
            b.withDate * 10
            +
            b.unique * 3
            +
            b.distinctTitles
          )
          -
          (
            a.withDate * 10
            +
            a.unique * 3
            +
            a.distinctTitles
          )
      )[0]
      || null;


  return {
    reports,
    best
  };
}


/* =========================================================
 * Candidate page evaluation
 * ========================================================= */

function evaluateCandidate(
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


  const structure =
    analyzePageStructure(
      page.html,
      page.finalUrl
      ||
      candidate.url
    );


  if (
    structure.best
    &&
    structure.best.unique >= 3
  ) {
    score += 20;

    reasons.push(
      "UNIQUE_POSTS_3_PLUS:20"
    );
  }


  if (
    structure.best
    &&
    structure.best.withDate >= 3
  ) {
    score += 30;

    reasons.push(
      "POST_DATES_3_PLUS:30"
    );
  }


  if (
    structure.best
    &&
    structure.best.distinctTitles >= 3
  ) {
    score += 15;

    reasons.push(
      "TITLE_VARIETY:15"
    );
  }


  return {
    ...candidate,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    finalScore:
      score,

    structure,

    reasons,

    error:
      page.error || null
  };
}


/* =========================================================
 * Main
 * ========================================================= */

function main() {
  const previous =
    read(
      PREVIOUS_FILE,
      {}
    );


  if (
    previous.nextAction
      !== "INSPECT_KYUNGWOON_CANDIDATE_STRUCTURE"
  ) {
    throw new Error(
      "KYUNGWOON_PREVIOUS_STAGE_NOT_READY"
    );
  }


  const beforeHashes =
    operationalHashes();


  let requests = 0;


  requests += 1;


  const start =
    curlPage(
      START_URL
    );


  if (
    !start.ok
    ||
    start.status !== 200
  ) {
    throw new Error(
      "KYUNGWOON_ADMISSION_PAGE_UNREACHABLE"
    );
  }


  const anchors =
    extractAnchors(
      start.html,
      start.finalUrl
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


    const scored =
      scoreCandidateLink(
        anchor
      );


    if (
      scored.score <= 0
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
        scored.score,

      reasons:
        scored.reasons
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
        MAX_CANDIDATES
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
      evaluateCandidate(
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
    "NO_BOARD_CANDIDATE";


  if (
    best
    &&
    best.structure?.best?.unique >= 3
    &&
    best.structure?.best?.withDate >= 3
    &&
    best.structure?.best?.distinctTitles >= 3
  ) {
    decision =
      "BOARD_CANDIDATE_DISCOVERED";
  }

  else if (
    best
    &&
    best.finalScore >= 70
  ) {
    decision =
      "BOARD_CANDIDATE_REVIEW";
  }


  const proposedSource =
    (
      decision
      === "BOARD_CANDIDATE_DISCOVERED"
      ||
      decision
      === "BOARD_CANDIDATE_REVIEW"
    )
      ? {
          id:
            "kyungwoon-general-feed",

          name:
            `경운대학교 ${best.label || "입학 소식"}`,

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
            best.structure?.best?.type
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


  const nextAction =
    decision
    === "BOARD_CANDIDATE_DISCOVERED"
      ? "VALIDATE_KYUNGWOON_BOARD_CANDIDATE"
      : decision
      === "BOARD_CANDIDATE_REVIEW"
      ? "INSPECT_KYUNGWOON_BOARD_ROWS"
      : "DEEP_DISCOVERY_ALTERNATIVE_PATHS";


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


  if (!hashSafe) {
    throw new Error(
      "OPERATIONAL_FILE_MUTATION_DETECTED"
    );
  }


  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    startUrl:
      START_URL,

    startStatus:
      start.status,

    anchors:
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

        startStatus:
          report.startStatus,

        anchors:
          report.anchors,

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
                  report.bestCandidate.status,

                structure:
                  report.bestCandidate.structure?.best
                  || null,

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
                  item.status,

                structure:
                  item.structure?.best
                  || null
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
  parseDate,
  extractAnchors,
  scoreCandidateLink,
  looksLikeDetailUrl,
  analyzeContainerType,
  analyzePageStructure,
  evaluateCandidate
};