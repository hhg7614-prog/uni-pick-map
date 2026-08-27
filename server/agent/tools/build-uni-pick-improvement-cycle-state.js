"use strict";

/**
 * UNI PICK Improvement Cycle State v1
 *
 * 지금까지 생성된 상태/이슈/계획/파일럿/TLS 진단 결과를 읽어
 * 현재 개선 사이클의 "최신 판단"과 "다음 행동"을 하나로 통합한다.
 *
 * 읽기 전용.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const DATA = path.join(ROOT, "server", "agent", "data");

const FILES = {
  projectState: path.join(DATA, "uni-pick-project-state.json"),
  issues: path.join(DATA, "uni-pick-issues.json"),
  plan: path.join(DATA, "uni-pick-improvement-plan.json"),
  pilot: path.join(DATA, "uni-pick-safe-pilot-result.json"),
  network: path.join(DATA, "uni-pick-network-subtypes.json"),
  tls: path.join(DATA, "uni-pick-tls-environment-diagnostic.json")
};

const OUT = path.join(
  DATA,
  "uni-pick-improvement-cycle-state.json"
);

function read(file, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function atomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(tmp, "utf8")
  );

  fs.renameSync(tmp, file);
}

function main() {
  const project = read(FILES.projectState, {});
  const issues = read(FILES.issues, {});
  const plan = read(FILES.plan, {});
  const pilot = read(FILES.pilot, {});
  const network = read(FILES.network, {});
  const tls = read(FILES.tls, {});

  const actions = [];

  // 1. Node CA compatibility
  if (
    Number(tls.nodeCaCompatibility || 0) > 0
  ) {
    actions.push({
      priority: 1,
      code: "NODE_CA_COMPATIBILITY",
      status: "OPEN",
      targetCount: Number(tls.nodeCaCompatibility || 0),
      autoFixAllowed: false,
      requiresHumanReview: true,
      recommendedAction:
        "Node/OpenSSL이 Windows에서 정상 신뢰되는 인증서 체인을 검증하지 못하는 원인을 해결한다. TLS 검증 비활성화는 금지한다.",
      successCriteria: [
        "NODE_TLS_REJECT_UNAUTHORIZED 우회 없이 정상 접속",
        "Windows/curl과 Node 검증 결과 일치",
        "기존 TLS_CHAIN_ERROR 대상 재진단 성공"
      ]
    });
  }

  // 2. Hostname mismatch
  if (
    Number(tls.hostnameMismatch || 0) > 0
  ) {
    actions.push({
      priority: 2,
      code: "CANONICAL_HOSTNAME_FIX",
      status: "OPEN",
      targetCount: Number(tls.hostnameMismatch || 0),
      autoFixAllowed: false,
      requiresHumanReview: true,
      recommendedAction:
        "TLS SAN과 일치하는 공식 canonical hostname을 확인하고 공식 URL 후보를 갱신한다.",
      successCriteria: [
        "TLS_HOSTNAME_MISMATCH 0",
        "공식 대학 도메인 확인",
        "리다이렉트 및 공지 탐색 정상"
      ]
    });
  }

  // 3. Redirect loop
  const redirectGroup =
    (network.groups || []).find(
      g => g.subtype === "REDIRECT_LOOP"
    );

  if (redirectGroup) {
    actions.push({
      priority: 3,
      code: "REDIRECT_CANONICAL_URL_RECHECK",
      status: "OPEN",
      targetCount: redirectGroup.count,
      universityIds: redirectGroup.universityIds,
      autoFixAllowed: false,
      requiresHumanReview: true,
      recommendedAction:
        "redirect loop가 발생하는 공식 홈페이지의 canonical URL 또는 HTTPS/호스트 변형을 확인한다.",
      successCriteria: [
        "redirect loop 제거",
        "HTTP 정상 응답",
        "공식 도메인 유지"
      ]
    });
  }

  // 4. Recovered but no candidate
  const reachableGroup =
    (network.groups || []).find(
      g => g.subtype === "HTTP_REACHABLE"
    );

  if (reachableGroup) {
    actions.push({
      priority: 4,
      code: "DISCOVERY_DIAGNOSIS",
      status: "OPEN",
      targetCount: reachableGroup.count,
      universityIds: reachableGroup.universityIds,
      autoFixAllowed: false,
      requiresHumanReview: false,
      recommendedAction:
        "네트워크 문제에서 복구된 대학은 NETWORK_FETCH에서 제외하고 공지 후보 탐색 단계로 이동한다.",
      successCriteria: [
        "NETWORK_FETCH 분류 제거",
        "NO_CANDIDATE 또는 후보 발견으로 재분류",
        "중복 source 생성 없음"
      ]
    });
  }

  // 5. Bulk retry block
  actions.push({
    priority: 5,
    code: "BULK_NETWORK_RETRY_GUARD",
    status: "ACTIVE",
    autoFixAllowed: false,
    requiresHumanReview: false,
    recommendedAction:
      "현재 NETWORK_FETCH 전체 일괄 재시도는 차단한다.",
    reason:
      `Safe Pilot networkRecoveryRate=${pilot.networkRecoveryRate ?? null}%`,
    successCriteria: [
      "원인별 복구 전략 수립 전 bulk retry 실행 안 함"
    ]
  });

  actions.sort((a, b) => a.priority - b.priority);

  const cycle = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),

    projectStatus:
      project.overallStatus || "UNKNOWN",

    currentIssue:
      "SOURCE_VALIDATION_ERRORS",

    originalStrategy:
      plan.plan?.strategy || "CLASSIFY_THEN_PILOT",

    latestDecision:
      tls.overallDecision || network.decision || pilot.expansionDecision,

    decisionHistory: [
      {
        stage: "PROJECT_STATE",
        result: project.overallStatus || null
      },
      {
        stage: "IMPROVEMENT_PLAN",
        result: plan.plan?.strategy || null
      },
      {
        stage: "SAFE_PILOT",
        result: pilot.expansionDecision || null
      },
      {
        stage: "NETWORK_SUBTYPE",
        result: network.decision || null
      },
      {
        stage: "TLS_ENVIRONMENT",
        result: tls.overallDecision || null
      }
    ],

    evidence: {
      sourceErrors:
        project.sourceValidation?.error ?? null,

      pilotProcessed:
        pilot.processed ?? null,

      pilotNetworkRecoveryRate:
        pilot.networkRecoveryRate ?? null,

      tlsNodeCaCompatibility:
        tls.nodeCaCompatibility ?? null,

      tlsHostnameMismatch:
        tls.hostnameMismatch ?? null,

      networkGroups:
        network.groups || []
    },

    revisedStrategy: {
      name:
        "CAUSE_SPECIFIC_RECOVERY",

      summary:
        "NETWORK_FETCH를 하나의 오류로 처리하지 않고 Node CA, hostname, redirect, discovery 문제로 분리해 각각 다른 복구 전략을 적용한다.",

      bulkRetryAllowed:
        false,

      tlsBypassAllowed:
        false
    },

    nextActions: actions,

    autonomousState: {
      observed:
        true,

      prioritized:
        true,

      planned:
        true,

      safePilotExecuted:
        true,

      evaluated:
        true,

      strategyRevised:
        true,

      automaticProductionMutation:
        false
    },

    safety: {
      readOnly:
        true,

      tlsVerificationDisabled:
        false,

      bulkRetryBlocked:
        true,

      deploymentTriggered:
        false
    }
  };

  atomic(OUT, cycle);

  console.log(
    JSON.stringify(cycle, null, 2)
  );
}

if (require.main === module) {
  main();
}