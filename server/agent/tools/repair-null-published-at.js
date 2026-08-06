"use strict";

// Repairs only publishedAt for existing, null-dated, verified official items.
// No item is added, deleted, or otherwise altered.

const fs = require("fs");
const path = require("path");
const { findBySelector, textOf } = require("../../../development/university-news/collectors/html-list-collector");
const { parseDate } = require("../../../development/university-news/utils/parse-date");
const { normalizeUrl } = require("../../../development/university-news/utils/normalize-url");

const ROOT = path.resolve(__dirname, "../../..");
const STORE_PATH = path.join(ROOT, "server", "agent", "data", "agent-news-store.json");
const PREVIEW_PATH = path.join(ROOT, "data", "university-news-preview.json");
const TARGET_IDS = new Set(["seoul-national-university-gwanak", "yonsei-university-sinchon", "hanyang-university-seoul"]);

function decodeEntities(value) {
  return String(value || "").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10))).replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");
}

function normalizeText(value) {
  return decodeEntities(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function writeAtomic(filePath, data) {
  const tempPath = `${filePath}.null-date-repair.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(tempPath, "utf8"));
  fs.renameSync(tempPath, filePath);
}

function backup() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const directory = path.join(ROOT, "server", "agent", "data", "null-date-repair-backups", stamp);
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(STORE_PATH, path.join(directory, "agent-news-store.json"));
  fs.copyFileSync(PREVIEW_PATH, path.join(directory, "university-news-preview.json"));
  return directory;
}

async function inspectItem(item, source) {
  const base = { university: item.universityName, title: item.title, sourceUrl: item.sourceUrl, currentPublishedAt: item.publishedAt, sourceId: source.id, officialDomain: false, rawDate: "", publishedAt: null, dateSelector: source.detailSelectors?.date || "", result: "not_repaired" };
  if (/youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com\//i.test(item.sourceUrl || "")) return { ...base, result: "external_link" };
  try {
    const response = await fetch(item.sourceUrl, { redirect: "follow", headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" } });
    if (!response.ok) return { ...base, result: "detail_fetch_failed", error: `HTTP ${response.status}` };
    const html = await response.text();
    const finalUrl = normalizeUrl(response.url);
    const hostMatches = finalUrl && new URL(finalUrl).hostname.replace(/^www\./, "") === new URL(source.baseUrl || source.listUrl).hostname.replace(/^www\./, "");
    const title = textOf(findBySelector(html, source.detailSelectors?.title)[0]);
    const dateValues = findBySelector(html, source.detailSelectors?.date).map(textOf);
    const rawDate = dateValues.find((value) => parseDate(value).value) || "";
    const parsed = parseDate(rawDate).value;
    const officialNames = source.officialNames?.length ? source.officialNames : [item.universityName];
    const universityMatches = officialNames.some((name) => normalizeText(html).includes(normalizeText(name)));
    const titleMatches = normalizeText(title) === normalizeText(item.title);
    const isDetail = finalUrl && finalUrl !== normalizeUrl(source.listUrl) && !/(?:login|signin|auth)/i.test(new URL(finalUrl).pathname);
    const passed = Boolean(hostMatches && isDetail && titleMatches && universityMatches && parsed);
    return { ...base, sourceUrl: finalUrl || item.sourceUrl, officialDomain: Boolean(hostMatches), rawDate, publishedAt: parsed, titleMatches, universityMatches, isDetail, result: passed ? "repairable" : "verification_failed" };
  } catch (error) {
    return { ...base, result: "detail_fetch_failed", error: error.message };
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  const preview = JSON.parse(fs.readFileSync(PREVIEW_PATH, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json"), "utf8"));
  const targets = store.items.filter((item) => item.publishedAt == null && TARGET_IDS.has(item.universityId));
  const results = [];
  for (const item of targets) {
    const university = catalog.universities.find((entry) => entry.universityId === item.universityId);
    const source = university?.sources?.find((entry) => entry.id === ({ "seoul-national-university-gwanak": "snu-school-news", "yonsei-university-sinchon": "yonsei-school-news", "hanyang-university-seoul": "hanyang-school-notice" }[item.universityId]));
    if (!source?.detailSelectors) results.push({ university: item.universityName, title: item.title, sourceUrl: item.sourceUrl, currentPublishedAt: item.publishedAt, sourceId: source?.id || null, result: "missing_source_selectors" });
    else results.push(await inspectItem(item, source));
  }
  const repairs = results.filter((result) => result.result === "repairable");
  let backupDir = null;
  if (!dryRun && repairs.length) {
    backupDir = backup();
    const repairMap = new Map(repairs.map((result) => [`${result.sourceUrl}|${result.title}`, result.publishedAt]));
    const apply = (items) => items.map((item) => {
      const publishedAt = repairMap.get(`${normalizeUrl(item.sourceUrl) || item.sourceUrl}|${item.title}`);
      return publishedAt ? { ...item, publishedAt } : item;
    });
    const updatedStore = { ...store, updatedAt: new Date().toISOString(), items: apply(store.items) };
    const updatedPreview = { ...preview, generatedAt: new Date().toISOString(), items: apply(preview.items) };
    if (updatedStore.items.length !== store.items.length || updatedPreview.items.length !== preview.items.length) throw new Error("Item count changed; aborting repair.");
    writeAtomic(STORE_PATH, updatedStore);
    writeAtomic(PREVIEW_PATH, updatedPreview);
  }
  console.log(JSON.stringify({ dryRun, targetCount: targets.length, repairCount: repairs.length, failureCount: results.length - repairs.length, backupDir, results }, null, 2));
}

main().catch((error) => { console.error("[repair-null-published-at]", error.message); process.exitCode = 1; });
