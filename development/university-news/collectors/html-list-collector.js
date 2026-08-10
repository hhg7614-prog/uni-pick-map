"use strict";

const { normalizeCollectedItem } = require("./normalize-collected-item");

function decodeHtml(text) {
  return String(text || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function parseToken(token) {
  const match = String(token || "").trim().match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/);
  if (!match) return null;
  return { tag: (match[1] || "*").toLowerCase(), classes: (match[2].match(/[\w-]+/g) || []) };
}

function openingTag(fragment) {
  return fragment.slice(0, fragment.indexOf(">") + 1);
}

function attribute(fragment, name) {
  const match = openingTag(fragment).match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeHtml(match[1] || match[2] || match[3] || "") : "";
}

function elementEnd(html, start, tag) {
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(html))) {
    const value = match[0];
    if (/^<\//.test(value)) depth -= 1;
    else if (!/\/\s*>$/.test(value)) depth += 1;
    if (depth === 0) return html.slice(start, tagPattern.lastIndex);
  }
  return html.slice(start);
}

function findByToken(html, token) {
  const parsed = parseToken(token);
  if (!parsed) return [];
  const tagPattern = new RegExp(`<${parsed.tag === "*" ? "[a-zA-Z][\\w-]*" : parsed.tag}\\b[^>]*>`, "gi");
  const results = [];
  let match;
  while ((match = tagPattern.exec(html))) {
    const classes = attribute(match[0], "class").split(/\s+/).filter(Boolean);
    if (!parsed.classes.every((className) => classes.includes(className))) continue;
    const tag = match[0].match(/^<([\w-]+)/i)[1];
    results.push(elementEnd(html, match.index, tag));
  }
  return results;
}

function findBySelector(html, selector) {
  if (!selector) return [];
  return selector.trim().split(/\s+/).reduce((contexts, token) => contexts.flatMap((context) => findByToken(context, token)), [html]);
}

function textOf(fragment) {
  return decodeHtml(String(fragment || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function valueFrom(itemHtml, selector, attrName) {
  if (!selector) return "";
  if (selector.startsWith("@")) return attribute(itemHtml, selector.slice(1));
  const element = findBySelector(itemHtml, selector)[0];
  if (!element) return "";
  return attrName ? attribute(element, attrName) : textOf(element);
}

function indexedValueFrom(itemHtml, selector, index) {
  const elements = findBySelector(itemHtml, selector);
  return textOf(elements[Number.isInteger(index) ? index : 0]);
}

function detailLinkFromValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const locationMatch = text.match(/(?:location\.href|location\.assign\()\s*=?\s*["']([^"']+)["']/i);
  return locationMatch ? locationMatch[1] : text;
}

function cleanTitle(value, cleanupTokens = []) {
  let title = String(value || "").replace(/\s+/g, " ").trim();
  for (const token of cleanupTokens) {
    const text = String(token || "").trim();
    if (!text) continue;
    title = title.split(text).join("").replace(/\s+/g, " ").trim();
  }
  return title;
}

async function htmlListCollector({ university, source, limit, fetchImpl = fetch, collectedAt = new Date().toISOString() }) {
  const selectors = source.selectors || {};
  if (!source.listUrl) return { status: "skipped", items: [], warnings: ["목록 URL이 없습니다."] };
  if (!selectors.item || !selectors.title || !selectors.link) {
    return { status: "selector_required", items: [], warnings: ["목록 페이지 접근은 가능하지만 HTML 선택자 분석이 필요합니다."] };
  }

  const response = await fetchImpl(source.listUrl, { headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/html/i.test(contentType)) throw new Error(`HTML 목록 페이지가 아닙니다 (${contentType || "content-type 없음"})`);
  const html = await response.text();
  const itemHtmlList = findBySelector(html, selectors.item).slice(0, limit);
  const items = [];
  const warnings = [];
  for (const itemHtml of itemHtmlList) {
    const listDate = Number.isInteger(selectors.dateIndex) ? indexedValueFrom(itemHtml, selectors.date, selectors.dateIndex) : valueFrom(itemHtml, selectors.date);
    const normalized = normalizeCollectedItem({ university, source, rawItem: {
      title: cleanTitle(valueFrom(itemHtml, selectors.title), source.titleCleanupTokens),
      link: detailLinkFromValue(valueFrom(itemHtml, selectors.link, selectors.linkAttribute || (selectors.link === "@href" ? null : "href")) || valueFrom(itemHtml, selectors.link)),
      // A source can explicitly prefer a date verified from its own list row.
      // No current-time fallback is ever used by the collector.
      date: listDate,
      dateSource: source.datePolicy && source.datePolicy.prefer === "list" ? "verified_list_date" : "list_date",
      summary: valueFrom(itemHtml, selectors.summary),
      thumbnail: valueFrom(itemHtml, selectors.thumbnail, "src")
    }, collectedAt });
    if (normalized.item) items.push(normalized.item);
    if (normalized.warning) warnings.push(normalized.warning);
  }
  return { status: "success", items, warnings, finalUrl: response.url };
}

module.exports = { htmlListCollector, findBySelector, textOf, attribute, cleanTitle, detailLinkFromValue };
