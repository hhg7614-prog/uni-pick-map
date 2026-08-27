"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ============================================================
// 1. 기본 설정
// ============================================================

const ROOT =
  path.resolve(
    __dirname,
    "..",
    "..",
    ".."
  );

const CATALOG_FILE =
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-sources.final.json"
  );

const UNIVERSITY_IDS = [
  "inje-university-본교",
  "inje-university-제2캠퍼"
];

const UNIVERSITY_NAMES = [
  "인제대학교",
  "인제대학교 제2캠퍼"
];

const CANONICAL_OWNER =
  "inje-university-본교";

const SOURCE_ID =
  "inje-shared-general-feed";

const SOURCE_NAME =
  "인제대학교 공통 소식";

const LIST_URL =
  "https://scsc.inje.ac.kr/scsc/community/news.do?mode=list";

const MAX_DETAIL_TESTS =
  5;

// ============================================================
// 2. 공통 유틸
// ============================================================

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(value) {
  return decodeHtml(
    String(value || "")
      .replace(
        /<script\b[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style\b[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<br\s*\/?>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return stripTags(value)
    .normalize("NFC")
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value).trim()
      );

    url.hash = "";

    return url.href;
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  const match =
    String(value || "").match(
      /\b(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/
    );

  if (!match) {
    return null;
  }

  return (
    match[1]
    + "-"
    + String(match[2]).padStart(2, "0")
    + "-"
    + String(match[3]).padStart(2, "0")
  );
}

function extractArticleNo(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        value,
        LIST_URL
      );

    const articleNo =
      url.searchParams.get(
        "articleNo"
      );

    return /^\d+$/.test(
      articleNo || ""
    )
      ? articleNo
      : null;
  } catch {
    const match =
      String(value).match(
        /[?&]articleNo=(\d+)/i
      );

    return match
      ? match[1]
      : null;
  }
}

function officialInjeDomain(url) {
  if (!url) {
    return false;
  }

  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase();

    return (
      host === "inje.ac.kr"
      ||
      host.endsWith(".inje.ac.kr")
    );
  } catch {
    return false;
  }
}

// ============================================================
// 3. JSON 읽기
// ============================================================

function readJson(file) {
  const raw =
    fs.readFileSync(
      file,
      "utf8"
    );

  return JSON.parse(
    raw.replace(
      /^\uFEFF/,
      ""
    )
  );
}

// ============================================================
// 4. Catalog 탐색
// ============================================================

function collectUniversityEntries(
  node,
  results = []
) {
  if (
    !node
    ||
    typeof node !== "object"
  ) {
    return results;
  }

  if (Array.isArray(node)) {
    for (
      const child
      of node
    ) {
      collectUniversityEntries(
        child,
        results
      );
    }

    return results;
  }

  const candidateId =
    normalizeText(
      node.universityId
      ||
      node.id
    );

  if (
    UNIVERSITY_IDS.some(
      id =>
        normalizeText(id)
        === candidateId
    )
  ) {
    results.push(node);
  }

  for (
    const value
    of Object.values(node)
  ) {
    if (
      value
      &&
      typeof value === "object"
    ) {
      collectUniversityEntries(
        value,
        results
      );
    }
  }

  return results;
}

function collectAllSources(
  node,
  results = []
) {
  if (
    !node
    ||
    typeof node !== "object"
  ) {
    return results;
  }

  if (Array.isArray(node)) {
    for (
      const child
      of node
    ) {
      collectAllSources(
        child,
        results
      );
    }

    return results;
  }

  if (
    typeof node.id === "string"
    &&
    (
      node.listUrl
      ||
      node.url
      ||
      node.collectionType
    )
  ) {
    results.push(node);
  }

  for (
    const value
    of Object.values(node)
  ) {
    if (
      value
      &&
      typeof value === "object"
    ) {
      collectAllSources(
        value,
        results
      );
    }
  }

  return results;
}

function extractSourcesFromUniversity(
  university
) {
  if (!university) {
    return [];
  }

  const candidates = [
    university.sources,
    university.newsSources,
    university.collectors,
    university.feeds
  ];

  for (
    const candidate
    of candidates
  ) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

// ============================================================
// 5. 네트워크 요청
// ============================================================

function fetchPage(url) {
  try {
    const output =
      execFileSync(
        "curl.exe",
        [
          "-L",
          "--max-redirs",
          "10",

          "--connect-timeout",
          "20",

          "--max-time",
          "40",

          "--silent",
          "--show-error",

          "--compressed",

          "--user-agent",
          "Mozilla/5.0 UNI-PICK Inje Shared Activation Validator",

          "--header",
          "Accept: text/html,application/xhtml+xml",

          "--header",
          "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

          "--write-out",
          "\n__UNI_PICK_STATUS__:%{http_code}\n__UNI_PICK_URL__:%{url_effective}",

          url
        ],
        {
          encoding:
            "utf8",

          windowsHide:
            true,

          maxBuffer:
            20 * 1024 * 1024
        }
      );

    const statusMatch =
      output.match(
        /\n__UNI_PICK_STATUS__:(\d{3})/
      );

    const finalUrlMatch =
      output.match(
        /\n__UNI_PICK_URL__:(.+)$/s
      );

    const body =
      output.replace(
        /\n__UNI_PICK_STATUS__:\d{3}\n__UNI_PICK_URL__:.+$/s,
        ""
      );

    const status =
      statusMatch
        ? Number(
            statusMatch[1]
          )
        : 0;

    const finalUrl =
      finalUrlMatch
        ? finalUrlMatch[1].trim()
        : url;

    return {
      ok:
        status >= 200
        &&
        status < 400
        &&
        body.length > 0,

      status,

      finalUrl,

      bytes:
        Buffer.byteLength(
          body,
          "utf8"
        ),

      body,

      error:
        null
    };
  } catch (error) {
    return {
      ok:
        false,

      status:
        0,

      finalUrl:
        null,

      bytes:
        0,

      body:
        "",

      error:
        error?.stderr
          ? String(
              error.stderr
            )
          : (
              error?.message
              || String(error)
            )
    };
  }
}

// ============================================================
// 6. Collector 재검증
// ============================================================

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}

function parseRow(rowHtml) {
  const titleCell =
    rowHtml.match(
      /<td\b[^>]*class=["'][^"']*\bb-td-title\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );

  if (!titleCell) {
    return null;
  }

  const anchor =
    titleCell[1].match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );

  if (!anchor) {
    return null;
  }

  const href =
    decodeHtml(
      anchor[1]
    );

  const title =
    stripTags(
      anchor[2]
    );

  let detailUrl;

  try {
    detailUrl =
      new URL(
        href,
        LIST_URL
      ).href;
  } catch {
    return null;
  }

  const articleNo =
    extractArticleNo(
      detailUrl
    );

  if (
    !articleNo
    ||
    !title
  ) {
    return null;
  }

  let publishedAt =
    null;

  const cells =
    [
      ...rowHtml.matchAll(
        /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      )
    ];

  for (
    const cell
    of cells
  ) {
    const date =
      normalizeDate(
        stripTags(
          cell[1]
        )
      );

    if (date) {
      publishedAt =
        date;

      break;
    }
  }

  if (!publishedAt) {
    const mobile =
      rowHtml.match(
        /<span\b[^>]*class=["'][^"']*\bb-date\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      );

    if (mobile) {
      publishedAt =
        normalizeDate(
          stripTags(
            mobile[1]
          )
        );
    }
  }

  if (!publishedAt) {
    return null;
  }

  return {
    articleNo,

    title,

    publishedAt,

    detailUrl,

    detailKey:
      `ARTICLE_NO:${articleNo}`
  };
}

function detailContainsTitle(
  html,
  expectedTitle
) {
  const expected =
    normalizeComparable(
      expectedTitle
    );

  const documentText =
    normalizeComparable(
      html
    );

  if (
    !expected
    ||
    !documentText
  ) {
    return false;
  }

  if (
    documentText.includes(
      expected
    )
  ) {
    return true;
  }

  if (
    expected.length > 25
  ) {
    const shortened =
      expected.slice(
        0,
        Math.floor(
          expected.length * 0.7
        )
      );

    return documentText.includes(
      shortened
    );
  }

  return false;
}

function detailContainsDate(
  html,
  expectedDate
) {
  const [
    year,
    month,
    day
  ] =
    expectedDate
      .split("-")
      .map(Number);

  if (
    !year
    ||
    !month
    ||
    !day
  ) {
    return false;
  }

  const text =
    stripTags(
      html
    );

  const variants = [
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`,
    `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
    `${year}-${month}-${day}`,
    `${year}.${month}.${day}`,
    `${year}/${month}/${day}`
  ];

  return variants.some(
    value =>
      text.includes(value)
  );
}

function validateCollector() {
  const list =
    fetchPage(
      LIST_URL
    );

  if (
    !list.ok
    ||
    list.status !== 200
    ||
    !officialInjeDomain(
      list.finalUrl
    )
  ) {
    return {
      success:
        false,

      list,

      rawRows:
        0,

      extracted:
        [],

      unique:
        [],

      duplicateKeys:
        0,

      distinctTitles:
        0,

      distinctDates:
        0,

      detailValidation: {
        tested:
          0,

        pass:
          0,

        titlePass:
          0,

        datePass:
          0,

        validUrls:
          0
      },

      detailSamples:
        []
    };
  }

  const rawRows =
    extractRows(
      list.body
    );

  const extracted =
    rawRows
      .map(
        row =>
          parseRow(
            row
          )
      )
      .filter(Boolean);

  const uniqueMap =
    new Map();

  let duplicateKeys =
    0;

  for (
    const item
    of extracted
  ) {
    if (
      uniqueMap.has(
        item.detailKey
      )
    ) {
      duplicateKeys +=
        1;

      continue;
    }

    uniqueMap.set(
      item.detailKey,
      item
    );
  }

  const unique =
    [
      ...uniqueMap.values()
    ];

  const detailSamples = [];

  for (
    const item
    of unique.slice(
      0,
      MAX_DETAIL_TESTS
    )
  ) {
    const detail =
      fetchPage(
        item.detailUrl
      );

    const validUrl =
      Boolean(
        detail.ok
        &&
        detail.status >= 200
        &&
        detail.status < 400
        &&
        officialInjeDomain(
          detail.finalUrl
        )
      );

    const titleMatch =
      Boolean(
        validUrl
        &&
        detailContainsTitle(
          detail.body,
          item.title
        )
      );

    const dateMatch =
      Boolean(
        validUrl
        &&
        detailContainsDate(
          detail.body,
          item.publishedAt
        )
      );

    detailSamples.push({
      articleNo:
        item.articleNo,

      title:
        item.title,

      publishedAt:
        item.publishedAt,

      url:
        item.detailUrl,

      status:
        detail.status,

      finalUrl:
        detail.finalUrl,

      validUrl,

      titleMatch,

      dateMatch,

      pass:
        Boolean(
          validUrl
          &&
          titleMatch
          &&
          dateMatch
        ),

      error:
        detail.error
    });
  }

  const detailValidation = {
    tested:
      detailSamples.length,

    pass:
      detailSamples.filter(
        item =>
          item.pass
      ).length,

    titlePass:
      detailSamples.filter(
        item =>
          item.titleMatch
      ).length,

    datePass:
      detailSamples.filter(
        item =>
          item.dateMatch
      ).length,

    validUrls:
      detailSamples.filter(
        item =>
          item.validUrl
      ).length
  };

  const distinctTitles =
    new Set(
      unique.map(
        item =>
          normalizeComparable(
            item.title
          )
      )
    ).size;

  const distinctDates =
    new Set(
      unique.map(
        item =>
          item.publishedAt
      )
    ).size;

  const success =
    Boolean(
      rawRows.length >= 10
      &&
      extracted.length >= 10
      &&
      unique.length >= 10
      &&
      duplicateKeys === 0
      &&
      distinctTitles >= 10
      &&
      distinctDates >= 5
      &&
      detailValidation.tested === 5
      &&
      detailValidation.pass === 5
      &&
      detailValidation.titlePass === 5
      &&
      detailValidation.datePass === 5
      &&
      detailValidation.validUrls === 5
    );

  return {
    success,

    list,

    rawRows:
      rawRows.length,

    extracted,

    unique,

    duplicateKeys,

    distinctTitles,

    distinctDates,

    detailValidation,

    detailSamples
  };
}

// ============================================================
// 7. SHARED_SOURCE 정책 검사
// ============================================================

function validateSharedSourcePolicy(
  catalog
) {
  const universityEntries =
    collectUniversityEntries(
      catalog
    );

  const byId =
    new Map();

  for (
    const item
    of universityEntries
  ) {
    const id =
      normalizeText(
        item.universityId
        ||
        item.id
      );

    if (id) {
      byId.set(
        id,
        item
      );
    }
  }

  const owner =
    byId.get(
      normalizeText(
        CANONICAL_OWNER
      )
    )
    || null;

  const secondCampus =
    byId.get(
      normalizeText(
        "inje-university-제2캠퍼"
      )
    )
    || null;

  const ownerSources =
    extractSourcesFromUniversity(
      owner
    );

  const secondSources =
    extractSourcesFromUniversity(
      secondCampus
    );

  const allSources =
    collectAllSources(
      catalog
    );

  const normalizedListUrl =
    normalizeUrl(
      LIST_URL
    );

  const sourceIdMatches =
    allSources.filter(
      source =>
        normalizeText(
          source.id
        )
        === normalizeText(
          SOURCE_ID
        )
    );

  const listUrlMatches =
    allSources.filter(
      source =>
        normalizeUrl(
          source.listUrl
          ||
          source.url
        )
        === normalizedListUrl
    );

  const ownerHasDuplicateId =
    ownerSources.some(
      source =>
        normalizeText(
          source.id
        )
        === normalizeText(
          SOURCE_ID
        )
    );

  const secondCampusHasDuplicateId =
    secondSources.some(
      source =>
        normalizeText(
          source.id
        )
        === normalizeText(
          SOURCE_ID
        )
    );

  return {
    ownerFound:
      Boolean(owner),

    secondCampusFound:
      Boolean(secondCampus),

    ownerSourceCount:
      ownerSources.length,

    secondCampusSourceCount:
      secondSources.length,

    globalDuplicateSourceId:
      sourceIdMatches.length > 0,

    globalDuplicateSourceIdCount:
      sourceIdMatches.length,

    duplicateListUrl:
      listUrlMatches.length > 0,

    duplicateListUrlCount:
      listUrlMatches.length,

    ownerHasDuplicateId,

    secondCampusHasDuplicateId,

    duplicateStorageDetected:
      Boolean(
        ownerHasDuplicateId
        &&
        secondCampusHasDuplicateId
      )
  };
}

// ============================================================
// 8. 메인
// ============================================================

function main() {
  if (
    !fs.existsSync(
      CATALOG_FILE
    )
  ) {
    throw new Error(
      `CATALOG_FILE_NOT_FOUND:${CATALOG_FILE}`
    );
  }

  const catalog =
    readJson(
      CATALOG_FILE
    );

  const collector =
    validateCollector();

  const sharedPolicy =
    validateSharedSourcePolicy(
      catalog
    );

  const reasons = [];

  if (!collector.success) {
    reasons.push(
      "COLLECTOR_VALIDATION_FAILED"
    );
  }

  if (
    !sharedPolicy.ownerFound
  ) {
    reasons.push(
      "CANONICAL_OWNER_NOT_FOUND"
    );
  }

  if (
    !sharedPolicy.secondCampusFound
  ) {
    reasons.push(
      "SECOND_CAMPUS_NOT_FOUND"
    );
  }

  if (
    sharedPolicy.globalDuplicateSourceId
  ) {
    reasons.push(
      "DUPLICATE_SOURCE_ID"
    );
  }

  if (
    sharedPolicy.duplicateListUrl
  ) {
    reasons.push(
      "DUPLICATE_LIST_URL"
    );
  }

  if (
    sharedPolicy.duplicateStorageDetected
  ) {
    reasons.push(
      "SHARED_SOURCE_DUPLICATE_STORAGE_DETECTED"
    );
  }

  const activationReady =
    reasons.length === 0;

  const proposedActivation =
    activationReady
      ? {
          canonicalOwner:
            CANONICAL_OWNER,

          visibleToCampuses:
            UNIVERSITY_IDS,

          duplicateStorage:
            false,

          collectOnce:
            true,

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
              "SHARED_SOURCE",

            contentScope:
              "GENERAL_UNIVERSITY_UPDATES",

            canonicalOwner:
              CANONICAL_OWNER,

            visibleToCampuses:
              UNIVERSITY_IDS,

            duplicateStorage:
              false,

            collectOnce:
              true,

            parser: {
              itemStrategy:
                "BOARD_TABLE_TR_WITH_ARTICLE_NO",

              itemSelector:
                "table.board-table tbody tr",

              titleStrategy:
                "B_TD_TITLE_ANCHOR",

              titleSelector:
                "td.b-td-title a",

              dateStrategy:
                "ROW_DATE_CELL_WITH_MOBILE_FALLBACK",

              dateSelector:
                "td:nth-of-type(4)",

              mobileDateSelector:
                "span.b-date",

              detailStrategy:
                "MODE_VIEW_ARTICLE_NO",

              detailIdParameter:
                "articleNo",

              dedupeKey:
                "ARTICLE_NO"
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

  const result = {
    decision:
      activationReady
        ? "ACTIVATION_READY"
        : "ACTIVATION_REVIEW_REQUIRED",

    activationReady,

    reasons,

    universityIds:
      UNIVERSITY_IDS,

    universityNames:
      UNIVERSITY_NAMES,

    canonicalOwner:
      CANONICAL_OWNER,

    collector: {
      decision:
        collector.success
          ? "COLLECTOR_READY"
          : "COLLECTOR_REVIEW_REQUIRED",

      status:
        collector.list.status,

      finalUrl:
        collector.list.finalUrl,

      rawRows:
        collector.rawRows,

      extracted:
        collector.extracted.length,

      unique:
        collector.unique.length,

      duplicateKeys:
        collector.duplicateKeys,

      distinctTitles:
        collector.distinctTitles,

      distinctDates:
        collector.distinctDates
    },

    detailValidation:
      collector.detailValidation,

    sharedSourcePolicy: {
      campusScope:
        "SHARED_SOURCE",

      canonicalOwner:
        CANONICAL_OWNER,

      visibleToCampuses:
        UNIVERSITY_IDS,

      collectOnce:
        true,

      duplicateStorage:
        false,

      catalogCheck:
        sharedPolicy
    },

    proposedActivation,

    nextAction:
      activationReady
        ? "ACTIVATE_INJE_SHARED_SOURCE_LOCAL"
        : "REVIEW_INJE_SHARED_SOURCE_ACTIVATION_BLOCKERS",

    hashSafe:
      true,

    safety: {
      readOnly:
        true,

      automaticActivation:
        false,

      automaticSourceMutation:
        false,

      sourceModified:
        false,

      catalogModified:
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

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (!activationReady) {
    process.exitCode =
      2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        decision:
          "ACTIVATION_CHECK_ERROR",

        activationReady:
          false,

        universityIds:
          UNIVERSITY_IDS,

        universityNames:
          UNIVERSITY_NAMES,

        canonicalOwner:
          CANONICAL_OWNER,

        error: {
          name:
            error?.name
            || "Error",

          message:
            error?.message
            || String(error)
        },

        hashSafe:
          true,

        safety: {
          readOnly:
            true,

          automaticActivation:
            false,

          automaticSourceMutation:
            false,

          sourceModified:
            false,

          catalogModified:
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
      },
      null,
      2
    )
  );

  process.exitCode =
    1;
}