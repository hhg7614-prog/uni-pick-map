"use strict";

/**
 * UNI PICK - HSMU Flexible Official Source Selector v1
 *
 * 목적
 * ---------------------------------------------------------
 * 화성의과학대학교에서 "공지사항" 하나만 고집하지 않고,
 * 학생/학교 관련 최신 소식이 반복적으로 올라오는 공식 게시판 중
 * 가장 수집 안정성이 높은 source 후보를 선택한다.
 *
 * 허용 카테고리 예:
 * - 공지사항
 * - 학사
 * - 모집
 * - 입학
 * - 장학
 * - 학생지원
 * - 취업/채용
 * - 프로그램
 * - 행사
 * - 대학소식
 * - 일반안내
 *
 * 핵심 기준
 * ---------------------------------------------------------
 * 1. 공식 hsmu.ac.kr 도메인
 * 2. HTTP 200
 * 3. 반복 게시물 구조
 * 4. 날짜 패턴 존재
 * 5. 게시물 제목 다수 존재
 * 6. 상세 이동을 href/onclick/ID 중 하나로 식별 가능
 *
 * 안전
 * ---------------------------------------------------------
 * - catalog 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  "hwasung-medi-science-flexible-source-selection.json"
);

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const HOMEPAGE =
  "https://www.hsmu.ac.kr/";

const REQUEST_TIMEOUT_MS = 20000;

const MAX_PAGE_REQUESTS = 15;


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
    {
      recursive: true
    }
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

  let text =
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

    if (
      !/^https?:$/.test(
        url.protocol
      )
    ) {
      return null;
    }

    return url.href;

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
      host === "hsmu.ac.kr"
      ||
      host.endsWith(
        ".hsmu.ac.kr"
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
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(file)
    )
    .digest(
      "hex"
    );
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
 * HTTP
 * ========================================================= */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK HSMU Flexible Source Selector",

            "Accept":
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "ko-KR,ko;q=0.9,en;q=0.8"
          }
        }
      );

    const html =
      await response.text();

    return {
      ok:
        true,

      status:
        response.status,

      finalUrl:
        response.url,

      bytes:
        Buffer.byteLength(
          html,
          "utf8"
        ),

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

      html
    };

  } catch (error) {
    return {
      ok:
        false,

      status:
        null,

      finalUrl:
        null,

      bytes:
        0,

      contentType:
        "",

      html:
        "",

      error: {
        name:
          error?.name || null,

        message:
          error?.message || null,

        causeCode:
          error?.cause?.code || null,

        causeMessage:
          error?.cause?.message || null
      }
    };

  } finally {
    clearTimeout(
      timer
    );
  }
}


/* =========================================================
 * 링크 추출
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
      )[1];

    const onclick =
      (
        attrs.match(
          /\bonclick\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1];

    const url =
      href
        ? normalizeUrl(
            href,
            baseUrl
          )
        : null;

    const label =
      plain(
        match[2]
      );

    if (
      !label
      &&
      !onclick
    ) {
      continue;
    }

    output.push({
      label,

      href:
        href || null,

      url,

      onclick:
        onclick || null
    });
  }

  return output;
}


/* =========================================================
 * 소식 카테고리 점수
 * ========================================================= */

function categoryScore(
  label,
  url
) {
  const value =
    `${label || ""} ${url || ""}`
      .toLowerCase();

  let score = 0;
  const reasons = [];

  const strong = [
    ["공지사항", 50],
    ["공지", 45],
    ["학사공지", 48],
    ["학사", 35],
    ["대학소식", 45],
    ["뉴스", 40],
    ["소식", 35],
    ["행사", 30],
    ["프로그램", 30],
    ["장학", 30],
    ["채용", 28],
    ["취업", 28],
    ["모집", 28],
    ["입학", 20],
    ["학생지원", 25],
    ["안내", 20]
  ];

  for (
    const [word, points]
    of strong
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
    /board|bbs|notice|news|community|contents/i.test(
      value
    )
  ) {
    score += 15;

    reasons.push(
      "BOARD_URL:15"
    );
  }


  if (
    /privacy|sitemap|login|history|president|organization|faculty|department/i.test(
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
 * 날짜 패턴
 * ========================================================= */

function countDates(html) {
  const text =
    plain(
      html
    );

  const fourDigit =
    (
      text.match(
        /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
      )
      || []
    ).length;

  const short =
    (
      text.match(
        /(?:^|\D)\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\D|$)/g
      )
      || []
    ).length;

  return (
    fourDigit
    +
    short
  );
}


/* =========================================================
 * 반복 구조
 * ========================================================= */

function analyzeRepeatingStructures(
  html,
  baseUrl
) {
  const structures = [];


  const configs = [
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


  for (
    const config
    of configs
  ) {
    const rows =
      html.match(
        config.regex
      )
      || [];

    const useful = [];

    for (
      const raw
      of rows
    ) {
      const text =
        plain(
          raw
        );

      const anchors =
        extractAnchors(
          raw,
          baseUrl
        );

      const dateCount =
        countDates(
          raw
        );

      const hasClickable =
        anchors.some(
          item =>
            item.url
            ||
            item.onclick
        );

      if (
        text.length >= 5
        &&
        hasClickable
      ) {
        useful.push({
          text:
            text.slice(
              0,
              500
            ),

          dateCount,

          anchors:
            anchors.slice(
              0,
              10
            )
        });
      }
    }


    structures.push({
      type:
        config.type,

      total:
        rows.length,

      useful:
        useful.length,

      withDate:
        useful.filter(
          item =>
            item.dateCount > 0
        ).length,

      samples:
        useful.slice(
          0,
          10
        )
    });
  }


  return structures;
}


/* =========================================================
 * 페이지 점수
 * ========================================================= */

function scoreCandidatePage({
  candidate,
  page
}) {
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


  const dateCount =
    countDates(
      page.html
    );


  if (
    dateCount >= 3
  ) {
    score += 15;
    reasons.push(
      "DATES_3_PLUS:15"
    );
  }


  if (
    dateCount >= 10
  ) {
    score += 10;
    reasons.push(
      "DATES_10_PLUS:10"
    );
  }


  const structures =
    analyzeRepeatingStructures(
      page.html,
      page.finalUrl
    );


  const bestStructure =
    [...structures]
      .sort(
        (a, b) =>
          (
            b.withDate * 3
            +
            b.useful
          )
          -
          (
            a.withDate * 3
            +
            a.useful
          )
      )[0];


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
    score += 20;
    reasons.push(
      "REPEATING_ITEMS_WITH_DATE:20"
    );
  }


  const anchors =
    extractAnchors(
      page.html,
      page.finalUrl
    );


  const clickableItems =
    anchors.filter(
      item =>
        (
          item.url
          &&
          officialDomain(
            item.url
          )
        )
        ||
        item.onclick
    );


  if (
    clickableItems.length >= 5
  ) {
    score += 10;
    reasons.push(
      "CLICKABLE_ITEMS_5_PLUS:10"
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

    dateLikeCount:
      dateCount,

    anchorCount:
      anchors.length,

    clickableItemCount:
      clickableItems.length,

    structures,

    bestStructure:
      bestStructure || null,

    reasons
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const beforeHashes =
    operationalHashes();


  let requests = 0;


  requests += 1;


  const home =
    await fetchPage(
      HOMEPAGE
    );


  if (
    !home.ok
    ||
    home.status !== 200
  ) {
    throw new Error(
      "HSMU_HOMEPAGE_UNREACHABLE"
    );
  }


  const links =
    extractAnchors(
      home.html,
      home.finalUrl
    );


  const candidates = [];


  for (
    const link
    of links
  ) {
    if (
      !link.url
      ||
      !officialDomain(
        link.url
      )
    ) {
      continue;
    }


    const scored =
      categoryScore(
        link.label,
        link.url
      );


    if (
      scored.score <= 0
    ) {
      continue;
    }


    candidates.push({
      url:
        link.url,

      label:
        link.label,

      initialScore:
        scored.score,

      reasons:
        scored.reasons
    });
  }


  /*
   * 중복 제거 후 상위 후보
   */

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
        MAX_PAGE_REQUESTS
      );


  const tested = [];


  for (
    const candidate
    of uniqueCandidates
  ) {
    requests += 1;


    const page =
      await fetchPage(
        candidate.url
      );


    if (
      !page.ok
    ) {
      tested.push({
        ...candidate,

        finalScore:
          candidate.initialScore,

        httpStatus:
          null,

        error:
          page.error,

        dateLikeCount:
          0,

        clickableItemCount:
          0,

        structures:
          [],

        reasons:
          [
            ...candidate.reasons,
            "FETCH_FAILED"
          ]
      });

      continue;
    }


    tested.push(
      scoreCandidatePage({
        candidate,
        page
      })
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
    "NO_FLEXIBLE_SOURCE_FOUND";


  if (
    best
    &&
    best.finalScore >= 100
    &&
    best.bestStructure
    &&
    best.bestStructure.useful >= 5
  ) {
    decision =
      "FLEXIBLE_SOURCE_DISCOVERED";
  }

  else if (
    best
    &&
    best.finalScore >= 70
  ) {
    decision =
      "FLEXIBLE_SOURCE_REVIEW";
  }


  const proposedSource =
    decision
    === "FLEXIBLE_SOURCE_DISCOVERED"
      ? {
          id:
            "hwasung-medi-science-general-feed",

          name:
            `화성의과학대학교 ${best.label || "공식 소식"}`,

          category:
            "school_news",

          sourceType:
            "official",

          collectionType:
            "html_or_custom",

          listUrl:
            best.finalUrl
            || best.url,

          contentScope:
            "GENERAL_UNIVERSITY_UPDATES",

          matchedLabel:
            best.label,

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
    "DEEP_DISCOVERY_OTHER_OFFICIAL_SECTIONS";


  if (
    decision
    === "FLEXIBLE_SOURCE_DISCOVERED"
  ) {
    nextAction =
      "VALIDATE_FLEXIBLE_SOURCE";
  }

  else if (
    decision
    === "FLEXIBLE_SOURCE_REVIEW"
  ) {
    nextAction =
      "INSPECT_BEST_FLEXIBLE_SOURCE_STRUCTURE";
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

    policy: {
      exactNoticeRequired:
        false,

      acceptableOfficialCategories: [
        "공지",
        "학사",
        "모집",
        "입학",
        "장학",
        "학생지원",
        "취업",
        "채용",
        "프로그램",
        "행사",
        "대학소식",
        "뉴스",
        "일반안내"
      ]
    },

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    homepage:
      HOMEPAGE,

    homeStatus:
      home.status,

    homeAnchorCount:
      links.length,

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

    beforeHashes,

    afterHashes,

    safety: {
      readOnly:
        true,

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
        false,

      tlsVerificationDisabled:
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

        homepageStatus:
          report.homeStatus,

        homeAnchors:
          report.homeAnchorCount,

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

                dates:
                  report.bestCandidate.dateLikeCount,

                clickableItems:
                  report.bestCandidate.clickableItemCount,

                structure:
                  report.bestCandidate.bestStructure
                  ? {
                      type:
                        report.bestCandidate.bestStructure.type,

                      useful:
                        report.bestCandidate.bestStructure.useful,

                      withDate:
                        report.bestCandidate.bestStructure.withDate
                    }
                  : null,

                reasons:
                  report.bestCandidate.reasons
              }
            : null,

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
  main().catch(
    error => {
      console.error(
        error.stack
        ||
        error.message
      );

      process.exitCode =
        1;
    }
  );
}


module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  extractAnchors,
  categoryScore,
  countDates,
  analyzeRepeatingStructures,
  scoreCandidatePage
};