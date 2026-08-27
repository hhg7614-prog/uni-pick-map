"use strict";

const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");
const { getAllItems, saveNewItems, STORE_PATH, PREVIEW_PATH } = require("../../store");
const { filterNewItems } = require("../../dedup");

const ROOT = path.resolve(__dirname, "../../../..");
const CATALOG = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const BACKUPS = path.join(ROOT, "server", "agent", "onboarding", "backups");
const REPORT = path.join(ROOT, "server", "agent", "onboarding", "reports", "methodist-theological-university-activation.json");
const UNIVERSITY_ID = "methodist-theological-university-본교";
const SOURCE_ID = "methodist-theological-university-general-feed";
const SOURCE_URL = "https://www.mtu.ac.kr/mtu/main/main.do?mId=1";

function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(temporary, "utf8")); fs.renameSync(temporary, file); }
function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&amp;/gi, " ").replace(/\s+/g, " ").trim(); }
function sameTitle(left, right) { const a = clean(left).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); const b = clean(right).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); return Boolean(a && b && (a === b || a.includes(b) || b.includes(a))); }
function category(title) { const value = clean(title); if (/행사|캠프|축제|세미나/u.test(value)) return "EVENT"; if (/장학|장학생|장학금/u.test(value)) return "SCHOLARSHIP"; if (/모집|지원자|채용/u.test(value)) return "RECRUITMENT"; if (/교육|현장교육|프로그램/u.test(value)) return "PROGRAM"; if (/수상|합격|성과/u.test(value)) return "UNIVERSITY_NEWS"; return "OTHER"; }
function isOfficial(url) { try { return new URL(url).hostname.replace(/^www\./, "") === "mtu.ac.kr"; } catch { return false; } }
function backup() { const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14); const directory = path.join(BACKUPS, `mtu-general-feed-activation-${stamp}`); fs.mkdirSync(directory, { recursive: true }); for (const file of [CATALOG, STORE_PATH, PREVIEW_PATH]) fs.copyFileSync(file, path.join(directory, path.basename(file))); return directory; }

async function main() {
  const catalog = read(CATALOG);
  const university = catalog.universities.find(item => item.universityId === UNIVERSITY_ID);
  if (!university) throw new Error("university_not_found");
  if ((university.sources || []).some(source => source.id === SOURCE_ID)) throw new Error("source_id_already_exists");
  const before = { verified: catalog.universities.flatMap(item => item.sources || []).filter(source => source.verified).length, store: getAllItems().length, preview: read(PREVIEW_PATH).items.length };
  const source = {
    id: SOURCE_ID, name: "감리교신학대학교 메인 최신 소식", sourceScope: "GENERAL_UNIVERSITY_FEED",
    category: "school_news", categoryLabel: "학교 소식", sourceType: "official", collectionType: "html", listUrl: SOURCE_URL,
    selectors: { item: "div.main-board-area.pc div.main-board-box", title: "strong.title", link: "a", date: "span.date" },
    detailSelectors: { title: "div.board-view div.title-area h4", date: "div.board-view-information dl.board-view-date dd" },
    datePolicy: { prefer: "list" }, verified: false, enabled: false, status: "collector_config_candidate", healthStatus: "unknown"
  };
  const collection = await htmlListCollector({ university, source, limit: 3 });
  const accepted = [];
  for (const item of collection.items || []) {
    const response = await fetch(item.sourceUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 compatible UNI-PICK validator", Accept: "text/html,application/xhtml+xml" } });
    const html = await response.text();
    const detailTitle = textOf(findBySelector(html, source.detailSelectors.title)[0]);
    const detailDate = textOf(findBySelector(html, source.detailSelectors.date)[0]).match(/(20\d{2})\D{0,4}(\d{1,2})\D{0,4}(\d{1,2})/);
    const detailPublishedAt = detailDate ? `${detailDate[1]}-${detailDate[2].padStart(2, "0")}-${detailDate[3].padStart(2, "0")}` : null;
    if (!response.ok || !isOfficial(response.url) || !item.title || !item.publishedAt || !sameTitle(item.title, detailTitle) || !detailPublishedAt) continue;
    accepted.push({ ...item, sourceUrl: response.url, sourceId: SOURCE_ID, sourceName: source.name, sourceSiteUrl: SOURCE_URL, contentCategory: category(item.title), detailValidation: { verified: true, sourceTitle: detailTitle, sourceDate: detailPublishedAt } });
  }
  if (collection.status !== "success" || collection.items.length < 3 || accepted.length < 2 || accepted.some(item => !item.publishedAt)) throw new Error("production_collection_validation_failed");
  const existing = getAllItems(); const { newItems, duplicateCount } = filterNewItems(accepted, existing);
  if (newItems.length < 2) throw new Error("insufficient_new_items");
  const backupDirectory = backup();
  university.sources.push({ ...source, verified: true, enabled: true, status: "verified", healthStatus: "healthy" });
  write(CATALOG, catalog);
  saveNewItems(newItems);
  const after = { verified: catalog.universities.flatMap(item => item.sources || []).filter(source => source.verified).length, store: getAllItems().length, preview: read(PREVIEW_PATH).items.length };
  const previewItems = read(PREVIEW_PATH).items.filter(item => item.universityId === UNIVERSITY_ID);
  const result = { phase: "methodist_theological_university_general_feed_activation", status: "ACTIVATED_SUCCESS", universityId: UNIVERSITY_ID, sourceId: SOURCE_ID, sourceUrl: SOURCE_URL, sourceScope: "GENERAL_UNIVERSITY_FEED", found: collection.items.length, accepted: accepted.length, newItems: newItems.length, duplicateCount, publishedAtNull: accepted.filter(item => !item.publishedAt).length, categories: accepted.map(item => item.contentCategory), before, after, previewVisibility: previewItems.length ? "VISIBLE" : "PREVIEW_NOT_VISIBLE", previewItems: previewItems.length, backupDirectory, files: [CATALOG, STORE_PATH, PREVIEW_PATH] };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true }); write(REPORT, result); console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
