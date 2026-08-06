"use strict";

const { normalizeCollectedItem } = require("./normalize-collected-item");

function decodeXml(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').trim();
}

function tagValue(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return decodeXml(match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  }
  return "";
}

function linkValue(xml) {
  const attributeLink = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return attributeLink ? attributeLink[1] : tagValue(xml, ["link"]);
}

function extractEntries(xml, tag) {
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  return [...xml.matchAll(expression)].map((match) => match[1]);
}

async function rssCollector({ university, source, limit, fetchImpl = fetch, collectedAt = new Date().toISOString() }) {
  if (!source.rssUrl) return { status: "skipped", items: [], warnings: ["RSS URL이 없습니다."] };
  const response = await fetchImpl(source.rssUrl, { headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  if (!/^\s*<\?xml|<rss\b|<feed\b/i.test(xml)) throw new Error("RSS 주소에서 XML이 아닌 응답을 받았습니다.");

  const rawEntries = extractEntries(xml, "item");
  const entries = rawEntries.length ? rawEntries : extractEntries(xml, "entry");
  const warnings = [];
  const items = [];
  for (const entry of entries.slice(0, limit)) {
    const normalized = normalizeCollectedItem({ university, source, rawItem: {
      title: tagValue(entry, ["title"]), link: linkValue(entry),
      date: tagValue(entry, ["pubDate", "updated", "published"]),
      summary: tagValue(entry, ["description", "summary", "content"]),
      thumbnail: (entry.match(/<enclosure[^>]+url=["']([^"']+)["']/i) || [])[1] || ""
    }, collectedAt });
    if (normalized.item) items.push(normalized.item);
    if (normalized.warning) warnings.push(normalized.warning);
  }
  return { status: "success", items, warnings, finalUrl: response.url };
}

module.exports = { rssCollector };
