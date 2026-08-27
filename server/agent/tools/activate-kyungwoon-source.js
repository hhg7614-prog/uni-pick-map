"use strict";

/**
 * UNI PICK - Kyungwoon Source Activator v1
 *
 * 대상:
 * 경운대학교 입학·모집 소식
 *
 * 수행:
 * 1. activation-ready 확인
 * 2. catalog 백업
 * 3. source 추가
 * 4. post-activation dry-run
 * 5. 상세 5건 검증
 * 6. npm test
 * 7. store/preview 불변 확인
 * 8. 실패 시 rollback
 *
 * 네트워크:
 * Node fetch 대신 curl.exe
 * TLS 우회 없음 (-k 사용 금지)
 */

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

const READY_FILE = path.join(
  DATA,
  "kyungwoon-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungwoon-source-activation.json"
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

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "kyungwoon-source-activation"
);

const UNIVERSITY_ID =
  "kyungwoon-university-본교";

const UNIVERSITY_NAME =
  "경운대학교";

const SOURCE_ID =
  "kyungwoon-admission-general-feed";

const DETAIL_TEST_LIMIT = 5;


/* =========================================================
 * Utility
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

  const temp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(temp, "utf8")
  );

  fs.renameSync(temp, file);
}

function normalizeId(value) {
  return String(value || "")
    .normalize("NFC");
}

function plain(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value)
          .replace(/&amp;/gi, "&")
          .trim()
      );

    url.hash = "";

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
      host === "ikw.ac.kr"
      ||
      host.endsWith(".ikw.ac.kr")
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
      .replace(/[-:.TZ]/g, "")
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
        path.basename(CATALOG_FILE),
        CATALOG_FILE
      ],
      [
        path.basename(STORE_FILE),
        STORE_FILE
      ],
      [
        path.basename(PREVIEW_FILE),
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
 * curl
 * ========================================================= */

function curlPage(url) {
  const result =
    spawnSync(
      "curl.exe",
      [
        "-L",
        "--max-redirs", "10",
        "--connect-timeout", "20",
        "--max-time", "30",
        "--silent",
        "--show-error",
        "--compressed",

        "-A",
        "Mozilla/5.0 compatible UNI-PICK Kyungwoon Activator",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__META__%{http_code}|%{url_effective}",

        url
      ],
      {
        encoding: "utf8",
        timeout: 35000,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
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
      error: result.error.message
    };
  }

  const stdout =
    String(
      result.stdout || ""
    );

  const marker =
    "\n__META__";

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
      html: stdout,
      error: "META_MARKER_MISSING"
    };
  }

  const html =
    stdout.slice(
      0,
      index
    );

  const [
    rawStatus,
    finalUrl
  ] =
    stdout
      .slice(
        index + marker.length
      )
      .trim()
      .split("|");

  const status =
    Number(rawStatus);

  return {
    ok:
      result.status === 0
      &&
      status === 200,

    status,

    finalUrl,

    html,

    bytes:
      Buffer.byteLength(
        html,
        "utf8"
      )
  };
}


/* =========================================================
 * Parser
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}

function normalizeDate(value) {
  const match =
    String(value || "")
      .match(
        /^(20\d{2})-(\d{1,2})-(\d{1,2})$/
      );

  if (!match) {
    return null;
  }

  return (
    `${match[1]}-`
    +
    `${String(match[2]).padStart(2, "0")}-`
    +
    String(match[3]).padStart(2, "0")
  );
}

function analyzeRow(
  raw,
  detailTemplate
) {
  const titleMatch =
    raw.match(
      /<a\b[^>]*class\s*=\s*["'][^"']*\btit\b[^"']*["'][^>]*href\s*=\s*["']javascript:selectBoardDetail\(\s*['"](\d+)['"]\s*\);?["'][^>]*>([\s\S]*?)<\/a>/i
    )
    ||
    raw.match(
      /<a\b[^>]*href\s*=\s*["']javascript:selectBoardDetail\(\s*['"](\d+)['"]\s*\);?["'][^>]*class\s*=\s*["'][^"']*\btit\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );

  if (!titleMatch) {
    return null;
  }

  const boardNo =
    titleMatch[1];

  const title =
    plain(
      titleMatch[2]
    );

  const dateMatch =
    raw.match(
      /<div\b[^>]*class\s*=\s*["'][^"']*\badd\b[^"']*["'][^>]*>\s*<span\b[^>]*>\s*(20\d{2}-\d{1,2}-\d{1,2})\s*<\/span>/i
    );

  if (!dateMatch) {
    return null;
  }

  const publishedAt =
    normalizeDate(
      dateMatch[1]
    );

  if (
    !boardNo
    ||
    !title
    ||
    !publishedAt
  ) {
    return null;
  }

  return {
    boardNo,
    title,
    publishedAt,

    detailUrl:
      detailTemplate.replace(
        "{id}",
        boardNo
      ),

    detailKey:
      `BOARD:${boardNo}`
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

  return new RegExp(
    `${year}\\s*[-./년]\\s*0?${month}\\s*[-./월]\\s*0?${day}`
  ).test(text);
}

function validateDetail(item) {
  const page =
    curlPage(
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
      titleMatch:
        false,
      dateMatch:
        false,
      pass:
        false
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

  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    titleMatch,

    dateMatch,

    pass:
      Boolean(
        officialDomain(
          page.finalUrl
        )
        &&
        titleMatch
        &&
        dateMatch
      )
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
      ).slice(-10000),

    stderr:
      String(
        result.stderr || ""
      ).slice(-5000)
  };
}


/* =========================================================
 * Main
 * ========================================================= */

function main() {
  const ready =
    read(
      READY_FILE
    );

  if (
    !ready
    ||
    ready.decision
      !== "ACTIVATION_READY"
    ||
    ready.activationReady
      !== true
  ) {
    throw new Error(
      "KYUNGWOON_NOT_ACTIVATION_READY"
    );
  }

  const proposed =
    ready.proposedActivation
      ?.source;

  if (!proposed) {
    throw new Error(
      "PROPOSED_SOURCE_MISSING"
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
      item =>
        normalizeId(
          item.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    );

  if (!universityBefore) {
    throw new Error(
      "CATALOG_UNIVERSITY_NOT_FOUND"
    );
  }

  const sourcesBefore =
    Array.isArray(
      universityBefore.sources
    )
      ? universityBefore.sources
      : [];

  if (
    sourcesBefore.some(
      source =>
        source.id === SOURCE_ID
    )
  ) {
    throw new Error(
      "SOURCE_ID_ALREADY_EXISTS"
    );
  }

  const targetUrl =
    normalizeUrl(
      proposed.listUrl
    );

  if (!targetUrl) {
    throw new Error(
      "INVALID_LIST_URL"
    );
  }

  if (
    sourcesBefore.some(
      source =>
        normalizeUrl(
          source.listUrl
        )
        === targetUrl
    )
  ) {
    throw new Error(
      "LIST_URL_ALREADY_EXISTS"
    );
  }

  const beforeHashes =
    snapshotHashes();

  const backupDir =
    makeBackup();

  const result = {
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

    backup:
      backupDir,

    beforeHashes,

    afterHashes:
      null,

    error:
      null
  };

  try {
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
        "TARGET_UNIVERSITY_DISAPPEARED"
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
      ...proposed,

      id:
        SOURCE_ID,

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

    /*
     * catalog write verify
     */

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
        source =>
          source.id
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
    ) {
      throw new Error(
        "CATALOG_WRITE_VERIFY_FAILED"
      );
    }

    /*
     * Post activation dry-run
     */

    const list =
      curlPage(
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

    const detailTemplate =
      writtenSource.parser
        ?.detailUrlTemplate;

    if (!detailTemplate) {
      throw new Error(
        "DETAIL_TEMPLATE_MISSING"
      );
    }

    const rows =
      extractRows(
        list.html
      );

    const extracted =
      rows
        .map(
          row =>
            analyzeRow(
              row,
              detailTemplate
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

    const duplicateKeys =
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

    const distinctDates =
      new Set(
        unique.map(
          item =>
            item.publishedAt
        )
      ).size;

    const details = [];

    for (
      const item
      of unique.slice(
        0,
        DETAIL_TEST_LIMIT
      )
    ) {
      details.push(
        validateDetail(
          item
        )
      );
    }

    const detailPass =
      details.filter(
        item =>
          item.pass
      ).length;

    const titlePass =
      details.filter(
        item =>
          item.titleMatch
      ).length;

    const datePass =
      details.filter(
        item =>
          item.dateMatch
      ).length;

    const drySuccess =
      Boolean(
        rows.length >= 15
        &&
        extracted.length >= 15
        &&
        unique.length >= 10
        &&
        distinctTitles >= 10
        &&
        distinctDates >= 5
        &&
        details.length === 5
        &&
        detailPass === 5
        &&
        titlePass === 5
        &&
        datePass === 5
      );

    result.dryRun = {
      success:
        drySuccess,

      rows:
        rows.length,

      extracted:
        extracted.length,

      unique:
        unique.length,

      duplicateKeys,

      distinctTitles,

      distinctDates,

      detailTested:
        details.length,

      detailPass,

      titlePass,

      datePass
    };

    if (!drySuccess) {
      throw new Error(
        "POST_ACTIVATION_DRY_RUN_FAILED"
      );
    }

    /*
     * npm test
     */

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

    /*
     * store / preview 보호
     */

    const interimHashes =
      snapshotHashes();

    if (
      interimHashes.store
      !==
      beforeHashes.store
    ) {
      throw new Error(
        "STORE_MUTATED_UNEXPECTEDLY"
      );
    }

    if (
      interimHashes.preview
      !==
      beforeHashes.preview
    ) {
      throw new Error(
        "PREVIEW_MUTATED_UNEXPECTEDLY"
      );
    }

    result.afterHashes =
      interimHashes;

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
          result.dryRun,

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
          result.backup,

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
}

if (
  require.main === module
) {
  main();
}