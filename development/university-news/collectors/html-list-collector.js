"use strict";

const { normalizeCollectedItem } = require("./normalize-collected-item");
const { parseSimpleFunctionCall, isSafeRawAttrValue, ALLOWED_DATA_ATTR_NAMES } = require("../utils/safe-onclick-call");

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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

// Compares hostnames only (ignoring a leading "www."), the same host-match
// convention already used across this codebase's URL-safety checks.
function sameHost(urlString, source) {
  try {
    const target = new URL(urlString);
    const official = new URL(source.baseUrl || source.listUrl || source.rssUrl);
    return (
      target.hostname.replace(/^www\./i, "").toLowerCase() ===
      official.hostname.replace(/^www\./i, "").toLowerCase()
    );
  } catch {
    return false;
  }
}

// Replaces "{key}" placeholders in `template` with `values[key]`. Returns
// null (instead of leaving a literal "{key}" in the URL) if any referenced
// placeholder is missing from `values`, so an incomplete/misconfigured rule
// never silently produces a broken URL.
function interpolateTemplate(template, values) {
  let missing = false;
  const result = String(template).replace(/\{(\w+)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      missing = true;
      return "";
    }
    return values[key];
  });
  return missing ? null : result;
}

// Assembles a detail URL from a source's `jsDetailLinkRule` without ever
// executing `rawValue` (no eval/new Function/vm) -- it only regex-matches a
// simple function call or validates a raw data-* attribute value, then
// interpolates the captured pieces into a human-authored `urlTemplate`.
// Returns the built URL string on success, or "" if the rule does not apply
// (matching failure, safety-check failure, or a cross-host result).
function resolveJsDetailLink(rawValue, rule, source) {
  if (!rule || rule.enabled !== true) return "";
  const values = { ...(rule.fixedParams || {}) };
  if (rule.pattern === "functionCall") {
    const parsed = parseSimpleFunctionCall(rawValue);
    if (!parsed || parsed.fnName !== rule.functionName || parsed.args.length !== rule.argCount) return "";
    parsed.args.forEach((value, index) => {
      values[`arg${index}`] = value;
    });
  } else if (rule.pattern === "dataAttribute") {
    if (!ALLOWED_DATA_ATTR_NAMES.has(rule.dataAttribute) || !isSafeRawAttrValue(rawValue)) return "";
    values.arg0 = rawValue;
  } else {
    return "";
  }
  const built = interpolateTemplate(rule.urlTemplate, values);
  if (!built || !sameHost(built, source)) return "";
  return built;
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
  // Pull a wider candidate pool than the final limit: many boards pin
  // "공지" rows at the top regardless of date, so slicing to `limit` here
  // (before dates are even parsed) can silently drop genuinely newer
  // regular articles that happen to sit below the pinned rows.
  const itemHtmlList = findBySelector(html, selectors.item).slice(0, Math.max(limit * 6, 30));
  const items = [];
  const warnings = [];
  for (const itemHtml of itemHtmlList) {
    const listDate = Number.isInteger(selectors.dateIndex) ? indexedValueFrom(itemHtml, selectors.date, selectors.dateIndex) : valueFrom(itemHtml, selectors.date);
    const rawLinkValue = valueFrom(itemHtml, selectors.link, selectors.linkAttribute || (selectors.link === "@href" ? null : "href")) || valueFrom(itemHtml, selectors.link);
    let link;
    if (source.jsDetailLinkRule && source.jsDetailLinkRule.enabled === true) {
      link = resolveJsDetailLink(rawLinkValue, source.jsDetailLinkRule, source);
      if (!link) warnings.push(`jsDetailLinkRule 매칭/검증 실패로 항목 제외: ${rawLinkValue}`);
    } else {
      link = detailLinkFromValue(rawLinkValue);
    }
    const normalized = normalizeCollectedItem({ university, source, rawItem: {
      title: cleanTitle(valueFrom(itemHtml, selectors.title), source.titleCleanupTokens),
      link,
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
  // Rank by actual publish date (most recent first), not by position on the
  // page, so pinned/notice rows don't push real recent news out of the
  // final `limit` cut. Items without a parseable date sort last, keeping
  // their original page order among themselves.
  items.sort((first, second) => {
    const firstDate = first.publishedAt || "";
    const secondDate = second.publishedAt || "";
    if (firstDate && secondDate) return secondDate.localeCompare(firstDate);
    if (firstDate) return -1;
    if (secondDate) return 1;
    return 0;
  });
  return { status: "success", items: items.slice(0, limit), warnings, finalUrl: response.url };
}

module.exports = { htmlListCollector, findBySelector, textOf, attribute, cleanTitle, detailLinkFromValue, resolveJsDetailLink };
