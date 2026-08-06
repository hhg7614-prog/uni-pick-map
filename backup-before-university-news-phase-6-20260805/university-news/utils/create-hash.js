"use strict";

const crypto = require("crypto");
const { normalizeUrl } = require("./normalize-url");
const { normalizeTitle } = require("./normalize-title");

function createHash(value) {
  return crypto.createHash("sha256").update(String(value || "").trim().replace(/\s+/g, " "), "utf8").digest("hex");
}

function createItemHashes(item) {
  return {
    urlHash: createHash(item.sourceUrl),
    contentHash: createHash([item.universityId, item.title, item.publishedAt || ""].join("|"))
  };
}

function createUrlHash(sourceUrl) {
  const normalizedSourceUrl = normalizeUrl(sourceUrl);
  return normalizedSourceUrl ? createHash(normalizedSourceUrl) : null;
}

function createContentHash(item) {
  const key = item.universityGroupId || item.universityId || "";
  const normalizedTitle = item.normalizedTitle || normalizeTitle(item.title);
  const datePart = item.publishedAt ? String(item.publishedAt).slice(0, 10) : String(item.sourceName || "").trim();
  return createHash([key, item.category || "", normalizedTitle, datePart].join("|"));
}

module.exports = { createHash, createItemHashes, createUrlHash, createContentHash };
