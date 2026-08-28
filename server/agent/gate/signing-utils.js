"use strict";

/**
 * Gate 서명 유틸리티 (HMAC-SHA256 서명/검증)
 *
 * .pipeline/spec.md 설계안 7번("권한 경계") 참고. sign 계열 함수는 서명 키를
 * 보유한 컨텍스트(Brain 전용, review-decision-writer.js)에서만 호출되어야
 * 하고, verify 계열 함수는 apply-source-activation.js(--apply 검증)가
 * 사용합니다.
 *
 * 키 값은 이 파일 어디에도 하드코딩하지 않습니다. 항상 호출자가 전달한
 * signingKey(예: 환경변수 UNIPICK_GATE_SIGNING_KEY 에서 읽은 값)만 사용합니다.
 *
 * 서명 대상 필드(설계안 7-3): reviewId + packetSha256Recomputed + verdict +
 * reasons + checkedItems 만 서명하고, packetPathRead/reviewedAt 같은 감사용
 * 메타데이터는 서명 대상에서 제외합니다.
 */

const crypto = require("crypto");
const { canonicalStringify, sha256Hex } = require("./checksum-utils");

// spec.md 설계안 7-2 에서 "BRAIN_REVIEW_SIGNING_KEY"(환경변수 주입)와
// "OS 파일 권한 분리 디렉터리" 두 가지 운영 방식 중 어느 쪽을 쓸지는
// "다음 Coder 단계에서 확정"하도록 명시적으로 열어둔 상태였습니다. 이번
// 라운드의 상위 지시(작업 프롬프트)에서 "spec.md에 이미 확정된 이름이
// 없다면 UNIPICK_GATE_SIGNING_KEY로 하라"고 명시했으므로 이 이름을
// 사용합니다(.pipeline/changes.md 의 "임의로 결정해야 했던 부분" 참고).
const SIGNING_KEY_ENV_VAR = "UNIPICK_GATE_SIGNING_KEY";

/**
 * ReviewDecision 객체에서 서명 대상 필드만 뽑아냅니다(설계안 7-3).
 * decision 이 그 외 필드(packetPathRead/reviewedAt/signature 등)를 더 갖고
 * 있어도 이 함수의 반환값에는 포함되지 않습니다.
 */
function getSignedFieldsPayload(decision) {
  const { reviewId, packetSha256Recomputed, verdict, reasons, checkedItems } = decision || {};
  return { reviewId, packetSha256Recomputed, verdict, reasons, checkedItems };
}

/**
 * 서명 대상 필드를 canonical 직렬화한 뒤 HMAC-SHA256 서명값(hex)을 계산합니다.
 * signingKey 가 없으면 명확히 예외를 던집니다(호출자가 SIGNING_KEY_UNAVAILABLE
 * 로 분류해 처리해야 함).
 */
function signDecision(signingKey, decision) {
  if (!signingKey) throw new Error("signDecision: signingKey is required.");
  const canonical = canonicalStringify(getSignedFieldsPayload(decision));
  return crypto.createHmac("sha256", signingKey).update(canonical, "utf8").digest("hex");
}

/**
 * 서명값을 재계산해 저장된 값과 비교합니다. signingKey/signatureValue 가
 * 없거나, 길이가 다르거나, 값이 다르면 예외 없이 false 를 반환합니다
 * (--apply 쪽에서 SIGNATURE_MISSING/SIGNATURE_INVALID 로 분류하기 쉽도록).
 */
function verifyDecisionSignature(signingKey, decision, signatureValue) {
  if (!signingKey || !signatureValue) return false;
  let expectedBuf;
  let actualBuf;
  try {
    expectedBuf = Buffer.from(signDecision(signingKey, decision), "hex");
    actualBuf = Buffer.from(String(signatureValue), "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length === 0 || expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * 서명 키 자체가 아니라, 키 로테이션 감사를 위한 짧은 지문(fingerprint)을
 * 반환합니다. ReviewDecision.signature.keyId 에 저장되는 값이며, 이 값만으로
 * 원래 키를 복원할 수 없습니다.
 */
function signingKeyId(signingKey) {
  return sha256Hex(String(signingKey)).slice(0, 16);
}

/**
 * 환경변수에서 서명 키를 읽습니다. 값이 없거나 공백뿐이면 null 을 반환합니다
 * (예외를 던지지 않음 -- 호출자가 SIGNING_KEY_UNAVAILABLE 로 처리).
 */
function loadSigningKeyFromEnv(env = process.env) {
  const value = env ? env[SIGNING_KEY_ENV_VAR] : undefined;
  return value && String(value).trim() ? String(value) : null;
}

module.exports = {
  SIGNING_KEY_ENV_VAR,
  getSignedFieldsPayload,
  signDecision,
  verifyDecisionSignature,
  signingKeyId,
  loadSigningKeyFromEnv,
};
