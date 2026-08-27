"use strict";
const fs = require("fs");
const path = require("path");
const { recoverUnstableSource } = require("./recover-unstable-source");
const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
const IDS = ["catholic-kkottongnae-university", "the-catholic-university-of-korea-본교", "sungkyunkwan-university-natural-sciences"];
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
async function main() {
  const queue = read(path.join(DATA, "onboarding-smart-retry-queue.json"), { items: [] });
  const report = { phase: "selector_date_recovery_test3", startedAt: new Date().toISOString(), processed: 0, autoApprovedRecovered: 0, review: 0, error: 0, git: "not_run", render: "not_run", configChanged: false, storeChanged: false, previewChanged: false, items: [] };
  for (const id of IDS) {
    const item = queue.items.find(x => x.universityId === id);
    if (!item) { report.items.push({ universityId: id, decision: "ERROR", reason: "not_found_in_smart_retry_queue" }); report.error++; continue; }
    const diagnosis = read(path.join(REPORTS, id, "summary.json"), {});
    const result = await recoverUnstableSource({ universityId: id, universityName: item.universityName, diagnosis, primaryReason: item.primaryReason });
    report.processed++;
    if (result.decision === "AUTO_APPROVED_RECOVERED") report.autoApprovedRecovered++;
    else if (result.decision === "REVIEW") report.review++;
    else report.error++;
    report.items.push(result);
  }
  report.completedAt = new Date().toISOString();
  const dir = path.join(REPORTS, "selector-date-recovery");
  write(path.join(dir, "test3.json"), report);
  fs.writeFileSync(path.join(dir, "test3.md"), "# UNI PICK Selector/Date Recovery test3\n\n- Processed: " + report.processed + "\n- AUTO_APPROVED_RECOVERED: " + report.autoApprovedRecovered + "\n- REVIEW: " + report.review + "\n- ERROR: " + report.error + "\n\nNo source configuration, store, preview, Git, or Render state was changed.\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
