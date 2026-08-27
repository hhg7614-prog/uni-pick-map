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

const READY_FILE = path.join(
  DATA,
  "sangmyung-cheonan-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "sangmyung-cheonan-source-activation.json"
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
  "sangmyung-cheonan-source-activation"
);

const UNIVERSITY_ID =
  "sangmyung-university-제2캠퍼";

const SOURCE_ID =
  "sangmyung-cheonan-general-feed";

const DETAIL_TEST_LIMIT = 5;


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

  fs.renameSync(
    temp,
    file
  );
}


function normalizeId(value) {
  return String(value || "")
    .normalize("NFC");
}


function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}


function plain(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  )
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
        decodeHtml(value).trim()
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
      host === "smu.ac.kr"
      ||
      host.endsWith(".smu.ac.kr")
    );
  } catch {
    return false;
  }
}


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
        "Mozilla/5.0 compatible UNI-PICK Sangmyung Activator",

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
        maxBuffer: 25 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      error: result.error.message
    };
  }

  const stdout =
    String(result.stdout || "");

  const marker =
    "\n__META__";

  const index =
    stdout.lastIndexOf(marker);

  if (index < 0) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: stdout,
      error: "META_MARKER_MISSING"
    };
  }

  const html =
    stdout.slice(0, index);

  const [
    rawStatus,
    finalUrl
  ] =
    stdout
      .slice(index + marker.length)
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
    html
  };
}


function extractBoardItems(html) {
  return (
    html.match(
      /<dl\b[^>]*class\s*=\s*["'][^"']*\bboard-thumb-content-wrap\b[^"']*["'][^>]*>[\s\S]*?<\/dl>/gi
    )
    || []
  );
}


function normalizeDate(value) {
  const text =
    plain(value);

  const match =
    text.match(
      /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/
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


function extractAnchors(raw, baseUrl) {
  const anchors = [];

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
      )[1]
      || null;

    if (!href) {
      continue;
    }

    let url = null;

    try {
      url =
        new URL(
          decodeHtml(href),
          baseUrl
        ).href;
    } catch {
      continue;
    }

    anchors.push({
      text:
        plain(match[2]),

      url
    });
  }

  return anchors;
}


function parseArticleNo(url) {
  try {
    const parsed =
      new URL(url);

    if (
      parsed.searchParams.get("mode")
      !== "view"
    ) {
      return null;
    }

    const articleNo =
      parsed.searchParams.get(
        "articleNo"
      );

    return /^\d+$/.test(
      articleNo || ""
    )
      ? articleNo
      : null;

  } catch {
    return null;
  }
}


function isCategoryLabel(text) {
  return /^상명\s*\[[^\]]+\]$/.test(
    plain(text)
  );
}


function analyzeItem(raw, baseUrl) {
  const anchors =
    extractAnchors(
      raw,
      baseUrl
    )
      .map(
        anchor => ({
          ...anchor,
          articleNo:
            parseArticleNo(
              anchor.url
            )
        })
      )
      .filter(
        anchor =>
          anchor.articleNo
      );

  const titleAnchor =
    anchors
      .filter(
        anchor =>
          anchor.text
          &&
          !isCategoryLabel(
            anchor.text
          )
      )
      .sort(
        (a, b) =>
          b.text.length
          -
          a.text.length
      )[0];

  if (!titleAnchor) {
    return null;
  }

  const dateMatches =
    plain(raw).match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
    || [];

  const dates =
    [
      ...new Set(
        dateMatches
          .map(normalizeDate)
          .filter(Boolean)
      )
    ];

  if (
    dates.length !== 1
  ) {
    return null;
  }

  return {
    articleNo:
      titleAnchor.articleNo,

    title:
      titleAnchor.text,

    publishedAt:
      dates[0],

    detailUrl:
      titleAnchor.url,

    detailKey:
      `ARTICLE:${titleAnchor.articleNo}`
  };
}


function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}


function titleMatches(expected, html) {
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


function dateMatches(expected, html) {
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
    `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
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
      titleMatch: false,
      dateMatch: false,
      pass: false
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
          process.platform === "win32"
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
      "SANGMYUNG_NOT_ACTIVATION_READY"
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
        source.id
        === SOURCE_ID
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
      read(
        CATALOG_FILE
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

    atomic(
      CATALOG_FILE,
      catalog
    );

    result.sourceAdded =
      true;

    const written =
      read(
        CATALOG_FILE
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
      writtenSource.verified !== true
      ||
      writtenSource.enabled !== true
    ) {
      throw new Error(
        "CATALOG_WRITE_VERIFY_FAILED"
      );
    }

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

    const rawItems =
      extractBoardItems(
        list.html
      );

    const extracted =
      rawItems
        .map(
          raw =>
            analyzeItem(
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
        validateDetail(item)
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
        rawItems.length >= 15
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

      rawItems:
        rawItems.length,

      extracted:
        extracted.length,

      unique:
        unique.length,

      duplicateKeys:
        extracted.length
        -
        unique.length,

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