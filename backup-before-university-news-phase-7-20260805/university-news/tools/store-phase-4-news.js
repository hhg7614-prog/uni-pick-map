"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeUrl } = require("../utils/normalize-url");
const { normalizeTitle } = require("../utils/normalize-title");
const { createUrlHash, createContentHash } = require("../utils/create-hash");
const { validateUniversityNewsItem } = require("../utils/validate-news-item");
const storeRepository = require("../repositories/local-news-store");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "data", "phase-3-collected-sample.json");
const REPORT_DIR = path.join(ROOT, "reports");

function parseArgs(argv) {
  const options = { dryRun: false, input: DEFAULT_INPUT, resetStore: false, backup: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--reset-store") options.resetStore = true;
    else if (arg === "--backup") options.backup = true;
    else if (arg.startsWith("--input=")) options.input = path.resolve(process.cwd(), arg.slice(8));
  }
  return options;
}

function similarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const rows = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = rows[0]; rows[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temporary = rows[j];
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = temporary;
    }
  }
  return 1 - rows[right.length] / Math.max(left.length, right.length);
}

function dateWithinOneDay(a, b) {
  if (!a || !b) return false;
  const left = new Date(a), right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return Math.abs(left - right) <= 24 * 60 * 60 * 1000;
}

function prepareItem(inputItem, storedAt) {
  const validation = validateUniversityNewsItem(inputItem);
  if (!validation.valid || inputItem.status === "failed" || inputItem.isSampleCollection !== true) return { item: null, reason: validation.errors.length ? validation.errors.join(" ") : "필수 상태 또는 샘플 수집 표시가 올바르지 않습니다." };
  const normalizedSourceUrl = normalizeUrl(inputItem.sourceUrl);
  if (!normalizedSourceUrl) return { item: null, reason: "유효한 http 또는 https 원문 URL이 아닙니다." };
  const normalizedTitle = normalizeTitle(inputItem.title);
  if (!normalizedTitle) return { item: null, reason: "정규화 후 제목이 비어 있습니다." };
  const item = { ...inputItem, normalizedTitle, normalizedSourceUrl, urlHash: createUrlHash(normalizedSourceUrl), storedAt };
  item.contentHash = createContentHash(item);
  return { item, reason: null };
}

function findDuplicate(item, storedItems) {
  const sameUrl = storedItems.find((stored) => stored.normalizedSourceUrl === item.normalizedSourceUrl || stored.sourceUrl === item.normalizedSourceUrl);
  if (sameUrl) return { type: "duplicate", reason: "same_source_url", existing: sameUrl };
  const sameUrlHash = storedItems.find((stored) => stored.urlHash === item.urlHash);
  if (sameUrlHash) return { type: "duplicate", reason: "same_url_hash", existing: sameUrlHash };
  const sameContentHash = storedItems.find((stored) => stored.contentHash === item.contentHash);
  if (sameContentHash) return { type: "duplicate", reason: "same_content_hash", existing: sameContentHash };
  const candidate = storedItems.find((stored) => (stored.universityGroupId || stored.universityId) === (item.universityGroupId || item.universityId) && stored.category === item.category && dateWithinOneDay(stored.publishedAt, item.publishedAt) && similarity(stored.normalizedTitle || normalizeTitle(stored.title), item.normalizedTitle) >= 0.92);
  return candidate ? { type: "candidate", reason: "similar_title", existing: candidate } : null;
}

function compactRecord(item, result) { return { id: item.id, title: item.title, sourceUrl: item.sourceUrl, normalizedSourceUrl: item.normalizedSourceUrl, duplicateReason: result.reason, existing: { id: result.existing.id, title: result.existing.title, sourceUrl: result.existing.sourceUrl } }; }
function writeReportFile(filename, data) { fs.writeFileSync(path.join(REPORT_DIR, filename), `${JSON.stringify(data, null, 2)}\n`, "utf8"); }

function buildMarkdown(report) {
  return `# UNI PICK 뉴스 시스템 4단계 저장 보고서\n\n이번 단계는 3단계에서 받은 게시물을 화면에 보여주지 않고, 개발용 누적 저장소에 안전하게 넣는 작업입니다. 같은 게시물은 URL과 해시를 비교해서 다시 넣지 않습니다.\n\n- 입력: ${report.inputItems}개\n- 검증 통과: ${report.validItems}개\n- 새로 저장: ${report.newItems}개\n- 확정 중복: ${report.duplicates}개\n- 사람이 확인할 중복 후보: ${report.duplicateCandidates}개\n- 제외된 항목: ${report.invalidItems}개\n- 저장소: ${report.storeBefore}개 → ${report.storeAfter}개\n\n## 중복 기준\n\n1. 정규화한 원문 URL이 같으면 확정 중복입니다.\n2. URL 해시가 같으면 확정 중복입니다.\n3. 같은 대학·카테고리·제목·날짜의 내용 해시가 같으면 확정 중복입니다.\n4. URL은 달라도 제목이 거의 같고 날짜가 하루 이내이면 사람이 확인할 후보로만 기록하고 저장하지 않습니다.\n\n## 안전 장치\n\n저장 전 기존 파일을 개발용 백업 폴더에 복사하고, 임시 파일을 검증한 뒤 교체합니다. JSON이 깨진 경우에는 기존 파일을 덮어쓰지 않고 오류를 알려줍니다.\n\n기존 UNI PICK 지도와 학교 소식 화면은 이 저장소를 읽지 않습니다.\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const input = JSON.parse(fs.readFileSync(options.input, "utf8"));
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const currentStore = options.resetStore ? { ...storeRepository.loadNewsStore(), items: [] } : storeRepository.loadNewsStore();
  const storeBefore = currentStore.items.length;
  const report = { phase: 4, startedAt, completedAt: null, inputItems: rawItems.length, validItems: 0, newItems: 0, duplicates: 0, duplicateCandidates: 0, invalidItems: 0, storeBefore, storeAfter: storeBefore, byUniversity: {}, byCategory: {}, errors: [] };
  const duplicates = [], candidates = [], invalidItems = [], plannedItems = [...currentStore.items];
  const storedAt = new Date().toISOString();

  for (const inputItem of rawItems) {
    const prepared = prepareItem(inputItem, storedAt);
    if (!prepared.item) { report.invalidItems += 1; invalidItems.push({ id: inputItem?.id || null, title: inputItem?.title || "", sourceUrl: inputItem?.sourceUrl || "", reason: prepared.reason }); continue; }
    report.validItems += 1;
    const duplicate = findDuplicate(prepared.item, plannedItems);
    if (duplicate?.type === "duplicate") { report.duplicates += 1; duplicates.push(compactRecord(prepared.item, duplicate)); continue; }
    if (duplicate?.type === "candidate") { report.duplicateCandidates += 1; candidates.push(compactRecord(prepared.item, duplicate)); continue; }
    plannedItems.push(prepared.item);
    report.newItems += 1;
    report.byUniversity[prepared.item.universityId] = (report.byUniversity[prepared.item.universityId] || 0) + 1;
    report.byCategory[prepared.item.category] = (report.byCategory[prepared.item.category] || 0) + 1;
  }

  report.storeAfter = plannedItems.length;
  report.completedAt = new Date().toISOString();
  const result = { ...report, dryRun: options.dryRun, input: options.input };
  if (!options.dryRun) {
    if (options.backup) storeRepository.backupStore();
    currentStore.items = plannedItems;
    storeRepository.saveNewsStore(currentStore, { backup: true });
    writeReportFile("phase-4-storage-report.json", report);
    fs.writeFileSync(path.join(REPORT_DIR, "phase-4-storage-report.md"), buildMarkdown(report), "utf8");
    writeReportFile("phase-4-duplicates.json", duplicates);
    writeReportFile("phase-4-duplicate-candidates.json", candidates);
    writeReportFile("phase-4-invalid-items.json", invalidItems);
  }
  console.log(JSON.stringify(result, null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
