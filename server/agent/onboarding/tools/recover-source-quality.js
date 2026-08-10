"use strict";
const { validateSourceQuality } = require("./validate-source-quality");

// One bounded, read-only quality recovery. A conflicting detail date is never
// replaced unless the already captured list row, URL, and title are the same
// article and therefore provide a verified list-date fallback.
function recoverSourceQuality({ item }) {
  const recovery = JSON.parse(JSON.stringify(item.recovery));
  const previous = item.quality;
  const actions = [];
  let changed = false;
  if (previous && previous.dateConsistency && previous.dateConsistency.conflicts) {
    for (const article of recovery.testedArticles || []) {
      if (article.listDate && article.detailDate && article.titleMatch) {
        const delta = Math.round(Math.abs(new Date(article.listDate + "T00:00:00Z") - new Date(article.detailDate + "T00:00:00Z")) / 86400000);
        if (delta > 30) {
          article.originalDetailDate = article.detailDate;
          article.detailDate = article.listDate;
          article.publishedAt = article.listDate;
          article.dateSource = "verified_list_date";
          article.detailDateMethod = "verified_list_date";
          actions.push("verified_list_date_fallback");
          changed = true;
        }
      }
    }
    if (changed) recovery.dateConfidence = "MEDIUM";
  }
  if (previous && previous.sharedSource && previous.campusScope === "UNKNOWN") actions.push("shared_source_kept_for_manual_campus_evidence");
  if (previous && previous.qualityNotes && previous.qualityNotes.includes("broader_source_preferred")) actions.push("broader_source_preferred_requires_separate_candidate_discovery");
  const quality = validateSourceQuality({ university: item, recoveryResult: recovery, sourceCandidate: recovery.candidateUrl, sharedSource: !!(previous && previous.sharedSource) });
  return { attempted: true, actions, changed, recovery, quality, finalDecision: quality.decision === "QUALITY_APPROVED" ? "QUALITY_APPROVED" : "QUALITY_REVIEW_FINAL" };
}
module.exports = { recoverSourceQuality };
