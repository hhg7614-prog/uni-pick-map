"use strict";

const { normalizeCollectedItem } = require("./normalize-collected-item");

function decodeXml(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').trim();
}

function tagValue(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (match) {
      // CDATA를 먼저 벗긴 뒤 잔여 HTML 태그를 제거해야 한다. 순서가 반대이면
      // `<![CDATA[ ... ]]>`(내부에 '>' 없음) 블록 전체가 하나의 태그로 잡혀
      // title/link가 통째로 사라진다(한글 대학 CMS RSS의 일반적 형태).
      const withoutCdata = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
      return decodeXml(withoutCdata.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
    }
  }
  return "";
}

// Nara Info CMS RSS <link> 보정: `.do` 접미사가 빠지고 가짜 쿼리스트링이 붙은
// `.../artclView` 링크를 정상 `.../artclView.do`로 재작성한다(대소문자 보존).
function normalizeDetailLink(value) {
  return String(value || "").replace(/(\/artcl[Vv]iew)(\?[^#]*)?$/, "$1.do");
}

function linkValue(xml) {
  const attributeLink = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return normalizeDetailLink(attributeLink ? attributeLink[1] : tagValue(xml, ["link"]));
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
