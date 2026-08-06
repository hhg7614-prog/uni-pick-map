"use strict";

const { rssCollector } = require("./rss-collector");
const { htmlListCollector } = require("./html-list-collector");

function getCollector(collectionType) {
  if (collectionType === "rss") return { collector: rssCollector, status: "ready" };
  if (collectionType === "html") return { collector: htmlListCollector, status: "ready" };
  if (["api", "news_api", "playwright"].includes(collectionType)) return { collector: null, status: "skipped" };
  return { collector: null, status: "unsupported" };
}

module.exports = { getCollector };
