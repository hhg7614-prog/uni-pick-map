"use strict";

/**
 * ReviewDecision(판정 파일) 작성기 -- Brain 전용.
 *
 * *** 중요 ***
 * 이 파일은 어떤 `npm run` 스크립트나 다른 온보딩/에이전트 도구에서도
 * require() 되거나 호출되어서는 안 됩니다(.pipeline/spec.md 설계안
 * 7-1-1 "액션 화이트리스트 경계" 결정 사항). Code Agent 세션이 접근하는
 * 실행 경로(package.json 의 어떤 스크립트, server/agent/tools/**,
 * server/agent/onboarding/tools/** 등)에는 이 모듈을 절대 연결하지
 * 않습니다. Brain 이 자신의 로컬 실행 컨텍스트(서명 키를 보유한 별도
 * 프로세스/세션)에서만 이 모듈을 호출해 판정 파일을 작성합니다.
 *
 * server/agent/gate/apply-source-activation.js 는 이 파일을 require() 하지
 * 않습니다(의도적 설계 -- 두 파일 사이에 어떤 코드 경로도 연결하지 않기
 * 위해, reviewedBy 블록리스트 등 공용처럼 보이는 상수도 각 파일에
 * 독립적으로 정의합니다. 아래 BLOCKED_REVIEWER_NAMES 참고).
 */

const fs = require("fs");
const path = require("path");
const { computePacketSha256 } = require("./review-packet");
const { signDecision, signingKeyId, SIGNING_KEY_ENV_VAR } = require("./signing-utils");

const SCHEMA_VERSION = "1.0";
const DEFAULT_DATA_DIR = path.join(__dirname, "data");

// "실수로 같은 세션이 판정까지 흉내 낸" 경우를 잡는 최소 방어(설계안
// 7-1-3, 약한 방어/감사용 -- 의도적 우회까지 막지는 못함).
const BLOCKED_REVIEWER_NAMES = ["code-agent", "planner", "coder", "tester", "reviewer"];

function normalizeReviewerName(value) {
  return String(value || "").trim().toLowerCase();
}

function assertReviewerNotBlocked(reviewedBy) {
  if (BLOCKED_REVIEWER_NAMES.includes(normalizeReviewerName(reviewedBy))) {
    throw new Error(`writeReviewDecision: reviewedBy ("${reviewedBy}") is in the blocked reviewer list and cannot record a review decision.`);
  }
}

// (결정됨, spec.md 질문사항 2) robotsPolicyViolation/jsRuleUnverified/
// diagnoseFailed 중 하나라도 true 이면 verdict==="APPROVE" 는 구조적으로
// 불가능하다 -- 이 함수는 Brain 이 이미 작성한 checkedItems 의 "내부
// 일관성"만 확인하는 것이며, 위반 여부 자체를 계산하지 않는다.
function assertDecisionConsistency(verdict, checkedItems) {
  const violation = Boolean(
    checkedItems && (checkedItems.robotsPolicyViolation || checkedItems.jsRuleUnverified || checkedItems.diagnoseFailed)
  );
  if (violation && verdict === "APPROVE") {
    throw new Error(
      "writeReviewDecision: checkedItems reports a violation (robotsPolicyViolation/jsRuleUnverified/diagnoseFailed) " +
      "but verdict is APPROVE. A violation always forces HOLD or REJECT (spec.md 설계안 2번)."
    );
  }
}

function decisionPath(reviewId, dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, "review-decisions", `${reviewId}.json`);
}

function packetPath(reviewId, dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, "review-packets", `${reviewId}.json`);
}

/**
 * Brain 이 패킷을 검토한 뒤 서명된 ReviewDecision 파일을 작성합니다
 * (설계안 3번 "brainReview(reviewId) -> decision" pseudocode 구현).
 *
 * 필수 입력: reviewId, verdict("APPROVE"|"HOLD"|"REJECT"), reasons(비어
 * 있지 않은 배열), checkedItems({robotsPolicyViolation, jsRuleUnverified,
 * diagnoseFailed}), reviewedBy(블록리스트에 없어야 함), signingKey.
 */
function writeReviewDecision(input = {}) {
  const {
    reviewId,
    dataDir = DEFAULT_DATA_DIR,
    packetPathOverride,
    verdict,
    reasons,
    checkedItems,
    reviewedBy,
    signingKey,
    keyId,
    now = new Date(),
    readFileImpl = fs.readFileSync,
    existsImpl = fs.existsSync,
    mkdirImpl = fs.mkdirSync,
    writeFileImpl = fs.writeFileSync,
  } = input;

  if (!reviewId) throw new Error("writeReviewDecision: reviewId is required.");
  if (!verdict || !["APPROVE", "HOLD", "REJECT"].includes(verdict)) {
    throw new Error(`writeReviewDecision: verdict must be one of APPROVE/HOLD/REJECT (got: ${verdict}).`);
  }
  if (!Array.isArray(reasons) || reasons.length < 1) {
    throw new Error("writeReviewDecision: reasons must be a non-empty array (at least 1 reason is required).");
  }
  if (!checkedItems || typeof checkedItems !== "object") {
    throw new Error("writeReviewDecision: checkedItems is required.");
  }
  assertReviewerNotBlocked(reviewedBy);
  assertDecisionConsistency(verdict, checkedItems);
  if (!signingKey) {
    throw new Error(`writeReviewDecision: signingKey is required (see env var ${SIGNING_KEY_ENV_VAR}, loaded by the Brain-only execution context).`);
  }

  const resolvedPacketPath = packetPathOverride || packetPath(reviewId, dataDir);
  const packet = JSON.parse(readFileImpl(resolvedPacketPath, "utf8"));
  if (packet.reviewId !== reviewId) {
    throw new Error(`writeReviewDecision: packet.reviewId ("${packet.reviewId}") at "${resolvedPacketPath}" does not match requested reviewId ("${reviewId}").`);
  }
  // Brain 이 패킷 파일을 직접 읽어 독립적으로 재계산 -- packet.packetSha256
  // 을 그대로 베끼지 않는다(설계안 2번 스키마 주석 그대로).
  const packetSha256Recomputed = computePacketSha256(packet);
  if (packetSha256Recomputed !== packet.packetSha256) {
    throw new Error(
      `writeReviewDecision: packetSha256 recomputed from "${resolvedPacketPath}" does not match packet.packetSha256 -- ` +
      "the packet file may be corrupted or tampered with. Refusing to record a decision against it " +
      "(spec.md 예외 상황: \"Brain 이 패킷 파일을 읽었는데 packetSha256 자체 검증이 실패\")."
    );
  }

  const signedFields = { reviewId, packetSha256Recomputed, verdict, reasons, checkedItems };
  const signatureValue = signDecision(signingKey, signedFields);

  const decision = {
    schemaVersion: SCHEMA_VERSION,
    reviewId,
    reviewedAt: now.toISOString(),
    reviewedBy,
    packetPathRead: resolvedPacketPath,
    packetSha256Recomputed,
    verdict,
    reasons,
    checkedItems,
    signature: { alg: "HMAC-SHA256", keyId: keyId || signingKeyId(signingKey), value: signatureValue },
  };

  const targetPath = decisionPath(reviewId, dataDir);
  if (existsImpl(targetPath)) {
    throw new Error(`Refusing to overwrite an existing review decision: ${targetPath} (append-only -- re-review with a new reviewId instead).`);
  }
  mkdirImpl(path.dirname(targetPath), { recursive: true });
  writeFileImpl(targetPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
  return { decision, writtenPath: targetPath };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_DATA_DIR,
  BLOCKED_REVIEWER_NAMES,
  normalizeReviewerName,
  assertReviewerNotBlocked,
  assertDecisionConsistency,
  decisionPath,
  packetPath,
  writeReviewDecision,
};
