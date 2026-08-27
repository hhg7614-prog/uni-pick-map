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

const COLLECTOR_FILE = path.join(
  DATA,
  "kyungdong-candidate-collector-verification.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungdong-activation-ready.json"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const CANONICAL_OWNER =
  "kyungdong-university-본교";

const UNIVERSITY_NAME =
  "경동대학교";

const VISIBLE_TO_CAMPUSES = [
  "kyungdong-university-본교",
  "kyungdong-university-제2캠퍼",
  "kyungdong-university-제3캠퍼",
  "kyungdong-university-제4캠퍼"
];

const SOURCE_ID =
  "kyungdong-shared-general-notice";

const SOURCE_NAME =
  "경동대학교 공통 일반공지";

const LIST_URL =
  "https://www.kduniv.ac.kr/kor/CMS/Board/Board.do?mCode=MN245";

const LEGACY_SOURCE_IDS = [
  "kyungdong-main-general-notice",
  "kyungdong-campus2-general-notice",
  "kyungdong-campus3-general-notice",
  "kyungdong-campus4-general-notice"
];

/* ============================================================
 * JSON
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

/* ============================================================
 * Normalize
 * ============================================================ */

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

/* ============================================================
 * Catalog
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

function getSources(university) {
  return Array.isArray(
    university?.sources
  )
    ? university.sources
    : [];
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
      of getSources(university)
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
 * Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      COLLECTOR_FILE
    )
  ) {
    throw new Error(
      "KYUNGDONG_COLLECTOR_FILE_NOT_FOUND"
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

  const collector =
    readJson(
      COLLECTOR_FILE
    );

  const catalog =
    readJson(
      CATALOG_FILE
    );

  if (!collector) {
    throw new Error(
      "KYUNGDONG_COLLECTOR_INVALID"
    );
  }

  if (!catalog) {
    throw new Error(
      "CATALOG_INVALID"
    );
  }

  const reasons = [];

  /* ----------------------------------------------------------
   * 1. Collector 검증
   * ---------------------------------------------------------- */

  const collectorReady =
    collector.decision
      === "COLLECTOR_READY";

  if (!collectorReady) {
    reasons.push(
      "COLLECTOR_NOT_READY"
    );
  }

  const extracted =
    Number(
      collector.collector
        ?.extracted
      || 0
    );

  const unique =
    Number(
      collector.collector
        ?.unique
      || 0
    );

  const distinctTitles =
    Number(
      collector.collector
        ?.distinctTitles
      || 0
    );

  const distinctDates =
    Number(
      collector.collector
        ?.distinctDates
      || 0
    );

  const detailTested =
    Number(
      collector.detailValidation
        ?.tested
      || 0
    );

  const detailPass =
    Number(
      collector.detailValidation
        ?.pass
      || 0
    );

  const titlePass =
    Number(
      collector.detailValidation
        ?.titlePass
      || 0
    );

  const datePass =
    Number(
      collector.detailValidation
        ?.datePass
      || 0
    );

  const validUrls =
    Number(
      collector.detailValidation
        ?.validUrls
      || 0
    );

  const collectorMetricsPass =
    extracted >= 5
    &&
    unique >= 5
    &&
    distinctTitles >= 5
    &&
    distinctDates >= 3
    &&
    detailTested === 5
    &&
    detailPass === 5
    &&
    titlePass === 5
    &&
    datePass === 5
    &&
    validUrls === 5;

  if (!collectorMetricsPass) {
    reasons.push(
      "COLLECTOR_METRICS_FAILED"
    );
  }

  /* ----------------------------------------------------------
   * 2. 4개 캠퍼스 존재 여부
   * ---------------------------------------------------------- */

  const campusChecks =
    VISIBLE_TO_CAMPUSES.map(
      universityId => {
        const university =
          findUniversity(
            catalog,
            universityId
          );

        return {
          universityId,

          found:
            Boolean(
              university
            ),

          universityName:
            university
              ?.universityName
            || null,

          sourceCount:
            getSources(
              university
            ).length
        };
      }
    );

  const missingCampuses =
    campusChecks.filter(
      item =>
        !item.found
    );

  if (
    missingCampuses.length > 0
  ) {
    reasons.push(
      "KYUNGDONG_CAMPUS_NOT_FOUND"
    );
  }

  /* ----------------------------------------------------------
   * 3. 동일 URL 기존 source 조사
   * ---------------------------------------------------------- */

  const normalizedTargetUrl =
    normalizeUrl(
      LIST_URL
    );

  const allSources =
    collectAllSources(
      catalog
    );

  const matchingUrlSources =
    allSources.filter(
      row =>
        normalizeUrl(
          row.source?.listUrl
        )
        ===
        normalizedTargetUrl
    );

  const matchingLegacySources =
    matchingUrlSources.filter(
      row =>
        LEGACY_SOURCE_IDS.includes(
          row.source?.id
        )
    );

  const unexpectedSameUrlSources =
    matchingUrlSources.filter(
      row =>
        !LEGACY_SOURCE_IDS.includes(
          row.source?.id
        )
        &&
        row.source?.id
        !== SOURCE_ID
    );

  const legacyUniversityIds =
    new Set(
      matchingLegacySources.map(
        row =>
          normalizeId(
            row.universityId
          )
      )
    );

  const expectedCampusIds =
    new Set(
      VISIBLE_TO_CAMPUSES.map(
        normalizeId
      )
    );

  const allExpectedLegacySourcesPresent =
    matchingLegacySources.length === 4
    &&
    [
      ...expectedCampusIds
    ].every(
      id =>
        legacyUniversityIds.has(
          id
        )
    );

  if (
    !allExpectedLegacySourcesPresent
  ) {
    reasons.push(
      "EXPECTED_LEGACY_SHARED_PLACEHOLDERS_NOT_FOUND"
    );
  }

  if (
    unexpectedSameUrlSources.length > 0
  ) {
    reasons.push(
      "UNEXPECTED_DUPLICATE_LIST_URL_SOURCE"
    );
  }

  /* ----------------------------------------------------------
   * 4. 이미 통합 source가 존재하는지
   * ---------------------------------------------------------- */

  const existingSharedSources =
    allSources.filter(
      row =>
        row.source?.id
        === SOURCE_ID
    );

  if (
    existingSharedSources.length > 0
  ) {
    reasons.push(
      "SHARED_SOURCE_ID_ALREADY_EXISTS"
    );
  }

  /* ----------------------------------------------------------
   * 5. 기존 placeholder 상태 검증
   * ---------------------------------------------------------- */

  const legacyState =
    matchingLegacySources.map(
      row => ({
        universityId:
          row.universityId,

        universityName:
          row.universityName,

        sourceId:
          row.source?.id
          || null,

        sourceName:
          row.source?.name
          || null,

        listUrl:
          row.source?.listUrl
          || null,

        verified:
          row.source?.verified
          === true,

        enabled:
          row.source?.enabled
          === true,

        status:
          row.source?.status
          || null,

        healthStatus:
          row.source?.healthStatus
          || null,

        campusScope:
          row.source?.campusScope
          || null
      })
    );

  const legacySafeToReplace =
    legacyState.length === 4
    &&
    legacyState.every(
      item =>
        item.verified === true
        &&
        item.enabled === false
        &&
        item.status
          === "selector_required"
    );

  if (!legacySafeToReplace) {
    reasons.push(
      "LEGACY_PLACEHOLDER_STATE_UNEXPECTED"
    );
  }

  /* ----------------------------------------------------------
   * 6. Activation decision
   * ---------------------------------------------------------- */

  const activationReady =
    reasons.length === 0;

  const proposedSource =
    activationReady
      ? {
          id:
            SOURCE_ID,

          name:
            SOURCE_NAME,

          category:
            "school_notice",

          sourceType:
            "official",

          collectionType:
            "custom_html",

          listUrl:
            LIST_URL,

          campusScope:
            "SHARED_SOURCE",

          contentScope:
            "GENERAL_UNIVERSITY_UPDATES",

          canonicalOwner:
            CANONICAL_OWNER,

          visibleToCampuses:
            VISIBLE_TO_CAMPUSES,

          duplicateStorage:
            false,

          collectOnce:
            true,

          parser: {
            itemStrategy:
              "CMS_BOARD_TR_WITH_DATE_AND_DETAIL",

            itemSelector:
              "tr",

            titleStrategy:
              "DETAIL_ANCHOR_TITLE",

            dateStrategy:
              "ROW_SINGLE_DATE",

            detailStrategy:
              "CMS_BOARD_DETAIL_ID",

            detailIdParameter:
              "board_seq",

            dedupeKey:
              "BOARD_SEQ"
          },

          verified:
            true,

          enabled:
            true,

          status:
            "awaiting_activation",

          healthStatus:
            "validated"
        }
      : null;

  const result = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    decision:
      activationReady
        ? "ACTIVATION_READY"
        : "ACTIVATION_REVIEW_REQUIRED",

    activationReady,

    reasons,

    universityIds:
      VISIBLE_TO_CAMPUSES,

    universityName:
      UNIVERSITY_NAME,

    canonicalOwner:
      CANONICAL_OWNER,

    collector: {
      decision:
        collectorReady
          ? "COLLECTOR_READY"
          : "COLLECTOR_REVIEW_REQUIRED",

      status:
        collector.list
          ?.status
        ?? null,

      finalUrl:
        collector.list
          ?.finalUrl
        || null,

      extracted,

      unique,

      distinctTitles,

      distinctDates
    },

    detailValidation: {
      tested:
        detailTested,

      pass:
        detailPass,

      titlePass,

      datePass,

      validUrls
    },

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

    catalog: {
      file:
        path.basename(
          CATALOG_FILE
        ),

      campusChecks,

      matchingListUrlCount:
        matchingUrlSources.length,

      matchingLegacySourceCount:
        matchingLegacySources.length,

      unexpectedSameUrlSourceCount:
        unexpectedSameUrlSources.length,

      existingSharedSourceCount:
        existingSharedSources.length,

      allExpectedLegacySourcesPresent,

      legacySafeToReplace,

      legacySources:
        legacyState
    },

    migrationPlan:
      activationReady
        ? {
            mode:
              "CONSOLIDATE_LEGACY_PLACEHOLDERS_TO_SHARED_SOURCE",

            removeSourceIds:
              LEGACY_SOURCE_IDS,

            addSourceToCanonicalOwnerOnly:
              true,

            canonicalOwner:
              CANONICAL_OWNER,

            sourceId:
              SOURCE_ID,

            secondAndOtherCampusSourceCopies:
              false,

            visibleToCampuses:
              VISIBLE_TO_CAMPUSES,

            collectOnce:
              true,

            duplicateStorage:
              false
          }
        : null,

    proposedActivation:
      activationReady
        ? {
            canonicalOwner:
              CANONICAL_OWNER,

            visibleToCampuses:
              VISIBLE_TO_CAMPUSES,

            collectOnce:
              true,

            duplicateStorage:
              false,

            source:
              proposedSource
          }
        : null,

    nextAction:
      activationReady
        ? "ACTIVATE_KYUNGDONG_SHARED_SOURCE_LOCAL"
        : "REVIEW_KYUNGDONG_ACTIVATION_BLOCKERS",

    hashSafe:
      true,

    safety: {
      readOnly:
        true,

      automaticActivation:
        false,

      automaticSourceMutation:
        false,

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
    result
  );

  console.log(
    JSON.stringify(
      {
        decision:
          result.decision,

        activationReady:
          result.activationReady,

        reasons:
          result.reasons,

        canonicalOwner:
          result.canonicalOwner,

        visibleToCampuses:
          result.universityIds,

        catalog: {
          matchingListUrlCount:
            result.catalog
              .matchingListUrlCount,

          matchingLegacySourceCount:
            result.catalog
              .matchingLegacySourceCount,

          unexpectedSameUrlSourceCount:
            result.catalog
              .unexpectedSameUrlSourceCount,

          existingSharedSourceCount:
            result.catalog
              .existingSharedSourceCount,

          allExpectedLegacySourcesPresent:
            result.catalog
              .allExpectedLegacySourcesPresent,

          legacySafeToReplace:
            result.catalog
              .legacySafeToReplace
        },

        collector:
          result.collector,

        detailValidation:
          result.detailValidation,

        migrationPlan:
          result.migrationPlan,

        proposedActivation:
          result.proposedActivation,

        nextAction:
          result.nextAction,

        outputFile:
          OUTPUT_FILE,

        safety:
          result.safety
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