"use strict";

// Explicit one-university trial runner. It never starts the scheduler, commits, or pushes.

const fs = require("fs");
const path = require("path");
const { rssCollector } = require("../../../development/university-news/collectors/rss-collector");
const { htmlListCollector, findBySelector, textOf } = require("../../../development/university-news/collectors/html-list-collector");
const { parseDate } = require("../../../development/university-news/utils/parse-date");
const { normalizeUrl } = require("../../../development/university-news/utils/normalize-url");
const { filterNewItems } = require("../dedup");
const { getAllItems, saveNewItems } = require("../store");

const ROOT = path.resolve(__dirname, "../../..");
const MAX_ITEMS = 3;
const MAX_ATTEMPTS = 2;
const TIMEOUT_MS = 15000;

function parseOptions(argv) {
  const read = (name) => argv.find((value) => value.startsWith(`${name}=`))?.split("=").slice(1).join("=").trim();
  const universityId = read("--university-id");
  const limit = Number(read("--limit") || MAX_ITEMS);
  if (!universityId) throw new Error("--university-id is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS) throw new Error(`--limit must be 1-${MAX_ITEMS}.`);
  return { universityId, limit, diagnose: argv.includes("--diagnose") };
}

function normalizeText(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function sameText(first, second) {
  return normalizeText(first) === normalizeText(second);
}

function isValidDetailUrl(value, source) {
  const url = normalizeUrl(value);
  const list = normalizeUrl(source.listUrl || source.rssUrl);
  if (!url || url === list) return false;
  const item = new URL(url);
  const sourceHost = new URL(source.baseUrl || source.listUrl || source.rssUrl).hostname.replace(/^www\./, "");
  if (item.hostname.replace(/^www\./, "") !== sourceHost) return false;
  return item.pathname !== "/" && !/(?:login|signin|auth)/i.test(item.pathname);
}

function isRejectedDetailPage(html) {
  const pageTitle = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return /(?:\uB85C\uADF8\uC778|\blogin\b|\b(?:404|500)\b|page not found|error page|\uC624\uB958\s*\uD398\uC774\uC9C0)/i.test(pageTitle);
}

async function request(url) {
  let error;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { response, attempt };
    } catch (caught) {
      error = caught;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw error || new Error("Request failed.");
}

function backupBeforeSave() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const directory = path.join(ROOT, "server", "agent", "data", "single-school-trial-backups", stamp);
  fs.mkdirSync(directory, { recursive: true });
  for (const [from, to] of [
    [path.join(ROOT, "server", "agent", "data", "agent-news-store.json"), "agent-news-store.json"],
    [path.join(ROOT, "data", "university-news-preview.json"), "university-news-preview.json"],
  ]) if (fs.existsSync(from)) fs.copyFileSync(from, path.join(directory, to));
  return directory;
}

function extractDetail(html, source, listPublishedAt) {
  const selectors = source.detailSelectors || {};
  const title = selectors.title ? textOf(findBySelector(html, selectors.title)[0]) : "";
  const dateValues = selectors.date ? findBySelector(html, selectors.date).map(textOf) : [];
  const rawDate = dateValues.find((value) => parseDate(value).value) || dateValues[0] || "";
  const parsed = parseDate(rawDate).value;
  if (!parsed && source.allowListDateFallback && listPublishedAt) {
    return { title, rawDate: listPublishedAt, publishedAt: listPublishedAt, dateSelector: "list-date fallback" };
  }
  return { title, rawDate, publishedAt: parsed, dateSelector: selectors.date || "" };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json"), "utf8"));
  const university = (catalog.universities || []).find((entry) => entry.universityId === options.universityId);
  const source = university && (university.sources || []).find((entry) => entry.sourceType === "official" && entry.verified && ["rss", "html"].includes(entry.collectionType));
  if (!university || !source) throw new Error("No verified official RSS/HTML source exists for the requested university.");

  console.log(JSON.stringify({ phase: "single_school_trial", diagnose: options.diagnose, university: { universityId: university.universityId, universityGroupId: university.universityGroupId, universityName: university.universityName }, source: { id: source.id, name: source.name, category: source.category, collectionType: source.collectionType, configuredEnabled: source.enabled }, limits: { items: options.limit, concurrency: 1, maxAttempts: MAX_ATTEMPTS } }, null, 2));
  const result = source.collectionType === "rss" ? await rssCollector({ university, source, limit: options.limit }) : await htmlListCollector({ university, source, limit: options.limit });
  const accepted = [];
  const excluded = [];
  const diagnostics = [];

  for (const item of result.items || []) {
    const diagnostic = { title: item.title || "", sourceUrl: item.sourceUrl || "", publishedAtRaw: "", dateLocation: "", method: "", publishedAt: null, detailValidation: "not_run", storable: false, reason: null };
    if (!item.title || item.universityId !== university.universityId || item.universityGroupId !== university.universityGroupId || item.category !== source.category) {
      diagnostic.reason = "required_field_or_identity_mismatch";
      excluded.push(diagnostic); diagnostics.push(diagnostic); continue;
    }
    if (!isValidDetailUrl(item.sourceUrl, source)) {
      diagnostic.detailValidation = "rejected"; diagnostic.method = "official-host/detail-url validation"; diagnostic.reason = "not_a_valid_detail_url";
      excluded.push(diagnostic); diagnostics.push(diagnostic); continue;
    }
    try {
      const { response, attempt } = await request(item.sourceUrl);
      const finalUrl = normalizeUrl(response.url);
      const html = await response.text();
      diagnostic.sourceUrl = finalUrl || item.sourceUrl;
      if (!isValidDetailUrl(finalUrl, source) || isRejectedDetailPage(html)) {
        diagnostic.detailValidation = "rejected"; diagnostic.method = "redirect/login/error validation"; diagnostic.reason = "login_or_error_or_non_detail_page";
        excluded.push(diagnostic); diagnostics.push(diagnostic); continue;
      }
      const detail = extractDetail(html, source, item.publishedAt);
      diagnostic.publishedAtRaw = detail.rawDate;
      diagnostic.dateLocation = detail.dateSelector;
      diagnostic.method = "detail page selector";
      diagnostic.publishedAt = detail.publishedAt;
      const officialNames = source.officialNames?.length ? source.officialNames : [university.universityName];
      const universityMatch = officialNames.some((name) => normalizeText(html).includes(normalizeText(name)));
      if (!universityMatch || !sameText(item.title, detail.title)) {
        diagnostic.detailValidation = "failed"; diagnostic.reason = "detail_title_or_university_mismatch";
        excluded.push(diagnostic); diagnostics.push(diagnostic); continue;
      }
      diagnostic.detailValidation = `passed_attempt_${attempt}`;
      if (!detail.publishedAt) {
        diagnostic.reason = "published_at_not_found";
        excluded.push(diagnostic); diagnostics.push(diagnostic); continue;
      }
      diagnostic.storable = true;
      diagnostics.push(diagnostic);
      accepted.push({ ...item, sourceId: source.id || "", sourceUrl: diagnostic.sourceUrl, publishedAt: detail.publishedAt, detailValidation: { verified: true, sourceTitle: detail.title, sourceDate: detail.rawDate } });
    } catch (error) {
      diagnostic.detailValidation = "failed"; diagnostic.method = "detail request"; diagnostic.reason = "detail_fetch_failed"; diagnostic.error = error.message;
      excluded.push(diagnostic); diagnostics.push(diagnostic);
    }
  }

  const { newItems, duplicateCount } = filterNewItems(accepted.slice(0, 5), getAllItems());
  const backupDir = options.diagnose ? null : backupBeforeSave();
  const saveResult = options.diagnose ? { dryRun: true, savedCount: 0, totalCount: getAllItems().length } : newItems.length ? saveNewItems(newItems) : { savedCount: 0, totalCount: getAllItems().length };
  console.log(JSON.stringify({ foundCount: (result.items || []).length, acceptedCount: accepted.length, newCount: newItems.length, duplicateCount, excludedCount: excluded.length, diagnostics, sourceWarnings: result.warnings || [], backupDir, saveResult }, null, 2));
}

main().catch((error) => { console.error("[single-school-trial]", error.message); process.exitCode = 1; });
