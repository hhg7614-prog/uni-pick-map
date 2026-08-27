"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/* ============================================================
 * 1. 기본 경로
 * ============================================================ */

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

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "kyungdong-shared-source-activation"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const READY_FILE = path.join(
  DATA,
  "kyungdong-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungdong-shared-source-activation.json"
);

const STORE_CANDIDATES = [
  path.join(
    DATA,
    "university-news-store.json"
  ),
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-store.json"
  )
];

const PREVIEW_CANDIDATES = [
  path.join(
    DATA,
    "university-news-preview.json"
  ),
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-preview.json"
  )
];

/* ============================================================
 * 2. 정책
 * ============================================================ */

const CANONICAL_OWNER =
  "kyungdong-university-본교";

const VISIBLE_TO_CAMPUSES = [
  "kyungdong-university-본교",
  "kyungdong-university-제2캠퍼",
  "kyungdong-university-제3캠퍼",
  "kyungdong-university-제4캠퍼"
];

const LEGACY_SOURCE_IDS = [
  "kyungdong-main-general-notice",
  "kyungdong-campus2-general-notice",
  "kyungdong-campus3-general-notice",
  "kyungdong-campus4-general-notice"
];

const NEW_SOURCE_ID =
  "kyungdong-shared-general-notice";

/* ============================================================
 * 3. Utility
 * ============================================================ */

function readJson(
  file,
  fallback = null
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      ).replace(
        /^\uFEFF/,
        ""
      )
    );
  } catch {
    return fallback;
  }
}

function atomicWrite(
  file,
  value
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  const temporary =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      temporary,
      "utf8"
    )
  );

  fs.renameSync(
    temporary,
    file
  );
}

function normalizeId(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
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
      );

    url.hash = "";

    return url.href;
  } catch {
    return String(
      value
    ).trim();
  }
}

function timestampForPath() {
  const now =
    new Date();

  const pad =
    value =>
      String(value)
        .padStart(2, "0");

  return (
    now.getFullYear()
    +
    pad(
      now.getMonth() + 1
    )
    +
    pad(
      now.getDate()
    )
    +
    pad(
      now.getHours()
    )
    +
    pad(
      now.getMinutes()
    )
    +
    pad(
      now.getSeconds()
    )
  );
}

function sha256(file) {
  if (
    !file
    ||
    !fs.existsSync(file)
  ) {
    return null;
  }

  const crypto =
    require("crypto");

  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(file)
    )
    .digest("hex");
}

function firstExistingFile(
  candidates
) {
  return (
    candidates.find(
      file =>
        fs.existsSync(file)
    )
    || null
  );
}

/* ============================================================
 * 4. Catalog helpers
 * ============================================================ */

function findUniversity(
  catalog,
  universityId
) {
  return (
    catalog?.universities
    || []
  ).find(
    university =>
      normalizeId(
        university.universityId
      )
      ===
      normalizeId(
        universityId
      )
  )
  || null;
}

function getSources(
  university
) {
  if (
    !Array.isArray(
      university?.sources
    )
  ) {
    university.sources = [];
  }

  return university.sources;
}

function collectAllSources(
  catalog
) {
  const rows = [];

  for (
    const university
    of catalog?.universities || []
  ) {
    for (
      const source
      of university.sources || []
    ) {
      rows.push({
        universityId:
          university.universityId,

        universityName:
          university.universityName,

        source
      });
    }
  }

  return rows;
}

/* ============================================================
 * 5. Backup
 * ============================================================ */

function copyIfExists(
  source,
  destination
) {
  if (
    !source
    ||
    !fs.existsSync(source)
  ) {
    return false;
  }

  fs.mkdirSync(
    path.dirname(destination),
    {
      recursive: true
    }
  );

  fs.copyFileSync(
    source,
    destination
  );

  return true;
}

function createBackup({
  catalogFile,
  storeFile,
  previewFile
}) {
  const backupDir =
    path.join(
      BACKUP_ROOT,
      timestampForPath()
    );

  fs.mkdirSync(
    backupDir,
    {
      recursive: true
    }
  );

  copyIfExists(
    catalogFile,
    path.join(
      backupDir,
      path.basename(
        catalogFile
      )
    )
  );

  if (storeFile) {
    copyIfExists(
      storeFile,
      path.join(
        backupDir,
        path.basename(
          storeFile
        )
      )
    );
  }

  if (previewFile) {
    copyIfExists(
      previewFile,
      path.join(
        backupDir,
        path.basename(
          previewFile
        )
      )
    );
  }

  return backupDir;
}

/* ============================================================
 * 6. Activation preflight
 * ============================================================ */

function validateReadyState(
  ready
) {
  if (
    ready?.decision
    !== "ACTIVATION_READY"
  ) {
    throw new Error(
      "KYUNGDONG_NOT_ACTIVATION_READY"
    );
  }

  if (
    ready?.activationReady
    !== true
  ) {
    throw new Error(
      "KYUNGDONG_ACTIVATION_READY_FALSE"
    );
  }

  if (
    normalizeId(
      ready?.canonicalOwner
    )
    !==
    normalizeId(
      CANONICAL_OWNER
    )
  ) {
    throw new Error(
      "KYUNGDONG_CANONICAL_OWNER_MISMATCH"
    );
  }

  const proposedSource =
    ready?.proposedActivation
      ?.source;

  if (!proposedSource) {
    throw new Error(
      "KYUNGDONG_PROPOSED_SOURCE_MISSING"
    );
  }

  if (
    proposedSource.id
    !== NEW_SOURCE_ID
  ) {
    throw new Error(
      "KYUNGDONG_SOURCE_ID_MISMATCH"
    );
  }

  if (
    proposedSource
      .campusScope
    !== "SHARED_SOURCE"
  ) {
    throw new Error(
      "KYUNGDONG_CAMPUS_SCOPE_MISMATCH"
    );
  }

  if (
    proposedSource.collectOnce
    !== true
  ) {
    throw new Error(
      "KYUNGDONG_COLLECT_ONCE_REQUIRED"
    );
  }

  if (
    proposedSource
      .duplicateStorage
    !== false
  ) {
    throw new Error(
      "KYUNGDONG_DUPLICATE_STORAGE_MUST_BE_FALSE"
    );
  }

  const visible =
    proposedSource
      .visibleToCampuses
    || [];

  for (
    const expected
    of VISIBLE_TO_CAMPUSES
  ) {
    if (
      !visible.some(
        value =>
          normalizeId(value)
          ===
          normalizeId(expected)
      )
    ) {
      throw new Error(
        `KYUNGDONG_VISIBLE_CAMPUS_MISSING:${expected}`
      );
    }
  }

  return proposedSource;
}

/* ============================================================
 * 7. Catalog mutation
 * ============================================================ */

function migrateCatalog(
  catalog,
  proposedSource
) {
  const owner =
    findUniversity(
      catalog,
      CANONICAL_OWNER
    );

  if (!owner) {
    throw new Error(
      "KYUNGDONG_CANONICAL_OWNER_NOT_FOUND"
    );
  }

  for (
    const universityId
    of VISIBLE_TO_CAMPUSES
  ) {
    const university =
      findUniversity(
        catalog,
        universityId
      );

    if (!university) {
      throw new Error(
        `KYUNGDONG_CAMPUS_NOT_FOUND:${universityId}`
      );
    }
  }

  const allBefore =
    collectAllSources(
      catalog
    );

  const existingNewSource =
    allBefore.filter(
      row =>
        row.source?.id
        === NEW_SOURCE_ID
    );

  if (
    existingNewSource.length > 0
  ) {
    throw new Error(
      "KYUNGDONG_SHARED_SOURCE_ALREADY_EXISTS"
    );
  }

  const removed = [];

  for (
    const universityId
    of VISIBLE_TO_CAMPUSES
  ) {
    const university =
      findUniversity(
        catalog,
        universityId
      );

    const sources =
      getSources(
        university
      );

    const keep = [];

    for (
      const source
      of sources
    ) {
      if (
        LEGACY_SOURCE_IDS.includes(
          source?.id
        )
      ) {
        removed.push({
          universityId:
            university.universityId,

          universityName:
            university.universityName,

          sourceId:
            source.id,

          listUrl:
            source.listUrl
            || null,

          verified:
            source.verified
            === true,

          enabled:
            source.enabled
            === true,

          status:
            source.status
            || null
        });

        continue;
      }

      keep.push(
        source
      );
    }

    university.sources =
      keep;
  }

  if (
    removed.length !== 4
  ) {
    throw new Error(
      `KYUNGDONG_LEGACY_REMOVE_COUNT_${removed.length}`
    );
  }

  const removedIds =
    new Set(
      removed.map(
        item =>
          item.sourceId
      )
    );

  for (
    const expectedId
    of LEGACY_SOURCE_IDS
  ) {
    if (
      !removedIds.has(
        expectedId
      )
    ) {
      throw new Error(
        `KYUNGDONG_LEGACY_SOURCE_NOT_REMOVED:${expectedId}`
      );
    }
  }

  const activatedSource = {
    ...proposedSource,

    verified:
      true,

    enabled:
      true,

    status:
      "verified",

    healthStatus:
      "validated",

    campusScope:
      "SHARED_SOURCE",

    canonicalOwner:
      CANONICAL_OWNER,

    visibleToCampuses:
      [
        ...VISIBLE_TO_CAMPUSES
      ],

    collectOnce:
      true,

    duplicateStorage:
      false
  };

  getSources(
    owner
  ).push(
    activatedSource
  );

  return {
    removed,
    activatedSource
  };
}

/* ============================================================
 * 8. Post-mutation validation
 * ============================================================ */

function validateMigratedCatalog(
  catalog,
  activatedSource
) {
  const all =
    collectAllSources(
      catalog
    );

  const newMatches =
    all.filter(
      row =>
        row.source?.id
        === NEW_SOURCE_ID
    );

  if (
    newMatches.length !== 1
  ) {
    throw new Error(
      `KYUNGDONG_SHARED_SOURCE_COUNT_${newMatches.length}`
    );
  }

  const newMatch =
    newMatches[0];

  if (
    normalizeId(
      newMatch.universityId
    )
    !==
    normalizeId(
      CANONICAL_OWNER
    )
  ) {
    throw new Error(
      "KYUNGDONG_SHARED_SOURCE_NOT_OWNER_ONLY"
    );
  }

  if (
    newMatch.source
      ?.verified
    !== true
    ||
    newMatch.source
      ?.enabled
    !== true
  ) {
    throw new Error(
      "KYUNGDONG_SHARED_SOURCE_NOT_ENABLED"
    );
  }

  if (
    newMatch.source
      ?.campusScope
    !== "SHARED_SOURCE"
  ) {
    throw new Error(
      "KYUNGDONG_SHARED_SOURCE_SCOPE_INVALID"
    );
  }

  if (
    newMatch.source
      ?.collectOnce
    !== true
  ) {
    throw new Error(
      "KYUNGDONG_SHARED_SOURCE_COLLECT_ONCE_INVALID"
    );
  }

  if (
    newMatch.source
      ?.duplicateStorage
    !== false
  ) {
    throw new Error(
      "KYUNGDONG_SHARED_SOURCE_DUPLICATE_STORAGE_INVALID"
    );
  }

  const legacyRemaining =
    all.filter(
      row =>
        LEGACY_SOURCE_IDS.includes(
          row.source?.id
        )
    );

  if (
    legacyRemaining.length !== 0
  ) {
    throw new Error(
      "KYUNGDONG_LEGACY_SOURCE_REMAINS"
    );
  }

  const sameUrlMatches =
    all.filter(
      row =>
        normalizeUrl(
          row.source?.listUrl
        )
        ===
        normalizeUrl(
          activatedSource.listUrl
        )
    );

  if (
    sameUrlMatches.length !== 1
  ) {
    throw new Error(
      `KYUNGDONG_SHARED_LIST_URL_COUNT_${sameUrlMatches.length}`
    );
  }

  for (
    const campusId
    of VISIBLE_TO_CAMPUSES
  ) {
    if (
      !activatedSource
        .visibleToCampuses
        .some(
          id =>
            normalizeId(id)
            ===
            normalizeId(campusId)
        )
    ) {
      throw new Error(
        `KYUNGDONG_SHARED_VISIBILITY_MISSING:${campusId}`
      );
    }
  }

  return {
    ownerOnly:
      true,

    sourceCount:
      newMatches.length,

    legacyRemaining:
      legacyRemaining.length,

    sameListUrlCount:
      sameUrlMatches.length,

    visibleCampusCount:
      activatedSource
        .visibleToCampuses
        .length
  };
}

/* ============================================================
 * 9. Tests
 * ============================================================ */

function runNodeCheck(file) {
  const nodeExe =
    process.execPath;

  const result =
    spawnSync(
      nodeExe,
      [
        "--check",
        file
      ],
      {
        encoding:
          "utf8",

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
      ).trim(),

    stderr:
      String(
        result.stderr || ""
      ).trim()
  };
}

/* ============================================================
 * 10. Rollback
 * ============================================================ */

function rollbackCatalog(
  backupDir
) {
  const backupCatalog =
    path.join(
      backupDir,
      path.basename(
        CATALOG_FILE
      )
    );

  if (
    !fs.existsSync(
      backupCatalog
    )
  ) {
    return false;
  }

  fs.copyFileSync(
    backupCatalog,
    CATALOG_FILE
  );

  return true;
}

/* ============================================================
 * 11. Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      READY_FILE
    )
  ) {
    throw new Error(
      "KYUNGDONG_ACTIVATION_READY_FILE_NOT_FOUND"
    );
  }

  if (
    !fs.existsSync(
      CATALOG_FILE
    )
  ) {
    throw new Error(
      "CATALOG_FILE_NOT_FOUND"
    );
  }

  const ready =
    readJson(
      READY_FILE
    );

  const proposedSource =
    validateReadyState(
      ready
    );

  const catalog =
    readJson(
      CATALOG_FILE
    );

  if (!catalog) {
    throw new Error(
      "CATALOG_JSON_INVALID"
    );
  }

  const storeFile =
    firstExistingFile(
      STORE_CANDIDATES
    );

  const previewFile =
    firstExistingFile(
      PREVIEW_CANDIDATES
    );

  const hashesBefore = {
    catalog:
      sha256(
        CATALOG_FILE
      ),

    store:
      sha256(
        storeFile
      ),

    preview:
      sha256(
        previewFile
      )
  };

  const backup =
    createBackup({
      catalogFile:
        CATALOG_FILE,

      storeFile,

      previewFile
    });

  let rollback =
    false;

  let migration =
    null;

  let postValidation =
    null;

  let tests = {
    exitCode:
      null
  };

  try {
    migration =
      migrateCatalog(
        catalog,
        proposedSource
      );

    postValidation =
      validateMigratedCatalog(
        catalog,
        migration.activatedSource
      );

    atomicWrite(
      CATALOG_FILE,
      catalog
    );

    const reparsedCatalog =
      readJson(
        CATALOG_FILE
      );

    if (!reparsedCatalog) {
      throw new Error(
        "CATALOG_REPARSE_FAILED"
      );
    }

    validateMigratedCatalog(
      reparsedCatalog,
      migration.activatedSource
    );

    tests =
      runNodeCheck(
        __filename
      );

    if (
      tests.exitCode !== 0
    ) {
      throw new Error(
        "ACTIVATION_SCRIPT_NODE_CHECK_FAILED"
      );
    }
  } catch (error) {
    rollback =
      rollbackCatalog(
        backup
      );

    throw Object.assign(
      error,
      {
        rollback,
        backup
      }
    );
  }

  const hashesAfter = {
    catalog:
      sha256(
        CATALOG_FILE
      ),

    store:
      sha256(
        storeFile
      ),

    preview:
      sha256(
        previewFile
      )
  };

  const result = {
    status:
      "ACTIVATED_LOCAL",

    sourceAdded:
      true,

    legacySourcesRemoved:
      migration.removed.length,

    ownerOnly:
      true,

    secondCampusSourceAdded:
      false,

    thirdCampusSourceAdded:
      false,

    fourthCampusSourceAdded:
      false,

    sharedSourcePolicy: {
      campusScope:
        "SHARED_SOURCE",

      canonicalOwner:
        CANONICAL_OWNER,

      visibleToCampuses:
        VISIBLE_TO_CAMPUSES,

      collectOnce:
        true,

      duplicateStorage:
        false
    },

    migration: {
      removedSources:
        migration.removed,

      addedSource: {
        id:
          migration.activatedSource.id,

        name:
          migration.activatedSource.name,

        listUrl:
          migration.activatedSource.listUrl,

        verified:
          migration.activatedSource.verified,

        enabled:
          migration.activatedSource.enabled,

        status:
          migration.activatedSource.status,

        healthStatus:
          migration.activatedSource.healthStatus
      }
    },

    postValidation,

    tests: {
      exitCode:
        tests.exitCode
    },

    rollback:
      false,

    hashes: {
      catalogChanged:
        hashesBefore.catalog
        !==
        hashesAfter.catalog,

      storeChanged:
        hashesBefore.store
        !==
        hashesAfter.store,

      previewChanged:
        hashesBefore.preview
        !==
        hashesAfter.preview
    },

    backup,

    outputFile:
      OUTPUT_FILE,

    gitTriggered:
      false,

    deploymentTriggered:
      false,

    error:
      null
  };

  atomicWrite(
    OUTPUT_FILE,
    result
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

/* ============================================================
 * 12. Execute
 * ============================================================ */

if (
  require.main === module
) {
  try {
    main();
  } catch (error) {
    const result = {
      status:
        "FATAL",

      sourceAdded:
        false,

      rollback:
        error?.rollback
        === true,

      backup:
        error?.backup
        || null,

      gitTriggered:
        false,

      deploymentTriggered:
        false,

      error: {
        name:
          error?.name
          || "Error",

        message:
          error?.message
          || String(error),

        stack:
          error?.stack
          || null
      }
    };

    try {
      atomicWrite(
        OUTPUT_FILE,
        result
      );
    } catch {
      // 출력 파일 기록 실패 시에도 원래 오류를 보존한다.
    }

    console.error(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    process.exitCode =
      1;
  }
}