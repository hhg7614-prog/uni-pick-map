"use strict";

// Requiring this file must never trigger a real run (network fetch, or any
// write) -- main() only auto-runs when this file is executed directly via
// `node screen-selector-required-sources.js`, guarded by
// `require.main === module`.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const {
  SOURCE_FILE,
  PROTECTED_WRITE_PATHS,
  extractSelectorRequiredCandidates,
  assertNotProtectedWritePath,
  classifyRobotsFetchResult,
  screenCandidate,
  runScreening,
  writeReportIfRequested,
  parseArgs,
} = require("./screen-selector-required-sources");

const TOOL_FILE = path.join(__dirname, "screen-selector-required-sources.js");
const DEPENDENCY_FILES = [
  path.join(__dirname, "..", "screening", "robots-group-parser.js"),
  path.join(__dirname, "..", "screening", "ai-bot-policy.js"),
  path.join(__dirname, "..", "screening", "list-url-accessibility.js"),
  path.join(__dirname, "..", "screening", "link-risk-heuristics.js"),
  path.join(__dirname, "..", "screening", "classify-selector-required-source.js"),
];

const WRITE_API_PATTERN = /\b(writeFileSync|appendFileSync|renameSync|mkdirSync|copyFileSync|unlinkSync)\b/g;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Stub fetch: never touches the network. Every request (robots.txt or
// listUrl) resolves immediately with an empty 200 response so classifySource
// lands on READY without exercising any HOLD/BLOCKED branch -- the point of
// this test is to prove there is no filesystem mutation, not to re-test the
// classification rules (already covered by classify-selector-required-source.test.js).
function stubFetch(url) {
  return Promise.resolve({
    status: 200,
    url,
    text: async () => "<html><body>공지사항 목록</body></html>",
  });
}

test("extractSelectorRequiredCandidates only picks sources whose status field is exactly selector_required, regardless of whether selectors are already filled in", () => {
  const catalog = {
    universities: [
      {
        universityId: "example-university",
        universityName: "예시대학교",
        sources: [
          { id: "empty-selectors-required", status: "selector_required", selectors: {} },
          { id: "filled-selectors-still-required", status: "selector_required", selectors: { item: "li" }, enabled: true },
          { id: "already-active", status: "active", selectors: { item: "li" }, enabled: true },
        ],
      },
    ],
  };
  const candidates = extractSelectorRequiredCandidates(catalog);
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((candidate) => candidate.sourceId),
    ["empty-selectors-required", "filled-selectors-still-required"]
  );
});

test("assertNotProtectedWritePath throws for each protected operational file", () => {
  for (const protectedPath of PROTECTED_WRITE_PATHS) {
    assert.throws(() => assertNotProtectedWritePath(protectedPath), /protected operational path/);
  }
});

test("assertNotProtectedWritePath throws for a relative path pointing at the protected source catalog", () => {
  assert.throws(
    () => assertNotProtectedWritePath("development/university-news/data/university-news-sources.final.json"),
    /protected operational path/
  );
});

test("assertNotProtectedWritePath allows a path outside the protected set", () => {
  const scratchPath = path.join(os.tmpdir(), "uni-pick-screening-test-report.json");
  assert.doesNotThrow(() => assertNotProtectedWritePath(scratchPath));
});

test("--write-report against the protected source catalog throws and writes nothing", () => {
  const before = sha256(SOURCE_FILE);
  assert.throws(
    () => writeReportIfRequested({ ok: true }, SOURCE_FILE),
    /protected operational path/
  );
  const after = sha256(SOURCE_FILE);
  assert.equal(before, after, "the protected source catalog must be byte-for-byte unchanged");
});

test("writeReportIfRequested returns null and writes nothing when no path is given (default read-only mode)", () => {
  const result = writeReportIfRequested({ ok: true }, null);
  assert.equal(result, null);
});

test("writeReportIfRequested writes to an explicitly allowed scratch path and the JSON round-trips", () => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "uni-pick-screening-report-"));
  const scratchPath = path.join(scratchDir, "nested", "report.json");
  const report = { generatedAt: "2026-08-26T00:00:00.000Z", summary: { total: 0, ready: 0, hold: 0, blocked: 0 }, results: [] };
  const written = writeReportIfRequested(report, scratchPath);
  assert.equal(written, path.resolve(scratchPath));
  const roundTripped = JSON.parse(fs.readFileSync(scratchPath, "utf8"));
  assert.deepEqual(roundTripped, report);
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

test("parseArgs recognizes --write-report=<path> and defaults to null otherwise", () => {
  assert.equal(parseArgs([]).writeReportPath, null);
  assert.equal(parseArgs(["--write-report=./out/report.json"]).writeReportPath, "./out/report.json");
});

test("static check: writeFileSync/appendFileSync/renameSync/mkdirSync/copyFileSync/unlinkSync only appear inside the --write-report-guard block", () => {
  const source = fs.readFileSync(TOOL_FILE, "utf8");
  const startMarker = "--write-report-guard:start";
  const endMarker = "--write-report-guard:end";
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  assert.ok(startIndex !== -1 && endIndex !== -1 && endIndex > startIndex, "guard markers must be present and well-ordered");

  const outsideGuard = source.slice(0, startIndex) + source.slice(endIndex + endMarker.length);
  const matchesOutsideGuard = outsideGuard.match(WRITE_API_PATTERN) || [];
  assert.deepEqual(matchesOutsideGuard, [], `write API identifiers found outside the --write-report guard: ${matchesOutsideGuard.join(", ")}`);

  const insideGuard = source.slice(startIndex, endIndex);
  const matchesInsideGuard = insideGuard.match(WRITE_API_PATTERN) || [];
  assert.ok(matchesInsideGuard.length > 0, "expected the guard block to actually contain the guarded write calls");
});

test("static check: none of the pure screening modules require fs or path", () => {
  for (const file of DEPENDENCY_FILES) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /require\(\s*["']fs["']\s*\)/, `${file} must not require "fs"`);
    assert.doesNotMatch(source, /require\(\s*["']path["']\s*\)/, `${file} must not require "path"`);
  }
});

test("running the full orchestration against the real source catalog (network stubbed) never changes the catalog's checksum", async () => {
  const before = sha256(SOURCE_FILE);
  const report = await runScreening({ fetchImpl: stubFetch });
  const after = sha256(SOURCE_FILE);
  assert.equal(before, after, "university-news-sources.final.json must be byte-for-byte unchanged after a screening run");
  assert.equal(report.summary.total, report.results.length);
  assert.ok(report.summary.total > 0, "expected at least one selector_required candidate in the real catalog");
  assert.deepEqual(report.mutation, { enabled: false, verified: false, status: false, store: false, preview: false, git: false, deploy: false });
});

test("runScreening never mutates the in-memory catalog object it was given (defensive: no accidental enabled/status writes)", async () => {
  const catalog = {
    universities: [
      {
        universityId: "example-university",
        universityName: "예시대학교",
        sources: [{ id: "example-source", status: "selector_required", listUrl: "https://example.ac.kr/board/list.do", enabled: false, verified: true }],
      },
    ],
  };
  const before = JSON.stringify(catalog);
  await runScreening({ fetchImpl: stubFetch, catalog });
  const after = JSON.stringify(catalog);
  assert.equal(before, after);
});

test("classifyRobotsFetchResult treats 404 as 'no restriction found' (unchanged existing behavior)", () => {
  const result = classifyRobotsFetchResult({ status: 404, finalUrl: "https://example.ac.kr/robots.txt", body: "", error: null });
  assert.equal(result.checked, false);
  assert.equal(result.unavailable, false);
  assert.equal(result.reasonCode, "ROBOTS_NOT_FOUND");
});

test("classifyRobotsFetchResult treats 403/429/5xx as ROBOTS_UNAVAILABLE, never as 'no restriction'", () => {
  for (const status of [403, 429, 500, 503]) {
    const result = classifyRobotsFetchResult({ status, finalUrl: "https://example.ac.kr/robots.txt", body: "Forbidden", error: null });
    assert.equal(result.checked, false, `status ${status}`);
    assert.equal(result.unavailable, true, `status ${status} must be unavailable, not 'no restriction'`);
    assert.equal(result.reasonCode, "ROBOTS_UNAVAILABLE");
  }
});

test("classifyRobotsFetchResult treats a network error or timeout fetching robots.txt as ROBOTS_UNAVAILABLE", () => {
  const networkError = classifyRobotsFetchResult({ status: null, finalUrl: "https://example.ac.kr/robots.txt", body: "", error: new Error("fetch failed") });
  assert.equal(networkError.unavailable, true);
  assert.equal(networkError.reasonCode, "ROBOTS_UNAVAILABLE");

  const timeoutError = classifyRobotsFetchResult({
    status: null,
    finalUrl: "https://example.ac.kr/robots.txt",
    body: "",
    error: Object.assign(new Error("aborted"), { name: "AbortError" }),
  });
  assert.equal(timeoutError.unavailable, true);
  assert.equal(timeoutError.reasonCode, "ROBOTS_UNAVAILABLE");
});

test("classifyRobotsFetchResult treats an empty 200 response body as ROBOTS_UNAVAILABLE, not as an open robots.txt", () => {
  const result = classifyRobotsFetchResult({ status: 200, finalUrl: "https://example.ac.kr/robots.txt", body: "   ", error: null });
  assert.equal(result.checked, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.reasonCode, "ROBOTS_UNAVAILABLE");
});

test("classifyRobotsFetchResult parses a non-empty 200 response normally (checked: true, not flagged unavailable)", () => {
  const result = classifyRobotsFetchResult({ status: 200, finalUrl: "https://example.ac.kr/robots.txt", body: "User-agent: *\nDisallow:\n", error: null });
  assert.equal(result.checked, true);
  assert.equal(result.unavailable, false);
  assert.equal(result.policy.blocked, false);
});

test("screenCandidate: robots.txt 403 with an otherwise-clean listUrl must land on HOLD (ROBOTS_UNAVAILABLE), not READY", async () => {
  const candidate = {
    universityId: "example-university",
    universityName: "예시대학교",
    sourceId: "example-source",
    source: { listUrl: "https://example.ac.kr/board/list.do" },
  };
  const fetchImpl = (url) => {
    if (String(url).endsWith("/robots.txt")) return Promise.resolve({ status: 403, url, text: async () => "Forbidden" });
    return Promise.resolve({ status: 200, url, text: async () => "<html><body>공지사항 목록</body></html>" });
  };
  const result = await screenCandidate(candidate, { fetchImpl, timeoutMs: 5000, robotsCache: new Map() });
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.evidenceSummary.robotsUnavailable, true);
  assert.equal(result.evidenceSummary.robotsReasonCode, "ROBOTS_UNAVAILABLE");
  assert.ok(result.reasons.some((reason) => reason.includes("ROBOTS_UNAVAILABLE")));
});

test("screenCandidate: robots.txt Disallow: / for Applebot-Extended only (not our AI policy's trigger bots) lands on HOLD, not BLOCKED", async () => {
  const candidate = {
    universityId: "korea-aerospace-university",
    universityName: "한국항공대학교",
    sourceId: "kau-channel-k-campus-news",
    source: { listUrl: "https://www.kau.ac.kr/kau/board/list.do" },
  };
  const fetchImpl = (url) => {
    if (String(url).endsWith("/robots.txt")) return Promise.resolve({ status: 200, url, text: async () => "User-agent: Applebot-Extended\nDisallow: /\n" });
    return Promise.resolve({ status: 200, url, text: async () => "<html><body>공지사항 목록</body></html>" });
  };
  const result = await screenCandidate(candidate, { fetchImpl, timeoutMs: 5000, robotsCache: new Map() });
  assert.equal(result.verdict, "HOLD");
  assert.notEqual(result.verdict, "BLOCKED");
  assert.equal(result.flags.aiBotSoftBlocked, true);
});

test("screenCandidate: robots.txt Disallow: / for ClaudeBot stays BLOCKED", async () => {
  const candidate = {
    universityId: "chungnam-national-university",
    universityName: "충남대학교",
    sourceId: "cnu-official-news",
    source: { listUrl: "https://www.cnu.ac.kr/board/list.do" },
  };
  const fetchImpl = (url) => {
    if (String(url).endsWith("/robots.txt")) return Promise.resolve({ status: 200, url, text: async () => "User-agent: ClaudeBot\nDisallow: /\n" });
    return Promise.resolve({ status: 200, url, text: async () => "<html><body>공지사항 목록</body></html>" });
  };
  const result = await screenCandidate(candidate, { fetchImpl, timeoutMs: 5000, robotsCache: new Map() });
  assert.equal(result.verdict, "BLOCKED");
});

test("screenCandidate: robots.txt 404 with an otherwise-clean listUrl still reaches READY (regression: 404 stays 'no restriction')", async () => {
  const candidate = {
    universityId: "example-university",
    universityName: "예시대학교",
    sourceId: "example-source",
    source: { listUrl: "https://example.ac.kr/board/list.do" },
  };
  const fetchImpl = (url) => {
    if (String(url).endsWith("/robots.txt")) return Promise.resolve({ status: 404, url, text: async () => "" });
    return Promise.resolve({ status: 200, url, text: async () => "<html><body>공지사항 목록</body></html>" });
  };
  const result = await screenCandidate(candidate, { fetchImpl, timeoutMs: 5000, robotsCache: new Map() });
  assert.equal(result.verdict, "READY");
  assert.equal(result.evidenceSummary.robotsChecked, false);
  assert.equal(result.evidenceSummary.robotsUnavailable, false);
});

test("screenCandidate: a source with enabled: true is classified ALREADY_ENABLED without making any network request", async () => {
  const candidate = {
    universityId: "gachon-university-global",
    universityName: "가천대학교 글로벌캠퍼스",
    sourceId: "gachon-global-campus-news",
    source: { listUrl: "https://global.gachon.ac.kr/news", enabled: true, status: "selector_required" },
  };
  let fetchCalls = 0;
  const fetchImpl = () => {
    fetchCalls += 1;
    return stubFetch("https://global.gachon.ac.kr/robots.txt");
  };
  const result = await screenCandidate(candidate, { fetchImpl, timeoutMs: 5000, robotsCache: new Map() });
  assert.equal(result.verdict, "ALREADY_ENABLED");
  assert.equal(fetchCalls, 0, "an already-enabled source must never trigger a robots.txt/listUrl fetch");
  assert.equal(result.evidenceSummary, null);
});

test("runScreening excludes ALREADY_ENABLED sources from the ready/hold/blocked stats and counts them separately", async () => {
  const catalog = {
    universities: [
      {
        universityId: "example-university",
        universityName: "예시대학교",
        sources: [
          { id: "already-active", status: "selector_required", listUrl: "https://example.ac.kr/board/active.do", enabled: true },
          { id: "needs-screening", status: "selector_required", listUrl: "https://example.ac.kr/board/new.do", enabled: false },
        ],
      },
    ],
  };
  let fetchCalls = 0;
  const fetchImpl = (url) => {
    fetchCalls += 1;
    return stubFetch(url);
  };
  const report = await runScreening({ fetchImpl, catalog });
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.alreadyEnabled, 1);
  assert.equal(report.summary.ready + report.summary.hold + report.summary.blocked, 1, "the already-enabled source must not be counted in ready/hold/blocked");
  const alreadyEnabled = report.results.find((r) => r.sourceId === "already-active");
  assert.equal(alreadyEnabled.verdict, "ALREADY_ENABLED");
  const screened = report.results.find((r) => r.sourceId === "needs-screening");
  assert.equal(screened.verdict, "READY");
  // Only the non-enabled source's robots.txt + listUrl should have been fetched.
  assert.equal(fetchCalls, 2);
});

test("runScreening caches robots.txt per origin instead of refetching it for every source on the same host", async () => {
  const requestedUrls = [];
  const cachingFetch = (url) => {
    requestedUrls.push(url);
    return stubFetch(url);
  };
  const catalog = {
    universities: [
      {
        universityId: "same-host-university",
        universityName: "동일호스트대학교",
        sources: [
          { id: "notice", status: "selector_required", listUrl: "https://example.ac.kr/board/notice.do" },
          { id: "news", status: "selector_required", listUrl: "https://example.ac.kr/board/news.do" },
        ],
      },
    ],
  };
  await runScreening({ fetchImpl: cachingFetch, catalog });
  const robotsRequests = requestedUrls.filter((url) => url.endsWith("/robots.txt"));
  assert.equal(robotsRequests.length, 1, "robots.txt for the same origin should be fetched only once");
});
