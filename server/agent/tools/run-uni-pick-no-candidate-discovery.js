"use strict";

/**
 * UNI PICK NO_CANDIDATE Discovery Pilot v2
 *
 * 목적
 * ---------------------------------------------------------
 * NO_CANDIDATE 상태의 대학만 대상으로
 * 공식 홈페이지 내부에서 공지/뉴스/게시판 후보를 탐색한다.
 *
 * v2 개선사항
 * ---------------------------------------------------------
 * 1. 홈페이지 링크를 먼저 40개로 자르지 않는다.
 * 2. 전체 공식 링크를 먼저 점수화한 뒤 상위 후보만 요청한다.
 * 3. 공지/학사/학생/모집/장학/행사 등의 키워드를 강화한다.
 * 4. mode=download 같은 첨부파일을 상세 게시글로 오인하지 않는다.
 * 5. HTML 전체에서 과도하게 날짜를 세는 문제를 방지한다.
 * 6. 상세 URL의 unique count를 별도로 계산한다.
 * 7. 운영 source/store/preview/queue/git/deploy를 수정하지 않는다.
 *
 * 권장 실행환경
 * ---------------------------------------------------------
 * Node 22 + --use-system-ca
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");


// =========================================================
// 0. 경로 / 상수
// =========================================================

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

const EVALUATION_FILE = path.join(
  DATA,
  "uni-pick-recovered-pilot-evaluation.json"
);

const PILOT_FILE = path.join(
  DATA,
  "uni-pick-safe-pilot-result.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-no-candidate-discovery.json"
);

const MAX_TARGETS = 4;

const MAX_CANDIDATES_TO_FETCH = 12;


// =========================================================
// 1. 운영 파일 보호 대상
// =========================================================

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


// =========================================================
// 2. 공통 유틸
// =========================================================

function read(
  file,
  fallback = null
) {
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


function atomic(
  file,
  value
) {
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


function clean(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function normalizeId(
  value
) {
  return String(
    value || ""
  ).normalize(
    "NFC"
  );
}


function normalizeUrl(
  value,
  base
) {
  if (!value) {
    return null;
  }

  let text =
    String(
      value
    ).trim();

  const markdown =
    text.match(
      /^\[[^\]]+\]\((.+)\)$/
    );

  if (
    markdown
    &&
    markdown[1]
  ) {
    text =
      markdown[1];
  }

  text =
    text.replace(
      /\\&/g,
      "&"
    );


  try {
    return new URL(
      text,
      base
    ).href.split(
      "#"
    )[0];

  } catch {
    return null;
  }
}


function hostKey(
  url
) {
  try {
    return new URL(
      url
    )
      .hostname
      .toLowerCase()
      .replace(
        /^www\./,
        ""
      );

  } catch {
    return "";
  }
}


function sameOfficialDomain(
  candidate,
  homepage
) {
  const candidateHost =
    hostKey(
      candidate
    );

  const homepageHost =
    hostKey(
      homepage
    );


  if (
    !candidateHost
    ||
    !homepageHost
  ) {
    return false;
  }


  return (
    candidateHost
      === homepageHost
    ||
    candidateHost.endsWith(
      `.${homepageHost}`
    )
    ||
    homepageHost.endsWith(
      `.${candidateHost}`
    )
  );
}


// =========================================================
// 3. Hash / 안전 검사
// =========================================================

function sha256(
  file
) {
  if (
    !fs.existsSync(
      file
    )
  ) {
    return null;
  }


  return crypto
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(
        file
      )
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

        sha256(
          file
        )
      ]
    )
  );
}


function hashesEqual(
  before,
  after
) {
  return (
    JSON.stringify(
      before
    )
    ===
    JSON.stringify(
      after
    )
  );
}


// =========================================================
// 4. HTTP
// =========================================================

async function fetchPage(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      15000
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
              "Mozilla/5.0 compatible UNI-PICK NO_CANDIDATE Discovery v2",

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

      requestedUrl:
        url,

      finalUrl:
        response.url,

      contentType:
        response.headers.get(
          "content-type"
        )
        || "",

      bytes:
        Buffer.byteLength(
          html,
          "utf8"
        ),

      html
    };

  } catch (
    error
  ) {
    return {
      ok:
        false,

      status:
        null,

      requestedUrl:
        url,

      finalUrl:
        null,

      contentType:
        "",

      bytes:
        0,

      html:
        "",

      error: {
        name:
          error?.name
          || null,

        message:
          error?.message
          || null,

        code:
          error?.code
          || null,

        causeCode:
          error?.cause?.code
          || null,

        causeMessage:
          error?.cause?.message
          || null
      }
    };

  } finally {
    clearTimeout(
      timer
    );
  }
}


// =========================================================
// 5. Anchor 추출
// =========================================================

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
      match[1]
      || "";

    const body =
      match[2]
      || "";


    const hrefMatch =
      attrs.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );


    if (
      !hrefMatch
    ) {
      continue;
    }


    const url =
      normalizeUrl(
        hrefMatch[1],
        baseUrl
      );


    if (
      !url
    ) {
      continue;
    }


    const label =
      clean(
        body
      );


    if (
      !label
    ) {
      continue;
    }


    output.push({
      url,
      label
    });
  }


  return [
    ...new Map(
      output.map(
        item => [
          `${item.url}|${item.label}`,
          item
        ]
      )
    ).values()
  ];
}


// =========================================================
// 6. 후보 점수
// =========================================================

function scoreCandidate(
  link,
  homepage
) {
  if (
    !sameOfficialDomain(
      link.url,
      homepage
    )
  ) {
    return {
      score:
        -100,

      reasons: [
        "NON_OFFICIAL_DOMAIN"
      ]
    };
  }


  const joined =
    `${link.url} ${link.label}`
      .toLowerCase();


  let score = 0;

  const reasons = [];


  const strongKeywords = [
    "공지",
    "공지사항",
    "일반공지",
    "학사공지",
    "대학공지",
    "notice",
    "announcement",
    "알림",
    "새소식",
    "대학소식",
    "학교소식",
    "정보광장"
  ];


  const mediumKeywords = [
    "news",
    "board",
    "bbs",
    "community",
    "소식",
    "학사",
    "학생",
    "모집",
    "채용",
    "장학",
    "행사",
    "게시판",
    "커뮤니티"
  ];


  for (
    const keyword
    of strongKeywords
  ) {
    if (
      joined.includes(
        keyword
      )
    ) {
      score += 20;

      reasons.push(
        `STRONG:${keyword}`
      );
    }
  }


  for (
    const keyword
    of mediumKeywords
  ) {
    if (
      joined.includes(
        keyword
      )
    ) {
      score += 8;

      reasons.push(
        `MEDIUM:${keyword}`
      );
    }
  }


  try {
    const parsed =
      new URL(
        link.url
      );


    if (
      /notice|board|bbs|news|community|article/i.test(
        parsed.pathname
      )
    ) {
      score += 10;

      reasons.push(
        "PATH_SIGNAL"
      );
    }


    if (
      /mode=list|list.do|list$|boardList|bbsList/i.test(
        `${parsed.pathname}${parsed.search}`
      )
    ) {
      score += 10;

      reasons.push(
        "LIST_URL_SIGNAL"
      );
    }


    if (
      /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|zip)$/i.test(
        parsed.pathname
      )
    ) {
      score -= 50;

      reasons.push(
        "FILE_LINK"
      );
    }

  } catch {
    score -= 50;

    reasons.push(
      "INVALID_URL"
    );
  }


  if (
    /login|privacy|sitemap|search|faculty|department|president|history|organization/i.test(
      joined
    )
  ) {
    score -= 25;

    reasons.push(
      "NEGATIVE_NAVIGATION"
    );
  }


  return {
    score,
    reasons
  };
}


// =========================================================
// 7. 상세 URL 판별
// =========================================================

function isDetailUrl(
  url
) {
  try {
    const parsed =
      new URL(
        url
      );

    const joined =
      `${parsed.pathname}${parsed.search}`;


    if (
      /mode=download/i.test(
        joined
      )
    ) {
      return false;
    }


    if (
      /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|zip)$/i.test(
        parsed.pathname
      )
    ) {
      return false;
    }


    return (
      /mode=view/i.test(
        joined
      )
      ||
      /articleNo=\d+/i.test(
        joined
      )
      ||
      /(?:idx|seq|no|boardNo|bbsNo)=\d+/i.test(
        joined
      )
      ||
      /\/(?:view|detail|read)(?:\/|$)/i.test(
        parsed.pathname
      )
    );

  } catch {
    return false;
  }
}


// =========================================================
// 8. 목록 페이지 분석
// =========================================================

function analyzeCandidatePage(
  page
) {
  if (
    !page.ok
    ||
    page.status
      !== 200
  ) {
    return {
      listLikely:
        false,

      detailLinkCount:
        0,

      uniqueDetailLinkCount:
        0,

      dateLikeCount:
        0,

      sampleDetailUrls:
        []
    };
  }


  const pageAnchors =
    extractAnchors(
      page.html,
      page.finalUrl
    );


  const detailLinks =
    pageAnchors.filter(
      item =>
        isDetailUrl(
          item.url
        )
    );


  const uniqueDetails =
    [
      ...new Set(
        detailLinks.map(
          item =>
            item.url
        )
      )
    ];


  // script/style은 clean()에서 제외한 텍스트만 날짜 검사
  const visibleText =
    clean(
      page.html
    );


  const dateMatches =
    visibleText.match(
      /20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}/g
    )
    || [];


  const uniqueDates =
    [
      ...new Set(
        dateMatches
      )
    ];


  // 과도한 날짜 수가 점수에 영향을 주지 않도록 제한
  const dateLikeCount =
    Math.min(
      20,
      uniqueDates.length
    );


  return {
    listLikely:
      uniqueDetails.length
        >= 2
      &&
      dateLikeCount
        >= 2,

    detailLinkCount:
      detailLinks.length,

    uniqueDetailLinkCount:
      uniqueDetails.length,

    dateLikeCount,

    sampleDetailUrls:
      uniqueDetails.slice(
        0,
        5
      )
  };
}


// =========================================================
// 9. NO_CANDIDATE 대상 생성
// =========================================================

function buildTargets() {
  const evaluation =
    read(
      EVALUATION_FILE,
      {
        evaluatedItems:
          []
      }
    );


  const pilot =
    read(
      PILOT_FILE,
      {
        results:
          []
      }
    );


  const pilotMap =
    new Map(
      (
        pilot.results
        || []
      ).map(
        row => [
          normalizeId(
            row.universityId
          ),

          row
        ]
      )
    );


  return (
    evaluation.evaluatedItems
    || []
  )
    .filter(
      row =>
        row.nextClass
          === "NO_CANDIDATE"
    )
    .slice(
      0,
      MAX_TARGETS
    )
    .map(
      row => {
        const pilotRow =
          pilotMap.get(
            normalizeId(
              row.universityId
            )
          );


        return {
          universityId:
            row.universityId,

          universityName:
            row.universityName,

          homepage:
            normalizeUrl(
              pilotRow?.officialUrl
              || "",
              undefined
            ),

          previousClass:
            row.nextClass
        };
      }
    );
}


// =========================================================
// 10. 대학 1곳 Discovery
// =========================================================

async function discoverOne(
  target
) {
  let requestCount = 0;


  if (
    !target.homepage
  ) {
    return {
      ...target,

      finalStatus:
        "HOMEPAGE_MISSING",

      requestCount,

      candidateCount:
        0,

      candidates:
        []
    };
  }


  requestCount += 1;


  const homepage =
    await fetchPage(
      target.homepage
    );


  if (
    !homepage.ok
    ||
    homepage.status
      !== 200
  ) {
    return {
      ...target,

      finalStatus:
        (
          homepage.error
          ? "TRANSIENT_NETWORK"
          : "HOMEPAGE_UNREACHABLE"
        ),

      requestCount,

      homepageStatus:
        homepage.status,

      homepageError:
        homepage.error
        || null,

      candidateCount:
        0,

      candidates:
        []
    };
  }


  // -------------------------------------------------------
  // 중요:
  // 전체 공식 링크를 먼저 확보한다.
  // 여기서는 slice하지 않는다.
  // -------------------------------------------------------

  const allLinks =
    extractAnchors(
      homepage.html,
      homepage.finalUrl
    )
      .filter(
        link =>
          sameOfficialDomain(
            link.url,
            homepage.finalUrl
          )
      );


  // -------------------------------------------------------
  // 전체 링크를 점수화한 뒤 상위 12개만 요청
  // -------------------------------------------------------

  const scored =
    allLinks
      .map(
        link => {
          const result =
            scoreCandidate(
              link,
              homepage.finalUrl
            );


          return {
            ...link,

            initialScore:
              result.score,

            initialReasons:
              result.reasons
          };
        }
      )

      .filter(
        item =>
          item.initialScore
            > 0
      )

      .sort(
        (a, b) =>
          b.initialScore
          -
          a.initialScore
      )

      .slice(
        0,
        MAX_CANDIDATES_TO_FETCH
      );


  const tested = [];


  for (
    const candidate
    of scored
  ) {
    requestCount += 1;


    const page =
      await fetchPage(
        candidate.url
      );


    const analysis =
      analyzeCandidatePage(
        page
      );


    let finalScore =
      candidate.initialScore;


    if (
      page.ok
      &&
      page.status
        === 200
    ) {
      finalScore += 15;
    }


    if (
      analysis.uniqueDetailLinkCount
        >= 2
    ) {
      finalScore += 25;
    }


    if (
      analysis.dateLikeCount
        >= 2
    ) {
      finalScore += 15;
    }


    if (
      analysis.listLikely
    ) {
      finalScore += 30;
    }


    tested.push({
      url:
        candidate.url,

      label:
        candidate.label,

      initialScore:
        candidate.initialScore,

      finalScore,

      homepageOfficialDomain:
        true,

      httpStatus:
        page.status,

      finalUrl:
        page.finalUrl,

      bytes:
        page.bytes,

      detailLinkCount:
        analysis.detailLinkCount,

      uniqueDetailLinkCount:
        analysis.uniqueDetailLinkCount,

      dateLikeCount:
        analysis.dateLikeCount,

      listLikely:
        analysis.listLikely,

      sampleDetailUrls:
        analysis.sampleDetailUrls,

      reasons:
        candidate.initialReasons,

      error:
        page.error
        || null
    });
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


  let finalStatus =
    "NO_CANDIDATE";


  if (
    best
    &&
    best.httpStatus
      === 200
    &&
    best.listLikely
    &&
    best.uniqueDetailLinkCount
      >= 2
    &&
    best.finalScore
      >= 70
  ) {
    finalStatus =
      "CANDIDATE_DISCOVERED";
  }

  else if (
    best
    &&
    best.httpStatus
      === 200
    &&
    best.finalScore
      >= 40
  ) {
    finalStatus =
      "REVIEW_CANDIDATE";
  }

  else if (
    tested.length
      > 0
    &&
    tested.every(
      item =>
        item.error
    )
  ) {
    finalStatus =
      "TRANSIENT_NETWORK";
  }


  return {
    universityId:
      target.universityId,

    universityName:
      target.universityName,

    previousClass:
      target.previousClass,

    homepage:
      target.homepage,

    homepageStatus:
      homepage.status,

    homepageFinalUrl:
      homepage.finalUrl,

    homepageBytes:
      homepage.bytes,

    totalOfficialHomeLinks:
      allLinks.length,

    scoredCandidateCount:
      scored.length,

    testedCandidateCount:
      tested.length,

    requestCount,

    candidateCount:
      tested.length,

    bestCandidate:
      best,

    candidates:
      tested,

    finalStatus
  };
}


// =========================================================
// 11. Main
// =========================================================

async function main() {
  const beforeHashes =
    operationalHashes();


  const startedAt =
    new Date()
      .toISOString();


  const targets =
    buildTargets();


  const results = [];


  for (
    const target
    of targets
  ) {
    results.push(
      await discoverOne(
        target
      )
    );
  }


  const afterHashes =
    operationalHashes();


  const operationalHashUnchanged =
    hashesEqual(
      beforeHashes,
      afterHashes
    );


  if (
    !operationalHashUnchanged
  ) {
    throw new Error(
      "NO_CANDIDATE_DISCOVERY_OPERATIONAL_MUTATION_DETECTED"
    );
  }


  const counts = {};


  for (
    const row
    of results
  ) {
    counts[
      row.finalStatus
    ] =
      (
        counts[
          row.finalStatus
        ]
        || 0
      )
      + 1;
  }


  const candidateDiscovered =
    results.filter(
      row =>
        row.finalStatus
          === "CANDIDATE_DISCOVERED"
    ).length;


  const reviewCandidate =
    results.filter(
      row =>
        row.finalStatus
          === "REVIEW_CANDIDATE"
    ).length;


  const transientNetwork =
    results.filter(
      row =>
        row.finalStatus
          === "TRANSIENT_NETWORK"
    ).length;


  const unresolved =
    results.filter(
      row =>
        ![
          "CANDIDATE_DISCOVERED",
          "REVIEW_CANDIDATE"
        ].includes(
          row.finalStatus
        )
    ).length;


  const totalRequests =
    results.reduce(
      (
        total,
        row
      ) =>
        total
        +
        Number(
          row.requestCount
          || 0
        ),
      0
    );


  let decision =
    "DISCOVERY_RULES_NEED_IMPROVEMENT";


  if (
    candidateDiscovered
      > 0
  ) {
    decision =
      "VALIDATE_DISCOVERED_CANDIDATES";
  }

  else if (
    reviewCandidate
      > 0
  ) {
    decision =
      "REVIEW_DISCOVERY_CANDIDATES";
  }

  else if (
    transientNetwork
      === results.length
    &&
    results.length
      > 0
  ) {
    decision =
      "RETRY_LATER";
  }


  const report = {
    schemaVersion:
      "2.0",

    generatedAt:
      new Date()
        .toISOString(),

    startedAt,

    phase:
      "NO_CANDIDATE_DISCOVERY_PILOT",

    targetCount:
      targets.length,

    processed:
      results.length,

    totalRequests,

    candidateDiscovered,

    reviewCandidate,

    transientNetwork,

    unresolved,

    counts,

    results,

    decision,

    discoveryPolicy: {
      scoreAllHomepageLinksBeforeLimit:
        true,

      maximumFetchedCandidatesPerUniversity:
        MAX_CANDIDATES_TO_FETCH,

      officialDomainOnly:
        true,

      downloadLinksExcluded:
        true,

      uniqueDetailUrlRequired:
        true,

      excessiveDateCountCapped:
        true,

      automaticActivation:
        false
    },

    operationalHashUnchanged,

    beforeHashes,

    afterHashes,

    safety: {
      readOnly:
        true,

      maximumTargets:
        MAX_TARGETS,

      automaticActivation:
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
        false,

      tlsVerificationDisabled:
        false,

      operationalHashVerified:
        operationalHashUnchanged
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
}


// =========================================================
// 12. 실행
// =========================================================

if (
  require.main
    === module
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


// =========================================================
// 13. Export
// =========================================================

module.exports = {
  clean,
  normalizeUrl,
  sameOfficialDomain,
  extractAnchors,
  scoreCandidate,
  isDetailUrl,
  analyzeCandidatePage,
  buildTargets,
  discoverOne,
  operationalHashes,
  hashesEqual
};