"use strict";

// One-time operational cleanup. This file is intentionally not committed.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../..");
const STORE_PATH = path.join(ROOT, "server/agent/data/agent-news-store.json");
const PREVIEW_PATH = path.join(ROOT, "data/university-news-preview.json");
const CONFIG_PATH = path.join(ROOT, "development/university-news/data/university-news-sources.final.json");
const BACKUP_PATH = path.join(ROOT, "server/agent/data/agent-news-store.before-verified-cleanup.json");
const { rebuildPreviewFromStore } = require("../store");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function itemKey(item) { return `${item.id || ""}\u0000${item.sourceId || ""}\u0000${item.sourceUrl || item.url || ""}`; }
function writeAtomic(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temp, "utf8"));
  fs.renameSync(temp, file);
}

function audit() {
  const store = readJson(STORE_PATH);
  const config = readJson(CONFIG_PATH);
  const items = store.items || [];
  const sources = (config.universities || []).flatMap(university =>
    (university.sources || []).map(source => ({ ...source, universityId: university.universityId }))
  );
  const known = new Map(sources.map(source => [source.id, source]));
  const protectedSources = new Map(sources.filter(source => source.verified === true && source.enabled === true).map(source => [source.id, source]));
  const protectedItems = [];
  const deletePlan = [];
  const manualReview = [];
  let invalidUrl = 0;

  for (const item of items) {
    const url = item.sourceUrl || item.url || "";
    if (!/^https?:\/\//i.test(url)) invalidUrl += 1;
    if (item.sourceId && protectedSources.has(item.sourceId)) {
      protectedItems.push(item);
    } else if (!item.sourceId) {
      deletePlan.push({ item, deleteReason: "SOURCE_ID_MISSING" });
    } else if (known.has(item.sourceId)) {
      manualReview.push({ item, manualReason: "KNOWN_SOURCE_NOT_VERIFIED_ENABLED" });
    } else {
      deletePlan.push({ item, deleteReason: "SOURCE_NOT_CONFIGURED" });
    }
  }

  const urlCounts = new Map();
  for (const item of items) {
    const url = item.sourceUrl || item.url || "";
    if (url) urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
  }
  return { store, items, protectedSources, protectedItems, deletePlan, manualReview, invalidUrl, duplicateDetailUrls: [...urlCounts.values()].filter(count => count > 1).length };
}

function reportPlan(result) {
  console.log("[CLEANUP DELETE PLAN]");
  for (const entry of result.deletePlan) {
    const item = entry.item;
    console.log(JSON.stringify({ universityId: item.universityId, universityName: item.universityName, sourceId: item.sourceId || null, title: item.title, publishedAt: item.publishedAt, url: item.sourceUrl || item.url, deleteReason: entry.deleteReason }));
  }
  console.log(JSON.stringify({ cleanupBefore: result.items.length, verifiedProtected: result.protectedItems.length, deletePlanned: result.deletePlan.length, manualReview: result.manualReview.length, expectedAfter: result.items.length - result.deletePlan.length, invalidUrl: result.invalidUrl, duplicateDetailUrls: result.duplicateDetailUrls }, null, 2));
}

function main() {
  const planOnly = process.argv.includes("--plan");
  const result = audit();
  reportPlan(result);
  if (planOnly) return;
  if (result.manualReview.length || result.invalidUrl || result.duplicateDetailUrls) throw new Error("Cleanup safety gate failed: manual review, invalid URL, or duplicate URL exists.");
  if (fs.existsSync(BACKUP_PATH)) throw new Error(`Backup already exists: ${BACKUP_PATH}`);
  const beforeHash = sha256(STORE_PATH);
  fs.copyFileSync(STORE_PATH, BACKUP_PATH);
  if (!fs.existsSync(BACKUP_PATH) || sha256(BACKUP_PATH) !== beforeHash || readJson(BACKUP_PATH).items.length !== result.items.length) throw new Error("Backup verification failed.");

  const removed = new Set(result.deletePlan.map(entry => itemKey(entry.item)));
  const retained = result.items.filter(item => !removed.has(itemKey(item)));
  const updated = { ...result.store, updatedAt: new Date().toISOString(), totalItems: retained.length, items: retained };
  writeAtomic(STORE_PATH, updated);
  const preview = rebuildPreviewFromStore();
  const after = audit();
  const protectedBefore = new Set(result.protectedItems.map(itemKey));
  const protectedAfter = new Set(after.protectedItems.map(itemKey));
  const accidentalDeletion = [...protectedBefore].filter(key => !protectedAfter.has(key)).length;
  const previewData = readJson(PREVIEW_PATH);
  const retainedKeys = new Set(retained.map(itemKey));
  const previewOrphans = (previewData.items || []).filter(item => !retainedKeys.has(itemKey(item))).length;
  const previewDuplicateUrls = [...new Set((previewData.items || []).map(item => item.sourceUrl || item.url || ""))].length !== (previewData.items || []).length;
  const deletedInPreview = (previewData.items || []).filter(item => removed.has(itemKey(item))).length;
  const invariant = result.items.length === result.deletePlan.length + after.items.length;
  if (!invariant || accidentalDeletion || after.deletePlan.length || previewOrphans || previewDuplicateUrls || deletedInPreview || after.manualReview.length || after.invalidUrl || after.duplicateDetailUrls) throw new Error("Cleanup invariant failed after write.");
  console.log(JSON.stringify({ cleanupPerformed: true, before: result.items.length, verifiedKept: result.protectedItems.length, removed: result.deletePlan.length, manualReview: result.manualReview.length, after: after.items.length, previewCount: preview.previewCount, orphans: previewOrphans, duplicateDetailUrls: after.duplicateDetailUrls, accidentalDeletion, backupPath: BACKUP_PATH, backupHash: beforeHash, invariant }, null, 2));
}

main();
