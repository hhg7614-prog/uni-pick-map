"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildReviewPacket, computePacketSha256, writeReviewPacketOnce, generateReviewId } = require("./review-packet");

// 고정 시각/난수 -- flaky 테스트 방지(.pipeline/spec.md "6. 현재 테스트/검증
// 방식" 에 기록된 직전 라운드의 실제 flaky 선례를 반영).
const FIXED_NOW = new Date("2026-08-27T14:30:00.000Z");
const FIXED_RANDOM_BYTES = () => Buffer.from("a1b2c3", "hex");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFixturePaths(dir) {
  const sourceCatalogFile = path.join(dir, "catalog.json");
  const storeFile = path.join(dir, "store.json");
  const previewFile = path.join(dir, "preview.json");
  fs.writeFileSync(sourceCatalogFile, JSON.stringify({ universities: [] }), "utf8");
  fs.writeFileSync(storeFile, JSON.stringify({ items: [] }), "utf8");
  fs.writeFileSync(previewFile, JSON.stringify({ items: [] }), "utf8");
  return { sourceCatalogFile, storeFile, previewFile };
}

function baseInput(dir) {
  return {
    universityId: "test-university",
    universityGroupId: "test-university-group",
    sourceId: "test-official-news",
    sourceSnapshot: { id: "test-official-news", enabled: false, verified: true, status: "selector_required", listUrl: "https://news.example.ac.kr/list" },
    diagnostics: {
      command: "node server/agent/tools/run-single-school-trial.js --university-id=test-university --source-id=test-official-news --diagnose --limit=3",
      rawOutput: { diagnostics: [{ title: "a", detailValidation: "passed_attempt_1", storable: true }] },
      foundCount: 3,
      acceptedCount: 3,
      newCount: 3,
      duplicateCount: 0,
      excludedCount: 0,
      acceptedNewItemsForSave: [{ title: "a", sourceUrl: "https://news.example.ac.kr/1", publishedAt: "2026-08-20" }],
    },
    robotsEvidence: { checked: true, unavailable: false, policy: { blocked: false } },
    regressionEvidence: { npmTestCommand: "npm test", npmTestSummary: "tests 42, pass 42, fail 0", ranAt: "2026-08-27T00:00:00.000Z" },
    paths: makeFixturePaths(dir),
    now: FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  };
}

test("buildReviewPacket rejects when a required top-level field is missing", () => {
  const dir = makeTempDir("review-packet-test-");
  const input = baseInput(dir);
  delete input.robotsEvidence;
  assert.throws(() => buildReviewPacket(input), /robotsEvidence/);
});

test("buildReviewPacket rejects when a required diagnostics.* field is missing", () => {
  const dir = makeTempDir("review-packet-test-");
  const input = baseInput(dir);
  delete input.diagnostics.foundCount;
  assert.throws(() => buildReviewPacket(input), /diagnostics\.foundCount/);
});

test("buildReviewPacket rejects when regressionEvidence is not fail 0", () => {
  const dir = makeTempDir("review-packet-test-");
  const input = baseInput(dir);
  input.regressionEvidence = { ...input.regressionEvidence, npmTestSummary: "tests 42, pass 41, fail 1" };
  assert.throws(() => buildReviewPacket(input), /fail 1|not.*fail 0|regression/i);
});

test("buildReviewPacket rejects when regressionEvidence.npmTestSummary has no parseable fail count", () => {
  const dir = makeTempDir("review-packet-test-");
  const input = baseInput(dir);
  input.regressionEvidence = { ...input.regressionEvidence, npmTestSummary: "unexpected format" };
  assert.throws(() => buildReviewPacket(input), /npmTestSummary/);
});

test("built packet contains only raw evidence -- no robotsPolicyViolation/jsRuleUnverified/diagnoseFailed verdict fields anywhere", () => {
  const dir = makeTempDir("review-packet-test-");
  const packet = buildReviewPacket(baseInput(dir));
  assert.equal(packet.robotsPolicyViolation, undefined);
  assert.equal(packet.jsRuleUnverified, undefined);
  assert.equal(packet.diagnoseFailed, undefined);
  assert.equal(packet.checkedItems, undefined);
  assert.ok(packet.robotsEvidence);
  assert.ok(packet.diagnostics.rawOutput);
  // 정적 href 소스(jsDetailLinkRule 미사용)는 jsRuleEvidence 가 null 로
  // 명시되어야 한다(Brain 이 "JS 규칙 미검증" HOLD 조건과 혼동하지 않도록).
  assert.equal(packet.jsRuleEvidence, null);
});

test("buildReviewPacket requires jsRuleEvidence when source.jsDetailLinkRule.enabled is true, and stores the raw evidence as-is", () => {
  const dir = makeTempDir("review-packet-test-");
  const input = baseInput(dir);
  input.sourceSnapshot = { ...input.sourceSnapshot, jsDetailLinkRule: { enabled: true } };
  assert.throws(() => buildReviewPacket(input), /jsRuleEvidence/);

  input.jsRuleEvidence = { engineUnitTestsPassed: true, manualGetVerification: [] };
  const packet = buildReviewPacket(input);
  assert.deepEqual(packet.jsRuleEvidence, { engineUnitTestsPassed: true, manualGetVerification: [] });
  // 여기서도 위반 판정 필드는 여전히 존재하지 않아야 한다.
  assert.equal(packet.jsRuleUnverified, undefined);
});

test("packetSha256 changes when a single diagnostics field changes (all else fixed)", () => {
  const dir = makeTempDir("review-packet-test-");
  const packetA = buildReviewPacket(baseInput(dir));
  const inputB = baseInput(dir);
  inputB.diagnostics.foundCount = 999;
  const packetB = buildReviewPacket(inputB);
  assert.notEqual(packetA.packetSha256, packetB.packetSha256);
});

test("computePacketSha256 recomputed from a packet's own content matches packet.packetSha256", () => {
  const dir = makeTempDir("review-packet-test-");
  const packet = buildReviewPacket(baseInput(dir));
  assert.equal(computePacketSha256(packet), packet.packetSha256);
});

test("computePacketSha256 recomputed after tampering with any field no longer matches the stored packetSha256", () => {
  const dir = makeTempDir("review-packet-test-");
  const packet = buildReviewPacket(baseInput(dir));
  const tampered = { ...packet, proposedChange: { ...packet.proposedChange, enabled: { from: true, to: true } } };
  assert.notEqual(computePacketSha256(tampered), packet.packetSha256);
});

test("writeReviewPacketOnce writes the packet under <dataDir>/review-packets/<reviewId>.json", () => {
  const dir = makeTempDir("review-packet-test-");
  const dataDir = makeTempDir("review-packet-data-");
  const packet = buildReviewPacket(baseInput(dir));
  const writtenPath = writeReviewPacketOnce(packet, { dataDir });
  assert.equal(writtenPath, path.join(dataDir, "review-packets", `${packet.reviewId}.json`));
  const readBack = JSON.parse(fs.readFileSync(writtenPath, "utf8"));
  assert.equal(readBack.reviewId, packet.reviewId);
});

test("writeReviewPacketOnce refuses to overwrite an existing review packet (append-only)", () => {
  const dir = makeTempDir("review-packet-test-");
  const dataDir = makeTempDir("review-packet-data-");
  const packet = buildReviewPacket(baseInput(dir));
  writeReviewPacketOnce(packet, { dataDir });
  assert.throws(() => writeReviewPacketOnce(packet, { dataDir }), /append-only|overwrite/i);
});

test("generateReviewId matches the rp-<universityId>-<sourceId>-<yyyyMMddHHmmss>-<6-hex> format", () => {
  const id = generateReviewId({
    universityId: "jbnu",
    sourceId: "jbnu-official-news",
    now: new Date(2026, 7, 27, 14, 30, 0), // local time, month is 0-indexed (7 = August)
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });
  assert.equal(id, "rp-jbnu-jbnu-official-news-20260827143000-a1b2c3");
});

test("generateReviewId requires universityId and sourceId", () => {
  assert.throws(() => generateReviewId({ sourceId: "x" }), /universityId/);
  assert.throws(() => generateReviewId({ universityId: "x" }), /sourceId/);
});
