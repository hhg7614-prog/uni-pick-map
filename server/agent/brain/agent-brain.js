"use strict";

/**
 * ============================================================
 * UNI PICK / General Autonomous Agent
 * Agent Brain v0.1
 * ============================================================
 *
 * 목적
 * ------------------------------------------------------------
 * 단순한 if/else 작업 실행기가 아니라,
 *
 * 1. 사용자의 목표를 받는다.
 * 2. 현재 상태를 읽는다.
 * 3. 목표와 현재 상태의 차이를 판단한다.
 * 4. 가능한 행동 후보를 만든다.
 * 5. 위험한 행동은 차단한다.
 * 6. 가장 적절한 다음 행동을 선택한다.
 * 7. 판단 이유를 기록한다.
 *
 * 이 파일은 아직 실제 파일 수정 / Git / 배포 / 네트워크 요청을
 * 직접 실행하지 않는다.
 *
 * 즉:
 *
 * THINK -> DECIDE
 *
 * 까지만 담당한다.
 *
 * 이후 별도 Executor가
 *
 * DECIDE -> ACT
 *
 * 를 담당하게 된다.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");

/* ============================================================
 * PATH
 * ============================================================ */

const ROOT = path.resolve(
  __dirname,
  "../../.."
);

const AGENT_ROOT = path.join(
  ROOT,
  "server",
  "agent"
);

const MEMORY_DIR = path.join(
  AGENT_ROOT,
  "memory"
);

const DATA_DIR = path.join(
  AGENT_ROOT,
  "data"
);

const STATE_FILE = path.join(
  MEMORY_DIR,
  "agent-state.json"
);

const GOAL_FILE = path.join(
  MEMORY_DIR,
  "current-goal.json"
);

const DECISION_FILE = path.join(
  MEMORY_DIR,
  "latest-decision.json"
);

const HISTORY_FILE = path.join(
  MEMORY_DIR,
  "decision-history.json"
);

/* ============================================================
 * BASIC UTILITIES
 * ============================================================ */

function ensureDirectory(directory) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

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
  ensureDirectory(
    path.dirname(file)
  );

  const temporary =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      temporary,
      "utf8"
    )
  );

  fs.renameSync(
    temporary,
    file
  );
}

function nowIso() {
  return new Date()
    .toISOString();
}

function normalizeText(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .trim();
}

/* ============================================================
 * DEFAULT MEMORY
 * ============================================================ */

function defaultState() {
  return {
    schemaVersion: "0.1",

    updatedAt: nowIso(),

    agent: {
      name: "UNI PICK Autonomous Agent",

      mode: "THINK_ONLY",

      autonomyLevel: 1,

      status: "IDLE"
    },

    currentTask: null,

    observations: [],

    facts: [],

    assumptions: [],

    blockers: [],

    completedActions: [],

    pendingActions: [],

    safety: {
      allowFileRead: true,

      allowFileWrite: false,

      allowNetwork: false,

      allowGit: false,

      allowDeploy: false,

      allowProductionMutation: false
    }
  };
}

function defaultGoal() {
  return {
    schemaVersion: "0.1",

    updatedAt: nowIso(),

    goal: null,

    successCriteria: [],

    constraints: [],

    priorities: [],

    userIntent: null
  };
}

/* ============================================================
 * LOAD MEMORY
 * ============================================================ */

function loadState() {
  const state =
    readJson(
      STATE_FILE,
      null
    );

  if (state) {
    return state;
  }

  const created =
    defaultState();

  atomicWrite(
    STATE_FILE,
    created
  );

  return created;
}

function loadGoal() {
  const goal =
    readJson(
      GOAL_FILE,
      null
    );

  if (goal) {
    return goal;
  }

  const created =
    defaultGoal();

  atomicWrite(
    GOAL_FILE,
    created
  );

  return created;
}

/* ============================================================
 * OBSERVATION
 * ============================================================ */

/**
 * 현재 agent/data 안의 상태를 단순 관찰한다.
 *
 * 아직 모든 파일을 해석하지 않는다.
 * 존재 여부 및 파일 목록만 관찰한다.
 */
function observeEnvironment() {
  ensureDirectory(
    DATA_DIR
  );

  let files = [];

  try {
    files =
      fs.readdirSync(
        DATA_DIR
      )
      .filter(
        file =>
          file.endsWith(
            ".json"
          )
      );
  } catch {
    files = [];
  }

  return {
    observedAt: nowIso(),

    dataDirectory:
      DATA_DIR,

    jsonFileCount:
      files.length,

    jsonFiles:
      files
  };
}

/* ============================================================
 * GOAL ANALYSIS
 * ============================================================ */

function analyzeGoal(goalMemory) {
  const rawGoal =
    goalMemory?.goal;

  if (
    !rawGoal
    ||
    normalizeText(
      rawGoal
    ).length === 0
  ) {
    return {
      hasGoal: false,

      goalText: null,

      intentType:
        "NO_GOAL",

      confidence:
        1
    };
  }

  const goalText =
    normalizeText(
      rawGoal
    );

  const lower =
    goalText.toLowerCase();

  let intentType =
    "GENERAL_TASK";

  if (
    lower.includes("검증")
    ||
    lower.includes("validate")
    ||
    lower.includes("verify")
  ) {
    intentType =
      "VALIDATION";
  }

  if (
    lower.includes("수집")
    ||
    lower.includes("collect")
  ) {
    intentType =
      "COLLECTION";
  }

  if (
    lower.includes("분석")
    ||
    lower.includes("analyze")
  ) {
    intentType =
      "ANALYSIS";
  }

  if (
    lower.includes("수정")
    ||
    lower.includes("변경")
    ||
    lower.includes("edit")
    ||
    lower.includes("modify")
  ) {
    intentType =
      "MODIFICATION";
  }

  if (
    lower.includes("배포")
    ||
    lower.includes("deploy")
  ) {
    intentType =
      "DEPLOYMENT";
  }

  return {
    hasGoal: true,

    goalText,

    intentType,

    confidence:
      0.8
  };
}

/* ============================================================
 * GAP ANALYSIS
 * ============================================================ */

/**
 * 목표와 현재 상태 사이에 어떤 차이가 있는지 판단한다.
 */
function analyzeGap({
  goalAnalysis,
  state,
  observation
}) {
  const gaps = [];

  if (
    !goalAnalysis.hasGoal
  ) {
    gaps.push({
      type:
        "MISSING_GOAL",

      severity:
        "HIGH",

      description:
        "현재 에이전트가 수행해야 할 명시적인 목표가 없습니다."
    });

    return gaps;
  }

  if (
    observation.jsonFileCount === 0
  ) {
    gaps.push({
      type:
        "NO_ENVIRONMENT_CONTEXT",

      severity:
        "MEDIUM",

      description:
        "현재 작업 판단에 사용할 데이터 파일이 없습니다."
    });
  }

  if (
    !Array.isArray(
      state.facts
    )
    ||
    state.facts.length === 0
  ) {
    gaps.push({
      type:
        "INSUFFICIENT_FACTS",

      severity:
        "MEDIUM",

      description:
        "목표를 판단하기 위한 확정 사실이 아직 충분하지 않습니다."
    });
  }

  if (
    Array.isArray(
      state.blockers
    )
    &&
    state.blockers.length > 0
  ) {
    gaps.push({
      type:
        "EXISTING_BLOCKERS",

      severity:
        "HIGH",

      description:
        `${state.blockers.length}개의 blocker가 기록되어 있습니다.`
    });
  }

  return gaps;
}

/* ============================================================
 * ACTION GENERATION
 * ============================================================ */

/**
 * 사람처럼 판단한다는 의미는
 * 아무 행동이나 하는 것이 아니라
 * 현재 정보 기준으로 여러 선택지를 만든 뒤 비교하는 것이다.
 */
function generateCandidateActions({
  goalAnalysis,
  gaps,
  state,
  observation
}) {
  const actions = [];

  if (
    !goalAnalysis.hasGoal
  ) {
    actions.push({
      id:
        "WAIT_FOR_GOAL",

      type:
        "WAIT",

      description:
        "사용자의 목표가 설정될 때까지 실행 행동을 만들지 않습니다.",

      expectedBenefit:
        10,

      risk:
        0,

      cost:
        0,

      requiresMutation:
        false
    });

    return actions;
  }

  if (
    gaps.some(
      gap =>
        gap.type ===
        "NO_ENVIRONMENT_CONTEXT"
    )
  ) {
    actions.push({
      id:
        "INSPECT_AVAILABLE_CONTEXT",

      type:
        "OBSERVE",

      description:
        "사용 가능한 작업 데이터와 상태 파일을 확인합니다.",

      expectedBenefit:
        80,

      risk:
        5,

      cost:
        10,

      requiresMutation:
        false
    });
  }

  if (
    gaps.some(
      gap =>
        gap.type ===
        "INSUFFICIENT_FACTS"
    )
  ) {
    actions.push({
      id:
        "GATHER_FACTS",

      type:
        "REASON",

      description:
        "목표 달성에 필요한 사실과 증거를 추가로 확보합니다.",

      expectedBenefit:
        90,

      risk:
        5,

      cost:
        20,

      requiresMutation:
        false
    });
  }

  if (
    gaps.some(
      gap =>
        gap.type ===
        "EXISTING_BLOCKERS"
    )
  ) {
    actions.push({
      id:
        "ANALYZE_BLOCKERS",

      type:
        "REASON",

      description:
        "현재 blocker를 분석하고 우회 가능 여부를 판단합니다.",

      expectedBenefit:
        95,

      risk:
        5,

      cost:
        20,

      requiresMutation:
        false
    });
  }

  switch (
    goalAnalysis.intentType
  ) {
    case "VALIDATION":
      actions.push({
        id:
          "PLAN_VALIDATION",

        type:
          "PLAN",

        description:
          "검증 기준을 정의하고 증거 기반 검증 절차를 설계합니다.",

        expectedBenefit:
          85,

        risk:
          5,

        cost:
          15,

        requiresMutation:
          false
      });
      break;

    case "COLLECTION":
      actions.push({
        id:
          "PLAN_COLLECTION",

        type:
          "PLAN",

        description:
          "수집 대상, 출처, 중복 방지 및 검증 규칙을 설계합니다.",

        expectedBenefit:
          85,

        risk:
          10,

        cost:
          20,

        requiresMutation:
          false
      });
      break;

    case "ANALYSIS":
      actions.push({
        id:
          "ANALYZE_AVAILABLE_DATA",

        type:
          "ANALYZE",

        description:
          "현재 확보된 데이터를 분석하고 핵심 패턴을 찾습니다.",

        expectedBenefit:
          90,

        risk:
          5,

        cost:
          15,

        requiresMutation:
          false
      });
      break;

    case "MODIFICATION":
      actions.push({
        id:
          "PLAN_SAFE_MODIFICATION",

        type:
          "PLAN",

        description:
          "변경 전 영향 범위와 안전 조건을 판단합니다.",

        expectedBenefit:
          80,

        risk:
          40,

        cost:
          30,

        requiresMutation:
          true
      });
      break;

    case "DEPLOYMENT":
      actions.push({
        id:
          "PLAN_DEPLOYMENT",

        type:
          "PLAN",

        description:
          "배포 전 테스트, 롤백, 환경 상태를 판단합니다.",

        expectedBenefit:
          70,

        risk:
          70,

        cost:
          40,

        requiresMutation:
          true
      });
      break;

    default:
      actions.push({
        id:
          "DECOMPOSE_GOAL",

        type:
          "PLAN",

        description:
          "사용자 목표를 작은 단계로 분해하고 실행 순서를 결정합니다.",

        expectedBenefit:
          90,

        risk:
          5,

        cost:
          10,

        requiresMutation:
          false
      });
      break;
  }

  return actions;
}

/* ============================================================
 * SAFETY FILTER
 * ============================================================ */

function applySafetyFilter({
  actions,
  state
}) {
  const safety =
    state.safety
    ||
    {};

  return actions.map(
    action => {
      let blocked = false;

      const blockers = [];

      if (
        action.requiresMutation
        &&
        safety.allowFileWrite !== true
      ) {
        blocked = true;

        blockers.push(
          "FILE_WRITE_NOT_ALLOWED"
        );
      }

      return {
        ...action,

        blocked,

        blockers
      };
    }
  );
}

/* ============================================================
 * ACTION SCORING
 * ============================================================ */

function scoreAction(action) {
  if (
    action.blocked
  ) {
    return -100000;
  }

  const benefit =
    Number(
      action.expectedBenefit
      || 0
    );

  const risk =
    Number(
      action.risk
      || 0
    );

  const cost =
    Number(
      action.cost
      || 0
    );

  return (
    benefit
    -
    risk * 0.8
    -
    cost * 0.3
  );
}

/* ============================================================
 * DECISION
 * ============================================================ */

function chooseAction(actions) {
  if (
    !Array.isArray(
      actions
    )
    ||
    actions.length === 0
  ) {
    return null;
  }

  const ranked =
    actions
    .map(
      action => ({
        ...action,

        decisionScore:
          scoreAction(
            action
          )
      })
    )
    .sort(
      (a, b) =>
        b.decisionScore
        -
        a.decisionScore
    );

  return {
    selected:
      ranked[0],

    alternatives:
      ranked.slice(
        1
      )
  };
}

/* ============================================================
 * REASON GENERATOR
 * ============================================================ */

function explainDecision({
  goalAnalysis,
  gaps,
  decision
}) {
  if (
    !decision
    ||
    !decision.selected
  ) {
    return [
      "현재 선택 가능한 행동이 없습니다."
    ];
  }

  const reasons = [];

  reasons.push(
    `현재 목표 유형은 ${goalAnalysis.intentType}으로 판단했습니다.`
  );

  if (
    gaps.length > 0
  ) {
    reasons.push(
      `현재 목표와 상태 사이에 ${gaps.length}개의 정보/진행 차이가 있습니다.`
    );
  }

  reasons.push(
    `"${decision.selected.id}" 행동이 현재 후보 중 기대효과 대비 위험과 비용이 가장 낮아 우선 행동으로 선택되었습니다.`
  );

  if (
    decision.selected.requiresMutation
  ) {
    reasons.push(
      "이 행동은 실제 변경을 포함할 수 있으므로 Executor 단계에서 별도 안전 검증이 필요합니다."
    );
  }

  return reasons;
}

/* ============================================================
 * HISTORY
 * ============================================================ */

function appendHistory(entry) {
  const existing =
    readJson(
      HISTORY_FILE,
      {
        schemaVersion:
          "0.1",

        items:
          []
      }
    );

  const items =
    Array.isArray(
      existing.items
    )
      ? existing.items
      : [];

  items.push(
    entry
  );

  const limited =
    items.slice(
      -500
    );

  atomicWrite(
    HISTORY_FILE,
    {
      schemaVersion:
        "0.1",

      updatedAt:
        nowIso(),

      items:
        limited
    }
  );
}

/* ============================================================
 * THINK
 * ============================================================ */

function think() {
  const state =
    loadState();

  const goalMemory =
    loadGoal();

  const observation =
    observeEnvironment();

  const goalAnalysis =
    analyzeGoal(
      goalMemory
    );

  const gaps =
    analyzeGap({
      goalAnalysis,
      state,
      observation
    });

  const candidateActions =
    generateCandidateActions({
      goalAnalysis,
      gaps,
      state,
      observation
    });

  const safeActions =
    applySafetyFilter({
      actions:
        candidateActions,

      state
    });

  const decision =
    chooseAction(
      safeActions
    );

  const reasons =
    explainDecision({
      goalAnalysis,
      gaps,
      decision
    });

  const result = {
    schemaVersion:
      "0.1",

    generatedAt:
      nowIso(),

    brain:
      "AGENT_BRAIN",

    mode:
      state.agent
        ?.mode
      ||
      "THINK_ONLY",

    goal:
      goalMemory,

    goalAnalysis,

    observation,

    gaps,

    candidateActions:
      safeActions,

    decision,

    reasoningSummary:
      reasons,

    execution: {
      allowed:
        false,

      reason:
        "Agent Brain v0.1은 THINK_ONLY 단계이며 실제 작업 실행은 수행하지 않습니다."
    },

    safety:
      state.safety
  };

  atomicWrite(
    DECISION_FILE,
    result
  );

  appendHistory({
    generatedAt:
      result.generatedAt,

    goal:
      goalAnalysis.goalText,

    intentType:
      goalAnalysis.intentType,

    selectedAction:
      decision
        ?.selected
        ?.id
      ||
      null,

    decisionScore:
      decision
        ?.selected
        ?.decisionScore
      ??
      null,

    reasons
  });

  return result;
}

/* ============================================================
 * MAIN
 * ============================================================ */

function main() {
  ensureDirectory(
    MEMORY_DIR
  );

  const result =
    think();

  console.log(
    JSON.stringify(
      {
        status:
          "THINK_COMPLETE",

        mode:
          result.mode,

        hasGoal:
          result.goalAnalysis
            .hasGoal,

        intentType:
          result.goalAnalysis
            .intentType,

        gapCount:
          result.gaps.length,

        candidateCount:
          result
            .candidateActions
            .length,

        selectedAction:
          result.decision
            ?.selected
            ?.id
          ||
          null,

        decisionScore:
          result.decision
            ?.selected
            ?.decisionScore
          ??
          null,

        reasoningSummary:
          result.reasoningSummary,

        executionAllowed:
          result.execution
            .allowed,

        decisionFile:
          DECISION_FILE
      },
      null,
      2
    )
  );
}

/* ============================================================
 * EXECUTE
 * ============================================================ */

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
            "BRAIN_FATAL",

          error: {
            name:
              error.name,

            message:
              error.message,

            stack:
              error.stack
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

/* ============================================================
 * EXPORT
 * ============================================================ */

module.exports = {
  loadState,
  loadGoal,
  observeEnvironment,
  analyzeGoal,
  analyzeGap,
  generateCandidateActions,
  applySafetyFilter,
  scoreAction,
  chooseAction,
  explainDecision,
  think
};