"use strict";

/**
 * UNI PICK Project State v1
 *
 * 紐⑹쟻:
 * - 湲곗〈 ?댁쁺 湲곕뒫??蹂寃쏀븯吏 ?딅뒗 ?쎄린 ?꾩슜 ?곹깭 遺꾩꽍湲?
 * - Supervisor/Orchestrator媛 UNI PICK???꾩옱 ?곹깭瑜??먮떒?????덈룄濡?
 *   ????곗씠?? 異쒖쿂 吏꾨떒, 怨듭? ??μ냼, Agent ?곹깭瑜?醫낇빀?쒕떎.
 *
 * ???뚯씪?:
 * - ?섏쭛 ?ㅽ뻾 ????
 * - 諛고룷 ????
 * - ?곗씠???섏젙 ????
 * - 湲곗〈 JSON ?섏젙 ????
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../..");

const AGENT_DATA_DIR = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const UNIVERSITIES_FILE = path.join(
  ROOT,
  "universities.js"
);

const OUTPUT_FILE = path.join(
  AGENT_DATA_DIR,
  "uni-pick-project-state.json"
);


// =========================================================
// 1. 怨듯넻 ?좏떥
// =========================================================

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}


function safeReadAgentJson(
  filename,
  fallback = null
) {
  return safeReadJson(
    path.join(
      AGENT_DATA_DIR,
      filename
    ),
    fallback
  );
}


function arrayLength(value) {
  return Array.isArray(value)
    ? value.length
    : 0;
}


function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    )
  ];
}


function hoursSince(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    (
      Date.now()
      - date.getTime()
    )
    / 1000
    / 60
    / 60
  );
}


function round(value, digits = 2) {
  if (
    value === null
    || value === undefined
    || Number.isNaN(value)
  ) {
    return null;
  }

  const factor = 10 ** digits;

  return (
    Math.round(
      value * factor
    )
    / factor
  );
}


// =========================================================
// 2. Markdown URL ?뺣━
// =========================================================

function cleanUrl(value) {
  if (!value) {
    return "";
  }

  let text = String(
    value
  ).trim();

  // [https://a.com](https://a.com)
  const markdownMatch = text.match(
    /^\[[^\]]+\]\((.+)\)$/
  );

  if (
    markdownMatch
    && markdownMatch[1]
  ) {
    text =
      markdownMatch[1];
  }

  return text
    .replace(/\\&/g, "&")
    .trim();
}


// =========================================================
// 3. universities.js ?쎄린
// =========================================================

function loadUniversities() {
  const source = fs.readFileSync(
    UNIVERSITIES_FILE,
    "utf8"
  );

  const sandbox = { window: {} };

  vm.createContext(
    sandbox
  );

  vm.runInContext(
    `${source}
this.__UNI_PICK_PROJECT_STATE_UNIVERSITIES__ = universities;
`,
    sandbox,
    {
      filename:
        UNIVERSITIES_FILE,
      timeout:
        5000
    }
  );

  const universities =
    sandbox
      .__UNI_PICK_PROJECT_STATE_UNIVERSITIES__;

  if (
    !Array.isArray(
      universities
    )
  ) {
    throw new Error(
      "universities.js?먯꽌 universities 諛곗뿴???쎌? 紐삵뻽?듬땲??"
    );
  }

  return universities;
}


// =========================================================
// 4. 以묐났 寃??
// =========================================================

function findDuplicates(
  items,
  getKey
) {
  const map =
    new Map();

  for (
    const item
    of items
  ) {
    const key =
      getKey(item);

    if (!key) {
      continue;
    }

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        []
      );
    }

    map
      .get(key)
      .push(item);
  }

  const duplicates = [];

  for (
    const [key, group]
    of map.entries()
  ) {
    if (
      group.length > 1
    ) {
      duplicates.push({
        key,
        count:
          group.length,
        items:
          group
      });
    }
  }

  return duplicates;
}


// =========================================================
// 5. ????곗씠???곹깭
// =========================================================

function buildUniversityState(
  universities
) {
  const total =
    universities.length;

  const ids =
    universities.map(
      (item) =>
        item.id
    );

  const duplicateIds =
    findDuplicates(
      universities,
      (item) =>
        item.id
    );

  const missingCoordinates =
    universities.filter(
      (item) =>
        typeof item.lat
          !== "number"
        ||
        typeof item.lng
          !== "number"
    );

  const missingWebsite =
    universities.filter(
      (item) =>
        !cleanUrl(
          item.website
        )
    );

  const invalidWebsite =
    universities.filter(
      (item) => {
        const url =
          cleanUrl(
            item.website
          );

        if (!url) {
          return false;
        }

        return (
          !url.startsWith(
            "http://"
          )
          &&
          !url.startsWith(
            "https://"
          )
        );
      }
    );

  const campusTypes = {};

  for (
    const university
    of universities
  ) {
    const campusType =
      String(
        university.campusType
        || "UNKNOWN"
      );

    campusTypes[
      campusType
    ] =
      (
        campusTypes[
          campusType
        ]
        || 0
      )
      + 1;
  }

  return {
    totalEntries:
      total,

    uniqueUniversityIds:
      unique(
        ids
      ).length,

    duplicateIdCount:
      duplicateIds.length,

    duplicateIds:
      duplicateIds.map(
        (item) => ({
          id:
            item.key,

          count:
            item.count
        })
      ),

    missingCoordinateCount:
      missingCoordinates.length,

    missingCoordinateIds:
      missingCoordinates
        .map(
          (item) =>
            item.id
        ),

    missingWebsiteCount:
      missingWebsite.length,

    invalidWebsiteCount:
      invalidWebsite.length,

    campusTypeCounts:
      campusTypes
  };
}


// =========================================================
// 6. Source Validation ?곹깭
// =========================================================

function buildSourceValidationState(
  first,
  retry
) {
  const total =
    Number(
      first.total
      || 247
    );

  const processed =
    arrayLength(
      first
        .processedUniversityIds
    );

  const success =
    arrayLength(
      first.successIds
    );

  const review =
    arrayLength(
      first.reviewIds
    );

  const error =
    arrayLength(
      first.errorIds
    );

  const skipped =
    arrayLength(
      first.skippedIds
    );

  const retryTotal =
    Number(
      retry.total
      || 0
    );

  const retryProcessed =
    arrayLength(
      retry
        .processedUniversityIds
    );

  const coveragePercent =
    total > 0
      ? (
          processed
          / total
          * 100
        )
      : 0;

  let qualityStatus =
    "HEALTHY";

  if (
    error > 0
  ) {
    qualityStatus =
      error / total >= 0.25
        ? "CRITICAL"
        : "WARNING";
  } else if (
    review > 0
  ) {
    qualityStatus =
      "WARNING";
  }

  return {
    status:
      first.status
      || "unknown",

    total,

    processed,

    coveragePercent:
      round(
        coveragePercent
      ),

    success,

    review,

    error,

    skipped,

    retryTotal,

    retryProcessed,

    lastUniversityId:
      first.lastUniversityId
      || "",

    qualityStatus
  };
}


// =========================================================
// 7. News Store 遺꾩꽍
// =========================================================

function buildNewsStoreState(
  store
) {
  const items =
    Array.isArray(
      store?.items
    )
      ? store.items
      : [];

  const totalItems =
    items.length;

  const universityIds =
    unique(
      items.map(
        (item) =>
          item.universityId
      )
    );

  const sourceIds =
    unique(
      items.map(
        (item) =>
          item.sourceId
      )
    );

  const sourceUrls =
    items.map(
      (item) =>
        cleanUrl(
          item.sourceUrl
        )
    );

  const urlDuplicates =
    findDuplicates(
      items,
      (item) =>
        cleanUrl(
          item.sourceUrl
        )
    );

  const urlHashDuplicates =
    findDuplicates(
      items,
      (item) =>
        item.urlHash
    );

  const contentHashDuplicates =
    findDuplicates(
      items,
      (item) =>
        item.contentHash
    );

  const errorItems =
    items.filter(
      (item) =>
        item.errorMessage
        ||
        item.status
          === "error"
    );

  const missingPublishedAt =
    items.filter(
      (item) =>
        !item.publishedAt
    );

  const missingSourceUrl =
    items.filter(
      (item) =>
        !cleanUrl(
          item.sourceUrl
        )
    );

  const aiProcessed =
    items.filter(
      (item) =>
        item.aiProcessed
          === true
    ).length;

  const latestPublishedTimes =
    items
      .map(
        (item) =>
          item.publishedAt
      )
      .filter(Boolean)
      .map(
        (value) =>
          new Date(
            value
          ).getTime()
      )
      .filter(
        (value) =>
          !Number.isNaN(
            value
          )
      );

  let latestPublishedAt =
    null;

  let latestNewsAgeHours =
    null;

  if (
    latestPublishedTimes
      .length > 0
  ) {
    const newest =
      Math.max(
        ...latestPublishedTimes
      );

    latestPublishedAt =
      new Date(
        newest
      ).toISOString();

    latestNewsAgeHours =
      (
        Date.now()
        - newest
      )
      / 1000
      / 60
      / 60;
  }

  const staleThresholdHours =
    72;

  const staleNewsCount =
    items.filter(
      (item) => {
        if (
          !item.publishedAt
        ) {
          return true;
        }

        const time =
          new Date(
            item.publishedAt
          ).getTime();

        if (
          Number.isNaN(
            time
          )
        ) {
          return true;
        }

        return (
          (
            Date.now()
            - time
          )
          / 1000
          / 60
          / 60
          >
          staleThresholdHours
        );
      }
    ).length;

  return {
    version:
      store?.version
      || null,

    storeUpdatedAt:
      store?.updatedAt
      || null,

    totalItems,

    universityCoverageCount:
      universityIds.length,

    sourceCount:
      sourceIds.length,

    duplicateSourceUrlGroups:
      urlDuplicates.length,

    duplicateUrlHashGroups:
      urlHashDuplicates.length,

    duplicateContentHashGroups:
      contentHashDuplicates.length,

    errorItemCount:
      errorItems.length,

    missingPublishedAtCount:
      missingPublishedAt.length,

    missingSourceUrlCount:
      missingSourceUrl.length,

    aiProcessedCount:
      aiProcessed,

    latestPublishedAt,

    latestNewsAgeHours:
      round(
        latestNewsAgeHours
      ),

    staleThresholdHours,

    staleNewsCount
  };
}


// =========================================================
// 8. Agent Runtime ?곹깭
// =========================================================

function buildRuntimeState(
  agentStatus
) {
  const lastRunAt =
    agentStatus?.lastRunAt
    || null;

  const lastRunAgeHours =
    hoursSince(
      lastRunAt
    );

  const agentEnabled =
    Boolean(
      agentStatus
        ?.agentEnabled
    );

  const lastErrorCount =
    Number(
      agentStatus
        ?.lastErrorCount
      || 0
    );

  let runtimeStatus =
    "HEALTHY";

  if (
    lastErrorCount > 0
  ) {
    runtimeStatus =
      "ERROR";
  } else if (
    !agentEnabled
  ) {
    runtimeStatus =
      "IDLE";
  }

  return {
    runtimeStatus,

    agentEnabled,

    lastRunId:
      agentStatus
        ?.lastRunId
      || "",

    lastRunAt,

    lastRunAgeHours:
      round(
        lastRunAgeHours
      ),

    lastTrigger:
      agentStatus
        ?.lastTrigger
      || "",

    lastNewCount:
      Number(
        agentStatus
          ?.lastNewCount
        || 0
      ),

    lastErrorCount,

    totalStoredItems:
      Number(
        agentStatus
          ?.totalStoredItems
        || 0
      )
  };
}


// =========================================================
// 9. Priority Issue ?앹꽦
// =========================================================

function buildPriorityIssues({
  universityState,
  sourceState,
  newsState,
  runtimeState
}) {
  const issues = [];

  function addIssue(
    severity,
    code,
    title,
    detail,
    recommendedAction
  ) {
    issues.push({
      severity,
      code,
      title,
      detail,
      recommendedAction
    });
  }

  if (
    sourceState.error > 0
  ) {
    addIssue(
      sourceState
        .qualityStatus
        === "CRITICAL"
        ? "CRITICAL"
        : "HIGH",

      "SOURCE_VALIDATION_ERRORS",

      "???異쒖쿂 寃利??ㅻ쪟媛 ?⑥븘 ?덉뒿?덈떎.",

      `${sourceState.total}媛????以?${sourceState.error}媛쒓? error ?곹깭?낅땲??`,

      "error ??숈쓣 ?먯씤 ?좏삎蹂꾨줈 遺꾨쪟?섍퀬 ?먮룞 蹂듦뎄 媛????ぉ怨??щ엺 寃????ぉ??遺꾨━?⑸땲??"
    );
  }

  if (
    sourceState.review > 0
  ) {
    addIssue(
      "MEDIUM",

      "SOURCE_REVIEW_QUEUE",

      "異쒖쿂 ?щ엺 寃????곸씠 ?⑥븘 ?덉뒿?덈떎.",

      `${sourceState.review}媛???숈씠 review ?곹깭?낅땲??`,

      "review ?ъ쑀瑜?遺꾨쪟?섍퀬 ?믪? ?좊ː?꾩쓽 ?꾨낫遺???먮룞 ?뱀씤 媛???щ?瑜?寃?좏빀?덈떎."
    );
  }

  if (
    runtimeState
      .agentEnabled
      === false
  ) {
    addIssue(
      "MEDIUM",

      "NEWS_AGENT_DISABLED",

      "怨듭? ?섏쭛 Agent媛 鍮꾪솢???곹깭?낅땲??",

      "agentEnabled=false ?곹깭?낅땲??",

      "?섎룄?곸씤 鍮꾪솢???곹깭?몄? ?뺤씤?섍퀬 ?덉빟 ?섏쭛 ?뺤콉怨??쇱튂?섎뒗吏 ?먭??⑸땲??"
    );
  }

  if (
    newsState
      .duplicateSourceUrlGroups
      > 0
  ) {
    addIssue(
      "HIGH",

      "NEWS_DUPLICATE_URL",

      "?숈씪 ?곸꽭 URL 怨듭?媛 以묐났 ??λ맂 ?꾨낫媛 ?덉뒿?덈떎.",

      `${newsState.duplicateSourceUrlGroups}媛?URL 以묐났 洹몃９??諛쒓껄?섏뿀?듬땲??`,

      "?곸꽭 URL 湲곗? dedup ?뺤콉怨??ㅼ젣 ???寃곌낵瑜?鍮꾧탳?⑸땲??"
    );
  }

  if (
    newsState
      .duplicateUrlHashGroups
      > 0
  ) {
    addIssue(
      "HIGH",

      "NEWS_DUPLICATE_URL_HASH",

      "?숈씪 urlHash 以묐났 ?꾨낫媛 ?덉뒿?덈떎.",

      `${newsState.duplicateUrlHashGroups}媛?urlHash 以묐났 洹몃９??諛쒓껄?섏뿀?듬땲??`,

      "dedup.js? ???吏곸쟾 以묐났 諛⑹? 濡쒖쭅???먭??⑸땲??"
    );
  }

  if (
    newsState
      .errorItemCount
      > 0
  ) {
    addIssue(
      "HIGH",

      "NEWS_STORE_ERRORS",

      "怨듭? ??μ냼???ㅻ쪟 ?곹깭 ??ぉ???덉뒿?덈떎.",

      `${newsState.errorItemCount}嫄댁쓽 ?ㅻ쪟 ??ぉ??諛쒓껄?섏뿀?듬땲??`,

      "errorMessage 湲곗??쇰줈 ?먯씤??遺꾨쪟?섍퀬 ?ъ닔吏???곸쓣 留뚮벊?덈떎."
    );
  }

  if (
    universityState
      .duplicateIdCount
      > 0
  ) {
    addIssue(
      "CRITICAL",

      "DUPLICATE_UNIVERSITY_ID",

      "universities.js??以묐났 ID媛 ?덉뒿?덈떎.",

      `${universityState.duplicateIdCount}媛?以묐났 ID 洹몃９??諛쒓껄?섏뿀?듬땲??`,

      "?먮룞 ?섏젙?섏? 留먭퀬 ID 異⑸룎 ?먯씤??癒쇱? 寃?좏빀?덈떎."
    );
  }

  if (
    universityState
      .missingCoordinateCount
      > 0
  ) {
    addIssue(
      "HIGH",

      "MISSING_COORDINATES",

      "醫뚰몴媛 ?녿뒗 ???罹좏띁?ㅺ? ?덉뒿?덈떎.",

      `${universityState.missingCoordinateCount}媛???ぉ??醫뚰몴媛 ?놁뒿?덈떎.`,

      "怨듭떇 二쇱냼? 吏?ㅼ퐫??寃곌낵瑜?援먯감寃利앺빀?덈떎."
    );
  }

  if (
    universityState
      .missingWebsiteCount
      > 0
  ) {
    addIssue(
      "MEDIUM",

      "MISSING_WEBSITE",

      "怨듭떇 ?덊럹?댁? URL???녿뒗 ??숈씠 ?덉뒿?덈떎.",

      `${universityState.missingWebsiteCount}媛???ぉ?낅땲??`,

      "???怨듭떇 ?덊럹?댁?瑜??뺤씤??蹂댁셿 ?꾨낫瑜??앹꽦?⑸땲??"
    );
  }

  const severityWeight = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
  };

  issues.sort(
    (a, b) =>
      (
        severityWeight[
          b.severity
        ]
        || 0
      )
      -
      (
        severityWeight[
          a.severity
        ]
        || 0
      )
  );

  return issues;
}


// =========================================================
// 10. ?꾩껜 ?곹깭 怨꾩궛
// =========================================================

function calculateOverallStatus(
  priorityIssues
) {
  if (
    priorityIssues.some(
      (issue) =>
        issue.severity
          === "CRITICAL"
    )
  ) {
    return "CRITICAL";
  }

  if (
    priorityIssues.some(
      (issue) =>
        issue.severity
          === "HIGH"
    )
  ) {
    return "ATTENTION_REQUIRED";
  }

  if (
    priorityIssues.some(
      (issue) =>
        issue.severity
          === "MEDIUM"
    )
  ) {
    return "WARNING";
  }

  return "HEALTHY";
}


// =========================================================
// 11. Atomic Output
// =========================================================

function atomicWriteJson(
  filePath,
  value
) {
  const temp =
    `${filePath}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    )
    + "\n",
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
    filePath
  );
}


// =========================================================
// 12. Main
// =========================================================

function main() {
  const universities =
    loadUniversities();

  const sourceStateRaw =
    safeReadAgentJson(
      "source-247-state.json",
      {}
    );

  const retryStateRaw =
    safeReadAgentJson(
      "source-247-retry-state.json",
      {}
    );

  const agentStatusRaw =
    safeReadAgentJson(
      "agent-status.json",
      {}
    );

  const newsStoreRaw =
    safeReadAgentJson(
      "agent-news-store.json",
      {
        items: []
      }
    );

  const universityState =
    buildUniversityState(
      universities
    );

  const sourceValidation =
    buildSourceValidationState(
      sourceStateRaw,
      retryStateRaw
    );

  const newsStore =
    buildNewsStoreState(
      newsStoreRaw
    );

  const runtime =
    buildRuntimeState(
      agentStatusRaw
    );

  const priorityIssues =
    buildPriorityIssues({
      universityState,
      sourceState:
        sourceValidation,
      newsState:
        newsStore,
      runtimeState:
        runtime
    });

  const overallStatus =
    calculateOverallStatus(
      priorityIssues
    );

  const state = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    project:
      {
        id:
          "uni-pick",

        name:
          "UNI PICK",

        root:
          ROOT
      },

    overallStatus,

    runtime,

    universities:
      universityState,

    sourceValidation,

    newsStore,

    priorityIssueCount:
      priorityIssues.length,

    priorityIssues,

    safety:
      {
        readOnly:
          true,

        automaticFixes:
          false,

        deploymentTriggered:
          false,

        collectionTriggered:
          false
      }
  };

  atomicWriteJson(
    OUTPUT_FILE,
    state
  );

  console.log(
    JSON.stringify(
      state,
      null,
      2
    )
  );
}


if (
  require.main
  === module
) {
  main();
}


module.exports = {
  loadUniversities,
  buildUniversityState,
  buildSourceValidationState,
  buildNewsStoreState,
  buildRuntimeState,
  buildPriorityIssues,
  calculateOverallStatus
};
