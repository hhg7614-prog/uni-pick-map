"use strict";

// One-university production activation. This file is intentionally not part of the production data commit.
const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");
const { getAllItems, saveNewItems, STORE_PATH, PREVIEW_PATH } = require("../../store");
const { filterNewItems } = require("../../dedup");
const ROOT = path.resolve(__dirname, "../../../..");
const CATALOG = path.join(ROOT, "development/university-news/data/university-news-sources.final.json");
const BACKUPS = path.join(ROOT, "server/agent/onboarding/backups");
const REPORT = path.join(ROOT, "server/agent/onboarding/reports/dnue-activation.json");
const UNIVERSITY_ID = "daegu-national-university-of-education-\u1107\u1169\u11ab\u1100\u116d";
const SOURCE_ID = "daegu-national-university-of-education-general-feed";
const LIST_URL = "http://www.dnue.ac.kr/kor/CMS/Board/Board.do?mCode=MN168";
const HEADERS = { "User-Agent": "Mozilla/5.0 compatible UNI-PICK production validator", Accept: "text/html,application/xhtml+xml" };
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function write(file, value) { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, file); }
function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function sameTitle(a, b) { const x = clean(a).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(), y = clean(b).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); }
function category(title) { const value = clean(title); if (/\ud589\uc0ac|\ucea0\ud504|\ucd95\uc81c|\uc138\ubbf8\ub098/.test(value)) return "EVENT"; if (/\uc7a5\ud559/.test(value)) return "SCHOLARSHIP"; if (/\ubaa8\uc9d1|\ucc44\uc6a9/.test(value)) return "RECRUITMENT"; if (/\ud559\uc0ac|\uc218\uc5c5|\uc878\uc5c5/.test(value)) return "ACADEMIC"; if (/\ud504\ub85c\uadf8\ub7a8|\uad50\uc721/.test(value)) return "PROGRAM"; if (/\uacf5\uc9c0|\uc548\ub0b4|\uc8fc\uc758/.test(value)) return "NOTICE"; return "OTHER"; }
function official(url) { try { return new URL(url).hostname.replace(/^www\./, "") === "dnue.ac.kr"; } catch { return false; } }
function backup() { const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14), dir = path.join(BACKUPS, `dnue-activation-${stamp}`); fs.mkdirSync(dir, { recursive: true }); for (const file of [CATALOG, STORE_PATH, PREVIEW_PATH]) fs.copyFileSync(file, path.join(dir, path.basename(file))); return dir; }
async function main() {
  const catalog = read(CATALOG), university = catalog.universities.find(item => item.universityId === UNIVERSITY_ID); if (!university) throw new Error("university_not_found");
  const existing = (university.sources || []).find(item => item.id === SOURCE_ID || item.listUrl === LIST_URL); if (existing?.enabled) throw new Error("active_source_already_exists"); if (existing) throw new Error("inactive_source_exists_manual_review_required");
  const before = { verified: catalog.universities.flatMap(item => item.sources || []).filter(item => item.verified).length, activeSourceCount: catalog.universities.flatMap(item => item.sources || []).filter(item => item.enabled).length, store: getAllItems().length, preview: read(PREVIEW_PATH).items.length };
  const source = { id: SOURCE_ID, name: "\ub300\uad6c\uad50\uc721\ub300\ud559\uad50 \uacf5\uc9c0\uc0ac\ud56d", sourceScope: "GENERAL_UNIVERSITY_FEED", category: "school_news", categoryLabel: "\ud559\uad50 \uc18c\uc2dd", sourceType: "official", collectionType: "html", listUrl: LIST_URL, selectors: { item: "tbody tr", title: "a", link: "a", date: "td", dateIndex: 3 }, detailSelectors: { title: "h4.vtitle" }, datePolicy: { prefer: "list" }, dateProvenance: "LIST_ROW_VERIFIED", campusScope: "ALL_UNIVERSITY", verified: false, enabled: false, status: "collector_config_candidate", healthStatus: "unknown" };
  const collected = await htmlListCollector({ university, source, limit: 3 }); if (collected.status !== "success" || collected.items.length < 3 || collected.items.some(item => !item.publishedAt)) throw new Error("collector_list_validation_failed");
  const accepted = [];
  for (const item of collected.items) { const response = await fetch(item.sourceUrl, { headers: HEADERS, redirect: "follow" }); const html = await response.text(), detailTitle = clean(textOf(findBySelector(html, "h4.vtitle")[0])); if (response.ok && official(response.url) && item.publishedAt && sameTitle(item.title, detailTitle)) accepted.push({ ...item, sourceUrl: response.url, sourceId: SOURCE_ID, sourceName: source.name, sourceSiteUrl: LIST_URL, contentCategory: category(item.title), detailValidation: { verified: true, sourceTitle: detailTitle, dateProvenance: "LIST_ROW_VERIFIED" } }); }
  if (accepted.length < 3 || accepted.some(item => !item.publishedAt)) throw new Error("collector_detail_validation_failed");
  const priorItems = getAllItems(), { newItems, duplicateCount } = filterNewItems(accepted, priorItems); if (newItems.length < 3 || duplicateCount !== 0) throw new Error("store_dedup_validation_failed");
  const backupDirectory = backup(); university.sources.push({ ...source, verified: true, enabled: true, status: "verified", healthStatus: "healthy" }); write(CATALOG, catalog); const saved = saveNewItems(newItems);
  const previewItems = read(PREVIEW_PATH).items.filter(item => item.universityId === UNIVERSITY_ID), after = { verified: catalog.universities.flatMap(item => item.sources || []).filter(item => item.verified).length, activeSourceCount: catalog.universities.flatMap(item => item.sources || []).filter(item => item.enabled).length, store: getAllItems().length, preview: read(PREVIEW_PATH).items.length };
  const result = { phase: "dnue_general_feed_activation", status: "ACTIVATED_SUCCESS", universityId: UNIVERSITY_ID, sourceId: SOURCE_ID, sourceUrl: LIST_URL, existingSource: false, before, collector: { found: collected.items.length, accepted: accepted.length, titleMismatch: collected.items.length - accepted.length, publishedAtNull: accepted.filter(item => !item.publishedAt).length, duplicateCount }, batchAdded: newItems.length, preExisting: priorItems.length, saved, previewCount: previewItems.length, previewVisibility: previewItems.length ? "VISIBLE" : "PREVIEW_NOT_VISIBLE", after, verifiedTransactionIncrease: after.verified - before.verified, backupDirectory, mutationFiles: [CATALOG, STORE_PATH, PREVIEW_PATH] }; fs.mkdirSync(path.dirname(REPORT), { recursive: true }); write(REPORT, result); console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
