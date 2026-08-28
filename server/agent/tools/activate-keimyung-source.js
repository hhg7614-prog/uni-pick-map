"use strict";

// DEPRECATED (retired at the same time the review/approval gate was
// introduced -- .pipeline/spec.md 질문사항 3, 결정됨; Coder 2라운드).
//
// This script used to write `enabled: true` / `verified: true` directly to
// development/university-news/data/university-news-sources.final.json
// without going through Brain's review + signed approval. It has been
// replaced by the review-packet -> signed ReviewDecision -> --apply flow:
//
//   1. Build a review packet:          server/agent/gate/review-packet.js
//   2. Brain records a signed decision (separate, non-Code-Agent execution
//      context -- never wired into any npm run script or onboarding tool):
//                                       server/agent/gate/review-decision-writer.js
//   3. Apply the approved activation:
//      node server/agent/gate/apply-source-activation.js --review-id=<reviewId> --apply
//
// This stub never touches the source catalog, the news store, or the
// preview file. It only logs the attempted invocation (for audit purposes)
// and throws immediately.
//
// The previous version of this file also exported a set of parsing/matching
// helper functions (normalizeId, normalizeUrl, plain, parseDate,
// officialDomain, isDetailUrl, extractRows, extractTdByClass, extractAnchors,
// parseKeimyungRow) plus a network-fetching runDryValidation function. A
// repo-wide search confirmed no other file required this module or consumed
// those exports (.pipeline/spec.md "Coder 2라운드 대상"
// activate-keimyung-source.js 항목 참고), so they were removed along with the
// activation logic rather than preserved.

function main() {
  console.error(
    "[DEPRECATED] server/agent/tools/activate-keimyung-source.js was invoked but is retired. " +
    "Use `node server/agent/gate/apply-source-activation.js --review-id=<reviewId> --apply` instead " +
    "(see .pipeline/spec.md for the review/approval gate design)."
  );
  throw new Error(
    "activate-keimyung-source.js is deprecated and no longer performs source activation. " +
    "Use server/agent/gate/apply-source-activation.js --apply after Brain has recorded an APPROVE decision."
  );
}

module.exports = { main };

main();
