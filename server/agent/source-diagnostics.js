"use strict";

// Standalone 247-university source diagnostic workflow. It never writes the
// operating news source configuration, news store, preview, scheduler, or UI.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_FILE = path.join(ROOT, "development/university-news/data/university-news-sources.final.json");
const UNIVERSITY_FILE = path.join(ROOT, "universities.js");
const DATA_DIR = path.join(__dirname, "data");
const REPORT_ROOT = path.join(__dirname, "reports/source-247");
const STATE_FILE = path.join(DATA_DIR, "source-247-state.json");
const RETRY_STATE_FILE = path.join(DATA_DIR, "source-247-retry-state.json");
const TEST_STATE_FILE = path.join(DATA_DIR, "source-247-test-state.json");
const RETRY_QUEUE_FILE = path.join(DATA_DIR, "source-247-retry-queue.json");
const APPROVAL_QUEUE_FILE = path.join(DATA_DIR, "source-approval-queue.json");
const USER_AGENT = "UNI-PICK-University-Source-Diagnostics/0.1";
const NEWS_KEYWORDS = ["소식", "학교소식", "대학소식", "뉴스", "공지", "공지사항", "보도자료", "언론", "행사", "이벤트", "news", "notice", "notices", "press", "press-release", "announcement", "announcements", "events"];
const SOCIAL_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com", "x.com", "twitter.com", "www.twitter.com"]);
const DATE_PATTERNS = [
  /\b(20\d{2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})\b/,
  /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/
];

function now() { return new Date().toISOString(); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function id() { return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`; }
function slug(value) { return String(value || "unknown").replace(/[^a-z0-9_-]/gi, "_"); }
function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temp, "utf8"));
  fs.renameSync(temp, file);
}
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function escapeMarkdown(value) { return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " "); }
function text(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function normalizeTitle(value) { return text(value).replace(/^\s*(?:\[[^\]]+\]|NEW|중요)\s*/i, "").trim(); }
function safeHttpUrl(value, base) {
  try {
    const url = new URL(String(value || "").trim(), base);
    if (!/^https?:$/.test(url.protocol) || /^javascript:|^mailto:|^tel:/i.test(String(value || ""))) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}
function canonicalUrl(value) {
  const url = safeHttpUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(key => parsed.searchParams.delete(key));
  return parsed.href;
}
function hostOf(value) { try { return new URL(value).hostname.toLowerCase(); } catch { return ""; } }
function sameOfficialDomain(value, universityWebsite) {
  const target = hostOf(value).replace(/^www\./, "");
  const official = hostOf(universityWebsite).replace(/^www\./, "");
  return Boolean(target && official && (target === official || target.endsWith(`.${official}`) || official.endsWith(`.${target}`)));
}
function isSocial(value) { return SOCIAL_HOSTS.has(hostOf(value)); }
function parseDate(value) {
  const raw = text(value);
  for (const pattern of DATE_PATTERNS) {
    const match = raw.match(pattern);
    if (!match) continue;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return { raw, value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
    }
  }
  return { raw, value: null };
}
function metadata(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
  return (html.match(re) || html.match(reverse) || [])[1] || "";
}
function detailFacts(html) {
  const title = normalizeTitle(metadata(html, "og:title") || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || "");
  const candidates = [
    metadata(html, "article:published_time"),
    metadata(html, "datePublished"),
    (html.match(/<time[^>]+datetime=["']([^"']+)["']/i) || [])[1] || "",
    (html.match(/(?:등록일|게시일|작성일|Date)\s*[:：]?\s*([^<\n]{4,40})/i) || [])[1] || ""
  ];
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed.value) return { title, publishedAt: parsed.value, publishedAtRaw: parsed.raw, dateMethod: "detail metadata/time/text" };
  }
  const jsonLd = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLd) {
    try {
      const value = JSON.parse(jsonLd[1]);
      const entries = Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        const parsed = parseDate(entry.datePublished);
        if (parsed.value) return { title: title || normalizeTitle(entry.headline), publishedAt: parsed.value, publishedAtRaw: parsed.raw, dateMethod: "JSON-LD datePublished" };
      }
    } catch { /* invalid structured data is not fatal */ }
  }
  return { title, publishedAt: null, publishedAtRaw: "", dateMethod: null };
}
function extractLinks(html, baseUrl, limit = 10) {
  const links = [];
  const seen = new Set();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) && links.length < limit) {
    const href = (match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    const url = safeHttpUrl(href, baseUrl);
    const label = normalizeTitle(match[2]);
    if (!url || !label || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label });
  }
  return links;
}
function sourceFromExisting(source) {
  return {
    id: source.id || "candidate-existing-source",
    name: source.name || "기존 공식 출처 후보",
    category: source.category || "school_news",
    sourceType: source.sourceType || "official",
    collectionType: source.collectionType || "html",
    listUrl: source.listUrl || source.rssUrl || "",
    rssUrl: source.rssUrl || "",
    baseUrl: source.baseUrl || "",
    selectors: source.selectors || {},
    detailSelectors: source.detailSelectors || {},
    provenance: "existing_configuration"
  };
}
function sourceFromLink(url, label) {
  return {
    id: `candidate-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 12)}`,
    name: label || "공식 소식 후보",
    category: /공지|notice|announcement/i.test(`${url} ${label}`) ? "school_notice" : "school_news",
    sourceType: "official",
    collectionType: /rss|feed|atom/i.test(url) ? "rss" : "html",
    listUrl: url,
    rssUrl: /rss|feed|atom/i.test(url) ? url : "",
    baseUrl: new URL(url).origin,
    selectors: { item: "a", title: "@text", link: "@href", date: "" },
    detailSelectors: { title: "title", date: "time/meta/article text" },
    provenance: "official_homepage_link"
  };
}
async function fetchText(url, { timeoutMs = 15000, attempts = 1 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml" }, redirect: "follow", signal: controller.signal });
      const body = await response.text();
      return { ok: response.ok, status: response.status, url: response.url, body, contentType: response.headers.get("content-type") || "" };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1000);
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error("request failed");
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function robotsAllows(website) {
  const origin = new URL(website).origin;
  try {
    const response = await fetchText(`${origin}/robots.txt`, { timeoutMs: 8000, attempts: 0 });
    if (!response.ok) return { allowed: true, checked: false };
    const blocks = response.body.split(/\r?\n\r?\n/).filter(block => /user-agent:\s*\*/i.test(block));
    const disallowsAll = blocks.some(block => /^disallow:\s*\/\s*$/im.test(block));
    return { allowed: !disallowsAll, checked: true };
  } catch { return { allowed: true, checked: false }; }
}
function loadUniversities() {
  const code = fs.readFileSync(UNIVERSITY_FILE, "utf8").replace("const universities =", "const universities = globalThis.UNIS =");
  const context = { globalThis: {}, console: { log() {} } };
  context.window = context.globalThis;
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.globalThis.UNIS || [];
}
function loadCatalog() {
  const universities = loadUniversities();
  const configured = readJson(SOURCE_FILE, { universities: [] }).universities || [];
  const byId = new Map(configured.map(item => [item.universityId, item]));
  return universities.map(university => {
    const sourceRecord = byId.get(university.id) || {};
    return {
      universityId: university.id,
      universityGroupId: university.universityGroupId || university.id,
      universityName: university.name,
      campusName: university.campusName || university.campusType || "",
      website: university.website || "",
      existingSources: sourceRecord.sources || [],
      existingVerification: sourceRecord.verificationStatus || "pending"
    };
  });
}
function isVerifiedExisting(university) {
  return university.existingSources.some(source => source.verified === true && source.sourceType === "official");
}
function initialState(catalog, mode = "first_pass", stateFile = STATE_FILE) {
  return { runId: id(), startedAt: now(), lastUpdatedAt: now(), total: catalog.length, targetUniversityIds: catalog.map(item => item.universityId), currentIndex: 0, processedUniversityIds: [], successIds: [], reviewIds: [], errorIds: [], skippedIds: [], results: [], lastUniversityId: "", status: "running", mode, stateFile };
}
function saveState(state) { state.lastUpdatedAt = now(); writeJsonAtomic(state.stateFile || STATE_FILE, state); }
function markState(state, result) {
  state.processedUniversityIds.push(result.universityId);
  const durationMs = Math.max(0, new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime());
  state.results.push({ universityId: result.universityId, universityName: result.universityName, status: result.status, reason: result.reason || "", completedAt: result.completedAt, durationMs, candidateCount: result.candidates?.length || 0, detailedVerificationCount: result.detailedVerificationCount || 0 });
  state.lastUniversityId = result.universityId;
  state.currentIndex = state.processedUniversityIds.length;
  const target = result.status === "SUCCESS" ? state.successIds : result.status === "REVIEW" ? state.reviewIds : result.status === "ERROR" ? state.errorIds : state.skippedIds;
  target.push(result.universityId);
  saveState(state);
}
function scoreCandidate({ official, recent, detailCount, dateCount, titleMatches, stable, pagination, social, error }) {
  let score = 0;
  if (official) score += 30;
  if (recent) score += 20;
  if (detailCount) score += 15;
  score += Math.min(dateCount, 1) * 10;
  score += Math.min(titleMatches, 1) * 10;
  score += 5; // HTTPS is checked before candidates reach here.
  if (stable) score += 5;
  if (pagination) score += 5;
  if (social) score -= 20;
  if (!dateCount) score -= 20;
  if (!detailCount) score -= 20;
  if (error) score -= 30;
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  return { score, grade };
}
async function discoverCandidates(university, options) {
  const existing = university.existingSources.map(sourceFromExisting).filter(source => safeHttpUrl(source.listUrl || source.rssUrl));
  if (existing.length) return existing.slice(0, 10);
  if (!safeHttpUrl(university.website)) return [];
  const robots = await robotsAllows(university.website);
  if (!robots.allowed) throw Object.assign(new Error("robots.txt blocks diagnostic requests"), { code: "ROBOTS_BLOCKED" });
  const home = await fetchText(university.website, options);
  if (!home.ok) throw Object.assign(new Error(`official homepage HTTP ${home.status}`), { code: `HTTP_${home.status}`, status: home.status });
  const links = extractLinks(home.body, home.url, 80)
    .filter(link => NEWS_KEYWORDS.some(keyword => `${link.url} ${link.label}`.toLowerCase().includes(keyword.toLowerCase())))
    .filter(link => sameOfficialDomain(link.url, university.website) && !isSocial(link.url));
  return links.slice(0, 10).map(link => sourceFromLink(link.url, link.label));
}
async function diagnoseCandidate(university, candidate, options) {
  const listUrl = candidate.listUrl || candidate.rssUrl;
  const official = sameOfficialDomain(listUrl, university.website);
  if (!official || isSocial(listUrl)) return { candidate, official, error: "candidate is not an official university domain", detailChecks: [] };
  const response = await fetchText(listUrl, options);
  if (!response.ok) return { candidate, official, statusCode: response.status, error: `HTTP ${response.status}`, detailChecks: [] };
  if (/login|로그인/i.test(response.url) || /login|로그인/.test(response.body.slice(0, 5000))) return { candidate, official, statusCode: response.status, error: "login required", detailChecks: [] };
  const links = extractLinks(response.body, response.url, 80)
    .filter(link => sameOfficialDomain(link.url, university.website) && !isSocial(link.url))
    .filter(link => canonicalUrl(link.url) !== canonicalUrl(response.url))
    .filter(link => link.label.length >= 6)
    .slice(0, 3);
  const detailChecks = [];
  for (const link of links) {
    await sleep(1000);
    try {
      const detail = await fetchText(link.url, options);
      if (!detail.ok || !sameOfficialDomain(detail.url, university.website) || /login|로그인/i.test(detail.url)) {
        detailChecks.push({ title: link.label, url: link.url, valid: false, reason: detail.ok ? "invalid detail destination" : `HTTP ${detail.status}` });
        continue;
      }
      const facts = detailFacts(detail.body);
      const titleMatches = Boolean(facts.title && (normalizeTitle(link.label).includes(facts.title) || facts.title.includes(normalizeTitle(link.label))));
      detailChecks.push({ title: link.label, url: detail.url, valid: Boolean(facts.publishedAt && titleMatches), detailTitle: facts.title, titleMatches, publishedAt: facts.publishedAt, publishedAtRaw: facts.publishedAtRaw, dateMethod: facts.dateMethod });
    } catch (error) { detailChecks.push({ title: link.label, url: link.url, valid: false, reason: error.message }); }
  }
  const detailCount = detailChecks.filter(item => item.url).length;
  const dateCount = detailChecks.filter(item => item.publishedAt).length;
  const titleMatches = detailChecks.filter(item => item.titleMatches).length;
  const recent = detailChecks.some(item => item.publishedAt && new Date(item.publishedAt) > new Date(Date.now() - 365 * 86400000));
  const score = scoreCandidate({ official, recent, detailCount, dateCount, titleMatches, stable: links.length >= 2, pagination: /page|pagination|더보기/i.test(response.body), social: false, error: false });
  return { candidate, official, statusCode: response.status, detailChecks, recent, ...score };
}
function chooseResult(university, examined, startedAt) {
  const best = [...examined].sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
  const verifiedCount = best ? best.detailChecks.filter(item => item.valid).length : 0;
  let status = "REVIEW";
  let reason = "No candidate reached automatic approval threshold";
  if (!best) { status = "ERROR"; reason = "No official news candidate found"; }
  else if (best.error) { status = "ERROR"; reason = best.error; }
  else if (verifiedCount >= 1 && best.score >= 75) { status = "SUCCESS"; reason = "Official candidate requires human approval"; }
  else if (best.statusCode === 403 || best.statusCode === 429) { status = "ERROR"; reason = `Access limited: HTTP ${best.statusCode}`; }
  return {
    universityId: university.universityId,
    universityGroupId: university.universityGroupId,
    universityName: university.universityName,
    campusName: university.campusName,
    website: university.website,
    status,
    reason,
    approvalStatus: status === "SUCCESS" ? "pending_review" : null,
    candidate: best ? best.candidate : null,
    candidateScore: best ? best.score : 0,
    candidateGrade: best ? best.grade : "D",
    detailedVerificationCount: verifiedCount,
    candidates: examined,
    startedAt,
    completedAt: now()
  };
}
function universityDir(result) { return path.join(REPORT_ROOT, "universities", slug(result.universityId)); }
function writeUniversityReport(result) {
  const dir = universityDir(result); ensureDir(dir);
  writeJsonAtomic(path.join(dir, "summary.json"), result);
  const lines = ["# UNI PICK 출처 진단", "", `- 대학: ${result.universityName}`, `- universityId: ${result.universityId}`, `- 상태: ${result.status}`, `- 사유: ${result.reason}`, `- 점수: ${result.candidateScore} (${result.candidateGrade})`, `- 상세 검증 성공: ${result.detailedVerificationCount}`, "", "## 후보", "", `- URL: ${result.candidate?.listUrl || "없음"}`, `- 방식: ${result.candidate?.collectionType || "없음"}`];
  fs.writeFileSync(path.join(dir, "summary.md"), `${lines.join("\n")}\n`, "utf8");
  if (result.status === "SUCCESS") {
    writeJsonAtomic(path.join(dir, "proposed-source.json"), { universityId: result.universityId, universityName: result.universityName, approvalStatus: "pending_review", verified: false, enabled: false, score: result.candidateScore, grade: result.candidateGrade, candidate: result.candidate, detailChecks: result.candidates[0]?.detailChecks || [] });
  }
}
function makeBatchReport(state, batch) {
  const rows = state.results.slice(batch.start, batch.end);
  const count = status => rows.filter(row => row.status === status).length;
  const durations = rows.map(row => row.durationMs || 0);
  const longest = [...rows].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))[0] || null;
  const payload = { runId: state.runId, range: `${batch.start + 1}-${batch.end}`, processed: rows.length, success: count("SUCCESS"), review: count("REVIEW"), error: count("ERROR"), skipped: count("SKIPPED"), cumulativeCompleted: state.processedUniversityIds.length, remaining: Math.max(0, state.total - state.processedUniversityIds.length), averageProcessingMs: rows.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / rows.length) : 0, longestUniversity: longest ? { universityId: longest.universityId, universityName: longest.universityName, durationMs: longest.durationMs || 0 } : null, candidateSourceCount: rows.reduce((sum, row) => sum + (row.candidateCount || 0), 0), detailValidationSuccessCount: rows.reduce((sum, row) => sum + (row.detailedVerificationCount || 0), 0), successUniversities: rows.filter(row => row.status === "SUCCESS"), reviewUniversities: rows.filter(row => row.status === "REVIEW"), errorUniversities: rows.filter(row => row.status === "ERROR"), generatedAt: now() };
  const filename = `batch-${String(batch.start + 1).padStart(3, "0")}-${String(batch.end).padStart(3, "0")}`;
  const dir = path.join(REPORT_ROOT, "batches"); ensureDir(dir); writeJsonAtomic(path.join(dir, `${filename}.json`), payload);
  fs.writeFileSync(path.join(dir, `${filename}.md`), `# UNI PICK 247 출처 검증\n\n처리 범위: ${payload.range}\n\n- SUCCESS: ${payload.success}\n- REVIEW: ${payload.review}\n- ERROR: ${payload.error}\n- SKIPPED: ${payload.skipped}\n- 누적 완료: ${payload.cumulativeCompleted}\n- 남음: ${payload.remaining}\n- 평균 처리 시간(ms): ${payload.averageProcessingMs}\n- 가장 오래 걸린 대학: ${payload.longestUniversity?.universityName || "없음"}\n- 후보 출처 수: ${payload.candidateSourceCount}\n- 상세 검증 성공 수: ${payload.detailValidationSuccessCount}\n`, "utf8");
  console.log(`\n[UNI PICK 247 출처 검증]\n\n처리 완료: ${payload.cumulativeCompleted} / ${state.total}\n\nSUCCESS: ${payload.success}\nREVIEW: ${payload.review}\nERROR: ${payload.error}\nSKIPPED: ${payload.skipped}\n`);
}
function writeQueues(state, fullCatalog) {
  const map = new Map(fullCatalog.map(item => [item.universityId, item]));
  const byId = new Map(state.results.map(item => [item.universityId, item]));
  const retry = [...state.errorIds, ...state.reviewIds].map(universityId => ({ universityId, universityName: map.get(universityId)?.universityName || universityId, previous: byId.get(universityId) || null, attempts: 0 }));
  const approvals = state.successIds.map(universityId => { const result = byId.get(universityId); return { universityId, universityName: result?.universityName, candidate: result?.candidate, score: result?.candidateScore, grade: result?.candidateGrade, approvalStatus: "pending_review", verified: false, enabled: false }; });
  writeJsonAtomic(RETRY_QUEUE_FILE, { generatedAt: now(), items: retry });
  writeJsonAtomic(APPROVAL_QUEUE_FILE, { generatedAt: now(), items: approvals });
}
function writeFinalReport(state, catalog) {
  const payload = { generatedAt: now(), total: catalog.length, firstPass: { success: state.successIds.length, review: state.reviewIds.length, error: state.errorIds.length, skipped: state.skippedIds.length }, finalApprovalPending: state.successIds.length, finalError: state.errorIds.map(idValue => state.results.find(item => item.universityId === idValue)) };
  const dir = path.join(REPORT_ROOT, "final"); ensureDir(dir); writeJsonAtomic(path.join(dir, "final-summary.json"), payload);
  fs.writeFileSync(path.join(dir, "final-summary.md"), `# UNI PICK 247 대학 출처 진단 최종 보고서\n\n- 총 대학: ${payload.total}\n- SUCCESS: ${payload.firstPass.success}\n- REVIEW: ${payload.firstPass.review}\n- ERROR: ${payload.firstPass.error}\n- SKIPPED: ${payload.firstPass.skipped}\n- 승인 대기: ${payload.finalApprovalPending}\n`, "utf8");
}
function createDryRun(catalog) {
  const existing = catalog.reduce((count, university) => count + university.existingSources.length, 0);
  const verified = catalog.filter(isVerifiedExisting).length;
  return { dryRun: true, totalUniversities: catalog.length, validUniversityIds: catalog.filter(item => Boolean(item.universityId && item.website)).length, existingSources: existing, existingVerifiedUniversities: verified, expectedBatches: Math.ceil(catalog.length / 10), stateFile: STATE_FILE, reportRoot: REPORT_ROOT, execution: "sequential, one university at a time; no external requests" };
}
async function diagnoseUniversity(university, options) {
  const startedAt = now();
  if (isVerifiedExisting(university)) return { universityId: university.universityId, universityGroupId: university.universityGroupId, universityName: university.universityName, campusName: university.campusName, website: university.website, status: "SKIPPED", reason: "SKIPPED_EXISTING_VERIFIED", approvalStatus: null, candidate: null, candidateScore: 0, candidateGrade: "", detailedVerificationCount: 0, candidates: [], startedAt, completedAt: now() };
  try {
    const candidates = await discoverCandidates(university, options);
    const examined = [];
    for (const candidate of candidates.slice(0, 10)) {
      await sleep(1000);
      try { examined.push(await diagnoseCandidate(university, candidate, options)); }
      catch (error) { examined.push({ candidate, official: sameOfficialDomain(candidate.listUrl || candidate.rssUrl, university.website), error: error.message, detailChecks: [] }); }
    }
    return chooseResult(university, examined, startedAt);
  } catch (error) {
    return { universityId: university.universityId, universityGroupId: university.universityGroupId, universityName: university.universityName, campusName: university.campusName, website: university.website, status: "ERROR", reason: error.message, approvalStatus: null, candidate: null, candidateScore: 0, candidateGrade: "D", detailedVerificationCount: 0, candidates: [], startedAt, completedAt: now() };
  }
}
async function runDiagnostics(options = {}) {
  const catalog = loadCatalog();
  if (options.dryRun) return createDryRun(catalog);
  const activeStateFile = options.retry ? RETRY_STATE_FILE : (options.testOnly || options.universityIds?.length ? TEST_STATE_FILE : STATE_FILE);
  const existingState = options.resume && fs.existsSync(activeStateFile) ? readJson(activeStateFile, null) : null;
  if (options.testOnly && (!existingState || !Array.isArray(existingState.targetUniversityIds) || existingState.targetUniversityIds.length > 10)) {
    throw new Error("Test resume is restricted to an existing checkpoint with at most 10 universities.");
  }
  const retryIds = (readJson(RETRY_QUEUE_FILE, { items: [] }).items || []).map(entry => entry.universityId);
  const selected = options.retry
    ? catalog.filter(item => retryIds.includes(item.universityId))
    : Array.isArray(options.universityIds) && options.universityIds.length
      ? catalog.filter(item => options.universityIds.includes(item.universityId))
    : existingState?.targetUniversityIds
      ? catalog.filter(item => existingState.targetUniversityIds.includes(item.universityId))
      : options.limit ? catalog.slice(0, options.limit) : catalog;
  let state = existingState || initialState(selected, options.retry ? "retry" : "first_pass", activeStateFile);
  const pending = selected.filter(item => !state.processedUniversityIds.includes(item.universityId));
  const max = pending.length;
  let stoppedEarly = false;
  for (let index = 0; index < max; index += 1) {
    const university = pending[index];
    let result;
    if (options.simulateErrorAt && index + 1 === options.simulateErrorAt) {
      result = { universityId: university.universityId, universityGroupId: university.universityGroupId, universityName: university.universityName, campusName: university.campusName, website: university.website, status: "ERROR", reason: "SIMULATED_ERROR", approvalStatus: null, candidate: null, candidateScore: 0, candidateGrade: "D", detailedVerificationCount: 0, candidates: [], startedAt: now(), completedAt: now() };
    } else {
      result = await diagnoseUniversity(university, { timeoutMs: options.retry ? 20000 : 15000, attempts: options.retry ? 2 : 1 });
    }
    writeUniversityReport(result);
    markState(state, result);
    if (state.processedUniversityIds.length % 10 === 0) makeBatchReport(state, { start: state.processedUniversityIds.length - 10, end: state.processedUniversityIds.length });
    if (options.stopAfter && index + 1 >= options.stopAfter && index + 1 < max) { state.status = "paused"; stoppedEarly = true; saveState(state); break; }
  }
  if (!stoppedEarly && state.processedUniversityIds.length >= selected.length) state.status = "completed";
  saveState(state);
  writeQueues(state, catalog);
  if (state.status === "completed" && !options.retry && selected.length === catalog.length) writeFinalReport(state, catalog);
  return state;
}
function statusSummary(stateFile = STATE_FILE) {
  const catalog = loadCatalog();
  const state = readJson(stateFile, null);
  if (!state) return { total: catalog.length, completed: 0, remaining: catalog.length, status: "not_started", recent: [] };
  const runTargetTotal = Array.isArray(state.targetUniversityIds) ? state.targetUniversityIds.length : catalog.length;
  return { total: catalog.length, runTargetTotal, completed: state.processedUniversityIds.length, remaining: Math.max(0, runTargetTotal - state.processedUniversityIds.length), success: state.successIds.length, review: state.reviewIds.length, error: state.errorIds.length, skipped: state.skippedIds.length, lastUniversityId: state.lastUniversityId, status: state.status, recent: state.results.slice(-10) };
}
function getApprovalCandidate(universityId) { return (readJson(APPROVAL_QUEUE_FILE, { items: [] }).items || []).find(item => item.universityId === universityId) || null; }

module.exports = { APPROVAL_QUEUE_FILE, DATA_DIR, REPORT_ROOT, RETRY_QUEUE_FILE, RETRY_STATE_FILE, STATE_FILE, TEST_STATE_FILE, canonicalUrl, createDryRun, detailFacts, getApprovalCandidate, loadCatalog, makeBatchReport, parseDate, runDiagnostics, scoreCandidate, statusSummary };
