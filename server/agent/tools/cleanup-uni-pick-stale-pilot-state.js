"use strict";

/**
 * UNI PICK
 * Stale Pilot State Cleanup
 *
 * 목적
 * ------------------------------------------------------------
 * 1. 최신 evaluator 결과에서 RESOLVED 처리된 대학의
 *    오래된 transient placeholder 상태를 정리한다.
 *
 * 2. ENVIRONMENT_WAF_BLOCKED 상태는 절대 제거하지 않는다.
 *
 * 3. source catalog / news store / preview는 수정하지 않는다.
 *
 * 4. 원본 transient 파일은 백업 후 atomic write 한다.
 *
 * 5. Git / Deploy는 실행하지 않는다.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(
  __dirname,
  "../../.."
);

const DATA_DIR = path.join(
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
  "uni-pick-stale-pilot-cleanup"
);

const EVALUATION_FILE = path.join(
  DATA_DIR,
  "uni-pick-recovered-pilot-evaluation.json"
);

const TRANSIENT_FILE = path.join(
  DATA_DIR,
  "uni-pick-transient-network-state.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "uni-pick-stale-pilot-cleanup.json"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const STORE_FILE = path.join(
  DATA_DIR,
  "agent-news-store.json"
);

const PREVIEW_FILE = path.join(
  ROOT,
  "data",
  "university-news-preview.json"
);

/* ============================================================
 * 기본 유틸리티
 * ============================================================ */

function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(
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

function atomicWrite(file, value) {
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
  return String(
    value || ""
  ).normalize(
    "NFC"
  );
}

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
      sha256(CATALOG_FILE),

    store:
      sha256(STORE_FILE),

    preview:
      sha256(PREVIEW_FILE),

    transient:
      sha256(TRANSIENT_FILE)
  };
}

function createBackup() {
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

  if (
    fs.existsSync(
      TRANSIENT_FILE
    )
  ) {
    fs.copyFileSync(
      TRANSIENT_FILE,
      path.join(
        backupDir,
        path.basename(
          TRANSIENT_FILE
        )
      )
    );
  }

  return backupDir;
}

function rollback(
  backupDir
) {
  const backupFile =
    path.join(
      backupDir,
      path.basename(
        TRANSIENT_FILE
      )
    );

  if (
    fs.existsSync(
      backupFile
    )
  ) {
    fs.copyFileSync(
      backupFile,
      TRANSIENT_FILE
    );
  }
}

/* ============================================================
 * 평가 상태 판별
 * ============================================================ */

function isResolved(row) {
  return (
    row?.resolved === true
    &&
    row?.nextClass ===
      "RESOLVED_BY_EXISTING_VERIFIED_SOURCE"
  );
}

function isEnvironmentBlocked(row) {
  return (
    row?.nextClass ===
      "ENVIRONMENT_WAF_BLOCKED"
    ||
    row?.localDiscoveryBlocked === true
    ||
    row?.networkSubtype ===
      "ENVIRONMENT_WAF_BLOCKED"
  );
}

function buildEvaluationMaps(
  evaluation
) {
  const resolvedIds =
    new Set();

  const blockedIds =
    new Set();

  const resolvedRows = [];
  const blockedRows = [];

  for (
    const row
    of evaluation?.evaluatedItems || []
  ) {
    const id =
      normalizeId(
        row.universityId
      );

    if (!id) {
      continue;
    }

    if (
      isEnvironmentBlocked(
        row
      )
    ) {
      blockedIds.add(id);
      blockedRows.push(row);
      continue;
    }

    if (
      isResolved(
        row
      )
    ) {
      resolvedIds.add(id);
      resolvedRows.push(row);
    }
  }

  return {
    resolvedIds,
    blockedIds,
    resolvedRows,
    blockedRows
  };
}

/* ============================================================
 * transient 구조 정규화
 * ============================================================ */

function getTransientItems(
  transient
) {
  if (
    Array.isArray(
      transient
    )
  ) {
    return transient;
  }

  if (
    Array.isArray(
      transient?.items
    )
  ) {
    return transient.items;
  }

  return [];
}

function rebuildTransient(
  original,
  items
) {
  if (
    Array.isArray(
      original
    )
  ) {
    return items;
  }

  return {
    ...(original || {}),

    schemaVersion:
      original?.schemaVersion
      || "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    items
  };
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      EVALUATION_FILE
    )
  ) {
    throw new Error(
      "EVALUATION_FILE_NOT_FOUND"
    );
  }

  const evaluation =
    readJson(
      EVALUATION_FILE
    );

  if (!evaluation) {
    throw new Error(
      "EVALUATION_FILE_INVALID"
    );
  }

  const {
    resolvedIds,
    blockedIds,
    resolvedRows,
    blockedRows
  } =
    buildEvaluationMaps(
      evaluation
    );

  if (
    resolvedIds.size === 0
  ) {
    throw new Error(
      "NO_RESOLVED_ITEMS_FOUND"
    );
  }

  if (
    blockedIds.size === 0
  ) {
    throw new Error(
      "ENVIRONMENT_BLOCKED_ITEM_NOT_FOUND"
    );
  }

  const beforeHashes =
    snapshotHashes();

  const originalTransient =
    readJson(
      TRANSIENT_FILE,
      {
        schemaVersion:
          "1.0",

        generatedAt:
          null,

        items:
          []
      }
    );

  const transientItems =
    getTransientItems(
      originalTransient
    );

  const removed = [];
  const preserved = [];

  for (
    const item
    of transientItems
  ) {
    const id =
      normalizeId(
        item?.universityId
      );

    if (
      blockedIds.has(id)
    ) {
      preserved.push({
        ...item,

        cleanupProtection:
          "ENVIRONMENT_WAF_BLOCKED_PRESERVED"
      });

      continue;
    }

    if (
      resolvedIds.has(id)
    ) {
      removed.push({
        universityId:
          item?.universityId
          || null,

        universityName:
          item?.universityName
          || null,

        previousClass:
          item?.currentClass
          || item?.state
          || item?.networkSubtype
          || null,

        reason:
          "VERIFIED_SOURCE_NOW_RESOLVES_UNIVERSITY"
      });

      continue;
    }

    preserved.push(item);
  }

  /*
   * 목포대학교가 transient 파일에 없더라도
   * evaluator의 WAF 상태를 임의 생성하지 않는다.
   *
   * 기존 상태만 보존하는 것이 원칙이다.
   */

  const backupDir =
    createBackup();

  const result = {
    status:
      "STARTED",

    evaluationSchemaVersion:
      evaluation.schemaVersion
      || null,

    resolvedCount:
      resolvedIds.size,

    environmentBlockedCount:
      blockedIds.size,

    transientBefore:
      transientItems.length,

    transientAfter:
      null,

    removedCount:
      removed.length,

    preservedCount:
      null,

    removed,

    blockedPreserved:
      [],

    backup:
      backupDir,

    beforeHashes,

    afterHashes:
      null,

    rollback:
      false,

    error:
      null
  };

  try {
    const newTransient =
      rebuildTransient(
        originalTransient,
        preserved
      );

    atomicWrite(
      TRANSIENT_FILE,
      newTransient
    );

    const written =
      readJson(
        TRANSIENT_FILE
      );

    const writtenItems =
      getTransientItems(
        written
      );

    /*
     * resolved 대학이 남아 있으면 실패
     */

    const staleResolvedRemaining =
      writtenItems.filter(
        item =>
          resolvedIds.has(
            normalizeId(
              item?.universityId
            )
          )
      );

    if (
      staleResolvedRemaining.length > 0
    ) {
      throw new Error(
        "RESOLVED_PLACEHOLDER_REMAINED"
      );
    }

    /*
     * 기존에 존재하던 WAF 상태가 사라졌는지 확인
     */

    const originalBlockedIds =
      new Set(
        transientItems
          .filter(
            item =>
              blockedIds.has(
                normalizeId(
                  item?.universityId
                )
              )
          )
          .map(
            item =>
              normalizeId(
                item?.universityId
              )
          )
      );

    const writtenBlockedIds =
      new Set(
        writtenItems
          .filter(
            item =>
              blockedIds.has(
                normalizeId(
                  item?.universityId
                )
              )
          )
          .map(
            item =>
              normalizeId(
                item?.universityId
              )
          )
      );

    for (
      const id
      of originalBlockedIds
    ) {
      if (
        !writtenBlockedIds.has(id)
      ) {
        throw new Error(
          "ENVIRONMENT_WAF_BLOCKED_STATE_LOST"
        );
      }
    }

    const afterHashes =
      snapshotHashes();

    /*
     * 절대로 변경되면 안 되는 파일
     */

    if (
      beforeHashes.catalog
      !==
      afterHashes.catalog
    ) {
      throw new Error(
        "CATALOG_MUTATED_UNEXPECTEDLY"
      );
    }

    if (
      beforeHashes.store
      !==
      afterHashes.store
    ) {
      throw new Error(
        "STORE_MUTATED_UNEXPECTEDLY"
      );
    }

    if (
      beforeHashes.preview
      !==
      afterHashes.preview
    ) {
      throw new Error(
        "PREVIEW_MUTATED_UNEXPECTEDLY"
      );
    }

    result.status =
      "STALE_STATE_CLEANED";

    result.transientAfter =
      writtenItems.length;

    result.preservedCount =
      writtenItems.length;

    result.blockedPreserved =
      blockedRows.map(
        row => ({
          universityId:
            row.universityId,

          universityName:
            row.universityName,

          nextClass:
            row.nextClass,

          networkSubtype:
            row.networkSubtype,

          cooldown:
            row.cooldown,

          retryable:
            row.retryable,

          nextAction:
            row.nextAction
        })
      );

    result.afterHashes =
      afterHashes;
  } catch (error) {
    rollback(
      backupDir
    );

    result.status =
      "ROLLED_BACK";

    result.rollback =
      true;

    result.error = {
      name:
        error?.name
        || "Error",

      message:
        error?.message
        || String(error)
    };

    result.afterHashes =
      snapshotHashes();
  }

  atomicWrite(
    OUTPUT_FILE,
    result
  );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,

        resolvedEvaluated:
          resolvedRows.length,

        environmentBlockedEvaluated:
          blockedRows.length,

        transientBefore:
          result.transientBefore,

        staleRemoved:
          result.removedCount,

        transientAfter:
          result.transientAfter,

        blockedPreserved:
          result.blockedPreserved,

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
            result.afterHashes?.preview,

          transientChanged:
            result.beforeHashes.transient
            !==
            result.afterHashes?.transient
        },

        rollback:
          result.rollback,

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
}

if (
  require.main === module
) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status:
            "FATAL",

          error: {
            name:
              error?.name
              || "Error",

            message:
              error?.message
              || String(error)
          },

          sourceModified:
            false,

          storeModified:
            false,

          previewModified:
            false,

          gitTriggered:
            false,

          deploymentTriggered:
            false
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
}