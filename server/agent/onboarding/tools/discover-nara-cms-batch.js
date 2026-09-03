"use strict";

/**
 * discover-nara-cms-batch -- Nara Info CMS 를 쓰는 대학의 뉴스/공지 게시판 RSS
 * 소스를 자동으로 발견·검증하고, **활성화 없이** 게이트 패킷(B1 카탈로그
 * enabled:false 삽입 + B2 review-packet)까지 생성하는 배치 도구.
 *
 * 인천대(커밋 7531f6e)로 수동 완주한 흐름을 배치화한 것이며, 확정된 Nara Info
 * CMS 레시피와 이미 반영된 rss-collector.js 의 `.do` 링크 정규화(커밋 482f3f1)를
 * 그대로 재사용한다.
 *
 * 산출물은 다음으로만 국한된다:
 *   - collector-config-candidates.json 후보 append
 *   - B1(prepare-catalog-source-block) 을 통한 카탈로그 enabled:false 삽입
 *   - B2(build-review-packet-from-diagnose) 를 통한 review-packet 생성
 * enabled:true 전환 / store / preview / git / 배포는 하지 않는다.
 *
 * 순수 헬퍼는 전부 module.exports 되며, 시간/난수/네트워크/파일시스템은
 * 주입 가능하다(테스트는 완전 오프라인).
 */

const fs = require("fs");
const path = require("path");

const { rssCollector } = require("../../../../development/university-news/collectors/rss-collector");
const {
  extractDetail,
  titleMatches,
  universityNameMatches,
} = require("../../tools/run-single-school-trial");
const { parseRobotsGroups } = require("../../screening/robots-group-parser");
const { classifyRobotsFetchResult } = require("../../tools/screen-selector-required-sources");
const { prepareCatalogSourceBlock } = require("./prepare-catalog-source-block");
const {
  buildReviewPacketFromDiagnose,
  collectRegressionEvidence,
} = require("./build-review-packet-from-diagnose");

const ROOT = path.resolve(__dirname, "../../../..");
const DEFAULT_AUDIT_FILE = path.join(ROOT, ".pipeline", "onboarding-phase1-audit-detail.json");
const DEFAULT_CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);
const DEFAULT_CANDIDATE_FILE = path.join(__dirname, "..", "data", "collector-config-candidates.json");
const DEFAULT_STATE_FILE = path.join(__dirname, "..", "data", "nara-cms-batch-state.json");
const DEFAULT_REPORT_DIR = path.join(__dirname, "..", "reports", "nara-cms-batch");

const USER_AGENT = "UNI-PICK-Nara-CMS-Batch-Discovery/0.1 (read-only)";

// -- constants ---------------------------------------------------------------

const NEWS_NAV_KEYWORDS = [
  "소식",
  "뉴스",
  "보도",
  "보도자료",
  "알림",
  "공지",
  "공지사항",
  "새소식",
  "대학소식",
  "언론",
];

const DATE_SELECTOR_FALLBACKS = ["dl.write dd", "dl.date dd", "ul.board-etc li", ".artclInfo .date"];

// sitemap/nav 게시판 후보 상한(대학당 요청 예산 계산의 기준값, §E 참고).
const MAX_BOARD_CANDIDATES = 4;

// -- small url helpers ------------------------------------------------------

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return String(href || "");
  }
}

function compactStamp(dateLike) {
  const dt = dateLike instanceof Date ? dateLike : new Date(dateLike || Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}` +
    `T${p(dt.getHours())}${p(dt.getMinutes())}${p(dt.getSeconds())}`
  );
}

function catalogSourceIds(catalog) {
  const ids = [];
  for (const university of (catalog && catalog.universities) || []) {
    for (const source of university.sources || []) if (source && source.id) ids.push(source.id);
  }
  return ids;
}

// -- 1. parseCliArgs --------------------------------------------------------

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const read = (name) => {
    const hit = args.find((value) => value === name || value.startsWith(`${name}=`));
    if (hit === undefined) return undefined;
    return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1).trim() : "";
  };

  const parsePositiveInt = (raw, label, fallback) => {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer (got "${raw}").`);
    return n;
  };

  const retryDecisionsRaw = read("--retry-decisions");
  const retryDecisions =
    retryDecisionsRaw === undefined
      ? null
      : retryDecisionsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  if (retryDecisionsRaw !== undefined && !retryDecisions.length) {
    throw new Error(
      '--retry-decisions requires at least one finalDecision value (e.g. "NOT_NARA_CMS,DIAGNOSE_FAILED").'
    );
  }

  return {
    limit: parsePositiveInt(read("--limit"), "--limit", 10),
    universityId: read("--university-id") || null,
    resume: args.includes("--resume"),
    dryRun: args.includes("--dry-run"),
    auditFile: read("--audit-file") || null,
    runId: read("--run-id") || null,
    minAccepted: parsePositiveInt(read("--min-accepted"), "--min-accepted", 2),
    retryDecisions,
  };
}

// -- 2. matchesCandidateFilter -------------------------------------------------

function matchesCandidateFilter(row) {
  if (!row) return false;
  const homeOk = /^2\d\d$/.test(String(row.homeStatus).trim());
  const robotsOk = ["ok", "none(404)"].includes(String(row.robots).trim());
  const catOk = ["NO_SOURCE", "SOURCE_UNVERIFIED"].includes(String(row.cat).trim());
  return homeOk && robotsOk && catOk;
}

// -- 4/5. catalog lookups ---------------------------------------------------

function findCatalogUniversity(catalog, universityId) {
  const list = (catalog && catalog.universities) || [];
  return list.find((entry) => entry.universityId === universityId) || null;
}

function universityHasCatalogSource(catalog, universityId) {
  const university = findCatalogUniversity(catalog, universityId);
  return Boolean(university && Array.isArray(university.sources) && university.sources.length > 0);
}

// -- 3. isVariantCampus ---------------------------------------------------------

function isVariantCampus(row, catalog) {
  if (!row) return false;
  const id = String(row.id || "");
  const name = String(row.name || "");
  const looksVariant = /-제\d*캠퍼|-분교/.test(id) || /제\s*\d*\s*캠퍼|분교/.test(name);
  if (!looksVariant) return false;
  const mainId = id.replace(/-(제\d*캠퍼[^-]*|분교)$/, "-본교");
  if (mainId === id) return false;
  return universityHasCatalogSource(catalog, mainId);
}

// -- 6. selectCandidates ---------------------------------------------------------

function selectCandidates(auditRows, catalog, stateData, opts = {}) {
  const { limit = 10, universityId = null, resume = false, retryDecisions = null } = opts;
  const rows = Array.isArray(auditRows) ? auditRows : [];
  const preSkipped = [];

  if (universityId) {
    // audit/카탈로그/후보 파일의 한글 id 는 NFD(조합형)로 저장돼 있고, 셸에서
    // 넘어온 --university-id 는 보통 NFC 다. 정규화해서 비교한다(단건 선택에만
    // 적용 -- 이후 파이프는 audit 의 원본 row.id 를 그대로 쓴다).
    const wanted = String(universityId).normalize("NFC");
    const row = rows.find((entry) => String(entry.id).normalize("NFC") === wanted);
    if (!row) {
      return {
        selected: [],
        preSkipped: [
          { universityId, universityName: null, finalDecision: "BLOCK_MISSING", reason: "not_in_audit_queue" },
        ],
      };
    }
    if (!matchesCandidateFilter(row)) {
      return {
        selected: [],
        preSkipped: [
          {
            universityId: row.id,
            universityName: row.name,
            finalDecision: "FILTERED_OUT",
            reason: "candidate_filter",
          },
        ],
      };
    }
    return { selected: [row], preSkipped };
  }

  let pool = rows.filter(matchesCandidateFilter);

  pool = pool.filter((row) => {
    if (isVariantCampus(row, catalog)) {
      preSkipped.push({
        universityId: row.id,
        universityName: row.name,
        finalDecision: "SKIPPED_VARIANT_CAMPUS",
        reason: "variant_campus_main_has_source",
      });
      return false;
    }
    return true;
  });

  if (retryDecisions && retryDecisions.length) {
    const stateById = new Map(((stateData && stateData.processed) || []).map((entry) => [entry.universityId, entry]));
    pool = pool.filter((row) => {
      const st = stateById.get(row.id);
      return Boolean(st) && retryDecisions.includes(st.finalDecision);
    });
    // resume 은 여기서 무시한다(§G) -- retryDecisions 가 지정되면 그 필터가 곧
    // "다른 결정은 손대지 않음" 요구사항 자체이므로 resume 의 "종결분 제외"
    // 규칙과 병행하지 않는다.
  } else if (resume) {
    const done = new Set(
      ((stateData && stateData.processed) || [])
        .filter((entry) => entry && entry.finalDecision && entry.finalDecision !== "ERROR")
        .map((entry) => entry.universityId)
    );
    pool = pool.filter((row) => !done.has(row.id));
  }

  return { selected: pool.slice(0, limit), preSkipped };
}

// -- client-side redirect (meta-refresh / JS location) ----------------------

function matchMetaRefreshContent(text) {
  for (const tag of String(text || "").match(/<meta\b[^>]*>/gi) || []) {
    if (!/http-equiv\s*=\s*["']?\s*refresh\s*["']?/i.test(tag)) continue;
    const content =
      tag.match(/content\s*=\s*["']([^"']*)["']/i) || tag.match(/content\s*=\s*([^\s">]+)/i);
    if (content) return content[1];
  }
  return null;
}

function parseRefreshTarget(content) {
  const value = String(content || "").trim();
  const semicolon = value.indexOf(";");
  if (semicolon < 0) return null; // "5" (pure delay, no URL) -> not a redirect
  return (
    value
      .slice(semicolon + 1)
      .trim()
      .replace(/^url\s*=\s*/i, "")
      .replace(/^["']|["']$/g, "")
      .trim() || null
  );
}

function matchJsLocationTarget(text) {
  const head = String(text || "").slice(0, 4000); // JS redirects sit near the top
  const patterns = [
    /location\.replace\s*\(\s*["']([^"']+)["']/i,
    /location\.assign\s*\(\s*["']([^"']+)["']/i,
    /(?:window\.|document\.|self\.|top\.)?location\.href\s*=\s*["']([^"']+)["']/i,
    /(?:window\.|self\.|top\.)?location\s*=\s*["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const match = head.match(re);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * 한국 대학 루트 도메인은 대개 실제 홈을 HTTP 3xx 가 아니라 클라이언트측
 * 리다이렉트 스텁(meta-refresh 또는 JS `location.*`)으로 넘긴다. 이 함수는
 * 그런 스텁에서 목적지 절대 URL 을 뽑아낸다.
 *
 * 보수적으로 판정한다(오탐 시 엉뚱한 페이지로 가므로):
 *  - meta-refresh: 명시적 브라우저 지시라 신뢰하되, 페이지가 명백히 실제
 *    콘텐츠(본문 길이 충분 + 링크 다수)면 무시.
 *  - JS location.*: 얇은 스텁(본문 거의 없음)일 때만 신뢰.
 * 실제 콘텐츠 페이지면 null.
 *
 * @param {string} html
 * @param {string} baseUrl 상대 경로 해석 기준
 * @returns {string|null} 목적지 절대 URL 또는 null
 */
function extractClientRedirect(html, baseUrl) {
  const text = String(html || "");
  const strippedText = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const anchorCount = (text.match(/<a\b[^>]*\bhref\s*=/gi) || []).length;
  const looksLikeRealContent = strippedText.length >= 600 && anchorCount >= 5;

  const metaContent = matchMetaRefreshContent(text);
  if (metaContent && !looksLikeRealContent) {
    const target = parseRefreshTarget(metaContent);
    if (target) return absoluteUrl(target, baseUrl);
  }

  const looksLikeStub = strippedText.length < 400 && anchorCount <= 3;
  if (looksLikeStub) {
    const target = matchJsLocationTarget(text);
    if (target) return absoluteUrl(target, baseUrl);
  }
  return null;
}

// -- 7. detectNaraCms ------------------------------------------------------------

// link host 가 대학 자체 host 와 같은지(www. 정규화 후 정확히 일치).
// 라이브러리/포털 같은 형제 서브도메인(lib.daegu.ac.kr 등)이 자체 Nara
// 인스턴스를 돌려도 그건 대학 메인 사이트가 Nara CMS 라는 증거가 아니다.
function sameUniversityHost(linkHost, universityHost) {
  if (!universityHost) return true; // host 컨텍스트 없음 -> 필터 안 함
  if (!linkHost) return true; // 상대 경로 href -> 같은 host
  return (
    String(linkHost).toLowerCase().replace(/^www\./, "") ===
    String(universityHost).toLowerCase().replace(/^www\./, "")
  );
}

// robots.txt 원문에서 `Sitemap:` 라인 값들을 추출한다(순수, 네트워크 없음).
// (robots-group-parser.js 는 수정하지 않는다 -- Sitemap 지시어는 User-agent
// 그룹에 속하지 않으므로 그 파서의 그룹 모델과 무관한 별도 정규식 스캔이다.)
function extractRobotsSitemapUrls(robotsText) {
  const out = [];
  const re = /^sitemap\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(String(robotsText || "")))) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

// 시그널 A: robots.txt 의 Sitemap 라인 중 하나라도 `/xmlSite/siteMap.do` 로
// 끝나거나 `/bbs/` 를 포함하면 매칭(경로 소문자 비교).
function robotsSignalIndicatesNara(sitemapUrls) {
  for (const raw of sitemapUrls || []) {
    let pathname = "";
    try {
      pathname = new URL(raw).pathname.toLowerCase();
    } catch {
      continue;
    }
    if (pathname.endsWith("/xmlsite/sitemap.do") || pathname.includes("/bbs/")) {
      return { matched: true, matchedUrl: raw };
    }
  }
  return { matched: false, matchedUrl: null };
}

// 시그널 B: `{origin}/xmlSite/siteMap.do` 본문 안에서 `/{seg}/{digits}/subview.do`
// 링크가 2개 이상(다수) 발견되면 매칭.
function sitemapSignalIndicatesNara(sitemapHtml) {
  const text = String(sitemapHtml || "");
  if (!text) return { matched: false, subviewLinkCount: 0 };
  const matches = text.match(/\/[A-Za-z0-9_-]+\/\d+\/subview\.do/g) || [];
  const count = new Set(matches).size;
  return { matched: count >= 2, subviewLinkCount: count };
}

function detectNaraCms(html, options = {}) {
  const text = String(html || "");
  const uniHost = options.host || "";
  const cEvidence = [];

  // (1) `/{seg}/{digits}/subview.do` -- 경로 전용, 어디에 있든 안전.
  const subviewRe = /\/[A-Za-z0-9_-]+\/\d+\/subview\.do/g;
  let subviewMatch;
  while ((subviewMatch = subviewRe.exec(text)) && cEvidence.length < 3) {
    cEvidence.push(subviewMatch[0].slice(0, 160));
  }

  // (2) `/bbs/{seg}/` href -- link host 가 대학 자체 host 일 때만 증거로 인정.
  if (cEvidence.length < 3) {
    const hrefRe = /href\s*=\s*["']([^"']*\/bbs\/[A-Za-z0-9_-]+\/[^"']*)["']/gi;
    let hrefMatch;
    while ((hrefMatch = hrefRe.exec(text)) && cEvidence.length < 3) {
      const raw = hrefMatch[1];
      let linkHost = "";
      try {
        linkHost = new URL(raw, uniHost ? `https://${uniHost}` : "https://placeholder.invalid").host;
      } catch {
        linkHost = "";
      }
      if (sameUniversityHost(linkHost, uniHost) && /\/bbs\/[A-Za-z0-9_-]+\//.test(raw)) {
        cEvidence.push(raw.slice(0, 160));
      }
    }
  }

  // (3) host 컨텍스트가 없을 때만: 본문 어디든 `/bbs/{seg}/{digits}/` 경로.
  if (!uniHost && cEvidence.length === 0) {
    const bareRe = /\/bbs\/[A-Za-z0-9_-]+\/\d+\//g;
    let bareMatch;
    while ((bareMatch = bareRe.exec(text)) && cEvidence.length < 3) {
      cEvidence.push(bareMatch[0].slice(0, 160));
    }
  }

  const signalA = robotsSignalIndicatesNara(options.robotsSitemapUrls || []);
  const signalB = sitemapSignalIndicatesNara(options.sitemapHtml);
  const signalC = cEvidence.length > 0;

  const evidence = [];
  if (signalA.matched) evidence.push(`[A] robots Sitemap -> ${signalA.matchedUrl}`);
  if (signalB.matched) evidence.push(`[B] xmlSite/siteMap.do subview.do links=${signalB.subviewLinkCount}`);
  evidence.push(...cEvidence.slice(0, 3));

  return {
    isNara: signalA.matched || signalB.matched || signalC,
    evidence,
    signals: { A: signalA.matched, B: signalB.matched, C: signalC },
    host: options.host || null,
  };
}

// -- 9. extractNavBoardLinks --------------------------------------------------

function extractNavBoardLinks(html, options = {}) {
  const keywords = options.keywords || NEWS_NAV_KEYWORDS;
  const text = String(html || "");
  const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  const seen = new Set();
  let match;
  while ((match = anchorRe.exec(text))) {
    const href = match[1].trim();
    const linkText = match[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!linkText || !href) continue;
    if (!keywords.some((keyword) => linkText.includes(keyword))) continue;
    if (!/subview\.do|\/bbs\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: linkText });
    if (out.length >= 6) break;
  }
  return out;
}

// -- 10. classifyBoardCategory ----------------------------------------------

function classifyBoardCategory(linkText) {
  const value = String(linkText || "");
  if (/보도|뉴스|소식|언론/.test(value)) return "school_news";
  if (/공지|알림/.test(value)) return "school_notice";
  return null;
}

// -- 10b. extractSitemapMenuEntries / prioritizeBoardCandidates (§B) --------

// sitemapHtml: `{origin}/xmlSite/siteMap.do` 응답 본문. 반환: 중복 제거된
// 메뉴 항목 목록(순서는 문서 등장 순).
function extractSitemapMenuEntries(sitemapHtml) {
  const text = String(sitemapHtml || "");
  const anchorRe =
    /<a\b[^>]*href\s*=\s*["']([^"']*\/([A-Za-z0-9_-]+)\/(\d+)\/subview\.do)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = anchorRe.exec(text))) {
    const [, href, site, menuId, innerHtml] = m;
    const label = innerHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const key = `${site}/${menuId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, site, menuId, text: label });
  }
  return out;
}

// school_news 우선, school_notice 다음(각 그룹 내부 순서 유지).
function prioritizeBoardCandidates(labeledCandidates) {
  const list = Array.isArray(labeledCandidates) ? labeledCandidates : [];
  return [
    ...list.filter((c) => c.category === "school_news"),
    ...list.filter((c) => c.category === "school_notice"),
  ];
}

// -- 12. extractSiteAndBoardId --------------------------------------------------

function extractSiteAndBoardId(text, options = {}) {
  const match = String(text || "").match(/\/bbs\/([A-Za-z0-9_-]+)\/(\d+)\//);
  if (!match) return null;
  const result = { site: match[1], boardId: match[2] };
  if (options.host && typeof options.host === "string") result.host = options.host;
  return result;
}

// -- 11. pickBestBoard --------------------------------------------------------

function pickBestBoard(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && c.site && c.boardId) : [];
  const chosen =
    list.find((c) => c.category === "school_news") || list.find((c) => c.category === "school_notice");
  if (!chosen) return null;
  const category = chosen.category;
  return {
    site: chosen.site,
    boardId: chosen.boardId,
    category,
    categoryLabel: category === "school_news" ? "학교 소식" : "학교 공지",
    sourceUrl: chosen.subviewUrl || null,
  };
}

// -- 14. deriveShortName ----------------------------------------------------

function deriveShortName(universityId, host, existingIds = []) {
  const label = String(host || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^www\./i, "")
    .split(".")[0];
  let base = label.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!base) {
    base =
      String(universityId || "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "src";
  }
  const taken = new Set(existingIds || []);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

// -- 13. buildCandidateSource ---------------------------------------------------

function buildCandidateSource({
  host,
  site,
  boardId,
  category,
  categoryLabel,
  shortName,
  subviewUrl,
  universityName,
}) {
  const isNews = category === "school_news";
  return {
    id: `${shortName}-${isNews ? "press-release" : "notice"}`,
    name: `${universityName ? `${universityName} ` : ""}${isNews ? "보도자료" : "공지사항"}`,
    category: isNews ? "school_news" : "school_notice",
    categoryLabel: categoryLabel || (isNews ? "학교 소식" : "학교 공지"),
    sourceType: "official",
    collectionType: "rss",
    rssUrl: `https://${host}/bbs/${site}/${boardId}/rssList.do`,
    listUrl: subviewUrl || `https://${host}/bbs/${site}/${boardId}/`,
    baseUrl: `https://${host}`,
    detailSelectors: { title: "h2.view-title", date: "dl.write dd" },
    datePolicy: { prefer: "list" },
    verified: false,
    enabled: false,
    status: "collector_config_candidate",
    healthStatus: "unknown",
  };
}

// -- 16. verifyRssFeed ----------------------------------------------------------

function verifyRssFeed(rssResult) {
  const items = rssResult && Array.isArray(rssResult.items) ? rssResult.items : [];
  const reasons = [];
  if (items.length < 2) reasons.push(`items<2 (got ${items.length})`);
  items.forEach((item, index) => {
    if (!item || !item.title) reasons.push(`item[${index}] missing title`);
    if (!item || !(item.sourceUrl || item.link)) reasons.push(`item[${index}] missing link`);
    if (!item || !(item.publishedAt || item.pubDate)) reasons.push(`item[${index}] missing pubDate`);
  });
  return { ok: reasons.length === 0, itemCount: items.length, reasons };
}

// -- 16b. selectValidatedBoard (§C) -----------------------------------------

// candidates: §B 의 boardCandidates(순서 = 우선순위). 커밋(카탈로그 삽입)
// 이전에 후보별로 rssList.do 를 실제 검증해, 첫 통과 후보를 채택한다(빈/비활성
// 게시판을 골라도 재시도하지 않던 근본 원인 2 를 고친다).
async function selectValidatedBoard({ candidates, university, host, origin, gate, rssCollectorImpl }) {
  const collector = rssCollectorImpl || rssCollector;
  const list = Array.isArray(candidates) ? candidates : [];
  const failures = [];

  for (const cand of list) {
    let site = cand.site;
    let boardId = cand.directBoardId;

    if (!boardId) {
      // sitemap 후보(또는 direct 추출 실패한 nav 후보): subview.do fetch 필요.
      let html = "";
      try {
        const res = await gate.fetch(cand.subviewUrl);
        if (res && res.ok) html = await res.text();
      } catch (error) {
        if (isGateBudgetError(error)) throw error; // 예산/타임아웃은 즉시 상위로 전파
        failures.push({ candidate: cand, reason: `subview_fetch_failed:${error.message}` });
        continue;
      }
      const found = extractSiteAndBoardId(html, { host });
      if (!found) {
        failures.push({ candidate: cand, reason: "boardid_not_found" });
        continue;
      }
      site = found.site;
      boardId = found.boardId;
    }

    const trialSource = { rssUrl: `https://${host}/bbs/${site}/${boardId}/rssList.do` };
    let rssResult;
    try {
      rssResult = await collector({ university, source: trialSource, limit: 3, fetchImpl: gate.fetch });
    } catch (error) {
      if (isGateBudgetError(error)) throw error;
      failures.push({ candidate: cand, site, boardId, reason: `rss_fetch_failed:${error.message}` });
      continue;
    }
    const feed = verifyRssFeed(rssResult);
    if (!feed.ok) {
      failures.push({ candidate: cand, site, boardId, reason: `rss_invalid:${feed.reasons.join(";")}` });
      continue; // 다음 후보로
    }

    return {
      board: {
        site,
        boardId,
        category: cand.category,
        categoryLabel: cand.category === "school_news" ? "학교 소식" : "학교 공지",
        sourceUrl: cand.subviewUrl,
      },
      rssResult,
      triedCount: failures.length + 1,
      failures,
    };
  }
  return { board: null, triedCount: failures.length, failures };
}

// -- 17. checkRobotsPathDisallow ----------------------------------------------

function checkRobotsPathDisallow(groups, paths) {
  const list = Array.isArray(groups) ? groups : [];
  const targets = (paths || []).filter(Boolean);
  for (const group of list) {
    if (!group || !Array.isArray(group.uas) || !group.uas.includes("*")) continue;
    for (const rawRule of group.disallows || []) {
      const rule = String(rawRule || "").replace(/\*+$/, "").trim();
      if (!rule) continue;
      if (targets.some((target) => target.startsWith(rule))) {
        return { disallowed: true, matchedRule: rule, group };
      }
    }
  }
  return { disallowed: false, matchedRule: null, group: null };
}

// -- 18. evaluateRobots ------------------------------------------------------

function evaluateRobots(robotsEvidence, options = {}) {
  const paths = options.paths || [];
  const evidence = robotsEvidence || {};

  if (evidence.unavailable === true) {
    return { verdict: "ROBOTS_BLOCKED", reason: "ROBOTS_UNAVAILABLE" };
  }
  if (evidence.checked === true) {
    if (evidence.policy && evidence.policy.blocked === true) {
      return { verdict: "ROBOTS_BLOCKED", reason: "ai_bot_full_disallow" };
    }
    const groups = Array.isArray(evidence.groups)
      ? evidence.groups
      : typeof evidence.robotsText === "string"
        ? parseRobotsGroups(evidence.robotsText)
        : [];
    const pathCheck = checkRobotsPathDisallow(groups, paths);
    if (pathCheck.disallowed) {
      return { verdict: "ROBOTS_BLOCKED", reason: `path_disallow:${pathCheck.matchedRule}` };
    }
  }
  return { verdict: "OK", reason: null };
}

// -- 20. resolveDateSelector -------------------------------------------------

function resolveDateSelector(detailHtmlList, listPublishedAtList, baseSource) {
  const htmls = Array.isArray(detailHtmlList) ? detailHtmlList : [];
  const listDates = Array.isArray(listPublishedAtList) ? listPublishedAtList : [];
  for (const selector of DATE_SELECTOR_FALLBACKS) {
    const trialSource = {
      ...baseSource,
      detailSelectors: { ...(baseSource && baseSource.detailSelectors), date: selector },
    };
    const publishedAtByIndex = htmls.map((html, index) => {
      const detail = extractDetail(html, trialSource, listDates[index]);
      return detail.publishedAt || null;
    });
    if (publishedAtByIndex.filter(Boolean).length >= 2) {
      return { selector, publishedAtByIndex };
    }
  }
  return null;
}

// -- 19. runPreflight ------------------------------------------------------------

async function runPreflight({
  university,
  source,
  limit = 3,
  fetchGate,
  rssCollectorImpl,
  minAccepted = 2,
  maxDetailFetches,
  prefetchedRssResult,
}) {
  const collector = rssCollectorImpl || rssCollector;
  let rssResult;
  if (prefetchedRssResult) {
    // §C selectValidatedBoard 에서 이미 검증 통과한 결과 재사용 -- rssList.do
    // 를 두 번 fetch 하지 않는다(§E 예산).
    rssResult = prefetchedRssResult;
  } else {
    try {
      rssResult = await collector({ university, source, limit, fetchImpl: fetchGate.fetch });
    } catch (error) {
      return {
        ok: false,
        acceptedCount: 0,
        storableItems: [],
        triedDateSelectors: [],
        usedDateSelector: null,
        reason: `rss_fetch_failed:${error.message}`,
      };
    }
  }

  const feed = verifyRssFeed(rssResult);
  if (!feed.ok) {
    return {
      ok: false,
      acceptedCount: 0,
      storableItems: [],
      triedDateSelectors: [],
      usedDateSelector: null,
      reason: `rss_invalid:${feed.reasons.join(";")}`,
    };
  }

  const items = (rssResult.items || []).slice(0, limit);
  const cap = Number.isInteger(maxDetailFetches) ? maxDetailFetches : items.length;
  const perItem = [];

  for (let index = 0; index < items.length && index < cap; index += 1) {
    const item = items[index];
    let html = "";
    try {
      const response = await fetchGate.fetch(item.sourceUrl, { method: "GET" });
      html = await response.text();
    } catch (error) {
      perItem.push({ index, item, html: "", accepted: false, reason: `detail_fetch_failed:${error.message}` });
      continue;
    }
    const detail = extractDetail(html, source, item.publishedAt);
    const uniMatch = universityNameMatches(source, university, html);
    const titleOk = titleMatches(source, item.title, detail.title);
    perItem.push({
      index,
      item,
      html,
      detail,
      uniMatch,
      titleOk,
      publishedAt: detail.publishedAt || null,
      title: detail.title,
      sourceUrl: item.sourceUrl,
      accepted: Boolean(uniMatch && titleOk && detail.publishedAt),
      reason: !uniMatch
        ? "university_name_mismatch"
        : !titleOk
          ? "title_mismatch"
          : !detail.publishedAt
            ? "published_at_not_found"
            : null,
    });
  }

  let usedDateSelector = (source.detailSelectors && source.detailSelectors.date) || null;
  const triedDateSelectors = usedDateSelector ? [usedDateSelector] : [];
  let acceptedCount = perItem.filter((entry) => entry.accepted).length;

  const dateMissing = perItem.filter(
    (entry) => entry.html && entry.uniMatch && entry.titleOk && !entry.publishedAt
  );
  if (acceptedCount < minAccepted && dateMissing.length) {
    const withHtml = perItem.filter((entry) => entry.html);
    const resolved = resolveDateSelector(
      withHtml.map((entry) => entry.html),
      withHtml.map((entry) => entry.item.publishedAt || null),
      source
    );
    if (resolved) {
      usedDateSelector = resolved.selector;
      for (const selector of DATE_SELECTOR_FALLBACKS) {
        if (!triedDateSelectors.includes(selector)) triedDateSelectors.push(selector);
        if (selector === resolved.selector) break;
      }
      withHtml.forEach((entry, position) => {
        const published = resolved.publishedAtByIndex[position] || entry.publishedAt;
        entry.publishedAt = published || null;
        entry.accepted = Boolean(entry.uniMatch && entry.titleOk && entry.publishedAt);
        if (entry.accepted) entry.reason = null;
        else if (!entry.publishedAt) entry.reason = "published_at_not_found";
      });
      acceptedCount = perItem.filter((entry) => entry.accepted).length;
    }
  }

  const storableItems = perItem
    .filter((entry) => entry.accepted)
    .map((entry) => ({ title: entry.title, sourceUrl: entry.sourceUrl, publishedAt: entry.publishedAt }));

  const ok = acceptedCount >= minAccepted && storableItems.every((entry) => Boolean(entry.publishedAt));
  const failReasons = [
    ...new Set(perItem.filter((entry) => !entry.accepted && entry.reason).map((entry) => entry.reason)),
  ];

  return {
    ok,
    acceptedCount,
    storableItems,
    triedDateSelectors,
    usedDateSelector,
    reason: ok
      ? null
      : `preflight_failed acceptedCount=${acceptedCount}/${minAccepted}${
          failReasons.length ? ` [${failReasons.join(",")}]` : ""
        }`,
  };
}

// -- 21. buildCandidateEntry ------------------------------------------------

function buildCandidateEntry({ university, source, boardId, discoveredAt, note }) {
  return {
    universityId: university.universityId,
    universityName: university.universityName,
    universityGroupId: university.universityGroupId || university.universityId,
    finalDecision: "COLLECTOR_CONFIG_READY",
    discoveredAt: discoveredAt || null,
    discoveryNote:
      note ||
      `Nara Info CMS ${source.category === "school_news" ? "보도자료" : "공지사항"} 게시판 ${boardId}.`,
    source,
  };
}

// -- 22. appendCandidateAtomic ---------------------------------------------

function appendCandidateAtomic(candidateFile, entry, fsImpls = {}) {
  const {
    readFileImpl = fs.readFileSync,
    writeFileImpl = fs.writeFileSync,
    renameImpl = fs.renameSync,
    copyFileImpl = fs.copyFileSync,
    existsImpl = fs.existsSync,
    mkdirImpl = fs.mkdirSync,
  } = fsImpls;

  let data = { generatedAt: null, items: [] };
  if (existsImpl(candidateFile)) {
    data = JSON.parse(readFileImpl(candidateFile, "utf8"));
    if (!data || typeof data !== "object") data = { generatedAt: null, items: [] };
    if (!Array.isArray(data.items)) data.items = [];
  }

  const duplicate = data.items.some(
    (item) =>
      item &&
      item.universityId === entry.universityId &&
      item.source &&
      entry.source &&
      item.source.id === entry.source.id
  );
  if (duplicate) return { appended: false, reason: "duplicate" };

  data.items.push(entry);
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  if (existsImpl(candidateFile)) {
    const backupDir = path.join(path.dirname(candidateFile), "..", "backups");
    mkdirImpl(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${path.basename(candidateFile)}.${Date.now()}.bak`);
    copyFileImpl(candidateFile, backup);
    JSON.parse(readFileImpl(backup, "utf8"));
  }

  const tmp = `${candidateFile}.tmp`;
  writeFileImpl(tmp, serialized, "utf8");
  JSON.parse(readFileImpl(tmp, "utf8"));
  renameImpl(tmp, candidateFile);
  return { appended: true };
}

function candidateFileHasReady(candidateFile, universityId, fsImpls = {}) {
  const { readFileImpl = fs.readFileSync, existsImpl = fs.existsSync } = fsImpls;
  if (!existsImpl(candidateFile)) return false;
  try {
    const data = JSON.parse(readFileImpl(candidateFile, "utf8"));
    return (data.items || []).some(
      (item) => item && item.universityId === universityId && item.finalDecision === "COLLECTOR_CONFIG_READY"
    );
  } catch {
    return false;
  }
}

// -- 23. aggregateSummary --------------------------------------------------

function aggregateSummary(results) {
  const list = Array.isArray(results) ? results : [];
  const count = (predicate) => list.filter(predicate).length;
  return {
    processed: list.length,
    packetsCreated: count((r) => r.finalDecision === "PACKET_CREATED"),
    notNaraCms: count((r) => r.finalDecision === "NOT_NARA_CMS"),
    robotsBlocked: count((r) => r.finalDecision === "ROBOTS_BLOCKED"),
    diagnoseFailed: count(
      (r) => r.finalDecision === "DIAGNOSE_FAILED" || r.finalDecision === "DIAGNOSE_FAILED_POST_B1"
    ),
    blockMissing: count((r) => r.finalDecision === "BLOCK_MISSING"),
    sourceAlreadyExists: count((r) => r.finalDecision === "SOURCE_ALREADY_EXISTS"),
    variantCampus: count((r) => r.finalDecision === "SKIPPED_VARIANT_CAMPUS"),
    error: count((r) => r.finalDecision === "ERROR"),
  };
}

// -- 24. buildReport ------------------------------------------------------------

function buildReport({ runId, startedAt, finishedAt, options, results, summary, regressionEvidence }) {
  return {
    runId,
    tool: "discover-nara-cms-batch",
    startedAt,
    finishedAt,
    options: {
      limit: options.limit,
      universityId: options.universityId || null,
      resume: Boolean(options.resume),
      dryRun: Boolean(options.dryRun),
      retryDecisions: options.retryDecisions || null,
    },
    regressionEvidence: regressionEvidence || null,
    summary,
    results,
    mutation: {
      enabled: false,
      verified: false,
      status: false,
      store: false,
      preview: false,
      git: false,
      deploy: false,
    },
  };
}

// -- 25/26/27. state ------------------------------------------------------------

function loadState(stateFile, readImpl = fs.readFileSync, existsImpl = fs.existsSync) {
  const empty = { version: 1, updatedAt: null, processed: [] };
  if (!existsImpl(stateFile)) return empty;
  try {
    const parsed = JSON.parse(readImpl(stateFile, "utf8"));
    if (!parsed || typeof parsed !== "object") return empty;
    if (!Array.isArray(parsed.processed)) parsed.processed = [];
    if (parsed.version == null) parsed.version = 1;
    if (parsed.updatedAt === undefined) parsed.updatedAt = null;
    return parsed;
  } catch {
    return empty;
  }
}

function mergeState(prev, newResults, now = () => new Date()) {
  const base =
    prev && Array.isArray(prev.processed) ? prev : { version: 1, updatedAt: null, processed: [] };
  const at = now().toISOString();
  const byId = new Map(base.processed.map((entry) => [entry.universityId, entry]));
  for (const result of newResults || []) {
    if (!result || !result.universityId) continue;
    byId.set(result.universityId, {
      universityId: result.universityId,
      finalDecision: result.finalDecision,
      runId: result.runId || null,
      at,
      rssUrl: result.rssUrl || null,
      boardId: result.boardId || null,
      reviewId: result.reviewId || null,
      reason: result.reason || null,
    });
  }
  return { version: 1, updatedAt: at, processed: [...byId.values()] };
}

function writeStateAtomic(stateFile, state, fsImpls = {}) {
  const {
    readFileImpl = fs.readFileSync,
    writeFileImpl = fs.writeFileSync,
    renameImpl = fs.renameSync,
    copyFileImpl = fs.copyFileSync,
    existsImpl = fs.existsSync,
    mkdirImpl = fs.mkdirSync,
  } = fsImpls;
  mkdirImpl(path.dirname(stateFile), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (existsImpl(stateFile)) {
    const backup = `${stateFile}.bak`;
    copyFileImpl(stateFile, backup);
    JSON.parse(readFileImpl(backup, "utf8"));
  }
  const tmp = `${stateFile}.tmp`;
  writeFileImpl(tmp, serialized, "utf8");
  JSON.parse(readFileImpl(tmp, "utf8"));
  renameImpl(tmp, stateFile);
}

// -- 28. createFetchGate --------------------------------------------------

function createFetchGate({
  minDelayMs = 500,
  maxRequests = 18,
  timeoutMs = 15000,
  maxElapsedMs = 90000,
  fetchImpl,
  now = () => Date.now(),
  sleepImpl,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("createFetchGate: fetchImpl is required.");
  const sleep = sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const nowMs = () => {
    const value = now();
    return value instanceof Date ? value.getTime() : Number(value);
  };
  const startedAtMs = nowMs();

  const gate = {
    count: 0,
    lastAt: null,
    async fetch(url, init = {}) {
      if (nowMs() - startedAtMs > maxElapsedMs) {
        const error = new Error(`university_timeout_exceeded (max ${maxElapsedMs}ms wall-clock per university)`);
        error.code = "UNIVERSITY_TIMEOUT_EXCEEDED";
        throw error;
      }
      if (gate.count >= maxRequests) {
        const error = new Error(`request_budget_exceeded (max ${maxRequests} requests per university)`);
        error.code = "REQUEST_BUDGET_EXCEEDED";
        throw error;
      }
      if (gate.lastAt != null) {
        const elapsed = nowMs() - gate.lastAt;
        if (elapsed < minDelayMs) await sleep(minDelayMs - elapsed);
      }
      gate.lastAt = nowMs();
      gate.count += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetchImpl(url, {
          redirect: "follow",
          ...init,
          signal: controller.signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml,text/plain,*/*",
            ...(init.headers || {}),
          },
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
  return gate;
}

// gate.fetch() 가 요청 예산/대학당 벽시계 예산 초과로 throw 한 에러인지 판정
// (순수, 네트워크 없음). 이 두 코드만 즉시 상위(processUniversity)로 전파하고,
// 나머지 에러는 후보별 실패로 흡수한다(§E).
function isGateBudgetError(error) {
  return Boolean(error) && ["REQUEST_BUDGET_EXCEEDED", "UNIVERSITY_TIMEOUT_EXCEEDED"].includes(error.code);
}

// -- 29. processUniversity ------------------------------------------------------

async function processUniversity(row, ctx) {
  const {
    catalog,
    candidatesFile,
    fetchGateFactory,
    rssCollectorImpl,
    b1Impl,
    b2Impl,
    regressionEvidence,
    now,
    randomBytesImpl,
    dryRun,
    minAccepted = 2,
    runId,
    candidateFsImpls,
  } = ctx;

  const base = {
    universityId: row.id,
    universityName: row.name,
    finalDecision: null,
    rssUrl: null,
    boardId: null,
    site: null,
    category: null,
    usedDateSelector: null,
    homeResolvedUrl: null,
    preflight: null,
    robots: null,
    reviewId: null,
    b1: null,
    requestCount: 0,
    reason: null,
    error: null,
    runId: runId || null,
    detectionSignals: null,
    boardSource: null,
  };
  const done = (patch) => ({ ...base, ...patch });
  const budgetErrorPatch = (error, extra = {}) => ({
    finalDecision: "ERROR",
    reason: error.code === "UNIVERSITY_TIMEOUT_EXCEEDED" ? "university_timeout_exceeded" : "request_budget_exceeded",
    error: error.message,
    ...extra,
  });

  const university = findCatalogUniversity(catalog, row.id);
  if (!university) return done({ finalDecision: "BLOCK_MISSING", reason: "no_catalog_block" });

  if (
    universityHasCatalogSource(catalog, row.id) ||
    candidateFileHasReady(candidatesFile, row.id, candidateFsImpls)
  ) {
    return done({ finalDecision: "SOURCE_ALREADY_EXISTS", reason: "live_catalog_or_candidate_duplicate" });
  }

  const gate = fetchGateFactory();
  try {
    // [req 1] home page
    let homeResponse;
    try {
      homeResponse = await gate.fetch(row.site);
    } catch (error) {
      base.requestCount = gate.count;
      if (isGateBudgetError(error)) return done(budgetErrorPatch(error));
      return done({ finalDecision: "ERROR", reason: "home_fetch_error", error: error.message });
    }
    if (!homeResponse || !homeResponse.ok) {
      return done({ finalDecision: "NOT_NARA_CMS", reason: "home_fetch_failed", requestCount: gate.count });
    }
    let homeHtml = await homeResponse.text();
    let finalHomeUrl = homeResponse.url || row.site;
    let homeResolvedUrl = null;

    // [req 2] 한국 대학 루트는 대부분 meta-refresh / JS `location.*` 스텁으로
    // 실제 홈을 넘긴다(HTTP 3xx 아님). 최대 4회까지 따라간다(§F).
    for (let hop = 0; hop < 4; hop += 1) {
      const redirectTarget = extractClientRedirect(homeHtml, finalHomeUrl);
      if (!redirectTarget || !safeOrigin(redirectTarget)) break;
      let followed;
      try {
        followed = await gate.fetch(redirectTarget);
      } catch (error) {
        base.requestCount = gate.count;
        if (isGateBudgetError(error)) return done(budgetErrorPatch(error, { homeResolvedUrl }));
        return done({
          finalDecision: "ERROR",
          reason: "home_redirect_fetch_error",
          error: error.message,
          homeResolvedUrl,
        });
      }
      if (!followed || !followed.ok) {
        return done({
          finalDecision: "NOT_NARA_CMS",
          reason: "home_fetch_failed",
          requestCount: gate.count,
          homeResolvedUrl: followed && followed.url ? followed.url : redirectTarget,
        });
      }
      homeResolvedUrl = followed.url || redirectTarget;
      homeHtml = await followed.text();
      finalHomeUrl = homeResolvedUrl;
    }
    // 4회를 다 돌았는데도 여전히 스텁이면(리다이렉트 대상이 계속 존재) 포기.
    if (extractClientRedirect(homeHtml, finalHomeUrl)) {
      return done({
        finalDecision: "NOT_NARA_CMS",
        reason: "redirect_loop_or_double_stub",
        requestCount: gate.count,
        homeResolvedUrl,
      });
    }
    base.homeResolvedUrl = homeResolvedUrl;

    const host = safeHost(finalHomeUrl) || safeHost(row.site);
    const origin = safeOrigin(finalHomeUrl) || safeOrigin(row.site);

    // [req 3] robots.txt -- 1회만 fetch 하고 이후(Nara 판정 + robots path 판정)
    // 재사용한다(신규 위치, §F step 6).
    let robotsBody = "";
    let robotsStatus = null;
    let robotsError = null;
    let robotsFinalUrl = `${origin}/robots.txt`;
    try {
      const response = await gate.fetch(`${origin}/robots.txt`, { headers: { Accept: "text/plain,*/*" } });
      robotsStatus = response.status;
      robotsFinalUrl = response.url || robotsFinalUrl;
      robotsBody = await response.text();
    } catch (error) {
      base.requestCount = gate.count;
      if (isGateBudgetError(error)) return done(budgetErrorPatch(error, { homeResolvedUrl }));
      robotsError = error;
    }
    const robotsClass = classifyRobotsFetchResult({
      status: robotsStatus,
      finalUrl: robotsFinalUrl,
      error: robotsError,
      body: robotsBody,
    });
    const robotsGroups = parseRobotsGroups(robotsBody);
    const robotsSitemapUrls = extractRobotsSitemapUrls(robotsBody);

    // [req 4] `{origin}/xmlSite/siteMap.do` -- 실패/404 면 null(시그널 B
    // 미매칭, §B 게시판 후보는 nav 폴백).
    let sitemapHtml = null;
    try {
      const response = await gate.fetch(`${origin}/xmlSite/siteMap.do`);
      if (response && response.ok) {
        const body = await response.text();
        if (body) sitemapHtml = body;
      }
    } catch (error) {
      base.requestCount = gate.count;
      if (isGateBudgetError(error)) return done(budgetErrorPatch(error, { homeResolvedUrl }));
      // 비-예산 에러는 sitemap 미확보로 취급하고 nav 폴백으로 계속 진행한다.
    }

    // [req 5] 다중 시그널 Nara 판정(§A).
    const detection = detectNaraCms(homeHtml, { host, robotsSitemapUrls, sitemapHtml });
    base.detectionSignals = { isNara: detection.isNara, evidence: detection.evidence, signals: detection.signals };
    if (!detection.isNara) {
      return done({
        finalDecision: "NOT_NARA_CMS",
        reason: "no_nara_pattern",
        requestCount: gate.count,
        homeResolvedUrl,
      });
    }

    // [req 6] 게시판 후보 -- sitemap 우선, nav 폴백(§B).
    let boardCandidates = [];
    if (sitemapHtml) {
      const entries = extractSitemapMenuEntries(sitemapHtml)
        .map((e) => ({ ...e, category: classifyBoardCategory(e.text) }))
        .filter((e) => e.category);
      boardCandidates = prioritizeBoardCandidates(entries)
        .slice(0, MAX_BOARD_CANDIDATES)
        .map((e) => ({
          site: e.site,
          menuId: e.menuId,
          category: e.category,
          linkText: e.text,
          subviewUrl: absoluteUrl(e.href, origin),
          directBoardId: null,
        }));
      if (boardCandidates.length) base.boardSource = "sitemap";
    }
    if (!boardCandidates.length) {
      boardCandidates = extractNavBoardLinks(homeHtml)
        .slice(0, MAX_BOARD_CANDIDATES)
        .map((link) => {
          const direct = extractSiteAndBoardId(link.href, { host });
          return {
            site: direct ? direct.site : null,
            menuId: null,
            category: classifyBoardCategory(link.text),
            linkText: link.text,
            subviewUrl: absoluteUrl(link.href, origin),
            directBoardId: direct ? direct.boardId : null,
          };
        })
        .filter((c) => c.category);
      if (boardCandidates.length) base.boardSource = "nav";
    }
    if (!boardCandidates.length) {
      return done({
        finalDecision: "DIAGNOSE_FAILED",
        reason: "no_board_found",
        requestCount: gate.count,
        homeResolvedUrl,
      });
    }

    // [req 7] 후보별 실제 검증(rss-collector 재사용) 후 첫 통과 후보 채택(§C).
    let selection;
    try {
      selection = await selectValidatedBoard({
        candidates: boardCandidates,
        university,
        host,
        origin,
        gate,
        rssCollectorImpl,
      });
    } catch (error) {
      base.requestCount = gate.count;
      if (isGateBudgetError(error)) return done(budgetErrorPatch(error, { homeResolvedUrl }));
      throw error;
    }
    if (!selection.board) {
      return done({
        finalDecision: "DIAGNOSE_FAILED",
        reason: `no_valid_board_found tried=${selection.triedCount} [${selection.failures
          .map((f) => f.reason)
          .join(",")}]`,
        requestCount: gate.count,
        homeResolvedUrl,
      });
    }
    const best = selection.board;
    base.site = best.site;
    base.boardId = best.boardId;
    base.category = best.category;

    // [req 8] robots path 판정 -- 확정된 site/boardId 로, 캐시된 robotsGroups
    // 재사용(재fetch 없음, §F step 11).
    const robotsPaths = [
      "/bbs/",
      `/bbs/${best.site}/`,
      `/bbs/${best.site}/${best.boardId}/`,
      `/bbs/${best.site}/${best.boardId}/{n}/artclView.do`,
    ];
    const robotsVerdict = evaluateRobots({ ...robotsClass, groups: robotsGroups }, { paths: robotsPaths });
    base.robots = robotsVerdict;
    if (robotsVerdict.verdict === "ROBOTS_BLOCKED") {
      return done({
        finalDecision: "ROBOTS_BLOCKED",
        reason: robotsVerdict.reason,
        requestCount: gate.count,
        homeResolvedUrl,
      });
    }

    // candidate source (memory only)
    const shortName = deriveShortName(row.id, host, catalogSourceIds(catalog));
    const source = buildCandidateSource({
      host,
      site: best.site,
      boardId: best.boardId,
      category: best.category,
      categoryLabel: best.categoryLabel,
      shortName,
      subviewUrl: best.sourceUrl,
      universityName: university.universityName,
    });
    base.rssUrl = source.rssUrl;

    // [req 9] in-memory preflight (no catalog writes) -- 이미 검증된 rssResult
    // 재사용(§D, rssList.do 재조회 방지).
    const preflight = await runPreflight({
      university,
      source,
      limit: 3,
      fetchGate: gate,
      rssCollectorImpl,
      minAccepted,
      prefetchedRssResult: selection.rssResult,
    });
    base.preflight = {
      acceptedCount: preflight.acceptedCount,
      storableCount: preflight.storableItems.length,
      triedDateSelectors: preflight.triedDateSelectors,
    };
    base.usedDateSelector = preflight.usedDateSelector;
    if (!preflight.ok) {
      return done({
        finalDecision: "DIAGNOSE_FAILED",
        reason: preflight.reason,
        requestCount: gate.count,
        homeResolvedUrl,
      });
    }
    if (preflight.usedDateSelector && preflight.usedDateSelector !== source.detailSelectors.date) {
      source.detailSelectors.date = preflight.usedDateSelector;
    }

    if (dryRun) {
      return done({
        finalDecision: "PACKET_CREATED_DRYRUN",
        reason: "dry_run_no_writes",
        requestCount: gate.count,
      });
    }

    // -- real writes: candidates append -> B1 -> B2 --
    appendCandidateAtomic(
      candidatesFile,
      buildCandidateEntry({
        university,
        source,
        boardId: best.boardId,
        discoveredAt: now().toISOString().slice(0, 10),
      }),
      candidateFsImpls
    );

    let b1Result;
    try {
      b1Result = await b1Impl({ universityId: row.id, sourceId: source.id, dryRun: false, now });
      base.b1 = { status: b1Result && b1Result.status };
    } catch (error) {
      const message = String((error && error.message) || error);
      if (/already exists/.test(message)) {
        return done({
          finalDecision: "SOURCE_ALREADY_EXISTS",
          reason: "b1_duplicate",
          error: message,
          requestCount: gate.count,
        });
      }
      if (/university block not found/.test(message)) {
        return done({
          finalDecision: "BLOCK_MISSING",
          reason: "b1_block_missing",
          error: message,
          requestCount: gate.count,
        });
      }
      return done({ finalDecision: "ERROR", reason: "b1_failed", error: message, requestCount: gate.count });
    }

    const b2Result = await b2Impl({
      universityId: row.id,
      sourceId: source.id,
      limit: 3,
      minAccepted,
      skipNpmTest: true,
      regressionEvidence,
      now,
      randomBytesImpl,
    });

    if (b2Result && b2Result.status === "PACKET_CREATED") {
      return done({
        finalDecision: "PACKET_CREATED",
        reviewId: b2Result.reviewId,
        writtenPath: b2Result.writtenPath,
        requestCount: gate.count,
      });
    }
    return done({
      finalDecision: "DIAGNOSE_FAILED_POST_B1",
      reason: "b2_diagnose_failed",
      b2Reasons: (b2Result && b2Result.evaluation && b2Result.evaluation.reasons) || [],
      requestCount: gate.count,
    });
  } catch (error) {
    return done({
      finalDecision: "ERROR",
      reason: "unexpected",
      error: String((error && error.message) || error),
      requestCount: gate.count,
    });
  }
}

// -- 30. runBatch ------------------------------------------------------------

async function runBatch(options = {}) {
  const {
    limit = 10,
    universityId = null,
    resume = false,
    retryDecisions = null,
    dryRun = false,
    auditFile = DEFAULT_AUDIT_FILE,
    catalogFile = DEFAULT_CATALOG_FILE,
    candidatesFile = DEFAULT_CANDIDATE_FILE,
    stateFile = DEFAULT_STATE_FILE,
    reportDir = DEFAULT_REPORT_DIR,
    runId: runIdInput = null,
    minAccepted = 2,
    now = () => new Date(),
    randomBytesImpl,
    sleepImpl,
    fetchImpl = typeof fetch === "function" ? fetch : undefined,
    rssCollectorImpl = rssCollector,
    b1Impl: b1Input,
    b2Impl: b2Input,
    npmTestImpl,
    regressionEvidence: regressionEvidenceInput = null,
    readFileImpl = fs.readFileSync,
    writeFileImpl = fs.writeFileSync,
    renameImpl = fs.renameSync,
    copyFileImpl = fs.copyFileSync,
    existsImpl = fs.existsSync,
    mkdirImpl = fs.mkdirSync,
  } = options;

  const startedAt = now().toISOString();
  const runId = runIdInput || compactStamp(now());

  const auditRows = JSON.parse(readFileImpl(auditFile || DEFAULT_AUDIT_FILE, "utf8"));
  const catalog = JSON.parse(readFileImpl(catalogFile, "utf8"));
  const stateData = loadState(stateFile, readFileImpl, existsImpl);

  const { selected, preSkipped } = selectCandidates(auditRows, catalog, stateData, {
    limit,
    universityId,
    resume,
    retryDecisions,
  });

  // Regression evidence is collected once, and only when a write is possible
  // (not a dry run) and at least one university will actually be processed.
  let regressionEvidence = regressionEvidenceInput || null;
  if (!dryRun && !regressionEvidence && selected.length) {
    regressionEvidence = collectRegressionEvidence({ npmTestImpl, now });
    if (/\bfail\s+[1-9]/.test(regressionEvidence.npmTestSummary || "")) {
      throw new Error(
        `runBatch: regression npm test reported failures -- aborting before any candidates/B1/B2. summary: ${regressionEvidence.npmTestSummary}`
      );
    }
  }

  const b1Impl =
    b1Input ||
    ((args) => prepareCatalogSourceBlock({ ...args, catalogFile, candidateFile: candidatesFile }));
  const b2Impl = b2Input || ((args) => buildReviewPacketFromDiagnose({ ...args, catalogFile }));

  const fetchGateFactory = () => createFetchGate({ fetchImpl, now, sleepImpl });

  const candidateFsImpls = {
    readFileImpl,
    writeFileImpl,
    renameImpl,
    copyFileImpl,
    existsImpl,
    mkdirImpl,
  };

  const results = [...preSkipped];
  for (const row of selected) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processUniversity(row, {
      catalog,
      candidatesFile,
      fetchGateFactory,
      rssCollectorImpl,
      b1Impl,
      b2Impl,
      regressionEvidence,
      now,
      randomBytesImpl,
      dryRun,
      minAccepted,
      runId,
      candidateFsImpls,
    });
    results.push(result);

    if (
      !dryRun &&
      (result.finalDecision === "PACKET_CREATED" || result.finalDecision === "DIAGNOSE_FAILED_POST_B1")
    ) {
      try {
        const fresh = JSON.parse(readFileImpl(catalogFile, "utf8"));
        if (fresh && Array.isArray(fresh.universities)) catalog.universities = fresh.universities;
      } catch {
        /* keep in-memory catalog */
      }
    }
  }

  const summary = aggregateSummary(results);
  const finishedAt = now().toISOString();
  const report = buildReport({
    runId,
    startedAt,
    finishedAt,
    options: { limit, universityId, resume, dryRun, retryDecisions },
    results,
    summary,
    regressionEvidence,
  });

  mkdirImpl(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${runId}.json`);
  writeFileImpl(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const nextState = mergeState(stateData, results, now);
  writeStateAtomic(stateFile, nextState, candidateFsImpls);

  // eslint-disable-next-line no-console
  console.log(
    `[nara-cms-batch] runId=${runId} processed=${summary.processed} packets=${summary.packetsCreated} ` +
      `NOT_NARA=${summary.notNaraCms} ROBOTS_BLOCKED=${summary.robotsBlocked} DIAGNOSE_FAILED=${summary.diagnoseFailed}`
  );

  return { report, summary, statePath: stateFile, reportPath };
}

// -- 31. main -------------------------------------------------------------------

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ status: "REJECTED", code: "INVALID_ARGS", reasons: [error.message] }));
    process.exitCode = 1;
    return;
  }
  try {
    await runBatch({
      limit: options.limit,
      universityId: options.universityId,
      resume: options.resume,
      dryRun: options.dryRun,
      auditFile: options.auditFile || DEFAULT_AUDIT_FILE,
      runId: options.runId || null,
      minAccepted: options.minAccepted,
      retryDecisions: options.retryDecisions,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ status: "ERROR", reasons: [String((error && error.message) || error)] }));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_AUDIT_FILE,
  DEFAULT_CATALOG_FILE,
  DEFAULT_CANDIDATE_FILE,
  DEFAULT_STATE_FILE,
  DEFAULT_REPORT_DIR,
  NEWS_NAV_KEYWORDS,
  DATE_SELECTOR_FALLBACKS,
  MAX_BOARD_CANDIDATES,
  parseCliArgs,
  matchesCandidateFilter,
  isVariantCampus,
  findCatalogUniversity,
  universityHasCatalogSource,
  selectCandidates,
  extractClientRedirect,
  extractRobotsSitemapUrls,
  robotsSignalIndicatesNara,
  sitemapSignalIndicatesNara,
  detectNaraCms,
  extractNavBoardLinks,
  classifyBoardCategory,
  extractSitemapMenuEntries,
  prioritizeBoardCandidates,
  pickBestBoard,
  extractSiteAndBoardId,
  selectValidatedBoard,
  buildCandidateSource,
  deriveShortName,
  verifyRssFeed,
  checkRobotsPathDisallow,
  evaluateRobots,
  runPreflight,
  resolveDateSelector,
  buildCandidateEntry,
  appendCandidateAtomic,
  candidateFileHasReady,
  aggregateSummary,
  buildReport,
  loadState,
  mergeState,
  writeStateAtomic,
  createFetchGate,
  isGateBudgetError,
  processUniversity,
  runBatch,
  main,
};
