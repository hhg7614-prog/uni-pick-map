"use strict";

const { isValidNewsCategory, getNewsCategoryLabel } = require("../utils/categoryUtils");

const COLLECTION_TYPES = new Set(["rss", "html", "api", "playwright", "news_api"]);
const SOURCE_STATUSES = new Set(["pending", "verified", "unreachable", "unsupported", "requires_playwright", "disabled"]);

function createNewsSource(input = {}) {
  if (!isValidNewsCategory(input.category)) throw new Error("Invalid news source category");
  return {
    id: String(input.id || ""), category: input.category, categoryLabel: getNewsCategoryLabel(input.category), name: String(input.name || ""),
    sourceType: input.sourceType === "media" ? "media" : "official", collectionType: COLLECTION_TYPES.has(input.collectionType) ? input.collectionType : "html",
    listUrl: "", rssUrl: "", baseUrl: "", selectors: { item:"", title:"", link:"", date:"", summary:"", thumbnail:"", content:"", ...(input.selectors || {}) },
    enabled: false, verified: false, lastCollectedAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null,
    status: SOURCE_STATUSES.has(input.status) ? input.status : "pending",
  };
}

module.exports = { createNewsSource, COLLECTION_TYPES, SOURCE_STATUSES };
