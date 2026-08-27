"use strict";

/**
 * UNI PICK - Changshin Activation Readiness Verifier v1
 *
 * 목적
 * ---------------------------------------------------------
 * 창신대학교 source를 실제 Catalog 활성화 직전 재검증한다.
 *
 * 확인된 구조
 * ---------------------------------------------------------
 * list:
 * https://www.cs.ac.kr/board/bulletin
 *
 * item:
 * tbody tr
 *
 * title/link:
 * a[href^='/post/'], a[href*='/post/']
 *
 * date:
 * td.col.col5
 *
 * 중요
 * ---------------------------------------------------------
 * 기존 자동 추론값 td.col은 너무 넓으므로
 * 실제 class="col col5"에 맞춰 td.col.col5로 교정한다.
 *
 * 활성화 기준
 * ---------------------------------------------------------
 * - 공식 도메인
 * - HTTP 200
 * - 고유 게시물 >= 3
 * - 제목 >= 3
 * - URL >= 3
 * - duplicate URL = 0
 * - 상세 3건 모두 HTTP 200
 * - 제목 3/3 일치
 * - 날짜 3/3 일치
 * - sourceId 중복 없음
 * - 동일 verified+enabled listUrl 없음
 * - Catalog/Store/Preview hash 불변
 *
 * 안전
 * ---------------------------------------------------------
 * read-only
 * git/deploy 없음
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

const PREVIOUS_FILE = path.join(
  DATA,
  "changshin-selector-refinement.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "changshin-activation-ready.json"
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
  "changshin-university-본교";

const UNIVERSITY_NAME =
  "창신대학교";

const SOURCE_ID =
  "changshin-general-feed";

const LIST_URL =
  "https://www.cs.ac.kr/board/bulletin";

const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_TEST_LIMIT = 3;


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
      host === "cs.ac.kr"
      ||
      host.endsWith(
        ".cs.ac.kr"
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


function snapshotHashes() {
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
              "Mozilla/5.0 compatible UNI-PICK Changshin Activation Verifier",

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

      html:
        "",

      error: {
        name:
          error?.name || null,

        message:
          error?.message || null,

        causeCode:
          error?.cause?.code || null
      }
    };

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
 * Date
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
 * List parser
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


function extractPostAnchor(
  raw,
  baseUrl
) {
  const candidates = [];

  for (
    const match
    of raw.matchAll(
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
      )[1];

    if (!href) {
      continue;
    }

    const url =
      normalizeUrl(
        href,
        baseUrl
      );

    if (
      !url
      ||
      !officialDomain(
        url
      )
    ) {
      continue;
    }

    let pathname;

    try {
      pathname =
        new URL(url)
          .pathname;
    } catch {
      continue;
    }

    if (
      !/^\/post\/\d+\/?$/.test(
        pathname
      )
    ) {
      continue;
    }

    const titleAttribute =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1];

    const label =
      plain(
        match[2]
      );

    const title =
      plain(
        titleAttribute
        ||
        label
      );

    if (
      !title
      ||
      title.length < 4
    ) {
      continue;
    }

    candidates.push({
      title,
      url
    });
  }

  return candidates
    .sort(
      (a, b) =>
        b.title.length
        -
        a.title.length
    )[0]
    || null;
}


function extractExactDateCell(raw) {
  /*
   * 반드시 class에 col5가 포함된 td만 사용.
   *
   * class="col col5"
   * class="foo col5 bar"
   * 모두 허용
   */

  for (
    const match
    of raw.matchAll(
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const className =
      (
        attrs.match(
          /\bclass\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || "";

    const classes =
      className
        .split(/\s+/)
        .filter(Boolean);

    if (
      !classes.includes(
        "col5"
      )
    ) {
      continue;
    }

    const rawText =
      plain(
        match[2]
      );

    const publishedAt =
      parseDate(
        rawText
      );

    if (
      publishedAt
    ) {
      return {
        raw:
          rawText,

        publishedAt,

        className,

        selector:
          "td.col.col5"
      };
    }
  }

  return null;
}


function analyzeRow(
  raw,
  baseUrl
) {
  const post =
    extractPostAnchor(
      raw,
      baseUrl
    );

  if (!post) {
    return null;
  }

  const date =
    extractExactDateCell(
      raw
    );

  if (!date) {
    return null;
  }

  return {
    title:
      post.title,

    sourceUrl:
      post.url,

    detailKey:
      `URL:${post.url}`,

    publishedAt:
      date.publishedAt,

    rawDate:
      date.raw,

    dateSelector:
      date.selector
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
  expected,
  html
) {
  if (!expected) {
    return false;
  }

  const [
    year,
    month,
    day
  ] =
    expected
      .split("-")
      .map(Number);

  const text =
    plain(
      html
    );

  const pattern =
    new RegExp(
      `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
    );

  return pattern.test(
    text
  );
}


async function validateDetail(item) {
  const page =
    await fetchPage(
      item.sourceUrl
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

      titleMatch:
        false,

      dateMatch:
        false,

      pass:
        false,

      reason:
        "DETAIL_UNREACHABLE"
    };
  }

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

  const pass =
    Boolean(
      officialDomain(
        page.finalUrl
      )
      &&
      titleMatch
      &&
      dateMatch
      &&
      plain(
        page.html
      ).length >= 100
    );

  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    titleMatch,

    dateMatch,

    pass,

    reason:
      pass
      ? null
      : "DETAIL_VALIDATION_FAILED"
  };
}


/* =========================================================
 * Catalog
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
      found: false,

      sourceCount: 0,

      duplicateSourceId:
        false,

      duplicateListUrl:
        false,

      duplicateVerifiedEnabledListUrl:
        false
    };
  }

  const sources =
    Array.isArray(
      university.sources
    )
      ? university.sources
      : [];

  const normalized =
    normalizeUrl(
      LIST_URL
    );

  return {
    found:
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
          === normalized
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
          === normalized
      )
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const previous =
    read(
      PREVIOUS_FILE,
      {}
    );

  if (
    previous.decision
      !== "COLLECTOR_READY"
  ) {
    throw new Error(
      "CHANGSHIN_NOT_COLLECTOR_READY"
    );
  }

  const beforeHashes =
    snapshotHashes();

  let requests = 0;


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


  requests += 1;

  const list =
    await fetchPage(
      LIST_URL
    );

  if (
    !list.ok
    ||
    list.status !== 200
    ||
    !officialDomain(
      list.finalUrl
    )
  ) {
    throw new Error(
      "CHANGSHIN_LIST_INVALID"
    );
  }


  const rows =
    extractRows(
      list.html
    );


  const extracted =
    rows
      .map(
        raw =>
          analyzeRow(
            raw,
            list.finalUrl
          )
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


  const duplicateUrls =
    extracted.length
    -
    unique.length;


  const distinctTitles =
    new Set(
      unique.map(
        item =>
          item.title
      )
    ).size;


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


  const reasons = [];


  if (
    unique.length < 3
  ) {
    reasons.push(
      "UNIQUE_LT_3"
    );
  }


  if (
    distinctTitles < 3
  ) {
    reasons.push(
      "DISTINCT_TITLES_LT_3"
    );
  }


  if (
    duplicateUrls !== 0
  ) {
    reasons.push(
      "DUPLICATE_URLS"
    );
  }


  if (
    detailChecks.length < 3
  ) {
    reasons.push(
      "DETAIL_TEST_LT_3"
    );
  }


  if (
    detailPass
    !==
    detailChecks.length
  ) {
    reasons.push(
      "DETAIL_PASS_INCOMPLETE"
    );
  }


  if (
    titlePass
    !==
    detailChecks.length
  ) {
    reasons.push(
      "TITLE_PASS_INCOMPLETE"
    );
  }


  if (
    datePass
    !==
    detailChecks.length
  ) {
    reasons.push(
      "DATE_PASS_INCOMPLETE"
    );
  }


  if (
    !catalogState.found
  ) {
    reasons.push(
      "CATALOG_ENTRY_NOT_FOUND"
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
              "창신대학교 공식 소식",

            category:
              "school_news",

            sourceType:
              "official",

            collectionType:
              "html",

            listUrl:
              LIST_URL,

            campusScope:
              "CAMPUS_SPECIFIC",

            contentScope:
              "GENERAL_UNIVERSITY_UPDATES",

            selectors: {
              item:
                "tbody tr",

              title:
                "a[href^='/post/'], a[href*='/post/']",

              link:
                "a[href^='/post/'], a[href*='/post/']",

              linkAttribute:
                "href",

              date:
                "td.col.col5"
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
    snapshotHashes();


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

    decision:
      activationReady
      ? "ACTIVATION_READY"
      : "REVIEW_REQUIRED",

    activationReady,

    reasons,

    list: {
      status:
        list.status,

      rows:
        rows.length,

      extracted:
        extracted.length,

      unique:
        unique.length,

      duplicateUrls,

      distinctTitles
    },

    selectorCorrection: {
      previous:
        "td.col",

      corrected:
        "td.col.col5",

      reason:
        "실제 날짜 셀 class가 'col col5'이므로 더 구체적인 selector를 사용합니다."
    },

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

    catalog:
      catalogState,

    proposedActivation,

    nextAction:
      activationReady
      ? "ACTIVATE_CHANGSHIN_SOURCE_LOCAL"
      : "REVIEW_CHANGSHIN_ACTIVATION_BLOCKERS",

    requests,

    operationalHashUnchanged:
      hashSafe,

    safety: {
      readOnly: true,

      sourceModified: false,

      storeModified: false,

      previewModified: false,

      queueModified: false,

      gitTriggered: false,

      deploymentTriggered: false
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

        list:
          report.list,

        selectorCorrection:
          report.selectorCorrection,

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

        catalog:
          report.catalog,

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


module.exports = {
  normalizeId,
  plain,
  normalizeUrl,
  officialDomain,
  parseDate,
  extractRows,
  extractPostAnchor,
  extractExactDateCell,
  analyzeRow,
  titleKey,
  titleMatches,
  dateMatches,
  validateDetail,
  catalogDiagnostics,
  snapshotHashes
};