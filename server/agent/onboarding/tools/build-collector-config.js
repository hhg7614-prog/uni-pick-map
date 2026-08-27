"use strict";

// Builds *inactive* operating configurations from the four quality-approved
// candidates.  It deliberately uses the production HTML list collector for
// the dry run, so a diagnostic-only selector cannot be mistaken for a usable
// collector configuration.
const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf, attribute } = require("../../../../development/university-news/collectors/html-list-collector");
const { parseDate } = require("../../../../development/university-news/utils/parse-date");

const ROOT = path.resolve(__dirname, "../../../..");
const SOURCE_FILE = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const CANDIDATE_FILE = path.join(ROOT, "server", "agent", "onboarding", "data", "collector-config-candidates.json");
const REPORT_DIR = path.join(ROOT, "server", "agent", "onboarding", "reports", "collector-config");

const TARGETS = [
  {
    universityId: "daegu-catholic-university-본교", sourceId: "daegu-catholic-press", name: "대구가톨릭대학교 언론보도", listUrl: "https://www.cu.ac.kr/introduction/result/press",
    selectors: { item: "tbody tr", title: "td a", link: "td a", date: "td", dateIndex: 4 },
    detailSelectors: { title: "div.view_info h6", date: "div.view_info span" },
    datePolicy: { prefer: "list", allowVerifiedListDateFallback: true, rejectDetailDateIfConflictDaysGreaterThan: 31 }
  },
  {
    universityId: "tongmyong-university-본교", sourceId: "tongmyong-press", name: "동명대학교 대학뉴스", listUrl: "https://www.tu.ac.kr/newsweb/sub01_01.do",
    selectors: { item: "tbody tr", title: "td.subject a", link: "td.subject a", date: "td.data" },
    detailSelectors: { title: "div.viewTop h2", date: "div.viewTop li" }
  },
  {
    universityId: "sungkyunkwan-university-natural-sciences", sourceId: "skku-natural-sciences-press", name: "성균관대학교 보도자료", listUrl: "https://www.skku.edu/skku/campus/skk_comm/press.do",
    selectors: { item: "tbody tr", title: "td.left a", link: "td.left a", date: "td", dateIndex: 2 },
    detailSelectors: { title: "em.ellipsis", date: "th span.date" }
  },
  {
    universityId: "korea-national-sport-university-본교", sourceId: "knsu-press-release", name: "한국체육대학교 보도자료", listUrl: "https://www.knsu.ac.kr/knsu/info/press-release.do",
    selectors: { item: "tbody tr", title: "td.b-td-title a", link: "td.b-td-title a", date: "span.b-date" },
    detailSelectors: { title: "p.b-title-box span", date: "li.b-date-box span" },
    datePolicy: { allowTwoDigitYear: true }
  }
];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temp, "utf8"));
  fs.renameSync(temp, file);
}
function clean(value) { return String(value || "").replace(/\s+/g, " ").replace(/^NEW\s*/i, "").trim(); }
function sameTitle(left, right) { const a = clean(left).replace(/[^\p{L}\p{N}]/gu, ""); const b = clean(right).replace(/[^\p{L}\p{N}]/gu, ""); return Boolean(a && b && (a === b || a.includes(b) || b.includes(a))); }
function official(url, listUrl) { try { const a = new URL(url).hostname.replace(/^www\./, ""); const b = new URL(listUrl).hostname.replace(/^www\./, ""); return a === b; } catch { return false; } }
function dateFromElements(html, selector, policy) {
  for (const element of findBySelector(html, selector || "")) {
    const raw = textOf(element);
    const parsed = parseDate(raw, policy || {});
    if (parsed.value) return { raw, value: parsed.value };
  }
  return { raw: null, value: null };
}
function dayDelta(first, second) { return Math.abs(Date.parse(`${first}T00:00:00Z`) - Date.parse(`${second}T00:00:00Z`)) / 86400000; }
function sourceFor(target) {
  return {
    id: target.sourceId, name: target.name, category: "school_news", categoryLabel: "학교 소식", sourceType: "official", collectionType: "html", listUrl: target.listUrl,
    selectors: target.selectors, detailSelectors: target.detailSelectors,
    ...(target.datePolicy ? { datePolicy: target.datePolicy } : {}),
    verified: false, enabled: false, status: "collector_config_candidate", healthStatus: "unknown"
  };
}
async function validateCandidate(university, target) {
  const source = sourceFor(target);
  const collected = await htmlListCollector({ university, source, limit: 3 });
  const details = [];
  for (const item of collected.items) {
    let detail = { sourceUrl: item.sourceUrl, listTitle: item.title, publishedAt: item.publishedAt, officialDomain: official(item.sourceUrl, source.listUrl), detailTitle: null, detailDate: null, titleMatch: false, dateMatch: null, passed: false, dateSource: item.dateSource || "list_date" };
    try {
      const response = await fetch(item.sourceUrl, { headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
      const html = await response.text();
      const detailTitle = textOf(findBySelector(html, source.detailSelectors.title)[0]);
      const extractedDate = dateFromElements(html, source.detailSelectors.date, source.datePolicy);
      detail.detailTitle = clean(detailTitle);
      detail.detailDate = extractedDate.value;
      detail.detailDateRaw = extractedDate.raw;
      detail.titleMatch = sameTitle(item.title, detailTitle);
      if (detail.detailDate && item.publishedAt) {
        detail.dateDeltaDays = dayDelta(item.publishedAt, detail.detailDate);
        detail.dateMatch = detail.dateDeltaDays <= (source.datePolicy?.rejectDetailDateIfConflictDaysGreaterThan || 31);
        if (!detail.dateMatch && source.datePolicy?.allowVerifiedListDateFallback && detail.titleMatch) {
          detail.dateSource = "verified_list_date";
          detail.dateFallbackApplied = true;
        }
      }
      detail.passed = response.ok && detail.officialDomain && detail.titleMatch && Boolean(item.publishedAt);
    } catch (error) { detail.error = error.message; }
    details.push(detail);
  }
  const validTitle = collected.items.filter(item => clean(item.title)).length;
  const validLink = collected.items.filter(item => /^https:\/\//.test(item.sourceUrl) && official(item.sourceUrl, source.listUrl)).length;
  const validPublishedAt = collected.items.filter(item => item.publishedAt).length;
  const nullPublishedAt = collected.items.filter(item => !item.publishedAt).length;
  const detailValidated = details.filter(item => item.passed).length;
  const ready = collected.items.length >= 2 && validTitle >= 2 && validLink >= 2 && validPublishedAt >= 2 && nullPublishedAt === 0 && detailValidated >= 2;
  return { universityId: university.universityId, universityName: university.universityName, universityGroupId: university.universityGroupId, source, finalDecision: ready ? "COLLECTOR_CONFIG_READY" : "COLLECTOR_CONFIG_REVIEW", collection: { status: collected.status, count: collected.items.length, validTitle, validLink, validPublishedAt, nullPublishedAt, warnings: collected.warnings || [], finalUrl: collected.finalUrl || null }, details, detailValidated, schemaValid: true };
}
function markdown(report) {
  const rows = report.items.map(x => `- ${x.universityName}: ${x.finalDecision}, 목록 ${x.collection.count}건, 날짜 누락 ${x.collection.nullPublishedAt}건`).join("\n");
  return `# UNI PICK Collector Configuration Agent test4\n\n- 처리 대학: ${report.processed}\n- 준비 완료: ${report.ready}\n- 검토 필요: ${report.review}\n- sourceId 중복: ${report.sourceIdDuplicates.length}\n\n${rows}\n\n이 보고서는 후보 설정과 dry-run 결과만 담습니다. 실제 출처 설정·store·preview·Git·Render는 변경하지 않았습니다.\n`;
}
async function main() {
  const catalog = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const existingIds = new Set(catalog.universities.flatMap(row => (row.sources || []).map(source => source.id)));
  const candidates = [];
  for (const target of TARGETS) {
    const university = catalog.universities.find(row => row.universityId === target.universityId);
    if (!university) throw new Error(`university_not_found:${target.universityId}`);
    candidates.push(await validateCandidate(university, target));
  }
  const candidateIds = candidates.map(item => item.source.id);
  const duplicateIds = candidateIds.filter((id, index) => candidateIds.indexOf(id) !== index || existingIds.has(id));
  const schemaErrors = candidates.flatMap(item => {
    const source = item.source; const missing = ["id", "name", "category", "sourceType", "collectionType", "listUrl"].filter(key => !source[key]);
    const selectors = ["item", "title", "link", "date"].filter(key => !source.selectors[key]);
    return missing.length || selectors.length || source.verified !== false || source.enabled !== false ? [{ universityId: item.universityId, missing, selectors }] : [];
  });
  const report = { phase: "collector_config_test4", generatedAt: new Date().toISOString(), processed: candidates.length, ready: candidates.filter(item => item.finalDecision === "COLLECTOR_CONFIG_READY").length, review: candidates.filter(item => item.finalDecision === "COLLECTOR_CONFIG_REVIEW").length, sourceIdDuplicates: [...new Set(duplicateIds)], schemaErrors, configChanged: false, storeChanged: false, previewChanged: false, git: "not_run", render: "not_run", items: candidates };
  writeJson(CANDIDATE_FILE, { generatedAt: report.generatedAt, items: candidates.map(item => ({ universityId: item.universityId, universityName: item.universityName, universityGroupId: item.universityGroupId, finalDecision: item.finalDecision, source: item.source })) });
  writeJson(path.join(REPORT_DIR, "collector-config-test4.json"), report);
  fs.writeFileSync(path.join(REPORT_DIR, "collector-config-test4.md"), markdown(report), "utf8");
  console.log(JSON.stringify({ processed: report.processed, ready: report.ready, review: report.review, sourceIdDuplicates: report.sourceIdDuplicates, schemaErrors: report.schemaErrors, candidateFile: CANDIDATE_FILE, reportFile: path.join(REPORT_DIR, "collector-config-test4.json") }, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
