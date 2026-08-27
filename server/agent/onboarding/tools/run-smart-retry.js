"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { recoverUnstableSource } = require("./recover-unstable-source");
const { validateSourceQuality } = require("./validate-source-quality");
const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
const QUEUE = path.join(DATA, "onboarding-smart-retry-queue.json");
const STATE = path.join(DATA, "onboarding-smart-retry-state.json");
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function has(flag) { return process.argv.includes(flag); }
function existingDiagnosis(id) { return read(path.join(REPORTS, id, "summary.json"), {}); }
function legacyRetry(item) { const tool = path.join(ROOT, "server", "agent", "onboarding", "tools", "run-one-onboarding.js"); const child = spawnSync(process.execPath, [tool, "--university-id=" + item.universityId, "--force-review", "--no-push"], { cwd: ROOT, encoding: "utf8", timeout: 120000 }); const final = read(path.join(REPORTS, item.universityId, "final-onboarding.json"), { finalStatus: child.status === 0 ? "REVIEW" : "ERROR" }); return { decision: final.finalStatus || "ERROR", externalRequests: null, legacy: true }; }
async function processItem(item) {
  if (item.primaryReason === "SELECTOR_UNSTABLE" || item.primaryReason === "DATE_NOT_STABLE") {
    return recoverUnstableSource({ universityId: item.universityId, universityName: item.universityName, diagnosis: existingDiagnosis(item.universityId), primaryReason: item.primaryReason });
  }
  return legacyRetry(item);
}
function gateTechnicalSuccess(item, result, sourceCounts) {
  const technicalSuccess = result.decision === "AUTO_APPROVED_RECOVERED" || String(result.decision).startsWith("SUCCESS");
  if (!technicalSuccess) return { finalStatus: String(result.decision).includes("ERROR") ? "TECHNICAL_ERROR" : "TECHNICAL_REVIEW", quality: null };
  const quality = validateSourceQuality({ university: item, recoveryResult: result, sourceCandidate: result.candidateUrl, sharedSource: sourceCounts.get(result.candidateUrl) > 1 });
  return { finalStatus: quality.decision, quality };
}
function status() { console.log(JSON.stringify(read(STATE, { status: "idle", total: 0, completed: 0 }), null, 2)); }
async function main() {
  if (has("--status")) return status();
  const test = has("--test10") || has("--test10-recovery");
  const resume = has("--resume");
  const queue = read(QUEUE, { items: [] });
  const candidates = queue.items.filter(item => item.recoveryLikelihood === "HIGH" && (!resume || item.status === "pending"));
  const items = candidates.slice(0, test ? 10 : candidates.length);
  if (!items.length) { console.log("No HIGH smart-retry targets are pending."); return; }
  const state = { status: "running", total: items.length, completed: 0, success: 0, review: 0, error: 0, currentUniversityId: null, currentUniversityName: null, lastUpdatedAt: new Date().toISOString(), mode: test ? "test10_recovery" : "smart_retry_recovery" };
  write(STATE, state);
  const report = { startedAt: new Date().toISOString(), mode: state.mode, processed: 0, previousRecovered: 0, recovered: 0, review: 0, error: 0, selectorDateRecoveryApplied: 0, sharedSourceCandidate: 0, configChanged: false, storeChanged: false, previewChanged: false, git: { status: "not_run_test_mode" }, render: { status: "not_run" }, items: [] };
  const sourceCounts = new Map();
  for (const item of items) { const prior = existingDiagnosis(item.universityId); const url = prior.recommendedCandidate && prior.recommendedCandidate.url; if (url) sourceCounts.set(url, (sourceCounts.get(url) || 0) + 1); }
  for (const item of items) {
    state.currentUniversityId = item.universityId; state.currentUniversityName = item.universityName; state.lastUpdatedAt = new Date().toISOString(); write(STATE, state);
    const result = await processItem(item);
    const gated = gateTechnicalSuccess(item, result, sourceCounts);
    const recovered = gated.finalStatus === "QUALITY_APPROVED";
    if (item.primaryReason === "SELECTOR_UNSTABLE" || item.primaryReason === "DATE_NOT_STABLE") report.selectorDateRecoveryApplied++;
    if (result.sharedSourceCandidate) report.sharedSourceCandidate++;
    if (recovered) { report.recovered++; state.success++; } else if (String(gated.finalStatus).includes("REVIEW")) { report.review++; state.review++; } else { report.error++; state.error++; }
    report.processed++; report.items.push({ universityId: item.universityId, universityName: item.universityName, primaryReason: item.primaryReason, strategy: item.strategy, status: gated.finalStatus, recovery: result, quality: gated.quality });
    state.completed++; state.lastUpdatedAt = new Date().toISOString(); write(STATE, state);
  }
  state.status = "completed"; state.lastUpdatedAt = new Date().toISOString(); write(STATE, state);
  report.completedAt = new Date().toISOString(); report.recoveryRate = { before: "0/10", after: report.recovered + "/" + report.processed, percentage: Math.round(report.recovered / report.processed * 100) };
  const dir = path.join(REPORTS, "smart-retry-recovery"); const json = path.join(dir, "smart-retry-recovery-001-" + String(items.length).padStart(3, "0") + ".json");
  write(json, report);
  fs.writeFileSync(json.replace(/\.json$/, ".md"), "# UNI PICK Smart Retry + Recovery test10\n\n- Processed: " + report.processed + "\n- Recovered: " + report.recovered + "\n- Review: " + report.review + "\n- Error: " + report.error + "\n- Recovery rate: " + report.recoveryRate.before + " -> " + report.recoveryRate.after + "\n\nNo source configuration, store, preview, Git, or Render state was changed.\n", "utf8");
  console.log(JSON.stringify(Object.assign({}, report, { reportFile: json }), null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
