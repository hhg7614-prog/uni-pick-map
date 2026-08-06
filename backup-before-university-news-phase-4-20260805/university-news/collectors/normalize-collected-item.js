"use strict";

const { resolveUrl } = require("../utils/resolve-url");
const { parseDate } = require("../utils/parse-date");
const { createItemHashes } = require("../utils/create-hash");

function normalizeCollectedItem({ university, source, rawItem, collectedAt }) {
  const title = String(rawItem.title || "").replace(/\s+/g, " ").trim();
  const sourceUrl = resolveUrl(rawItem.link, source.baseUrl || source.listUrl || source.rssUrl);
  if (!title || !sourceUrl) return { item: null, warning: "제목 또는 원문 링크가 없어 제외했습니다." };

  const parsedDate = parseDate(rawItem.date);
  const item = {
    id: "",
    universityId: university.universityId,
    universityGroupId: university.universityGroupId,
    universityName: university.universityName,
    campusName: university.campusName || "",
    category: source.category,
    categoryLabel: source.categoryLabel,
    title,
    summary: String(rawItem.summary || "").replace(/\s+/g, " ").trim(),
    contentText: "",
    sourceName: source.name,
    sourceType: "official",
    sourceUrl,
    sourceSiteUrl: source.listUrl || source.rssUrl || "",
    thumbnailUrl: resolveUrl(rawItem.thumbnail, source.baseUrl || source.listUrl || source.rssUrl) || "",
    publishedAt: parsedDate.value,
    collectedAt,
    urlHash: "",
    contentHash: "",
    isImportant: null,
    keywords: [],
    aiProcessed: false,
    status: "collected",
    errorMessage: null,
    isSampleCollection: true
  };
  const hashes = createItemHashes(item);
  item.urlHash = hashes.urlHash;
  item.contentHash = hashes.contentHash;
  item.id = `phase3-${item.urlHash.slice(0, 16)}`;
  return { item, warning: parsedDate.warning };
}

module.exports = { normalizeCollectedItem };
