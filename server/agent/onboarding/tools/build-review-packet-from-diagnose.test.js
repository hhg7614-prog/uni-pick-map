"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseJsonObjectsFromStdout,
  evaluateDiagnose,
  extractNpmTestSummary,
  reconstructAcceptedNewItems,
  buildReviewPacketFromDiagnose,
} = require("./build-review-packet-from-diagnose");
const { computePacketSha256 } = require("../../gate/review-packet");
const { prepareCatalogSourceBlock } = require("./prepare-catalog-source-block");

// 로컬 시간 성분 생성자 -- gate review-packet.js 의 formatCompactTimestamp 는
// getHours() 등 로컬 성분으로 압축하므로, UTC 문자열을 쓰면 UTC+9 이외
// 환경에서 reviewId 타임스탬프가 달라진다(server/agent/gate/review-packet.test.js
// 와 동일한 타임존 무관 패턴). 이 값의 압축 스탬프는 항상 "20260828091500".
const FIXED_NOW = new Date(2026, 7, 28, 9, 15, 0);
const FIXED_RANDOM_BYTES = () => Buffer.from("a1b2c3", "hex");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sourceBlock(overrides = {}) {
  return {
    id: "test-press",
    name: "테스트대학교 보도자료",
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
    ...overrides,
  };
}

function makeFixture({ source = sourceBlock() } = {}) {
  const filesDir = makeTempDir("b2-files-");
  const dataDir = makeTempDir("b2-data-");
  const catalogFile = path.join(filesDir, "catalog.json");
  const storeFile = path.join(filesDir, "store.json");
  const previewFile = path.join(filesDir, "preview.json");

  const catalog = {
    universities: [
      {
        universityId: "test-university",
        universityGroupId: "test-university-group",
        universityName: "테스트대학교",
        enabled: true,
        sources: [source],
      },
    ],
  };
  fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  fs.writeFileSync(storeFile, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, "utf8");
  fs.writeFileSync(previewFile, `${JSON.stringify({ items: [] }, null, 2)}\n`, "utf8");

  return { filesDir, dataDir, catalogFile, storeFile, previewFile };
}

function diagnoseStdout(result) {
  const header = { phase: "single_school_trial", diagnose: true, university: { universityId: "test-university" } };
  return `${JSON.stringify(header, null, 2)}\n${JSON.stringify(result, null, 2)}\n`;
}

function passingDiagnoseResult() {
  return {
    foundCount: 3,
    acceptedCount: 2,
    newCount: 2,
    duplicateCount: 0,
    excludedCount: 1,
    diagnostics: [
      { title: "공지 A", sourceUrl: "https://news.example.ac.kr/1", publishedAt: "2026-08-20", storable: true, reason: null },
      { title: "공지 B", sourceUrl: "https://news.example.ac.kr/2", publishedAt: "2026-08-21", storable: true, reason: null },
      { title: "제외됨", sourceUrl: "https://news.example.ac.kr/3", publishedAt: null, storable: false, reason: "not_a_valid_detail_url" },
    ],
    sourceWarnings: [],
    backupDir: null,
    saveResult: { dryRun: true, savedCount: 0, totalCount: 0 },
  };
}

function makeRunner(result) {
  return async () => ({ command: "node run-single-school-trial.js --diagnose --allow-unverified-diagnose", stdout: diagnoseStdout(result) });
}

function robotsOkFetch() {
  return async (url) => ({ status: 200, url, text: async () => "User-agent: *\nAllow: /\n" });
}

function robotsUnavailableFetch() {
  return async () => {
    throw new Error("ECONNREFUSED (simulated)");
  };
}

const npmTestPass = () => "TAP version 13\n# tests 233\n# pass 233\n# fail 0\n";
const npmTestFail = () => "TAP version 13\n# tests 233\n# pass 232\n# fail 1\n";

function countPacketFiles(dataDir) {
  const dir = path.join(dataDir, "review-packets");
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

test("parseJsonObjectsFromStdout extracts multiple pretty-printed top-level objects", () => {
  const objs = parseJsonObjectsFromStdout(diagnoseStdout(passingDiagnoseResult()));
  assert.equal(objs.length, 2);
  assert.equal(objs[1].foundCount, 3);
});

test("parseJsonObjectsFromStdout ignores braces inside strings", () => {
  const objs = parseJsonObjectsFromStdout('{"a":"}{"}\n{"b":2}');
  assert.deepEqual(objs, [{ a: "}{" }, { b: 2 }]);
});

test("evaluateDiagnose passes for a healthy result", () => {
  const evalResult = evaluateDiagnose(
    passingDiagnoseResult(),
    sourceBlock(),
    { checked: true, unavailable: false, policy: { blocked: false } },
    { minAccepted: 2 }
  );
  assert.equal(evalResult.passed, true);
});

test("evaluateDiagnose fails on published_at_not_found / low accepted / robots unavailable / js rule", () => {
  const base = { checked: true, unavailable: false, policy: { blocked: false } };
  const withMissingDate = passingDiagnoseResult();
  withMissingDate.diagnostics.push({ title: "C", sourceUrl: "x", publishedAt: null, storable: false, reason: "published_at_not_found" });
  assert.equal(evaluateDiagnose(withMissingDate, sourceBlock(), base).passed, false);

  const lowAccepted = { ...passingDiagnoseResult(), acceptedCount: 1 };
  assert.equal(evaluateDiagnose(lowAccepted, sourceBlock(), base).passed, false);

  assert.equal(
    evaluateDiagnose(passingDiagnoseResult(), sourceBlock(), { checked: false, unavailable: true, policy: { blocked: false } }).passed,
    false
  );

  assert.equal(
    evaluateDiagnose(passingDiagnoseResult(), sourceBlock({ jsDetailLinkRule: { enabled: true } }), base).passed,
    false
  );
});

test("extractNpmTestSummary reports the fail count that review-packet.js requires", () => {
  assert.match(extractNpmTestSummary(npmTestPass()), /fail 0/);
  assert.match(extractNpmTestSummary(npmTestFail()), /fail 1/);
});

test("reconstructAcceptedNewItems rebuilds save-shaped items from storable diagnostics", () => {
  const items = reconstructAcceptedNewItems(passingDiagnoseResult(), {
    university: { universityId: "test-university", universityGroupId: "test-university-group" },
    source: sourceBlock(),
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: "공지 A",
    sourceUrl: "https://news.example.ac.kr/1",
    publishedAt: "2026-08-20",
    universityId: "test-university",
    universityGroupId: "test-university-group",
    category: "school_news",
    sourceId: "test-press",
  });
});

// ---------------------------------------------------------------------------
// buildReviewPacketFromDiagnose -- pass
// ---------------------------------------------------------------------------

test("buildReviewPacketFromDiagnose writes a self-consistent packet on a passing diagnose", async () => {
  const fixture = makeFixture();
  const out = await buildReviewPacketFromDiagnose({
    universityId: "test-university",
    sourceId: "test-press",
    limit: 3,
    minAccepted: 2,
    catalogFile: fixture.catalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    dataDir: fixture.dataDir,
    runnerImpl: makeRunner(passingDiagnoseResult()),
    fetchImpl: robotsOkFetch(),
    npmTestImpl: npmTestPass,
    now: () => FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });

  assert.equal(out.status, "PACKET_CREATED");
  assert.equal(out.reviewId, "rp-test-university-test-press-20260828091500-a1b2c3");
  assert.match(out.reviewId, /^rp-test-university-test-press-\d{14}-a1b2c3$/);
  assert.ok(fs.existsSync(out.writtenPath));

  const packet = JSON.parse(fs.readFileSync(out.writtenPath, "utf8"));
  assert.equal(computePacketSha256(packet), packet.packetSha256);
  assert.equal(Object.values(packet.mutation).every((v) => v === false), true);
  assert.match(packet.regressionEvidence.npmTestSummary, /fail 0/);
  assert.equal(packet.diagnostics.acceptedNewItemsForSave.length, 2);
  assert.equal(packet.diagnostics.acceptedNewItemsForSave[0].universityId, "test-university");
});

// ---------------------------------------------------------------------------
// buildReviewPacketFromDiagnose -- blocked (no packet file)
// ---------------------------------------------------------------------------

test("no packet when foundCount is 0", async () => {
  const fixture = makeFixture();
  const result = { ...passingDiagnoseResult(), foundCount: 0, acceptedCount: 0, diagnostics: [] };
  const out = await buildReviewPacketFromDiagnose({
    universityId: "test-university",
    sourceId: "test-press",
    catalogFile: fixture.catalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    dataDir: fixture.dataDir,
    runnerImpl: makeRunner(result),
    fetchImpl: robotsOkFetch(),
    npmTestImpl: npmTestPass,
    now: () => FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });
  assert.equal(out.status, "DIAGNOSE_FAILED");
  assert.equal(countPacketFiles(fixture.dataDir), 0);
});

test("no packet when an item is missing publishedAt", async () => {
  const fixture = makeFixture();
  const result = passingDiagnoseResult();
  result.diagnostics.push({ title: "C", sourceUrl: "x", publishedAt: null, storable: false, reason: "published_at_not_found" });
  const out = await buildReviewPacketFromDiagnose({
    universityId: "test-university",
    sourceId: "test-press",
    catalogFile: fixture.catalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    dataDir: fixture.dataDir,
    runnerImpl: makeRunner(result),
    fetchImpl: robotsOkFetch(),
    npmTestImpl: npmTestPass,
    now: () => FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });
  assert.equal(out.status, "DIAGNOSE_FAILED");
  assert.equal(countPacketFiles(fixture.dataDir), 0);
});

test("no packet when robots.txt is unavailable", async () => {
  const fixture = makeFixture();
  const out = await buildReviewPacketFromDiagnose({
    universityId: "test-university",
    sourceId: "test-press",
    catalogFile: fixture.catalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    dataDir: fixture.dataDir,
    runnerImpl: makeRunner(passingDiagnoseResult()),
    fetchImpl: robotsUnavailableFetch(),
    npmTestImpl: npmTestPass,
    now: () => FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });
  assert.equal(out.status, "DIAGNOSE_FAILED");
  assert.ok(out.evaluation.reasons.some((r) => r.includes("robots")));
  assert.equal(countPacketFiles(fixture.dataDir), 0);
});

test("no packet when acceptedCount is below the minimum", async () => {
  const fixture = makeFixture();
  const result = { ...passingDiagnoseResult(), acceptedCount: 1 };
  const out = await buildReviewPacketFromDiagnose({
    universityId: "test-university",
    sourceId: "test-press",
    catalogFile: fixture.catalogFile,
    storeFile: fixture.storeFile,
    previewFile: fixture.previewFile,
    dataDir: fixture.dataDir,
    runnerImpl: makeRunner(result),
    fetchImpl: robotsOkFetch(),
    npmTestImpl: npmTestPass,
    now: () => FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });
  assert.equal(out.status, "DIAGNOSE_FAILED");
  assert.equal(countPacketFiles(fixture.dataDir), 0);
});

test("buildReviewPacket rejects (throws) and writes no packet when npm test reports fail > 0", async () => {
  const fixture = makeFixture();
  await assert.rejects(
    () =>
      buildReviewPacketFromDiagnose({
        universityId: "test-university",
        sourceId: "test-press",
        catalogFile: fixture.catalogFile,
        storeFile: fixture.storeFile,
        previewFile: fixture.previewFile,
        dataDir: fixture.dataDir,
        runnerImpl: makeRunner(passingDiagnoseResult()),
        fetchImpl: robotsOkFetch(),
        npmTestImpl: npmTestFail,
        now: () => FIXED_NOW,
        randomBytesImpl: FIXED_RANDOM_BYTES,
      }),
    /fail/i
  );
  assert.equal(countPacketFiles(fixture.dataDir), 0);
});

// ---------------------------------------------------------------------------
// B1 -> B2 demo (spec 완료 기준 2)
// ---------------------------------------------------------------------------

test("B1 -> B2 demo: candidate -> prepare -> diagnose passes -> review packet created", async () => {
  const filesDir = makeTempDir("b1b2-files-");
  const dataDir = makeTempDir("b1b2-data-");
  const catalogFile = path.join(filesDir, "catalog.json");
  const candidateFile = path.join(filesDir, "candidates.json");
  const prepareLogFile = path.join(dataDir, "catalog-prepare-log.json");
  const storeFile = path.join(filesDir, "store.json");
  const previewFile = path.join(filesDir, "preview.json");

  fs.writeFileSync(
    catalogFile,
    `${JSON.stringify(
      {
        universities: [
          {
            universityId: "test-university",
            universityGroupId: "test-university-group",
            universityName: "테스트대학교",
            enabled: true,
            sources: [],
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    candidateFile,
    `${JSON.stringify(
      {
        items: [
          {
            universityId: "test-university",
            universityName: "테스트대학교",
            universityGroupId: "test-university-group",
            finalDecision: "COLLECTOR_CONFIG_READY",
            source: sourceBlock({ status: "collector_config_candidate" }),
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(storeFile, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, "utf8");
  fs.writeFileSync(previewFile, `${JSON.stringify({ items: [] }, null, 2)}\n`, "utf8");

  const prepared = prepareCatalogSourceBlock({
    universityId: "test-university",
    sourceId: "test-press",
    candidateFile,
    catalogFile,
    prepareLogFile,
    now: () => FIXED_NOW,
  });
  assert.equal(prepared.status, "PREPARED");

  const out = await buildReviewPacketFromDiagnose({
    universityId: "test-university",
    sourceId: "test-press",
    catalogFile,
    storeFile,
    previewFile,
    dataDir,
    runnerImpl: makeRunner(passingDiagnoseResult()),
    fetchImpl: robotsOkFetch(),
    npmTestImpl: npmTestPass,
    now: () => FIXED_NOW,
    randomBytesImpl: FIXED_RANDOM_BYTES,
  });

  assert.equal(out.status, "PACKET_CREATED");
  const packet = JSON.parse(fs.readFileSync(out.writtenPath, "utf8"));
  assert.equal(computePacketSha256(packet), packet.packetSha256);
  assert.equal(Object.values(packet.mutation).every((v) => v === false), true);
  assert.match(packet.regressionEvidence.npmTestSummary, /fail 0/);
  assert.equal(packet.scope.universityId, "test-university");
  assert.equal(packet.sourceSnapshot.enabled, false);
});
