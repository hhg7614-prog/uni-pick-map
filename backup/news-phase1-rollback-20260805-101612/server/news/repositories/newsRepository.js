"use strict";

const { createNewsItem } = require("../models/newsItem");

function createNewsRepository(sampleItems = []) {
  const items = process.env.NODE_ENV === "production" ? [] : sampleItems.map(createNewsItem);
  const byId = new Map(items.map(item => [item.id, item]));
  const sorted = list => [...list].sort((a,b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  return {
    getAllNews(options = {}) { const filtered = options.category && options.category !== "all" ? items.filter(item => item.category === options.category) : items; return sorted(filtered); },
    getNewsByUniversityId(universityId, options = {}) { return this.getAllNews(options).filter(item => item.universityId === universityId); },
    getNewsByCategory(category, options = {}) { return this.getAllNews({ ...options, category }); },
    getNewsById(newsId) { return byId.get(newsId) || null; },
    saveNewsItem(item) { const normalized = createNewsItem(item); byId.set(normalized.id, normalized); const index=items.findIndex(entry=>entry.id===normalized.id); if(index>=0)items[index]=normalized; else items.push(normalized); return normalized; },
    newsExistsByUrlHash(hash) { return items.some(item => item.urlHash === hash); },
    newsExistsByContentHash(hash) { return items.some(item => item.contentHash === hash); },
    getLatestUpdateTime() {
      const latest = sorted(items).find(item => item.updatedAt || item.collectedAt || item.publishedAt);
      return latest ? (latest.updatedAt || latest.collectedAt || latest.publishedAt) : null;
    },
  };
}

module.exports = { createNewsRepository };
