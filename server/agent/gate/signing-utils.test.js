"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SIGNING_KEY_ENV_VAR,
  signDecision,
  verifyDecisionSignature,
  signingKeyId,
  loadSigningKeyFromEnv,
} = require("./signing-utils");

// 테스트 전용 더미 키입니다 -- 실제 서명 키가 아니며, 실제 운영 환경에서는
// 절대 사용하지 않습니다. Brain 전용 실행 컨텍스트가 아닌 이 테스트 파일에
// 실제 UNIPICK_GATE_SIGNING_KEY 값을 넣는 것은 이 게이트 설계의 권한 경계를
// 스스로 무너뜨리는 것이므로 금지됩니다(.pipeline/spec.md 설계안 7번 참고).
const TEST_DUMMY_SIGNING_KEY = "test-only-dummy-signing-key-do-not-use-in-production";
const TEST_DUMMY_SIGNING_KEY_B = "another-test-only-dummy-signing-key";

function sampleDecisionCore(overrides = {}) {
  return {
    reviewId: "rp-test-university-test-official-news-20260827143000-a1b2c3",
    packetSha256Recomputed: "d".repeat(64),
    verdict: "APPROVE",
    reasons: ["engine unit tests passed", "manual GET verification recorded"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    ...overrides,
  };
}

test("signDecision is deterministic: same signed fields + same key -> same signature", () => {
  const core = sampleDecisionCore();
  const first = signDecision(TEST_DUMMY_SIGNING_KEY, core);
  const second = signDecision(TEST_DUMMY_SIGNING_KEY, core);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("signDecision changes when reviewId changes", () => {
  const base = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore());
  const changed = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore({ reviewId: "rp-other-university-other-source-20260827143000-a1b2c3" }));
  assert.notEqual(base, changed);
});

test("signDecision changes when packetSha256Recomputed changes", () => {
  const base = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore());
  const changed = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore({ packetSha256Recomputed: "e".repeat(64) }));
  assert.notEqual(base, changed);
});

test("signDecision changes when verdict changes", () => {
  const base = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore());
  const changed = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore({ verdict: "HOLD" }));
  assert.notEqual(base, changed);
});

test("signDecision changes when reasons changes", () => {
  const base = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore());
  const changed = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore({ reasons: ["a different reason"] }));
  assert.notEqual(base, changed);
});

test("signDecision changes when checkedItems changes", () => {
  const base = signDecision(TEST_DUMMY_SIGNING_KEY, sampleDecisionCore());
  const changed = signDecision(
    TEST_DUMMY_SIGNING_KEY,
    sampleDecisionCore({ checkedItems: { robotsPolicyViolation: true, jsRuleUnverified: false, diagnoseFailed: false } })
  );
  assert.notEqual(base, changed);
});

test("verifyDecisionSignature succeeds with the correct key and content", () => {
  const core = sampleDecisionCore();
  const signature = signDecision(TEST_DUMMY_SIGNING_KEY, core);
  assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, core, signature), true);
});

test("verifyDecisionSignature fails when verified with a different key", () => {
  const core = sampleDecisionCore();
  const signature = signDecision(TEST_DUMMY_SIGNING_KEY, core);
  assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY_B, core, signature), false);
});

test("verifyDecisionSignature fails when the signature value itself is tampered", () => {
  const core = sampleDecisionCore();
  const signature = signDecision(TEST_DUMMY_SIGNING_KEY, core);
  const flippedLastByte = signature.slice(0, -2) + (signature.slice(-2) === "00" ? "11" : "00");
  assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, core, flippedLastByte), false);
});

test("verifyDecisionSignature fails when any signed field is edited after signing (canonical serialization changes)", () => {
  const core = sampleDecisionCore();
  const signature = signDecision(TEST_DUMMY_SIGNING_KEY, core);
  const editedVerdict = { ...core, verdict: "HOLD" };
  const editedReasons = { ...core, reasons: [...core.reasons, "an added reason"] };
  const editedCheckedItems = { ...core, checkedItems: { ...core.checkedItems, diagnoseFailed: true } };
  assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, editedVerdict, signature), false);
  assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, editedReasons, signature), false);
  assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, editedCheckedItems, signature), false);
});

test("verifyDecisionSignature returns false (never throws) when the key or signature is missing", () => {
  const core = sampleDecisionCore();
  assert.doesNotThrow(() => {
    assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, core, undefined), false);
    assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, core, ""), false);
    assert.equal(verifyDecisionSignature("", core, "deadbeef"), false);
    assert.equal(verifyDecisionSignature(null, core, "deadbeef"), false);
  });
});

test("verifyDecisionSignature returns false (never throws) for a malformed/non-hex signature value", () => {
  const core = sampleDecisionCore();
  assert.doesNotThrow(() => {
    assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, core, "not-a-hex-signature-value"), false);
  });
});

test("signDecision throws clearly when signingKey is missing (caller must treat as SIGNING_KEY_UNAVAILABLE)", () => {
  assert.throws(() => signDecision(undefined, sampleDecisionCore()), /signingKey/i);
  assert.throws(() => signDecision("", sampleDecisionCore()), /signingKey/i);
});

test("signingKeyId never returns the raw key itself, only a short hex fingerprint", () => {
  const keyId = signingKeyId(TEST_DUMMY_SIGNING_KEY);
  assert.notEqual(keyId, TEST_DUMMY_SIGNING_KEY);
  assert.match(keyId, /^[0-9a-f]{16}$/);
  // 결정론적: 같은 키는 항상 같은 keyId(키 로테이션 감사용 지문)를 만든다.
  assert.equal(keyId, signingKeyId(TEST_DUMMY_SIGNING_KEY));
});

test("loadSigningKeyFromEnv reads the configured env var and returns null when unset/blank", () => {
  assert.equal(loadSigningKeyFromEnv({ [SIGNING_KEY_ENV_VAR]: TEST_DUMMY_SIGNING_KEY }), TEST_DUMMY_SIGNING_KEY);
  assert.equal(loadSigningKeyFromEnv({}), null);
  assert.equal(loadSigningKeyFromEnv({ [SIGNING_KEY_ENV_VAR]: "   " }), null);
  assert.equal(loadSigningKeyFromEnv({ [SIGNING_KEY_ENV_VAR]: "" }), null);
});
