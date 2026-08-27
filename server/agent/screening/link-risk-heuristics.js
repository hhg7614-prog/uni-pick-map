"use strict";

// Pure, lightweight heuristics over an HTML string (or its absence). No
// network access -- the caller fetches the page and passes the body text in.
// These are probabilistic signals meant to help a human decide whether a
// selector_required source is worth attempting, not a definitive judgement.

const ANCHOR_TAG = /<a\b([^>]*)>/gi;
const HREF_ATTR = /\bhref\s*=\s*["']([^"']*)["']/i;
const JS_ONLY_HREF = /^\s*javascript\s*:/i;
// Anchors that carry no real navigation target of their own via href, beyond
// the `javascript:` prefix case: an exact (not prefix) match on `#` or
// `#none` (Dankook University `_dku_bbs_web_BbsPortlet_viewMessage(id)`
// pattern). Deliberately exact-match only -- a normal in-page anchor like
// `href="#section"` must NOT be treated as non-navigating.
const NON_NAVIGATING_HASH_HREFS = new Set(["#", "#none"]);
function isNonNavigatingHref(href) {
  const value = String(href || "").trim();
  return JS_ONLY_HREF.test(value) || NON_NAVIGATING_HASH_HREFS.has(value.toLowerCase());
}
const DATA_URL_ATTR = /\bdata-url\s*=/i;
const DATA_PARAM_ATTR = /\bdata-(?:param|nm|no|seq|idx)\s*=/i;
// The specific data-* attribute names that can carry the real navigation
// target/identity in this pattern (Seoul National University of Education /
// Gyeongsang National University style). Used to compare *values*, not raw
// attribute text, when deciding whether two anchors point at different
// targets.
const DATA_ID_ATTR_NAMES = ["data-url", "data-param", "data-nm", "data-no", "data-seq", "data-idx"];
// Branches on the quoting style (like html-list-collector.js's own
// attribute() helper) instead of excluding both quote characters -- values
// here almost always contain internal single-quoted JS string literals
// (e.g. `pf_DetailMove('216600')`), which a naive `[^"']*` capture would
// truncate at the first internal quote.
function attrValue(attrs, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = String(attrs || "").match(pattern);
  if (!match) return null;
  return match[1] !== undefined ? match[1] : match[2];
}
function dataAttrIdentityKey(attrs) {
  return DATA_ID_ATTR_NAMES.map((name) => attrValue(attrs, name) || "").join("|");
}
const ONCLICK_ATTR = /\bonclick\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
// A single "functionName(args...)" call, trailing whitespace/`;` allowed
// (e.g. `pf_DetailMove('216600')` or `pf_DetailMove('216600');`). Rejects
// anything with nested parens/multiple statements -- this is a lightweight
// heuristic, not a JS parser.
const SIMPLE_FN_CALL_ONCLICK = /^([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*;?\s*$/;
// Each argument must be a bare number, a quoted token made only of ASCII
// word chars/hyphens, or a bare `true`/`false` literal -- real ID/key values
// and their accompanying boolean flags look like this (Dankook University
// `_dku_bbs_web_BbsPortlet_viewMessage(181003, true, false)` pattern). A
// quoted argument containing spaces, punctuation, or non-ASCII (Korean UI
// text such as an alert/confirm message) does NOT match, so a plain click
// handler like `alert('정말 삭제하시겠습니까?')` is not mistaken for an
// ID-based detail-navigation call.
const SIMPLE_ID_ARG = /^(?:\d+|['"][\w-]+['"]|true|false)$/;

/**
 * Parse an `onclick="functionName(id[, ...])"` call that looks like an
 * ID-based detail-navigation handler (Jeonbuk National University
 * `pf_DetailMove('216600')` pattern), as opposed to a generic UI click
 * handler (`toggleMenu()`, `alert('...')` with a human-readable message).
 *
 * @param {string} attrs raw attribute text of an `<a ...>` opening tag
 * @returns {{ fnName: string, argsKey: string } | null}
 */
function parseIdLikeOnclickCall(attrs) {
  const match = String(attrs || "").match(ONCLICK_ATTR);
  if (!match) return null;
  const onclickValue = match[1] !== undefined ? match[1] : match[2];
  const callMatch = onclickValue.trim().match(SIMPLE_FN_CALL_ONCLICK);
  if (!callMatch) return null;
  const rawArgs = callMatch[2].trim();
  if (!rawArgs) return null; // a zero-argument call is a generic UI toggle, not ID-based navigation
  const args = rawArgs.split(",").map((arg) => arg.trim());
  if (!args.every((arg) => SIMPLE_ID_ARG.test(arg))) return null;
  return { fnName: callMatch[1], argsKey: args.join(",") };
}

function collectAnchors(html) {
  const anchors = [];
  let match;
  ANCHOR_TAG.lastIndex = 0;
  while ((match = ANCHOR_TAG.exec(html))) {
    const attrs = match[1] || "";
    const hrefMatch = attrs.match(HREF_ATTR);
    anchors.push({ attrs, href: hrefMatch ? hrefMatch[1] : null });
  }
  return anchors;
}

/**
 * Detect a "javascript:-only link" risk pattern: anchors rely on
 * `href="javascript:..."` (or an exact `href="#"`/`href="#none"`, the
 * Dankook University `_dku_bbs_web_BbsPortlet_viewMessage(id)` pattern) to
 * carry no real navigation target of their own, instead relying on either
 * (a) `data-url`/`data-param`-style attributes
 * (Seoul National University of Education / Gyeongsang National University
 * pattern), or (b) an `onclick="functionName(id)"` call that looks like an
 * ID-based detail-navigation handler (Jeonbuk National University
 * `pf_DetailMove('216600')` pattern). Either makes plain CSS-selector-based
 * link extraction unreliable.
 *
 * A page's header/footer can carry far more ordinary static-href links than
 * a board ever will, which would otherwise dilute a simple "risky count vs
 * static count" comparison into never firing (the real jbnu-official-news
 * page has 642 static nav hrefs against 12 onclick-based list items). To
 * catch that, `detected` also fires whenever the SAME kind of javascript:-only
 * link repeats with DIFFERENT targets at least twice, regardless of how many
 * unrelated static links exist elsewhere on the page:
 *  - onclick: the same function name called with at least two distinct
 *    argument combinations (e.g. `pf_DetailMove('216600')` and
 *    `pf_DetailMove('216557')`).
 *  - data attrs: at least two anchors whose data-url/data-param/data-nm/
 *    data-no/data-seq/data-idx *values* (not raw attribute text) differ.
 * A single occurrence, or the same call repeated with the IDENTICAL
 * argument/values every time (e.g. a login shortcut duplicated in a
 * desktop + mobile nav, `cf_login('currentPage')` twice), never counts as
 * "different targets" and so never triggers this repetition signal on its
 * own -- avoiding an over-eager HOLD for one UI button.
 *
 * @param {string} html
 * @returns {{ detected: boolean, jsOnlyCount: number, staticHrefCount: number, dataAttrMatchCount: number, onclickIdCallMatchCount: number, dataAttrRepeated: boolean, onclickIdCallRepeated: boolean, sampleAttrs: string[] }}
 */
function detectJsOnlyLinkRisk(html) {
  const anchors = collectAnchors(String(html || ""));
  const jsOnlyAnchors = anchors.filter((anchor) => anchor.href && isNonNavigatingHref(anchor.href));
  const staticHrefAnchors = anchors.filter((anchor) => anchor.href && !isNonNavigatingHref(anchor.href) && anchor.href.trim());
  const jsOnlyWithDataAttrs = jsOnlyAnchors.filter(
    (anchor) => DATA_URL_ATTR.test(anchor.attrs) || DATA_PARAM_ATTR.test(anchor.attrs)
  );
  const jsOnlyWithIdCallOnclick = jsOnlyAnchors.filter(
    (anchor) => !DATA_URL_ATTR.test(anchor.attrs) && !DATA_PARAM_ATTR.test(anchor.attrs) && parseIdLikeOnclickCall(anchor.attrs) !== null
  );
  const riskyJsOnlyAnchors = [...jsOnlyWithDataAttrs, ...jsOnlyWithIdCallOnclick];

  const dataAttrDistinctTargets = new Set(jsOnlyWithDataAttrs.map((anchor) => dataAttrIdentityKey(anchor.attrs)));
  const dataAttrRepeated = jsOnlyWithDataAttrs.length >= 2 && dataAttrDistinctTargets.size >= 2;

  const onclickArgsByFunction = new Map();
  for (const anchor of jsOnlyWithIdCallOnclick) {
    const parsed = parseIdLikeOnclickCall(anchor.attrs);
    if (!parsed) continue;
    const fnKey = parsed.fnName.toLowerCase();
    if (!onclickArgsByFunction.has(fnKey)) onclickArgsByFunction.set(fnKey, new Set());
    onclickArgsByFunction.get(fnKey).add(parsed.argsKey);
  }
  const onclickIdCallRepeated = [...onclickArgsByFunction.values()].some((argsSet) => argsSet.size >= 2);

  const dominant = riskyJsOnlyAnchors.length > 0 && riskyJsOnlyAnchors.length >= staticHrefAnchors.length;
  const detected = dominant || dataAttrRepeated || onclickIdCallRepeated;

  return {
    detected,
    jsOnlyCount: jsOnlyAnchors.length,
    staticHrefCount: staticHrefAnchors.length,
    dataAttrMatchCount: jsOnlyWithDataAttrs.length,
    onclickIdCallMatchCount: jsOnlyWithIdCallOnclick.length,
    dataAttrRepeated,
    onclickIdCallRepeated,
    sampleAttrs: riskyJsOnlyAnchors.slice(0, 3).map((anchor) => anchor.attrs.trim()),
  };
}

const SPA_ROOT_MARKERS = [
  /id\s*=\s*["']app["']/i,
  /id\s*=\s*["']root["']/i,
  /id\s*=\s*["']__next["']/i,
  /data-reactroot/i,
  /ng-app/i,
  /v-app/i,
];
const SCRIPT_BUNDLE_MARKER = /<script[^>]+src=["'][^"']*(?:bundle|chunk|main\.[a-z0-9]+|app\.[a-z0-9]+)\.js["']/i;

/**
 * Detect an SPA-style page: almost no server-rendered list-item signal
 * (few/no anchors with real hrefs) combined with an empty-looking app root
 * and heavy reliance on bundled script files.
 *
 * @param {string} html
 * @returns {{ detected: boolean, hasSpaRootMarker: boolean, hasScriptBundleMarker: boolean, staticAnchorCount: number }}
 */
function detectSpaRisk(html) {
  const text = String(html || "");
  const anchors = collectAnchors(text);
  const staticAnchorCount = anchors.filter((anchor) => anchor.href && !JS_ONLY_HREF.test(anchor.href) && anchor.href.trim() && anchor.href.trim() !== "#").length;
  const hasSpaRootMarker = SPA_ROOT_MARKERS.some((pattern) => pattern.test(text));
  const hasScriptBundleMarker = SCRIPT_BUNDLE_MARKER.test(text);
  const detected = hasSpaRootMarker && hasScriptBundleMarker && staticAnchorCount === 0;
  return { detected, hasSpaRootMarker, hasScriptBundleMarker, staticAnchorCount };
}

const HANGUL_PATTERN = /[가-힣]/;
const NON_KOREAN_QUERY_HINTS = [/[?&](?:site_dvs_cd|lang|locale)=en\b/i, /\/en\//i, /\/eng\//i];

/**
 * Flag a listUrl/HTML pair as likely a non-Korean (e.g. English) board.
 * This is a warning-only signal, not a technical block (Chungnam National
 * University `site_dvs_cd=en` case).
 *
 * @param {{ listUrl?: string, html?: string }} input
 * @returns {{ detected: boolean, reason: string }}
 */
function detectNonKoreanBoardFlag({ listUrl = "", html = "" } = {}) {
  const queryHint = NON_KOREAN_QUERY_HINTS.some((pattern) => pattern.test(listUrl));
  if (queryHint) {
    return { detected: true, reason: `listUrl indicates a non-Korean board variant: ${listUrl}` };
  }
  const bodyText = String(html || "");
  if (bodyText.trim() && !HANGUL_PATTERN.test(bodyText)) {
    return { detected: true, reason: "no Hangul characters found in the fetched HTML body" };
  }
  return { detected: false, reason: "" };
}

/**
 * Rough static-HTML-likelihood score: higher when the page has multiple
 * anchors with real (non javascript:) hrefs, lower otherwise. Purely a
 * supporting signal alongside the more specific detectors above.
 *
 * @param {string} html
 * @returns {{ score: number, staticAnchorCount: number }}
 */
function scoreStaticHtmlLikelihood(html) {
  const anchors = collectAnchors(String(html || ""));
  const staticAnchorCount = anchors.filter((anchor) => anchor.href && !JS_ONLY_HREF.test(anchor.href) && anchor.href.trim() && anchor.href.trim() !== "#").length;
  const score = Math.max(0, Math.min(1, staticAnchorCount / 10));
  return { score, staticAnchorCount };
}

module.exports = { detectJsOnlyLinkRisk, detectSpaRisk, detectNonKoreanBoardFlag, scoreStaticHtmlLikelihood };
