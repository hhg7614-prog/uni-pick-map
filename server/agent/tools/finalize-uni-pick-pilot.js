"use strict";

const fs = require("fs");
const path = require("path");

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

const EVALUATION_FILE = path.join(
  DATA,
  "uni-pick-recovered-pilot-evaluation.json"
);

const NEXT_ACTION_FILE = path.join(
  DATA,
  "uni-pick-autonomous-next-action.json"
);

const CLEANUP_FILE = path.join(
  DATA,
  "uni-pick-stale-pilot-cleanup.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-pilot-final-status.json"
);

function readJson(
  file,
  fallback = null
) {
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
  ).normalize("NFC");
}

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

  if (
    !fs.existsSync(
      NEXT_ACTION_FILE
    )
  ) {
    throw new Error(
      "NEXT_ACTION_FILE_NOT_FOUND"
    );
  }

  const evaluation =
    readJson(
      EVALUATION_FILE,
      {
        evaluatedItems: [],
        counts: {}
      }
    );

  const planner =
    readJson(
      NEXT_ACTION_FILE,
      {
        evaluatedItems: [],
        counts: {}
      }
    );

  const cleanup =
    readJson(
      CLEANUP_FILE,
      null
    );

  const evaluatedItems =
    Array.isArray(
      evaluation.evaluatedItems
    )
      ? evaluation.evaluatedItems
      : [];

  const plannerItems =
    Array.isArray(
      planner.evaluatedItems
    )
      ? planner.evaluatedItems
      : [];

  const resolvedItems =
    evaluatedItems.filter(
      item =>
        item.resolved === true
        ||
        item.nextClass ===
          "RESOLVED_BY_EXISTING_VERIFIED_SOURCE"
    );

  const environmentBlockedItems =
    evaluatedItems.filter(
      item =>
        item.nextClass ===
        "ENVIRONMENT_WAF_BLOCKED"
    );

  const unresolvedUnexpected =
    evaluatedItems.filter(
      item =>
        item.resolved !== true
        &&
        item.nextClass !==
          "ENVIRONMENT_WAF_BLOCKED"
    );

  const actionableItems =
    plannerItems.filter(
      item =>
        item.actionable === true
    );

  const resolvedIds =
    new Set(
      resolvedItems.map(
        item =>
          normalizeId(
            item.universityId
          )
      )
    );

  const blockedIds =
    new Set(
      environmentBlockedItems.map(
        item =>
          normalizeId(
            item.universityId
          )
      )
    );

  const overlap =
    [
      ...resolvedIds
    ].filter(
      id =>
        blockedIds.has(id)
    );

  const processed =
    evaluatedItems.length;

  const resolvedCount =
    resolvedItems.length;

  const environmentBlockedCount =
    environmentBlockedItems.length;

  const actionableCount =
    actionableItems.length;

  const cleanupSafe =
    !cleanup
    ||
    cleanup.status ===
      "STALE_STATE_CLEANED";

  const pilotComplete =
    Boolean(
      processed > 0
      &&
      unresolvedUnexpected.length === 0
      &&
      actionableCount === 0
      &&
      overlap.length === 0
      &&
      resolvedCount
        +
        environmentBlockedCount
        ===
        processed
      &&
      cleanupSafe
    );

  const status =
    pilotComplete
      ? "PILOT_COMPLETE"
      : "PILOT_REVIEW_REQUIRED";

  const nextAction =
    pilotComplete
      ? "PREPARE_NEXT_UNIVERSITY_BATCH"
      : "REVIEW_PILOT_BLOCKERS";

  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    status,

    pilotComplete,

    processed,

    resolvedCount,

    environmentBlockedCount,

    actionableCount,

    unexpectedUnresolvedCount:
      unresolvedUnexpected.length,

    overlapCount:
      overlap.length,

    counts:
      evaluation.counts || {},

    environmentBlocked:
      environmentBlockedItems.map(
        item => ({
          universityId:
            item.universityId,

          universityName:
            item.universityName,

          nextClass:
            item.nextClass,

          networkSubtype:
            item.networkSubtype,

          cooldown:
            item.cooldown === true,

          retryable:
            item.retryable === true,

          nextAction:
            item.nextAction || null,

          reason:
            item.reason || null
        })
      ),

    unexpectedUnresolved:
      unresolvedUnexpected.map(
        item => ({
          universityId:
            item.universityId,

          universityName:
            item.universityName,

          nextClass:
            item.nextClass,

          nextAction:
            item.nextAction || null,

          reason:
            item.reason || null
        })
      ),

    planner: {
      resolvedCount:
        planner.resolvedCount
        ??
        planner.resolved
        ??
        0,

      cooldownCount:
        planner.cooldownCount
        ??
        planner.cooldown
        ??
        0,

      environmentBlockedCount:
        planner.environmentBlockedCount
        ??
        planner.environmentBlocked
        ??
        environmentBlockedCount,

      actionableCount:
        planner.actionableCount
        ??
        planner.actionable
        ??
        actionableCount,

      nextAction:
        planner.nextAction
        || null
    },

    cleanup: cleanup
      ? {
          status:
            cleanup.status || null,

          staleRemoved:
            cleanup.staleRemoved
            ?? null,

          transientBefore:
            cleanup.transientBefore
            ?? null,

          transientAfter:
            cleanup.transientAfter
            ?? null,

          rollback:
            cleanup.rollback
            === true
        }
      : null,

    completionPolicy: {
      resolvedOrEnvironmentBlockedOnly:
        true,

      environmentBlockedAcceptedAsDeferred:
        true,

      actionableMustBeZero:
        true,

      nextActionMustBeNull:
        true,

      staleTransientStateCleaned:
        cleanupSafe,

      productionMutation:
        false
    },

    nextAction,

    safety: {
      readOnly:
        true,

      networkRequests:
        0,

      sourceModified:
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

  atomicWrite(
    OUTPUT_FILE,
    report
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        pilotComplete:
          report.pilotComplete,

        processed:
          report.processed,

        resolved:
          report.resolvedCount,

        environmentBlocked:
          report.environmentBlockedCount,

        actionable:
          report.actionableCount,

        unexpectedUnresolved:
          report.unexpectedUnresolvedCount,

        nextAction:
          report.nextAction,

        outputFile:
          OUTPUT_FILE,

        safety:
          report.safety
      },
      null,
      2
    )
  );

  if (!pilotComplete) {
    process.exitCode = 2;
  }
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
              error.name,

            message:
              error.message
          }
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
}