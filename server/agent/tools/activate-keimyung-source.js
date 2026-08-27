"use strict";

/**
 * UNI PICK - Keimyung Source Safe Activator v2
 *
 * 목적
 * ---------------------------------------------------------
 * 이미 COLLECTOR_READY + ACTIVATION_READY를 통과한
 * 계명대학교 학사공지 source를 안전하게 로컬 활성화한다.
 *
 * v2 핵심
 * ---------------------------------------------------------
 * - activation dry-run parser를 새로 추측하지 않는다.
 * - finalize 단계에서 성공한 실제 계명대 HTML 구조를 그대로 사용한다.
 * - td.subject / td.date / YY-MM-DD 구조를 그대로 재검증한다.
 *
 * 안전
 * ---------------------------------------------------------
 * - 실패 시 Catalog 즉시 rollback
 * - Store/Preview 불변 검사
 * - npm test 통과 필수
 * - Git/Deploy 없음
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

const FINALIZATION_FILE = path.join(
  DATA,
  "keimyung-source-finalization.json"
);

const ACTIVATION_READY_FILE = path.join(
  DATA,
  "keimyung-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "keimyung-source-activation.json"
);

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "keimyung-source-activation"
);

const UNIVERSITY_ID =
  "keimyung-university-본교";

const UNIVERSITY_NAME =
  "계명대학교";

const SOURCE_ID =
  "keimyung-academic-notice";

const REQUEST_TIMEOUT_MS = 20000;
const DRY_RUN_LIMIT = 5;


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

  let text =
    String(value).trim();

  const markdown =
    text.match(
      /^\[[^\]]+\]\((.+)\)$/
    );

  if (
    markdown &&
    markdown[1]
  ) {
    text =
      markdown[1];
  }

  text =
    text
      .replace(/\\&/g, "&")
      .replace(/&amp;/gi, "&");

  try {
    const url =
      new URL(text, base);

    url.hash = "";

    return url.href;

  } catch {
    return null;
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
 * Date
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);

  let match =
    text.match(
      /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/
    );

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  match =
    text.match(
      /(?:^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\D|$)/
    );

  if (match) {
    const year =
      2000 + Number(match[1]);

    const month =
      Number(match[2]);

    const day =
      Number(match[3]);

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}


/* =========================================================
 * URL / Domain
 * ========================================================= */

function officialDomain(url) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(/^www\./, "");

    return (
      host === "kmu.ac.kr" ||
      host.endsWith(".kmu.ac.kr")
    );
  } catch {
    return false;
  }
}

function isDetailUrl(url) {
  try {
    const parsed =
      new URL(url);

    return (
      officialDomain(parsed.href)
      &&
      parsed.pathname.includes(
        "/uni/main/page.jsp"
      )
      &&
      parsed.searchParams.get("cmd")
        === "2"
      &&
      Boolean(
        parsed.searchParams.get(
          "parm_bod_uid"
        )
      )
      &&
      parsed.searchParams.get(
        "mnu_uid"
      ) === "144"
    );

  } catch {
    return false;
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
      () => controller.abort(),
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
              "Mozilla/5.0 compatible UNI-PICK Keimyung Safe Activator v2",

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
 * HTML Parsing
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}

function extractTdByClass(
  raw,
  className
) {
  const regex =
    new RegExp(
      `<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
      "i"
    );

  const match =
    raw.match(regex);

  if (!match) {
    return null;
  }

  return {
    html:
      match[1],

    text:
      plain(match[1])
  };
}

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
        matcher.exec(html)
    )
  ) {
    const attrs =
      match[1] || "";

    const hrefMatch =
      attrs.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );

    if (!hrefMatch) {
      continue;
    }

    const url =
      normalizeUrl(
        hrefMatch[1],
        baseUrl
      );

    if (!url) {
      continue;
    }

    const title =
      plain(match[2]);

    if (!title) {
      continue;
    }

    output.push({
      url,
      title
    });
  }

  return output;
}


/* =========================================================
 * 실제 계명대 Row Parser
 * ========================================================= */

function parseKeimyungRow(
  raw,
  baseUrl
) {
  const subject =
    extractTdByClass(
      raw,
      "subject"
    );

  const date =
    extractTdByClass(
      raw,
      "date"
    );

  if (
    !subject ||
    !date
  ) {
    return null;
  }

  const detail =
    extractAnchors(
      subject.html,
      baseUrl
    ).find(
      item =>
        isDetailUrl(item.url)
    );

  if (!detail) {
    return null;
  }

  const publishedAt =
    parseDate(
      date.text
    );

  if (!publishedAt) {
    return null;
  }

  return {
    title:
      detail.title,

    sourceUrl:
      detail.url,

    rawDate:
      date.text,

    publishedAt
  };
}


/* =========================================================
 * 상세 제목 검증
 * ========================================================= */

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function detailContainsTitle(
  html,
  title
) {
  const expected =
    titleKey(title);

  const content =
    titleKey(html);

  return Boolean(
    expected &&
    content.includes(expected)
  );
}


/* =========================================================
 * Activation Dry Run
 * ========================================================= */

async function runDryValidation(
  source
) {
  const list =
    await fetchPage(
      source.listUrl
    );

  if (
    !list.ok ||
    list.status !== 200
  ) {
    return {
      success:
        false,

      reason:
        "LIST_UNREACHABLE",

      totalRows:
        0,

      extracted:
        0,

      unique:
        0,

      samples:
        [],

      detailPass:
        0,

      publishedAtNull:
        0,

      duplicateUrls:
        0
    };
  }

  const rows =
    extractRows(
      list.html
    );

  const extracted =
    rows
      .map(
        row =>
          parseKeimyungRow(
            row,
            list.finalUrl
          )
      )
      .filter(Boolean);

  const uniqueItems =
    [
      ...new Map(
        extracted.map(
          item => [
            item.sourceUrl,
            item
          ]
        )
      ).values()
    ];

  const samples =
    uniqueItems.slice(
      0,
      DRY_RUN_LIMIT
    );

  const detailChecks = [];

  for (
    const item
    of samples
  ) {
    const detail =
      await fetchPage(
        item.sourceUrl
      );

    const pass =
      Boolean(
        detail.ok
        &&
        detail.status === 200
        &&
        detail.finalUrl
        &&
        officialDomain(
          detail.finalUrl
        )
        &&
        detailContainsTitle(
          detail.html,
          item.title
        )
      );

    detailChecks.push({
      title:
        item.title,

      sourceUrl:
        item.sourceUrl,

      publishedAt:
        item.publishedAt,

      status:
        detail.status,

      pass
    });
  }

  const detailPass =
    detailChecks.filter(
      item =>
        item.pass
    ).length;

  const duplicateUrls =
    extracted.length
    -
    uniqueItems.length;

  const publishedAtNull =
    samples.filter(
      item =>
        !item.publishedAt
    ).length;

  const success =
    rows.length > 0
    &&
    extracted.length >= 3
    &&
    uniqueItems.length >= 3
    &&
    samples.length >= 3
    &&
    publishedAtNull === 0
    &&
    detailPass >= 3;

  return {
    success,

    totalRows:
      rows.length,

    extracted:
      extracted.length,

    unique:
      uniqueItems.length,

    sampleCount:
      samples.length,

    samples,

    detailChecks,

    detailPass,

    publishedAtNull,

    duplicateUrls
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
          process.platform === "win32"
      }
    );

  return {
    exitCode:
      result.status,

    stdout:
      String(
        result.stdout || ""
      ).slice(-12000),

    stderr:
      String(
        result.stderr || ""
      ).slice(-5000)
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const finalized =
    read(
      FINALIZATION_FILE,
      {}
    );

  const ready =
    read(
      ACTIVATION_READY_FILE,
      {}
    );

  if (
    finalized.decision
      !== "COLLECTOR_READY"
  ) {
    throw new Error(
      "KEIMYUNG_NOT_COLLECTOR_READY"
    );
  }

  if (
    ready.decision
      !== "ACTIVATION_READY"
  ) {
    throw new Error(
      "KEIMYUNG_NOT_ACTIVATION_READY"
    );
  }

  const catalogBefore =
    read(
      CATALOG_FILE,
      {
        universities:
          []
      }
    );

  const existingUniversity =
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

  if (!existingUniversity) {
    throw new Error(
      "KEIMYUNG_CATALOG_ENTRY_NOT_FOUND"
    );
  }

  const existingSources =
    Array.isArray(
      existingUniversity.sources
    )
      ? existingUniversity.sources
      : [];

  if (
    existingSources.some(
      source =>
        source.id === SOURCE_ID
    )
  ) {
    throw new Error(
      "SOURCE_ID_ALREADY_EXISTS"
    );
  }

  const listUrl =
    normalizeUrl(
      finalized
        .proposedSource
        .listUrl
    );

  if (!listUrl) {
    throw new Error(
      "INVALID_LIST_URL"
    );
  }

  if (
    existingSources.some(
      source =>
        normalizeUrl(
          source.listUrl
        ) === listUrl
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
      "2.0",

    generatedAt:
      new Date().toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    sourceId:
      SOURCE_ID,

    backupDir,

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

    beforeHashes,

    afterHashes:
      null,

    error:
      null,

    safety: {
      storeModified:
        false,

      previewModified:
        false,

      gitTriggered:
        false,

      deploymentTriggered:
        false
    }
  };

  try {
    const catalog =
      read(
        CATALOG_FILE,
        {
          universities:
            []
        }
      );

    const target =
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

    if (!target) {
      throw new Error(
        "TARGET_MISSING_BEFORE_WRITE"
      );
    }

    if (
      !Array.isArray(
        target.sources
      )
    ) {
      target.sources = [];
    }

    const source = {
      id:
        SOURCE_ID,

      name:
        "계명대학교 학사공지",

      category:
        "school_notice",

      sourceType:
        "official",

      collectionType:
        "html",

      listUrl,

      selectors: {
        item:
          "tbody tr",

        title:
          "td.subject a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']",

        link:
          "td.subject a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']",

        linkAttribute:
          "href",

        date:
          "td.date"
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
          .toISOString(),

      campusScope:
        "CAMPUS_SPECIFIC"
    };

    target.sources.push(
      source
    );

    atomic(
      CATALOG_FILE,
      catalog
    );

    result.sourceAdded =
      true;

    const written =
      read(
        CATALOG_FILE,
        {
          universities:
            []
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
          source.id === SOURCE_ID
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
        "CATALOG_WRITE_VERIFICATION_FAILED"
      );
    }

    result.dryRun =
      await runDryValidation(
        writtenSource
      );

    if (
      !result.dryRun.success
    ) {
      throw new Error(
        "POST_ACTIVATION_DRY_RUN_FAILED"
      );
    }

    if (
      result.dryRun
        .publishedAtNull !== 0
    ) {
      throw new Error(
        "POST_ACTIVATION_NULL_DATE_FOUND"
      );
    }

    result.tests =
      runTests();

    if (
      result.tests.exitCode !== 0
    ) {
      throw new Error(
        "NPM_TEST_FAILED"
      );
    }

    const interimHashes =
      snapshotHashes();

    if (
      interimHashes.store
        !== beforeHashes.store
    ) {
      throw new Error(
        "STORE_MUTATED_UNEXPECTEDLY"
      );
    }

    if (
      interimHashes.preview
        !== beforeHashes.preview
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
          result.dryRun
            ? {
                success:
                  result.dryRun.success,

                rows:
                  result.dryRun.totalRows,

                extracted:
                  result.dryRun.extracted,

                unique:
                  result.dryRun.unique,

                samples:
                  result.dryRun.sampleCount,

                detailPass:
                  result.dryRun.detailPass,

                publishedAtNull:
                  result.dryRun.publishedAtNull,

                duplicateUrls:
                  result.dryRun.duplicateUrls
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
        error.stack ||
        error.message
      );

      process.exitCode = 1;
    }
  );
}


module.exports = {
  normalizeId,
  normalizeUrl,
  plain,
  parseDate,
  officialDomain,
  isDetailUrl,
  extractRows,
  extractTdByClass,
  extractAnchors,
  parseKeimyungRow,
  runDryValidation
};