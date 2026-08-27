"use strict";

// One-university onboarding pipeline. It is intentionally separate from the
// scheduled six-university collector and never runs a queue in bulk.
const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const { diagnoseUniversitySource } = require("./diagnose-source");

const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
const QUEUE = path.join(DATA, "onboarding-queue.json");
const REVIEW = path.join(DATA, "onboarding-review-queue.json");
const ERROR = path.join(DATA, "onboarding-error-queue.json");
const CATALOG = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const STORE = path.join(ROOT, "server", "agent", "data", "agent-news-store.json");
const PREVIEW = path.join(ROOT, "data", "university-news-preview.json");

function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function option(name) { return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
function timestamp() { return new Date().toISOString(); }
function git(args) { return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }); }
function safeWorktree() {
  const status = git(["status", "--porcelain"]);
  return status.status === 0 && !String(status.stdout || "").trim();
}
function backupFiles(universityId) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const dir = path.join(ROOT, "server", "agent", "onboarding", "backups", `${universityId}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of [CATALOG, STORE, PREVIEW]) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  const root = path.dirname(dir);
  const old = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith(`${universityId}-`)).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of old.slice(0, Math.max(0, old.length - 10))) fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  return dir;
}
function restoreFiles(dir) {
  for (const file of [CATALOG, STORE, PREVIEW]) { const backup = path.join(dir, path.basename(file)); if (fs.existsSync(backup)) fs.copyFileSync(backup, file); }
}
function completeCollectorSelectors(diagnosis) {
  const selectors = diagnosis.recommendedCandidate?.selectors || {};
  return Boolean(selectors.listItem && selectors.title && selectors.link && selectors.date && selectors.detailTitle && selectors.detailDate);
}
function validatePreview(universityId) {
  const preview = read(PREVIEW, { items: [] });
  const items = (preview.items || []).filter(row => row.universityId === universityId);
  return { previewCount: items.length, valid: items.length > 0 && items.every(row => row.publishedAt && /^https:\/\//.test(row.sourceUrl || "")) };
}
function updateQueue(universityId, status, result) { const queue = read(QUEUE, { items: [] }); const item = queue.items.find(row => row.universityId === universityId); if (item) { item.status = status; item.attemptCount = Number(item.attemptCount || 0) + 1; item.lastAttemptAt = timestamp(); item.result = result; write(QUEUE, queue); } const target = status === "review" ? REVIEW : status === "error" ? ERROR : null; if (target) { const data = read(target, { items: [] }); data.items = (data.items || []).filter(row => row.universityId !== universityId); data.items.push({ universityId, status, result, updatedAt: timestamp() }); write(target, data); } }
function report(universityId, value) { const dir = path.join(REPORTS, universityId); write(path.join(dir, "final-onboarding.json"), value); fs.writeFileSync(path.join(dir, "final-onboarding.md"), `# UNI PICK onboarding result\n\n- University: ${value.universityName}\n- Status: **${value.finalStatus}**\n- Score: ${value.score ?? "n/a"}\n- Grade: ${value.grade ?? "n/a"}\n- Push: ${value.push?.status || "not_run"}\n`, "utf8"); }
function strictApproval(result, universityId, catalog) { const candidate = result.recommendedCandidate; const sourceIds = new Set(catalog.universities.flatMap(row => (row.sources || []).map(source => source.id))); const proposedId = `onboard-${universityId}-official`; return Boolean(candidate && /^https:\/\//.test(candidate.url) && candidate.listConfidence === "HIGH" && result.uniqueDetailUrls >= 2 && result.passCount >= 2 && result.selectorStable && result.score >= 75 && ["A", "B"].includes(result.grade) && !sourceIds.has(proposedId)); }
function notify(resultFile) { const script = path.join(ROOT, "scripts", "show-onboarding-result-notification.ps1"); if (fs.existsSync(script)) spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ResultFile", resultFile], { detached: true, stdio: "ignore" }).unref(); }
async function main() {
  const universityId = option("--university-id"); const dryRun = process.argv.includes("--dry-run"); const noPush = process.argv.includes("--no-push"); const forceReview = process.argv.includes("--force-review");
  if (!universityId) throw new Error("--university-id is required.");
  const queue = read(QUEUE, { items: [] }); const queuedItem = (queue.items || []).find(row => row.universityId === universityId);
  const catalog = read(CATALOG, { universities: [] }); const existing = catalog.universities.find(row => row.universityId === universityId); const verified = Boolean(existing && (existing.sources || []).some(source => source.verified === true));
  const item = queuedItem || (existing ? { universityId, universityName: existing.universityName, officialUrl: (existing.sources || [])[0]?.listUrl || "" } : null);
  if (!item) throw new Error("The university is not in the onboarding queue or source catalog.");
  if (dryRun) { console.log(JSON.stringify({ action: "onboard_one", universityId, dryRun: true, externalRequests: 0, existingVerified: verified, plannedSteps: ["queue", "verified-check", "diagnose", "strict-approval", "collection", "validation", "git" ] }, null, 2)); return; }
  if (verified && !forceReview) { const result = { universityId, universityName: item.universityName, finalStatus: "SKIPPED_EXISTING_VERIFIED", sourceActivated: false, commit: null, push: { status: "not_run" } }; updateQueue(universityId, "skipped_existing_verified", result); report(universityId, result); console.log(JSON.stringify(result, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json")); return; }
  const diagnosis = await diagnoseUniversitySource({ universityId, universityName: item.universityName, officialUrl: item.officialUrl });
  const base = { universityId, universityName: item.universityName, diagnosis: diagnosis.decision, recommendedSource: diagnosis.recommendedCandidate, score: diagnosis.score, grade: diagnosis.grade, sourceActivated: false, singleCollection: null, previewCount: 0, testResult: null, commit: null, push: { status: noPush ? "disabled_by_no_push" : "not_run" }, render: { status: "not_run" }, publicPreview: { status: "not_run" } };
  if (!strictApproval(diagnosis, universityId, catalog)) { base.finalStatus = diagnosis.decision === "ERROR" ? "ERROR" : "REVIEW"; updateQueue(universityId, base.finalStatus.toLowerCase(), base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json")); return; }
  // A diagnosis must provide every selector the existing collector requires. This
  // prevents an otherwise high score from activating an incomplete source.
  if (!completeCollectorSelectors(diagnosis)) {
    base.finalStatus = "REVIEW"; base.activationReason = "collector_selector_schema_required"; updateQueue(universityId, "review", base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json")); return;
  }
  // Never mix an automated onboarding commit with unrelated local edits.
  if (!safeWorktree()) {
    base.finalStatus = "REVIEW"; base.activationReason = "unrelated_worktree_changes"; updateQueue(universityId, "review", base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json")); return;
  }
  const backupDir = backupFiles(universityId);
  try {
    const source = (existing?.sources || []).find(entry => entry.verified !== true) || null;
    if (!source) throw new Error("No replaceable unverified source entry exists.");
    const selectors = diagnosis.recommendedCandidate.selectors;
    Object.assign(source, { verified: true, enabled: true, listUrl: diagnosis.recommendedCandidate.url, collectionType: "html", sourceType: "official", category: diagnosis.recommendedCandidate.category, selectors: { item: selectors.listItem, title: selectors.title, link: selectors.link, date: selectors.date }, detailSelectors: { title: selectors.detailTitle, date: selectors.detailDate } });
    write(CATALOG, catalog);
    base.sourceActivated = true; base.backupDir = backupDir;
    const trial = spawnSync(process.execPath, [path.join(ROOT, "server", "agent", "tools", "run-single-school-trial.js"), `--university-id=${universityId}`, "--limit=3"], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    base.singleCollection = { exitCode: trial.status, output: String(trial.stdout || "").slice(-12000), error: String(trial.stderr || "") };
    if (trial.status !== 0) throw new Error("single_collection_failed");
    const preview = validatePreview(universityId); base.previewCount = preview.previewCount;
    if (!preview.valid) throw new Error("preview_validation_failed");
    const test = spawnSync("npm", ["test"], { cwd: ROOT, encoding: "utf8", timeout: 120000, shell: process.platform === "win32" });
    base.testResult = { exitCode: test.status, output: String(test.stdout || "").slice(-8000) };
    if (test.status !== 0) throw new Error("npm_test_failed");
    if (noPush) { base.finalStatus = "SUCCESS_NO_PUSH"; updateQueue(universityId, "completed", base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json")); return; }
    // Staging and committing are deliberately explicit, never `git add .`.
    const stage = git(["add", CATALOG, STORE, PREVIEW]); if (stage.status !== 0) throw new Error("git_stage_failed");
    const commit = git(["commit", "-m", `feat(news): add verified ${item.universityName} news source`]); if (commit.status !== 0) throw new Error("git_commit_failed");
    base.commit = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
    const push = git(["push", "origin", "main"]); if (push.status !== 0) { base.finalStatus = "PUSH_FAILED"; base.push = { status: "failed" }; updateQueue(universityId, "push_failed", base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json")); return; }
    base.push = { status: "pushed" }; base.render = { status: "deploy_triggered" }; base.finalStatus = "SUCCESS"; updateQueue(universityId, "completed", base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json"));
  } catch (error) {
    restoreFiles(backupDir); base.sourceActivated = false; base.finalStatus = "REVIEW_AFTER_ACTIVATION_FAILURE"; base.activationReason = error.message; updateQueue(universityId, "review", base); report(universityId, base); console.log(JSON.stringify(base, null, 2)); notify(path.join(REPORTS, universityId, "final-onboarding.json"));
  }
}
main().catch(error => { console.error(`[onboard-one] ${error.message}`); process.exitCode = 1; });
