"use strict";

// Quality gate is intentionally read-only. It evaluates a technical recovery
// result before any later activation workflow is allowed to use it.
function daysBetween(a, b) { if (!a || !b) return null; return Math.round(Math.abs(new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000); }
function scopeFor(item) {
  const value = ((item.recovery && item.recovery.candidateUrl) || "").toLowerCase();
  if (/ipsi|admission|입학|수시|정시/.test(value) || item.universityName.includes("꽃동네") || item.universityName.includes("상주")) return "ADMISSION_NOTICE";
  if (/council|평의원/.test(value)) return "COUNCIL_NOTICE";
  if (/scholarship/.test(value)) return "SCHOLARSHIP_NOTICE";
  if (/press|newsweb|\/news(?:\/|$)|보도자료/.test(value)) return "PRESS_RELEASE";
  if (/notice|campuslife/.test(value)) return "UNIVERSITY_NOTICE";
  return "OTHER";
}
function qualityDateCheck(articles) {
  const checks = (articles || []).map(article => {
    const delta = daysBetween(article.listDate, article.detailDate);
    return { listDate: article.listDate || null, detailDate: article.detailDate || null, dateDeltaDays: delta, status: delta === null || delta <= 7 ? "OK" : delta <= 30 ? "WARN" : "DATE_CONFLICT", detailDateMethod: article.detailDateMethod || null };
  });
  return { checks, conflicts: checks.filter(x => x.status === "DATE_CONFLICT").length, warns: checks.filter(x => x.status === "WARN").length };
}
function campusScope(item, shared) {
  const url = item.recovery.candidateUrl || "";
  if (/skku\/campus\/skk_comm\/press\.do/.test(url)) return { campusScope: "ALL_CAMPUSES", evidence: "institutional shared communications path" };
  if (shared) return { campusScope: "UNKNOWN", evidence: "same source is shared, but report has no all-campus evidence" };
  return { campusScope: "SPECIFIC_CAMPUS", evidence: "single-university candidate with no shared-source conflict" };
}
function allowedScope(scope) { return ["UNIVERSITY_NEWS", "UNIVERSITY_NOTICE", "PRESS_RELEASE", "GENERAL_UNIVERSITY_FEED"].includes(scope); }
function validateSourceQuality({ university, recoveryResult, sourceCandidate, sharedSource, discoverySourceScope }) {
  const item = { universityId: university.universityId, universityName: university.universityName, recovery: recoveryResult };
  const technical = recoveryResult.decision === "AUTO_APPROVED_RECOVERED";
  const inferredScope = scopeFor(item);
  const sourceScope = discoverySourceScope || inferredScope;
  const sourceUrl = sourceCandidate || recoveryResult.candidateUrl || "";
  const sourceIsList = !/[?&](?:mode=view|articleNo=|boardNo=|nttId=|idx=)/i.test(sourceUrl);
  const dates = qualityDateCheck(recoveryResult.testedArticles);
  const campus = campusScope(item, sharedSource);
  const recent = (recoveryResult.testedArticles || []).filter(x => x.publishedAt).length >= 2;
  const official = /^https:\/\//.test(sourceCandidate || recoveryResult.candidateUrl || "");
  let qualityScore = 0;
  if (allowedScope(sourceScope)) qualityScore += 30;
  if (dates.conflicts === 0) qualityScore += 20;
  if (campus.campusScope !== "UNKNOWN") qualityScore += 20;
  if (recent) qualityScore += 15;
  if (official) qualityScore += 15;
  if (!sourceIsList) qualityScore -= 30;
  if (dates.conflicts >= 1) qualityScore -= 40;
  if (sourceScope === "ADMISSION_NOTICE") qualityScore -= 30;
  if (sourceScope === "COUNCIL_NOTICE") qualityScore -= 30;
  if (campus.campusScope === "UNKNOWN") qualityScore -= 20;
  if (sourceScope === "SCHOLARSHIP_NOTICE") qualityScore -= 10;
  const notes = [];
  if (dates.conflicts) notes.push("date_conflict");
  if (sourceScope === "SCHOLARSHIP_NOTICE") notes.push("broader_source_preferred");
  if (sourceScope === "ADMISSION_NOTICE") notes.push("admission_source_not_general_news");
  if (sourceScope === "COUNCIL_NOTICE") notes.push("council_source_not_general_news");
  if (campus.campusScope === "UNKNOWN") notes.push("campus_scope_evidence_required");
  if (!sourceIsList) notes.push("candidate_is_detail_not_list");
  const decision = technical && sourceIsList && qualityScore >= 75 && dates.conflicts === 0 && allowedScope(sourceScope) && campus.campusScope !== "UNKNOWN" ? "QUALITY_APPROVED" : "QUALITY_REVIEW";
  return { universityId: university.universityId, universityName: university.universityName, technicalDecision: recoveryResult.decision, sourceCandidate: sourceUrl, sourceIsList, discoverySourceScope: discoverySourceScope || null, sourceScope, sourceScopeReason: discoverySourceScope && discoverySourceScope !== inferredScope ? "candidate_discovery_content_scope_overrides_url_only_inference" : "quality_url_and_recovery_inference", sharedSource: !!sharedSource, campusScope: campus.campusScope, campusScopeEvidence: campus.evidence, dateConsistency: dates, qualityScore: Math.max(0, Math.min(100, qualityScore)), decision, qualityNotes: notes };
}
module.exports = { validateSourceQuality };
