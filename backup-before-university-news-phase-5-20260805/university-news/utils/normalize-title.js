"use strict";

function decodeEntities(value) {
  return String(value || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function normalizeTitle(value) {
  let title = decodeEntities(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  title = title.replace(/^(?:\[(?:공지|일반공지|행사|보도자료)\]\s*|(?:NEW|중요)\s*[:：-]?\s*)+/i, "");
  return title.trim().replace(/\s+/g, " ");
}

module.exports = { normalizeTitle };
