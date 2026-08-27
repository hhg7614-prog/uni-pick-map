"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

// ============================================================
// 1. 기본 경로 / 정책
// ============================================================

const ROOT =
  path.resolve(
    __dirname,
    "..",
    "..",
    ".."
  );

const DATA_DIR =
  path.join(
    ROOT,
    "server",
    "agent",
    "data"
  );

const CATALOG_FILE =
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-sources.final.json"
  );

const STORE_FILE =
  path.join(
    ROOT,
    "server",
    "agent",
    "data",
    "agent-news-store.json"
  );

const PREVIEW_FILE =
  path.join(
    ROOT,
    "data",
    "university-news-preview.json"
  );

const OUTPUT_FILE =
  path.join(
    DATA_DIR,
    "inje-shared-source-activation.json"
  );

const BACKUP_ROOT =
  path.join(
    ROOT,
    "server",
    "agent",
    "backups",
    "inje-shared-source-activation"
  );

const OWNER_ID =
  "inje-university-본교";

const SECOND_CAMPUS_ID =
  "inje-university-제2캠퍼";

const VISIBLE_TO_CAMPUSES = [
  OWNER_ID,
  SECOND_CAMPUS_ID
];

const SOURCE_ID =
  "inje-shared-general-feed";

const SOURCE_NAME =
  "인제대학교 공통 소식";

const LIST_URL =
  "https://scsc.inje.ac.kr/scsc/community/news.do?mode=list";

const DETAIL_TEST_LIMIT =
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

function officialInjeDomain(value) {
  if (!value) {
    return false;
  }

  try {
    const host =
      new URL(value)
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
// 3. JSON / Atomic write
// ============================================================

function readJson(
  file,
  fallback = null
) {
  try {
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
  } catch {
    return fallback;
  }
}

function atomicWriteJson(
  file,
  value
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true
    }
  );

  const tempFile =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      value,
      null,
      2
    )
    + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      tempFile,
      "utf8"
    )
  );

  fs.renameSync(
    tempFile,
    file
  );
}

// ============================================================
// 4. Hash / Backup / Rollback
// ============================================================

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

function makeBackup() {
  const stamp =
    new Date()
      .toISOString()
      .replace(
        /[-:.TZ]/g,
        ""
      )
      .slice(
        0,
        14
      );

  const backupDir =
    path.join(
      BACKUP_ROOT,
      stamp
    );

  fs.mkdirSync(
    backupDir,
    {
      recursive:
        true
    }
  );

  for (
    const file
    of [
      CATALOG_FILE,
      STORE_FILE,
      PREVIEW_FILE
    ]
  ) {
    if (
      fs.existsSync(file)
    ) {
      fs.copyFileSync(
        file,
        path.join(
          backupDir,
          path.basename(file)
        )
      );
    }
  }

  return backupDir;
}

function rollback(
  backupDir
) {
  for (
    const destination
    of [
      CATALOG_FILE,
      STORE_FILE,
      PREVIEW_FILE
    ]
  ) {
    const source =
      path.join(
        backupDir,
        path.basename(
          destination
        )
      );

    if (
      fs.existsSync(source)
    ) {
      fs.copyFileSync(
        source,
        destination
      );
    }
  }
}

// ============================================================
// 5. Catalog 탐색
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

  const id =
    normalizeText(
      node.universityId
      ||
      node.id
    );

  if (
    id === normalizeText(
      OWNER_ID
    )
    ||
    id === normalizeText(
      SECOND_CAMPUS_ID
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

function findUniversity(
  catalog,
  universityId
) {
  const matches =
    collectUniversityEntries(
      catalog
    );

  return (
    matches.find(
      item =>
        normalizeText(
          item.universityId
          ||
          item.id
        )
        === normalizeText(
          universityId
        )
    )
    ||
    null
  );
}

function extractSources(
  university
) {
  if (!university) {
    return [];
  }

  for (
    const candidate
    of [
      university.sources,
      university.newsSources,
      university.collectors,
      university.feeds
    ]
  ) {
    if (
      Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return [];
}

function ensureSourceArray(
  university
) {
  if (
    Array.isArray(
      university.sources
    )
  ) {
    return university.sources;
  }

  if (
    Array.isArray(
      university.newsSources
    )
  ) {
    return university.newsSources;
  }

  if (
    Array.isArray(
      university.collectors
    )
  ) {
    return university.collectors;
  }

  if (
    Array.isArray(
      university.feeds
    )
  ) {
    return university.feeds;
  }

  university.sources =
    [];

  return university.sources;
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

// ============================================================
// 6. curl HTML 요청
// ============================================================

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
        "40",

        "--silent",
        "--show-error",

        "--compressed",

        "-A",
        "Mozilla/5.0 UNI-PICK Inje Shared Source Activator",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__META__%{http_code}|%{url_effective}",

        url
      ],
      {
        encoding:
          "utf8",

        timeout:
          45000,

        windowsHide:
          true,

        maxBuffer:
          25 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok:
        false,

      status:
        null,

      finalUrl:
        null,

      html:
        "",

      error:
        result.error.message
    };
  }

  const stdout =
    String(
      result.stdout
      ||
      ""
    );

  const marker =
    "\n__META__";

  const markerIndex =
    stdout.lastIndexOf(
      marker
    );

  if (
    markerIndex < 0
  ) {
    return {
      ok:
        false,

      status:
        null,

      finalUrl:
        null,

      html:
        stdout,

      error:
        "META_MARKER_MISSING"
    };
  }

  const html =
    stdout.slice(
      0,
      markerIndex
    );

  const meta =
    stdout
      .slice(
        markerIndex
        +
        marker.length
      )
      .trim();

  const [
    rawStatus,
    finalUrl
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
      status < 400
      &&
      html.length > 0,

    status,

    finalUrl,

    html,

    error:
      result.status === 0
        ? null
        : String(
            result.stderr
            ||
            ""
          )
  };
}

// ============================================================
// 7. 인제 게시판 Collector
// ============================================================

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    ||
    []
  );
}

function parseRow(
  rowHtml,
  baseUrl
) {
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
        baseUrl
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

  const mode =
    (() => {
      try {
        return (
          new URL(
            detailUrl
          )
            .searchParams
            .get("mode")
          ||
          ""
        );
      } catch {
        return "";
      }
    })();

  if (
    mode !== "view"
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

  if (
    cells.length >= 4
  ) {
    publishedAt =
      normalizeDate(
        stripTags(
          cells[3][1]
        )
      );
  }

  if (!publishedAt) {
    const mobileDate =
      rowHtml.match(
        /<span\b[^>]*class=["'][^"']*\bb-date\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      );

    if (mobileDate) {
      publishedAt =
        normalizeDate(
          stripTags(
            mobileDate[1]
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

function titleMatches(
  expectedTitle,
  html
) {
  const expected =
    normalizeComparable(
      expectedTitle
    );

  const page =
    normalizeComparable(
      html
    );

  if (
    !expected
    ||
    !page
  ) {
    return false;
  }

  if (
    page.includes(
      expected
    )
  ) {
    return true;
  }

  if (
    expected.length >= 25
  ) {
    const partial =
      expected.slice(
        0,
        Math.floor(
          expected.length
          *
          0.7
        )
      );

    return page.includes(
      partial
    );
  }

  return false;
}

function dateMatches(
  expectedDate,
  html
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

  const mm =
    String(month)
      .padStart(
        2,
        "0"
      );

  const dd =
    String(day)
      .padStart(
        2,
        "0"
      );

  const variants = [
    `${year}-${mm}-${dd}`,
    `${year}.${mm}.${dd}`,
    `${year}/${mm}/${dd}`,
    `${year}-${month}-${day}`,
    `${year}.${month}.${day}`,
    `${year}/${month}/${day}`
  ];

  return variants.some(
    value =>
      text.includes(value)
  );
}

function validateDetail(
  item
) {
  const page =
    curlPage(
      item.detailUrl
    );

  const validUrl =
    Boolean(
      page.ok
      &&
      page.status >= 200
      &&
      page.status < 400
      &&
      officialInjeDomain(
        page.finalUrl
      )
    );

  const titleMatch =
    Boolean(
      validUrl
      &&
      titleMatches(
        item.title,
        page.html
      )
    );

  const dateMatch =
    Boolean(
      validUrl
      &&
      dateMatches(
        item.publishedAt,
        page.html
      )
    );

  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

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
      page.error
  };
}

function runDryValidation() {
  const list =
    curlPage(
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

      status:
        list.status,

      finalUrl:
        list.finalUrl,

      rawRows:
        0,

      extracted:
        0,

      unique:
        0,

      duplicateKeys:
        0,

      distinctTitles:
        0,

      distinctDates:
        0,

      detailTested:
        0,

      detailPass:
        0,

      titlePass:
        0,

      datePass:
        0,

      validUrls:
        0,

      error:
        list.error
    };
  }

  const rawRows =
    extractRows(
      list.html
    );

  const extracted =
    rawRows
      .map(
        row =>
          parseRow(
            row,
            list.finalUrl
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

  const detailResults =
    unique
      .slice(
        0,
        DETAIL_TEST_LIMIT
      )
      .map(
        validateDetail
      );

  const detailPass =
    detailResults.filter(
      item =>
        item.pass
    ).length;

  const titlePass =
    detailResults.filter(
      item =>
        item.titleMatch
    ).length;

  const datePass =
    detailResults.filter(
      item =>
        item.dateMatch
    ).length;

  const validUrls =
    detailResults.filter(
      item =>
        item.validUrl
    ).length;

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
      detailResults.length === 5
      &&
      detailPass === 5
      &&
      titlePass === 5
      &&
      datePass === 5
      &&
      validUrls === 5
    );

  return {
    success,

    status:
      list.status,

    finalUrl:
      list.finalUrl,

    rawRows:
      rawRows.length,

    extracted:
      extracted.length,

    unique:
      unique.length,

    duplicateKeys,

    distinctTitles,

    distinctDates,

    detailTested:
      detailResults.length,

    detailPass,

    titlePass,

    datePass,

    validUrls,

    detailSamples:
      detailResults
  };
}

// ============================================================
// 8. npm test
// ============================================================

function runTests() {
  const result =
    spawnSync(
      "npm",
      [
        "test"
      ],
      {
        cwd:
          ROOT,

        encoding:
          "utf8",

        timeout:
          120000,

        shell:
          process.platform
          ===
          "win32",

        windowsHide:
          true
      }
    );

  return {
    exitCode:
      result.status,

    stdout:
      String(
        result.stdout
        ||
        ""
      ).slice(
        -10000
      ),

    stderr:
      String(
        result.stderr
        ||
        ""
      ).slice(
        -5000
      )
  };
}

// ============================================================
// 9. 활성화
// ============================================================

function main() {
  const result = {
    status:
      "STARTED",

    sourceAdded:
      false,

    ownerOnly:
      false,

    secondCampusSourceAdded:
      false,

    sharedSourcePolicy: {
      campusScope:
        "SHARED_SOURCE",

      canonicalOwner:
        OWNER_ID,

      visibleToCampuses:
        VISIBLE_TO_CAMPUSES,

      collectOnce:
        true,

      duplicateStorage:
        false
    },

    dryRun:
      null,

    tests:
      null,

    rollback:
      false,

    backup:
      null,

    beforeHashes:
      null,

    afterHashes:
      null,

    error:
      null
  };

  try {
    if (
      !fs.existsSync(
        CATALOG_FILE
      )
    ) {
      throw new Error(
        "CATALOG_FILE_NOT_FOUND"
      );
    }

    const catalogBefore =
      readJson(
        CATALOG_FILE
      );

    if (!catalogBefore) {
      throw new Error(
        "CATALOG_READ_FAILED"
      );
    }

    const ownerBefore =
      findUniversity(
        catalogBefore,
        OWNER_ID
      );

    const secondBefore =
      findUniversity(
        catalogBefore,
        SECOND_CAMPUS_ID
      );

    if (!ownerBefore) {
      throw new Error(
        "CANONICAL_OWNER_NOT_FOUND"
      );
    }

    if (!secondBefore) {
      throw new Error(
        "SECOND_CAMPUS_NOT_FOUND"
      );
    }

    const allSourcesBefore =
      collectAllSources(
        catalogBefore
      );

    if (
      allSourcesBefore.some(
        source =>
          normalizeText(
            source.id
          )
          === normalizeText(
            SOURCE_ID
          )
      )
    ) {
      throw new Error(
        "SOURCE_ID_ALREADY_EXISTS"
      );
    }

    if (
      allSourcesBefore.some(
        source =>
          normalizeUrl(
            source.listUrl
            ||
            source.url
          )
          === normalizeUrl(
            LIST_URL
          )
      )
    ) {
      throw new Error(
        "LIST_URL_ALREADY_EXISTS"
      );
    }

    result.beforeHashes =
      snapshotHashes();

    result.backup =
      makeBackup();

    const catalog =
      readJson(
        CATALOG_FILE
      );

    const owner =
      findUniversity(
        catalog,
        OWNER_ID
      );

    const secondCampus =
      findUniversity(
        catalog,
        SECOND_CAMPUS_ID
      );

    if (
      !owner
      ||
      !secondCampus
    ) {
      throw new Error(
        "TARGET_UNIVERSITIES_DISAPPEARED"
      );
    }

    const ownerSources =
      ensureSourceArray(
        owner
      );

    const secondSources =
      ensureSourceArray(
        secondCampus
      );

    if (
      ownerSources.some(
        source =>
          normalizeText(
            source.id
          )
          === normalizeText(
            SOURCE_ID
          )
      )
    ) {
      throw new Error(
        "OWNER_SOURCE_ID_ALREADY_EXISTS"
      );
    }

    if (
      secondSources.some(
        source =>
          normalizeText(
            source.id
          )
          === normalizeText(
            SOURCE_ID
          )
      )
    ) {
      throw new Error(
        "SECOND_CAMPUS_DUPLICATE_SOURCE_ALREADY_EXISTS"
      );
    }

    ownerSources.push({
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
        OWNER_ID,

      visibleToCampuses:
        VISIBLE_TO_CAMPUSES,

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
        "verified",

      healthStatus:
        "validated",

      verifiedAt:
        new Date()
          .toISOString()
    });

    atomicWriteJson(
      CATALOG_FILE,
      catalog
    );

    result.sourceAdded =
      true;

    const writtenCatalog =
      readJson(
        CATALOG_FILE
      );

    const writtenOwner =
      findUniversity(
        writtenCatalog,
        OWNER_ID
      );

    const writtenSecond =
      findUniversity(
        writtenCatalog,
        SECOND_CAMPUS_ID
      );

    if (
      !writtenOwner
      ||
      !writtenSecond
    ) {
      throw new Error(
        "POST_WRITE_UNIVERSITY_VERIFY_FAILED"
      );
    }

    const writtenOwnerSources =
      extractSources(
        writtenOwner
      );

    const writtenSecondSources =
      extractSources(
        writtenSecond
      );

    const ownerMatches =
      writtenOwnerSources.filter(
        source =>
          normalizeText(
            source.id
          )
          === normalizeText(
            SOURCE_ID
          )
      );

    const secondMatches =
      writtenSecondSources.filter(
        source =>
          normalizeText(
            source.id
          )
          === normalizeText(
            SOURCE_ID
          )
      );

    if (
      ownerMatches.length !== 1
    ) {
      throw new Error(
        "OWNER_SOURCE_COUNT_INVALID"
      );
    }

    if (
      secondMatches.length !== 0
    ) {
      throw new Error(
        "SECOND_CAMPUS_DUPLICATE_STORAGE_DETECTED"
      );
    }

    const writtenSource =
      ownerMatches[0];

    if (
      writtenSource.verified
      !== true
      ||
      writtenSource.enabled
      !== true
      ||
      writtenSource.campusScope
      !== "SHARED_SOURCE"
      ||
      writtenSource.canonicalOwner
      !== OWNER_ID
      ||
      writtenSource.collectOnce
      !== true
      ||
      writtenSource.duplicateStorage
      !== false
    ) {
      throw new Error(
        "SHARED_SOURCE_POLICY_WRITE_VERIFY_FAILED"
      );
    }

    if (
      !Array.isArray(
        writtenSource.visibleToCampuses
      )
      ||
      writtenSource.visibleToCampuses.length
      !== 2
      ||
      !VISIBLE_TO_CAMPUSES.every(
        id =>
          writtenSource.visibleToCampuses
            .map(
              normalizeText
            )
            .includes(
              normalizeText(id)
            )
      )
    ) {
      throw new Error(
        "VISIBLE_TO_CAMPUSES_VERIFY_FAILED"
      );
    }

    result.ownerOnly =
      true;

    result.secondCampusSourceAdded =
      false;

    result.dryRun =
      runDryValidation();

    if (
      !result.dryRun.success
    ) {
      throw new Error(
        "POST_ACTIVATION_DRY_RUN_FAILED"
      );
    }

    result.tests =
      runTests();

    if (
      result.tests.exitCode
      !== 0
    ) {
      throw new Error(
        "NPM_TEST_FAILED"
      );
    }

    const hashesAfter =
      snapshotHashes();

    if (
      hashesAfter.store
      !==
      result.beforeHashes.store
    ) {
      throw new Error(
        "STORE_MUTATED_UNEXPECTEDLY"
      );
    }

    if (
      hashesAfter.preview
      !==
      result.beforeHashes.preview
    ) {
      throw new Error(
        "PREVIEW_MUTATED_UNEXPECTEDLY"
      );
    }

    if (
      hashesAfter.catalog
      ===
      result.beforeHashes.catalog
    ) {
      throw new Error(
        "CATALOG_HASH_DID_NOT_CHANGE"
      );
    }

    result.afterHashes =
      hashesAfter;

    result.status =
      "ACTIVATED_LOCAL";
  } catch (error) {
    if (
      result.backup
    ) {
      rollback(
        result.backup
      );

      result.rollback =
        true;
    }

    result.status =
      "ROLLED_BACK";

    result.error = {
      name:
        error?.name
        ||
        "Error",

      message:
        error?.message
        ||
        String(error)
    };

    result.afterHashes =
      snapshotHashes();
  }

  atomicWriteJson(
    OUTPUT_FILE,
    result
  );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,

        sourceAdded:
          result.sourceAdded,

        ownerOnly:
          result.ownerOnly,

        secondCampusSourceAdded:
          result.secondCampusSourceAdded,

        sharedSourcePolicy:
          result.sharedSourcePolicy,

        dryRun:
          result.dryRun
            ? {
                success:
                  result.dryRun.success,

                rawRows:
                  result.dryRun.rawRows,

                extracted:
                  result.dryRun.extracted,

                unique:
                  result.dryRun.unique,

                duplicateKeys:
                  result.dryRun.duplicateKeys,

                distinctTitles:
                  result.dryRun.distinctTitles,

                distinctDates:
                  result.dryRun.distinctDates,

                detailTested:
                  result.dryRun.detailTested,

                detailPass:
                  result.dryRun.detailPass,

                titlePass:
                  result.dryRun.titlePass,

                datePass:
                  result.dryRun.datePass,

                validUrls:
                  result.dryRun.validUrls
              }
            : null,

        tests:
          result.tests
            ? {
                exitCode:
                  result.tests.exitCode
              }
            : null,

        rollback:
          result.rollback,

        hashes:
          result.beforeHashes
          &&
          result.afterHashes
            ? {
                catalogChanged:
                  result.beforeHashes.catalog
                  !==
                  result.afterHashes.catalog,

                storeChanged:
                  result.beforeHashes.store
                  !==
                  result.afterHashes.store,

                previewChanged:
                  result.beforeHashes.preview
                  !==
                  result.afterHashes.preview
              }
            : null,

        backup:
          result.backup,

        outputFile:
          OUTPUT_FILE,

        gitTriggered:
          false,

        deploymentTriggered:
          false,

        error:
          result.error
      },
      null,
      2
    )
  );

  if (
    result.status
    !== "ACTIVATED_LOCAL"
  ) {
    process.exitCode =
      2;
  }
}

main();