"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { recoverUnstableSource } = require("./recover-unstable-source");
const { validateSourceQuality } = require("./validate-source-quality");
const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8"); }
function diagnosis(id) { return read(path.join(REPORTS, id, "summary.json"), {}); }
function technical(item) {
  if (item.primaryReason === "SELECTOR_UNSTABLE" || item.primaryReason === "DATE_NOT_STABLE") return recoverUnstableSource({ universityId: item.universityId, universityName: item.universityName, diagnosis: diagnosis(item.universityId), primaryReason: item.primaryReason });
  const tool = path.join(ROOT, "server", "agent", "onboarding", "tools", "run-one-onboarding.js");
  const child = spawnSync(process.execPath, [tool, "--university-id=" + item.universityId, "--force-review", "--no-push"], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const result = read(path.join(REPORTS, item.universityId, "final-onboarding.json"), { finalStatus: child.status === 0 ? "REVIEW" : "ERROR" });
  return Promise.resolve({ decision: result.finalStatus || "ERROR", candidateUrl: result.recommendedCandidate && result.recommendedCandidate.url, testedArticles: result.testedArticles || [], score: result.score || 0, grade: result.grade || "D", selectorStable: result.selectorStable, uniqueDetailUrls: result.uniqueDetailUrls || 0, passCount: result.passCount || 0, dateConfidence: result.dateConfidence || "LOW" });
}
async function main() {
  const queue = read(path.join(DATA, "onboarding-smart-retry-queue.json"), { items: [] });
  const items = queue.items.filter(item => item.recoveryLikelihood === "HIGH").slice(0, 20);
  const technicalResults = [];
  for (const item of items) technicalResults.push({ item, recovery: await technical(item) });
  const counts = new Map();
  for (const entry of technicalResults) { const url = entry.recovery.candidateUrl; if (url) counts.set(url, (counts.get(url) || 0) + 1); }
  const results = technicalResults.map(entry => {
    const isTechnicalRecovered = entry.recovery.decision === "AUTO_APPROVED_RECOVERED" || String(entry.recovery.decision).startsWith("SUCCESS");
    if (!isTechnicalRecovered) return { universityId: entry.item.universityId, universityName: entry.item.universityName, primaryReason: entry.item.primaryReason, finalDecision: String(entry.recovery.decision).includes("ERROR") ? "TECHNICAL_ERROR" : "TECHNICAL_REVIEW", recovery: entry.recovery, quality: null };
    const quality = validateSourceQuality({ university: entry.item, recoveryResult: entry.recovery, sourceCandidate: entry.recovery.candidateUrl, sharedSource: counts.get(entry.recovery.candidateUrl) > 1 });
    return { universityId: entry.item.universityId, universityName: entry.item.universityName, primaryReason: entry.item.primaryReason, finalDecision: quality.decision, recovery: entry.recovery, quality };
  });
  const byScope = {}; for (const entry of results) { const scope = entry.quality && entry.quality.sourceScope; if (scope) byScope[scope] = (byScope[scope] || 0) + 1; }
  const report = { phase: "quality_recovery_test20", generatedAt: new Date().toISOString(), processed: results.length, technicalRecovered: results.filter(x => x.recovery.decision === "AUTO_APPROVED_RECOVERED" || String(x.recovery.decision).startsWith("SUCCESS")).length, qualityApproved: results.filter(x => x.finalDecision === "QUALITY_APPROVED").length, qualityReview: results.filter(x => x.finalDecision === "QUALITY_REVIEW").length, technicalReview: results.filter(x => x.finalDecision === "TECHNICAL_REVIEW").length, technicalError: results.filter(x => x.finalDecision === "TECHNICAL_ERROR").length, networkError: results.filter(x => x.finalDecision === "NETWORK_ERROR").length, sourceScopeCounts: byScope, dateConflictCount: results.reduce((sum, x) => sum + (x.quality ? x.quality.dateConsistency.conflicts : 0), 0), sharedSourceCount: results.filter(x => x.quality && x.quality.sharedSource).length, campusScopeUnknownCount: results.filter(x => x.quality && x.quality.campusScope === "UNKNOWN").length, technicalRecoveryRate: "0/" + results.length, qualityApprovalRate: "0/" + results.length, configChanged: false, storeChanged: false, previewChanged: false, git: "not_run", render: "not_run", items: results };
  report.approvedUniversities = results.filter(x => x.finalDecision === "QUALITY_APPROVED").map(x => ({ universityId: x.universityId, universityName: x.universityName, sourceUrl: x.quality.sourceCandidate, sourceScope: x.quality.sourceScope, qualityScore: x.quality.qualityScore }));
  report.qualityReviewUniversities = results.filter(x => x.finalDecision === "QUALITY_REVIEW").map(x => ({ universityId: x.universityId, universityName: x.universityName, reason: x.quality.qualityNotes, sourceScope: x.quality.sourceScope, qualityScore: x.quality.qualityScore }));
  report.technicalReviewUniversities = results.filter(x => x.finalDecision === "TECHNICAL_REVIEW").map(x => ({ universityId: x.universityId, universityName: x.universityName, primaryReason: x.primaryReason, score: x.recovery.score, dateConfidence: x.recovery.dateConfidence, passCount: x.recovery.passCount }));
  report.reportValidation = { approvedMatches: report.qualityApproved === report.approvedUniversities.length, qualityReviewMatches: report.qualityReview === report.qualityReviewUniversities.length, technicalReviewMatches: report.technicalReview === report.technicalReviewUniversities.length };
  if (!Object.values(report.reportValidation).every(Boolean)) { report.finalDecision = "REPORT_VALIDATION_ERROR"; throw new Error("REPORT_VALIDATION_ERROR"); }
  report.technicalRecoveryRate = report.technicalRecovered + "/" + report.processed + " (" + Math.round(report.technicalRecovered / report.processed * 100) + "%)";
  report.qualityApprovalRate = report.qualityApproved + "/" + report.processed + " (" + Math.round(report.qualityApproved / report.processed * 100) + "%)";
  const dir = path.join(REPORTS, "quality-recovery-test20"); const file = path.join(dir, "quality-recovery-test20.json"); write(file, report);
  fs.writeFileSync(file.replace(/\.json$/, ".md"), "# UNI PICK Recovery + Quality test20\n\n- Processed: " + report.processed + "\n- Technical recovered: " + report.technicalRecoveryRate + "\n- Quality approved: " + report.qualityApprovalRate + "\n- Quality review: " + report.qualityReview + "\n\nRead-only test: no source configuration, news data, Git, or Render changes.\n", "utf8");
  console.log(JSON.stringify(Object.assign({}, report, { reportFile: file }), null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
