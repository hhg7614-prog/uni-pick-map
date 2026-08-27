"use strict";

// Sequential batch coordinator. It only calls the one-university pipeline and
// never imports the live six-university collector or its scheduler.
const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
const QUEUE = path.join(DATA, "onboarding-queue.json");
const STATE = path.join(DATA, "onboarding-batch-state.json");
const PUSH_RETRY = path.join(DATA, "onboarding-push-retry-queue.json");

function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function flag(name) { return process.argv.includes(name); }
function value(name, fallback = 0) { const raw = process.argv.find(arg => arg.startsWith(`${name}=`)); return raw ? Number(raw.slice(name.length + 1)) : fallback; }
function now() { return new Date().toISOString(); }
function errorType(result, universityId) {
  const diagnostic = read(path.join(REPORTS, universityId, "summary.json"), {});
  const message = [...(diagnostic.errors || []), result.activationReason || ""].join(" ").toLowerCase();
  if (/fetch failed|network|dns|ssl/.test(message)) return "NETWORK_ERROR";
  if (/timeout|abort/.test(message)) return "TIMEOUT";
  if (/\b403\b/.test(message)) return "HTTP_403";
  if (/\b429\b/.test(message)) return "HTTP_429";
  if (/parse|selector/.test(message)) return "PARSE_ERROR";
  return result.finalStatus === "ERROR" ? "NO_VALID_SOURCE" : null;
}
function reportBatch(summary) {
  const label = `${String(summary.batchStart).padStart(3, "0")}-${String(summary.batchEnd).padStart(3, "0")}`;
  const dir = path.join(REPORTS, "batches");
  write(path.join(dir, `batch-${label}.json`), summary);
  fs.writeFileSync(path.join(dir, `batch-${label}.md`), `# UNI PICK Onboarding Batch ${summary.batchStart}-${summary.batchEnd}\n\n- Processed: ${summary.processed}\n- Auto approved: ${summary.autoApproved}\n- Review: ${summary.review}\n- Error: ${summary.error}\n- Skipped: ${summary.skipped}\n- Network errors: ${summary.networkErrors}\n- Git: ${summary.git.status}\n`, "utf8");
  return path.join(dir, `batch-${label}.json`);
}
function finalReport(queue, state) {
  const rows = queue.items || [];
  const count = predicate => rows.filter(predicate).length;
  const summary = { totalUniversities: rows.length, firstPassCompleted: true, autoApproved: count(row => row.status === "completed"), existingVerifiedSkip: count(row => row.status === "skipped_existing_verified"), firstPassReview: count(row => row.status === "review"), firstPassError: count(row => row.status === "error"), networkError: count(row => row.result?.errorType === "NETWORK_ERROR"), secondPassRecovered: count(row => row.status === "completed_after_retry"), finalReviewRequired: count(row => row.status === "final_review_required"), finalError: count(row => row.status === "final_error"), finalVerifiedCount: 0, generatedAt: now(), lastCommit: state.lastCommit || null, pushFailures: 0 };
  const dir = path.join(REPORTS, "final"); write(path.join(dir, "final-summary.json"), summary);
  fs.writeFileSync(path.join(dir, "final-summary.md"), `# UNI PICK Onboarding final report\n\n- Total: ${summary.totalUniversities}\n- Auto approved: ${summary.autoApproved}\n- Existing verified skipped: ${summary.existingVerifiedSkip}\n- Review: ${summary.firstPassReview}\n- Error: ${summary.firstPassError}\n`, "utf8");
  return summary;
}
function notify(resultFile) {
  const script = path.join(ROOT, "scripts", "show-onboarding-batch-notification.ps1");
  if (fs.existsSync(script)) spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ResultFile", resultFile], { detached: true, stdio: "ignore" }).unref();
}
function notifyFinal(resultFile) {
  const script = path.join(ROOT, "scripts", "show-onboarding-final-notification.ps1");
  if (fs.existsSync(script)) spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ResultFile", resultFile], { detached: true, stdio: "ignore" }).unref();
}
function selectedItems(queue, testOnly, resume, secondPass) {
  const rows = [...(queue.items || [])].sort((a, b) => a.order - b.order);
  if (secondPass) return rows.filter(row => row.status === "review" || row.status === "error");
  const actionable = resume ? rows.filter(row => row.status === "pending") : rows.filter(row => testOnly || row.status === "pending");
  return testOnly ? rows.slice(0, 10) : actionable;
}
function printStatus() {
  const state = read(STATE, { status: "idle", total: 0, completed: 0, success: 0, review: 0, error: 0, skipped: 0 });
  const queue = read(QUEUE, { items: [] }); const total = state.total || (queue.items || []).length; const next = (queue.items || []).find(row => row.status === "pending");
  console.log(JSON.stringify({ agent: "UNI PICK Onboarding Batch Agent", ...state, total, remaining: Math.max(0, total - state.completed), nextUniversity: next ? { universityId: next.universityId, universityName: next.universityName } : null }, null, 2));
}
async function run() {
  if (flag("--status")) return printStatus();
  const testOnly = flag("--test10"); const resume = flag("--resume"); const secondPass = flag("--second-pass"); const retry = flag("--retry");
  if (retry) { const retryQueue = read(PUSH_RETRY, { items: [] }); console.log(JSON.stringify({ action: "retry", queuedBatches: retryQueue.items.length, maxRetries: 2, note: "Only recorded NETWORK_ERROR, TIMEOUT, and PUSH_FAILED batches are eligible." }, null, 2)); return; }
  const queue = read(QUEUE, { items: [] }); const targets = selectedItems(queue, testOnly, resume, secondPass); const limit = testOnly ? 10 : (value("--limit", targets.length) || targets.length);
  const runTargets = targets.slice(0, limit); if (!runTargets.length) { console.log("No onboarding batch targets are pending."); return; }
  const previous = read(STATE, {}); const state = { status: "running", total: (queue.items || []).length, completed: Number(previous.completed || 0), currentIndex: Number(previous.currentIndex || 0), currentUniversityId: null, batchStart: runTargets[0].order, batchEnd: runTargets[runTargets.length - 1].order, success: Number(previous.success || 0), autoApproved: Number(previous.autoApproved || 0), review: Number(previous.review || 0), error: Number(previous.error || 0), skipped: Number(previous.skipped || 0), networkErrors: Number(previous.networkErrors || 0), startedAt: previous.startedAt || now(), lastUpdatedAt: now() };
  write(STATE, state);
  for (let offset = 0; offset < runTargets.length; offset += 10) {
    const group = runTargets.slice(offset, offset + 10);
    const batch = { batchStart: group[0].order, batchEnd: group[group.length - 1].order, processed: 0, success: 0, autoApproved: 0, review: 0, error: 0, skipped: 0, networkErrors: 0, approvedUniversityIds: [], reviewUniversityIds: [], errorUniversityIds: [], startedAt: now(), completedAt: null, duration: null, git: { status: testOnly ? "not_run_test_mode" : "not_run_no_auto_approval" }, render: { status: "not_run" }, results: [] };
    for (const item of group) {
    state.currentUniversityId = item.universityId; state.currentUniversityName = item.universityName; state.lastUpdatedAt = now(); write(STATE, state);
    let result;
    try {
      const args = [path.join(__dirname, "run-one-onboarding.js"), `--university-id=${item.universityId}`]; if (testOnly || secondPass) args.push("--no-push"); if (secondPass) args.push("--force-review");
      const child = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 120000 });
      result = read(path.join(REPORTS, item.universityId, "final-onboarding.json"), { universityId: item.universityId, universityName: item.universityName, finalStatus: child.status === 0 ? "REVIEW" : "ERROR", childError: String(child.stderr || "").slice(0, 500) });
    } catch (caught) { result = { universityId: item.universityId, universityName: item.universityName, finalStatus: "ERROR", childError: caught.message }; }
    let status = result.finalStatus || "ERROR"; const type = errorType(result, item.universityId);
    if (secondPass) {
      const latestQueue = read(QUEUE, { items: [] }); const row = (latestQueue.items || []).find(value => value.universityId === item.universityId);
      if (status.startsWith("SUCCESS")) { status = "SUCCESS_AFTER_RETRY"; if (row) row.status = "completed_after_retry"; }
      else if (status.startsWith("REVIEW")) { status = "FINAL_REVIEW_REQUIRED"; if (row) row.status = "final_review_required"; }
      else { status = "FINAL_ERROR"; if (row) row.status = "final_error"; }
      if (row) { row.result = { ...(row.result || {}), secondPassStatus: status, errorType: type, secondPassAt: now() }; write(QUEUE, latestQueue); }
    }
    batch.processed += 1; batch.results.push({ universityId: item.universityId, universityName: item.universityName, status, errorType: type });
    if (status.startsWith("SKIPPED")) { batch.skipped += 1; state.skipped += 1; }
    else if (status.startsWith("SUCCESS")) { batch.success += 1; batch.autoApproved += 1; state.success += 1; state.autoApproved += 1; batch.approvedUniversityIds.push(item.universityId); }
    else if (status.startsWith("REVIEW") || status === "FINAL_REVIEW_REQUIRED") { batch.review += 1; state.review += 1; batch.reviewUniversityIds.push(item.universityId); }
    else { batch.error += 1; state.error += 1; batch.errorUniversityIds.push(item.universityId); if (type === "NETWORK_ERROR") { batch.networkErrors += 1; state.networkErrors += 1; } }
      state.completed += 1; state.currentIndex = item.order; state.lastUpdatedAt = now(); write(STATE, state);
    }
    batch.completedAt = now(); batch.duration = Date.parse(batch.completedAt) - Date.parse(batch.startedAt); state.lastUpdatedAt = batch.completedAt; write(STATE, state);
    const reportFile = reportBatch(batch); notify(reportFile); console.log(JSON.stringify({ ...batch, reportFile }, null, 2));
  }
  const remaining = (read(QUEUE, { items: [] }).items || []).some(row => row.status === "pending"); state.status = secondPass || !remaining ? "completed" : "paused"; state.phase = secondPass ? "second_pass_completed" : "first_pass_completed"; state.lastUpdatedAt = now(); write(STATE, state);
  if (secondPass || !remaining) { finalReport(read(QUEUE, { items: [] }), state); notifyFinal(path.join(REPORTS, "final", "final-summary.json")); }
}
run().catch(error => { console.error(`[onboarding-batch] ${error.message}`); process.exitCode = 1; });
