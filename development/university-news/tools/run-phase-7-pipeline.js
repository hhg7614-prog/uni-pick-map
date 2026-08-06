"use strict";

// Phase 7 is deliberately a manual developer tool.  It is never imported by
// the web app and does not run when `npm start` is used.
const fs = require("fs");
const path = require("path");
const { getCollector } = require("../collectors/collector-factory");
const { sleep } = require("../utils/sleep");
const { validateUniversityNewsItem } = require("../utils/validate-news-item");
const { normalizeUrl } = require("../utils/normalize-url");
const { normalizeTitle } = require("../utils/normalize-title");
const { createUrlHash, createContentHash } = require("../utils/create-hash");
const storeRepository = require("../repositories/local-news-store");
const { getProvider } = require("../ai/ai-provider");
const { processNewsItem } = require("../ai/news-ai-processor");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const REPORTS = path.join(ROOT, "reports");
const BACKUPS = path.join(ROOT, "backups");
const TEMP = path.join(ROOT, "temp");
const SOURCES = path.join(DATA, "university-news-sources.phase-2.json");
const PREVIEW = path.resolve(ROOT, "..", "..", "data", "university-news-preview.json");
const TARGETS = {
  snu: "seoul-national-university-gwanak",
  yonsei: "yonsei-university-sinchon",
  hanyang: "hanyang-university-seoul"
};
const ALLOWED_IDS = new Set(Object.values(TARGETS));
const VALID_PROVIDERS = new Set(["disabled", "mock", "openai", "gemini"]);

function now() { return new Date().toISOString(); }
function idStamp() { return now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-"); }
function runId() { return `phase7-${idStamp()}-${Math.random().toString(36).slice(2, 6)}`; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, "utf8"); }
function loadDotEnv() { const file = path.resolve(ROOT, "..", "..", ".env"); if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }

function readOptions(argv) {
  const option = { dryRun: false, noNetwork: false, skipAi: false, skipPreview: false, forceAi: false, yes: false, collectionLimit: 5, aiLimit: 15, provider: "disabled", universities: new Set(Object.keys(TARGETS)) };
  let universityArgs = [];
  for (const arg of argv) {
    if (arg === "--dry-run") option.dryRun = true;
    else if (arg === "--no-network") option.noNetwork = true;
    else if (arg === "--skip-ai") option.skipAi = true;
    else if (arg === "--skip-preview") option.skipPreview = true;
    else if (arg === "--force-ai") option.forceAi = true;
    else if (arg === "--yes") option.yes = true;
    else if (arg.startsWith("--collection-limit=")) option.collectionLimit = Math.max(1, Math.min(5, Number(arg.slice(19)) || 5));
    else if (arg.startsWith("--ai-limit=")) option.aiLimit = Math.max(1, Math.min(15, Number(arg.slice(11)) || 15));
    else if (arg.startsWith("--provider=")) option.provider = arg.slice(11).toLowerCase();
    else if (arg.startsWith("--university=")) universityArgs = [arg.slice(13).toLowerCase()];
    else if (arg.startsWith("--universities=")) universityArgs = arg.slice(15).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  }
  if (universityArgs.length) option.universities = new Set(universityArgs);
  for (const alias of option.universities) if (!TARGETS[alias]) throw new Error("학교 옵션은 snu, yonsei, hanyang만 사용할 수 있습니다.");
  if (!VALID_PROVIDERS.has(option.provider)) throw new Error("지원하지 않는 AI provider입니다.");
  if (["openai", "gemini"].includes(option.provider) && !argv.some((arg) => arg.startsWith("--provider="))) throw new Error("실제 AI provider는 --provider 옵션으로 명시해야 합니다.");
  return option;
}

function isHttp(value) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function officialUrl(item, university) { try { return (university.approvedDomains || []).includes(new URL(item.sourceUrl).hostname); } catch { return false; } }
function eligibleSource(source) {
  const selectors = source.selectors || {};
  return source.category !== "media_news" && source.status === "verified" && source.sourceType === "official" && !source.requiresJavascript && ["rss", "html"].includes(source.collectionType) && (source.collectionType !== "html" || (source.listUrl && selectors.item && selectors.title && selectors.link)) && (source.collectionType !== "rss" || source.rssUrl);
}
function prepare(item, storedAt, pipelineRunId) {
  const validation = validateUniversityNewsItem(item);
  if (!validation.valid || item.status === "failed") return { item: null, reason: validation.errors.join(" ") || "수집 항목 검증 실패" };
  const normalizedSourceUrl = normalizeUrl(item.sourceUrl);
  const normalizedTitle = normalizeTitle(item.title);
  if (!normalizedSourceUrl || !normalizedTitle) return { item: null, reason: "URL 또는 제목 정규화 실패" };
  const result = { ...item, normalizedSourceUrl, normalizedTitle, urlHash: createUrlHash(normalizedSourceUrl), storedAt, pipelineRunId };
  result.contentHash = createContentHash(result);
  return { item: result, reason: null };
}
function sameDuplicate(item, existing) {
  if (existing.normalizedSourceUrl === item.normalizedSourceUrl || existing.sourceUrl === item.normalizedSourceUrl) return "same_source_url";
  if (existing.urlHash === item.urlHash) return "same_url_hash";
  if (existing.contentHash === item.contentHash) return "same_content_hash";
  return null;
}
function backupFile(source, filename) { if (!fs.existsSync(source)) return null; fs.mkdirSync(BACKUPS, { recursive: true }); const destination = path.join(BACKUPS, filename); fs.copyFileSync(source, destination); return destination; }
function previewCount() { try { return (JSON.parse(fs.readFileSync(PREVIEW, "utf8")).items || []).length; } catch { return 0; } }
function categoryCounts(items) { return items.reduce((out, item) => { out[item.category] = (out[item.category] || 0) + 1; return out; }, {}); }
function markdown(report) {
  return `# UNI PICK 뉴스 시스템 7단계 실행 보고서\n\n- 실행 ID: ${report.pipelineRunId}\n- 상태: ${report.status}\n- 대상 학교: ${report.targetUniversities}개\n- 수집: ${report.collection.collectedItems}개\n- 신규 저장: ${report.storage.newItems}개\n- 중복: ${report.storage.duplicates}개\n- AI 처리: ${report.ai.successfulItems}개 (${report.ai.provider})\n- 미리보기: ${report.preview.generated ? `${report.preview.itemCount}개` : "기존 파일 유지"}\n\n이 도구는 개발자가 터미널에서 직접 실행할 때만 동작합니다. 사이트를 열거나 새로고침해도 수집하지 않습니다. 신규 글이 0개인 것은 오류가 아니라 이미 저장된 글만 다시 발견한 정상 상황일 수 있습니다.\n\n## 다음 확인\n\n1. 이 파일의 실행 ID와 신규·중복 개수를 확인합니다.\n2. 서울대, 연세대, 한양대를 선택해 기존 학교 소식과 AI/Mock 요약 배지를 확인합니다.\n3. 같은 명령을 다시 실행해 저장소 개수가 중복 증가하지 않는지 확인합니다.\n`;
}

async function main() {
  loadDotEnv();
  const option = readOptions(process.argv.slice(2));
  const pipelineRunId = runId(); const startedAt = now(); const logRows = [];
  const log = (message) => { const line = `[${now()}] ${message}`; logRows.push(line); console.log(line); };
  const sourceEntries = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
  const selectedUniversities = sourceEntries.filter((university) => ALLOWED_IDS.has(university.universityId) && option.universities.has(Object.entries(TARGETS).find(([, id]) => id === university.universityId)?.[0]));
  const store = storeRepository.loadNewsStore();
  const planned = [], skippedSources = [];
  for (const university of selectedUniversities) for (const source of university.sources || []) (eligibleSource(source) ? planned : skippedSources).push({ university, source });
  const report = { phase: 7, pipelineRunId, status: "failed", startedAt, completedAt: null, durationMs: 0, targetUniversities: selectedUniversities.length, targetSources: planned.length + skippedSources.length, collection: { requestedSources: planned.length, successfulSources: 0, failedSources: 0, skippedSources: skippedSources.length, collectedItems: 0, invalidItems: 0 }, storage: { newItems: 0, duplicates: 0, duplicateCandidates: 0, storeBefore: store.items.length, storeAfter: store.items.length }, ai: { provider: option.skipAi ? "disabled" : option.provider, targetItems: 0, successfulItems: 0, failedItems: 0, skippedItems: 0 }, preview: { generated: false, itemCount: previewCount(), fallbackPreserved: true }, byUniversity: [], errors: [] };
  const tempDir = path.join(TEMP, pipelineRunId); fs.mkdirSync(tempDir, { recursive: true });
  log("[1/8] 설정을 확인하고 있습니다.");
  log(`[2/8] 실행 계획: 학교 ${selectedUniversities.length}개, 출처 ${planned.length}개, 최대 수집 ${Math.min(30, planned.length * option.collectionLimit)}개, AI ${report.ai.provider}, 최대 ${option.aiLimit}개, preview ${option.skipPreview ? "아니오" : "예"}`);
  if (option.dryRun) {
    report.status = "dry_run"; report.completedAt = now(); report.durationMs = Date.parse(report.completedAt) - Date.parse(startedAt);
    writeJson(path.join(REPORTS, "phase-7-pipeline-report.json"), report); writeJson(path.join(REPORTS, "phase-7-latest-run.json"), report); writeJson(path.join(REPORTS, `phase-7-${pipelineRunId}.json`), report); writeText(path.join(REPORTS, "phase-7-pipeline-report.md"), markdown(report)); writeText(path.join(ROOT, "logs", `phase-7-${pipelineRunId}.log`), logRows.join("\n") + "\n");
    return console.log(JSON.stringify({ ...report, plannedSources: planned.map(({ university, source }) => ({ universityId: university.universityId, sourceId: source.id, url: source.rssUrl || source.listUrl })) }, null, 2));
  }
  log("[3/8] 학교 소식을 수집하고 있습니다.");
  const collected = []; const perUniversity = new Map();
  if (!option.noNetwork) for (let i = 0; i < planned.length; i += 1) {
    const entry = planned[i]; if (i) await sleep(1500);
    const remainingUniversity = 10 - (perUniversity.get(entry.university.universityId) || 0); const limit = Math.min(option.collectionLimit, 5, remainingUniversity, 30 - collected.length); if (limit <= 0) continue;
    try { const result = await getCollector(entry.source.collectionType).collector({ university: entry.university, source: entry.source, limit }); if (result.status !== "success") throw new Error((result.warnings || []).join(" ") || result.status); const accepted = result.items.filter((item) => officialUrl(item, entry.university)); collected.push(...accepted); perUniversity.set(entry.university.universityId, (perUniversity.get(entry.university.universityId) || 0) + accepted.length); report.collection.successfulSources += 1; }
    catch (error) { report.collection.failedSources += 1; report.errors.push({ stage: "collection", universityId: entry.university.universityId, sourceId: entry.source.id, message: error.message }); }
  } else log("네트워크 요청을 생략했습니다 (--no-network).");
  writeJson(path.join(tempDir, "collected-items.json"), collected);
  log("[4/8] 수집 데이터를 검사하고 있습니다.");
  const validated = collected.filter((item) => { const valid = validateUniversityNewsItem(item).valid; if (!valid) report.collection.invalidItems += 1; return valid; }); report.collection.collectedItems = validated.length; writeJson(path.join(tempDir, "validated-items.json"), validated);
  log("[5/8] 신규 게시물을 저장하고 있습니다.");
  const plannedStoreItems = [...store.items]; const newItems = [];
  for (const item of validated) { const prepared = prepare(item, now(), pipelineRunId); if (!prepared.item) { report.collection.invalidItems += 1; continue; } const duplicate = plannedStoreItems.map((stored) => sameDuplicate(prepared.item, stored)).find(Boolean); if (duplicate) { report.storage.duplicates += 1; continue; } plannedStoreItems.push(prepared.item); newItems.push(prepared.item); report.storage.newItems += 1; }
  writeJson(path.join(tempDir, "storage-plan.json"), { newItems, duplicates: report.storage.duplicates });
  if (newItems.length) { backupFile(storeRepository.getStorePath(), `store-before-${pipelineRunId}.json`); store.items = plannedStoreItems; storeRepository.saveNewsStore(store, { backup: false }); report.storage.storeAfter = plannedStoreItems.length; }
  log("[6/8] AI 요약을 처리하고 있습니다.");
  const provider = getProvider(report.ai.provider); const aiCandidates = option.skipAi ? [] : newItems.filter((item) => option.forceAi || !item.aiProcessed).slice(0, option.aiLimit); report.ai.targetItems = aiCandidates.length;
  for (const item of aiCandidates) { if (provider.name === "disabled") { report.ai.skippedItems += 1; continue; } const outcome = await processNewsItem(item, provider); if (!outcome.ok) { report.ai.failedItems += 1; report.errors.push({ stage: "ai", itemId: item.id, message: outcome.reason }); continue; } item.aiProcessed = true; item.aiProcessedAt = now(); item.aiProvider = provider.name; item.aiModel = provider.model || ""; item.aiResult = outcome.aiResult; item.aiProcessingStatus = "completed"; item.aiProcessingError = null; report.ai.successfulItems += 1; }
  // `newItems` shares object references with `store.items`, so this writes the
  // completed AI fields without touching any existing stored records.
  if (report.ai.successfulItems) storeRepository.saveNewsStore(store, { backup: false });
  writeJson(path.join(tempDir, "ai-plan.json"), { targetItems: aiCandidates.length, provider: provider.name, successfulItems: report.ai.successfulItems });
  log("[7/8] 화면용 데이터를 만들고 있습니다.");
  if (!option.skipPreview) {
    const before = backupFile(PREVIEW, `preview-before-${pipelineRunId}.json`);
    const child = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "build-phase-5-preview.js")], { cwd: process.cwd(), encoding: "utf8" });
    if (child.status === 0) { report.preview.generated = true; report.preview.itemCount = previewCount(); report.preview.fallbackPreserved = false; } else { report.errors.push({ stage: "preview", message: (child.stderr || child.stdout || "Preview build failed").trim() }); if (before) fs.copyFileSync(before, PREVIEW); }
  }
  log("[8/8] 실행 보고서를 생성하고 있습니다.");
  report.byUniversity = selectedUniversities.map((university) => ({ universityId: university.universityId, universityName: university.universityName, collected: perUniversity.get(university.universityId) || 0, newlyStored: newItems.filter((item) => item.universityId === university.universityId).length }));
  report.status = report.errors.length ? (report.storage.newItems || report.collection.successfulSources ? "partial_success" : "success_no_new_items") : (report.storage.newItems ? "success" : "success_no_new_items"); report.completedAt = now(); report.durationMs = Date.parse(report.completedAt) - Date.parse(startedAt);
  writeJson(path.join(tempDir, "errors.json"), report.errors); writeJson(path.join(REPORTS, "phase-7-pipeline-report.json"), report); writeJson(path.join(REPORTS, "phase-7-latest-run.json"), report); writeJson(path.join(REPORTS, `phase-7-${pipelineRunId}.json`), report); writeJson(path.join(REPORTS, "phase-7-errors.json"), report.errors); writeText(path.join(REPORTS, "phase-7-pipeline-report.md"), markdown(report)); writeText(path.join(REPORTS, `phase-7-${pipelineRunId}.md`), markdown(report)); writeText(path.join(ROOT, "logs", `phase-7-${pipelineRunId}.log`), logRows.join("\n") + "\n");
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
