"use strict";

// Separate from the live six-university collector. This module never writes a
// source configuration, store, preview, or deployment file.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../../..");
const REPORT_ROOT = path.join(ROOT, "server", "agent", "onboarding", "reports");
const KNOWN_SKKU_CANDIDATES = [
  { url: "https://www.skku.edu/eng/About/media/news.do", category: "school_news", priority: 1, label: "SKKU News" },
  { url: "https://www.skku.edu/skku/campus/skk_comm/notice01.do", category: "school_notice", priority: 4, label: "Official notices" }
];
const SOCIAL = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|twitter\.com|x\.com)$/i;

function plain(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function titleKey(value) { return plain(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function titlesMatch(a, b) { const left = titleKey(a), right = titleKey(b); return Boolean(left && right && (left === right || left.includes(right) || right.includes(left))); }
function toUrl(href, base) { try { const url = new URL(String(href).replace(/&amp;/gi, "&"), base); return /^https?:$/.test(url.protocol) ? url.href.split("#")[0] : null; } catch { return null; } }
function officialDomainsFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host ? [host] : [];
  } catch { return []; }
}
function official(url, domains) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (domains || []).some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
function headersSubset(headers) { return ["content-type", "server", "location", "cache-control"].reduce((out, name) => { const value = headers.get(name); if (value) out[name] = value; return out; }, {}); }
function parseDate(value) { const m = String(value || "").match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/); if (!m) return null; const [, y, mo, d] = m; return Number(mo) <= 12 && Number(d) <= 31 ? `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}` : null; }
function dateFromHtml(html) {
  const sources = [
    ["time", /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i],
    ["article_published_time", /<meta\b[^>]*(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)["']/i],
    ["json_ld", /"datePublished"\s*:\s*"([^"]+)"/i],
    ["metadata", /<meta\b[^>]*(?:property|name)=["'](?:datePublished|publishdate|date)["'][^>]*content=["']([^"']+)["']/i]
  ];
  for (const [method, pattern] of sources) { const match = html.match(pattern); if (match && parseDate(match[1])) return { raw: match[1], publishedAt: parseDate(match[1]), method }; }
  const display = plain(html).match(/20\d{2}\s*(?:[.\-/]|\D)\s*\d{1,2}\s*(?:[.\-/]|\D)\s*\d{1,2}/);
  return display && parseDate(display[0]) ? { raw: display[0], publishedAt: parseDate(display[0]), method: "visible_text" } : { raw: null, publishedAt: null, method: null };
}
function anchors(html, base) {
  const all = []; const matcher = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let match;
  while ((match = matcher.exec(html))) { const href = (match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i) || [])[2]; const url = href && toUrl(href, base); const label = plain(match[2]); if (url && label && label.length >= 2) all.push({ url, label }); }
  return all;
}
function isDetail(url, listUrl, domains) {
  try { const value = new URL(url); const joined = `${value.pathname}${value.search}`.toLowerCase(); const list = new URL(listUrl); if (value.href === list.href || !official(value.href, domains) || SOCIAL.test(value.hostname) || /login|sitemap|search/.test(joined)) return false; const sameBoard = value.pathname === list.pathname && /(?:article(?:no|\.no|_no)=|mode=view|seq=|idx=|no=)/i.test(value.search) && !/mode=list/i.test(value.search); const routedDetail = /\/article\/|\/view|\/detail|board.*(?:view|read)/i.test(value.pathname); return sameBoard || routedDetail; } catch { return false; }
}
function pageTitle(html) { for (const pattern of [/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i, /<h3\b[^>]*>([\s\S]*?)<\/h3>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]) { const m = html.match(pattern); if (m && plain(m[1])) return plain(m[1]); } return ""; }
function selectors(listUrl, articles) {
  const pathname = new URL(listUrl).pathname;
  const stable = articles.filter(article => article.decision === "PASS").length >= 2;
  const boardSelector = pathname.includes("notice01.do") ? "a[href*='notice01.do?mode=view'][href*='articleNo=']" : null;
  return { listItem: stable ? boardSelector : null, title: stable ? boardSelector : null, link: stable ? boardSelector : null, date: null, detailTitle: stable ? "title" : null, detailDate: null, selectorStable: stable };
}
function atomic(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function writeReports(result) {
  const dir = path.join(REPORT_ROOT, result.universityId);
  const proposal = { universityId: result.universityId, universityName: result.universityName, candidate: result.recommendedCandidate, score: result.score, grade: result.grade, decision: result.decision, approvalStatus: "pending_review", verified: false, enabled: false };
  atomic(path.join(dir, "summary.json"), result); atomic(path.join(dir, "proposed-source.json"), proposal);
  fs.writeFileSync(path.join(dir, "summary.md"), `# SKKU onboarding diagnostic\n\n- Decision: **${result.decision}**\n- Score: ${result.score} (${result.grade})\n- Requests: ${result.externalRequests}\n- Homepage result: ${result.homepageRequest.status}\n- Recommended URL: ${result.recommendedCandidate ? result.recommendedCandidate.url : "none"}\n- Articles: PASS ${result.passCount}, WARN ${result.warnCount}, FAIL ${result.failCount}\n\nNo live source setting was changed.\n`, "utf8");
}

async function diagnoseUniversitySource({ universityId, universityName, officialUrl, knownCandidateUrls }) {
  knownCandidateUrls = knownCandidateUrls || (universityId === "skku-university-insa" ? KNOWN_SKKU_CANDIDATES : []);
  let externalRequests = 0;
  async function request(requestedUrl) {
    let last; for (let attempt = 0; attempt < 2; attempt += 1) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000); try { externalRequests += 1; const response = await fetch(requestedUrl, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 compatible UNI-PICK source validator", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", "Cache-Control": "no-cache" } }); const body = await response.text(); return { requestedUrl, finalUrl: response.url, status: response.status, statusText: response.statusText, redirected: response.redirected, responseHeaders: headersSubset(response.headers), contentType: response.headers.get("content-type") || "", bodyLength: body.length, body }; } catch (error) { last = error; if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1000)); } finally { clearTimeout(timer); } } throw last; }
  const homepage = officialUrl || "";
  const officialDomains = officialDomainsFor(homepage);
  const result = { action: "diagnose", universityId, universityName, dryRun: false, officialHomepage: homepage, officialDomains, existingCandidate: { sourceId: universityId === "skku-university-insa" ? "skku-official-news" : `${universityId}-official-news`, url: homepage, urlType: "HOME" }, existingCandidateValid: false, existingCandidateReason: "homepage_not_news_list", homepageRequest: null, candidateDiagnostics: [], discoveredCandidateCount: 0, candidates: [], recommendedCandidate: null, testedArticles: [], uniqueDetailUrls: 0, passCount: 0, warnCount: 0, failCount: 0, selectors: null, selectorStable: false, score: 0, grade: "D", decision: "ERROR", errors: [], externalRequests: 0 };
  try { const home = await request(homepage); result.homepageRequest = { ...home }; delete result.homepageRequest.body; if (!home.status || home.status >= 400) result.errors.push(`Homepage returned HTTP ${home.status}; continuing with known official candidates.`); if (!knownCandidateUrls.length && home.status === 200) { knownCandidateUrls = [...new Map(anchors(home.body, home.finalUrl).filter(link => official(link.url, officialDomains) && /news|notice|press|media|board|announcement/i.test(link.url)).map(link => [link.url, link])).values()].slice(0, 10).map((link, index) => ({ url: link.url, label: link.label, category: /notice|board/i.test(link.url) ? "school_notice" : "school_news", priority: index + 1 })); } } catch (error) { result.homepageRequest = { requestedUrl: homepage, error: error.message }; result.errors.push(`Homepage request failed: ${error.message}`); }
  for (const candidate of knownCandidateUrls.slice(0, 10)) {
    const entry = { url: candidate.url, label: candidate.label, category: candidate.category, priority: candidate.priority, type: "LIST", officialDomain: official(candidate.url, officialDomains), status: null, listConfidence: "LOW", detailLinks: [], testedArticles: [], score: 0 };
    try {
      const list = await request(candidate.url); entry.request = { ...list }; delete entry.request.body; entry.status = list.status;
      if (list.status !== 200 || !/^text\/html/i.test(list.contentType) || !entry.officialDomain) { entry.reason = "not_an_accessible_official_html_list"; result.candidateDiagnostics.push(entry); continue; }
      const listAnchors = anchors(list.body, list.finalUrl); const details = [...new Map(listAnchors.filter(link => isDetail(link.url, list.finalUrl, officialDomains)).map(link => [link.url, link])).values()]; const listDate = dateFromHtml(list.body);
      entry.detailLinks = details.slice(0, 3); entry.uniqueDetailUrls = details.length; entry.dateCandidate = listDate; entry.listConfidence = details.length >= 2 && Boolean(listDate.publishedAt) ? "HIGH" : details.length >= 2 ? "MEDIUM" : "LOW";
      for (const link of entry.detailLinks) {
        const article = { listTitle: link.label, listUrl: list.finalUrl, detailUrl: link.url, officialDomain: official(link.url, officialDomains), urlType: "DETAIL", decision: "FAIL", reasons: [] };
        try { const detail = await request(link.url); const detailTitle = pageTitle(detail.body); const date = dateFromHtml(detail.body); article.detailUrl = detail.finalUrl; article.officialDomain = official(detail.finalUrl, officialDomains); article.detailTitle = detailTitle; article.publishedAt = date.publishedAt; article.dateRaw = date.raw; article.dateMethod = date.method; article.articleTextLength = plain(detail.body).length; article.titleMatch = titlesMatch(link.label, detailTitle); article.dateValidated = Boolean(date.publishedAt); if (detail.status !== 200) article.reasons.push(`HTTP_${detail.status}`); if (!article.officialDomain || !isDetail(article.detailUrl, list.finalUrl, officialDomains)) article.reasons.push("not_official_detail_url"); if (!article.titleMatch) article.reasons.push("title_mismatch"); if (!article.dateValidated) article.reasons.push("missing_actual_date"); if (article.articleTextLength < 100) article.reasons.push("missing_article_body"); article.decision = article.reasons.length === 0 ? "PASS" : (detailTitle && official(article.detailUrl, officialDomains) ? "WARN" : "FAIL"); } catch (error) { article.reasons.push(error.message); }
        entry.testedArticles.push(article);
      }
      entry.passCount = entry.testedArticles.filter(article => article.decision === "PASS").length; entry.warnCount = entry.testedArticles.filter(article => article.decision === "WARN").length; entry.failCount = entry.testedArticles.filter(article => article.decision === "FAIL").length; entry.selectors = selectors(list.finalUrl, entry.testedArticles); entry.selectorStable = entry.selectors.selectorStable; entry.score = (entry.officialDomain ? 30 : 0) + 5 + (entry.listConfidence === "HIGH" ? 20 : entry.listConfidence === "MEDIUM" ? 10 : 0) + Math.min(15, entry.passCount * 5) + (entry.selectorStable ? 10 : 0) + (entry.passCount >= 2 ? 15 : 0) + (entry.category === "school_news" ? 5 : 0);
    } catch (error) { entry.reason = error.message; }
    result.candidateDiagnostics.push(entry);
  }
  result.discoveredCandidateCount = result.candidateDiagnostics.length; result.candidates = result.candidateDiagnostics;
  const recommended = [...result.candidateDiagnostics].sort((a, b) => b.score - a.score || a.priority - b.priority)[0];
  if (recommended) { result.recommendedCandidate = { url: recommended.url, type: "LIST", category: recommended.category, listConfidence: recommended.listConfidence, selectors: recommended.selectors || null }; result.testedArticles = recommended.testedArticles || []; result.uniqueDetailUrls = recommended.uniqueDetailUrls || 0; result.passCount = recommended.passCount || 0; result.warnCount = recommended.warnCount || 0; result.failCount = recommended.failCount || 0; result.selectors = recommended.selectors || null; result.selectorStable = Boolean(recommended.selectorStable); result.score = recommended.score || 0; }
  result.grade = result.score >= 90 ? "A" : result.score >= 75 ? "B" : result.score >= 60 ? "C" : "D";
  result.decision = result.recommendedCandidate && result.recommendedCandidate.listConfidence === "HIGH" && result.uniqueDetailUrls >= 2 && result.passCount >= 2 && result.selectorStable && result.score >= 75 ? "SUCCESS" : result.recommendedCandidate ? "REVIEW" : "ERROR";
  result.externalRequests = externalRequests; writeReports(result); return result;
}

module.exports = { diagnoseUniversitySource };
