"use strict";

// Representative-owner activation only: this script must never create a Haeundae copy.
const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");
const { getAllItems, saveNewItems, STORE_PATH, PREVIEW_PATH } = require("../../store");
const { filterNewItems } = require("../../dedup");
const ROOT = path.resolve(__dirname, "../../../..");
const CATALOG = path.join(ROOT, "development/university-news/data/university-news-sources.final.json");
const BACKUPS = path.join(ROOT, "server/agent/onboarding/backups");
const REPORT = path.join(ROOT, "server/agent/onboarding/reports/youngsan-shared-feed-activation.json");
const OWNER_ID = "youngsan-university-\u1107\u1169\u11ab\u1100\u116d";
const SECOND_CAMPUS_ID = "youngsan-university-\u110c\u11662\u110f\u1162\u11b7\u1111\u1165";
const SOURCE_ID = "youngsan-university-shared-general-feed";
const LIST_URL = "https://www.ysu.ac.kr/kor/CMS/Board/Board.do?mCode=MN016";
const HEADERS = { "User-Agent": "Mozilla/5.0 compatible UNI-PICK production validator", Accept: "text/html,application/xhtml+xml" };
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function write(file, value) { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function sameTitle(a, b) { a = clean(a).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); b = clean(b).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); }
function official(url) { try { return new URL(url).hostname.replace(/^www\./i, "") === "ysu.ac.kr"; } catch { return false; } }
function category(title) { const v = clean(title); if (/장학/.test(v)) return "SCHOLARSHIP"; if (/행사|영화|축제|캠프|세미나/.test(v)) return "EVENT"; if (/학사|등록금|수강|졸업|휴학|복학/.test(v)) return "ACADEMIC"; if (/공지|안내/.test(v)) return "NOTICE"; if (/프로그램|교육/.test(v)) return "PROGRAM"; return "OTHER"; }
function backup() { const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14), dir = path.join(BACKUPS, `youngsan-shared-feed-${stamp}`); fs.mkdirSync(dir, { recursive: true }); for (const f of [CATALOG, STORE_PATH, PREVIEW_PATH]) fs.copyFileSync(f, path.join(dir, path.basename(f))); return dir; }
async function main() {
  const catalog = read(CATALOG), universities = catalog.universities || [], owner = universities.find(x => x.universityId === OWNER_ID), second = universities.find(x => x.universityId === SECOND_CAMPUS_ID), allSources = universities.flatMap(x => x.sources || []);
  if (!owner || !second) throw new Error("youngsan_owner_or_second_campus_not_found");
  if (allSources.some(s => s.id === SOURCE_ID || s.listUrl === LIST_URL)) throw new Error("shared_source_or_list_url_already_exists");
  if ((second.sources || []).length) throw new Error("second_campus_source_exists_manual_review_required");
  const before = { verified: allSources.filter(s => s.verified).length, activeSourceCount: allSources.filter(s => s.enabled).length, store: getAllItems().length, preview: read(PREVIEW_PATH).items.length };
  const source = { id: SOURCE_ID, name: "영산대학교 공통 공지", sourceScope: "GENERAL_UNIVERSITY_FEED", campusScope: "SHARED_SOURCE", category: "school_news", categoryLabel: "학교 소식", sourceType: "official", collectionType: "html", listUrl: LIST_URL, selectors: { item: "tbody tr", title: "a", link: "a", date: "td", dateIndex: 3 }, detailSelectors: { title: "h4" }, datePolicy: { prefer: "list" }, dateProvenance: "LIST_ROW_VERIFIED", verified: false, enabled: false, status: "collector_config_candidate", healthStatus: "unknown" };
  const collected = await htmlListCollector({ university: owner, source, limit: 3 });
  if (collected.status !== "success" || collected.items.length < 3 || collected.items.some(x => !x.publishedAt)) throw new Error("collector_list_validation_failed");
  const accepted = [];
  for (const item of collected.items) { const response = await fetch(item.sourceUrl, { headers: HEADERS, redirect: "follow" }), html = await response.text(), detailTitle = clean(textOf(findBySelector(html, "h4")[0])); if (response.ok && official(response.url) && item.publishedAt && sameTitle(item.title, detailTitle)) accepted.push({ ...item, universityId: OWNER_ID, universityGroupId: owner.universityGroupId, universityName: owner.universityName, campusName: owner.campusName, sourceUrl: response.url, sourceId: SOURCE_ID, sourceName: source.name, sourceSiteUrl: LIST_URL, contentCategory: category(item.title), detailValidation: { verified: true, sourceTitle: detailTitle, dateProvenance: "LIST_ROW_VERIFIED" } }); }
  if (accepted.length < 3 || accepted.some(x => !x.publishedAt)) throw new Error("collector_detail_validation_failed");
  const priorItems = getAllItems(), { newItems, duplicateCount } = filterNewItems(accepted, priorItems);
  if (newItems.length < 3 || duplicateCount !== 0 || newItems.some(x => x.universityId === SECOND_CAMPUS_ID)) throw new Error("store_dedup_or_second_campus_validation_failed");
  const backupDirectory = backup(); owner.sources.push({ ...source, verified: true, enabled: true, status: "verified", healthStatus: "healthy" }); write(CATALOG, catalog); saveNewItems(newItems);
  const afterCatalog = read(CATALOG), afterSources = (afterCatalog.universities || []).flatMap(x => x.sources || []), afterItems = getAllItems(), preview = read(PREVIEW_PATH), ownerPreview = preview.items.filter(x => x.universityId === OWNER_ID).length, secondCopies = afterItems.filter(x => x.universityId === SECOND_CAMPUS_ID && x.sourceId === SOURCE_ID).length;
  if (secondCopies) throw new Error("second_campus_item_copy_detected");
  const result = { phase: "youngsan_shared_general_feed_activation", status: "ACTIVATED_SUCCESS", sourceId: SOURCE_ID, ownerUniversityId: OWNER_ID, campusScope: "SHARED_SOURCE", listUrl: LIST_URL, existingSameSource: false, secondCampusSameSourceExists: false, before, collector: { found: collected.items.length, accepted: accepted.length, titleMatch: accepted.length, publishedAtNull: accepted.filter(x => !x.publishedAt).length, duplicateCount }, preExisting: priorItems.length, batchAdded: newItems.length, storeAdded: newItems.length, secondCampusItemCopies: secondCopies, previewOwnerCount: ownerPreview, previewVisibility: ownerPreview ? "VISIBLE" : "PREVIEW_NOT_VISIBLE", after: { verified: afterSources.filter(s => s.verified).length, activeSourceCount: afterSources.filter(s => s.enabled).length, store: afterItems.length, preview: preview.items.length }, verifiedTransactionIncrease: afterSources.filter(s => s.verified).length - before.verified, backupDirectory, mutationFiles: [CATALOG, STORE_PATH, PREVIEW_PATH] };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true }); write(REPORT, result); console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
