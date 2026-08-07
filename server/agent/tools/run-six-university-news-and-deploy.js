"use strict";

// Windows Task Scheduler entry point for the six explicitly validated universities.
// It never enables the in-process scheduler and only stages generated news data.

const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const { getAgentConfig } = require("../config");
const { PUBLIC_REPORT_PATH, buildCollectionReport, writePublicCollectionReport } = require("../collection-report");

const ROOT = path.resolve(__dirname, "../../..");
const SIX_UNIVERSITY_IDS = [
  "seoul-national-university-gwanak",
  "yonsei-university-sinchon",
  "korea-university-seoul",
  "hanyang-university-seoul",
  "ewha-womans-university",
  "dongguk-university-seoul",
];
const GENERATED_NEWS_FILES = [
  "server/agent/data/agent-news-store.json",
  "data/university-news-preview.json",
];
const PUBLIC_REPORT_FILE = path.relative(ROOT, PUBLIC_REPORT_PATH).replace(/\\/g, "/");
const NEWS_SCOPE_FILES = [
  "development/university-news/data/university-news-sources.final.json",
  "development/university-news/collectors/html-list-collector.js",
  "server/agent/store.js",
  "server/agent/tools/run-multi-school-trial.js",
  ...GENERATED_NEWS_FILES,
];
const LOG_DIRECTORY = path.join(ROOT, "server", "agent", "logs", "scheduled");

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", ["-c", `safe.directory=${ROOT.replace(/\\/g, "/")}`, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error((error.stderr || error.message || "git command failed").trim());
  }
}

function appendLog(entry) {
  fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const filePath = path.join(LOG_DIRECTORY, `six-university-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  return filePath;
}

function changedFilesAgainstHead(files) {
  return runGit(["diff", "--name-only", "HEAD", "--", ...files])
    .split("\n")
    .filter(Boolean);
}

function ensureSafeStart() {
  if (runGit(["branch", "--show-current"]) !== "main") throw new Error("This task may only run on main.");
  if (!runGit(["remote", "get-url", "origin"])) throw new Error("origin is not configured.");
  if (runGit(["diff", "--cached", "--name-only", "--", ...NEWS_SCOPE_FILES])) {
    throw new Error("News files are already staged; scheduled deployment stopped without changing Git state.");
  }
  if (changedFilesAgainstHead(NEWS_SCOPE_FILES).length > 0) {
    throw new Error("News files already have local changes; scheduled deployment stopped without mixing changes.");
  }
}

function validatePreview() {
  const previewPath = path.join(ROOT, "data", "university-news-preview.json");
  const data = JSON.parse(fs.readFileSync(previewPath, "utf8"));
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) throw new Error("Preview has no items.");
  const seenUrls = new Set();
  const seenTitles = new Set();
  const externalHosts = /(?:youtube\.com|youtu\.be|facebook\.com|instagram\.com|twitter\.com|(?:^|\.)x\.com|tiktok\.com)/i;
  for (const item of items) {
    if (!item.publishedAt) throw new Error("Preview contains an item without publishedAt.");
    const sourceUrl = new URL(item.sourceUrl);
    const sourceSiteUrl = new URL(item.sourceSiteUrl);
    if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== sourceSiteUrl.hostname || sourceUrl.pathname === "/" || sourceUrl.href === sourceSiteUrl.href || externalHosts.test(sourceUrl.hostname)) {
      throw new Error(`Preview contains a non-public detail URL: ${item.title}`);
    }
    const normalizedUrl = item.normalizedSourceUrl || item.sourceUrl;
    const identity = `${item.universityId}|${item.title}|${item.publishedAt}`;
    if (seenUrls.has(normalizedUrl) || seenTitles.has(identity)) throw new Error("Preview contains duplicate news items.");
    seenUrls.add(normalizedUrl);
    seenTitles.add(identity);
  }
  if (!SIX_UNIVERSITY_IDS.every((id) => items.some((item) => item.universityId === id))) {
    throw new Error("Preview does not contain all six validated universities.");
  }
  if (!items.every((item, index) => index === 0 || String(items[index - 1].publishedAt) >= String(item.publishedAt))) {
    throw new Error("Preview is not sorted by publishedAt descending.");
  }
  return { count: items.length };
}

function runSixUniversityTrial() {
  const toolPath = path.join(ROOT, "server", "agent", "tools", "run-multi-school-trial.js");
  const result = spawnSync(process.execPath, [toolPath, `--university-ids=${SIX_UNIVERSITY_IDS.join(",")}`, "--limit-per-source=3", "--fail-on-university-error"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) throw new Error(`Six-university collection failed with exit code ${result.status}.`);
  const marker = '\n{\n  "storeBefore"';
  const start = String(result.stdout || "").lastIndexOf(marker);
  if (start < 0) throw new Error("Six-university collection did not return a result summary.");
  return JSON.parse(String(result.stdout).slice(start + 1));
}

function publicTrialMetrics(trial) {
  return {
    foundTotal: Number(trial.foundTotal || 0),
    acceptedTotal: Number(trial.acceptedTotal || 0),
    newTotal: Number(trial.newTotal || 0),
    duplicateTotal: Number(trial.duplicateTotal || 0),
    excludedTotal: Number(trial.excludedTotal || 0),
    perUniversity: (trial.perUniversity || []).map((row) => ({
      universityId: row.universityId,
      found: Number(row.found || 0),
      accepted: Number(row.accepted || 0),
      newCount: Number(row.newCount || 0),
      duplicateCount: Number(row.duplicateCount || 0),
      excluded: Number(row.excluded || 0),
      errorCount: row.error ? 1 : 0,
    })),
  };
}

function writeSuccessfulReport({ status, startedAt, completedAt, trial, preview, deployment }) {
  const metrics = publicTrialMetrics(trial);
  const report = buildCollectionReport({
    status,
    startedAt,
    completedAt,
    targetUniversityIds: SIX_UNIVERSITY_IDS,
    trial: metrics,
    previewCount: preview.count,
    deployment,
  });
  writePublicCollectionReport(report);
  return metrics;
}

function main() {
  const startedAt = new Date().toISOString();
  const config = getAgentConfig();
  if (config.enabled || config.aiEnabled || config.aiProvider !== "disabled") {
    throw new Error("Automatic scheduler or AI must remain disabled for this task.");
  }
  ensureSafeStart();
  const trial = runSixUniversityTrial();
  const newTotal = Number(trial.newTotal || 0);
  const preview = validatePreview();
  const changed = changedFilesAgainstHead(GENERATED_NEWS_FILES);
  if (changed.length === 0) {
    const completedAt = new Date().toISOString();
    const metrics = writeSuccessfulReport({ status: "no_new_items", startedAt, completedAt, trial, preview, deployment: { commitCreated: false, pushed: false, renderStatus: "not_required" } });
    const logFile = appendLog({ startedAt, completedAt, status: "no_new_items", targetUniversityIds: SIX_UNIVERSITY_IDS, previewCount: preview.count, newTotal, collectionSummary: metrics, stagedFiles: [], commit: null, pushed: false });
    console.log(`[six-news-deploy] No new items. Commit and push skipped. Log: ${logFile}`);
    return;
  }
  runGit(["add", "--", ...changed]);
  const staged = runGit(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  if (staged.some((file) => !GENERATED_NEWS_FILES.includes(file))) throw new Error("Unexpected staged file; deployment stopped.");
  runGit(["commit", "-m", "chore(news): refresh six validated universities"]);
  const newsCommit = runGit(["rev-parse", "HEAD"]);
  const completedAt = new Date().toISOString();
  const metrics = writeSuccessfulReport({ status: "deployed", startedAt, completedAt, trial, preview, deployment: { commitCreated: true, commitHash: newsCommit, pushed: true, renderStatus: "push_completed_waiting_for_render" } });
  runGit(["add", "--", PUBLIC_REPORT_FILE]);
  const reportStaged = runGit(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  if (reportStaged.length !== 1 || reportStaged[0] !== PUBLIC_REPORT_FILE) throw new Error("Unexpected staged report file; deployment stopped.");
  runGit(["commit", "-m", "chore(news): update collection report"]);
  try {
    runGit(["push", "origin", "main"]);
  } catch (error) {
    error.notificationStatus = "push_failed";
    throw error;
  }
  const logFile = appendLog({ startedAt, completedAt: new Date().toISOString(), status: "deployed", targetUniversityIds: SIX_UNIVERSITY_IDS, previewCount: preview.count, newTotal, collectionSummary: metrics, stagedFiles: [...staged, ...reportStaged], commit: newsCommit, reportCommit: runGit(["rev-parse", "HEAD"]), pushed: true, renderStatus: "push_completed_waiting_for_render" });
  console.log(`[six-news-deploy] Push completed. Render will deploy automatically. Log: ${logFile}`);
}

try {
  main();
} catch (error) {
  const logFile = appendLog({ startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: error.notificationStatus || "failed", targetUniversityIds: SIX_UNIVERSITY_IDS, previewCount: null, newTotal: 0, error: error.message, pushed: false });
  console.error(`[six-news-deploy] ${error.message}\nLog: ${logFile}`);
  process.exitCode = 1;
}
