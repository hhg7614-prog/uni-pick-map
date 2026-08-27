"use strict";

/**
 * UNI PICK Improvement Planner v1
 *
 * 현재 1순위 이슈:
 * SOURCE_VALIDATION_ERRORS
 *
 * 역할:
 * - source-247-state.json의 실제 ERROR 153건 분석
 * - reason 기준 실패 유형 자동 분류
 * - 자동 복구 후보 / 추가 진단 / 사람 검토 분리
 * - 이번 개선 사이클의 실행 계획 생성
 *
 * 안전:
 * - 읽기 전용
 * - 실제 재시도 안 함
 * - 코드 수정 안 함
 * - 데이터 수정 안 함
 * - 배포 안 함
 */

const fs = require("fs");
const path = require("path");


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

const SOURCE_STATE_FILE = path.join(
  DATA_DIR,
  "source-247-state.json"
);

const ISSUES_FILE = path.join(
  DATA_DIR,
  "uni-pick-issues.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "uni-pick-improvement-plan.json"
);


// =========================================================
// 1. 유틸
// =========================================================

function readJson(
  filePath
) {
  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  );
}


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
    filePath
  );
}


// =========================================================
// 2. 실패 사유 분류
// =========================================================

function classifyFailure(
  reason
) {
  const text = String(
    reason || ""
  ).toLowerCase();

  if (
    text.includes("robots.txt")
    || text.includes("robots")
  ) {
    return {
      type:
        "ROBOTS_BLOCKED",

      recoveryClass:
        "HUMAN_REVIEW",

      autoRetryRecommended:
        false,

      description:
        "robots.txt 또는 사이트 정책으로 진단 요청이 차단됨"
    };
  }

  if (
    text.includes("404")
    || text.includes("not found")
  ) {
    return {
      type:
        "HTTP_404",

      recoveryClass:
        "DIAGNOSE_FIRST",

      autoRetryRecommended:
        false,

      description:
        "기존 후보 URL이 더 이상 존재하지 않거나 경로가 변경됨"
    };
  }

  if (
    text.includes("403")
    || text.includes("forbidden")
  ) {
    return {
      type:
        "HTTP_403",

      recoveryClass:
        "DIAGNOSE_FIRST",

      autoRetryRecommended:
        false,

      description:
        "접근 차단 또는 요청 정책 문제"
    };
  }

  if (
    text.includes("429")
    || text.includes("too many requests")
    || text.includes("rate limit")
  ) {
    return {
      type:
        "RATE_LIMIT",

      recoveryClass:
        "AUTO_RECOVERY_CANDIDATE",

      autoRetryRecommended:
        true,

      description:
        "요청 빈도 제한 가능성"
    };
  }

  if (
    text.includes("timeout")
    || text.includes("timed out")
  ) {
    return {
      type:
        "TIMEOUT",

      recoveryClass:
        "AUTO_RECOVERY_CANDIDATE",

      autoRetryRecommended:
        true,

      description:
        "일시적 네트워크 또는 서버 응답 지연 가능성"
    };
  }

  if (
    text.includes("fetch failed")
    || text.includes("network")
    || text.includes("econn")
    || text.includes("socket")
    || text.includes("dns")
  ) {
    return {
      type:
        "NETWORK_FETCH",

      recoveryClass:
        "AUTO_RECOVERY_CANDIDATE",

      autoRetryRecommended:
        true,

      description:
        "네트워크 또는 일시적 fetch 실패 가능성"
    };
  }

  if (
    text.includes("ssl")
    || text.includes("certificate")
    || text.includes("tls")
  ) {
    return {
      type:
        "TLS_SSL",

      recoveryClass:
        "DIAGNOSE_FIRST",

      autoRetryRecommended:
        false,

      description:
        "TLS/SSL 인증서 또는 연결 문제"
    };
  }

  if (
    text.includes("selector")
    || text.includes("container")
    || text.includes("parse")
    || text.includes("content")
  ) {
    return {
      type:
        "CONTENT_STRUCTURE",

      recoveryClass:
        "DIAGNOSE_FIRST",

      autoRetryRecommended:
        false,

      description:
        "HTML 구조, selector, 콘텐츠 컨테이너 문제"
    };
  }

  if (
    text.includes("candidate")
    || text.includes("no source")
    || text.includes("no url")
  ) {
    return {
      type:
        "NO_CANDIDATE",

      recoveryClass:
        "DIAGNOSE_FIRST",

      autoRetryRecommended:
        false,

      description:
        "적절한 공식 공지 후보 URL 탐색 실패"
    };
  }

  return {
    type:
      "UNKNOWN",

    recoveryClass:
      "DIAGNOSE_FIRST",

    autoRetryRecommended:
      false,

    description:
      "현재 규칙으로 자동 분류되지 않은 실패"
  };
}


// =========================================================
// 3. ERROR 행 추출
// =========================================================

function collectErrorRows(
  sourceState
) {
  const errorIds =
    new Set(
      Array.isArray(
        sourceState.errorIds
      )
        ? sourceState.errorIds
        : []
    );

  const results =
    Array.isArray(
      sourceState.results
    )
      ? sourceState.results
      : [];

  return results
    .filter(
      (row) =>
        errorIds.has(
          row.universityId
        )
    )
    .map(
      (row) => {
        const classification =
          classifyFailure(
            row.reason
          );

        return {
          universityId:
            row.universityId,

          universityName:
            row.universityName
            || "",

          reason:
            row.reason
            || "",

          completedAt:
            row.completedAt
            || null,

          durationMs:
            Number(
              row.durationMs
              || 0
            ),

          candidateCount:
            Number(
              row.candidateCount
              || 0
            ),

          detailedVerificationCount:
            Number(
              row.detailedVerificationCount
              || 0
            ),

          failureType:
            classification.type,

          recoveryClass:
            classification
              .recoveryClass,

          autoRetryRecommended:
            classification
              .autoRetryRecommended,

          failureDescription:
            classification
              .description
        };
      }
    );
}


// =========================================================
// 4. 그룹화
// =========================================================

function buildFailureGroups(
  rows
) {
  const map =
    new Map();

  for (
    const row
    of rows
  ) {
    if (
      !map.has(
        row.failureType
      )
    ) {
      map.set(
        row.failureType,
        {
          failureType:
            row.failureType,

          recoveryClass:
            row.recoveryClass,

          description:
            row.failureDescription,

          count:
            0,

          universityIds:
            [],

          reasons:
            new Set(),

          autoRetryRecommended:
            row.autoRetryRecommended
        }
      );
    }

    const group =
      map.get(
        row.failureType
      );

    group.count += 1;

    group.universityIds.push(
      row.universityId
    );

    group.reasons.add(
      row.reason
    );
  }

  return Array.from(
    map.values()
  )
    .map(
      (group) => ({
        failureType:
          group.failureType,

        recoveryClass:
          group.recoveryClass,

        description:
          group.description,

        count:
          group.count,

        percentage:
          rows.length > 0
            ? Number(
                (
                  group.count
                  / rows.length
                  * 100
                ).toFixed(2)
              )
            : 0,

        autoRetryRecommended:
          group
            .autoRetryRecommended,

        sampleUniversityIds:
          group
            .universityIds
            .slice(
              0,
              10
            ),

        sampleReasons:
          Array.from(
            group.reasons
          ).slice(
            0,
            5
          )
      })
    )
    .sort(
      (a, b) =>
        b.count
        - a.count
    );
}


// =========================================================
// 5. Recovery Class 요약
// =========================================================

function buildRecoverySummary(
  rows
) {
  const summary = {
    AUTO_RECOVERY_CANDIDATE:
      0,

    DIAGNOSE_FIRST:
      0,

    HUMAN_REVIEW:
      0
  };

  for (
    const row
    of rows
  ) {
    if (
      summary[
        row.recoveryClass
      ] === undefined
    ) {
      summary[
        row.recoveryClass
      ] = 0;
    }

    summary[
      row.recoveryClass
    ] += 1;
  }

  return summary;
}


// =========================================================
// 6. 파일럿 후보
// =========================================================

function buildPilotCandidates(
  rows,
  limit = 10
) {
  return rows
    .filter(
      (row) =>
        row.recoveryClass
          ===
        "AUTO_RECOVERY_CANDIDATE"
    )
    .sort(
      (a, b) => {
        // 후보 URL이 있는 항목 우선
        if (
          b.candidateCount
          !==
          a.candidateCount
        ) {
          return (
            b.candidateCount
            -
            a.candidateCount
          );
        }

        return (
          a.durationMs
          -
          b.durationMs
        );
      }
    )
    .slice(
      0,
      limit
    );
}


// =========================================================
// 7. Improvement Plan
// =========================================================

function buildPlan({
  issue,
  rows,
  groups,
  recoverySummary,
  pilotCandidates
}) {
  return {
    targetIssue: {
      code:
        issue?.code
        || "SOURCE_VALIDATION_ERRORS",

      title:
        issue?.title
        || "대학 공식 출처 검증 오류 해결",

      priorityScore:
        issue
          ?.priorityScore
        ?? null
    },

    objective:
      (
        `${rows.length}개 source validation ERROR를 `
        + "실패 유형별로 분류하고 저위험 자동 복구 후보부터 "
        + "소규모 파일럿으로 검증한다."
      ),

    strategy:
      "CLASSIFY_THEN_PILOT",

    steps: [
      {
        step:
          1,

        name:
          "ERROR 원인 분류",

        action:
          "source-247-state.json의 ERROR 결과를 reason 기준으로 분류",

        status:
          "COMPLETED",

        output:
          `${groups.length}개 실패 유형`
      },

      {
        step:
          2,

        name:
          "자동 복구 가능성 분리",

        action:
          (
            "AUTO_RECOVERY_CANDIDATE / "
            + "DIAGNOSE_FIRST / HUMAN_REVIEW로 분리"
          ),

        status:
          "COMPLETED",

        output:
          recoverySummary
      },

      {
        step:
          3,

        name:
          "저위험 파일럿 대상 선정",

        action:
          (
            "네트워크/timeout/rate-limit 계열 중 "
            + "최대 10개 대학을 파일럿 후보로 선정"
          ),

        status:
          "COMPLETED",

        outputCount:
          pilotCandidates.length
      },

      {
        step:
          4,

        name:
          "파일럿 재진단",

        action:
          (
            "선정된 후보만 기존 retry/diagnostic 도구로 "
            + "재실행하고 성공률 측정"
          ),

        status:
          "NOT_EXECUTED",

        requiresWriteOrNetwork:
          true,

        requiresHumanApproval:
          true
      },

      {
        step:
          5,

        name:
          "파일럿 결과 평가",

        action:
          (
            "성공/실패/새 오류를 비교하고 "
            + "자동 확대 가능 여부 판단"
          ),

        status:
          "PENDING"
      },

      {
        step:
          6,

        name:
          "복구 전략 확대",

        action:
          (
            "파일럿 성공률이 기준 이상이면 "
            + "같은 failureType 전체로 확대"
          ),

        status:
          "PENDING"
      }
    ],

    executionPolicy: {
      currentMode:
        "READ_ONLY_PLANNING",

      automaticRetry:
        false,

      automaticCodeChange:
        false,

      automaticDeployment:
        false,

      nextActionRequiresApproval:
        true,

      proposedNextAction:
        "AUTO_RECOVERY_CANDIDATE 파일럿 최대 10건 재진단"
    },

    successCriteria: {
      classificationCoveragePercent:
        100,

      pilotTargetMaximum:
        10,

      pilotMinimumSuccessRateForExpansion:
        70,

      regressionTolerance:
        0,

      newDuplicateTolerance:
        0
    }
  };
}


// =========================================================
// 8. Main
// =========================================================

function main() {
  if (
    !fs.existsSync(
      SOURCE_STATE_FILE
    )
  ) {
    throw new Error(
      "source-247-state.json이 없습니다."
    );
  }

  const sourceState =
    readJson(
      SOURCE_STATE_FILE
    );

  const issueState =
    fs.existsSync(
      ISSUES_FILE
    )
      ? readJson(
          ISSUES_FILE
        )
      : null;

  const sourceIssue =
    issueState
      ?.improvementQueue
      ?.find(
        (item) =>
          item.code
          ===
          "SOURCE_VALIDATION_ERRORS"
      )
    || null;

  const rows =
    collectErrorRows(
      sourceState
    );

  const groups =
    buildFailureGroups(
      rows
    );

  const recoverySummary =
    buildRecoverySummary(
      rows
    );

  const pilotCandidates =
    buildPilotCandidates(
      rows,
      10
    );

  const plan =
    buildPlan({
      issue:
        sourceIssue,

      rows,

      groups,

      recoverySummary,

      pilotCandidates
    });

  const result = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    sourceStateFile:
      path.basename(
        SOURCE_STATE_FILE
      ),

    totalErrorRows:
      rows.length,

    failureTypeCount:
      groups.length,

    failureGroups:
      groups,

    recoverySummary,

    pilotCandidates,

    plan,

    safety: {
      readOnly:
        true,

      retriesExecuted:
        false,

      filesModified:
        false,

      deploymentTriggered:
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


module.exports = {
  classifyFailure,
  collectErrorRows,
  buildFailureGroups,
  buildRecoverySummary,
  buildPilotCandidates,
  buildPlan
};