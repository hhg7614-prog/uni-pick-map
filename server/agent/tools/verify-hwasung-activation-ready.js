"use strict";

/**
 * UNI PICK - HSMU Activation Readiness Verifier v1
 *
 * 목적
 * ---------------------------------------------------------
 * 화성의과학대학교 flexible collector가
 * 실제 activation 직전 조건을 만족하는지 재검증한다.
 *
 * 전제
 * ---------------------------------------------------------
 * 이전 단계:
 * hwasung-medi-science-flexible-collector-final.json
 *
 * 기대 상태:
 * decision === "COLLECTOR_READY"
 *
 * 활성화 준비 성공 기준
 * ---------------------------------------------------------
 * - 목록 HTTP 200
 * - 공식 도메인
 * - unique >= 5
 * - distinctIds >= 5
 * - distinctTitles >= 5
 * - distinctDates >= 5
 * - duplicateKeys === 0
 * - 상세 5건 검증
 * - detailPass === 5
 * - titlePass === 5
 * - datePass === 5
 * - SAME_PAGE:idx 안정
 * - 동일 sourceId 없음
 * - 동일 verified+enabled listUrl 없음
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
 *   .\server\agent\tools\verify-hwasung-activation-ready.js
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

const COLLECTOR_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-collector-final.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-activation-ready.json"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const STORE_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "data",
  "agent-news-store.json"
);

const PREVIEW_FILE = path.join(
  ROOT,
  "data",
  "university-news-preview.json"
);

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const SOURCE_ID =
  "hwasung-medi-science-general-feed";

const SOURCE_NAME =
  "화성의과학대학교 공식 소식";

const LIST_URL =
  "https://www.hsmu.ac.kr/web/contents/HSMU10102000.do";

const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_TEST_LIMIT = 5;


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


function normalizeId(value) {
  return String(value || "")
    .normalize("NFC");
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
  if (
    !fs.existsSync(
      file
    )
  ) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        file
      )
    )
    .digest("hex");
}


function operationalHashes() {
  return {
    catalog:
      sha256(
        CATALOG_FILE
      ),

    store:
      sha256(
        STORE_FILE
      ),

    preview:
      sha256(
        PREVIEW_FILE
      )
  };
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
              "Mozilla/5.0 compatible UNI-PICK HSMU Activation Verifier",

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
 * Date
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);

  const match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(
      match[1]
    );

  const month =
    Number(
      match[2]
    );

  const day =
    Number(
      match[3]
    );

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
 * List parsing
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


function extractGoViewIds(raw) {
  const ids = [];

  const pattern =
    /fn_goView\s*\(\s*["']?(\d{2,})["']?/gi;

  let match;

  while (
    (
      match =
        pattern.exec(
          raw
        )
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


function extractTitleCandidates(raw) {
  const output = [];

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


function analyzeRow(raw) {
  const ids =
    extractGoViewIds(
      raw
    );

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

  const title =
    titleCandidates[0];

  if (!title) {
    return null;
  }

  const id =
    ids[0];

  return {
    title:
      title.title,

    titleMethod:
      title.method,

    publishedAt,

    detailId:
      id,

    detailKey:
      `ID:${id}`,

    detailUrl:
      `${LIST_URL}?idx=${encodeURIComponent(id)}`
  };
}


/* =========================================================
 * Detail validation
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
  const expectedKey =
    titleKey(
      expected
    );

  const documentKey =
    titleKey(
      html
    );

  return Boolean(
    expectedKey
    &&
    documentKey.includes(
      expectedKey
    )
  );
}


function dateMatches(
  publishedAt,
  html
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
    plain(
      html
    );

  const fullYear =
    new RegExp(
      `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
    );

  const shortYear =
    new RegExp(
      `${String(year).slice(2)}\\s*[.\\-/]\\s*0?${month}\\s*[.\\-/]\\s*0?${day}`
    );

  return (
    fullYear.test(
      text
    )
    ||
    shortYear.test(
      text
    )
  );
}


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

      officialDomain:
        false,

      titleMatch:
        false,

      dateMatch:
        false,

      bodyLength:
        0,

      pass:
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
    dateMatches(
      item.publishedAt,
      page.html
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
      dateMatch
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
 * Catalog safety
 * ========================================================= */

function catalogDiagnostics(catalog) {
  const university =
    (
      catalog.universities
      || []
    ).find(
      item =>
        normalizeId(
          item.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    );

  if (!university) {
    return {
      catalogFound:
        false,

      sourceCount:
        0,

      duplicateSourceId:
        false,

      duplicateListUrl:
        false,

      duplicateVerifiedEnabledListUrl:
        false,

      existingSources:
        []
    };
  }

  const sources =
    Array.isArray(
      university.sources
    )
      ? university.sources
      : [];

  const normalizedListUrl =
    normalizeUrl(
      LIST_URL
    );

  return {
    catalogFound:
      true,

    sourceCount:
      sources.length,

    duplicateSourceId:
      sources.some(
        source =>
          source.id
          === SOURCE_ID
      ),

    duplicateListUrl:
      sources.some(
        source =>
          normalizeUrl(
            source.listUrl
          )
          === normalizedListUrl
      ),

    duplicateVerifiedEnabledListUrl:
      sources.some(
        source =>
          source.verified === true
          &&
          source.enabled === true
          &&
          normalizeUrl(
            source.listUrl
          )
          === normalizedListUrl
      ),

    existingSources:
      sources.map(
        source => ({
          id:
            source.id,

          listUrl:
            source.listUrl,

          verified:
            source.verified === true,

          enabled:
            source.enabled === true,

          status:
            source.status || null
        })
      )
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const collector =
    read(
      COLLECTOR_FILE,
      {}
    );

  if (
    collector.decision
      !== "COLLECTOR_READY"
  ) {
    throw new Error(
      "HSMU_NOT_COLLECTOR_READY"
    );
  }

  if (
    collector.route?.method
      !== "SAME_PAGE:idx"
    ||
    collector.route?.stable
      !== true
  ) {
    throw new Error(
      "HSMU_ROUTE_NOT_STABLE"
    );
  }


  const beforeHashes =
    operationalHashes();


  let requests = 0;


  /* -------------------------------------------------------
   * Catalog duplicate guard
   * ----------------------------------------------------- */

  const catalog =
    read(
      CATALOG_FILE,
      {
        universities:
          []
      }
    );

  const catalogState =
    catalogDiagnostics(
      catalog
    );


  /* -------------------------------------------------------
   * Re-fetch list
   * ----------------------------------------------------- */

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

  if (
    !officialDomain(
      list.finalUrl
    )
  ) {
    throw new Error(
      "HSMU_LIST_NON_OFFICIAL"
    );
  }


  const rows =
    extractRows(
      list.html
    );

  const extracted =
    rows
      .map(
        analyzeRow
      )
      .filter(Boolean);


  const unique =
    [
      ...new Map(
        extracted.map(
          item => [
            item.detailKey,
            item
          ]
        )
      ).values()
    ];


  const duplicateKeys =
    extracted.length
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


  /* -------------------------------------------------------
   * Detail validation
   * ----------------------------------------------------- */

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


  const validUrls =
    detailChecks.filter(
      item =>
        item.finalUrl
        &&
        officialDomain(
          item.finalUrl
        )
    ).length;


  /* -------------------------------------------------------
   * Readiness decision
   * ----------------------------------------------------- */

  const reasons = [];


  if (
    unique.length < 5
  ) {
    reasons.push(
      "UNIQUE_LT_5"
    );
  }


  if (
    distinctIds < 5
  ) {
    reasons.push(
      "DISTINCT_IDS_LT_5"
    );
  }


  if (
    distinctTitles < 5
  ) {
    reasons.push(
      "DISTINCT_TITLES_LT_5"
    );
  }


  if (
    distinctDates < 5
  ) {
    reasons.push(
      "DISTINCT_DATES_LT_5"
    );
  }


  if (
    duplicateKeys !== 0
  ) {
    reasons.push(
      "DUPLICATE_KEYS_FOUND"
    );
  }


  if (
    detailChecks.length !== 5
  ) {
    reasons.push(
      "DETAIL_TEST_COUNT_NOT_5"
    );
  }


  if (
    detailPass !== 5
  ) {
    reasons.push(
      "DETAIL_PASS_NOT_5"
    );
  }


  if (
    titlePass !== 5
  ) {
    reasons.push(
      "TITLE_PASS_NOT_5"
    );
  }


  if (
    datePass !== 5
  ) {
    reasons.push(
      "DATE_PASS_NOT_5"
    );
  }


  if (
    validUrls !== 5
  ) {
    reasons.push(
      "VALID_URL_COUNT_NOT_5"
    );
  }


  if (
    !catalogState.catalogFound
  ) {
    reasons.push(
      "CATALOG_UNIVERSITY_NOT_FOUND"
    );
  }


  if (
    catalogState.duplicateSourceId
  ) {
    reasons.push(
      "SOURCE_ID_ALREADY_EXISTS"
    );
  }


  if (
    catalogState
      .duplicateVerifiedEnabledListUrl
  ) {
    reasons.push(
      "VERIFIED_LIST_URL_ALREADY_EXISTS"
    );
  }


  const activationReady =
    reasons.length === 0;


  const decision =
    activationReady
      ? "ACTIVATION_READY"
      : "REVIEW_REQUIRED";


  const proposedActivation =
    activationReady
      ? {
          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          source: {
            id:
              SOURCE_ID,

            name:
              SOURCE_NAME,

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
                "fn_goView\\s*\\(\\s*[\"']?(\\d{2,})[\"']?",

              detailUrlTemplate:
                `${LIST_URL}?idx={id}`
            },

            verified:
              true,

            enabled:
              true,

            status:
              "awaiting_activation",

            healthStatus:
              "validated"
          }
        }
      : null;


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

    sourceId:
      SOURCE_ID,

    decision,

    activationReady,

    reasons,

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      rows:
        rows.length,

      extracted:
        extracted.length,

      unique:
        unique.length,

      duplicateKeys,

      distinctIds,

      distinctTitles,

      distinctDates
    },

    route: {
      functionName:
        "fn_goView",

      method:
        "SAME_PAGE:idx",

      urlTemplate:
        `${LIST_URL}?idx={id}`,

      stable:
        true
    },

    detailValidation: {
      tested:
        detailChecks.length,

      pass:
        detailPass,

      titlePass,

      datePass,

      validUrls,

      checks:
        detailChecks
    },

    catalog:
      catalogState,

    proposedActivation,

    nextAction:
      activationReady
        ? "ACTIVATE_HSMU_SOURCE_LOCAL"
        : "REVIEW_ACTIVATION_BLOCKERS",

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

        activationReady:
          report.activationReady,

        reasons:
          report.reasons,

        status:
          report.list.status,

        rows:
          report.list.rows,

        extracted:
          report.list.extracted,

        unique:
          report.list.unique,

        duplicateKeys:
          report.list.duplicateKeys,

        distinctIds:
          report.list.distinctIds,

        distinctTitles:
          report.list.distinctTitles,

        distinctDates:
          report.list.distinctDates,

        detailValidation: {
          tested:
            report.detailValidation.tested,

          pass:
            report.detailValidation.pass,

          titlePass:
            report.detailValidation.titlePass,

          datePass:
            report.detailValidation.datePass,

          validUrls:
            report.detailValidation.validUrls
        },

        catalog: {
          found:
            report.catalog.catalogFound,

          sourceCount:
            report.catalog.sourceCount,

          duplicateSourceId:
            report.catalog.duplicateSourceId,

          duplicateListUrl:
            report.catalog.duplicateListUrl,

          duplicateVerifiedEnabledListUrl:
            report.catalog
              .duplicateVerifiedEnabledListUrl
        },

        proposedActivation:
          report.proposedActivation,

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
  normalizeId,
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
  dateMatches,
  validateDetail,
  catalogDiagnostics,
  operationalHashes
};