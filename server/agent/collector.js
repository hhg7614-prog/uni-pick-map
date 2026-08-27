"use strict";

/**
 * 수집 수행 + 상세 링크 검증
 *
 * development/university-news 의 HTML/RSS 수집기를 재사용합니다.
 * 홈페이지 목록 URL과 동일한 링크는 상세 링크로 인정하지 않고 제외합니다.
 */

const { htmlListCollector, findBySelector, textOf, cleanTitle } = require(
  "../../development/university-news/collectors/html-list-collector"
);
const { rssCollector } = require(
  "../../development/university-news/collectors/rss-collector"
);
const { normalizeUrl } = require(
  "../../development/university-news/utils/normalize-url"
);
const { imageFromArticle } = require("./article-image");
const { emblemForUniversityId } = require("./university-directory");
const { parseDate } = require("../../development/university-news/utils/parse-date");

const EXTERNAL_NEWS_HOSTS = new Set([
  "youtube.com", "youtu.be", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com",
]);

function normalizedText(value) {
  return String(value || "")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]*>/g, " ")
    // Some boards render an invisible character (zero-width space/joiner or a
    // BOM) inside the detail-page title but not the list-page title, which
    // would otherwise make an identical title compare as a mismatch.
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isExternalNewsUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
    return EXTERNAL_NEWS_HOSTS.has(host);
  } catch {
    return false;
  }
}

function officialDetailDate(html, item, source) {
  const selectors = source.detailSelectors || {};
  if (!selectors.title || !selectors.date) return null;
  const detailTitle = cleanTitle(textOf(findBySelector(html, selectors.title)[0]), source.titleCleanupTokens);
  if (!detailTitle || normalizedText(detailTitle) !== normalizedText(item.title)) return null;
  for (const rawDate of findBySelector(html, selectors.date).map(textOf)) {
    const parsed = parseDate(rawDate, source.datePolicy || {});
    if (parsed.value) return { value: parsed.value, rawDate };
  }
  return null;
}

/**
 * 수집된 항목의 sourceUrl 이 목록 페이지 URL과 동일한지 확인합니다.
 * 동일하면 상세 링크가 아닌 홈페이지/목록 링크이므로 제외합니다.
 *
 * @param {string} sourceUrl - 수집된 뉴스 원문 URL
 * @param {string} listUrl   - 목록 페이지 URL
 * @returns {boolean} true 이면 목록 링크로 판단 → 제외
 */
function isListUrl(sourceUrl, listUrl) {
  if (!sourceUrl || !listUrl) return false;
  const norm1 = normalizeUrl(sourceUrl);
  const norm2 = normalizeUrl(listUrl);
  if (!norm1 || !norm2) return false;

  // 완전 일치
  if (norm1 === norm2) return true;

  // 쿼리스트링만 다른 경우 (예: ?page=1 이 붙은 목록 URL)
  try {
    const url1 = new URL(norm1);
    const url2 = new URL(norm2);
    const path1 = url1.origin + url1.pathname;
    const path2 = url2.origin + url2.pathname;
    // 경로가 같아도, 목록 URL에는 없는 새 쿼리 파라미터(mode=view, board_seq 등)로
    // 상세글을 구분하는 게시판이 많으므로 그런 새 파라미터가 있으면 상세 링크로 인정합니다.
    if (path1 === path2) {
      const listKeys = new Set(url2.searchParams.keys());
      const hasDistinguishingParam = [...url1.searchParams.keys()].some((key) => !listKeys.has(key));
      if (!hasDistinguishingParam) return true;
    }
  } catch {
    // URL 파싱 실패 시 무시
  }
  return false;
}

/**
 * 1개 소스에서 뉴스를 수집합니다.
 * @param {object} university - 대학 정보
 * @param {object} source     - 소스 정보
 * @param {number} limit      - 최대 수집 건수
 * @returns {Promise<{ items: Array, warnings: Array, error: string|null }>}
 */
async function collectFromSource(university, source, limit = 5) {
  const collectedAt = new Date().toISOString();
  let result;

  try {
    if (source.collectionType === "rss") {
      result = await rssCollector({ university, source, limit, collectedAt });
    } else {
      // 기본: html
      result = await htmlListCollector({ university, source, limit, collectedAt });
    }
  } catch (error) {
    return {
      items: [],
      warnings: [],
      error: `수집 오류: ${error.message}`,
    };
  }

  if (!result || result.status === "skipped" || result.status === "selector_required") {
    return {
      items: [],
      warnings: result ? result.warnings : [],
      error: result ? null : "수집기가 응답하지 않았습니다.",
    };
  }

  // 목록 링크와 동일한 항목 필터링
  const listUrl = source.listUrl || source.rssUrl || "";
  const validItems = [];
  const warnings = [...(result.warnings || [])];

  for (const item of result.items || []) {
    if (isListUrl(item.sourceUrl, listUrl)) {
      warnings.push(
        `목록 URL과 동일한 링크 제외: ${item.title} (${item.sourceUrl})`
      );
      continue;
    }
    if (isExternalNewsUrl(item.sourceUrl)) {
      warnings.push(`INVALID_EXTERNAL_NEWS: ${item.title} (${item.sourceUrl})`);
      continue;
    }
    // id 접두어를 agent 전용으로 변경
    item.id = `agent-${item.urlHash ? item.urlHash.slice(0, 16) : Date.now()}`;
    item.isSampleCollection = false;
    item.imageUrl = null;
    item.imageSource = null;
    try {
      const detail = await fetch(item.sourceUrl, { headers: { "User-Agent": "UNI-PICK-University-News-Research/0.1", Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
      if (detail.ok && /^https?:\/\//i.test(detail.url)) {
        const html = await detail.text();
        if (!item.publishedAt) {
          const recovered = officialDetailDate(html, item, source);
          if (recovered) {
            item.publishedAt = recovered.value;
            item.dateSource = "detail_visible_date";
            item.detailDateRaw = recovered.rawDate;
          }
        }
        Object.assign(item, imageFromArticle(html, detail.url));
      }
    } catch { /* Image is optional; keep the verified news item. */ }
    if (!item.imageUrl) {
      // 2순위: 본문에서 이미지를 못 찾았으면 학교 공식 엠블럼으로 대체합니다.
      const fallbackLogo = emblemForUniversityId(university.universityId);
      if (fallbackLogo) {
        item.imageUrl = fallbackLogo;
        item.imageSource = "university-logo-fallback";
      }
    }
    validItems.push(item);
  }

  return { items: validItems, warnings, error: null };
}

/**
 * 대학 1개의 모든 소스에서 수집합니다.
 */
async function collectForUniversity(university, limitPerSource = 5) {
  const allItems = [];
  const allWarnings = [];
  const sourceResults = [];

  for (const source of university.sources) {
    const result = await collectFromSource(university, source, limitPerSource);
    allItems.push(...result.items);
    allWarnings.push(...result.warnings);
    sourceResults.push({
      sourceId: source.id,
      sourceName: source.name,
      collectedCount: result.items.length,
      error: result.error,
      warnings: result.warnings,
    });
  }

  return { items: allItems, warnings: allWarnings, sourceResults };
}

module.exports = { collectFromSource, collectForUniversity, isListUrl, isExternalNewsUrl, officialDetailDate };
