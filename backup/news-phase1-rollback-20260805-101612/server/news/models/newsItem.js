"use strict";

const { getNewsCategoryLabel, isValidNewsCategory } = require("../utils/categoryUtils");
const { createHash } = require("../utils/hashUtils");

const VALID_SOURCE_TYPES = new Set(["official", "media"]);
const VALID_STATUSES = new Set(["collected", "processed", "ignored", "failed", "pending"]);

function createNewsItem(input = {}) {
  if (!isValidNewsCategory(input.category)) throw new Error("Invalid news category");
  const sourceType = VALID_SOURCE_TYPES.has(input.sourceType) ? input.sourceType : "official";
  const status = VALID_STATUSES.has(input.status) ? input.status : "collected";
  const sourceUrl = /^https?:\/\//i.test(input.sourceUrl || "") ? input.sourceUrl : "";
  return {
    id: String(input.id || createHash(`${input.universityId}|${input.title}|${sourceUrl}`).slice(0, 24)),
    universityId: String(input.universityId || ""), universityGroupId: String(input.universityGroupId || ""),
    universityName: String(input.universityName || ""), campusName: String(input.campusName || ""),
    category: input.category, categoryLabel: getNewsCategoryLabel(input.category),
    title: String(input.title || ""), summary: String(input.summary || ""), contentText: String(input.contentText || ""),
    sourceName: String(input.sourceName || ""), sourceType, sourceUrl, sourceSiteUrl: /^https?:\/\//i.test(input.sourceSiteUrl || "") ? input.sourceSiteUrl : "",
    thumbnailUrl: /^https?:\/\//i.test(input.thumbnailUrl || "") ? input.thumbnailUrl : "",
    publishedAt: input.publishedAt || null, collectedAt: input.collectedAt || null, processedAt: input.processedAt || null, updatedAt: input.updatedAt || null,
    contentHash: String(input.contentHash || createHash(`${input.title}|${input.contentText || input.summary}`)), urlHash: String(input.urlHash || createHash(sourceUrl)),
    isImportant: typeof input.isImportant === "boolean" ? input.isImportant : null, keywords: Array.isArray(input.keywords) ? input.keywords.map(String).slice(0, 20) : [],
    aiProcessed: false, status, errorMessage: input.errorMessage ? String(input.errorMessage) : null, isSample: Boolean(input.isSample),
  };
}

module.exports = { createNewsItem, VALID_SOURCE_TYPES, VALID_STATUSES };
