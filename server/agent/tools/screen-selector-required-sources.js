"use strict";

// Read-only screening tool for `status: "selector_required"` sources in
// development/university-news/data/university-news-sources.final.json.
//
// It never flips `enabled`, never collects/saves news items, never
// generates a preview, and never deploys or runs git commands. The default
// run only prints to the console. The only optional side effect is
// `--write-report=<path>`, and even that is guarded by
// assertNotProtectedWritePath() so it can never overwrite the source
// catalog, the news store, or the preview file (see the guarded write
// calls fenced by the --write-report-guard markers below).

const fs = require("fs");
const path = require("path");

const { parseRobotsGroups } = require("../screening/robots-group-parser");
const { evaluateRobotsPolicy } = require("../screening/ai-bot-policy");
const { classifyAccessibility } = require("../screening/list-url-accessibility");
const { detectJsOnlyLinkRisk, detectSpaRisk, detectNonKoreanBoardFlag } = require("../screening/link-risk-heuristics");
const { classifySource } = require("../screening/classify-selector-required-source");

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE_FILE = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const PROTECTED_WRITE_PATHS = [
  SOURCE_FILE,
  path.join(ROOT, "server", "agent", "data", "agent-news-store.json"),
  path.join(ROOT, "data", "university-news-preview.json"),
];
const USER_AGENT = "UNI-PICK-Selector-Required-Screening/0.1 (read-only)";
const DEFAULT_TIMEOUT_MS = 15000;

function extractSelectorRequiredCandidates(catalog) {
  const universities = (catalog && catalog.universities) || [];
  const candidates = [];
  for (const university of universities) {
    for (const source of university.sources || []) {
      if (source.status === "selector_required") {
        candidates.push({
          universityId: university.universityId,
          universityName: university.universityName,
          sourceId: source.id,
          source,
        });
      }
    }
  }
  return candidates;
}

// Guards every path this tool is ever allowed to write to. Throws if the
// resolved target is one of the protected operational files or anything
// nested under one (defensive -- these are files today, but the check also
// rejects a hypothetical subpath).
function assertNotProtectedWritePath(targetPath) {
  const resolved = path.resolve(String(targetPath || ""));
  for (const protectedPath of PROTECTED_WRITE_PATHS) {
    if (resolved === protectedPath || resolved.startsWith(`${protectedPath}${path.sep}`)) {
      throw new Error(`Refusing to write to a protected operational path: ${resolved}`);
    }
  }
}

async function fetchOnce(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,*/*" },
    });
    const body = await response.text();
    return { status: response.status, finalUrl: response.url || url, body, error: null };
  } catch (error) {
    return { status: null, finalUrl: url, body: "", error };
  } finally {
    clearTimeout(timer);
  }
}

function originOf(urlString) {
  try {
    return new URL(urlString).origin;
  } catch {
    return "";
  }
}

const NO_ROBOTS_POLICY = { blocked: false, blockedGroups: [], softBlocked: false, softBlockedGroups: [], informationalOnlyGroups: [] };

// Classifies a robots.txt fetch attempt into one of three states:
//  - checked: true            -> robots.txt was fetched and parsed; policy reflects its actual rules.
//  - checked: false, unavailable: false -> robots.txt does not exist (404); existing policy treats this as "no restriction".
//  - checked: false, unavailable: true  -> robots.txt could not be verified (403/429/5xx/network error/
//    timeout/TLS error/empty body). This must never be treated as "no restriction" -- classifySource()
//    turns it into a HOLD (ROBOTS_UNAVAILABLE) instead of silently letting the source reach READY.
function classifyRobotsFetchResult(result) {
  const category = classifyAccessibility({
    status: result.status,
    finalUrl: result.finalUrl,
    error: result.error,
    bodySample: result.body,
  });

  if (category === "NOT_FOUND_404") {
    return { checked: false, unavailable: false, reasonCode: "ROBOTS_NOT_FOUND", policy: NO_ROBOTS_POLICY };
  }

  if (category === "OK_200" && String(result.body || "").trim()) {
    return { checked: true, unavailable: false, policy: evaluateRobotsPolicy(parseRobotsGroups(result.body)) };
  }

  const reason = category === "OK_200" ? "robots.txt 응답 본문이 비어 있습니다" : `robots.txt 요청이 실패했습니다(${category})`;
  return {
    checked: false,
    unavailable: true,
    reasonCode: "ROBOTS_UNAVAILABLE",
    unavailableReason: `${reason}. 정책을 확인할 수 없어 "제한 없음"으로 단정하지 않고 HOLD로 처리합니다.`,
    policy: NO_ROBOTS_POLICY,
  };
}

async function getRobotsEvidence(origin, fetchImpl, timeoutMs, cache) {
  if (!origin) {
    return {
      checked: false,
      unavailable: true,
      reasonCode: "ROBOTS_UNAVAILABLE",
      unavailableReason: "listUrl에서 유효한 origin을 확인할 수 없어 robots.txt를 조회하지 못했습니다.",
      policy: NO_ROBOTS_POLICY,
    };
  }
  if (cache.has(origin)) return cache.get(origin);
  const result = await fetchOnce(`${origin}/robots.txt`, fetchImpl, timeoutMs);
  const evidence = classifyRobotsFetchResult(result);
  cache.set(origin, evidence);
  return evidence;
}

// A source already `enabled: true` is not a new-onboarding candidate --
// screening it (and spending a robots.txt/listUrl request on it) would be
// pointless. This check runs before any network access, so an
// already-enabled source never triggers a fetch.
function alreadyEnabledResult(candidate) {
  const source = candidate.source || {};
  return {
    universityId: candidate.universityId,
    universityName: candidate.universityName,
    sourceId: candidate.sourceId,
    listUrl: source.listUrl || source.rssUrl || "",
    verdict: "ALREADY_ENABLED",
    reasons: ["이미 enabled=true로 활성화된 소스이므로 신규 온보딩 스크리닝 대상에서 제외합니다(네트워크 요청 없음)."],
    flags: { robotsChecked: false, robotsUnavailable: false, aiBotSoftBlocked: false, nonKoreanBoard: false },
    evidenceSummary: null,
  };
}

async function screenCandidate(candidate, { fetchImpl, timeoutMs, robotsCache }) {
  const source = candidate.source || {};
  if (source.enabled === true) return alreadyEnabledResult(candidate);

  const listUrl = source.listUrl || source.rssUrl || "";
  const originalOrigin = originOf(listUrl);

  const listResult = listUrl
    ? await fetchOnce(listUrl, fetchImpl, timeoutMs)
    : { status: null, finalUrl: listUrl, body: "", error: new Error("Source has no listUrl/rssUrl to check.") };

  // robots.txt is always re-checked against the final response origin, in
  // case a redirect moved the listUrl to a different domain.
  const finalOrigin = originOf(listResult.finalUrl) || originalOrigin;
  const robots = await getRobotsEvidence(finalOrigin, fetchImpl, timeoutMs, robotsCache);

  const accessibility = classifyAccessibility({
    status: listResult.status,
    finalUrl: listResult.finalUrl,
    error: listResult.error,
    bodySample: listResult.body,
  });
  const jsOnlyLinkRisk = detectJsOnlyLinkRisk(listResult.body);
  const spaRisk = detectSpaRisk(listResult.body);
  const nonKoreanBoard = detectNonKoreanBoardFlag({ listUrl, html: listResult.body });

  const classification = classifySource({ robots, accessibility, jsOnlyLinkRisk, spaRisk, nonKoreanBoard });

  return {
    universityId: candidate.universityId,
    universityName: candidate.universityName,
    sourceId: candidate.sourceId,
    listUrl,
    verdict: classification.verdict,
    reasons: classification.reasons,
    flags: classification.flags,
    evidenceSummary: {
      robotsChecked: robots.checked,
      robotsUnavailable: Boolean(robots.unavailable),
      robotsReasonCode: robots.reasonCode || null,
      accessibility,
      jsOnlyLinkRiskDetected: jsOnlyLinkRisk.detected,
      spaRiskDetected: spaRisk.detected,
      nonKoreanBoardDetected: nonKoreanBoard.detected,
    },
  };
}

async function runScreening(options = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : undefined,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    readFileImpl = fs.readFileSync,
    catalog: providedCatalog,
  } = options;
  if (!fetchImpl) throw new Error("A fetch implementation is required (global fetch was not found; pass options.fetchImpl).");

  const catalog = providedCatalog || JSON.parse(readFileImpl(SOURCE_FILE, "utf8"));
  const candidates = extractSelectorRequiredCandidates(catalog);
  const robotsCache = new Map();
  const results = [];
  for (const candidate of candidates) {
    // Sequential by design: this is a light, read-only screening pass, not
    // a bulk collector, and sequential requests keep host load minimal.
    // eslint-disable-next-line no-await-in-loop
    results.push(await screenCandidate(candidate, { fetchImpl, timeoutMs, robotsCache }));
  }

  // Already-enabled sources are excluded from the READY/HOLD/BLOCKED stats
  // and recommendation list -- they are not new-onboarding candidates. They
  // still appear in `results` (verdict: "ALREADY_ENABLED") for transparency.
  const summary = {
    total: results.length,
    ready: results.filter((result) => result.verdict === "READY").length,
    hold: results.filter((result) => result.verdict === "HOLD").length,
    blocked: results.filter((result) => result.verdict === "BLOCKED").length,
    alreadyEnabled: results.filter((result) => result.verdict === "ALREADY_ENABLED").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_FILE,
    summary,
    results,
    // Explicitly documents what this run never touched, in the same spirit
    // as run-general-university-feed-test10.js's mutation flags.
    mutation: { enabled: false, verified: false, status: false, store: false, preview: false, git: false, deploy: false },
  };
}

// --write-report-guard:start
// Every fs write in this file lives inside this guarded block, and only
// runs when the caller explicitly passes --write-report=<path>. It is
// unreachable from the default (console-only) execution path.
function writeReportIfRequested(report, writeReportPath) {
  if (!writeReportPath) return null;
  assertNotProtectedWritePath(writeReportPath);
  const resolved = path.resolve(writeReportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolved;
}
// --write-report-guard:end

function parseArgs(argv) {
  const options = { writeReportPath: null };
  for (const arg of argv) {
    if (arg.startsWith("--write-report=")) options.writeReportPath = arg.slice("--write-report=".length);
  }
  return options;
}

function printConsoleReport(report) {
  console.log(
    `[selector-required screening] total=${report.summary.total} READY=${report.summary.ready} HOLD=${report.summary.hold} BLOCKED=${report.summary.blocked} ALREADY_ENABLED=${report.summary.alreadyEnabled}`
  );
  for (const result of report.results) {
    console.log(`\n- ${result.universityId} / ${result.sourceId}: ${result.verdict}`);
    for (const reason of result.reasons) console.log(`    ${reason}`);
  }
  console.log("\n[selector-required screening] full JSON report:");
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runScreening({});
  printConsoleReport(report);
  const writtenPath = writeReportIfRequested(report, options.writeReportPath);
  if (writtenPath) console.log(`\n[selector-required screening] report written to: ${writtenPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[screen-selector-required-sources]", error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  SOURCE_FILE,
  PROTECTED_WRITE_PATHS,
  extractSelectorRequiredCandidates,
  assertNotProtectedWritePath,
  classifyRobotsFetchResult,
  screenCandidate,
  runScreening,
  writeReportIfRequested,
  parseArgs,
};
