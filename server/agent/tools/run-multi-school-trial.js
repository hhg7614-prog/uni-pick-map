"use strict";

// Explicit, allow-listed integration trial for validated universities only.
// It never enables schedules, commits, pushes, or deploys.

const fs = require("fs");
const path = require("path");
const { rssCollector } = require("../../../development/university-news/collectors/rss-collector");
const { htmlListCollector, findBySelector, textOf } = require("../../../development/university-news/collectors/html-list-collector");
const { parseDate } = require("../../../development/university-news/utils/parse-date");
const { normalizeUrl } = require("../../../development/university-news/utils/normalize-url");
const { filterNewItems } = require("../dedup");
const { getAllItems, saveNewItems } = require("../store");

const ROOT = path.resolve(__dirname, "../../..");
const MAX_PER_SOURCE = 3;
const MAX_ATTEMPTS = 2;
const TIMEOUT_MS = 15000;
const EXPECTED_SOURCES = new Map([
  ["seoul-national-university-gwanak", "snu-school-news"],
  ["yonsei-university-sinchon", "yonsei-school-news"],
  ["korea-university-seoul", "korea-official-news"],
  ["hanyang-university-seoul", "hanyang-school-notice"],
  ["ewha-womans-university", "ewha-official-news"],
  ["dongguk-university-seoul", "dongguk-seoul-school-news"],
]);

function parseOptions(argv) {
  const read = (name) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1).trim();
  const ids = (read("--university-ids") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const limit = Number(read("--limit-per-source") || MAX_PER_SOURCE);
  if (ids.length !== EXPECTED_SOURCES.size || new Set(ids).size !== EXPECTED_SOURCES.size || ids.some((id) => !EXPECTED_SOURCES.has(id))) {
    throw new Error(`This integration trial requires exactly the ${EXPECTED_SOURCES.size} approved --university-ids.`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PER_SOURCE) throw new Error(`--limit-per-source must be 1-${MAX_PER_SOURCE}.`);
  return { ids, limit, dryRun: argv.includes("--dry-run") };
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
  return item.hostname.replace(/^www\./, "") === sourceHost && item.pathname !== "/" && !/(?:login|signin|auth)/i.test(item.pathname);
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
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" } });
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

function extractDetail(html, source) {
  const selectors = source.detailSelectors || {};
  const title = selectors.title ? textOf(findBySelector(html, selectors.title)[0]) : "";
  const values = selectors.date ? findBySelector(html, selectors.date).map(textOf) : [];
  const rawDate = values.find((value) => parseDate(value).value) || values[0] || "";
  return { title, rawDate, publishedAt: parseDate(rawDate).value };
}

function backupBeforeSave() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const directory = path.join(ROOT, "server", "agent", "data", "multi-school-trial-backups", stamp);
  fs.mkdirSync(directory, { recursive: true });
  for (const [from, name] of [[path.join(ROOT, "server", "agent", "data", "agent-news-store.json"), "agent-news-store.json"], [path.join(ROOT, "data", "university-news-preview.json"), "university-news-preview.json"]]) {
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(directory, name));
  }
  return directory;
}

async function collectForUniversity(university, source, limit) {
  const result = source.collectionType === "rss" ? await rssCollector({ university, source, limit }) : await htmlListCollector({ university, source, limit });
  const accepted = [];
  const excluded = [];
  for (const item of result.items || []) {
    if (!item.title || item.universityId !== university.universityId || item.universityGroupId !== university.universityGroupId || item.category !== source.category || !isValidDetailUrl(item.sourceUrl, source)) {
      excluded.push({ title: item.title || "", reason: "identity_or_detail_url_invalid" });
      continue;
    }
    try {
      const { response, attempt } = await request(item.sourceUrl);
      const html = await response.text();
      const finalUrl = normalizeUrl(response.url);
      const detail = extractDetail(html, source);
      const officialNames = source.officialNames?.length ? source.officialNames : [university.universityName];
      const hasOfficialName = officialNames.some((name) => normalizeText(html).includes(normalizeText(name)));
      if (!isValidDetailUrl(finalUrl, source) || isRejectedDetailPage(html) || !hasOfficialName || !sameText(item.title, detail.title) || !detail.publishedAt) {
        excluded.push({ title: item.title, reason: "detail_validation_failed" });
        continue;
      }
      accepted.push({ ...item, sourceUrl: finalUrl, publishedAt: detail.publishedAt, detailValidation: { verified: true, sourceTitle: detail.title, sourceDate: detail.rawDate, attempts: attempt } });
    } catch (error) {
      excluded.push({ title: item.title, reason: "detail_fetch_failed", error: error.message });
    }
  }
  return { found: (result.items || []).length, accepted, excluded, warnings: result.warnings || [] };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json"), "utf8"));
  const targets = options.ids.map((id) => {
    const university = (catalog.universities || []).find((entry) => entry.universityId === id);
    const source = university && (university.sources || []).find((entry) => entry.id === EXPECTED_SOURCES.get(id) && entry.sourceType === "official" && entry.verified && ["rss", "html"].includes(entry.collectionType));
    if (!university || !source) throw new Error(`Approved official source is unavailable for ${id}.`);
    return { university, source };
  });
  console.log(JSON.stringify({ phase: "validated_school_integration_trial", dryRun: options.dryRun, targetUniversityIds: options.ids, targetSources: targets.map(({ university, source }) => ({ universityId: university.universityId, universityGroupId: university.universityGroupId, sourceId: source.id, category: source.category, collectionType: source.collectionType, enabled: source.enabled })), limits: { perSource: options.limit, collectionConcurrency: 1, detailConcurrency: 1, maxAttempts: MAX_ATTEMPTS } }, null, 2));
  if (options.dryRun) return;

  const storeBefore = getAllItems();
  const perUniversity = [];
  let candidates = [];
  for (const target of targets) {
    try {
      const outcome = await collectForUniversity(target.university, target.source, options.limit);
      candidates = candidates.concat(outcome.accepted);
      perUniversity.push({ universityId: target.university.universityId, universityName: target.university.universityName, sourceId: target.source.id, found: outcome.found, accepted: outcome.accepted.length, excluded: outcome.excluded.length, warnings: outcome.warnings, error: null });
    } catch (error) {
      perUniversity.push({ universityId: target.university.universityId, universityName: target.university.universityName, sourceId: target.source.id, found: 0, accepted: 0, excluded: 0, warnings: [], error: error.message });
    }
  }
  const { newItems, duplicateCount } = filterNewItems(candidates, storeBefore);
  newItems.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const backupDir = backupBeforeSave();
  const saveResult = newItems.length ? saveNewItems(newItems) : { savedCount: 0, totalCount: storeBefore.length };
  const summary = perUniversity.map((result) => ({ ...result, newCount: newItems.filter((item) => item.universityId === result.universityId).length, duplicateCount: candidates.filter((item) => item.universityId === result.universityId).length - newItems.filter((item) => item.universityId === result.universityId).length }));
  console.log(JSON.stringify({ storeBefore: storeBefore.length, storeAfter: saveResult.totalCount, foundTotal: perUniversity.reduce((sum, result) => sum + result.found, 0), acceptedTotal: candidates.length, newTotal: newItems.length, duplicateTotal: duplicateCount, excludedTotal: perUniversity.reduce((sum, result) => sum + result.excluded, 0), backupDir, saveResult, perUniversity: summary }, null, 2));
}

main().catch((error) => { console.error("[multi-school-trial]", error.message); process.exitCode = 1; });
