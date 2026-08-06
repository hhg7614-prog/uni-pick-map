"use strict";

const crypto = require("crypto");

function createHash(value) {
  return crypto.createHash("sha256").update(String(value || "").trim().replace(/\s+/g, " "), "utf8").digest("hex");
}

function createItemHashes(item) {
  return {
    urlHash: createHash(item.sourceUrl),
    contentHash: createHash([item.universityId, item.title, item.publishedAt || ""].join("|"))
  };
}

module.exports = { createHash, createItemHashes };
