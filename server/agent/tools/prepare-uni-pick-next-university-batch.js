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

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const FINAL_STATUS_FILE = path.join(
  DATA,
  "uni-pick-pilot-final-status.json"
);

const EVALUATION_FILE = path.join(
  DATA,
  "uni-pick-recovered-pilot-evaluation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-next-university-batch.json"
);

const BATCH_SIZE = 10;

/* ============================================================
 * Utilities
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
  )
    .normalize("NFC")
    .trim();
}

function normalizeText(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .trim();
}

/* ============================================================
 * Catalog helpers
 * ============================================================ */

function getUniversities(catalog) {
  if (!catalog) {
    return [];
  }

  if (Array.isArray(catalog)) {
    return catalog;
  }

  if (
    Array.isArray(
      catalog.universities
    )
  ) {
    return catalog.universities;
  }

  if (
    Array.isArray(
      catalog.items
    )
  ) {
    return catalog.items;
  }

  return [];
}

function getSources(university) {
  return Array.isArray(
    university?.sources
  )
    ? university.sources
    : [];
}

function getDirectVerifiedSources(
  university
) {
  return getSources(
    university
  ).filter(
    source =>
      source?.verified === true
      &&
      source?.enabled === true
  );
}

/* ============================================================
 * Shared source visibility
 * ============================================================ */

function buildSharedVisibleMap(
  universities
) {
  const map =
    new Map();

  for (
    const university
    of universities
  ) {
    const ownerId =
      normalizeId(
        university.universityId
      );

    for (
      const source
      of getSources(university)
    ) {
      if (
        source?.verified !== true
        ||
        source?.enabled !== true
        ||
        source?.campusScope
          !== "SHARED_SOURCE"
      ) {
        continue;
      }

      const canonicalOwner =
        normalizeId(
          source.canonicalOwner
          || ownerId
        );

      const visible =
        Array.isArray(
          source.visibleToCampuses
        )
          ? source.visibleToCampuses
          : [];

      for (
        const campusId
        of visible
      ) {
        const id =
          normalizeId(
            campusId
          );

        if (!id) {
          continue;
        }

        if (!map.has(id)) {
          map.set(
            id,
            []
          );
        }

        map.get(id).push({
          sourceId:
            source.id
            || null,

          listUrl:
            source.listUrl
            || null,

          canonicalOwner,

          campusScope:
            source.campusScope,

          collectOnce:
            source.collectOnce
            === true,

          duplicateStorage:
            source.duplicateStorage
            === true
        });
      }
    }
  }

  return map;
}

/* ============================================================
 * Existing pilot state
 * ============================================================ */

function buildPilotStateMap(
  evaluation
) {
  const map =
    new Map();

  for (
    const item
    of evaluation?.evaluatedItems
    || []
  ) {
    const id =
      normalizeId(
        item.universityId
      );

    if (!id) {
      continue;
    }

    map.set(
      id,
      item
    );
  }

  return map;
}

/* ============================================================
 * Candidate scoring
 * ============================================================ */

function scoreUniversity(
  university
) {
  let score = 0;

  const homepage =
    normalizeText(
      university.homepage
      ||
      university.homepageUrl
      ||
      university.url
    );

  const name =
    normalizeText(
      university.universityName
      ||
      university.name
    );

  if (homepage) {
    score += 30;
  }

  if (
    /^https?:\/\//i.test(
      homepage
    )
  ) {
    score += 20;
  }

  if (name) {
    score += 10;
  }

  /*
   * 본교를 먼저 처리하되
   * 제2캠퍼스/캠퍼스도 제외하지 않습니다.
   */
  if (
    /본교/.test(
      normalizeId(
        university.universityId
      )
    )
  ) {
    score += 10;
  }

  /*
   * source placeholder가 있으면
   * 완전 무자료 대학보다 약간 우선합니다.
   */
  const sources =
    getSources(
      university
    );

  if (
    sources.length > 0
  ) {
    score += 5;
  }

  return score;
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      CATALOG_FILE
    )
  ) {
    throw new Error(
      "CATALOG_FILE_NOT_FOUND"
    );
  }

  if (
    !fs.existsSync(
      FINAL_STATUS_FILE
    )
  ) {
    throw new Error(
      "PILOT_FINAL_STATUS_NOT_FOUND"
    );
  }

  const finalStatus =
    readJson(
      FINAL_STATUS_FILE
    );

  if (
    !finalStatus
    ||
    finalStatus.status
      !== "PILOT_COMPLETE"
    ||
    finalStatus.pilotComplete
      !== true
  ) {
    throw new Error(
      "PREVIOUS_PILOT_NOT_COMPLETE"
    );
  }

  const catalog =
    readJson(
      CATALOG_FILE,
      {
        universities: []
      }
    );

  const evaluation =
    readJson(
      EVALUATION_FILE,
      {
        evaluatedItems: []
      }
    );

  const universities =
    getUniversities(
      catalog
    );

  const sharedVisibleMap =
    buildSharedVisibleMap(
      universities
    );

  const pilotStateMap =
    buildPilotStateMap(
      evaluation
    );

  const skipped = {
    directVerified:
      [],

    sharedVisible:
      [],

    environmentBlocked:
      [],

    invalidUniversity:
      []
  };

  const candidates = [];

  for (
    const university
    of universities
  ) {
    const universityId =
      normalizeId(
        university.universityId
        ||
        university.id
      );

    const universityName =
      normalizeText(
        university.universityName
        ||
        university.name
      );

    if (
      !universityId
      ||
      !universityName
    ) {
      skipped.invalidUniversity.push({
        universityId:
          universityId || null,

        universityName:
          universityName || null
      });

      continue;
    }

    const directVerified =
      getDirectVerifiedSources(
        university
      );

    if (
      directVerified.length > 0
    ) {
      skipped.directVerified.push({
        universityId,
        universityName,

        sourceIds:
          directVerified.map(
            source =>
              source.id
              || null
          )
      });

      continue;
    }

    const sharedVisible =
      sharedVisibleMap.get(
        universityId
      )
      || [];

    if (
      sharedVisible.length > 0
    ) {
      skipped.sharedVisible.push({
        universityId,
        universityName,
        sharedSources:
          sharedVisible
      });

      continue;
    }

    const oldState =
      pilotStateMap.get(
        universityId
      );

    if (
      oldState?.nextClass
        ===
        "ENVIRONMENT_WAF_BLOCKED"
    ) {
      skipped.environmentBlocked.push({
        universityId,
        universityName,

        reason:
          oldState.reason
          || null,

        networkSubtype:
          oldState.networkSubtype
          || null,

        nextAction:
          oldState.nextAction
          || null
      });

      continue;
    }

    const homepage =
      normalizeText(
        university.homepage
        ||
        university.homepageUrl
        ||
        university.url
      );

    const existingSources =
      getSources(
        university
      );

    candidates.push({
      universityId,
      universityName,

      homepage:
        homepage || null,

      existingSourceCount:
        existingSources.length,

      unverifiedSourceCount:
        existingSources.filter(
          source =>
            !(
              source?.verified === true
              &&
              source?.enabled === true
            )
        ).length,

      score:
        scoreUniversity(
          university
        ),

      previousPilotState:
        oldState
          ? {
              nextClass:
                oldState.nextClass
                || null,

              finalStatus:
                oldState.finalStatus
                || null,

              networkSubtype:
                oldState.networkSubtype
                || null
            }
          : null
    });
  }

  candidates.sort(
    (a, b) =>
      b.score
      -
      a.score
      ||
      a.universityName.localeCompare(
        b.universityName,
        "ko"
      )
  );

  const batch =
    candidates.slice(
      0,
      BATCH_SIZE
    );

  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    status:
      batch.length > 0
        ? "NEXT_BATCH_READY"
        : "NO_MORE_CANDIDATES",

    previousPilot: {
      status:
        finalStatus.status,

      processed:
        finalStatus.processed,

      resolved:
        finalStatus.resolvedCount,

      environmentBlocked:
        finalStatus.environmentBlockedCount
    },

    batchSizeRequested:
      BATCH_SIZE,

    batchSizeSelected:
      batch.length,

    totalCatalogUniversities:
      universities.length,

    totalEligibleCandidates:
      candidates.length,

    skippedCounts: {
      directVerified:
        skipped.directVerified.length,

      sharedVisible:
        skipped.sharedVisible.length,

      environmentBlocked:
        skipped.environmentBlocked.length,

      invalidUniversity:
        skipped.invalidUniversity.length
    },

    batch:
      batch.map(
        (
          item,
          index
        ) => ({
          order:
            index + 1,

          ...item,

          initialAction:
            "RUN_SAFE_DISCOVERY"
        })
      ),

    deferredEnvironmentBlocked:
      skipped.environmentBlocked,

    nextAction:
      batch.length > 0
        ? "RUN_NEXT_BATCH_SAFE_DISCOVERY"
        : "REVIEW_CATALOG_COMPLETION",

    selectionPolicy: {
      verifiedEnabledExcluded:
        true,

      sharedVisibleExcluded:
        true,

      environmentWafBlockedDeferred:
        true,

      batchSize:
        BATCH_SIZE,

      productionMutation:
        false
    },

    safety: {
      readOnly:
        true,

      networkRequests:
        0,

      sourceModified:
        false,

      catalogModified:
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

        totalCatalogUniversities:
          report.totalCatalogUniversities,

        totalEligibleCandidates:
          report.totalEligibleCandidates,

        batchSizeSelected:
          report.batchSizeSelected,

        skippedCounts:
          report.skippedCounts,

        batch:
          report.batch.map(
            item => ({
              order:
                item.order,

              universityId:
                item.universityId,

              universityName:
                item.universityName,

              score:
                item.score,

              homepage:
                item.homepage
            })
          ),

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

    process.exitCode =
      1;
  }
}