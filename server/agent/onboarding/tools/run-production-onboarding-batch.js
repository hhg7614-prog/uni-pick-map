"use strict";

// Production Batch Agent: bounded to one sequential batch at a time.  It is
// intentionally separate from the scheduled six-university collector.
const fs = require("fs");
const path = require("path");
const { recoverUnstableSource } = require("./recover-unstable-source");
const { recoverSourceCandidate } = require("./recover-source-candidate");
const { validateSourceQuality } = require("./validate-source-quality");
const { recoverSourceQuality } = require("./recover-source-quality");
const { htmlListCollector } = require("../../../../development/university-news/collectors/html-list-collector");

const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports", "production-batch");
const QUEUE = path.join(DATA, "onboarding-smart-retry-queue.json");
const STATE = path.join(DATA, "production-batch-state.json");
const CATALOG = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const BATCH_SIZE = 10;

function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, file); }
function arg(name) { return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
function now() { return new Date().toISOString(); }
function existingSummary(id) { return read(path.join(ROOT, "server", "agent", "onboarding", "reports", id, "summary.json"), {}); }
function isVerified(catalog, id) { return Boolean(catalog.universities.find(u => u.universityId === id && (u.sources || []).some(s => s.verified === true))); }
function status() { console.log(JSON.stringify(read(STATE, { status: "idle", currentIndex: 0, processed: 0, activated: 0, review: 0, technicalReview: 0, collectorReview: 0, failed: 0, networkError: 0, lastBatch: null, lastCommit: null, lastPush: null }), null, 2)); }
async function technicalResult(item) {
  const diagnosis = existingSummary(item.universityId);
  const existingCandidate = diagnosis.recommendedCandidate?.url || diagnosis.candidates?.[0]?.url || null;
  const discovery = await recoverSourceCandidate({ university: item, existingCandidate });
  const candidateUrl = discovery.decision === "CANDIDATE_READY" ? discovery.recommendedCandidate.url : existingCandidate;
  const recovery = await recoverUnstableSource({ universityId: item.universityId, universityName: item.universityName, diagnosis, candidateUrl, primaryReason: item.primaryReason });
  return {
    ...recovery,
    candidateDiscovery: discovery,
    candidateDiscoveryUrl: discovery.recommendedCandidate?.url || null,
    technicalRecoveryInputUrl: candidateUrl,
    qualityInputUrl: candidateUrl,
    discoverySourceScope: discovery.discoverySourceScope || null,
  };
}

// A generic candidate deliberately uses only the production collector's
// supported simple selector grammar. It never writes a source configuration.
async function collectorDryRun(university, recovery) {
  const listUrl = recovery.candidateUrl;
  const selectorSets = [
    { item: "tbody tr", title: "td.subject a", link: "td.subject a", date: "td.data" },
    { item: "tbody tr", title: "td.left a", link: "td.left a", date: "td", dateIndex: 2 },
    { item: "tbody tr", title: "td.b-td-title a", link: "td.b-td-title a", date: "span.b-date", datePolicy: { allowTwoDigitYear: true } },
    { item: "tbody tr", title: "td a", link: "td a", date: "td", dateIndex: 4 },
  ];
  for (const selectors of selectorSets) {
    const source = { id: `onboard-${university.universityId}-candidate`, name: `${university.universityName} 공식 소식 후보`, category: "school_news", categoryLabel: "학교 소식", sourceType: "official", collectionType: "html", listUrl, selectors: { item: selectors.item, title: selectors.title, link: selectors.link, date: selectors.date, ...(Number.isInteger(selectors.dateIndex) ? { dateIndex: selectors.dateIndex } : {}) }, ...(selectors.datePolicy ? { datePolicy: selectors.datePolicy } : {}), verified: false, enabled: false };
    try {
      const outcome = await htmlListCollector({ university, source, limit: 3 });
      const valid = (outcome.items || []).filter(item => item.title && item.sourceUrl && item.publishedAt && new URL(item.sourceUrl).hostname.replace(/^www\./, "") === new URL(listUrl).hostname.replace(/^www\./, ""));
      if (valid.length >= 2 && valid.every(item => item.publishedAt)) return { decision: "COLLECTOR_CONFIG_READY", source, count: valid.length, nullPublishedAt: 0 };
    } catch { /* Try the next intentionally conservative selector set. */ }
  }
  return { decision: "COLLECTOR_CONFIG_REVIEW", reason: "no_safe_production_collector_selector", count: 0, nullPublishedAt: 0 };
}
async function processUniversity(item, catalog, sourceCounts) {
  if (isVerified(catalog, item.universityId)) return { universityId: item.universityId, universityName: item.universityName, finalStatus: "SKIPPED_EXISTING_VERIFIED", collected: 0, previewVisibility: "not_applicable" };
  try {
    const recovery = await technicalResult(item);
    if (recovery.candidateDiscovery?.decision === "CANDIDATE_READY" &&
      (recovery.candidateDiscoveryUrl !== recovery.technicalRecoveryInputUrl || recovery.technicalRecoveryInputUrl !== recovery.qualityInputUrl)) {
      return { universityId: item.universityId, universityName: item.universityName, finalStatus: "CANDIDATE_HANDOFF_ERROR", recovery, collected: 0, previewVisibility: "not_applicable" };
    }
    const quality = validateSourceQuality({ university: item, recoveryResult: recovery, sourceCandidate: recovery.qualityInputUrl, sharedSource: sourceCounts.get(recovery.qualityInputUrl) > 1, discoverySourceScope: recovery.discoverySourceScope });
    let finalQuality = quality;
    let finalRecovery = recovery;
    let qualityRecovery = null;
    if (quality.decision === "QUALITY_REVIEW") {
      qualityRecovery = recoverSourceQuality({ item: { ...item, recovery, quality } });
      finalQuality = qualityRecovery.quality;
      finalRecovery = qualityRecovery.recovery;
    }
    if (finalQuality.decision !== "QUALITY_APPROVED") return { universityId: item.universityId, universityName: item.universityName, finalStatus: "QUALITY_REVIEW_FINAL", recovery: finalRecovery, quality: finalQuality, qualityRecovery, collected: 0, previewVisibility: "not_applicable" };
    const university = catalog.universities.find(u => u.universityId === item.universityId);
    const collector = await collectorDryRun(university, finalRecovery);
    if (collector.decision !== "COLLECTOR_CONFIG_READY") return { universityId: item.universityId, universityName: item.universityName, finalStatus: "COLLECTOR_CONFIG_REVIEW", recovery: finalRecovery, quality: finalQuality, collector, collected: 0, previewVisibility: "not_applicable" };
    // Activation is deliberately not performed by a diagnostic fallback. A
    // ready config becomes an explicit activation candidate; a later batch
    // implementation can call the same production activation transaction.
    return { universityId: item.universityId, universityName: item.universityName, finalStatus: "ACTIVATION_FAILED", reason: "activation_transaction_requires_source_specific_detail_selectors", recovery: finalRecovery, quality: finalQuality, collector, collected: collector.count, previewVisibility: "not_checked" };
  } catch (error) {
    return { universityId: item.universityId, universityName: item.universityName, finalStatus: /fetch|network|abort|timeout|HTTP_/i.test(error.message) ? "NETWORK_ERROR" : "TECHNICAL_REVIEW", reason: error.message, collected: 0, previewVisibility: "not_applicable" };
  }
}
function markdown(report) { return `# UNI PICK Production Batch ${report.batchId}\n\n- Processed: ${report.processed}\n- Activated: ${report.counts.ACTIVATED_SUCCESS}\n- Quality review: ${report.counts.QUALITY_REVIEW_FINAL}\n- Technical review: ${report.counts.TECHNICAL_REVIEW}\n- Collector review: ${report.counts.COLLECTOR_CONFIG_REVIEW}\n- Failed: ${report.counts.ACTIVATION_FAILED}\n- Network: ${report.counts.NETWORK_ERROR}\n- Skipped verified: ${report.counts.SKIPPED_EXISTING_VERIFIED}\n\nNo Git commit or push is attempted unless an activation transaction succeeds.\n`; }
async function main() {
  const startedAt = now();
  if (process.argv.includes("--status")) return status();
  const test = process.argv.includes("--test10");
  const resume = process.argv.includes("--resume");
  const queue = read(QUEUE, { items: [] }); const catalog = read(CATALOG, { universities: [] });
  const state = read(STATE, { currentIndex: 0, processedUniversityIds: [], processed: 0, activated: 0, review: 0, technicalReview: 0, collectorReview: 0, failed: 0, networkError: 0, lastBatch: 0, lastCommit: null, lastPush: null });
  const high = queue.items.filter(item => item.recoveryLikelihood === "HIGH");
  const start = resume ? Number(state.currentIndex || 0) : 0;
  const selected = high.slice(start, start + (test ? BATCH_SIZE : BATCH_SIZE));
  if (!selected.length) { state.status = "completed"; state.updatedAt = now(); write(STATE, state); console.log(JSON.stringify(state, null, 2)); return; }
  const batchNumber = Number(state.lastBatch || 0) + 1; const batchId = `batch-${String(batchNumber).padStart(3, "0")}`;
  state.status = "running"; state.currentIndex = start; state.updatedAt = now(); write(STATE, state);
  const counts = Object.fromEntries(["ACTIVATED_SUCCESS", "QUALITY_REVIEW_FINAL", "TECHNICAL_REVIEW", "COLLECTOR_CONFIG_REVIEW", "ACTIVATION_FAILED", "NETWORK_ERROR", "SKIPPED_EXISTING_VERIFIED", "CANDIDATE_HANDOFF_ERROR"].map(key => [key, 0]));
  const sourceCounts = new Map(); for (const item of selected) { const url = existingSummary(item.universityId).recommendedCandidate?.url; if (url) sourceCounts.set(url, (sourceCounts.get(url) || 0) + 1); }
  const items = [];
  for (const item of selected) {
    state.currentUniversityId = item.universityId; state.currentUniversityName = item.universityName; state.updatedAt = now(); write(STATE, state);
    const result = await processUniversity(item, catalog, sourceCounts); counts[result.finalStatus] = (counts[result.finalStatus] || 0) + 1; items.push(result);
    state.processed++; state.processedUniversityIds = [...new Set([...(state.processedUniversityIds || []), item.universityId])]; state.currentIndex++; state.updatedAt = now(); write(STATE, state);
  }
  state.status = "completed_batch"; state.lastBatch = batchNumber; state.activated += counts.ACTIVATED_SUCCESS; state.review += counts.QUALITY_REVIEW_FINAL; state.technicalReview += counts.TECHNICAL_REVIEW; state.collectorReview += counts.COLLECTOR_CONFIG_REVIEW; state.failed += counts.ACTIVATION_FAILED; state.networkError += counts.NETWORK_ERROR; state.updatedAt = now(); write(STATE, state);
  const completedAt = now();
  const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  const report = { phase: "production_onboarding_batch", batchId, testMode: test, startedAt, completedAt, durationMs, reportTimingError: items.length > 0 && durationMs === 0, processed: items.length, counts, items, git: "not_run_no_activated_transaction", push: "not_run", render: "not_run", stateFile: STATE };
  write(path.join(REPORTS, `${batchId}.json`), report); fs.writeFileSync(path.join(REPORTS, `${batchId}.md`), markdown(report), "utf8"); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
