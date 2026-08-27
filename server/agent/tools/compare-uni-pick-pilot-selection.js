"use strict";

/**
 * UNI PICK Pilot Selection Bridge v1
 *
 * Improvement Planner가 source-247-state.json에서 선정한
 * AUTO_RECOVERY_CANDIDATE와 기존 onboarding retry10 선택기를 비교한다.
 *
 * 읽기 전용:
 * - 네트워크 요청 없음
 * - queue 수정 없음
 * - source/store/preview 수정 없음
 */

const fs = require("fs");
const path = require("path");

const planner = require("./build-uni-pick-improvement-plan");
const retryTool = require(
  "../onboarding/tools/run-priority-network-retry10"
);
const queueTool = require(
  "../onboarding/tools/run-university-feed-agent-v1-queue"
);

const ROOT = path.resolve(
  __dirname,
  "../../.."
);

const SOURCE_STATE_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "data",
  "source-247-state.json"
);

const QUEUE_STATE_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "onboarding",
  "data",
  "university-feed-agent-v1-queue-state.json"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const OUTPUT_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "data",
  "uni-pick-pilot-selection-comparison.json"
);


function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}


function normalizeId(value) {
  return String(
    value || ""
  ).normalize("NFC");
}


function atomicWriteJson(
  file,
  value
) {
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


function main() {
  const sourceState =
    readJson(
      SOURCE_STATE_FILE
    );

  const errorRows =
    planner.collectErrorRows(
      sourceState
    );

  const plannerCandidates =
    planner.buildPilotCandidates(
      errorRows,
      100
    );

  const plannerIds =
    new Set(
      plannerCandidates.map(
        item =>
          normalizeId(
            item.universityId
          )
      )
    );

  const queueState =
    queueTool.syncVerified(
      queueTool.loadQueueState()
    );

  const catalog =
    readJson(
      CATALOG_FILE
    );

  const retryPlan =
    retryTool.priorityPlan(
      queueState,
      catalog
    );

  const retrySelected =
    retryPlan.selected || [];

  const retryIds =
    new Set(
      retrySelected.map(
        item =>
          normalizeId(
            item.universityId
          )
      )
    );

  const overlap =
    retrySelected.filter(
      item =>
        plannerIds.has(
          normalizeId(
            item.universityId
          )
        )
    );

  const retryOnly =
    retrySelected.filter(
      item =>
        !plannerIds.has(
          normalizeId(
            item.universityId
          )
        )
    );

  const plannerOnly =
    plannerCandidates.filter(
      item =>
        !retryIds.has(
          normalizeId(
            item.universityId
          )
        )
    );

  const overlapPercent =
    retrySelected.length
      ? Number(
          (
            overlap.length
            / retrySelected.length
            * 100
          ).toFixed(2)
        )
      : 0;

  let compatibilityStatus;

  if (
    retrySelected.length === 0
  ) {
    compatibilityStatus =
      "NO_RETRY_SELECTION";
  } else if (
    overlap.length
    === retrySelected.length
  ) {
    compatibilityStatus =
      "FULL_MATCH";
  } else if (
    overlap.length >= 7
  ) {
    compatibilityStatus =
      "HIGH_MATCH";
  } else if (
    overlap.length >= 4
  ) {
    compatibilityStatus =
      "PARTIAL_MATCH";
  } else {
    compatibilityStatus =
      "LOW_MATCH";
  }

  const safeToExecuteExistingRetry =
    compatibilityStatus
      === "FULL_MATCH"
    ||
    compatibilityStatus
      === "HIGH_MATCH";

  const result = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    planner: {
      source:
        "source-247-state.json",

      autoRecoveryCandidateCount:
        plannerCandidates.length,

      candidateIds:
        plannerCandidates.map(
          item =>
            item.universityId
        )
    },

    existingRetry10: {
      source:
        "university-feed-agent-v1-queue-state.json",

      selectedCount:
        retrySelected.length,

      selectedIds:
        retrySelected.map(
          item =>
            item.universityId
        )
    },

    comparison: {
      overlapCount:
        overlap.length,

      overlapPercent,

      compatibilityStatus,

      safeToExecuteExistingRetry,

      overlap:
        overlap.map(
          item => ({
            universityId:
              item.universityId,

            universityName:
              item.universityName
          })
        ),

      retryOnly:
        retryOnly.map(
          item => ({
            universityId:
              item.universityId,

            universityName:
              item.universityName,

            failureReason:
              item.failureReason,

            networkSubtype:
              item.networkSubtype
          })
        ),

      plannerOnly:
        plannerOnly.map(
          item => ({
            universityId:
              item.universityId,

            universityName:
              item.universityName,

            reason:
              item.reason,

            failureType:
              item.failureType
          })
        )
    },

    decision: {
      executeRetry10Now:
        safeToExecuteExistingRetry,

      ifUnsafe:
        (
          "기존 retry10을 바로 실행하지 말고 "
          + "Planner 후보와 onboarding queue의 기준을 연결하는 "
          + "전용 Safe Pilot Executor를 사용합니다."
        )
    },

    safety: {
      readOnly:
        true,

      networkRequests:
        0,

      queueModified:
        false,

      retryExecuted:
        false
    }
  };

  atomicWriteJson(
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


if (
  require.main
  === module
) {
  main();
}