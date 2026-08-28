"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  normalizeCandidateSourceBlock,
  insertSourceBlock,
  prepareCatalogSourceBlock,
  parseCliArgs,
} = require("./prepare-catalog-source-block");
const { selectSource } = require("../../tools/run-single-school-trial");

const FIXED_NOW = new Date("2026-08-28T09:15:00.000Z");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function candidateBlock(universityId, sourceId) {
  return {
    universityId,
    universityName: "테스트대학교",
    universityGroupId: universityId,
    finalDecision: "COLLECTOR_CONFIG_READY",
    source: {
      id: sourceId,
      name: "테스트대학교 보도자료",
      category: "school_news",
      categoryLabel: "학교 소식",
      sourceType: "official",
      collectionType: "html",
      listUrl: "https://news.example.ac.kr/press",
      selectors: { item: "tbody tr", title: "td a", link: "td a", date: "td" },
      detailSelectors: { title: "h2", date: "span.date" },
      verified: false,
      enabled: false,
      status: "collector_config_candidate",
      healthStatus: "unknown",
    },
  };
}

function makeFixture({ withUniversityBlock = true, withExistingSource = false } = {}) {
  const filesDir = makeTempDir("b1-files-");
  const dataDir = makeTempDir("b1-data-");
  const catalogFile = path.join(filesDir, "catalog.json");
  const candidateFile = path.join(filesDir, "candidates.json");
  const prepareLogFile = path.join(dataDir, "catalog-prepare-log.json");

  const targetUniversity = {
    universityId: "test-university",
    universityGroupId: "test-university",
    universityName: "테스트대학교",
    enabled: true,
    sources: withExistingSource
      ? [{ id: "test-press", sourceType: "official", collectionType: "html", verified: false, enabled: false, status: "selector_required" }]
      : [],
  };
  const universities = [
    {
      universityId: "unrelated-university",
      universityGroupId: "unrelated-university",
      universityName: "무관한대학교",
      enabled: true,
      sources: [{ id: "unrelated-source", sourceType: "official", collectionType: "rss", rssUrl: "https://x.ac.kr/rss", verified: true, enabled: true, status: "verified" }],
    },
  ];
  if (withUniversityBlock) universities.unshift(targetUniversity);

  fs.writeFileSync(catalogFile, `${JSON.stringify({ universities }, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    candidateFile,
    `${JSON.stringify({ items: [candidateBlock("test-university", "test-press")] }, null, 2)}\n`,
    "utf8"
  );

  return { filesDir, dataDir, catalogFile, candidateFile, prepareLogFile };
}

test("normalizeCandidateSourceBlock forces verified:false, enabled:false, status:selector_required", () => {
  const block = normalizeCandidateSourceBlock(candidateBlock("u", "s"));
  assert.equal(block.verified, false);
  assert.equal(block.enabled, false);
  assert.equal(block.status, "selector_required");
  assert.equal(block.healthStatus, "unknown");
  assert.equal(block.id, "s");
  assert.equal(block.collectionType, "html");
});

test("insertSourceBlock throws when the university block is not in the catalog (does not create it)", () => {
  const catalog = { universities: [{ universityId: "other", sources: [] }] };
  assert.throws(
    () => insertSourceBlock(catalog, { universityId: "missing", sourceId: "s" }, { id: "s" }),
    /university block not found/
  );
});

test("insertSourceBlock throws on a duplicate sourceId (append-only)", () => {
  const catalog = { universities: [{ universityId: "u", sources: [{ id: "s", enabled: false }] }] };
  assert.throws(() => insertSourceBlock(catalog, { universityId: "u", sourceId: "s" }, { id: "s" }), /already exists/);
});

test("insertSourceBlock only pushes to university.sources and leaves other universities byte-identical", () => {
  const catalog = {
    universities: [
      { universityId: "u", universityName: "U", sources: [] },
      { universityId: "v", universityName: "V", sources: [{ id: "v1", enabled: true }] },
    ],
  };
  const before = JSON.stringify(catalog.universities[1]);
  const next = insertSourceBlock(catalog, { universityId: "u", sourceId: "s" }, { id: "s", enabled: false });
  assert.equal(next.universities[0].sources.length, 1);
  assert.equal(next.universities[0].sources[0].id, "s");
  assert.equal(JSON.stringify(next.universities[1]), before);
  // original object not mutated
  assert.equal(catalog.universities[0].sources.length, 0);
});

test("prepareCatalogSourceBlock inserts a disabled source block and leaves unrelated universities unchanged", () => {
  const fixture = makeFixture();
  const unrelatedBefore = JSON.stringify(
    JSON.parse(fs.readFileSync(fixture.catalogFile, "utf8")).universities.find((u) => u.universityId === "unrelated-university")
  );

  const result = prepareCatalogSourceBlock({
    universityId: "test-university",
    sourceId: "test-press",
    candidateFile: fixture.candidateFile,
    catalogFile: fixture.catalogFile,
    prepareLogFile: fixture.prepareLogFile,
    now: () => FIXED_NOW,
  });

  assert.equal(result.status, "PREPARED");
  assert.deepEqual(result.mutation, { enabled: false, verified: false, status: false, store: false, preview: false, git: false, deploy: false });

  const catalog = JSON.parse(fs.readFileSync(fixture.catalogFile, "utf8"));
  const target = catalog.universities.find((u) => u.universityId === "test-university");
  const inserted = target.sources.find((s) => s.id === "test-press");
  assert.ok(inserted);
  assert.equal(inserted.enabled, false);
  assert.equal(inserted.verified, false);
  assert.equal(inserted.status, "selector_required");

  const unrelatedAfter = JSON.stringify(catalog.universities.find((u) => u.universityId === "unrelated-university"));
  assert.equal(unrelatedAfter, unrelatedBefore);

  // backup exists and is valid JSON
  assert.ok(fs.existsSync(result.catalogBackupPath));
  JSON.parse(fs.readFileSync(result.catalogBackupPath, "utf8"));

  // audit log appended
  const log = JSON.parse(fs.readFileSync(fixture.prepareLogFile, "utf8"));
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].sourceId, "test-press");
  assert.equal(log.entries[0].checksumBefore, result.checksumBefore);
  assert.equal(log.entries[0].checksumAfter, result.checksumAfter);
});

test("prepareCatalogSourceBlock: the inserted block qualifies for run-single-school-trial selectSource with --allow-unverified-diagnose", () => {
  const fixture = makeFixture();
  prepareCatalogSourceBlock({
    universityId: "test-university",
    sourceId: "test-press",
    candidateFile: fixture.candidateFile,
    catalogFile: fixture.catalogFile,
    prepareLogFile: fixture.prepareLogFile,
    now: () => FIXED_NOW,
  });
  const catalog = JSON.parse(fs.readFileSync(fixture.catalogFile, "utf8"));
  const university = catalog.universities.find((u) => u.universityId === "test-university");

  // without the flag: rejected because verified !== true
  assert.throws(() => selectSource(university, "test-press"), /No verified official/);
  // with the flag: accepted
  const picked = selectSource(university, "test-press", { allowUnverifiedForDiagnose: true });
  assert.equal(picked.id, "test-press");
});

test("prepareCatalogSourceBlock --dry-run does not touch the catalog file (mtime + content unchanged)", () => {
  const fixture = makeFixture();
  const before = fs.readFileSync(fixture.catalogFile, "utf8");
  const beforeMtime = fs.statSync(fixture.catalogFile).mtimeMs;

  const result = prepareCatalogSourceBlock({
    universityId: "test-university",
    sourceId: "test-press",
    candidateFile: fixture.candidateFile,
    catalogFile: fixture.catalogFile,
    prepareLogFile: fixture.prepareLogFile,
    dryRun: true,
    now: () => FIXED_NOW,
  });

  assert.equal(result.status, "DRY_RUN");
  assert.equal(fs.readFileSync(fixture.catalogFile, "utf8"), before);
  assert.equal(fs.statSync(fixture.catalogFile).mtimeMs, beforeMtime);
  assert.equal(fs.existsSync(fixture.prepareLogFile), false);
});

test("prepareCatalogSourceBlock throws when the university block is missing (exit-1 path), catalog untouched", () => {
  const fixture = makeFixture({ withUniversityBlock: false });
  const before = fs.readFileSync(fixture.catalogFile, "utf8");
  assert.throws(
    () =>
      prepareCatalogSourceBlock({
        universityId: "test-university",
        sourceId: "test-press",
        candidateFile: fixture.candidateFile,
        catalogFile: fixture.catalogFile,
        prepareLogFile: fixture.prepareLogFile,
        now: () => FIXED_NOW,
      }),
    /university block not found/
  );
  assert.equal(fs.readFileSync(fixture.catalogFile, "utf8"), before);
});

test("prepareCatalogSourceBlock throws when the sourceId already exists in the catalog", () => {
  const fixture = makeFixture({ withExistingSource: true });
  assert.throws(
    () =>
      prepareCatalogSourceBlock({
        universityId: "test-university",
        sourceId: "test-press",
        candidateFile: fixture.candidateFile,
        catalogFile: fixture.catalogFile,
        prepareLogFile: fixture.prepareLogFile,
        now: () => FIXED_NOW,
      }),
    /already exists/
  );
});

test("prepareCatalogSourceBlock rejects a candidate whose finalDecision is not COLLECTOR_CONFIG_READY", () => {
  const fixture = makeFixture();
  const candidates = JSON.parse(fs.readFileSync(fixture.candidateFile, "utf8"));
  candidates.items[0].finalDecision = "NEEDS_WORK";
  fs.writeFileSync(fixture.candidateFile, JSON.stringify(candidates, null, 2), "utf8");
  assert.throws(
    () =>
      prepareCatalogSourceBlock({
        universityId: "test-university",
        sourceId: "test-press",
        candidateFile: fixture.candidateFile,
        catalogFile: fixture.catalogFile,
        prepareLogFile: fixture.prepareLogFile,
        now: () => FIXED_NOW,
      }),
    /finalDecision/
  );
});

// before/after 텍스트가 "정확히 연속된 1개 라인 블록만 삽입"됐는지 단언한다.
// git 을 호출하지 않고 순수 라인 비교로 판정한다.
//
// 예외 1가지만 허용: 대상 대학의 sources 배열이 비어 있던 경우
// (`"sources": []`), JSON.stringify 특성상 그 컨테이너 라인 1줄은
// `"sources": [` 로 다시 써질 수밖에 없다. 이는 삽입 대상 배열 자체의
// 여는 라인이며 다른 대학/소스와 무관하므로 허용한다. 그 외의 삭제/치환은
// 전부 실패로 본다.
function assertSingleContiguousInsertion(beforeText, afterText, { mustInclude = [], mustNotInclude = [] } = {}) {
  const b = beforeText.split("\n");
  const a = afterText.split("\n");
  let p = 0;
  while (p < b.length && p < a.length && b[p] === a[p]) p += 1;
  let s = 0;
  while (s < b.length - p && s < a.length - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s += 1;

  const beforeUnmatched = b.slice(p, b.length - s);
  const insertedLines = a.slice(p, a.length - s);
  if (beforeUnmatched.length !== 0) {
    assert.equal(
      beforeUnmatched.length,
      1,
      `before 쪽에서 삭제/치환된 라인이 여러 개 있음 (연속 삽입이 아님): ${JSON.stringify(beforeUnmatched)}`
    );
    assert.match(
      beforeUnmatched[0],
      /^\s*"sources": \[\],?$/,
      `유일하게 바뀐 before 라인은 빈 sources 배열을 여는 컨테이너 라인이어야 함: ${JSON.stringify(beforeUnmatched[0])}`
    );
    assert.match(insertedLines[0], /^\s*"sources": \[$/, "빈 배열은 여는 라인만 바뀌어야 함");
  }
  const inserted = insertedLines.join("\n");
  for (const needle of mustInclude) assert.ok(inserted.includes(needle), `삽입 블록에 ${needle} 없음`);
  for (const needle of mustNotInclude) assert.ok(!inserted.includes(needle), `삽입 블록에 ${needle} 가 있으면 안 됨`);
  return inserted;
}

test("B1 on the normalized real catalog inserts knsu-press-release as one contiguous block (0 deletions, no other lines touched)", () => {
  const realCatalog = path.resolve(__dirname, "../../../../development/university-news/data/university-news-sources.final.json");
  const realCandidates = path.resolve(__dirname, "../data/collector-config-candidates.json");

  const catalog = JSON.parse(fs.readFileSync(realCatalog, "utf8"));
  const candItems = JSON.parse(fs.readFileSync(realCandidates, "utf8")).items || [];
  const cand = candItems.find((it) => it.source && it.source.id === "knsu-press-release");
  assert.ok(cand && cand.finalDecision === "COLLECTOR_CONFIG_READY", "knsu 후보가 READY 여야 함");

  const uni = catalog.universities.find((u) => u.universityId === cand.universityId);
  assert.ok(uni, "카탈로그에 한국체육대 대학 블록이 있어야 함");
  // 커밋 C(실제 삽입) 이후에도 테스트가 유효하도록, 있으면 제거하고 시작
  uni.sources = (uni.sources || []).filter((src) => src.id !== "knsu-press-release");

  const dir = makeTempDir("b1-knsu-");
  const catalogFile = path.join(dir, "catalog.json");
  const prepareLogFile = path.join(dir, "log.json");
  const beforeText = `${JSON.stringify(catalog, null, 2)}\n`;
  fs.writeFileSync(catalogFile, beforeText, "utf8");

  const result = prepareCatalogSourceBlock({
    universityId: cand.universityId, // exact string, 하드코딩 아님
    sourceId: "knsu-press-release",
    candidateFile: realCandidates,
    catalogFile,
    prepareLogFile,
    now: () => FIXED_NOW,
  });
  assert.equal(result.status, "PREPARED");

  const afterText = fs.readFileSync(catalogFile, "utf8");
  assertSingleContiguousInsertion(beforeText, afterText, {
    mustInclude: ['"id": "knsu-press-release"', '"status": "selector_required"', '"enabled": false', '"verified": false'],
    mustNotInclude: ['"universityId"'], // 대학 블록을 새로 만들지 않았음을 증명
  });

  const after = JSON.parse(afterText);
  const knsu = after.universities
    .find((u) => u.universityId === cand.universityId)
    .sources.filter((sourceEntry) => sourceEntry.id === "knsu-press-release");
  assert.equal(knsu.length, 1);
  assert.equal(knsu[0].enabled, false);
  assert.equal(knsu[0].verified, false);
  assert.equal(knsu[0].status, "selector_required");
  assert.equal(knsu[0].healthStatus, "unknown");
});

test("parseCliArgs requires --university-id and --source-id", () => {
  assert.throws(() => parseCliArgs([]), /--university-id/);
  assert.throws(() => parseCliArgs(["--university-id=u"]), /--source-id/);
  assert.deepEqual(parseCliArgs(["--university-id=u", "--source-id=s", "--dry-run"]), {
    universityId: "u",
    sourceId: "s",
    candidateFile: undefined,
    dryRun: true,
  });
});
