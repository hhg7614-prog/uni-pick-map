"use strict";
// Candidate handoff regression test. This is read-only: no configuration,
// store, preview, verified flag, Git, or Render mutation is allowed here.
const fs = require("fs"), path = require("path");
const { recoverSourceCandidate } = require("./recover-source-candidate");
const { recoverUnstableSource } = require("./recover-unstable-source");
const { validateSourceQuality } = require("./validate-source-quality");
const { recoverSourceQuality } = require("./recover-source-quality");
const { htmlListCollector } = require("../../../../development/university-news/collectors/html-list-collector");
const ROOT = path.resolve(__dirname, "../../../.."), BATCH = path.join(ROOT, "server/agent/onboarding/reports/production-batch/batch-003.json"), CATALOG = path.join(ROOT, "development/university-news/data/university-news-sources.final.json"), OUT = path.join(ROOT, "server/agent/onboarding/reports/candidate-discovery-recovery/candidate-recovery-batch-003-v2.json");
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function sameHost(a, b) { try { return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, ""); } catch { return false; } }
async function collectorDryRun(university, recovery, sourceScope) {
  const configs = [
    { item: "div.list_body ul li", title: "span.subject a", link: "span.subject a", date: "span.date" },
    { item: "tbody tr", title: "td a", link: "td a", date: "td", dateIndex: 4 },
    { item: "tbody tr", title: "td.subject a", link: "td.subject a", date: "td.date" },
    { item: "ul li", title: "a", link: "a", date: "span.date" },
  ];
  for (const selectors of configs) {
    const source = { id: `onboard-${university.universityId}-candidate`, name: `${university.universityName} collector candidate`, category: sourceScope === "PRESS_RELEASE" ? "school_news" : "school_notice", sourceType: "official", collectionType: "html", listUrl: recovery.candidateUrl, selectors, verified: false, enabled: false };
    try {
      const result = await htmlListCollector({ university, source, limit: 3 });
      const valid = (result.items || []).filter(item => item.title && item.sourceUrl && item.publishedAt && sameHost(item.sourceUrl, source.listUrl));
      if (valid.length >= 2 && valid.every(item => item.publishedAt)) return { finalDecision: "COLLECTOR_CONFIG_READY", collected: valid.length, nullPublishedAt: 0, source, sample: valid.map(x => ({ title: x.title, sourceUrl: x.sourceUrl, publishedAt: x.publishedAt, dateSource: x.dateSource || null })) };
    } catch { /* try the next production-supported selector set */ }
  }
  return { finalDecision: "COLLECTOR_CONFIG_REVIEW", collected: 0, nullPublishedAt: 0 };
}
async function main() {
  const batch = JSON.parse(fs.readFileSync(BATCH, "utf8")), catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8")), items = [];
  for (const prior of batch.items.slice(0, 10)) {
    const university = { universityId: prior.universityId, universityName: prior.universityName };
    const discovery = await recoverSourceCandidate({ university, existingCandidate: prior.recovery?.candidateUrl || "" });
    const candidateDiscoveryUrl = discovery.recommendedCandidate?.url || null;
    let recovery = null, quality = null, qualityRecovery = null, collector = null, finalDecision = "QUALITY_REVIEW_FINAL", candidateHandoffError = false;
    if (discovery.decision === "CANDIDATE_READY") {
      // Pass the candidate URL directly. recoverUnstableSource re-fetches this
      // full normalized URL, so DOM from a previous candidate is never reused.
      const technicalRecoveryInputUrl = candidateDiscoveryUrl;
      recovery = await recoverUnstableSource({ ...university, candidateUrl: technicalRecoveryInputUrl, primaryReason: "CANDIDATE_DISCOVERY_HANDOFF_V2" });
      const qualityInputUrl = recovery.candidateUrl;
      candidateHandoffError = candidateDiscoveryUrl !== technicalRecoveryInputUrl || candidateDiscoveryUrl !== qualityInputUrl;
      if (candidateHandoffError) finalDecision = "CANDIDATE_HANDOFF_ERROR";
      else {
        quality = validateSourceQuality({ university, recoveryResult: recovery, sourceCandidate: qualityInputUrl, sharedSource: false, discoverySourceScope: discovery.discoverySourceScope });
        if (quality.decision === "QUALITY_REVIEW") { qualityRecovery = recoverSourceQuality({ item: { ...university, recovery, quality } }); quality = qualityRecovery.quality; recovery = qualityRecovery.recovery; }
        finalDecision = quality.decision === "QUALITY_APPROVED" ? "QUALITY_APPROVED" : "QUALITY_REVIEW_FINAL";
        if (finalDecision === "QUALITY_APPROVED") collector = await collectorDryRun(university, recovery, quality.sourceScope);
      }
      items.push({ ...university, discovery, candidateDiscoveryUrl, technicalRecoveryInputUrl, qualityInputUrl, candidateHandoffError, recovery, quality, qualityRecovery, collector, finalDecision });
    } else items.push({ ...university, discovery, candidateDiscoveryUrl, technicalRecoveryInputUrl: null, qualityInputUrl: null, candidateHandoffError, recovery, quality, qualityRecovery, collector, finalDecision });
  }
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "server/agent/data/agent-news-store.json"), "utf8")), preview = JSON.parse(fs.readFileSync(path.join(ROOT, "data/university-news-preview.json"), "utf8"));
  const report = { phase: "candidate_handoff_v2", batch: "003", processed: items.length, baseline: { verified: 49, store: store.totalItems, preview: preview.items.length }, qualityApproved: items.filter(x => x.finalDecision === "QUALITY_APPROVED").length, candidateHandoffErrors: items.filter(x => x.candidateHandoffError).length, candidateUrlChanged: items.filter(x => x.discovery.candidateChanged).length, falseReadyFixed: items.filter(x => x.discovery.decision === "CANDIDATE_REVIEW" && x.discovery.candidates.some(c => c.candidateScore < 60)).length, menuContaminationResolved: items.filter(x => x.discovery.menuContaminationResolved).length, collectorConfigReady: items.filter(x => x.collector?.finalDecision === "COLLECTOR_CONFIG_READY").length, items, mutations: { source: false, store: false, preview: false, verified: false, git: false, render: false } };
  write(OUT, report); fs.writeFileSync(OUT.replace(/\.json$/, ".md"), `# Candidate Handoff v2\n\nProcessed: ${report.processed}\nQuality approved: ${report.qualityApproved}\nHandoff errors: ${report.candidateHandoffErrors}\nCollector ready: ${report.collectorConfigReady}\n`, "utf8"); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
