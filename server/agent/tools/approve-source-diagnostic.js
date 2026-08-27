"use strict";

const { getApprovalCandidate } = require("../source-diagnostics");
const universityId = (process.argv.find(value => value.startsWith("--university-id=")) || "").slice(16);
if (!universityId) { console.error("Usage: npm run news:source:approve -- --university-id=<ID>"); process.exitCode = 1; }
else {
  const candidate = getApprovalCandidate(universityId);
  if (!candidate) { console.error(`No pending source diagnostic for ${universityId}.`); process.exitCode = 1; }
  else console.log(JSON.stringify({ ...candidate, verified: false, enabled: false, action: "No source configuration was changed. Review this candidate before a future manual approval step." }, null, 2));
}
