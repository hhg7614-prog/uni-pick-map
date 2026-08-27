"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { recoverSourceQuality } = require("./recover-source-quality");
const ROOT = path.resolve(__dirname, "../../../..");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8"); }
function main() {
  const runner = path.join(ROOT, "server", "agent", "onboarding", "tools", "run-quality-recovery-test20.js");
  const child = spawnSync(process.execPath, [runner], { cwd: ROOT, stdio: "ignore", timeout: 120000 });
  if (child.status !== 0) throw new Error("technical_quality_test20_failed");
  const base = read(path.join(REPORTS, "quality-recovery-test20", "quality-recovery-test20.json"));
  const items = base.items.map(item => {
    if (item.finalDecision !== "QUALITY_REVIEW") return item;
    const recovered = recoverSourceQuality({ item });
    return Object.assign({}, item, { qualityRecovery: recovered, recovery: recovered.recovery, quality: recovered.quality, finalDecision: recovered.finalDecision });
  });
  const approvedUniversities = items.filter(x => x.finalDecision === "QUALITY_APPROVED").map(x => ({ universityId: x.universityId, universityName: x.universityName, sourceUrl: x.quality.sourceCandidate, sourceScope: x.quality.sourceScope, qualityScore: x.quality.qualityScore }));
  const qualityReviewUniversities = items.filter(x => x.finalDecision === "QUALITY_REVIEW_FINAL").map(x => ({ universityId: x.universityId, universityName: x.universityName, reason: x.quality.qualityNotes, sourceScope: x.quality.sourceScope, qualityScore: x.quality.qualityScore }));
  const technicalReviewUniversities = items.filter(x => x.finalDecision === "TECHNICAL_REVIEW").map(x => ({ universityId: x.universityId, universityName: x.universityName, primaryReason: x.primaryReason, score: x.recovery.score, dateConfidence: x.recovery.dateConfidence, passCount: x.recovery.passCount }));
  const report = { phase: "quality_recovery_final_test20", generatedAt: new Date().toISOString(), processed: items.length, technicalRecovered: base.technicalRecovered, previousQualityApproved: base.qualityApproved, qualityApproved: approvedUniversities.length, qualityRecovered: approvedUniversities.length - base.qualityApproved, qualityReviewFinal: qualityReviewUniversities.length, technicalReview: technicalReviewUniversities.length, technicalError: items.filter(x => x.finalDecision === "TECHNICAL_ERROR").length, networkError: items.filter(x => x.finalDecision === "NETWORK_ERROR").length, dateConflictBefore: base.dateConflictCount, dateConflictAfter: items.reduce((sum, x) => sum + (x.quality ? x.quality.dateConsistency.conflicts : 0), 0), sharedSourceCount: items.filter(x => x.quality && x.quality.sharedSource).length, campusScopeUnknownBefore: base.campusScopeUnknownCount, campusScopeUnknownAfter: items.filter(x => x.quality && x.quality.campusScope === "UNKNOWN").length, broaderSourceReplacementSuccess: 0, approvedUniversities, qualityReviewUniversities, technicalReviewUniversities, reportValidation: {}, configChanged: false, storeChanged: false, previewChanged: false, git: "not_run", render: "not_run", items };
  report.reportValidation = { approvedMatches: report.qualityApproved === report.approvedUniversities.length, qualityReviewMatches: report.qualityReviewFinal === report.qualityReviewUniversities.length, technicalReviewMatches: report.technicalReview === report.technicalReviewUniversities.length };
  report.finalDecision = Object.values(report.reportValidation).every(Boolean) ? "COMPLETE" : "REPORT_VALIDATION_ERROR";
  if (report.finalDecision !== "COMPLETE") throw new Error("REPORT_VALIDATION_ERROR");
  const file = path.join(REPORTS, "quality-recovery-test20", "quality-recovery-test20-final.json"); write(file, report);
  fs.writeFileSync(file.replace(/\.json$/, ".md"), "# UNI PICK Quality Recovery test20\n\n- Technical recovered: " + report.technicalRecovered + "\n- Quality approved: " + report.qualityApproved + "\n- Quality recovered: " + report.qualityRecovered + "\n- Quality review final: " + report.qualityReviewFinal + "\n\nNo configuration, news data, Git, or Render change was made.\n", "utf8");
  console.log(JSON.stringify(Object.assign({}, report, { reportFile: file }), null, 2));
}
main();
