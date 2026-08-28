"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildReviewPacket, writeReviewPacketOnce, computePacketSha256 } = require("./review-packet");
const { writeReviewDecision } = require("./review-decision-writer");
const { signDecision, signingKeyId, SIGNING_KEY_ENV_VAR } = require("./signing-utils");
const { performActivationAndSave, findSourceInCatalog } = require("./apply-source-activation");
const {
  listApprovedUnapplied,
  applyApprovedActivations,
  countTargetUniversitiesInCatalogFile,
  parseCliArgs,
} = require("./apply-approved-activations");

const TEST_DUMMY_SIGNING_KEY = "test-only-dummy-signing-key-do-not-use-in-production";
const TEST_ENV_WITH_KEY = { [SIGNING_KEY_ENV_VAR]: TEST_DUMMY_SIGNING_KEY };
const FIXED_NOW = new Date("2026-08-28T09:15:00.000Z");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const OKAY_LOCK = { acquire: () => ({ acquired: true, filePath: null }), release: () => {} };

function htmlSource(id) {
  return {
    id,
    name: `소스 ${id}`,
    category: "school_news",
    sourceType: "official",
    collectionType: "html",
    baseUrl: "https://news.example.ac.kr",
    listUrl: "https://news.example.ac.kr/press",
    selectors: { item: "tbody tr", title: "td a", link: "td a", date: "td" },
    detailSelectors: { title: "h2", date: "span.date" },
    verified: false,
    enabled: false,
    status: "selector_required",
    healthStatus: "unknown",
  };
}

function makeFixture({ sourceIds = ["press-a", "press-b"] } = {}) {
  const dataDir = makeTempDir("b4-data-");
  const filesDir = makeTempDir("b4-files-");
  const sourceCatalogFile = path.join(filesDir, "catalog.json");
  const storeFile = path.join(filesDir, "store.json");
  const previewFile = path.join(filesDir, "preview.json");

  const catalog = {
    universities: [
      {
        universityId: "already-live-university",
        universityGroupId: "already-live",
        universityName: "이미대학교",
        sources: [
          { id: "live-rss", sourceType: "official", collectionType: "rss", rssUrl: "https://a.ac.kr/rss", verified: true, enabled: true, status: "verified" },
        ],
      },
      {
        universityId: "test-university",
        universityGroupId: "test-university-group",
        universityName: "테스트대학교",
        sources: sourceIds.map(htmlSource),
      },
    ],
  };
  fs.writeFileSync(sourceCatalogFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  fs.writeFileSync(storeFile, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, "utf8");
  fs.writeFileSync(previewFile, `${JSON.stringify({ items: [] }, null, 2)}\n`, "utf8");

  return { dataDir, filesDir, sourceCatalogFile, storeFile, previewFile };
}

function buildPacket(fixture, sourceId, { randomHex = "a1b2c3", now = FIXED_NOW } = {}) {
  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const { source } = findSourceInCatalog(catalog, { universityId: "test-university", sourceId });
  const packet = buildReviewPacket({
    universityId: "test-university",
    universityGroupId: "test-university-group",
    sourceId,
    sourceSnapshot: source,
    diagnostics: {
      command: "node run-single-school-trial.js --diagnose",
      rawOutput: { ok: true },
      foundCount: 3,
      acceptedCount: 2,
      newCount: 2,
      duplicateCount: 0,
      excludedCount: 0,
      acceptedNewItemsForSave: [
        { title: `공지 ${sourceId}`, sourceUrl: `https://news.example.ac.kr/${sourceId}`, publishedAt: "2026-08-20", universityId: "test-university", universityGroupId: "test-university-group", category: "school_news", sourceId },
      ],
    },
    robotsEvidence: { checked: true, unavailable: false, policy: { blocked: false } },
    regressionEvidence: { npmTestCommand: "npm test", npmTestSummary: "tests 233, pass 233, fail 0", ranAt: "2026-08-28T00:00:00.000Z" },
    paths: { sourceCatalogFile: fixture.sourceCatalogFile, storeFile: fixture.storeFile, previewFile: fixture.previewFile },
    now,
    randomBytesImpl: () => Buffer.from(randomHex, "hex"),
  });
  writeReviewPacketOnce(packet, { dataDir: fixture.dataDir });
  return packet;
}

function signApprove(fixture, packet) {
  writeReviewDecision({
    reviewId: packet.reviewId,
    dataDir: fixture.dataDir,
    verdict: "APPROVE",
    reasons: ["robots ok", "regression fail 0"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    reviewedBy: "brain-local-session",
    signingKey: TEST_DUMMY_SIGNING_KEY,
    now: FIXED_NOW,
  });
}

function writeUnsignedApprove(fixture, packet) {
  const decisionPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.json`);
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
  fs.writeFileSync(
    decisionPath,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        reviewId: packet.reviewId,
        reviewedAt: "2026-08-28T00:00:00.000Z",
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
}

function fixtureBackupBeforeSave(fixture) {
  return function backup() {
    const dir = fs.mkdtempSync(path.join(fixture.filesDir, "backup-"));
    for (const [from, name] of [
      [fixture.storeFile, "agent-news-store.json"],
      [fixture.previewFile, "university-news-preview.json"],
    ]) {
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name));
    }
    return dir;
  };
}

function fixtureSaveNewItems(fixture) {
  return function save(newItems) {
    const store = JSON.parse(fs.readFileSync(fixture.storeFile, "utf8"));
    const merged = [...newItems, ...(store.items || [])];
    fs.writeFileSync(fixture.storeFile, JSON.stringify({ ...store, items: merged }, null, 2), "utf8");
    fs.writeFileSync(fixture.previewFile, JSON.stringify({ items: newItems }, null, 2), "utf8");
    return { savedCount: newItems.length, totalCount: merged.length };
  };
}

function runOptions(fixture, extra = {}) {
  return {
    dataDir: fixture.dataDir,
    sourceCatalogFile: fixture.sourceCatalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    env: TEST_ENV_WITH_KEY,
    now: () => FIXED_NOW,
    runId: "apply-testrun",
    countTargetsImpl: () => countTargetUniversitiesInCatalogFile(fixture.sourceCatalogFile),
    acquireLockImpl: OKAY_LOCK.acquire,
    releaseLockImpl: OKAY_LOCK.release,
    ...extra,
  };
}

function mtimes(fixture) {
  return {
    catalog: fs.statSync(fixture.sourceCatalogFile).mtimeMs,
    store: fs.statSync(fixture.storeFile).mtimeMs,
    preview: fs.statSync(fixture.previewFile).mtimeMs,
  };
}

// ---------------------------------------------------------------------------

test("parseCliArgs reads --apply / --stop-on-first-applied", () => {
  assert.deepEqual(parseCliArgs([]), { apply: false, stopOnFirstApplied: false, runId: undefined });
  assert.deepEqual(parseCliArgs(["--apply", "--stop-on-first-applied"]), { apply: true, stopOnFirstApplied: true, runId: undefined });
});

test("listApprovedUnapplied returns APPROVE decisions without an .applied.json, newest per source", () => {
  const fixture = makeFixture();
  const p1 = buildPacket(fixture, "press-a", { randomHex: "a1a1a1" });
  const p2 = buildPacket(fixture, "press-b", { randomHex: "b2b2b2" });
  signApprove(fixture, p1);
  signApprove(fixture, p2);
  fs.writeFileSync(path.join(fixture.dataDir, "review-decisions", `${p1.reviewId}.applied.json`), "{}", "utf8");

  const list = listApprovedUnapplied({ dataDir: fixture.dataDir });
  assert.equal(list.length, 1);
  assert.equal(list[0].reviewId, p2.reviewId);
});

test("no --apply: every guard-passing item is VALIDATED_NOT_APPLIED and files are untouched", () => {
  const fixture = makeFixture();
  const p1 = buildPacket(fixture, "press-a", { randomHex: "a1a1a1" });
  signApprove(fixture, p1);
  const before = mtimes(fixture);

  const report = applyApprovedActivations(runOptions(fixture, { apply: false }));
  assert.equal(report.applied.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].code, "VALIDATED_NOT_APPLIED");
  assert.deepEqual(mtimes(fixture), before);
  assert.ok(fs.existsSync(path.join(fixture.dataDir, "apply-batch-reports", "apply-testrun.json")));
});

test("--apply applies exactly one item; the rest go STALE; target university count goes before -> before+1", () => {
  const fixture = makeFixture();
  const p1 = buildPacket(fixture, "press-a", { randomHex: "a1a1a1" });
  const p2 = buildPacket(fixture, "press-b", { randomHex: "b2b2b2" });
  signApprove(fixture, p1);
  signApprove(fixture, p2);

  const before = countTargetUniversitiesInCatalogFile(fixture.sourceCatalogFile);
  const report = applyApprovedActivations(
    runOptions(fixture, {
      apply: true,
      performActivationOptions: {
        backupBeforeSaveImpl: fixtureBackupBeforeSave(fixture),
        saveNewItemsImpl: fixtureSaveNewItems(fixture),
      },
    })
  );

  assert.equal(report.applied.length, 1);
  assert.equal(report.failed.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].code, "STALE_REVIEW_PACKET_INVALIDATED");
  assert.equal(report.targetUniversityCountBefore, before);
  assert.equal(report.targetUniversityCountAfter, before + 1);

  const appliedReviewId = report.applied[0].reviewId;
  assert.ok(fs.existsSync(path.join(fixture.dataDir, "review-decisions", `${appliedReviewId}.applied.json`)));

  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const { source } = findSourceInCatalog(catalog, { universityId: "test-university", sourceId: appliedReviewId.includes("press-a") ? "press-a" : "press-b" });
  assert.equal(source.enabled, true);
});

test("--apply --stop-on-first-applied stops after the first applied item", () => {
  const fixture = makeFixture({ sourceIds: ["press-a", "press-b", "press-c"] });
  for (const [id, hex] of [["press-a", "a1a1a1"], ["press-b", "b2b2b2"], ["press-c", "c3c3c3"]]) {
    signApprove(fixture, buildPacket(fixture, id, { randomHex: hex }));
  }
  const report = applyApprovedActivations(
    runOptions(fixture, {
      apply: true,
      stopOnFirstApplied: true,
      performActivationOptions: {
        backupBeforeSaveImpl: fixtureBackupBeforeSave(fixture),
        saveNewItemsImpl: fixtureSaveNewItems(fixture),
      },
    })
  );
  assert.equal(report.applied.length, 1);
  assert.ok(report.skipped.some((s) => s.code === "SKIPPED_AFTER_STOP"));
});

test("an unsigned APPROVE decision is skipped with SIGNATURE_MISSING and throws nothing", () => {
  const fixture = makeFixture({ sourceIds: ["press-a"] });
  const p1 = buildPacket(fixture, "press-a", { randomHex: "a1a1a1" });
  writeUnsignedApprove(fixture, p1);
  const before = mtimes(fixture);

  const report = applyApprovedActivations(
    runOptions(fixture, {
      apply: true,
      performActivationOptions: { backupBeforeSaveImpl: fixtureBackupBeforeSave(fixture), saveNewItemsImpl: fixtureSaveNewItems(fixture) },
    })
  );
  assert.equal(report.applied.length, 0);
  assert.equal(report.skipped[0].code, "SIGNATURE_MISSING");
  assert.deepEqual(mtimes(fixture), before);
});

test("when saveNewItems throws, the item is recorded as SAVE_FAILED_ROLLBACK_SUCCESS and the catalog rolls back to enabled:false", () => {
  const fixture = makeFixture({ sourceIds: ["press-a"] });
  const p1 = buildPacket(fixture, "press-a", { randomHex: "a1a1a1" });
  signApprove(fixture, p1);

  const report = applyApprovedActivations(
    runOptions(fixture, {
      apply: true,
      performActivationOptions: {
        backupBeforeSaveImpl: fixtureBackupBeforeSave(fixture),
        saveNewItemsImpl: () => {
          throw new Error("disk write failed (simulated)");
        },
      },
    })
  );

  assert.equal(report.applied.length, 0);
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].code, "SAVE_FAILED_ROLLBACK_SUCCESS");
  assert.equal(report.failed[0].rollback, "success");

  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const { source } = findSourceInCatalog(catalog, { universityId: "test-university", sourceId: "press-a" });
  assert.equal(source.enabled, false);
});

test("a missing runtime lock aborts before anything is applied", () => {
  const fixture = makeFixture({ sourceIds: ["press-a"] });
  signApprove(fixture, buildPacket(fixture, "press-a", { randomHex: "a1a1a1" }));
  assert.throws(
    () => applyApprovedActivations(runOptions(fixture, { apply: true, acquireLockImpl: () => ({ acquired: false }) })),
    (error) => {
      assert.equal(error.code, "RUNTIME_LOCK_UNAVAILABLE");
      return true;
    }
  );
  const catalog = JSON.parse(fs.readFileSync(fixture.sourceCatalogFile, "utf8"));
  const { source } = findSourceInCatalog(catalog, { universityId: "test-university", sourceId: "press-a" });
  assert.equal(source.enabled, false);
});

test("integration demo: dummy-key-signed APPROVE is applied by --apply, target count +1, applied.json written", () => {
  const fixture = makeFixture({ sourceIds: ["press-a"] });
  const packet = buildPacket(fixture, "press-a", { randomHex: "a1a1a1" });
  // sign with the same primitives the Brain would use
  const signedFields = getSignedFieldsForTest(packet);
  const decisionPath = path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.json`);
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
  fs.writeFileSync(
    decisionPath,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        ...signedFields,
        reviewedAt: "2026-08-28T00:00:00.000Z",
        reviewedBy: "brain-local-session",
        packetPathRead: "irrelevant",
        signature: { alg: "HMAC-SHA256", keyId: signingKeyId(TEST_DUMMY_SIGNING_KEY), value: signDecision(TEST_DUMMY_SIGNING_KEY, signedFields) },
      },
      null,
      2
    ),
    "utf8"
  );

  const before = countTargetUniversitiesInCatalogFile(fixture.sourceCatalogFile);
  const report = applyApprovedActivations(
    runOptions(fixture, {
      apply: true,
      performActivationOptions: { backupBeforeSaveImpl: fixtureBackupBeforeSave(fixture), saveNewItemsImpl: fixtureSaveNewItems(fixture) },
    })
  );
  assert.equal(report.applied.length, 1);
  assert.equal(report.targetUniversityCountAfter, before + 1);
  assert.ok(fs.existsSync(path.join(fixture.dataDir, "review-decisions", `${packet.reviewId}.applied.json`)));
});

function getSignedFieldsForTest(packet) {
  return {
    reviewId: packet.reviewId,
    packetSha256Recomputed: computePacketSha256(packet),
    verdict: "APPROVE",
    reasons: ["robots ok"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
  };
}
