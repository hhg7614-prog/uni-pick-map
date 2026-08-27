"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const VERIFICATION_FILE = path.join(
  DATA,
  "catholic-kwandong-candidate-collector-verification.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "catholic-kwandong-activation-ready.json"
);

const CATALOG_CANDIDATES = [
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-sources.final.json"
  ),

  path.join(
    DATA,
    "university-news-sources.final.json"
  )
];

const UNIVERSITY_ID =
  "catholic-kwandong-university-본교";

const UNIVERSITY_NAME =
  "가톨릭관동대학교";

const SOURCE_ID =
  "catholic-kwandong-general-feed";

const CANONICAL_LIST_URL =
  "https://www.cku.ac.kr/bbs/cku_kr/1202/artclList.do";

// ============================================================
// Utilities
// ============================================================

function readJson(file, fallback = null) {
  try {
    return JSON.parse(
      fs
        .readFileSync(file, "utf8")
        .replace(/^\uFEFF/, "")
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
    return null;
  }
}

function firstExisting(files) {
  return (
    files.find(
      file =>
        fs.existsSync(file)
    )
    || null
  );
}

// ============================================================
// Catalog
// ============================================================

function getUniversities(catalog) {
  if (!catalog) {
    return [];
  }

  if (
    Array.isArray(
      catalog.universities
    )
  ) {
    return catalog.universities;
  }

  if (
    Array.isArray(catalog)
  ) {
    return catalog;
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

// ============================================================
// Main
// ============================================================

function main() {
  if (
    !fs.existsSync(
      VERIFICATION_FILE
    )
  ) {
    throw new Error(
      "COLLECTOR_VERIFICATION_FILE_NOT_FOUND"
    );
  }

  const catalogFile =
    firstExisting(
      CATALOG_CANDIDATES
    );

  if (!catalogFile) {
    throw new Error(
      "CATALOG_FILE_NOT_FOUND"
    );
  }

  const verification =
    readJson(
      VERIFICATION_FILE
    );

  const catalog =
    readJson(
      catalogFile,
      {
        universities: []
      }
    );

  const universities =
    getUniversities(
      catalog
    );

  const university =
    universities.find(
      item =>
        normalizeId(
          item.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    )
    || null;

  const allSources = [];

  for (
    const universityItem
    of universities
  ) {
    for (
      const source
      of getSources(
        universityItem
      )
    ) {
      allSources.push({
        universityId:
          universityItem.universityId,

        universityName:
          universityItem.universityName,

        source
      });
    }
  }

  const normalizedCanonicalUrl =
    normalizeUrl(
      CANONICAL_LIST_URL
    );

  const sourceIdMatches =
    allSources.filter(
      entry =>
        (
          entry.source?.id
          ||
          entry.source?.sourceId
        )
        ===
        SOURCE_ID
    );

  const listUrlMatches =
    allSources.filter(
      entry =>
        normalizeUrl(
          entry.source?.listUrl
        )
        ===
        normalizedCanonicalUrl
    );

  const verifiedEnabledListUrlMatches =
    listUrlMatches.filter(
      entry =>
        entry.source?.verified
        === true
        &&
        entry.source?.enabled
        === true
    );

  const collectorReady =
    verification?.decision
    ===
    "COLLECTOR_READY";

  const uniqueCount =
    Number(
      verification
        ?.collector
        ?.unique
      || 0
    );

  const duplicateKeys =
    Number(
      verification
        ?.collector
        ?.duplicateKeys
      || 0
    );

  const detailTested =
    Number(
      verification
        ?.detailValidation
        ?.tested
      || 0
    );

  const detailPass =
    Number(
      verification
        ?.detailValidation
        ?.pass
      || 0
    );

  const titlePass =
    Number(
      verification
        ?.detailValidation
        ?.titlePass
      || 0
    );

  const datePass =
    Number(
      verification
        ?.detailValidation
        ?.datePass
      || 0
    );

  const validUrls =
    Number(
      verification
        ?.detailValidation
        ?.validUrls
      || 0
    );

  const canonicalListCandidate =
    (
      verification?.listCandidates
      || []
    ).find(
      item =>
        normalizeUrl(
          item.url
        )
        ===
        normalizedCanonicalUrl
        &&
        item.reachable
        === true
        &&
        Number(
          item.articleViewCount
          || 0
        ) >= 5
        &&
        Number(
          item.dateCount
          || 0
        ) >= 5
    )
    || null;

  const reasons = [];

  if (!collectorReady) {
    reasons.push(
      "COLLECTOR_NOT_READY"
    );
  }

  if (uniqueCount < 5) {
    reasons.push(
      "INSUFFICIENT_UNIQUE_ITEMS"
    );
  }

  if (duplicateKeys !== 0) {
    reasons.push(
      "DUPLICATE_KEYS"
    );
  }

  if (
    detailTested < 1
    ||
    detailPass
    !== detailTested
  ) {
    reasons.push(
      "DETAIL_VALIDATION_FAILED"
    );
  }

  if (
    titlePass
    !== detailTested
  ) {
    reasons.push(
      "TITLE_VALIDATION_FAILED"
    );
  }

  if (
    datePass
    !== detailTested
  ) {
    reasons.push(
      "DATE_VALIDATION_FAILED"
    );
  }

  if (
    validUrls
    !== detailTested
  ) {
    reasons.push(
      "DETAIL_URL_VALIDATION_FAILED"
    );
  }

  if (
    !canonicalListCandidate
  ) {
    reasons.push(
      "CANONICAL_LIST_URL_NOT_VALIDATED"
    );
  }

  if (
    sourceIdMatches.length > 0
  ) {
    reasons.push(
      "DUPLICATE_SOURCE_ID"
    );
  }

  if (
    listUrlMatches.length > 0
  ) {
    reasons.push(
      "DUPLICATE_LIST_URL"
    );
  }

  const activationReady =
    reasons.length === 0;

  const proposedActivation =
    activationReady
      ? {
          canonicalOwner:
            UNIVERSITY_ID,

          source: {
            id:
              SOURCE_ID,

            name:
              "가톨릭관동대학교 공지사항",

            category:
              "school_notice",

            sourceType:
              "official",

            collectionType:
              "custom_html",

            listUrl:
              CANONICAL_LIST_URL,

            campusScope:
              "CAMPUS_SPECIFIC",

            contentScope:
              "GENERAL_UNIVERSITY_UPDATES",

            canonicalOwner:
              UNIVERSITY_ID,

            duplicateStorage:
              false,

            collectOnce:
              false,

            parser: {
              itemStrategy:
                "CKU_BOARD_TR_WITH_ARTICLE_DETAIL",

              itemSelector:
                "tr",

              titleStrategy:
                "ARTCL_VIEW_ANCHOR",

              dateStrategy:
                "ROW_DATE",

              detailStrategy:
                "CKU_ARTCL_VIEW",

              detailIdParameter:
                "ARTICLE_ID",

              dedupeKey:
                "ARTICLE_ID"
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
        }
      : null;

  const report = {
    decision:
      activationReady
        ? "ACTIVATION_READY"
        : "ACTIVATION_REVIEW_REQUIRED",

    activationReady,

    reasons,

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    canonicalization: {
      collectorSelectedListUrl:
        verification
          ?.proposedCollector
          ?.listUrl
        || null,

      canonicalListUrl:
        CANONICAL_LIST_URL,

      canonicalListValidated:
        Boolean(
          canonicalListCandidate
        ),

      reason:
        "상세 게시글 enc URL 대신 게시판의 안정적인 공식 artclList.do URL을 source 기준 URL로 사용합니다."
    },

    collector: {
      decision:
        verification?.decision
        || null,

      extracted:
        Number(
          verification
            ?.collector
            ?.extracted
          || 0
        ),

      unique:
        uniqueCount,

      duplicateKeys,

      distinctTitles:
        Number(
          verification
            ?.collector
            ?.distinctTitles
          || 0
        ),

      distinctDates:
        Number(
          verification
            ?.collector
            ?.distinctDates
          || 0
        )
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

    catalog: {
      file:
        path.basename(
          catalogFile
        ),

      universityFound:
        Boolean(
          university
        ),

      sourceCount:
        getSources(
          university
        ).length,

      duplicateSourceId:
        sourceIdMatches.length > 0,

      duplicateSourceIdCount:
        sourceIdMatches.length,

      duplicateListUrl:
        listUrlMatches.length > 0,

      duplicateListUrlCount:
        listUrlMatches.length,

      duplicateVerifiedEnabledListUrl:
        verifiedEnabledListUrlMatches.length > 0,

      duplicateVerifiedEnabledListUrlCount:
        verifiedEnabledListUrlMatches.length
    },

    proposedActivation,

    nextAction:
      activationReady
        ? "ACTIVATE_CATHOLIC_KWANDONG_SOURCE_LOCAL"
        : "REVIEW_CATHOLIC_KWANDONG_ACTIVATION_BLOCKERS",

    outputFile:
      OUTPUT_FILE,

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
    report
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );
}

if (
  require.main
  === module
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
              || String(error),

            stack:
              error?.stack
              || null
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