"use strict";

// Read-only title-validation diagnostic for Daegu National University of Education.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const LIST_URL = "http://www.dnue.ac.kr/kor/CMS/Board/Board.do?mCode=MN168";
const REPORT = path.join(ROOT, "server/agent/onboarding/reports/university-feed-agent-v1/dnue-title-validation.json");
const HEADERS = { "User-Agent": "Mozilla/5.0 compatible UNI-PICK title validator", Accept: "text/html,application/xhtml+xml", "Accept-Language": "ko-KR,ko;q=0.9" };
const DATE = /20\d{2}[^\d]{0,4}\d{1,2}[^\d]{0,4}\d{1,2}/;

function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&amp;/gi, " ").replace(/\s+/g, " ").trim(); }
function normalize(value) { return clean(value).normalize("NFC").replace(/^(?:new|\uc0c8\uae00)\s*/i, "").replace(/[\[\(](?:new|\uc0c8\uae00|\uc911\uc694)[\]\)]/gi, "").replace(/\s*(?:[-|]\s*)?(?:\ub300\uad6c\uad50\uc721\ub300\ud559\uad50|\uacf5\uc9c0\uc0ac\ud56d)\s*$/i, "").replace(/\u2026|\.\.\.$/g, "").replace(/\s+/g, " ").trim(); }
function iso(raw) { const m = String(raw || "").match(/(20\d{2})[^\d]{0,4}(\d{1,2})[^\d]{0,4}(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null; }
function tokens(value) { return new Set((normalize(value).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])); }
function compare(listTitle, detailTitle) { const a = normalize(listTitle), b = normalize(detailTitle), exact = !!a && a === b, contains = !!a && !!b && (a.includes(b) || b.includes(a)); const left = tokens(a), right = tokens(b), hit = [...left].filter(x => right.has(x)).length, overlap = left.size && right.size ? hit / Math.min(left.size, right.size) : 0; const similarity = exact ? 1 : contains ? Math.max(.8, overlap) : overlap; return { listTitleNormalized: a, detailTitleNormalized: b, exact, containsMatch: contains, tokenOverlap: overlap, similarityScore: similarity, matchType: exact ? "normalized_exact" : contains ? "contains" : overlap >= .7 ? "token_overlap" : "none", titleMatch: exact || contains || overlap >= .7 }; }
function rows(html, base) { const items = []; for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) { const raw = row[0], dateRaw = raw.match(DATE)?.[0] || null; for (const link of raw.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { if (!/mode=view|board_seq=/i.test(link[1])) continue; const listTitle = clean(link[2]); if (listTitle.length < 8) continue; items.push({ listTitle, listUrl: new URL(link[1], base).href, listDate: iso(dateRaw), listDateRaw: dateRaw }); } } return [...new Map(items.map(item => [item.listUrl, item])).values()].slice(0, 5); }
function candidateValues(html, selector, pattern) { return [...html.matchAll(pattern)].map(match => ({ selector, raw: clean(match[1]) })).filter(item => item.raw); }
function detailTitle(html, listTitle) {
  const candidates = [
    ...candidateValues(html, "h1", /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
    ...candidateValues(html, "h2", /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi),
    ...candidateValues(html, "h3", /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi),
    ...candidateValues(html, ".board-title", /<[^>]+class=["'][^"']*board-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi),
    ...candidateValues(html, ".view-title", /<[^>]+class=["'][^"']*view-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi),
    ...candidateValues(html, ".title-area", /<[^>]+class=["'][^"']*title-area[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi),
    ...candidateValues(html, ".subject", /<[^>]+class=["'][^"']*subject[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi),
    ...candidateValues(html, "[class*=title]", /<[^>]+class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)
  ];
  const banned = /^(?:\ub300\uad6c\uad50\uc721\ub300\ud559\uad50|\uacf5\uc9c0\uc0ac\ud56d|home)$/i;
  return candidates.map(candidate => ({ ...candidate, comparison: compare(listTitle, candidate.raw), score: (candidate.selector === "h1" ? 30 : candidate.selector === "h2" || candidate.selector === "h3" ? 25 : 20) + (compare(listTitle, candidate.raw).similarityScore * 40) - (banned.test(normalize(candidate.raw)) ? 80 : 0) })).filter(candidate => !banned.test(normalize(candidate.raw))).sort((a, b) => b.score - a.score)[0] || { selector: null, raw: null, comparison: compare(listTitle, ""), score: 0 };
}
function detailDate(html) { const labeled = html.match(/(?:\uc791\uc131\uc77c|\ub4f1\ub85d\uc77c|\uac8c\uc2dc\uc77c)[^<]{0,120}(20\d{2}[^\d]{0,4}\d{1,2}[^\d]{0,4}\d{1,2})/i); return labeled ? iso(labeled[1]) : null; }
async function main() {
  const listResponse = await fetch(LIST_URL, { headers: HEADERS, redirect: "follow" }); const listHtml = await listResponse.text(); const samples = rows(listHtml, listResponse.url).slice(0, 3); const articles = [];
  for (const sample of samples) { const response = await fetch(sample.listUrl, { headers: HEADERS, redirect: "follow" }); const html = await response.text(); const chosen = detailTitle(html, sample.listTitle), date = detailDate(html), evidence = { writtenDate: /\uc791\uc131\uc77c|\ub4f1\ub85d\uc77c|\uac8c\uc2dc\uc77c/.test(html), views: /\uc870\ud68c\uc218/.test(html), attachments: /\ucca8\ubd80\ud30c\uc77c/.test(html), body: /board-view|\ubcf8\ubb38|contents/i.test(html) }; const dateConflict = !!sample.listDate && !!date && sample.listDate !== date; articles.push({ ...sample, detailUrl: response.url, responseStatus: response.status, detailTitleRaw: chosen.raw, detailTitleNormalized: normalize(chosen.raw), detailDate: date, titleSelectorUsed: chosen.selector, articleViewEvidence: evidence, dateStatus: dateConflict ? "DATE_CONFLICT" : sample.listDate && date ? "DATE_OK" : "DATE_PROVENANCE_INCOMPLETE", ...chosen.comparison }); }
  const titleMatchCount = articles.filter(item => item.titleMatch).length, publishedAtNull = articles.filter(item => !(item.listDate || item.detailDate)).length, dateConflicts = articles.filter(item => item.dateStatus === "DATE_CONFLICT").length;
  const ready = titleMatchCount >= 2 && publishedAtNull === 0 && dateConflicts === 0;
  const failureReasons = [...new Set(articles.flatMap(item => !item.detailTitleRaw ? ["DETAIL_TITLE_MISSING"] : !item.titleMatch ? ["DETAIL_TITLE_SELECTOR_WRONG", "TITLE_MISMATCH"] : item.dateStatus === "DATE_CONFLICT" ? ["DATE_CONFLICT"] : []))];
  const report = { universityId: "daegu-national-university-of-education-\u1107\u1169\u11ab\u1100\u116d", universityName: "\ub300\uad6c\uad50\uc721\ub300\ud559\uad50", listUrl: LIST_URL, samples: articles, sampleCount: articles.length, exactMatches: articles.filter(item => item.matchType === "normalized_exact").length, containsMatches: articles.filter(item => item.matchType === "contains").length, similarityMatches: articles.filter(item => item.matchType === "token_overlap").length, titleMatchCount, titleMatchRatio: articles.length ? titleMatchCount / articles.length : 0, publishedAtNull, dateConflictCount: dateConflicts, failureReasons, titleValidationReady: ready, mutation: { queue: false, retryQueue: false, source: false, store: false, preview: false, verified: false, collector: false, git: false, render: false } }; fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
