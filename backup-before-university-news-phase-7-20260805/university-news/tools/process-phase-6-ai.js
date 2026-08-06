"use strict";

const fs = require("fs");
const path = require("path");
const { loadNewsStore, saveNewsStore, getStorePath } = require("../repositories/local-news-store");
const { getProvider } = require("../ai/ai-provider");
const { processNewsItem } = require("../ai/news-ai-processor");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const REPORTS = path.join(ROOT, "reports");
const BACKUPS = path.join(ROOT, "backups");
const TARGETS = {
  snu: ["seoul-national-university-gwanak", "seoul-national-university"],
  yonsei: ["yonsei-university-sinchon", "yonsei-university"],
  hanyang: ["hanyang-university-seoul", "hanyang-university"]
};
const ALL_TARGET_VALUES = new Set(Object.values(TARGETS).flat());
const CATEGORY_TEMPLATE = () => ({ school_news: 0, school_notice: 0, media_news: 0, school_event: 0 });

function loadDotEnv() { const file = path.resolve(ROOT, "..", "..", ".env"); if (!fs.existsSync(file)) return; fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); }); }
function args(argv) { const result = { dryRun: false, force: false, buildPreview: false, includeUnimportant: false, limit: 15, provider: null, university: null }; for (const value of argv) { if (value === "--dry-run") result.dryRun = true; else if (value === "--force") result.force = true; else if (value === "--build-preview") result.buildPreview = true; else if (value === "--include-unimportant") result.includeUnimportant = true; else if (value.startsWith("--provider=")) result.provider = value.slice(11); else if (value.startsWith("--limit=")) result.limit = Math.max(1, Math.min(15, Number(value.slice(8)) || 15)); else if (value.startsWith("--university=")) result.university = value.slice(13); } return result; }
function isTarget(item, university) { if (university && !TARGETS[university]) throw new Error("--university accepts snu, yonsei, or hanyang."); const values = university ? new Set(TARGETS[university]) : ALL_TARGET_VALUES; return values.has(item.universityId) || values.has(item.universityGroupId); }
function stamp() { return new Date().toISOString(); }
function fileStamp() { return stamp().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-"); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function backupBeforeAi() { fs.mkdirSync(BACKUPS, { recursive: true }); const output = path.join(BACKUPS, `university-news-store-before-ai-${fileStamp()}.json`); fs.copyFileSync(getStorePath(), output); return output; }
function makeMarkdown(report, rows) { return `# UNI PICK 뉴스 시스템 6단계 AI 처리 보고서\n\n- 제공자: ${report.provider}\n- 처리 시각: ${report.completedAt}\n- 대상: ${report.targetItems}건 / 성공: ${report.successfulItems}건 / 실패: ${report.failedItems}건 / 건너뜀: ${report.skippedItems}건\n- 중요: ${report.importantItems}건 / 제외 후보: ${report.unimportantItems}건 / 낮은 신뢰도: ${report.lowConfidenceItems}건\n\n## 항목별 결과\n\n${rows.map((row) => `- ${row.title}\n  - 기존 → AI 카테고리: ${row.originalCategory || "-"} → ${row.aiCategory || "-"}\n  - 중요도/신뢰도: ${row.isImportant ?? "-"} / ${row.confidence ?? "-"}\n  - 키워드: ${(row.keywords || []).join(", ") || "-"}\n  - 결과: ${row.status}${row.reason ? ` (${row.reason})` : ""}`).join("\n") || "처리한 항목이 없습니다."}\n\nMock 결과는 실제 AI가 아니라 규칙 기반 테스트 결과입니다. 원본 제목, URL, 출처, 날짜는 변경하지 않았습니다.\n`; }

async function main() {
  loadDotEnv(); const option = args(process.argv.slice(2)); const providerName = option.provider || process.env.NEWS_AI_PROVIDER || "disabled";
  if (["openai", "gemini"].includes(providerName) && !option.provider) throw new Error("Real providers require an explicit --provider option.");
  const provider = getProvider(providerName); const store = loadNewsStore();
  const candidates = store.items.filter((item) => isTarget(item, option.university) && item.status === "collected" && item.title && item.sourceUrl && (option.force || !item.aiProcessed));
  const selected = candidates.slice(0, option.limit); const alreadyProcessed = store.items.filter((item) => isTarget(item, option.university) && item.aiProcessed).length;
  const drySummary = { provider: provider.name, targetUniversities: option.university ? 1 : 3, availableItems: candidates.length, alreadyProcessed, willProcess: selected.length, skipped: Math.max(0, candidates.length - selected.length), estimatedRequests: ["openai", "gemini"].includes(provider.name) ? selected.length : 0 };
  if (option.dryRun) { console.log(JSON.stringify(drySummary, null, 2)); return; }
  const startedAt = stamp(), rows = [], failures = [], filtered = [], byCategory = CATEGORY_TEMPLATE(); let successful = 0, failed = 0, skipped = 0;
  let storeBackup = null; if (selected.length && provider.name !== "disabled") storeBackup = backupBeforeAi();
  for (const item of selected) {
    if (provider.name === "disabled") { skipped += 1; rows.push({ id: item.id, title: item.title, originalCategory: item.category, status: "skipped", reason: "AI provider is disabled." }); continue; }
    const outcome = await processNewsItem(item, provider);
    if (!outcome.ok) { if (outcome.status === "skipped") skipped += 1; else failed += 1; item.aiProcessingStatus = outcome.status === "skipped" ? "skipped" : "failed"; item.aiProcessingError = outcome.reason; failures.push({ id: item.id, title: item.title, status: outcome.status, reason: outcome.reason }); rows.push({ id: item.id, title: item.title, originalCategory: item.category, status: outcome.status, reason: outcome.reason }); continue; }
    const aiResult = outcome.aiResult; item.aiProcessed = true; item.aiProcessedAt = stamp(); item.aiProvider = provider.name; item.aiModel = provider.model || ""; item.aiResult = aiResult; item.aiProcessingStatus = "completed"; item.aiProcessingError = null;
    successful += 1; byCategory[aiResult.category] += 1; if (aiResult.isImportant) {} else if (aiResult.confidence >= 0.7) filtered.push({ id: item.id, title: item.title, reason: "isImportant=false with confidence >= 0.7", confidence: aiResult.confidence });
    rows.push({ id: item.id, title: item.title, originalCategory: item.category, aiCategory: aiResult.category, isImportant: aiResult.isImportant, summary: aiResult.summary, keywords: aiResult.keywords, confidence: aiResult.confidence, provider: provider.name, status: "completed", isMockAiResult: provider.name === "mock" });
  }
  if (successful) saveNewsStore(store, { backup: false });
  const report = { phase: 6, provider: provider.name, model: provider.model || "", startedAt, completedAt: stamp(), targetItems: selected.length, processedItems: successful + failed, successfulItems: successful, failedItems: failed, skippedItems: skipped, importantItems: rows.filter((row) => row.isImportant === true).length, unimportantItems: rows.filter((row) => row.isImportant === false).length, lowConfidenceItems: rows.filter((row) => typeof row.confidence === "number" && row.confidence < 0.7).length, byCategory, errors: failures, storeBackup };
  const resultFile = { phase: 6, provider: provider.name, model: provider.model || "", processedAt: report.completedAt, targetItems: selected.length, successfulItems: successful, failedItems: failed, items: rows };
  writeJson(path.join(DATA, "phase-6-ai-results.json"), resultFile); writeJson(path.join(REPORTS, "phase-6-ai-report.json"), report); writeJson(path.join(REPORTS, "phase-6-ai-failures.json"), failures); writeJson(path.join(REPORTS, "phase-6-ai-filtered-items.json"), filtered); fs.writeFileSync(path.join(REPORTS, "phase-6-ai-report.md"), makeMarkdown(report, rows), "utf8");
  if (option.buildPreview && successful) { const runner = path.join(__dirname, "build-phase-5-preview.js"); const child = require("child_process").spawnSync(process.execPath, [runner, ...(option.includeUnimportant ? ["--include-unimportant"] : [])], { stdio: "inherit" }); if (child.status !== 0) report.errors.push({ type: "preview", reason: "Preview build failed; existing preview was retained." }); }
  console.log(JSON.stringify({ ...drySummary, successfulItems: successful, failedItems: failed, skippedItems: skipped, backup: storeBackup }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
