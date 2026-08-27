"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

// ============================================================
// 1. 기본 경로
// ============================================================

const ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  ".."
);

const DATA_DIR = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const READY_FILE = path.join(
  DATA_DIR,
  "daeshin-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "daeshin-source-activation.json"
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
  "daeshin-source-activation"
);

// ============================================================
// 2. 대상 정보
// ============================================================

const UNIVERSITY_ID =
  "daeshin-university-본교";

const SOURCE_ID =
  "daeshin-general-feed";

const DETAIL_TEST_LIMIT = 5;

// ============================================================
// 3. JSON / 파일 유틸
// ============================================================

function readJson(
  file,
  fallback = null
) {
  try {
    const raw = fs.readFileSync(
      file,
      "utf8"
    );

    return JSON.parse(
      raw.replace(/^\uFEFF/, "")
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
      recursive: true
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
    ) + "\n",
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

function normalizeId(value) {
  return String(value || "")
    .normalize("NFC");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .trim();
}

// ============================================================
// 4. HTML 유틸
// ============================================================

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function plain(value) {
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

function normalizeDate(value) {
  const text =
    plain(value);

  const match = text.match(
    /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/
  );

  if (!match) {
    return null;
  }

  return (
    match[1]
    + "-"
    + String(match[2]).padStart(
      2,
      "0"
    )
    + "-"
    + String(match[3]).padStart(
      2,
      "0"
    )
  );
}

function officialDomain(url) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase();

    return (
      host === "daeshin.ac.kr"
      ||
      host.endsWith(
        ".daeshin.ac.kr"
      )
    );
  } catch {
    return false;
  }
}

// ============================================================
// 5. Hash / Backup
// ============================================================

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
      recursive: true
    }
  );

  const files = [
    CATALOG_FILE,
    STORE_FILE,
    PREVIEW_FILE
  ];

  for (const file of files) {
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
  const targets = [
    CATALOG_FILE,
    STORE_FILE,
    PREVIEW_FILE
  ];

  for (const target of targets) {
    const backupFile =
      path.join(
        backupDir,
        path.basename(target)
      );

    if (
      fs.existsSync(
        backupFile
      )
    ) {
      fs.copyFileSync(
        backupFile,
        target
      );
    }
  }
}

// ============================================================
// 6. curl 요청
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
        "Mozilla/5.0 UNI-PICK Daeshin Activator",

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
      ok: false,

      status: null,

      finalUrl: null,

      html: "",

      error:
        result.error.message
    };
  }

  const stdout =
    String(
      result.stdout || ""
    );

  const marker =
    "\n__META__";

  const markerIndex =
    stdout.lastIndexOf(
      marker
    );

  if (markerIndex < 0) {
    return {
      ok: false,

      status: null,

      finalUrl: null,

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
    Number(rawStatus);

  return {
    ok:
      result.status === 0
      &&
      status === 200,

    status,

    finalUrl,

    html,

    error:
      result.status === 0
        ? null
        : String(
            result.stderr || ""
          )
  };
}

// ============================================================
// 7. 대신뉴스 목록 파서
// ============================================================

function extractRows(html) {
  const rows = [];

  const rowRegex =
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while (
    (
      rowMatch =
        rowRegex.exec(html)
    )
  ) {
    const rowHtml =
      rowMatch[0];

    const titleCell =
      rowHtml.match(
        /<td\b[^>]*class=["'][^"']*\bTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
      );

    const dateCell =
      rowHtml.match(
        /<td\b[^>]*class=["'][^"']*\bDate\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
      );

    if (
      !titleCell
      ||
      !dateCell
    ) {
      continue;
    }

    const anchor =
      titleCell[1].match(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );

    if (!anchor) {
      continue;
    }

    const href =
      decodeHtml(
        anchor[1]
      );

    if (
      !/[?&]AT=V(?:&|$)/i.test(
        href
      )
      ||
      !/[?&]b_id=/i.test(
        href
      )
    ) {
      continue;
    }

    const title =
      plain(
        anchor[2]
      );

    const publishedAt =
      normalizeDate(
        dateCell[1]
      );

    let detailUrl;

    try {
      detailUrl =
        new URL(
          href,
          "https://www.daeshin.ac.kr/html/05_community/01_6.php"
        ).href;
    } catch {
      continue;
    }

    let bId = null;

    try {
      bId =
        new URL(
          detailUrl
        )
          .searchParams
          .get("b_id");
    } catch {
      continue;
    }

    if (
      !bId
      ||
      !title
      ||
      !publishedAt
    ) {
      continue;
    }

    rows.push({
      bId,

      title,

      publishedAt,

      detailUrl,

      detailKey:
        `B_ID:${bId}`
    });
  }

  return rows;
}

// ============================================================
// 8. 상세 검증
// ============================================================

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

  const pattern =
    new RegExp(
      `${year}\\s*[.\\-/]\\s*0?${month}\\s*[.\\-/]\\s*0?${day}`
    );

  return pattern.test(text);
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

      titleMatch:
        false,

      dateMatch:
        false,

      validUrl:
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

  const validUrl =
    officialDomain(
      page.finalUrl
      ||
      item.detailUrl
    );

  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    titleMatch,

    dateMatch,

    validUrl,

    pass:
      Boolean(
        validUrl
        &&
        titleMatch
        &&
        dateMatch
      )
  };
}

// ============================================================
// 9. 테스트 실행
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
          process.platform === "win32",

        windowsHide:
          true
      }
    );

  return {
    exitCode:
      result.status,

    stdout:
      String(
        result.stdout || ""
      ).slice(
        -10000
      ),

    stderr:
      String(
        result.stderr || ""
      ).slice(
        -5000
      )
  };
}

// ============================================================
// 10. Main
// ============================================================

function main() {
  const ready =
    readJson(
      READY_FILE
    );

  if (
    !ready
    ||
    ready.decision !==
      "ACTIVATION_READY"
    ||
    ready.activationReady !== true
  ) {
    throw new Error(
      "DAESHIN_NOT_ACTIVATION_READY"
    );
  }

  const proposed =
    ready
      .proposedActivation
      ?.source;

  if (!proposed) {
    throw new Error(
      "PROPOSED_SOURCE_MISSING"
    );
  }

  if (
    normalizeId(
      ready
        .proposedActivation
        ?.universityId
    )
    !==
    normalizeId(
      UNIVERSITY_ID
    )
  ) {
    throw new Error(
      "UNIVERSITY_ID_MISMATCH"
    );
  }

  if (
    normalizeText(
      proposed.id
    )
    !==
    normalizeText(
      SOURCE_ID
    )
  ) {
    throw new Error(
      "SOURCE_ID_MISMATCH"
    );
  }

  const catalogBefore =
    readJson(
      CATALOG_FILE,
      {
        universities: []
      }
    );

  if (
    !catalogBefore
    ||
    !Array.isArray(
      catalogBefore.universities
    )
  ) {
    throw new Error(
      "CATALOG_STRUCTURE_INVALID"
    );
  }

  const universityBefore =
    catalogBefore
      .universities
      .find(
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
        source.id ===
        SOURCE_ID
    )
  ) {
    throw new Error(
      "SOURCE_ID_ALREADY_EXISTS"
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
      readJson(
        CATALOG_FILE
      );

    const university =
      catalog
        .universities
        .find(
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

    if (
      university.sources.some(
        source =>
          source.id ===
          SOURCE_ID
      )
    ) {
      throw new Error(
        "SOURCE_ID_ALREADY_EXISTS_DURING_WRITE"
      );
    }

    university.sources.push({
      ...proposed,

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

    // ========================================================
    // Catalog 재검증
    // ========================================================

    const written =
      readJson(
        CATALOG_FILE
      );

    const writtenUniversity =
      written
        .universities
        .find(
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
        writtenUniversity
          ?.sources
        ||
        []
      )
        .find(
          source =>
            source.id ===
            SOURCE_ID
        );

    if (
      !writtenSource
      ||
      writtenSource.verified !== true
      ||
      writtenSource.enabled !== true
    ) {
      throw new Error(
        "CATALOG_WRITE_VERIFY_FAILED"
      );
    }

    // ========================================================
    // 실제 목록 재수집
    // ========================================================

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
        ||
        writtenSource.listUrl
      )
    ) {
      throw new Error(
        "POST_ACTIVATION_LIST_FAILED"
      );
    }

    const allRows =
      list.html.match(
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
      )
      ||
      [];

    const extracted =
      extractRows(
        list.html
      );

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
            normalizeText(
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

    const validUrls =
      details.filter(
        item =>
          item.validUrl
      ).length;

    const drySuccess =
      Boolean(
        allRows.length >= 15
        &&
        extracted.length >= 15
        &&
        unique.length >= 10
        &&
        duplicateKeys === 0
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
        &&
        validUrls === 5
      );

    result.dryRun = {
      success:
        drySuccess,

      rawRows:
        allRows.length,

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

      datePass,

      validUrls
    };

    if (!drySuccess) {
      throw new Error(
        "POST_ACTIVATION_DRY_RUN_FAILED"
      );
    }

    // ========================================================
    // 테스트
    // ========================================================

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

    // ========================================================
    // 예상하지 않은 데이터 변경 확인
    // ========================================================

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

  if (
    result.status !==
    "ACTIVATED_LOCAL"
  ) {
    process.exitCode = 2;
  }
}

// ============================================================
// 11. 실행
// ============================================================

try {
  main();
} catch (error) {
  const fatal = {
    status:
      "FATAL",

    error: {
      name:
        error?.name ||
        "Error",

      message:
        error?.message ||
        String(error)
    }
  };

  console.error(
    JSON.stringify(
      fatal,
      null,
      2
    )
  );

  process.exitCode = 1;
}