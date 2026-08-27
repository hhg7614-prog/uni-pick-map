"use strict";

const { TEST_STATE_FILE, createDryRun, loadCatalog, runDiagnostics, statusSummary } = require("../source-diagnostics");

function args(argv) {
  const value = { dryRun: false, resume: false, retry: false, limit: 0, simulateErrorAt: 0, stopAfter: 0, status: false, testOnly: false, universityIds: [] };
  for (const item of argv) {
    if (item === "--dry-run") value.dryRun = true;
    else if (item === "--resume") value.resume = true;
    else if (item === "--resume-test") { value.resume = true; value.testOnly = true; }
    else if (item === "--retry-errors") value.retry = true;
    else if (item === "--status") value.status = true;
    else if (item === "--status-test") { value.status = true; value.testOnly = true; }
    else if (item.startsWith("--limit=")) value.limit = Number(item.slice(8)) || 0;
    else if (item.startsWith("--simulate-error-at=")) value.simulateErrorAt = Number(item.slice(20)) || 0;
    else if (item.startsWith("--stop-after=")) value.stopAfter = Number(item.slice(13)) || 0;
    else if (item.startsWith("--university-ids=")) value.universityIds = item.slice(17).split(",").map(value => value.trim()).filter(Boolean);
  }
  return value;
}

(async () => {
  const options = args(process.argv.slice(2));
  if (options.status) { console.log(JSON.stringify(statusSummary(options.testOnly ? TEST_STATE_FILE : undefined), null, 2)); return; }
  if (options.dryRun) { console.log(JSON.stringify(createDryRun(loadCatalog()), null, 2)); return; }
  const state = await runDiagnostics(options);
  console.log(JSON.stringify({ runId: state.runId, status: state.status, processed: state.processedUniversityIds.length, success: state.successIds.length, review: state.reviewIds.length, error: state.errorIds.length, skipped: state.skippedIds.length }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
