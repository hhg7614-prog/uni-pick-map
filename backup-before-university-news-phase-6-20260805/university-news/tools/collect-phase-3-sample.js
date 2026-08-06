"use strict";

const fs = require("fs");
const path = require("path");
const { getCollector } = require("../collectors/collector-factory");
const { sleep } = require("../utils/sleep");
const { validateUniversityNewsItem } = require("../utils/validate-news-item");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "data", "university-news-sources.phase-2.json");
const OUTPUT_FILE = path.join(ROOT, "data", "phase-3-collected-sample.json");
const REPORT_JSON_FILE = path.join(ROOT, "reports", "phase-3-collection-report.json");
const REPORT_MD_FILE = path.join(ROOT, "reports", "phase-3-collection-report.md");
const TARGET_IDS = new Set(["seoul-national-university-gwanak", "yonsei-university-sinchon", "hanyang-university-seoul"]);

function readArgs(argv) {
  const options = { dryRun: false, noNetwork: false, limit: 5, university: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-network") options.noNetwork = true;
    else if (arg.startsWith("--limit=")) options.limit = Math.max(1, Math.min(5, Number(arg.slice(8)) || 5));
    else if (arg.startsWith("--university=")) options.university = arg.slice(13).trim().toLowerCase();
  }
  return options;
}

function matchesUniversity(university, requested) {
  if (!requested) return true;
  const aliases = {
    snu: "seoul-national-university-gwanak", seoul: "seoul-national-university-gwanak",
    yonsei: "yonsei-university-sinchon", hyu: "hanyang-university-seoul", hanyang: "hanyang-university-seoul"
  };
  return university.universityId === (aliases[requested] || requested);
}

function hasHttpUrl(value) { return /^https?:\/\//i.test(String(value || "")); }
function isEligibleHtml(source) {
  const selectors = source.selectors || {};
  return hasHttpUrl(source.listUrl) && selectors.item && selectors.title && selectors.link;
}
function isOfficialDetailUrl(item, approvedDomains) {
  try {
    const host = new URL(item.sourceUrl).hostname;
    return approvedDomains.includes(host);
  } catch { return false; }
}

function buildPlan(sourceEntries, options) {
  const planned = [];
  const skipped = [];
  for (const university of sourceEntries.filter((entry) => TARGET_IDS.has(entry.universityId) && matchesUniversity(entry, options.university))) {
    for (const source of university.sources || []) {
      if (source.category === "media_news") { skipped.push({ university, source, status: "skipped", reason: "외부 뉴스 API는 이후 단계에서 연결합니다." }); continue; }
      if (source.status !== "verified" || source.sourceType !== "official") { skipped.push({ university, source, status: "skipped", reason: "검증된 공식 출처가 아닙니다." }); continue; }
      if (source.requiresJavascript || source.collectionType === "playwright") { skipped.push({ university, source, status: "skipped", reason: "Playwright 출처는 이번 단계에서 실행하지 않습니다." }); continue; }
      const factory = getCollector(source.collectionType);
      if (factory.status !== "ready") { skipped.push({ university, source, status: factory.status, reason: "이번 단계에서 지원하지 않는 수집 방식입니다." }); continue; }
      if (source.collectionType === "rss" && !hasHttpUrl(source.rssUrl)) { skipped.push({ university, source, status: "skipped", reason: "RSS URL이 없습니다." }); continue; }
      if (source.collectionType === "html" && !isEligibleHtml(source)) { skipped.push({ university, source, status: "selector_required", reason: "목록 페이지 접근은 가능하지만 HTML 선택자 분석이 필요합니다." }); continue; }
      planned.push({ university, source, collector: factory.collector });
    }
  }
  return { planned, skipped };
}

function makeReportBase(startedAt, targetUniversities, targetSources) {
  return { phase: 3, startedAt, completedAt: null, targetUniversities, targetSources, successfulSources: 0, failedSources: 0, skippedSources: 0, collectedItems: 0, duplicateItems: 0, invalidItems: 0, byUniversity: [], byCategory: {}, errors: [] };
}

function writeJson(file, data) { fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8"); }

function buildMarkdown(report, sourceResults) {
  const universityRows = report.byUniversity.map((row) => `- **${row.universityName}**: 성공 출처 ${row.successfulSources}개, 실패 ${row.failedSources}개, 선택자 확인 필요 ${row.selectorRequiredSources}개, 수집 글 ${row.collectedItems}개`).join("\n") || "- 대상 출처가 없습니다.";
  const sourceRows = sourceResults.map((row) => `- ${row.universityName} · ${row.sourceName}: **${row.status}**${row.count != null ? `, ${row.count}개 수집` : ""}${row.reason ? ` — ${row.reason}` : ""}`).join("\n") || "- 기록된 출처가 없습니다.";
  const errors = report.errors.length ? report.errors.map((error) => `- ${error.universityName} · ${error.sourceName}: ${error.message}`).join("\n") : "- 없음";
  return `# UNI PICK 뉴스 시스템 3단계 시험 수집 보고서\n\n## 한눈에 보기\n\n서울대학교·연세대학교·한양대학교의 **검증된 공식 목록 출처만** 적은 양으로 확인했습니다. 이 결과는 개발용 JSON에만 저장되며, 현재 UNI PICK 화면에는 연결하지 않았습니다.\n\n- 시작: ${report.startedAt}\n- 완료: ${report.completedAt}\n- 수집 글: ${report.collectedItems}개\n- 성공 출처: ${report.successfulSources}개\n- 실패 출처: ${report.failedSources}개\n- 건너뜀/선택자 확인 필요: ${report.skippedSources}개\n\n## 학교별 결과\n\n${universityRows}\n\n## 출처별 결과\n\n${sourceRows}\n\n## 확인한 항목\n\n목록 페이지에 있던 제목, 실제 원문 주소, 표시된 게시일, 목록 요약, 썸네일만 저장했습니다. 목록에 날짜·요약·썸네일이 없으면 빈 값 또는 null로 두었고, 내용을 만들어 넣지 않았습니다.\n\n## 실패 또는 주의 사항\n\n${errors}\n\nHTML 선택자 오류는 홈페이지 구조와 선택자가 맞지 않는 경우입니다. RSS 파싱 오류는 RSS 주소가 일반 XML 형식이 아닌 경우입니다. 403은 자동 요청 제한, 404는 주소 변경, 타임아웃은 일시적인 사이트 응답 지연일 수 있습니다.\n\n## 다음 단계 전 확인\n\n수집 파일의 제목과 URL을 직접 열어 실제 게시물인지 확인한 뒤에만 중복 저장·누적 저장 단계를 검토합니다. AI 요약, 데이터베이스, 자동 수집 일정, 화면 연결은 이번 단계에 포함하지 않았습니다.\n`;
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const sourceEntries = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const { planned, skipped } = buildPlan(sourceEntries, options);
  const targetUniversities = new Set(sourceEntries.filter((entry) => TARGET_IDS.has(entry.universityId) && matchesUniversity(entry, options.university)).map((entry) => entry.universityId)).size;

  if (options.dryRun || options.noNetwork) {
    console.log(JSON.stringify({ phase: 3, dryRun: options.dryRun, noNetwork: options.noNetwork, targetUniversities, requestCount: options.noNetwork ? 0 : planned.length, rssSources: planned.filter((entry) => entry.source.collectionType === "rss").length, htmlSources: planned.filter((entry) => entry.source.collectionType === "html").length, skippedSources: skipped.length, requests: planned.map((entry) => ({ universityId: entry.university.universityId, sourceId: entry.source.id, url: entry.source.rssUrl || entry.source.listUrl })) }, null, 2));
    return;
  }

  const report = makeReportBase(startedAt, targetUniversities, planned.length + skipped.length);
  const sourceResults = skipped.map((entry) => ({ universityName: entry.university.universityName, sourceName: entry.source.name, status: entry.status, reason: entry.reason }));
  const items = [];
  const seenUrls = new Set();
  const universityCounts = new Map();

  for (const entry of skipped) {
    report.skippedSources += 1;
  }

  for (let index = 0; index < planned.length; index += 1) {
    const entry = planned[index];
    if (index > 0) await sleep(1800);
    const remainingForUniversity = Math.max(0, 10 - (universityCounts.get(entry.university.universityId) || 0));
    const sourceLimit = Math.min(options.limit, 5, remainingForUniversity, Math.max(0, 30 - items.length));
    if (!sourceLimit) { report.skippedSources += 1; sourceResults.push({ universityName: entry.university.universityName, sourceName: entry.source.name, status: "skipped", reason: "학교 또는 전체 수집 한도에 도달했습니다." }); continue; }
    try {
      const result = await entry.collector({ university: entry.university, source: entry.source, limit: sourceLimit });
      if (result.status !== "success") { report.skippedSources += 1; sourceResults.push({ universityName: entry.university.universityName, sourceName: entry.source.name, status: result.status, reason: (result.warnings || []).join(" ") }); continue; }
      let accepted = 0;
      for (const item of result.items) {
        if (!isOfficialDetailUrl(item, entry.university.approvedDomains || [])) { report.invalidItems += 1; continue; }
        const validation = validateUniversityNewsItem(item);
        if (!validation.valid) { report.invalidItems += 1; continue; }
        if (seenUrls.has(item.sourceUrl)) { report.duplicateItems += 1; continue; }
        seenUrls.add(item.sourceUrl); items.push(item); accepted += 1;
      }
      universityCounts.set(entry.university.universityId, (universityCounts.get(entry.university.universityId) || 0) + accepted);
      report.successfulSources += 1;
      sourceResults.push({ universityName: entry.university.universityName, sourceName: entry.source.name, status: "success", count: accepted, reason: (result.warnings || []).filter(Boolean).join(" ") || null });
    } catch (error) {
      report.failedSources += 1;
      report.errors.push({ universityName: entry.university.universityName, sourceName: entry.source.name, message: error.message });
      sourceResults.push({ universityName: entry.university.universityName, sourceName: entry.source.name, status: "failed", reason: error.message });
    }
  }

  report.collectedItems = items.length;
  report.completedAt = new Date().toISOString();
  report.byUniversity = sourceEntries.filter((entry) => TARGET_IDS.has(entry.universityId) && matchesUniversity(entry, options.university)).map((university) => ({ universityId: university.universityId, universityName: university.universityName, collectedItems: universityCounts.get(university.universityId) || 0, successfulSources: sourceResults.filter((row) => row.universityName === university.universityName && row.status === "success").length, failedSources: sourceResults.filter((row) => row.universityName === university.universityName && row.status === "failed").length, selectorRequiredSources: sourceResults.filter((row) => row.universityName === university.universityName && row.status === "selector_required").length }));
  report.byCategory = items.reduce((result, item) => { result[item.category] = (result[item.category] || 0) + 1; return result; }, {});
  writeJson(OUTPUT_FILE, { phase: 3, isSampleCollection: true, collectedAt: report.completedAt, targetUniversities, items });
  writeJson(REPORT_JSON_FILE, report);
  fs.writeFileSync(REPORT_MD_FILE, buildMarkdown(report, sourceResults), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
