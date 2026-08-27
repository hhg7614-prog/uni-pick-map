"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
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

const READY_FILE = path.join(
  DATA,
  "changshin-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "changshin-source-activation.json"
);

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "changshin-source-activation"
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
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
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
      new URL(text, base);

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
        .replace(/^www\./, "");

    return (
      host === "cs.ac.kr"
      ||
      host.endsWith(".cs.ac.kr")
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * Hash / Backup
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
      sha256(CATALOG_FILE),

    store:
      sha256(STORE_FILE),

    preview:
      sha256(PREVIEW_FILE)
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
      .slice(0, 14);

  const dir =
    path.join(
      BACKUP_ROOT,
      stamp
    );

  fs.mkdirSync(
    dir,
    { recursive: true }
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
          dir,
          path.basename(file)
        )
      );
    }
  }

  return dir;
}


function rollback(backupDir) {
  for (
    const [name, destination]
    of [
      [
        path.basename(
          CATALOG_FILE
        ),
        CATALOG_FILE
      ],
      [
        path.basename(
          STORE_FILE
        ),
        STORE_FILE
      ],
      [
        path.basename(
          PREVIEW_FILE
        ),
        PREVIEW_FILE
      ]
    ]
  ) {
    const backup =
      path.join(
        backupDir,
        name
      );

    if (
      fs.existsSync(backup)
    ) {
      fs.copyFileSync(
        backup,
        destination
      );
    }
  }
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
          redirect: "follow",
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK Changshin Safe Activator",

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
 * List Parser
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
      !officialDomain(url)
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
      plain(match[2]);

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
      plain(match[2]);

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
        publishedAt
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
      date.raw
  };
}


/* =========================================================
 * Detail
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
    titleKey(expected);

  const documentKey =
    titleKey(html);

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
    plain(html);

  const pattern =
    new RegExp(
      `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
    );

  return pattern.test(text);
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
 * npm test
 * ========================================================= */

function runTests() {
  const result =
    spawnSync(
      "npm",
      ["test"],
      {
        cwd:
          ROOT,

        encoding:
          "utf8",

        timeout:
          120000,

        shell:
          process.platform
          === "win32"
      }
    );

  return {
    exitCode:
      result.status,

    stdout:
      String(
        result.stdout || ""
      ).slice(
        -12000
      ),

    stderr:
      String(
        result.stderr || ""
      ).slice(
        -5000
      )
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const readiness =
    read(
      READY_FILE,
      {}
    );

  if (
    readiness.decision
      !== "ACTIVATION_READY"
    ||
    readiness.activationReady
      !== true
  ) {
    throw new Error(
      "CHANGSHIN_NOT_ACTIVATION_READY"
    );
  }

  const proposed =
    readiness.proposedActivation
      ?.source;

  if (!proposed) {
    throw new Error(
      "CHANGSHIN_PROPOSED_SOURCE_MISSING"
    );
  }


  const catalogBefore =
    read(
      CATALOG_FILE,
      {
        universities: []
      }
    );


  const universityBefore =
    (
      catalogBefore.universities
      || []
    ).find(
      university =>
        normalizeId(
          university.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    );


  if (!universityBefore) {
    throw new Error(
      "CHANGSHIN_CATALOG_ENTRY_NOT_FOUND"
    );
  }


  const existingSources =
    Array.isArray(
      universityBefore.sources
    )
      ? universityBefore.sources
      : [];


  if (
    existingSources.some(
      source =>
        source.id
        === SOURCE_ID
    )
  ) {
    throw new Error(
      "SOURCE_ID_ALREADY_EXISTS"
    );
  }


  const targetListUrl =
    normalizeUrl(
      proposed.listUrl,
      LIST_URL
    )
    ||
    LIST_URL;


  if (
    existingSources.some(
      source =>
        normalizeUrl(
          source.listUrl
        )
        ===
        targetListUrl
    )
  ) {
    throw new Error(
      "SOURCE_URL_ALREADY_EXISTS"
    );
  }


  const beforeHashes =
    snapshotHashes();


  const backupDir =
    makeBackup();


  const result = {
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

    status:
      "STARTED",

    sourceAdded:
      false,

    dryRun:
      null,

    tests:
      null,

    rollback:
      false,

    backupDir,

    error:
      null,

    beforeHashes,

    afterHashes:
      null,

    safety: {
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


  try {
    /* -----------------------------------------------------
     * Catalog mutation
     * --------------------------------------------------- */

    const catalog =
      read(
        CATALOG_FILE,
        {
          universities: []
        }
      );


    const university =
      catalog.universities.find(
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
      throw new Error(
        "TARGET_DISAPPEARED_BEFORE_WRITE"
      );
    }


    if (
      !Array.isArray(
        university.sources
      )
    ) {
      university.sources = [];
    }


    const source = {
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
        targetListUrl,

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
        "verified",

      healthStatus:
        "validated",

      verifiedAt:
        new Date()
          .toISOString()
    };


    university.sources.push(
      source
    );


    atomic(
      CATALOG_FILE,
      catalog
    );


    result.sourceAdded =
      true;


    /* -----------------------------------------------------
     * Write verify
     * --------------------------------------------------- */

    const written =
      read(
        CATALOG_FILE,
        {
          universities: []
        }
      );


    const writtenUniversity =
      written.universities.find(
        item =>
          normalizeId(
            item.universityId
          )
          ===
          normalizeId(
            UNIVERSITY_ID
          )
      );


    const writtenSource =
      (
        writtenUniversity?.sources
        || []
      ).find(
        item =>
          item.id
          === SOURCE_ID
      );


    if (
      !writtenSource
      ||
      writtenSource.verified
        !== true
      ||
      writtenSource.enabled
        !== true
      ||
      normalizeUrl(
        writtenSource.listUrl
      )
        !==
        targetListUrl
    ) {
      throw new Error(
        "CATALOG_WRITE_VERIFICATION_FAILED"
      );
    }


    /* -----------------------------------------------------
     * Post activation dry-run
     * --------------------------------------------------- */

    const list =
      await fetchPage(
        writtenSource.listUrl
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
        "POST_ACTIVATION_LIST_FAILED"
      );
    }


    const rawRows =
      extractRows(
        list.html
      );


    const extracted =
      rawRows
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


    const drySuccess =
      Boolean(
        unique.length >= 3
        &&
        distinctTitles >= 3
        &&
        duplicateUrls === 0
        &&
        detailChecks.length === 3
        &&
        detailPass === 3
        &&
        titlePass === 3
        &&
        datePass === 3
      );


    result.dryRun = {
      success:
        drySuccess,

      rows:
        rawRows.length,

      extracted:
        extracted.length,

      unique:
        unique.length,

      duplicateUrls,

      distinctTitles,

      detailTested:
        detailChecks.length,

      detailPass,

      titlePass,

      datePass,

      details:
        detailChecks
    };


    if (!drySuccess) {
      throw new Error(
        "POST_ACTIVATION_DRY_RUN_FAILED"
      );
    }


    /* -----------------------------------------------------
     * npm test
     * --------------------------------------------------- */

    result.tests =
      runTests();


    if (
      result.tests.exitCode !== 0
    ) {
      throw new Error(
        "NPM_TEST_FAILED"
      );
    }


    /* -----------------------------------------------------
     * Store / Preview 불변
     * --------------------------------------------------- */

    const interim =
      snapshotHashes();


    if (
      interim.store
      !==
      beforeHashes.store
    ) {
      throw new Error(
        "STORE_MUTATED_UNEXPECTEDLY"
      );
    }


    if (
      interim.preview
      !==
      beforeHashes.preview
    ) {
      throw new Error(
        "PREVIEW_MUTATED_UNEXPECTEDLY"
      );
    }


    result.afterHashes =
      interim;


    result.status =
      "ACTIVATED_LOCAL";


  } catch (error) {
    rollback(
      backupDir
    );


    result.rollback =
      true;


    result.status =
      "ROLLED_BACK";


    result.error = {
      name:
        error.name,

      message:
        error.message
    };


    result.afterHashes =
      snapshotHashes();
  }


  atomic(
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

        dryRun:
          result.dryRun
            ? {
                success:
                  result.dryRun.success,

                rows:
                  result.dryRun.rows,

                extracted:
                  result.dryRun.extracted,

                unique:
                  result.dryRun.unique,

                duplicateUrls:
                  result.dryRun.duplicateUrls,

                distinctTitles:
                  result.dryRun.distinctTitles,

                detailTested:
                  result.dryRun.detailTested,

                detailPass:
                  result.dryRun.detailPass,

                titlePass:
                  result.dryRun.titlePass,

                datePass:
                  result.dryRun.datePass
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

        hashes: {
          catalogChanged:
            result.beforeHashes.catalog
            !==
            result.afterHashes?.catalog,

          storeChanged:
            result.beforeHashes.store
            !==
            result.afterHashes?.store,

          previewChanged:
            result.beforeHashes.preview
            !==
            result.afterHashes?.preview
        },

        backup:
          result.backupDir,

        gitTriggered:
          result.safety.gitTriggered,

        deploymentTriggered:
          result.safety.deploymentTriggered,

        error:
          result.error
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
  snapshotHashes
};