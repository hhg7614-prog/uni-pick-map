"use strict";

/*
 * UNI PICK next-batch resolver.
 * Default is a networked dry-run.  Only --apply can change the catalog.
 * It never writes the collection store or preview and never calls git/deploy.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");
const DATA = path.join(ROOT, "server", "agent", "data");
const EVALUATION_FILE = path.join(DATA, "uni-pick-next-batch-candidate-evaluation.json");
const DISCOVERY_FILE = path.join(DATA, "uni-pick-next-batch-safe-discovery.json");
const OUTPUT_FILE = path.join(DATA, "uni-pick-next-batch-auto-resolution.json");
const CATALOG_CANDIDATES = [
  path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json"),
  path.join(DATA, "university-news-sources.final.json")
];
const STORE_CANDIDATES = [path.join(DATA, "university-news-store.json"), path.join(ROOT, "development", "university-news", "data", "university-news-store.json")];
const PREVIEW_CANDIDATES = [path.join(DATA, "university-news-preview.json"), path.join(ROOT, "development", "university-news", "data", "university-news-preview.json")];
const DEEP_DISCOVERY_TOOL = path.join(__dirname, "run-uni-pick-next-batch-safe-discovery.js");
const APPLY = process.argv.includes("--apply");
const REFRESH_DISCOVERY = process.argv.includes("--refresh-discovery");
const MAX_DEEP_DISCOVERY_REQUESTS_PER_UNIVERSITY = 8;
const DETAIL_SAMPLE_SIZE = 3;
const MIN_ITEMS = 5;

function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; } }
function atomicWrite(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, file); }
function firstExisting(files) { return files.find(file => fs.existsSync(file)) || null; }
function hash(file) { return file && fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null; }
function id(value) { return String(value || "").normalize("NFC").trim(); }
function plain(value) { return String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/\s+/g, " ").trim(); }
function normalizeUrl(value, base) { try { const url = new URL(String(value || ""), base); url.hash = ""; return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } }
function hostSuffix(url) { try { const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split("."); return labels.slice(labels.length >= 3 && labels.at(-2) === "ac" && labels.at(-1) === "kr" ? -3 : -2).join("."); } catch { return null; } }
function isOfficial(candidateUrl, homepage) { const a = hostSuffix(candidateUrl); const b = hostSuffix(homepage); return Boolean(a && b && a === b); }
function dateCount(html) { return (String(html).match(/\b(?:19|20)\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\b/g) || []).length; }
function classifyError(error) { const text = String(error?.message || error || "").toLowerCase(); return /403|429|access denied|forbidden|cloudflare|captcha|timeout|econnreset|enotfound|fetch failed/.test(text) ? "ENVIRONMENT_BLOCKED" : "MANUAL_REVIEW"; }
function makeSource(item, validation) {
  const url = validation.finalUrl;
  const cms = /\/CMS\/Board\/Board\.do/i.test(url);
  const catholic = /catholic\.ac\.kr\/ko\/campuslife\/notice\.do/i.test(url);
  const konyang = /konyang\.ac\.kr\/cop\/bbs\/BBSMSTR_000000000585\/selectBoardList\.do/i.test(url);
  if (!cms && !catholic && !konyang) return null; // Never invent unverified selectors for an unknown template.
  const selectors = catholic
    ? { item: "tbody tr", title: "td.b-td-title a.b-title", link: "td.b-td-title a.b-title", linkAttribute: "href", date: "td.b-td-title .b-date" }
    : konyang
      ? { item: "tbody tr", title: "td.left .list_subject a", link: "td.left .list_subject a", linkAttribute: "href", date: "td.date" }
      : { item: "tbody tr", title: "td.subject a", link: "td.subject a", linkAttribute: "href", date: "td.date" };
  return {
    id: `${item.universityId.replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "").toLowerCase()}-direct-verified-${item.candidateType === "NEWS_BOARD" ? "news" : "notice"}`,
    name: `${item.universityName} ${item.candidateType === "NEWS_BOARD" ? "대학소식" : "공지사항"}`,
    category: item.candidateType === "NEWS_BOARD" ? "school_news" : "school_notice",
    sourceType: "official", collectionType: "html", listUrl: url,
    baseUrl: new URL(url).origin,
    selectors,
    officialNames: [item.universityName], verified: true, enabled: true,
    status: "verified", healthStatus: "validated", verifiedAt: new Date().toISOString(),
    campusScope: "CAMPUS_SPECIFIC", canonicalOwner: item.universityId,
    collectOnce: false, duplicateStorage: false,
    notes: "UNI PICK 통합 자동 검증: 공식 도메인, 목록/상세 링크, 날짜, 중복 키를 확인한 direct verified source입니다."
  };
}
async function fetchText(url) { const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "UNI-PICK-safe-validator/1.0", accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`HTTP_${response.status}`); return { finalUrl: response.url, html: await response.text(), status: response.status }; }
function extractLinks(html, base) {
  const output = []; const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let match;
  while ((match = re.exec(html))) { const url = normalizeUrl(match[1].replace(/&amp;/g, "&"), base); const title = plain(match[2]); if (url && title.length >= 2 && !/^\s*(prev|next|이전|다음|목록)\s*$/i.test(title)) output.push({ url, title }); }
  return output;
}
function stableKey(url) { try { const parsed = new URL(url); for (const key of ["articleNo", "nttId", "articleId", "board_seq", "boardSeq", "seq", "idx", "id"]) if (parsed.searchParams.get(key)) return `${key}:${parsed.searchParams.get(key)}`; const match = parsed.pathname.match(/\/(\d+)(?:\/|$)/); return match ? `path:${match[1]}` : null; } catch { return null; } }
function isBoardDetail(url, listUrl) { try { const detail = new URL(url); const list = new URL(listUrl); if (detail.origin !== list.origin) return false; const board = list.pathname.match(/BBSMSTR_\d+/i)?.[0]; if (board) return detail.pathname.includes("selectBoardArticle.do") && detail.href.includes(board); if (list.hostname.includes("catholic.ac.kr")) return detail.pathname === list.pathname && detail.searchParams.get("mode") === "view" && detail.searchParams.has("articleNo"); if (/\/CMS\/Board\/Board\.do/i.test(list.pathname)) return detail.pathname === list.pathname && detail.searchParams.get("mode") === "view" && detail.searchParams.has("board_seq"); return false; } catch { return false; } }
async function validateCandidate(item, candidate) {
  const started = Date.now(); const requested = candidate?.finalUrl || candidate?.url;
  if (!requested || !candidate?.reachable || !candidate?.officialDomain) return { pass: false, state: "MANUAL_REVIEW", reasons: ["CANDIDATE_PRECONDITION_FAILED"] };
  try {
    const list = await fetchText(requested);
    if (!isOfficial(list.finalUrl, item.finalHomepage)) return { pass: false, state: "MANUAL_REVIEW", reasons: ["OFFICIAL_DOMAIN_MISMATCH"], finalUrl: list.finalUrl };
    const links = extractLinks(list.html, list.finalUrl).filter(link => isBoardDetail(link.url, list.finalUrl)).map(link => ({ ...link, key: stableKey(link.url) })).filter(link => link.key);
    const unique = new Map(); for (const link of links) if (!unique.has(link.key)) unique.set(link.key, link);
    const entries = [...unique.values()].slice(0, DETAIL_SAMPLE_SIZE);
    const details = [];
    for (const entry of entries) { const detail = await fetchText(entry.url); const body = plain(detail.html); details.push({ key: entry.key, url: detail.finalUrl, title: entry.title, titlePass: body.includes(entry.title), datePass: dateCount(body) > 0, official: isOfficial(detail.finalUrl, item.finalHomepage) }); }
    const detailPass = details.length >= 1 && details.every(row => row.titlePass && row.datePass && row.official);
    const pass = unique.size >= MIN_ITEMS && dateCount(list.html) >= MIN_ITEMS && details.length === DETAIL_SAMPLE_SIZE && detailPass;
    return { pass, state: pass ? "ACTIVATION_READY" : "MANUAL_REVIEW", finalUrl: list.finalUrl, collector: { extracted: links.length, unique: unique.size, duplicateKeys: links.length - unique.size, dateCount: dateCount(list.html) }, detailValidation: { tested: details.length, pass: details.filter(row => row.titlePass && row.datePass && row.official).length, details }, elapsedMs: Date.now() - started, reasons: pass ? [] : ["COLLECTOR_OR_DETAIL_VALIDATION_FAILED"] };
  } catch (error) { return { pass: false, state: classifyError(error), reasons: [String(error?.message || error)], elapsedMs: Date.now() - started }; }
}
function createBackup(catalogFile) { const dir = path.join(DATA, "backups", "uni-pick-next-batch-auto-resolution", new Date().toISOString().replace(/[:.]/g, "-")); fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(catalogFile, path.join(dir, path.basename(catalogFile))); return dir; }
function allSources(catalog) { return (catalog.universities || []).flatMap(university => (university.sources || []).map(source => ({ university, source }))); }
function activate(catalogFile, catalog, activation) {
  const backup = createBackup(catalogFile); const sources = allSources(catalog); const owner = (catalog.universities || []).find(university => id(university.universityId) === id(activation.item.universityId));
  if (!owner) throw new Error("CANONICAL_OWNER_NOT_FOUND");
  if (sources.some(row => row.source?.id === activation.source.id || normalizeUrl(row.source?.listUrl) === normalizeUrl(activation.source.listUrl))) throw new Error("DUPLICATE_SOURCE_ID_OR_LIST_URL");
  try { owner.sources = Array.isArray(owner.sources) ? owner.sources : []; owner.sources.push(activation.source); atomicWrite(catalogFile, catalog); const reparsed = readJson(catalogFile); const matches = allSources(reparsed).filter(row => row.source?.id === activation.source.id); if (matches.length !== 1 || id(matches[0].university.universityId) !== id(owner.universityId)) throw new Error("POST_ACTIVATION_VALIDATION_FAILED"); return { activated: true, backup, rollback: false }; }
  catch (error) { fs.copyFileSync(path.join(backup, path.basename(catalogFile)), catalogFile); throw Object.assign(error, { backup, rollback: true }); }
}
function refreshDiscovery() { if (!REFRESH_DISCOVERY) return { requested: false, executed: false }; if (!fs.existsSync(DEEP_DISCOVERY_TOOL)) return { requested: true, executed: false, error: "SAFE_DISCOVERY_TOOL_NOT_FOUND" }; const result = spawnSync(process.execPath, [DEEP_DISCOVERY_TOOL], { cwd: ROOT, encoding: "utf8", windowsHide: true }); return { requested: true, executed: true, exitCode: result.status, stderr: String(result.stderr || "").trim() || null }; }
async function main() {
  const catalogFile = firstExisting(CATALOG_CANDIDATES); if (!catalogFile || !fs.existsSync(EVALUATION_FILE)) throw new Error("REQUIRED_INPUT_FILE_NOT_FOUND");
  const refresh = refreshDiscovery(); const evaluation = readJson(EVALUATION_FILE); const discovery = readJson(DISCOVERY_FILE, { universities: [] }); const catalog = readJson(catalogFile); const storeFile = firstExisting(STORE_CANDIDATES); const previewFile = firstExisting(PREVIEW_CANDIDATES);
  const hashesBefore = { catalog: hash(catalogFile), store: hash(storeFile), preview: hash(previewFile) }; const results = []; const activations = [];
  for (const item of evaluation.evaluatedItems || []) {
    if (item.state === "RESOLVED") { results.push({ universityId: item.universityId, universityName: item.universityName, initialState: item.state, finalState: "RESOLVED", action: "SKIPPED_ALREADY_RESOLVED" }); continue; }
    const alreadyEnabled = (catalog.universities || []).some(university => id(university.universityId) === id(item.universityId) && (university.sources || []).some(source => source?.verified === true && source?.enabled === true));
    if (alreadyEnabled) { results.push({ universityId: item.universityId, universityName: item.universityName, initialState: item.state, finalState: "RESOLVED", action: "SKIPPED_ALREADY_ENABLED_SOURCE" }); continue; }
    const discoveryItem = (discovery.universities || []).find(row => id(row.universityId) === id(item.universityId));
    if (item.state === "IDENTITY_REVIEW" && !(discoveryItem?.identityVerified || discoveryItem?.identity?.pass === true)) { results.push({ universityId: item.universityId, universityName: item.universityName, initialState: item.state, finalState: "MANUAL_REVIEW", action: "IDENTITY_NOT_AUTOMATICALLY_CONFIRMED", identity: discoveryItem?.identity || null }); continue; }
    let candidate = item.bestCandidate;
    if (item.state === "DEEP_DISCOVERY") candidate = discoveryItem?.bestCandidate || null;
    if (!candidate) { results.push({ universityId: item.universityId, universityName: item.universityName, initialState: item.state, finalState: "MANUAL_REVIEW", action: item.state === "DEEP_DISCOVERY" ? "SAFE_DEEP_DISCOVERY_NO_CANDIDATE" : "NO_CANDIDATE", deepDiscoveryRequestLimit: item.state === "DEEP_DISCOVERY" ? MAX_DEEP_DISCOVERY_REQUESTS_PER_UNIVERSITY : null }); continue; }
    const validation = await validateCandidate(item, candidate); const source = validation.pass ? makeSource(item, validation) : null;
    const finalState = validation.pass && source ? (APPLY ? "ACTIVATION_READY" : "ACTIVATION_READY_DRY_RUN") : (validation.pass ? "MANUAL_REVIEW" : validation.state);
    const result = { universityId: item.universityId, universityName: item.universityName, initialState: item.state, finalState, action: validation.pass && source ? (APPLY ? "ACTIVATE_LOCAL_CATALOG" : "DRY_RUN_ACTIVATION_READY") : "PRESERVE_WITH_REASON", candidate: { text: candidate.text || null, url: candidate.finalUrl || candidate.url || null }, validation, proposedSource: source, activation: null };
    if (validation.pass && source) activations.push({ item, source, result }); results.push(result);
  }
  if (APPLY) for (const activation of activations) { try { activation.result.activation = activate(catalogFile, catalog, activation); activation.result.finalState = "RESOLVED"; } catch (error) { activation.result.finalState = "MANUAL_REVIEW"; activation.result.action = "ACTIVATION_ROLLED_BACK"; activation.result.activation = { activated: false, rollback: error.rollback === true, backup: error.backup || null, error: error.message }; } }
  const hashesAfter = { catalog: hash(catalogFile), store: hash(storeFile), preview: hash(previewFile) }; const counts = {}; for (const result of results) counts[result.finalState] = (counts[result.finalState] || 0) + 1;
  const report = { schemaVersion: "1.0", generatedAt: new Date().toISOString(), decision: APPLY ? "NEXT_BATCH_AUTO_RESOLUTION_APPLIED" : "NEXT_BATCH_AUTO_RESOLUTION_DRY_RUN", mode: APPLY ? "APPLY" : "DRY_RUN", processed: results.length, counts, results, nextAction: APPLY ? "REVIEW_MANUAL_REVIEW_AND_ENVIRONMENT_BLOCKED" : "REVIEW_DRY_RUN_THEN_RERUN_WITH_APPLY_IF_ACCEPTED", refreshDiscovery: refresh, safety: { directVerifiedSourcePriority: true, sharedSourcePolicy: { collectOnce: true, duplicateStorage: false, canonicalOwnerOnly: true, visibleToCampuses: "preserved when a shared source is explicitly proposed" }, catalogModified: hashesBefore.catalog !== hashesAfter.catalog, storeModified: hashesBefore.store !== hashesAfter.store, previewModified: hashesBefore.preview !== hashesAfter.preview, sourceModified: false, queueModified: false, gitTriggered: false, deploymentTriggered: false, automaticMutation: APPLY, rollbackSupported: true }, inputFiles: { evaluation: EVALUATION_FILE, discovery: DISCOVERY_FILE, catalog: catalogFile }, outputFile: OUTPUT_FILE };
  atomicWrite(OUTPUT_FILE, report); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { const report = { decision: "FATAL", error: { name: error.name, message: error.message, stack: error.stack }, safety: { gitTriggered: false, deploymentTriggered: false } }; try { atomicWrite(OUTPUT_FILE, report); } catch {} console.error(JSON.stringify(report, null, 2)); process.exitCode = 1; });
