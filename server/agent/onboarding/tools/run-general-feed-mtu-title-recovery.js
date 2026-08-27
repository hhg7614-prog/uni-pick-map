"use strict";

// One-university, no-mutation regression test for the General University Feed
// policy.  It uses the production collector only with an inactive in-memory
// source configuration; it never writes the source catalog, store, or preview.
const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");

const ROOT = path.resolve(__dirname, "../../../..");
const SOURCE_FILE = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const REPORT_FILE = path.join(ROOT, "server", "agent", "onboarding", "reports", "general-university-feed", "mtu-title-recovery.json");
const UNIVERSITY_ID = "methodist-theological-university-본교";
const SOURCE_URL = "https://www.mtu.ac.kr/mtu/main/main.do?mId=1";
const SITE_TITLES = new Set(["감리교신학대학교", "감리교신학대학교 홈페이지", "methodist theological university"]);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temporary, "utf8"));
  fs.renameSync(temporary, file);
}
function clean(value) {
  return String(value || "").replace(/&nbsp;|&amp;/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/[.…]+/g, " ").trim();
}
function normalizedTitle(value) {
  return clean(value).replace(/\s*(?:[-|]\s*)?(?:감리교신학대학교|methodist theological university)\s*$/i, "").trim();
}
function words(value) {
  return new Set((normalizedTitle(value).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(word => !/^(감신대|감리교|신학대학교)$/u.test(word)));
}
function compareTitles(listTitle, detailTitle) {
  const list = normalizedTitle(listTitle);
  const detail = normalizedTitle(detailTitle);
  const exact = Boolean(list && detail && list === detail);
  const containsMatch = Boolean(list && detail && (list.includes(detail) || detail.includes(list)));
  const left = words(list); const right = words(detail);
  const intersection = [...left].filter(word => right.has(word)).length;
  const tokenOverlap = left.size && right.size ? intersection / Math.min(left.size, right.size) : 0;
  return { listTitleNormalized: list, detailTitleNormalized: detail, exact, containsMatch, tokenOverlap, similarity: exact ? 1 : Math.max(tokenOverlap, containsMatch ? 0.8 : 0), titleMatch: exact || containsMatch || tokenOverlap >= 0.7 };
}
function classify(title) {
  const value = normalizedTitle(title);
  if (/행사|캠프|축제|세미나/u.test(value)) return "EVENT";
  if (/장학|장학생|장학금/u.test(value)) return "SCHOLARSHIP";
  if (/모집|지원자|채용/u.test(value)) return "RECRUITMENT";
  if (/교육|현장교육|프로그램/u.test(value)) return "PROGRAM";
  if (/수상|합격|성과/u.test(value)) return "UNIVERSITY_NEWS";
  return "OTHER";
}
function official(url) {
  try { return new URL(url).hostname.replace(/^www\./, "") === "mtu.ac.kr"; } catch { return false; }
}
function dateFromDetail(html) {
  const label = textOf(findBySelector(html, "div.board-view-information dl.board-view-date dd")[0]);
  const match = label.match(/(20\d{2})\D{0,4}(\d{1,2})\D{0,4}(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
}
function titleFromDetail(html) {
  const candidates = [
    { selector: "div.board-view div.title-area h4", score: 100 },
    { selector: "div.board-view h1", score: 90 },
    { selector: "div.board-view h2", score: 85 },
    { selector: "meta[property='og:title']", score: 70, meta: true },
    { selector: "meta[name='twitter:title']", score: 65, meta: true }
  ];
  const found = [];
  for (const candidate of candidates) {
    const element = findBySelector(html, candidate.selector)[0];
    const value = candidate.meta ? String(element || "").match(/content=["']([^"']+)/i)?.[1] : textOf(element);
    const title = clean(value);
    if (!title || SITE_TITLES.has(title.toLowerCase())) continue;
    found.push({ selector: candidate.selector, score: candidate.score, title });
  }
  return found.sort((a, b) => b.score - a.score)[0] || { selector: null, score: 0, title: null };
}

async function main() {
  const startedAt = new Date().toISOString();
  const catalog = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const university = catalog.universities.find(item => item.universityId === UNIVERSITY_ID);
  if (!university) throw new Error(`university_not_found:${UNIVERSITY_ID}`);
  const source = {
    id: "methodist-theological-university-general-feed",
    name: "감리교신학대학교 메인 최신 소식",
    sourceScope: "GENERAL_UNIVERSITY_FEED",
    category: "school_news", sourceType: "official", collectionType: "html", listUrl: SOURCE_URL,
    selectors: { item: "div.main-board-area.pc div.main-board-box", title: "strong.title", link: "a", date: "span.date" },
    detailSelectors: { title: "div.board-view div.title-area h4", date: "div.board-view-information dl.board-view-date dd" },
    verified: false, enabled: false
  };
  const collection = await htmlListCollector({ university, source, limit: 3 });
  const articles = [];
  for (const item of collection.items) {
    const response = await fetch(item.sourceUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 compatible UNI-PICK source validator", Accept: "text/html,application/xhtml+xml" } });
    const html = await response.text();
    const extracted = titleFromDetail(html);
    const comparison = compareTitles(item.title, extracted.title);
    const detailDate = dateFromDetail(html);
    articles.push({ listTitle: item.title, detailTitle: extracted.title, titleExtraction: extracted.selector, titleCandidateScore: extracted.score, publishedAt: item.publishedAt, detailPublishedAt: detailDate, sourceUrl: item.sourceUrl, officialDomain: official(item.sourceUrl), responseStatus: response.status, category: classify(item.title), ...comparison });
  }
  const titleMatches = articles.filter(item => item.titleMatch).length;
  const noNullDates = articles.every(item => item.publishedAt);
  const qualityApproved = collection.items.length >= 3 && articles.length >= 3 && titleMatches >= 2 && noNullDates && articles.every(item => item.officialDomain && item.responseStatus === 200);
  const collectorConfigReady = qualityApproved && collection.items.length >= 2 && collection.warnings.length === 0;
  const completedAt = new Date().toISOString();
  const report = {
    phase: "general_feed_mtu_title_recovery", startedAt, completedAt,
    universityId: university.universityId, universityName: university.universityName,
    sourceUrl: SOURCE_URL, sourceScope: "GENERAL_UNIVERSITY_FEED", generalUniversityFeed: true,
    qualityApproved, qualityScore: qualityApproved ? 100 : 0,
    collectorConfigReady, collectorDryRunCount: collection.items.length,
    collector: { status: collection.status, warnings: collection.warnings, finalUrl: collection.finalUrl, nullPublishedAt: collection.items.filter(item => !item.publishedAt).length },
    titleMatchCount: titleMatches, articles,
    mutation: { sourceConfig: false, verified: false, store: false, preview: false, git: false, render: false }
  };
  writeJson(REPORT_FILE, report);
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
