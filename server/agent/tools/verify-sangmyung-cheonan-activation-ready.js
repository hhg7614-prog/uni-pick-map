"use strict";

/**
 * UNI PICK
 * Sangmyung University Cheonan Activation Ready Verifier v1
 *
 * 검증:
 * - collector 결과 COLLECTOR_READY
 * - 목록 HTTP 200
 * - unique >= 10
 * - 제목 다양성 >= 10
 * - 날짜 다양성 >= 5
 * - 상세 5/5
 * - 제목 5/5
 * - 날짜 5/5
 * - 공식 URL 5/5
 * - catalog 대학 존재
 * - sourceId 중복 없음
 * - listUrl 중복 없음
 * - 다른 verified/enabled source와 동일 URL 충돌 없음
 *
 * 안전:
 * read-only
 * catalog/store/preview/queue 수정 없음
 * git/deploy 없음
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  "sangmyung-cheonan-collector-final.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "sangmyung-cheonan-activation-ready.json"
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

const UNIVERSITY_ID =
  "sangmyung-university-제2캠퍼";

const UNIVERSITY_NAME =
  "상명대학교 제2캠퍼";

const SOURCE_ID =
  "sangmyung-cheonan-general-feed";


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
    { recursive: true }
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


function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value)
          .replace(/&amp;/gi, "&")
          .trim()
      );

    url.hash = "";

    return url.href;

  } catch {
    return null;
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


function main() {
  const beforeHashes =
    snapshotHashes();


  const collector =
    read(
      COLLECTOR_FILE
    );


  if (!collector) {
    throw new Error(
      "SANGMYUNG_COLLECTOR_RESULT_MISSING"
    );
  }


  const reasons = [];


  if (
    collector.decision
    !== "COLLECTOR_READY"
  ) {
    reasons.push(
      "COLLECTOR_NOT_READY"
    );
  }


  if (
    collector.status !== 200
  ) {
    reasons.push(
      "LIST_STATUS_NOT_200"
    );
  }


  if (
    Number(
      collector.unique || 0
    ) < 10
  ) {
    reasons.push(
      "INSUFFICIENT_UNIQUE_ITEMS"
    );
  }


  if (
    Number(
      collector.distinctTitles || 0
    ) < 10
  ) {
    reasons.push(
      "INSUFFICIENT_TITLE_VARIETY"
    );
  }


  if (
    Number(
      collector.distinctDates || 0
    ) < 5
  ) {
    reasons.push(
      "INSUFFICIENT_DATE_VARIETY"
    );
  }


  const validation =
    collector.detailValidation
    || {};


  if (
    Number(
      validation.tested || 0
    ) !== 5
  ) {
    reasons.push(
      "DETAIL_TEST_COUNT_INVALID"
    );
  }


  if (
    Number(
      validation.pass || 0
    ) !== 5
  ) {
    reasons.push(
      "DETAIL_VALIDATION_FAILED"
    );
  }


  if (
    Number(
      validation.titlePass || 0
    ) !== 5
  ) {
    reasons.push(
      "TITLE_VALIDATION_FAILED"
    );
  }


  if (
    Number(
      validation.dateTested || 0
    ) !== 5
  ) {
    reasons.push(
      "DATE_TEST_COUNT_INVALID"
    );
  }


  if (
    Number(
      validation.datePass || 0
    ) !== 5
  ) {
    reasons.push(
      "DATE_VALIDATION_FAILED"
    );
  }


  if (
    Number(
      validation.validUrls || 0
    ) !== 5
  ) {
    reasons.push(
      "URL_VALIDATION_FAILED"
    );
  }


  const proposed =
    collector.proposedCollector;


  if (!proposed) {
    reasons.push(
      "PROPOSED_COLLECTOR_MISSING"
    );
  }


  if (
    proposed
    &&
    proposed.id
    !== SOURCE_ID
  ) {
    reasons.push(
      "SOURCE_ID_MISMATCH"
    );
  }


  if (
    proposed
    &&
    proposed.sourceType
    !== "official"
  ) {
    reasons.push(
      "SOURCE_NOT_OFFICIAL"
    );
  }


  if (
    proposed
    &&
    proposed.collectionType
    !== "custom_html"
  ) {
    reasons.push(
      "COLLECTION_TYPE_INVALID"
    );
  }


  if (
    proposed
    &&
    proposed.campusScope
    !== "CAMPUS_SPECIFIC"
  ) {
    reasons.push(
      "CAMPUS_SCOPE_INVALID"
    );
  }


  if (
    proposed
    &&
    proposed.campusFilter?.parameter
    !== "srCampus"
  ) {
    reasons.push(
      "CAMPUS_FILTER_PARAMETER_INVALID"
    );
  }


  if (
    proposed
    &&
    proposed.campusFilter?.value
    !== "smuc"
  ) {
    reasons.push(
      "CAMPUS_FILTER_VALUE_INVALID"
    );
  }


  const catalog =
    read(
      CATALOG_FILE,
      {
        universities: []
      }
    );


  const universities =
    Array.isArray(
      catalog.universities
    )
      ? catalog.universities
      : [];


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
    );


  if (!university) {
    reasons.push(
      "CATALOG_UNIVERSITY_NOT_FOUND"
    );
  }


  const sources =
    Array.isArray(
      university?.sources
    )
      ? university.sources
      : [];


  const duplicateSourceId =
    sources.some(
      source =>
        source.id
        === SOURCE_ID
    );


  if (duplicateSourceId) {
    reasons.push(
      "DUPLICATE_SOURCE_ID"
    );
  }


  const proposedUrl =
    normalizeUrl(
      proposed?.listUrl
    );


  if (!proposedUrl) {
    reasons.push(
      "INVALID_LIST_URL"
    );
  }


  const duplicateListUrl =
    Boolean(
      proposedUrl
      &&
      sources.some(
        source =>
          normalizeUrl(
            source.listUrl
          )
          === proposedUrl
      )
    );


  if (duplicateListUrl) {
    reasons.push(
      "DUPLICATE_LIST_URL"
    );
  }


  /*
   * 다른 대학의 verified/enabled source가
   * 동일 listUrl을 이미 사용 중인지 확인.
   */

  const duplicateVerifiedEnabledListUrl =
    Boolean(
      proposedUrl
      &&
      universities.some(
        uni =>
          normalizeId(
            uni.universityId
          )
          !==
          normalizeId(
            UNIVERSITY_ID
          )
          &&
          (
            Array.isArray(
              uni.sources
            )
              ? uni.sources
              : []
          ).some(
            source =>
              source.verified === true
              &&
              source.enabled === true
              &&
              normalizeUrl(
                source.listUrl
              )
              === proposedUrl
          )
      )
    );


  if (
    duplicateVerifiedEnabledListUrl
  ) {
    reasons.push(
      "DUPLICATE_VERIFIED_ENABLED_LIST_URL"
    );
  }


  const activationReady =
    reasons.length === 0;


  const proposedActivation =
    activationReady
      ? {
          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          source: {
            id:
              SOURCE_ID,

            name:
              "상명대학교 천안캠퍼스 공식 소식",

            category:
              "school_news",

            sourceType:
              "official",

            collectionType:
              "custom_html",

            listUrl:
              proposedUrl,

            campusScope:
              "CAMPUS_SPECIFIC",

            contentScope:
              "GENERAL_UNIVERSITY_UPDATES",

            campusFilter: {
              parameter:
                "srCampus",

              value:
                "smuc"
            },

            parser:
              proposed.parser,

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


  const afterHashes =
    snapshotHashes();


  const hashSafe =
    JSON.stringify(
      beforeHashes
    )
    ===
    JSON.stringify(
      afterHashes
    );


  if (!hashSafe) {
    throw new Error(
      "READ_ONLY_HASH_CHANGED"
    );
  }


  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    decision:
      activationReady
        ? "ACTIVATION_READY"
        : "ACTIVATION_BLOCKED",

    activationReady,

    reasons,

    collector: {
      decision:
        collector.decision,

      status:
        collector.status,

      rawItems:
        collector.rawItems,

      extracted:
        collector.extracted,

      unique:
        collector.unique,

      duplicateKeys:
        collector.duplicateKeys,

      withDates:
        collector.withDates,

      distinctTitles:
        collector.distinctTitles,

      distinctDates:
        collector.distinctDates
    },

    detailValidation: {
      tested:
        Number(
          validation.tested || 0
        ),

      pass:
        Number(
          validation.pass || 0
        ),

      titlePass:
        Number(
          validation.titlePass || 0
        ),

      dateTested:
        Number(
          validation.dateTested || 0
        ),

      datePass:
        Number(
          validation.datePass || 0
        ),

      validUrls:
        Number(
          validation.validUrls || 0
        )
    },

    catalog: {
      found:
        Boolean(
          university
        ),

      sourceCount:
        sources.length,

      duplicateSourceId,

      duplicateListUrl,

      duplicateVerifiedEnabledListUrl
    },

    proposedActivation,

    nextAction:
      activationReady
        ? "ACTIVATE_SANGMYUNG_CHEONAN_SOURCE_LOCAL"
        : "REVIEW_SANGMYUNG_ACTIVATION_BLOCKERS",

    operationalHashUnchanged:
      hashSafe,

    safety: {
      readOnly:
        true,

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


  atomic(
    OUTPUT_FILE,
    report
  );


  console.log(
    JSON.stringify(
      {
        decision:
          report.decision,

        activationReady:
          report.activationReady,

        reasons:
          report.reasons,

        collector:
          report.collector,

        detailValidation:
          report.detailValidation,

        catalog:
          report.catalog,

        proposedActivation:
          report.proposedActivation,

        nextAction:
          report.nextAction,

        hashSafe:
          report.operationalHashUnchanged
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