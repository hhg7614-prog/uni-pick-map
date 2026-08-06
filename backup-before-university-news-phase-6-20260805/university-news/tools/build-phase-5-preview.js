"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE_FILE = path.join(ROOT, "data", "university-news-store.json");
const OUTPUT_FILE = path.resolve(ROOT, "..", "..", "data", "university-news-preview.json");
const REPORT_JSON = path.join(ROOT, "reports", "phase-5-preview-report.json");
const REPORT_MD = path.join(ROOT, "reports", "phase-5-preview-report.md");
const TARGETS = new Map([
  ["seoul-national-university-gwanak", "서울대학교"],
  ["yonsei-university-sinchon", "연세대학교"],
  ["hanyang-university-seoul", "한양대학교"]
]);
const TARGET_GROUPS = new Set(["seoul-national-university", "yonsei-university", "hanyang-university"]);

function parseArgs(argv) {
  const options = { dryRun: false, limit: 20 };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    if (arg.startsWith("--limit=")) options.limit = Math.max(1, Math.min(20, Number(arg.slice(8)) || 20));
  }
  return options;
}

function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function isTarget(item) { return TARGETS.has(item.universityId) || TARGET_GROUPS.has(item.universityGroupId); }
function previewItem(item) {
  return {
    id: item.id,
    universityId: item.universityId,
    universityGroupId: item.universityGroupId || "",
    universityName: item.universityName,
    campusName: item.campusName || "",
    category: item.category,
    categoryLabel: item.categoryLabel || "",
    title: item.title,
    summary: item.summary || "",
    sourceName: item.sourceName || "",
    sourceUrl: item.sourceUrl,
    thumbnailUrl: isHttpUrl(item.thumbnailUrl) ? item.thumbnailUrl : "",
    publishedAt: item.publishedAt || null,
    collectedAt: item.collectedAt,
    isRealCollectedData: true
  };
}

function buildMarkdown(report) {
  return `# UNI PICK 뉴스 시스템 5단계 미리보기 생성 보고서\n\n개발용 누적 저장소에서 서울대학교, 연세대학교, 한양대학교 게시물만 골라 브라우저에서 읽을 수 있는 미리보기 JSON을 만들었습니다. 이 파일에는 화면에 필요한 정보만 포함하며 해시·오류·로컬 경로는 넣지 않았습니다.\n\n- 생성 시각: ${report.generatedAt}\n- 입력 저장 항목: ${report.storeItems}개\n- 미리보기 항목: ${report.previewItems}개\n- 학교별: 서울대학교 ${report.byUniversity["서울대학교"] || 0}개 / 연세대학교 ${report.byUniversity["연세대학교"] || 0}개 / 한양대학교 ${report.byUniversity["한양대학교"] || 0}개\n\n다른 대학은 기존 샘플 뉴스 또는 기존 빈 상태를 계속 사용합니다.\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  if (!Array.isArray(store.items)) throw new Error("저장소에 items 배열이 없습니다.");
  const invalid = [];
  const eligible = store.items.filter((item) => {
    const valid = isTarget(item) && item.title && isHttpUrl(item.sourceUrl) && item.universityId && item.category;
    if (!valid) invalid.push({ id: item.id || null, title: item.title || "", reason: "지원 대상·필수 필드·원문 URL 조건을 만족하지 않습니다." });
    return valid;
  }).sort((a, b) => String(b.publishedAt || b.collectedAt).localeCompare(String(a.publishedAt || a.collectedAt)));
  const counts = new Map();
  const items = [];
  for (const item of eligible) {
    const key = item.universityGroupId || item.universityId;
    if ((counts.get(key) || 0) >= options.limit) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    items.push(previewItem(item));
  }
  const byUniversity = items.reduce((result, item) => { result[item.universityName] = (result[item.universityName] || 0) + 1; return result; }, {});
  const output = { generatedAt: new Date().toISOString(), isDevelopmentPreview: true, supportedUniversities: ["서울대학교", "연세대학교", "한양대학교"], items };
  const report = { phase: 5, generatedAt: output.generatedAt, storeItems: store.items.length, previewItems: items.length, excludedItems: invalid.length, byUniversity, outputFile: "data/university-news-preview.json" };
  if (!options.dryRun) {
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(REPORT_MD, buildMarkdown(report), "utf8");
  }
  console.log(JSON.stringify({ ...report, dryRun: options.dryRun }, null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
