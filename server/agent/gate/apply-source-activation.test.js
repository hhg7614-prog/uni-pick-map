"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildReviewPacket, writeReviewPacketOnce } = require("./review-packet");
const { writeReviewDecision } = require("./review-decision-writer");
const { SIGNING_KEY_ENV_VAR } = require("./signing-utils");
const {
  parseArgs,
  runAllGuards,
  performActivationAndSave,
  applyMinimalDiff,
  findSourceInCatalog,
} = require("./apply-source-activation");

// 테스트 전용 더미 키 -- 실제 서명 키가 아니며, 실제 운영 환경에서는
// 사용하지 않습니다. 이 값을 실제 UNIPICK_GATE_SIGNING_KEY 로 쓰면 안 됩니다.
const TEST_DUMMY_SIGNING_KEY = "test-only-dummy-signing-key-do-not-use-in-production";
const TEST_ENV_WITH_KEY = { [SIGNING_KEY_ENV_VAR]: TEST_DUMMY_SIGNING_KEY };
const TEST_ENV_WITHOUT_KEY = {};

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 임시 디렉터리에 카탈로그/store/preview fixture 3종을 복사해 실제 파일
// 경로를 주입 가능하게 만든다(의존성 주입 패턴, spec.md "10) 통합 테스트
// 계획" / screen-selector-required-sources.js 의 fetchImpl/readFileImpl
// 옵션 패턴을 그대로 재사용).
function makeFixture() {
  const dataDir = makeTempDir("apply-source-activation-data-");
  const filesDir = makeTempDir("apply-source-activation-files-");
  const sourceCatalogFile = path.join(filesDir, "catalog.json");
  const storeFile = path.join(filesDir, "store.json");
  const previewFile = path.join(filesDir, "preview.json");

  const sourceSnapshot = {
    id: "test-official-news",
    enabled: false,
    verified: true,
    status: "selector_required",
    listUrl: "https://news.example.ac.kr/list",
  };
  const catalog = {
    universities: [
      {
        universityId: "test-university",
        universityGroupId: "test-university-group",
        universityName: "테스트대학교",
        sources: [sourceSnapshot],
      },
      {
        universityId: "unrelated-university",
        universityGroupId: "unrelated-university-group",
        universityName: "무관한대학교",
        sources: [{ id: "unrelated-source", enabled: true, verified: true, status: "verified" }],
      },
    ],
  };
  fs.writeFileSync(sourceCatalogFile, JSON.stringify(catalog, null, 2), "utf8");
  fs.writeFileSync(storeFile, JSON.stringify({ version: 1, items: [] }, null, 2), "utf8");
  fs.writeFileSync(previewFile, JSON.stringify({ items: [] }, null, 2), "utf8");

  return { dataDir, filesDir, sourceCatalogFile, storeFile, previewFile };
}

function buildAndWritePacket(fixture, overrides = {}) {
  const input = {
    universityId: "test-university",
    universityGroupId: "test-university-group",
    sourceId: "test-official-news",
    sourceSnapshot: {
      id: "test-official-news",
      enabled: false,
      verified: true,
      status: "selector_required",
      listUrl: "https://news.example.ac.kr/list",
    },
    diagnostics: {
      command: "node server/agent/tools/run-single-school-trial.js --diagnose",
      rawOutput: { ok: true },
      foundCount: 3,
      acceptedCount: 3,
      newCount: 1,
      duplicateCount: 0,
      excludedCount: 0,
      acceptedNewItemsForSave: [
        {
          title: "테스트 공지",
          sourceUrl: "https://news.example.ac.kr/1",
          publishedAt: "2026-08-20",
          universityId: "test-university",
          universityGroupId: "test-university-group",
          category: "school_news",
        },
      ],
    },
    robotsEvidence: { checked: true, unavailable: false, policy: { blocked: false } },
    regressionEvidence: { npmTestCommand: "npm test", npmTestSummary: "tests 10, pass 10, fail 0", ranAt: "2026-08-27T00:00:00.000Z" },
    paths: { sourceCatalogFile: fixture.sourceCatalogFile, storeFile: fixture.storeFile, previewFile: fixture.previewFile },
    now: new Date("2026-08-27T14:30:00.000Z"),
    randomBytesImpl: () => Buffer.from("a1b2c3", "hex"),
    ...overrides,
  };
  const packet = buildReviewPacket(input);
  writeReviewPacketOnce(packet, { dataDir: fixture.dataDir });
  return packet;
}

function writeDecision(fixture, packet, overrides = {}) {
  return writeReviewDecision({
    reviewId: packet.reviewId,
    dataDir: fixture.dataDir,
    verdict: "APPROVE",
    reasons: ["robots.txt allows access", "regression passed"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    reviewedBy: "brain-local-session",
    signingKey: TEST_DUMMY_SIGNING_KEY,
    now: new Date("2026-08-27T15:00:00.000Z"),
    ...overrides,
  }).decision;
}

function guardOptions(fixture, envOverride) {
  return {
    dataDir: fixture.dataDir,
    sourceCatalogFile: fixture.sourceCatalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    env: envOverride || TEST_ENV_WITH_KEY,
  };
}

function fileMtime(filePath) {
  return fs.statSync(filePath).mtimeMs;
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs: requires --review-id and defaults apply to false", () => {
  assert.throws(() => parseArgs([]), /--review-id/);
  assert.deepEqual(parseArgs(["--review-id=rp-1"]), { reviewId: "rp-1", apply: false });
  assert.deepEqual(parseArgs(["--review-id=rp-1", "--apply"]), { reviewId: "rp-1", apply: true });
});

// ---------------------------------------------------------------------------
// (a) 판정 파일이 없으면 NO_DECISION_YET
// ---------------------------------------------------------------------------

test("(a) runAllGuards rejects with NO_DECISION_YET when no decision file exists yet", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "NO_DECISION_YET");
});

test("runAllGuards rejects with REVIEW_PACKET_NOT_FOUND when the packet itself does not exist", () => {
  const fixture = makeFixture();
  const result = runAllGuards("rp-does-not-exist-20260827143000-a1b2c3", guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "REVIEW_PACKET_NOT_FOUND");
});

// ---------------------------------------------------------------------------
// (b) verdict: HOLD/REJECT는 --apply 유무와 무관하게 항상 거부
// ---------------------------------------------------------------------------

test("(b) runAllGuards rejects a HOLD verdict with VERDICT_NOT_APPROVED and lists the decision reasons", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet, {
    verdict: "HOLD",
    reasons: ["robots.txt could not be verified (ROBOTS_UNAVAILABLE)"],
    checkedItems: { robotsPolicyViolation: true, jsRuleUnverified: false, diagnoseFailed: false },
  });
  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "VERDICT_NOT_APPROVED");
  assert.ok(result.reasons.some((reason) => reason.includes("ROBOTS_UNAVAILABLE")));
});

test("(b) runAllGuards rejects a REJECT verdict the same way", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet, { verdict: "REJECT", reasons: ["not a valid detail page"] });
  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "VERDICT_NOT_APPROVED");
});

// ---------------------------------------------------------------------------
// (c) reviewedBy 가 블록리스트에 있으면 거부
// ---------------------------------------------------------------------------

test("(c) runAllGuards rejects with REVIEWER_BLOCKED when reviewedBy is a blocked name", () => {
  // writeReviewDecision() 자체도 블록리스트를 막지만, 여기서는 판정 파일이
  // 이미 다른 경로로 만들어졌다고 가정하고 apply 단계의 독립적인 방어를
  // 검증하기 위해 파일을 직접 기록한다.
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  const decisionPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.json`);
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });

  const { signDecision, signingKeyId } = require("./signing-utils");
  const { computePacketSha256 } = require("./review-packet");
  const signedFields = {
    reviewId: packet.reviewId,
    packetSha256Recomputed: computePacketSha256(packet),
    verdict: "APPROVE",
    reasons: ["ok"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
  };
  const decision = {
    schemaVersion: "1.0",
    ...signedFields,
    reviewedAt: "2026-08-27T15:00:00.000Z",
    reviewedBy: "Coder", // 블록리스트에 있음(대소문자 무관)
    packetPathRead: "irrelevant",
    signature: { alg: "HMAC-SHA256", keyId: signingKeyId(TEST_DUMMY_SIGNING_KEY), value: signDecision(TEST_DUMMY_SIGNING_KEY, signedFields) },
  };
  fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "REVIEWER_BLOCKED");
});

// ---------------------------------------------------------------------------
// (d) 4가지 체크섬 각각에 대한 개별 무효화 테스트
// ---------------------------------------------------------------------------

test("(d-1) STALE_REVIEW_PACKET_INVALIDATED when an unrelated part of the catalog changes (sourceCatalogFile only)", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  catalog.universities[1].sources[0].healthStatus = "changed"; // 관련 없는 다른 대학의 소스만 변경
  fs.writeFileSync(fixture.sourceCatalogFile, JSON.stringify(catalog, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "STALE_REVIEW_PACKET_INVALIDATED");
  assert.ok(result.reasons.some((reason) => reason.includes("sourceCatalogFile")));
  assert.ok(!result.reasons.some((reason) => reason.includes("sourceBlockCanonical")));
});

test("(d-2) STALE_REVIEW_PACKET_INVALIDATED when the reviewed source's own block changes (both sourceCatalogFile and sourceBlockCanonical)", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  catalog.universities[0].sources[0].listUrl = "https://news.example.ac.kr/list-changed";
  fs.writeFileSync(fixture.sourceCatalogFile, JSON.stringify(catalog, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "STALE_REVIEW_PACKET_INVALIDATED");
  assert.ok(result.reasons.some((reason) => reason.includes("sourceCatalogFile")));
  assert.ok(result.reasons.some((reason) => reason.includes("sourceBlockCanonical")));
});

test("(d-3) STALE_REVIEW_PACKET_INVALIDATED when the store file changes", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  fs.writeFileSync(fixture.storeFile, JSON.stringify({ version: 1, items: [{ title: "unexpected" }] }, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "STALE_REVIEW_PACKET_INVALIDATED");
  assert.ok(result.reasons.some((reason) => reason.includes("storeFile")));
});

test("(d-4) STALE_REVIEW_PACKET_INVALIDATED when the preview file changes", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  fs.writeFileSync(fixture.previewFile, JSON.stringify({ items: [{ title: "unexpected" }] }, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "STALE_REVIEW_PACKET_INVALIDATED");
  assert.ok(result.reasons.some((reason) => reason.includes("previewFile")));
});

// ---------------------------------------------------------------------------
// (e) --apply 없이 실행하면 모든 검증을 통과해도 실제 파일 변화 0건
// ---------------------------------------------------------------------------

test("(e) validation-only run (no --apply) never touches catalog/store/preview files (mtime unchanged)", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const before = {
    catalog: fileMtime(fixture.sourceCatalogFile),
    store: fileMtime(fixture.storeFile),
    preview: fileMtime(fixture.previewFile),
  };

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, false);
  // parseArgs({apply:false}) 경로에서는 performActivationAndSave 를 절대
  // 호출하지 않는다는 것이 apply-source-activation.js main() 의 계약이다.
  // 여기서는 runAllGuards() 만 호출했으므로 파일이 전혀 바뀌지 않아야 한다.

  assert.equal(fileMtime(fixture.sourceCatalogFile), before.catalog);
  assert.equal(fileMtime(fixture.storeFile), before.store);
  assert.equal(fileMtime(fixture.previewFile), before.preview);
});

// ---------------------------------------------------------------------------
// (f) 모든 검증 통과 + --apply 일 때만 enabled:true 반영 + saveNewItems 호출
// ---------------------------------------------------------------------------

function makeFixtureBackupBeforeSaveImpl(fixture) {
  return function fixtureBackupBeforeSave() {
    const backupDir = fs.mkdtempSync(path.join(fixture.filesDir, "backup-"));
    for (const [from, name] of [
      [fixture.storeFile, "agent-news-store.json"],
      [fixture.previewFile, "university-news-preview.json"],
    ]) {
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(backupDir, name));
    }
    return backupDir;
  };
}

function makeFixtureSaveNewItemsImpl(fixture) {
  return function fixtureSaveNewItems(newItems) {
    const store = JSON.parse(fs.readFileSync(fixture.storeFile, "utf8"));
    const merged = [...newItems, ...(store.items || [])];
    fs.writeFileSync(fixture.storeFile, JSON.stringify({ ...store, items: merged }, null, 2), "utf8");
    fs.writeFileSync(fixture.previewFile, JSON.stringify({ items: newItems }, null, 2), "utf8");
    return { savedCount: newItems.length, totalCount: merged.length };
  };
}

test("(f) performActivationAndSave sets enabled:true via minimal diff and calls saveNewItems with the packet's accepted items", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const guardResult = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(guardResult.failed, false);

  const result = performActivationAndSave(guardResult.packet, {
    reviewId: packet.reviewId,
    dataDir: fixture.dataDir,
    sourceCatalogFile: fixture.sourceCatalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    backupBeforeSaveImpl: makeFixtureBackupBeforeSaveImpl(fixture),
    saveNewItemsImpl: makeFixtureSaveNewItemsImpl(fixture),
  });

  assert.equal(result.status, "APPLIED");
  assert.equal(result.saveResult.savedCount, 1);

  const catalogAfter = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const { source } = findSourceInCatalog(catalogAfter, packet.scope);
  assert.equal(source.enabled, true);
  assert.equal(source.verified, true);
  assert.equal(source.status, "verified");
  // 다른 대학/다른 소스는 절대 건드리지 않는다(최소 diff 원칙).
  assert.equal(catalogAfter.universities[1].sources[0].id, "unrelated-source");
  assert.equal(catalogAfter.universities[1].sources[0].enabled, true);

  const storeAfter = JSON.parse(fs.readFileSync(fixture.storeFile, "utf8"));
  assert.equal(storeAfter.items.some((item) => item.title === "테스트 공지"), true);

  const appliedRecordPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.applied.json`);
  assert.ok(fs.existsSync(appliedRecordPath));
});

test("applyMinimalDiff only touches enabled/verified/status on the targeted source", () => {
  const fixture = makeFixture();
  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const scope = { universityId: "test-university", sourceId: "test-official-news" };
  const proposedChange = { enabled: { from: false, to: true }, verified: { from: true, to: true }, status: { from: "selector_required", to: "verified" } };
  applyMinimalDiff(catalog, scope, proposedChange);
  const { source } = findSourceInCatalog(catalog, scope);
  assert.equal(source.enabled, true);
  assert.equal(source.status, "verified");
  assert.equal(source.listUrl, "https://news.example.ac.kr/list"); // 그 외 필드는 그대로
});

// ---------------------------------------------------------------------------
// (g) saveNewItems 실패 시 카탈로그가 enabled:false 로 롤백
// ---------------------------------------------------------------------------

test("(g) when saveNewItems throws, the catalog is rolled back to enabled:false from backup", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);
  const guardResult = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(guardResult.failed, false);

  const throwingSaveNewItems = () => {
    throw new Error("disk write failed (simulated)");
  };

  assert.throws(
    () =>
      performActivationAndSave(guardResult.packet, {
        reviewId: packet.reviewId,
        dataDir: fixture.dataDir,
        sourceCatalogFile: fixture.sourceCatalogFile,
        storeFile: fixture.storeFile,
        previewFile: fixture.previewFile,
        backupBeforeSaveImpl: makeFixtureBackupBeforeSaveImpl(fixture),
        saveNewItemsImpl: throwingSaveNewItems,
      }),
    (error) => {
      assert.equal(error.code, "SAVE_FAILED_ROLLBACK_SUCCESS");
      assert.equal(error.rollback, "success");
      return true;
    }
  );

  const catalogAfter = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const { source } = findSourceInCatalog(catalogAfter, packet.scope);
  assert.equal(source.enabled, false);
});

// ---------------------------------------------------------------------------
// (h)/(i)/(j) 서명 관련 거부
// ---------------------------------------------------------------------------

test("(h) SIGNATURE_MISSING when the decision file has no signature field", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  const decisionPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.json`);
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
  const { computePacketSha256 } = require("./review-packet");
  fs.writeFileSync(
    decisionPath,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        reviewId: packet.reviewId,
        reviewedAt: "2026-08-27T15:00:00.000Z",
        reviewedBy: "brain-local-session",
        packetPathRead: "irrelevant",
        packetSha256Recomputed: computePacketSha256(packet),
        verdict: "APPROVE",
        reasons: ["ok"],
        checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
      },
      null,
      2
    ),
    "utf8"
  );

  const before = { catalog: fileMtime(fixture.sourceCatalogFile), store: fileMtime(fixture.storeFile), preview: fileMtime(fixture.previewFile) };
  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "SIGNATURE_MISSING");
  assert.equal(fileMtime(fixture.sourceCatalogFile), before.catalog);
  assert.equal(fileMtime(fixture.storeFile), before.store);
  assert.equal(fileMtime(fixture.previewFile), before.preview);
});

test("(i) SIGNATURE_INVALID when the signature value is tampered", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  const written = writeReviewDecision({
    reviewId: packet.reviewId,
    dataDir: fixture.dataDir,
    verdict: "APPROVE",
    reasons: ["ok"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    reviewedBy: "brain-local-session",
    signingKey: TEST_DUMMY_SIGNING_KEY,
  });
  const decisionPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.json`);
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  decision.signature.value = decision.signature.value.slice(0, -2) + (decision.signature.value.slice(-2) === "00" ? "11" : "00");
  fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "SIGNATURE_INVALID");
  void written;
});

test("(j) SIGNATURE_INVALID when a signed field (verdict/reasons/checkedItems) is edited after signing", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);
  const decisionPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.json`);
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  decision.reasons = [...decision.reasons, "added after signing"];
  fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2), "utf8");

  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "SIGNATURE_INVALID");
});

// ---------------------------------------------------------------------------
// (k) 서명 키를 로드할 수 없는 환경 -> SIGNING_KEY_UNAVAILABLE
// ---------------------------------------------------------------------------

test("(k) SIGNING_KEY_UNAVAILABLE when the signing key env var is not set in this execution context", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const before = { catalog: fileMtime(fixture.sourceCatalogFile), store: fileMtime(fixture.storeFile), preview: fileMtime(fixture.previewFile) };
  const result = runAllGuards(packet.reviewId, guardOptions(fixture, TEST_ENV_WITHOUT_KEY));
  assert.equal(result.failed, true);
  assert.equal(result.code, "SIGNING_KEY_UNAVAILABLE");
  assert.equal(fileMtime(fixture.sourceCatalogFile), before.catalog);
  assert.equal(fileMtime(fixture.storeFile), before.store);
  assert.equal(fileMtime(fixture.previewFile), before.preview);
});

// ---------------------------------------------------------------------------
// 통합 시나리오 (spec.md "10) 통합 테스트 계획")
// ---------------------------------------------------------------------------

test("integration: full happy path -- validate without --apply changes nothing, then --apply applies", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const beforeMtimes = { catalog: fileMtime(fixture.sourceCatalogFile), store: fileMtime(fixture.storeFile), preview: fileMtime(fixture.previewFile) };
  const validateOnly = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(validateOnly.failed, false);
  assert.equal(fileMtime(fixture.sourceCatalogFile), beforeMtimes.catalog);
  assert.equal(fileMtime(fixture.storeFile), beforeMtimes.store);
  assert.equal(fileMtime(fixture.previewFile), beforeMtimes.preview);

  const applied = performActivationAndSave(validateOnly.packet, {
    reviewId: packet.reviewId,
    dataDir: fixture.dataDir,
    sourceCatalogFile: fixture.sourceCatalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    backupBeforeSaveImpl: makeFixtureBackupBeforeSaveImpl(fixture),
    saveNewItemsImpl: makeFixtureSaveNewItemsImpl(fixture),
  });
  assert.equal(applied.status, "APPLIED");
  const { source } = findSourceInCatalog(JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8")), packet.scope);
  assert.equal(source.enabled, true);
});

test("integration: catalog edited between packet creation and --apply is rejected as STALE_REVIEW_PACKET_INVALIDATED, no file changes", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  catalog.universities[0].sources[0].enabled = true; // 다른 프로세스가 먼저 활성화했다고 가정
  fs.writeFileSync(fixture.sourceCatalogFile, JSON.stringify(catalog, null, 2), "utf8");

  const before = { store: fileMtime(fixture.storeFile), preview: fileMtime(fixture.previewFile) };
  const result = runAllGuards(packet.reviewId, guardOptions(fixture));
  assert.equal(result.failed, true);
  assert.equal(result.code, "STALE_REVIEW_PACKET_INVALIDATED");
  assert.equal(fileMtime(fixture.storeFile), before.store);
  assert.equal(fileMtime(fixture.previewFile), before.preview);
});

test("integration: signing key removed from the apply execution context is rejected, no file changes", () => {
  const fixture = makeFixture();
  const packet = buildAndWritePacket(fixture);
  writeDecision(fixture, packet);

  const before = { catalog: fileMtime(fixture.sourceCatalogFile), store: fileMtime(fixture.storeFile), preview: fileMtime(fixture.previewFile) };
  const result = runAllGuards(packet.reviewId, guardOptions(fixture, TEST_ENV_WITHOUT_KEY));
  assert.equal(result.failed, true);
  assert.equal(result.code, "SIGNING_KEY_UNAVAILABLE");
  assert.equal(fileMtime(fixture.sourceCatalogFile), before.catalog);
  assert.equal(fileMtime(fixture.storeFile), before.store);
  assert.equal(fileMtime(fixture.previewFile), before.preview);
});
