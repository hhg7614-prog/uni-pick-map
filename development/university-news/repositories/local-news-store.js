"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..");
const STORE_PATH = path.join(DATA_DIR, "data", "university-news-store.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

function now() { return new Date().toISOString(); }
function emptyStore() { const timestamp = now(); return { version: 1, createdAt: timestamp, updatedAt: timestamp, totalItems: 0, items: [] }; }
function timestampForFile() { return now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-"); }
function ensureDirectories() { fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true }); fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

function writeAtomic(file, data) {
  const temporary = `${file}.tmp.json`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temporary, "utf8"));
  fs.renameSync(temporary, file);
}

function backupStore() {
  if (!fs.existsSync(STORE_PATH)) return null;
  ensureDirectories();
  const backup = path.join(BACKUP_DIR, `university-news-store-${timestampForFile()}.json`);
  fs.copyFileSync(STORE_PATH, backup);
  const backups = fs.readdirSync(BACKUP_DIR).filter((name) => /^university-news-store-\d{8}-\d{6}\.json$/.test(name)).sort();
  while (backups.length > 10) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
  return backup;
}

function loadNewsStore() {
  ensureDirectories();
  if (!fs.existsSync(STORE_PATH)) return emptyStore();
  try {
    const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!store || !Array.isArray(store.items)) throw new Error("items 배열이 없습니다.");
    return { version: 1, createdAt: store.createdAt || now(), updatedAt: store.updatedAt || now(), totalItems: store.items.length, items: store.items };
  } catch (error) {
    const corrupted = path.join(path.dirname(STORE_PATH), `university-news-store.corrupted-${timestampForFile()}.json`);
    fs.copyFileSync(STORE_PATH, corrupted);
    throw new Error(`저장소 JSON을 읽을 수 없습니다. 원본을 ${path.basename(corrupted)} 파일로 백업했습니다: ${error.message}`);
  }
}

function saveNewsStore(store, { backup = true } = {}) {
  ensureDirectories();
  if (!store || !Array.isArray(store.items)) throw new Error("저장할 store.items 배열이 필요합니다.");
  if (backup) backupStore();
  const prepared = { version: 1, createdAt: store.createdAt || now(), updatedAt: now(), totalItems: store.items.length, items: store.items };
  writeAtomic(STORE_PATH, prepared);
  return prepared;
}

function getAllStoredNews() { return loadNewsStore().items; }
function getStoredNewsByUniversityId(universityId) { return getAllStoredNews().filter((item) => item.universityId === universityId); }
function getStoredNewsByCategory(category) { return getAllStoredNews().filter((item) => item.category === category); }
function findStoredNewsBySourceUrl(sourceUrl) { return getAllStoredNews().find((item) => item.normalizedSourceUrl === sourceUrl || item.sourceUrl === sourceUrl) || null; }
function findStoredNewsByUrlHash(urlHash) { return getAllStoredNews().find((item) => item.urlHash === urlHash) || null; }
function findStoredNewsByContentHash(contentHash) { return getAllStoredNews().find((item) => item.contentHash === contentHash) || null; }

function insertNewsItem(item) { const store = loadNewsStore(); store.items.push(item); return saveNewsStore(store); }
function insertManyNewsItems(items) { const store = loadNewsStore(); store.items.push(...items); return saveNewsStore(store); }
function updateNewsItem(newsId, changes) { const store = loadNewsStore(); const index = store.items.findIndex((item) => item.id === newsId); if (index < 0) return null; store.items[index] = { ...store.items[index], ...changes }; saveNewsStore(store); return store.items[index]; }

function getNewsStoreStatistics() {
  const items = getAllStoredNews();
  const byUniversity = {}, byCategory = { school_news: 0, school_notice: 0, media_news: 0, school_event: 0 };
  let aiProcessed = 0, withPublishedAt = 0;
  const dates = [];
  for (const item of items) {
    byUniversity[item.universityId] = (byUniversity[item.universityId] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    if (item.aiProcessed) aiProcessed += 1;
    if (item.publishedAt) { withPublishedAt += 1; const date = new Date(item.publishedAt); if (!Number.isNaN(date.getTime())) dates.push(date); }
  }
  dates.sort((a, b) => a - b);
  return { totalItems: items.length, byUniversity, byCategory, aiProcessed, notAiProcessed: items.length - aiProcessed, withPublishedAt, withoutPublishedAt: items.length - withPublishedAt, oldestPublishedAt: dates[0]?.toISOString() || null, latestPublishedAt: dates.at(-1)?.toISOString() || null };
}

function getStorePath() { return STORE_PATH; }
module.exports = { loadNewsStore, saveNewsStore, getAllStoredNews, getStoredNewsByUniversityId, getStoredNewsByCategory, findStoredNewsBySourceUrl, findStoredNewsByUrlHash, findStoredNewsByContentHash, insertNewsItem, insertManyNewsItems, updateNewsItem, getNewsStoreStatistics, backupStore, getStorePath };
