"use strict";

// 참고: spec.md "9) 단위 테스트 계획" 은 review-decision-writer.js 전용
// 테스트 파일을 명시적으로 요구하지 않았지만(Brain 전용 모듈이라 Code Agent
// 실행 경로에 연결되지 않음), 이 프로젝트의 관례(모든 모듈에 짝이 되는
// *.test.js)를 따라 핵심 유효성 검사(구조적 일관성 규칙/append-only/서명
// 필드 구성)만 최소한으로 검증합니다. 이 테스트는 이 모듈을 어떤 npm run
// 스크립트에도 연결하지 않으며, node --test 로 직접 실행될 때만 동작합니다.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildReviewPacket, writeReviewPacketOnce } = require("./review-packet");
const { verifyDecisionSignature } = require("./signing-utils");
const {
  BLOCKED_REVIEWER_NAMES,
  normalizeReviewerName,
  assertReviewerNotBlocked,
  assertDecisionConsistency,
  writeReviewDecision,
} = require("./review-decision-writer");

// 테스트 전용 더미 키 -- 실제 서명 키가 아니며, 실제 운영 환경에서는
// 사용하지 않습니다.
const TEST_DUMMY_SIGNING_KEY = "test-only-dummy-signing-key-do-not-use-in-production";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFixturePacket(dataDir) {
  const filesDir = makeTempDir("review-decision-writer-files-");
  const sourceCatalogFile = path.join(filesDir, "catalog.json");
  const storeFile = path.join(filesDir, "store.json");
  const previewFile = path.join(filesDir, "preview.json");
  fs.writeFileSync(sourceCatalogFile, JSON.stringify({ universities: [] }), "utf8");
  fs.writeFileSync(storeFile, JSON.stringify({ items: [] }), "utf8");
  fs.writeFileSync(previewFile, JSON.stringify({ items: [] }), "utf8");

  const packet = buildReviewPacket({
    universityId: "test-university",
    sourceId: "test-official-news",
    sourceSnapshot: { id: "test-official-news", enabled: false, verified: true, status: "selector_required" },
    diagnostics: {
      command: "node server/agent/tools/run-single-school-trial.js --diagnose",
      rawOutput: { ok: true },
      foundCount: 3, acceptedCount: 3, newCount: 3, duplicateCount: 0, excludedCount: 0,
      acceptedNewItemsForSave: [{ title: "a" }],
    },
    robotsEvidence: { checked: true, unavailable: false, policy: { blocked: false } },
    regressionEvidence: { npmTestCommand: "npm test", npmTestSummary: "tests 10, pass 10, fail 0", ranAt: "2026-08-27T00:00:00.000Z" },
    paths: { sourceCatalogFile, storeFile, previewFile },
    now: new Date("2026-08-27T14:30:00.000Z"),
    randomBytesImpl: () => Buffer.from("a1b2c3", "hex"),
  });
  writeReviewPacketOnce(packet, { dataDir });
  return packet;
}

test("assertReviewerNotBlocked throws for every name in BLOCKED_REVIEWER_NAMES (case-insensitive)", () => {
  for (const name of BLOCKED_REVIEWER_NAMES) {
    assert.throws(() => assertReviewerNotBlocked(name.toUpperCase()), /blocked reviewer list/);
  }
  assert.doesNotThrow(() => assertReviewerNotBlocked("brain-local-session"));
});

test("normalizeReviewerName trims and lowercases", () => {
  assert.equal(normalizeReviewerName("  Code-Agent  "), "code-agent");
});

test("assertDecisionConsistency: a violation flag forces HOLD/REJECT, never APPROVE", () => {
  assert.throws(
    () => assertDecisionConsistency("APPROVE", { robotsPolicyViolation: true, jsRuleUnverified: false, diagnoseFailed: false }),
    /forces HOLD or REJECT/
  );
  assert.doesNotThrow(() => assertDecisionConsistency("HOLD", { robotsPolicyViolation: true, jsRuleUnverified: false, diagnoseFailed: false }));
  assert.doesNotThrow(() => assertDecisionConsistency("APPROVE", { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false }));
});

test("writeReviewDecision writes a signed decision that verifies against the same signing key", () => {
  const dataDir = makeTempDir("review-decision-writer-data-");
  const packet = makeFixturePacket(dataDir);

  const { decision, writtenPath } = writeReviewDecision({
    reviewId: packet.reviewId,
    dataDir,
    verdict: "APPROVE",
    reasons: ["robots.txt allows access", "engine regression passed"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    reviewedBy: "brain-local-session",
    signingKey: TEST_DUMMY_SIGNING_KEY,
    now: new Date("2026-08-27T15:00:00.000Z"),
  });

  assert.equal(decision.reviewId, packet.reviewId);
  assert.equal(decision.verdict, "APPROVE");
  assert.ok(fs.existsSync(writtenPath));
  const readBack = JSON.parse(fs.readFileSync(writtenPath, "utf8"));
  assert.equal(
    verifyDecisionSignature(
      TEST_DUMMY_SIGNING_KEY,
      { reviewId: readBack.reviewId, packetSha256Recomputed: readBack.packetSha256Recomputed, verdict: readBack.verdict, reasons: readBack.reasons, checkedItems: readBack.checkedItems },
      readBack.signature.value
    ),
    true
  );
});

test("writeReviewDecision refuses to record APPROVE when checkedItems reports a violation", () => {
  const dataDir = makeTempDir("review-decision-writer-data-");
  const packet = makeFixturePacket(dataDir);
  assert.throws(
    () =>
      writeReviewDecision({
        reviewId: packet.reviewId,
        dataDir,
        verdict: "APPROVE",
        reasons: ["should be rejected"],
        checkedItems: { robotsPolicyViolation: true, jsRuleUnverified: false, diagnoseFailed: false },
        reviewedBy: "brain-local-session",
        signingKey: TEST_DUMMY_SIGNING_KEY,
      }),
    /forces HOLD or REJECT/
  );
});

test("writeReviewDecision refuses a blocked reviewedBy value", () => {
  const dataDir = makeTempDir("review-decision-writer-data-");
  const packet = makeFixturePacket(dataDir);
  assert.throws(
    () =>
      writeReviewDecision({
        reviewId: packet.reviewId,
        dataDir,
        verdict: "APPROVE",
        reasons: ["ok"],
        checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
        reviewedBy: "code-agent",
        signingKey: TEST_DUMMY_SIGNING_KEY,
      }),
    /blocked reviewer list/
  );
});

test("writeReviewDecision refuses to overwrite an existing decision file (append-only)", () => {
  const dataDir = makeTempDir("review-decision-writer-data-");
  const packet = makeFixturePacket(dataDir);
  const params = {
    reviewId: packet.reviewId,
    dataDir,
    verdict: "APPROVE",
    reasons: ["ok"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    reviewedBy: "brain-local-session",
    signingKey: TEST_DUMMY_SIGNING_KEY,
  };
  writeReviewDecision(params);
  assert.throws(() => writeReviewDecision(params), /append-only|overwrite/i);
});

test("writeReviewDecision requires a signingKey", () => {
  const dataDir = makeTempDir("review-decision-writer-data-");
  const packet = makeFixturePacket(dataDir);
  assert.throws(
    () =>
      writeReviewDecision({
        reviewId: packet.reviewId,
        dataDir,
        verdict: "APPROVE",
        reasons: ["ok"],
        checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
        reviewedBy: "brain-local-session",
        signingKey: undefined,
      }),
    /signingKey/
  );
});
