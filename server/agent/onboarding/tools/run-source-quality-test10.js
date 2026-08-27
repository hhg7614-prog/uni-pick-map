"use strict";
const fs = require("fs");
const path = require("path");
const { validateSourceQuality } = require("./validate-source-quality");
const ROOT = path.resolve(__dirname, "../../../..");
const INPUT = path.join(ROOT, "server", "agent", "onboarding", "reports", "smart-retry-recovery", "smart-retry-recovery-001-010.json");
const OUTPUT = path.join(ROOT, "server", "agent", "onboarding", "reports", "quality-gate");
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8"); }
function main() {
  const input = read(INPUT);
  const sourceCounts = new Map();
  for (const item of input.items) { const url = item.recovery && item.recovery.candidateUrl; if (url) sourceCounts.set(url, (sourceCounts.get(url) || 0) + 1); }
  const results = input.items.map(item => validateSourceQuality({ university: item, recoveryResult: item.recovery, sourceCandidate: item.recovery && item.recovery.candidateUrl, sharedSource: sourceCounts.get(item.recovery && item.recovery.candidateUrl) > 1 }));
  const byScope = {}; for (const result of results) byScope[result.sourceScope] = (byScope[result.sourceScope] || 0) + 1;
  const report = { phase: "source_quality_gate_test10", inputTechnicalApproved: input.items.filter(x => x.status === "AUTO_APPROVED_RECOVERED").length, processed: results.length, qualityApproved: results.filter(x => x.decision === "QUALITY_APPROVED").length, qualityReview: results.filter(x => x.decision === "QUALITY_REVIEW").length, dateConflictCount: results.reduce((n, x) => n + x.dateConsistency.conflicts, 0), sourceScopeCounts: byScope, sharedSourceGroups: [...sourceCounts.values()].filter(n => n > 1).length, sharedSourceCandidates: results.filter(x => x.sharedSource).length, campusScopeAllCampuses: results.filter(x => x.campusScope === "ALL_CAMPUSES").length, campusScopeUnknown: results.filter(x => x.campusScope === "UNKNOWN").length, configChanged: false, storeChanged: false, previewChanged: false, git: "not_run", render: "not_run", items: results, generatedAt: new Date().toISOString() };
  const file = path.join(OUTPUT, "quality-gate-001-010.json"); write(file, report);
  fs.writeFileSync(file.replace(/\.json$/, ".md"), "# UNI PICK Source Quality Gate test10\n\n- Technical AUTO_APPROVED_RECOVERED: " + report.inputTechnicalApproved + "\n- QUALITY_APPROVED: " + report.qualityApproved + "\n- QUALITY_REVIEW: " + report.qualityReview + "\n- DATE_CONFLICT: " + report.dateConflictCount + "\n\nThis report is read-only; no source configuration or news data was changed.\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}
main();
