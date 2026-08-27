"use strict";

/**
 * UNI PICK - HSMU Flexible Collector Finalizer v1
 *
 * 목적
 * ---------------------------------------------------------
 * 화성의과학대학교 이사회 회의공지 collector를 최종 검증한다.
 *
 * 앞 단계에서 확인된 사실
 * ---------------------------------------------------------
 * - 목록 URL:
 *   https://www.hsmu.ac.kr/web/contents/HSMU10102000.do
 *
 * - 반복 구조:
 *   TR
 *
 * - 상세 이동 함수:
 *   fn_goView(...)
 *
 * - 실제 검증 성공 규칙:
 *   HSMU10102000.do?idx=<게시물ID>
 *
 * 이번 단계 핵심
 * ---------------------------------------------------------
 * onclick HTML 속성을 일반 attribute regex로 읽지 않는다.
 * 각 TR raw HTML 전체에서 fn_goView(...) 호출을 직접 찾는다.
 *
 * 성공 기준
 * ---------------------------------------------------------
 * - uniqueIds >= 5
 * - distinctTitles >= 5
 * - distinctDates >= 5
 * - 상세 5건 테스트
 * - detailPass >= 5
 * - SAME_PAGE:idx 규칙 안정
 * - 운영 파일 hash 불변
 *
 * 안전
 * ---------------------------------------------------------
 * - catalog 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 *
 * 실행
 * ---------------------------------------------------------
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\finalize-hwasung-flexible-collector.js
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

const VALIDATION_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-source-validation.json"
);

const PREVIOUS_COLLECTOR_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-collector.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-collector-final.json"
);

const LIST_URL =
  "https://www.hsmu.ac.kr/web/contents/HSMU10102000.do";

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const SOURCE_ID =
  "hwasung-medi-science-general-feed";

const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_TEST_LIMIT = 5;


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
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}


function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const tmp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(tmp, "utf8")
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
      .replace(/&amp;/gi, "&")
      .replace(/\\&/g, "&");

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
        .replace(/^www\./, "");

    return (
      host === "hsmu.ac.kr"
      ||
      host.endsWith(".hsmu.ac.kr")
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
 * HTTP
 * ========================================================= */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect: "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK HSMU Collector Finalizer",

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
      ok: true,

      status:
        response.status,

      finalUrl:
        response.url,

      bytes:
        Buffer.byteLength(
          html,
          "utf8"
        ),

      html
    };

  } catch (error) {
    return {
      ok: false,

      status: null,

      finalUrl: null,

      bytes: 0,

      html: "",

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
    clearTimeout(timer);
  }
}


/* =========================================================
 * 날짜
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);

  let match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

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
 * 목록 TR
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


/* =========================================================
 * fn_goView ID 직접 추출
 * ========================================================= */

function extractGoViewIds(raw) {
  const ids = [];

  /*
   * 지원 예:
   *
   * fn_goView('3441')
   * fn_goView("3441")
   * fn_goView(3441)
   * fn_goView('3441', ...)
   *
   * HTML attribute 안의 quote nesting 여부와 관계없이
   * raw TR 전체에서 직접 찾는다.
   */

  const pattern =
    /fn_goView\s*\(\s*["']?(\d{2,})["']?/gi;

  let match;

  while (
    (
      match =
        pattern.exec(raw)
    )
  ) {
    ids.push(
      match[1]
    );
  }

  return [
    ...new Set(ids)
  ];
}


/* =========================================================
 * 제목 후보
 * ========================================================= */

function extractTitleCandidates(raw) {
  const output = [];

  /*
   * title attribute 우선
   */

  for (
    const match
    of raw.matchAll(
      /\btitle\s*=\s*["']([^"']{4,})["']/gi
    )
  ) {
    const title =
      plain(
        match[1]
      );

    if (title) {
      output.push({
        title,
        method:
          "TITLE_ATTRIBUTE"
      });
    }
  }


  /*
   * anchor text
   */

  for (
    const match
    of raw.matchAll(
      /<a\b[^>]*>([\s\S]*?)<\/a>/gi
    )
  ) {
    const title =
      plain(
        match[1]
      );

    if (
      title
      &&
      title.length >= 4
    ) {
      output.push({
        title,
        method:
          "ANCHOR_TEXT"
      });
    }
  }


  /*
   * 중복 제거 후 가장 긴 제목 우선
   */

  return [
    ...new Map(
      output.map(
        item => [
          item.title,
          item
        ]
      )
    ).values()
  ].sort(
    (a, b) =>
      b.title.length
      -
      a.title.length
  );
}


/* =========================================================
 * 게시물 행 분석
 * ========================================================= */

function analyzeRow(raw) {
  const ids =
    extractGoViewIds(raw);

  if (
    ids.length === 0
  ) {
    return null;
  }

  const publishedAt =
    parseDate(
      raw
    );

  if (!publishedAt) {
    return null;
  }

  const titleCandidates =
    extractTitleCandidates(
      raw
    );

  const bestTitle =
    titleCandidates[0]
    || null;

  if (!bestTitle) {
    return null;
  }

  const id =
    ids[0];

  return {
    title:
      bestTitle.title,

    titleMethod:
      bestTitle.method,

    publishedAt,

    detailId:
      id,

    detailKey:
      `ID:${id}`,

    detailUrl:
      `${LIST_URL}?idx=${encodeURIComponent(id)}`,

    routeMethod:
      "SAME_PAGE:idx",

    rowText:
      plain(raw)
        .slice(
          0,
          1000
        )
  };
}


/* =========================================================
 * 제목 비교
 * ========================================================= */

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}


function titleMatches(
  expected,
  html
) {
  const target =
    titleKey(expected);

  if (!target) {
    return false;
  }

  const document =
    titleKey(html);

  return document.includes(
    target
  );
}


/* =========================================================
 * 상세 날짜 검증
 * ========================================================= */

function detailContainsDate(
  html,
  publishedAt
) {
  if (!publishedAt) {
    return false;
  }

  const [
    year,
    month,
    day
  ] =
    publishedAt
      .split("-")
      .map(Number);

  const text =
    plain(html);

  const patterns = [
    new RegExp(
      `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
    ),

    new RegExp(
      `${String(year).slice(2)}\\s*[.\\-/]\\s*0?${month}\\s*[.\\-/]\\s*0?${day}`
    )
  ];

  return patterns.some(
    pattern =>
      pattern.test(text)
  );
}


/* =========================================================
 * 상세 검증
 * ========================================================= */

async function validateDetail(item) {
  const page =
    await fetchPage(
      item.detailUrl
    );

  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    return {
      ...item,

      status:
        page.status,

      finalUrl:
        page.finalUrl,

      pass:
        false,

      titleMatch:
        false,

      dateMatch:
        false,

      officialDomain:
        false,

      reason:
        "DETAIL_UNREACHABLE",

      error:
        page.error || null
    };
  }

  const isOfficial =
    officialDomain(
      page.finalUrl
    );

  const sameAsList =
    normalizeUrl(
      page.finalUrl
    )
    ===
    normalizeUrl(
      LIST_URL
    );

  const titleMatch =
    titleMatches(
      item.title,
      page.html
    );

  const dateMatch =
    detailContainsDate(
      page.html,
      item.publishedAt
    );

  const bodyLength =
    plain(
      page.html
    ).length;

  const pass =
    Boolean(
      isOfficial
      &&
      !sameAsList
      &&
      titleMatch
      &&
      bodyLength >= 100
    );

  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    officialDomain:
      isOfficial,

    sameAsList,

    titleMatch,

    dateMatch,

    bodyLength,

    pass,

    reason:
      pass
        ? null
        : "DETAIL_VALIDATION_FAILED"
  };
}


/* =========================================================
 * Collector source
 * ========================================================= */

function buildProposedCollector({
  unique,
  detailPass
}) {
  if (
    unique.length < 5
    ||
    detailPass < 5
  ) {
    return null;
  }

  return {
    id:
      SOURCE_ID,

    name:
      "화성의과학대학교 이사회 회의공지",

    category:
      "school_news",

    sourceType:
      "official",

    collectionType:
      "custom_html",

    listUrl:
      LIST_URL,

    campusScope:
      "CAMPUS_SPECIFIC",

    contentScope:
      "GENERAL_UNIVERSITY_UPDATES",

    parser: {
      item:
        "tbody tr",

      structure:
        "TR",

      titleStrategy:
        "TITLE_ATTRIBUTE_OR_LONGEST_ANCHOR_TEXT",

      dateStrategy:
        "VISIBLE_DATE_IN_ROW",

      detailStrategy:
        "FN_GOVIEW_ID_TO_QUERY",

      detailFunction:
        "fn_goView",

      detailIdRegex:
        "fn_goView\\\\s*\\\\(\\\\s*[\"']?(\\\\d{2,})[\"']?",

      detailUrlTemplate:
        "https://www.hsmu.ac.kr/web/contents/HSMU10102000.do?idx={id}"
    },

    verified:
      false,

    enabled:
      false,

    status:
      "collector_ready_pending_activation",

    healthStatus:
      "validated",

    autoActivate:
      false
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const validation =
    read(
      VALIDATION_FILE,
      {}
    );

  const previous =
    read(
      PREVIOUS_COLLECTOR_FILE,
      {}
    );

  if (
    validation.decision
      !== "FLEXIBLE_SOURCE_VALIDATED"
  ) {
    throw new Error(
      "HSMU_FLEXIBLE_SOURCE_NOT_VALIDATED"
    );
  }

  if (
    previous.nextAction
      !== "INSPECT_ONCLICK_FUNCTION_BODY"
  ) {
    throw new Error(
      "HSMU_PREVIOUS_COLLECTOR_STAGE_NOT_READY"
    );
  }


  const beforeHashes =
    operationalHashes();


  let requests = 0;


  requests += 1;


  const list =
    await fetchPage(
      LIST_URL
    );


  if (
    !list.ok
    ||
    list.status !== 200
  ) {
    throw new Error(
      "HSMU_LIST_UNREACHABLE"
    );
  }


  const rows =
    extractRows(
      list.html
    );


  const analyzed =
    rows
      .map(
        analyzeRow
      )
      .filter(Boolean);


  const unique =
    [
      ...new Map(
        analyzed.map(
          item => [
            item.detailKey,
            item
          ]
        )
      ).values()
    ];


  const duplicateKeys =
    analyzed.length
    -
    unique.length;


  const distinctIds =
    new Set(
      unique.map(
        item =>
          item.detailId
      )
    ).size;


  const distinctTitles =
    new Set(
      unique.map(
        item =>
          item.title
      )
    ).size;


  const distinctDates =
    new Set(
      unique.map(
        item =>
          item.publishedAt
      )
    ).size;


  /*
   * 상세 5건 검증
   */

  const detailChecks = [];


  for (
    const item
    of unique.slice(
      0,
      DETAIL_TEST_LIMIT
    )
  ) {
    requests += 1;

    detailChecks.push(
      await validateDetail(
        item
      )
    );
  }


  const detailPass =
    detailChecks.filter(
      item =>
        item.pass
    ).length;


  const titlePass =
    detailChecks.filter(
      item =>
        item.titleMatch
    ).length;


  const datePass =
    detailChecks.filter(
      item =>
        item.dateMatch
    ).length;


  const detailRuleStable =
    Boolean(
      detailChecks.length >= 5
      &&
      detailPass >= 5
    );


  const collectorReady =
    Boolean(
      unique.length >= 5
      &&
      distinctIds >= 5
      &&
      distinctTitles >= 5
      &&
      distinctDates >= 5
      &&
      duplicateKeys === 0
      &&
      detailRuleStable
    );


  const decision =
    collectorReady
      ? "COLLECTOR_READY"
      : "REVIEW_REQUIRED";


  const proposedCollector =
    collectorReady
      ? buildProposedCollector({
          unique,
          detailPass
        })
      : null;


  const nextAction =
    collectorReady
      ? "VERIFY_HSMU_ACTIVATION_READY"
      : "INSPECT_FAILED_DETAIL_SAMPLES";


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

    listUrl:
      LIST_URL,

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      rows:
        rows.length,

      bytes:
        list.bytes
    },

    extracted:
      analyzed.length,

    unique:
      unique.length,

    duplicateKeys,

    distinctIds,

    distinctTitles,

    distinctDates,

    route: {
      functionName:
        "fn_goView",

      method:
        "SAME_PAGE:idx",

      urlTemplate:
        `${LIST_URL}?idx={id}`,

      stable:
        detailRuleStable
    },

    samples:
      unique.slice(
        0,
        10
      ),

    detailValidation: {
      tested:
        detailChecks.length,

      pass:
        detailPass,

      titlePass,

      datePass,

      checks:
        detailChecks
    },

    decision,

    proposedCollector,

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

        status:
          report.list.status,

        rows:
          report.list.rows,

        extracted:
          report.extracted,

        unique:
          report.unique,

        duplicateKeys:
          report.duplicateKeys,

        distinctIds:
          report.distinctIds,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

        route:
          report.route,

        detailValidation: {
          tested:
            report.detailValidation.tested,

          pass:
            report.detailValidation.pass,

          titlePass:
            report.detailValidation.titlePass,

          datePass:
            report.detailValidation.datePass
        },

        detailSamples:
          report.detailValidation.checks.map(
            item => ({
              id:
                item.detailId,

              title:
                item.title,

              publishedAt:
                item.publishedAt,

              url:
                item.finalUrl,

              status:
                item.status,

              titleMatch:
                item.titleMatch,

              dateMatch:
                item.dateMatch,

              pass:
                item.pass
            })
          ),

        proposedCollector:
          report.proposedCollector,

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


/* =========================================================
 * Execute
 * ========================================================= */

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

      process.exitCode = 1;
    }
  );
}


/* =========================================================
 * Export
 * ========================================================= */

module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  parseDate,
  extractRows,
  extractGoViewIds,
  extractTitleCandidates,
  analyzeRow,
  titleKey,
  titleMatches,
  detailContainsDate,
  validateDetail,
  buildProposedCollector
};