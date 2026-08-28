"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildReviewPacket, writeReviewPacketOnce } = require("./review-packet");
const { writeReviewDecision } = require("./review-decision-writer");
const { SIGNING_KEY_ENV_VAR, verifyDecisionSignature, getSignedFieldsPayload } = require("./signing-utils");
const { runAllGuards } = require("./apply-source-activation");
const { listPendingReviews, approveOne, batchApprove, parseCliArgs } = require("./brain-batch-approve");

const TEST_DUMMY_SIGNING_KEY = "test-only-dummy-signing-key-do-not-use-in-production";
const FIXED_NOW = new Date("2026-08-28T09:15:00.000Z");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFixture() {
  const dataDir = makeTempDir("b3-data-");
  const filesDir = makeTempDir("b3-files-");
  const sourceCatalogFile = path.join(filesDir, "catalog.json");
  const storeFile = path.join(filesDir, "store.json");
  const previewFile = path.join(filesDir, "preview.json");

  const sourceSnapshot = {
    id: "test-press",
    enabled: false,
    verified: false,
    status: "selector_required",
    collectionType: "html",
    listUrl: "https://news.example.ac.kr/press",
    selectors: { item: "tbody tr", title: "td a", link: "td a" },
  };
  const catalog = {
    universities: [
      {
        universityId: "test-university",
        universityGroupId: "g",
        universityName: "테스트대학교",
        sources: [sourceSnapshot, { ...sourceSnapshot, id: "second-press" }],
      },
    ],
  };
  fs.writeFileSync(sourceCatalogFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  fs.writeFileSync(storeFile, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, "utf8");
  fs.writeFileSync(previewFile, `${JSON.stringify({ items: [] }, null, 2)}\n`, "utf8");
  return { dataDir, filesDir, sourceCatalogFile, storeFile, previewFile, sourceSnapshot };
}

function writePacket(fixture, { sourceId = "test-press", randomHex = "a1b2c3", now = FIXED_NOW } = {}) {
  const packet = buildReviewPacket({
    universityId: "test-university",
    universityGroupId: "g",
    sourceId,
    sourceSnapshot: { ...fixture.sourceSnapshot, id: sourceId },
    diagnostics: {
      command: "node run-single-school-trial.js --diagnose",
      rawOutput: { ok: true },
      foundCount: 3,
      acceptedCount: 2,
      newCount: 2,
      duplicateCount: 0,
      excludedCount: 0,
      acceptedNewItemsForSave: [
        { title: "A", sourceUrl: "https://news.example.ac.kr/1", publishedAt: "2026-08-20", universityId: "test-university", universityGroupId: "g", category: "school_news", sourceId },
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

test("parseCliArgs parses --list / --approve / --review-ids / --all-pending", () => {
  assert.equal(parseCliArgs(["--list"]).list, true);
  const a = parseCliArgs(["--approve", "--review-ids=a, b ,c", "--reviewed-by=brain", "--reason=ok"]);
  assert.equal(a.approve, true);
  assert.deepEqual(a.reviewIds, ["a", "b", "c"]);
  assert.equal(a.reviewedBy, "brain");
  assert.equal(a.reason, "ok");
  assert.equal(parseCliArgs(["--approve", "--all-pending"]).allPending, true);
});

test("listPendingReviews returns only packets without a decision file, latest per source", () => {
  const fixture = makeFixture();
  const p1 = writePacket(fixture, { sourceId: "test-press", randomHex: "a1a1a1", now: new Date("2026-08-28T09:00:00.000Z") });
  const p2 = writePacket(fixture, { sourceId: "second-press", randomHex: "b2b2b2" });
  // decide p1 only
  writeReviewDecision({
    reviewId: p1.reviewId,
    dataDir: fixture.dataDir,
    verdict: "APPROVE",
    reasons: ["ok"],
    checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false },
    reviewedBy: "brain-local",
    signingKey: TEST_DUMMY_SIGNING_KEY,
    now: FIXED_NOW,
  });

  const pending = listPendingReviews({ dataDir: fixture.dataDir });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reviewId, p2.reviewId);
  assert.equal(pending[0].scope.sourceId, "second-press");
  assert.ok(pending[0].summary.diagnostics.acceptedCount === 2);
});

test("listPendingReviews keeps only the newest packet per (universityId, sourceId)", () => {
  const fixture = makeFixture();
  writePacket(fixture, { sourceId: "test-press", randomHex: "010101", now: new Date("2026-08-28T08:00:00.000Z") });
  const newer = writePacket(fixture, { sourceId: "test-press", randomHex: "020202", now: new Date("2026-08-28T10:00:00.000Z") });
  const pending = listPendingReviews({ dataDir: fixture.dataDir });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reviewId, newer.reviewId);
});

test("batchApprove signs N decisions that pass verifyDecisionSignature and runAllGuards", () => {
  const fixture = makeFixture();
  const p1 = writePacket(fixture, { sourceId: "test-press", randomHex: "a1a1a1" });
  const p2 = writePacket(fixture, { sourceId: "second-press", randomHex: "b2b2b2" });

  const result = batchApprove([p1.reviewId, p2.reviewId], {
    dataDir: fixture.dataDir,
    reviewedBy: "brain-local-session",
    reasons: ["robots ok", "regression fail 0"],
    signingKey: TEST_DUMMY_SIGNING_KEY,
    now: FIXED_NOW,
  });
  assert.equal(result.approved.length, 2);
  assert.equal(result.failed.length, 0);

  for (const reviewId of [p1.reviewId, p2.reviewId]) {
    const decision = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, "review-decisions", `${reviewId}.json`), "utf8"));
    assert.equal(decision.verdict, "APPROVE");
    assert.equal(verifyDecisionSignature(TEST_DUMMY_SIGNING_KEY, getSignedFieldsPayload(decision), decision.signature.value), true);
    const guard = runAllGuards(reviewId, {
      dataDir: fixture.dataDir,
      sourceCatalogFile: fixture.sourceCatalogFile,
      storeFile: fixture.storeFile,
      previewFile: fixture.previewFile,
      env: { [SIGNING_KEY_ENV_VAR]: TEST_DUMMY_SIGNING_KEY },
    });
    assert.equal(guard.failed, false);
  }
});

test("batchApprove skips reviewIds that already have a decision file (append-only)", () => {
  const fixture = makeFixture();
  const p1 = writePacket(fixture, { sourceId: "test-press", randomHex: "a1a1a1" });
  batchApprove([p1.reviewId], { dataDir: fixture.dataDir, reviewedBy: "brain", reasons: ["ok"], signingKey: TEST_DUMMY_SIGNING_KEY, now: FIXED_NOW });
  const again = batchApprove([p1.reviewId], { dataDir: fixture.dataDir, reviewedBy: "brain", reasons: ["ok"], signingKey: TEST_DUMMY_SIGNING_KEY, now: FIXED_NOW });
  assert.equal(again.approved.length, 0);
  assert.equal(again.skipped.length, 1);
  assert.equal(again.skipped[0].reason, "DECISION_ALREADY_EXISTS");
});

test("approveOne / batchApprove refuse and write nothing when the signing key is unavailable", () => {
  const fixture = makeFixture();
  const p1 = writePacket(fixture, { sourceId: "test-press", randomHex: "a1a1a1" });

  assert.throws(
    () => approveOne(p1.reviewId, { dataDir: fixture.dataDir, reviewedBy: "brain", reasons: ["ok"], env: {}, now: FIXED_NOW }),
    (error) => {
      assert.equal(error.code, "SIGNING_KEY_UNAVAILABLE");
      return true;
    }
  );
  assert.throws(
    () => batchApprove([p1.reviewId], { dataDir: fixture.dataDir, reviewedBy: "brain", reasons: ["ok"], env: {}, now: FIXED_NOW }),
    (error) => {
      assert.equal(error.code, "SIGNING_KEY_UNAVAILABLE");
      return true;
    }
  );
  assert.equal(fs.existsSync(path.join(fixture.dataDir, "review-decisions", `${p1.reviewId}.json`)), false);
});

test("batchApprove records a per-item failure when a violation flag conflicts with APPROVE", () => {
  const fixture = makeFixture();
  const p1 = writePacket(fixture, { sourceId: "test-press", randomHex: "a1a1a1" });
  const result = batchApprove([p1.reviewId], {
    dataDir: fixture.dataDir,
    reviewedBy: "brain",
    reasons: ["ok"],
    checkedItems: { robotsPolicyViolation: true, jsRuleUnverified: false, diagnoseFailed: false },
    signingKey: TEST_DUMMY_SIGNING_KEY,
    now: FIXED_NOW,
  });
  assert.equal(result.approved.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /APPROVE/);
  assert.equal(fs.existsSync(path.join(fixture.dataDir, "review-decisions", `${p1.reviewId}.json`)), false);
});

test("brain-batch-approve.js is not wired into package.json or code-agent execution paths", () => {
  const root = path.resolve(__dirname, "../../..");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.equal(pkg.includes("brain-batch-approve"), false);
  assert.equal(pkg.includes("review-decision-writer"), false);

  const mustNotRequire = [
    "server/agent/scheduler.js",
    "server/agent/once.js",
    "server/agent/runner.js",
    "server/agent/tools/run-scheduled-news-update.js",
    "server/agent/tools/run-single-school-trial.js",
    "server/agent/onboarding/tools/prepare-catalog-source-block.js",
    "server/agent/onboarding/tools/build-review-packet-from-diagnose.js",
    "server/agent/gate/apply-approved-activations.js",
    "server/agent/gate/apply-source-activation.js",
  ];
  const forbiddenRequire = /require\(\s*["'][^"']*(?:review-decision-writer|brain-batch-approve)["']\s*\)/;
  for (const rel of mustNotRequire) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    assert.equal(forbiddenRequire.test(src), false, `${rel} must not require review-decision-writer or brain-batch-approve`);
  }
});
