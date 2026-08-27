"use strict";

// One-time, allow-listed activation for Collector Configuration Agent test4.
// It never discovers or enables any university outside the four reviewed
// candidates, and leaves a complete backup before changing operating files.
const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");
const { parseDate } = require("../../../../development/university-news/utils/parse-date");
const { normalizeUrl } = require("../../../../development/university-news/utils/normalize-url");
const { filterNewItems } = require("../../dedup");
const { getAllItems, saveNewItems, STORE_PATH, PREVIEW_PATH, isPublicPreviewItem } = require("../../store");

const ROOT = path.resolve(__dirname, "../../../..");
const CATALOG = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const CANDIDATES = path.join(ROOT, "server", "agent", "onboarding", "data", "collector-config-candidates.json");
const TEST_REPORT = path.join(ROOT, "server", "agent", "onboarding", "reports", "collector-config", "collector-config-test4.json");
const REPORT_DIR = path.join(ROOT, "server", "agent", "onboarding", "reports", "collector-activation");
const BACKUP_ROOT = path.join(ROOT, "server", "agent", "onboarding", "backups");
const TARGET_IDS = new Set([
  "daegu-catholic-university-본교",
  "tongmyong-university-본교",
  "sungkyunkwan-university-natural-sciences",
  "korea-national-sport-university-본교",
]);

function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeAtomic(file, value) { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, file); }
function normalizedText(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/^NEW\s*/i, "").trim().toLowerCase(); }
function sameTitle(left, right) { const a = normalizedText(left).replace(/[^\p{L}\p{N}]/gu, ""); const b = normalizedText(right).replace(/[^\p{L}\p{N}]/gu, ""); return Boolean(a && b && (a === b || a.includes(b) || b.includes(a))); }
function sameOfficialHost(url, listUrl) { try { return new URL(url).hostname.replace(/^www\./i, "") === new URL(listUrl).hostname.replace(/^www\./i, ""); } catch { return false; } }
function validDetailUrl(url, source) { const normal = normalizeUrl(url); const list = normalizeUrl(source.listUrl); return Boolean(normal && normal !== list && sameOfficialHost(normal, source.listUrl) && new URL(normal).pathname !== "/" && !/(?:login|signin|auth|error|404|500)/i.test(new URL(normal).pathname)); }
function detailValues(html, selector) { return findBySelector(html, selector || "").map(textOf).filter(Boolean); }
function detailDate(html, source) { for (const raw of detailValues(html, source.detailSelectors?.date)) { const parsed = parseDate(raw, source.datePolicy || {}); if (parsed.value) return { raw, value: parsed.value }; } return { raw: null, value: null }; }
function futureDate(value) { return Boolean(value && Date.parse(`${value.slice(0, 10)}T23:59:59Z`) > Date.now() + 24 * 60 * 60 * 1000); }
function backup() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const dir = path.join(BACKUP_ROOT, `collector-ready-activation-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = [CATALOG, STORE_PATH, PREVIEW_PATH, path.join(ROOT, "development", "university-news", "collectors", "html-list-collector.js"), path.join(ROOT, "development", "university-news", "collectors", "normalize-collected-item.js"), path.join(ROOT, "development", "university-news", "utils", "parse-date.js")];
  for (const file of files) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  return dir;
}
function validateBeforeActivation(candidate, dry) {
  const measured = dry && dry.collection || {};
  return candidate.finalDecision === "COLLECTOR_CONFIG_READY" && measured.count >= 2 && measured.validTitle >= 2 && measured.validLink >= 2 && measured.validPublishedAt >= 2 && measured.nullPublishedAt === 0 && dry.details.every(item => item.officialDomain);
}
async function collect(university, source) {
  const collected = await htmlListCollector({ university, source, limit: 3 });
  const accepted = [], excluded = [];
  for (const item of collected.items || []) {
    if (!item.title || !item.publishedAt || futureDate(item.publishedAt) || item.universityId !== university.universityId || item.sourceId !== source.id || item.category !== source.category || !validDetailUrl(item.sourceUrl, source)) { excluded.push({ title: item.title || "", reason: "list_validation_failed" }); continue; }
    try {
      const response = await fetch(item.sourceUrl, { headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
      const html = await response.text();
      const detailTitle = detailValues(html, source.detailSelectors?.title)[0] || "";
      const date = detailDate(html, source);
      const finalUrl = normalizeUrl(response.url);
      const officialNameFound = (source.officialNames || [university.universityName]).some(name => normalizedText(html).includes(normalizedText(name)));
      if (!response.ok || !validDetailUrl(finalUrl, source) || !officialNameFound || !sameTitle(item.title, detailTitle)) { excluded.push({ title: item.title, reason: "detail_validation_failed" }); continue; }
      // A verified list date is intentionally retained only for an opted-in
      // source. Otherwise the displayed detail date must be real and valid.
      const conflict = date.value && item.publishedAt ? Math.abs(Date.parse(`${date.value}T00:00:00Z`) - Date.parse(`${item.publishedAt}T00:00:00Z`)) / 86400000 : 0;
      if ((!date.value && item.dateSource !== "verified_list_date") || (conflict > (source.datePolicy?.rejectDetailDateIfConflictDaysGreaterThan || Infinity) && item.dateSource !== "verified_list_date")) { excluded.push({ title: item.title, reason: "detail_date_validation_failed" }); continue; }
      accepted.push({ ...item, sourceUrl: finalUrl, detailValidation: { verified: true, sourceTitle: textOf(detailTitle), sourceDate: date.raw, detailDate: date.value, dateDeltaDays: conflict } });
    } catch (error) { excluded.push({ title: item.title, reason: "detail_fetch_failed", error: error.message }); }
  }
  return { found: (collected.items || []).length, accepted, excluded, warnings: collected.warnings || [] };
}
function mainReportMarkdown(result) { return `# UNI PICK Collector Ready Activation\n\n- 처리: ${result.processed}\n- 성공: ${result.activatedSuccess}\n- 실패: ${result.activationFailed}\n- 차단: ${result.activationBlocked}\n- Store: ${result.store.before} → ${result.store.after}\n- Preview: ${result.preview.before} → ${result.preview.after}\n\nGit/Render status: not run by this tool.\n`; }
async function main() {
  const catalog = read(CATALOG), candidates = read(CANDIDATES), dryReport = read(TEST_REPORT);
  const dryById = new Map(dryReport.items.map(item => [item.universityId, item]));
  const requestedId = process.argv.find(value => value.startsWith("--university-id="))?.slice("--university-id=".length);
  const selected = candidates.items.filter(item => TARGET_IDS.has(item.universityId) && (!requestedId || item.universityId === requestedId));
  if ((!requestedId && selected.length !== 4) || (requestedId && selected.length !== 1) || selected.some(item => !validateBeforeActivation(item, dryById.get(item.universityId)))) throw new Error("activation_precheck_failed");
  const sourceIds = catalog.universities.flatMap(row => (row.sources || []).map(source => source.id));
  // Older campus records intentionally share three existing source IDs. They
  // are not part of this activation and must not be rewritten here. We only
  // reject a collision introduced by one of the four new candidates.
  const existingSourceIdDuplicates = [...new Set(sourceIds.filter((id, index) => sourceIds.indexOf(id) !== index))];
  const before = { verified: catalog.universities.filter(row => (row.sources || []).some(source => source.verified)).length, store: getAllItems().length, preview: read(PREVIEW_PATH).items.length };
  const backupDir = backup();
  const results = [], allAccepted = [];
  for (const candidate of selected) {
    const university = catalog.universities.find(row => row.universityId === candidate.universityId);
    const officialNames = [university.universityName];
    // The central SKKU newsroom is officially operated for both campuses, but
    // its pages display the institutional name rather than a campus suffix.
    if (university.universityId === "sungkyunkwan-university-natural-sciences") officialNames.push("성균관대학교");
    const source = { ...candidate.source, officialNames };
    const existing = (university.sources || []).find(entry => entry.id === source.id);
    if (existing && existing.verified) { results.push({ universityId: university.universityId, universityName: university.universityName, status: "ACTIVATION_BLOCKED", reason: "verified_source_would_be_overwritten" }); continue; }
    try {
      const outcome = await collect(university, source);
      if (outcome.accepted.length < 2 || outcome.accepted.some(item => !item.publishedAt || !sameOfficialHost(item.sourceUrl, source.listUrl))) { results.push({ universityId: university.universityId, universityName: university.universityName, status: "ACTIVATION_FAILED", ...outcome }); continue; }
      allAccepted.push(...outcome.accepted);
      results.push({ universityId: university.universityId, universityName: university.universityName, status: "ACTIVATED_SUCCESS", sourceId: source.id, source, ...outcome });
    } catch (error) { results.push({ universityId: university.universityId, universityName: university.universityName, status: "ACTIVATION_FAILED", reason: error.message }); }
  }
  const storeBefore = getAllItems();
  let { newItems, duplicateCount } = filterNewItems(allAccepted, storeBefore);
  // The public preview has a size cap. Treat a university that cannot appear
  // there as a per-university activation failure before any operating file is
  // written, rather than silently activating an invisible source.
  const prospectivePreview = [...newItems, ...storeBefore].filter(isPublicPreviewItem).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 30);
  const invisibleIds = new Set(results.filter(row => row.status === "ACTIVATED_SUCCESS" && !prospectivePreview.some(item => item.universityId === row.universityId)).map(row => row.universityId));
  for (const row of results) if (invisibleIds.has(row.universityId)) { row.status = "ACTIVATION_FAILED"; row.reason = "preview_capacity_excludes_university"; }
  if (invisibleIds.size) {
    allAccepted.length = 0;
    for (const row of results.filter(row => row.status === "ACTIVATED_SUCCESS")) allAccepted.push(...row.accepted);
    ({ newItems, duplicateCount } = filterNewItems(allAccepted, storeBefore));
  }
  const successfulIds = new Set(results.filter(row => row.status === "ACTIVATED_SUCCESS").map(row => row.universityId));
  for (const candidate of selected.filter(row => successfulIds.has(row.universityId))) {
    const university = catalog.universities.find(row => row.universityId === candidate.universityId);
    const officialNames = [university.universityName];
    if (university.universityId === "sungkyunkwan-university-natural-sciences") officialNames.push("성균관대학교");
    const source = { ...candidate.source, officialNames, verified: true, enabled: true, status: "verified", healthStatus: "unknown" };
    const index = (university.sources || []).findIndex(entry => entry.id === source.id);
    if (index >= 0) university.sources[index] = source; else university.sources.push(source);
  }
  const allAfterIds = catalog.universities.flatMap(row => (row.sources || []).map(source => source.id));
  const introducedDuplicates = [...successfulIds].filter(universityId => {
    const id = selected.find(item => item.universityId === universityId).source.id;
    return allAfterIds.filter(value => value === id).length !== 1;
  });
  if (introducedDuplicates.length) throw new Error(`source_id_duplicate_after_activation:${introducedDuplicates.join(",")}`);
  if (successfulIds.size) writeAtomic(CATALOG, catalog);
  if (newItems.length) saveNewItems(newItems);
  const preview = read(PREVIEW_PATH);
  for (const row of results.filter(row => row.status === "ACTIVATED_SUCCESS")) {
    row.newCount = newItems.filter(item => item.universityId === row.universityId).length;
    row.previewCount = preview.items.filter(item => item.universityId === row.universityId).length;
    if (row.previewCount < 1) throw new Error(`preview_postcondition_failed:${row.universityId}`);
  }
  const result = { phase: "collector_ready_activation", generatedAt: new Date().toISOString(), processed: selected.length, activatedSuccess: results.filter(row => row.status === "ACTIVATED_SUCCESS").length, activationFailed: results.filter(row => row.status === "ACTIVATION_FAILED").length, activationBlocked: results.filter(row => row.status === "ACTIVATION_BLOCKED").length, results, sourceIdDuplicates: { existingShared: existingSourceIdDuplicates, introduced: introducedDuplicates }, store: { before: before.store, after: getAllItems().length, added: newItems.length, duplicateCount }, preview: { before: before.preview, after: preview.items.length, added: preview.items.length - before.preview }, verified: { before: before.verified, after: catalog.universities.filter(row => (row.sources || []).some(source => source.verified)).length }, backupDir, configChanged: successfulIds.size > 0, storeChanged: newItems.length > 0, previewChanged: preview.items.length !== before.preview, git: "not_run", render: "not_run" };
  fs.mkdirSync(REPORT_DIR, { recursive: true }); writeAtomic(path.join(REPORT_DIR, "collector-ready-activation.json"), result); fs.writeFileSync(path.join(REPORT_DIR, "collector-ready-activation.md"), mainReportMarkdown(result), "utf8");
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
