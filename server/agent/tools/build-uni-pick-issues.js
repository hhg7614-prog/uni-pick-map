"use strict";

/**
 * UNI PICK Issue Generator v1
 *
 * Project State를 읽어 현재 개선 과제를 자동 생성하고
 * severity / impact / effort / confidence / priorityScore /
 * autoFixAllowed 기준으로 우선순위를 계산한다.
 *
 * 읽기 전용:
 * - 실제 코드 수정 안 함
 * - 데이터 수정 안 함
 * - 배포 안 함
 * - 수집 실행 안 함
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

const STATE_FILE = path.join(
  DATA_DIR,
  "uni-pick-project-state.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "uni-pick-issues.json"
);


// =========================================================
// 1. 공통 유틸
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
// 2. 점수 체계
// =========================================================

const SEVERITY_SCORE = {
  CRITICAL: 100,
  HIGH: 75,
  MEDIUM: 50,
  LOW: 25
};

const IMPACT_SCORE = {
  CRITICAL: 100,
  HIGH: 80,
  MEDIUM: 55,
  LOW: 30
};

const EFFORT_PENALTY = {
  LOW: 0,
  MEDIUM: 10,
  HIGH: 20,
  VERY_HIGH: 30
};

const CONFIDENCE_SCORE = {
  HIGH: 20,
  MEDIUM: 10,
  LOW: 0
};


function calculatePriorityScore({
  severity,
  impact,
  effort,
  confidence
}) {
  const severityScore =
    SEVERITY_SCORE[
      severity
    ] || 0;

  const impactScore =
    IMPACT_SCORE[
      impact
    ] || 0;

  const effortPenalty =
    EFFORT_PENALTY[
      effort
    ] || 0;

  const confidenceScore =
    CONFIDENCE_SCORE[
      confidence
    ] || 0;

  return (
    severityScore
    + impactScore
    + confidenceScore
    - effortPenalty
  );
}


// =========================================================
// 3. Issue 생성
// =========================================================

function createIssue({
  code,
  title,
  category,
  severity,
  impact,
  effort,
  confidence,
  evidence,
  reason,
  recommendedAction,
  successCriteria,
  autoFixAllowed,
  requiresHumanReview
}) {
  return {
    code,
    title,
    category,
    severity,
    impact,
    effort,
    confidence,

    priorityScore:
      calculatePriorityScore({
        severity,
        impact,
        effort,
        confidence
      }),

    evidence,
    reason,
    recommendedAction,
    successCriteria,

    autoFixAllowed:
      Boolean(
        autoFixAllowed
      ),

    requiresHumanReview:
      Boolean(
        requiresHumanReview
      ),

    status:
      "OPEN"
  };
}


// =========================================================
// 4. Project State → Issues
// =========================================================

function buildIssues(
  state
) {
  const issues = [];

  const universities =
    state.universities
    || {};

  const source =
    state.sourceValidation
    || {};

  const news =
    state.newsStore
    || {};

  const runtime =
    state.runtime
    || {};


  // -------------------------------------------------------
  // A. Source Error
  // -------------------------------------------------------

  if (
    Number(
      source.error
      || 0
    ) > 0
  ) {
    const errorCount =
      Number(
        source.error
        || 0
      );

    const total =
      Number(
        source.total
        || 247
      );

    const ratio =
      total > 0
        ? (
            errorCount
            / total
          )
        : 0;

    issues.push(
      createIssue({
        code:
          "SOURCE_VALIDATION_ERRORS",

        title:
          "대학 공식 출처 검증 오류 해결",

        category:
          "SOURCE_QUALITY",

        severity:
          ratio >= 0.25
            ? "CRITICAL"
            : "HIGH",

        impact:
          "CRITICAL",

        effort:
          "HIGH",

        confidence:
          "HIGH",

        evidence: {
          total,
          errorCount,
          errorRate:
            Number(
              (
                ratio * 100
              ).toFixed(2)
            )
        },

        reason:
          (
            "공식 출처 검증 오류가 많으면 "
            + "대학 공지 자동 수집과 최신화 범위를 확대할 수 없습니다."
          ),

        recommendedAction:
          (
            "153개 error 대학을 실패 원인별로 분류하고 "
            + "네트워크 오류, selector 오류, 후보 URL 부족, "
            + "콘텐츠 구조 오류 등으로 나눈 뒤 "
            + "자동 복구 가능한 유형부터 처리합니다."
          ),

        successCriteria: [
          "error 대학 원인 유형 100% 분류",
          "자동 복구 가능/불가 구분",
          "error 수 감소",
          "재시도 후 신규 오류가 증가하지 않음"
        ],

        autoFixAllowed:
          false,

        requiresHumanReview:
          true
      })
    );
  }


  // -------------------------------------------------------
  // B. Source Review
  // -------------------------------------------------------

  if (
    Number(
      source.review
      || 0
    ) > 0
  ) {
    issues.push(
      createIssue({
        code:
          "SOURCE_REVIEW_QUEUE",

        title:
          "출처 검토 대기 42건 정리",

        category:
          "SOURCE_QUALITY",

        severity:
          "HIGH",

        impact:
          "HIGH",

        effort:
          "MEDIUM",

        confidence:
          "HIGH",

        evidence: {
          reviewCount:
            Number(
              source.review
              || 0
            )
        },

        reason:
          (
            "review 상태가 오래 남으면 "
            + "실제 사용 가능한 출처가 있어도 "
            + "운영 수집 대상에 포함되지 못할 수 있습니다."
          ),

        recommendedAction:
          (
            "review 후보를 신뢰도, URL 형태, "
            + "대학 공식 도메인 여부, 공지 목록 탐지 성공 여부로 "
            + "재점수화하고 자동 승인 가능 후보와 "
            + "사람 검토 필요 후보를 분리합니다."
          ),

        successCriteria: [
          "42건 전체 재분류",
          "고신뢰 자동 승인 후보 분리",
          "사람 검토 대상 최소화",
          "잘못된 자동 승인 0건"
        ],

        autoFixAllowed:
          false,

        requiresHumanReview:
          true
      })
    );
  }


  // -------------------------------------------------------
  // C. News Coverage
  // -------------------------------------------------------

  const universityCount =
    Number(
      universities
        .totalEntries
      || 0
    );

  const newsCoverage =
    Number(
      news
        .universityCoverageCount
      || 0
    );

  if (
    universityCount > 0
    && newsCoverage
      < universityCount
  ) {
    const coverageRate =
      newsCoverage
      / universityCount;

    issues.push(
      createIssue({
        code:
          "NEWS_UNIVERSITY_COVERAGE",

        title:
          "대학 공지 커버리지 확대",

        category:
          "NEWS_COVERAGE",

        severity:
          coverageRate < 0.25
            ? "HIGH"
            : "MEDIUM",

        impact:
          "HIGH",

        effort:
          "HIGH",

        confidence:
          "HIGH",

        evidence: {
          universityCount,
          coveredUniversities:
            newsCoverage,

          missingUniversities:
            Math.max(
              0,
              universityCount
              - newsCoverage
            ),

          coveragePercent:
            Number(
              (
                coverageRate
                * 100
              ).toFixed(2)
            )
        },

        reason:
          (
            "현재 공지 저장소가 일부 대학에만 집중되어 있어 "
            + "전국 대학지도 서비스라는 목표와 실제 데이터 범위 사이에 차이가 있습니다."
          ),

        recommendedAction:
          (
            "source error/review 문제를 먼저 줄인 뒤 "
            + "공지 미수집 대학을 우선순위 큐로 만들고 "
            + "공식 일반공지 feed부터 단계적으로 수집 범위를 확대합니다."
          ),

        successCriteria: [
          "대학별 공지 커버리지 지속 증가",
          "신규 대학 추가 시 중복 URL 0 유지",
          "SHARED_SOURCE 정책 위반 없음",
          "수집 실패 대학 별도 기록"
        ],

        autoFixAllowed:
          false,

        requiresHumanReview:
          true
      })
    );
  }


  // -------------------------------------------------------
  // D. Duplicate URL
  // -------------------------------------------------------

  if (
    Number(
      news
        .duplicateSourceUrlGroups
      || 0
    ) > 0
  ) {
    issues.push(
      createIssue({
        code:
          "DUPLICATE_NEWS_URL",

        title:
          "공지 상세 URL 중복 제거",

        category:
          "DATA_INTEGRITY",

        severity:
          "HIGH",

        impact:
          "HIGH",

        effort:
          "LOW",

        confidence:
          "HIGH",

        evidence: {
          duplicateGroups:
            Number(
              news
                .duplicateSourceUrlGroups
              || 0
            )
        },

        reason:
          (
            "동일 상세 URL이 여러 item으로 저장되면 "
            + "공지 중복 노출과 통계 왜곡이 발생합니다."
          ),

        recommendedAction:
          (
            "저장 직전 상세 URL canonicalization 및 "
            + "dedup 검사를 강화합니다."
          ),

        successCriteria: [
          "상세 URL 중복 0",
          "urlHash 중복 0",
          "중복 제거 후 정상 공지 손실 0"
        ],

        autoFixAllowed:
          true,

        requiresHumanReview:
          false
      })
    );
  }


  // -------------------------------------------------------
  // E. Missing Coordinates
  // -------------------------------------------------------

  if (
    Number(
      universities
        .missingCoordinateCount
      || 0
    ) > 0
  ) {
    issues.push(
      createIssue({
        code:
          "MISSING_COORDINATES",

        title:
          "대학 좌표 누락 보완",

        category:
          "MAP_DATA",

        severity:
          "HIGH",

        impact:
          "HIGH",

        effort:
          "MEDIUM",

        confidence:
          "HIGH",

        evidence: {
          missingCount:
            Number(
              universities
                .missingCoordinateCount
              || 0
            )
        },

        reason:
          (
            "좌표가 없으면 지도 표출, 가까운 역 계산, "
            + "경로 안내 기능이 정상 동작하지 않을 수 있습니다."
          ),

        recommendedAction:
          (
            "공식 주소와 지오코딩 결과를 교차검증한 뒤 "
            + "후보 좌표를 생성합니다."
          ),

        successCriteria: [
          "lat/lng 누락 0",
          "좌표가 해당 캠퍼스 실제 위치와 일치",
          "지도 marker regression 없음"
        ],

        autoFixAllowed:
          false,

        requiresHumanReview:
          true
      })
    );
  }


  // -------------------------------------------------------
  // F. Invalid Websites
  // -------------------------------------------------------

  if (
    Number(
      universities
        .missingWebsiteCount
      || 0
    ) > 0
    ||
    Number(
      universities
        .invalidWebsiteCount
      || 0
    ) > 0
  ) {
    issues.push(
      createIssue({
        code:
          "UNIVERSITY_WEBSITE_QUALITY",

        title:
          "대학 공식 홈페이지 데이터 보완",

        category:
          "MAP_DATA",

        severity:
          "MEDIUM",

        impact:
          "MEDIUM",

        effort:
          "MEDIUM",

        confidence:
          "HIGH",

        evidence: {
          missingWebsiteCount:
            Number(
              universities
                .missingWebsiteCount
              || 0
            ),

          invalidWebsiteCount:
            Number(
              universities
                .invalidWebsiteCount
              || 0
            )
        },

        reason:
          (
            "공식 홈페이지 정보가 없거나 잘못되면 "
            + "사용자 탐색과 source 검증 모두 영향을 받습니다."
          ),

        recommendedAction:
          (
            "누락/비정상 URL을 공식 대학 도메인 기준으로 재확인합니다."
          ),

        successCriteria: [
          "website 누락 최소화",
          "URL 형식 오류 0",
          "공식 도메인 여부 검증"
        ],

        autoFixAllowed:
          false,

        requiresHumanReview:
          true
      })
    );
  }


  // -------------------------------------------------------
  // G. Agent disabled
  // -------------------------------------------------------

  if (
    runtime.agentEnabled
    === false
  ) {
    issues.push(
      createIssue({
        code:
          "NEWS_AGENT_DISABLED",

        title:
          "공지 Agent 비활성 상태 확인",

        category:
          "RUNTIME",

        severity:
          "MEDIUM",

        impact:
          "MEDIUM",

        effort:
          "LOW",

        confidence:
          "HIGH",

        evidence: {
          agentEnabled:
            false,

          lastRunAt:
            runtime.lastRunAt
            || null
        },

        reason:
          (
            "Agent가 장기간 비활성화되어 있으면 "
            + "공지 최신성이 떨어질 수 있습니다."
          ),

        recommendedAction:
          (
            "현재 비활성 상태가 의도된 운영 정책인지 확인하고 "
            + "09:30 / 16:30 예약 정책과 실제 scheduler 상태를 비교합니다."
          ),

        successCriteria: [
          "운영 의도와 agentEnabled 상태 일치",
          "예약 실행 상태 확인",
          "수동/예약 실행 정책 문서화"
        ],

        autoFixAllowed:
          false,

        requiresHumanReview:
          true
      })
    );
  }


  // =======================================================
  // 정렬
  // =======================================================

  issues.sort(
    (a, b) =>
      b.priorityScore
      - a.priorityScore
  );

  return issues;
}


// =========================================================
// 5. Improvement Queue
// =========================================================

function buildImprovementQueue(
  issues
) {
  return issues.map(
    (
      issue,
      index
    ) => ({
      rank:
        index + 1,

      code:
        issue.code,

      title:
        issue.title,

      priorityScore:
        issue.priorityScore,

      severity:
        issue.severity,

      impact:
        issue.impact,

      effort:
        issue.effort,

      confidence:
        issue.confidence,

      autoFixAllowed:
        issue.autoFixAllowed,

      requiresHumanReview:
        issue.requiresHumanReview,

      recommendedAction:
        issue.recommendedAction
    })
  );
}


// =========================================================
// 6. Main
// =========================================================

function main() {
  if (
    !fs.existsSync(
      STATE_FILE
    )
  ) {
    throw new Error(
      "uni-pick-project-state.json이 없습니다. 먼저 build-uni-pick-project-state.js를 실행하세요."
    );
  }

  const state =
    readJson(
      STATE_FILE
    );

  const issues =
    buildIssues(
      state
    );

  const queue =
    buildImprovementQueue(
      issues
    );

  const result = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    sourceProjectState:
      path.basename(
        STATE_FILE
      ),

    overallProjectStatus:
      state.overallStatus,

    issueCount:
      issues.length,

    criticalCount:
      issues.filter(
        (issue) =>
          issue.severity
          === "CRITICAL"
      ).length,

    highCount:
      issues.filter(
        (issue) =>
          issue.severity
          === "HIGH"
      ).length,

    mediumCount:
      issues.filter(
        (issue) =>
          issue.severity
          === "MEDIUM"
      ).length,

    autoFixableCount:
      issues.filter(
        (issue) =>
          issue.autoFixAllowed
      ).length,

    humanReviewCount:
      issues.filter(
        (issue) =>
          issue.requiresHumanReview
      ).length,

    topIssues:
      issues.slice(
        0,
        5
      ),

    improvementQueue:
      queue,

    safety: {
      readOnly:
        true,

      fixesExecuted:
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
  calculatePriorityScore,
  createIssue,
  buildIssues,
  buildImprovementQueue
};