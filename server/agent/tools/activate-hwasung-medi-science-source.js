"use strict";

/**
 * UNI PICK - HSMU Safe Source Activator v1
 *
 * 목적
 * ---------------------------------------------------------
 * ACTIVATION_READY를 통과한 화성의과학대학교 공식 소식 source를
 * 실제 source catalog에 로컬 활성화한다.
 *
 * 수행
 * ---------------------------------------------------------
 * 1. ACTIVATION_READY 결과 확인
 * 2. Catalog 대학/source 중복 재확인
 * 3. Catalog/Store/Preview 백업
 * 4. source 추가
 * 5. Catalog write 검증
 * 6. 실제 목록 재수집
 * 7. 상세 5건 재검증
 * 8. npm test
 * 9. Store/Preview 불변 확인
 * 10. 실패 시 자동 rollback
 *
 * 하지 않는 것
 * ---------------------------------------------------------
 * - news store 수집 결과 저장
 * - preview 쓰기
 * - queue 변경
 * - git add / commit / push
 * - deployment
 *
 * 실행
 * ---------------------------------------------------------
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\activate-hwasung-medi-science-source.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

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

const ACTIVATION_READY_FILE = path.join(
  DATA,
  "hwasung-medi-science-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-source-activation.json"
);

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "hwasung-medi-science-source-activation"
);

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const SOURCE_ID =
  "hwasung-medi-science-general-feed";

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
 * Hash / Backup
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

  const dir =
    path.join(
      BACKUP_ROOT,
      stamp
    );

  fs.mkdirSync(
    dir,
    {
      recursive: true
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
      fs.existsSync(
        file
      )
    ) {
      fs.copyFileSync(
        file,
        path.join(
          dir,
          path.basename(
            file
          )
        )
      );
    }
  }

  return dir;
}


function rollback(backupDir) {
  for (
    const [backupName, destination]
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
        backupName
      );

    if (
      fs.existsSync(
        backup
      )
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
          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK HSMU Safe Activator",

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

  const titles =
    extractTitleCandidates(
      raw
    );

  const title =
    titles[0];

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
 * Detail Validation
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

      titleMatch:
        false,

      dateMatch:
        false,

      pass:
        false,

      reason:
        "DETAIL_UNREACHABLE",

      error:
        page.error || null
    };
  }

  const official =
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
      official
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
      official,

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
 * npm test
 * ========================================================= */

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
      ACTIVATION_READY_FILE,
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
      "HSMU_NOT_ACTIVATION_READY"
    );
  }


  const proposed =
    readiness.proposedActivation
      ?.source;


  if (!proposed) {
    throw new Error(
      "HSMU_PROPOSED_SOURCE_MISSING"
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
      "HSMU_CATALOG_ENTRY_NOT_FOUND"
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
        === targetListUrl
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

    backupDir,

    dryRun:
      null,

    tests:
      null,

    rollback:
      false,

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
          universities:
            []
        }
      );


    const target =
      catalog.universities.find(
        university =>
          normalizeId(
            university.universityId
          )
          ===
          normalizeId(
            UNIVERSITY_ID
          )
      );


    if (!target) {
      throw new Error(
        "TARGET_DISAPPEARED_BEFORE_WRITE"
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
        "화성의과학대학교 공식 소식",

      category:
        "school_news",

      sourceType:
        "official",

      collectionType:
        "custom_html",

      listUrl:
        targetListUrl,

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
        "verified",

      healthStatus:
        "validated",

      verifiedAt:
        new Date()
          .toISOString()
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


    /* -----------------------------------------------------
     * Catalog write verification
     * --------------------------------------------------- */

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
        university =>
          normalizeId(
            university.universityId
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
     * Post-activation dry run
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
        detailChecks.length === 5
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

      distinctIds,

      distinctTitles,

      distinctDates,

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
     * Operational mutation guard
     * --------------------------------------------------- */

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

                duplicateKeys:
                  result.dryRun.duplicateKeys,

                distinctIds:
                  result.dryRun.distinctIds,

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
  snapshotHashes
};