"use strict";

/**
 * 중복 방지 (Deduplication)
 *
 * urlHash 또는 contentHash 가 이미 저장소에 있는 항목인지 확인합니다.
 * 중복된 항목은 저장하지 않습니다.
 */

const { createUrlHash, createContentHash } = require(
  "../../development/university-news/utils/create-hash"
);
const { normalizeUrl } = require(
  "../../development/university-news/utils/normalize-url"
);
const { normalizeTitle } = require(
  "../../development/university-news/utils/normalize-title"
);

/**
 * 기존 저장된 항목들을 빠르게 조회할 수 있는 Set 을 만듭니다.
 * @param {Array} existingItems - 저장소에 이미 있는 항목 배열
 */
function buildDedupSets(existingItems) {
  const urlHashes = new Set();
  const contentHashes = new Set();

  for (const item of existingItems) {
    if (item.urlHash) urlHashes.add(item.urlHash);
    if (item.contentHash) contentHashes.add(item.contentHash);

    // 기존에 normalizedSourceUrl 로 저장된 경우도 커버
    if (item.sourceUrl) {
      const hash = createUrlHash(item.sourceUrl);
      if (hash) urlHashes.add(hash);
    }
  }

  return { urlHashes, contentHashes };
}

/**
 * 수집된 항목이 중복인지 확인합니다.
 * @param {object} item - 수집된 뉴스 항목
 * @param {object} dedupSets - buildDedupSets() 가 반환한 Set 쌍
 * @returns {{ isDuplicate: boolean, reason: string|null }}
 */
function isDuplicate(item, dedupSets) {
  const { urlHashes, contentHashes } = dedupSets;

  // URL 해시로 먼저 확인 (가장 확실한 방법)
  const urlHash = createUrlHash(item.sourceUrl);
  if (urlHash && urlHashes.has(urlHash)) {
    return { isDuplicate: true, reason: "url_hash" };
  }

  // 콘텐츠 해시로 확인 (URL이 달라도 같은 내용이면 중복)
  const normalizedTitleValue = normalizeTitle(item.title);
  const datePart = item.publishedAt
    ? String(item.publishedAt).slice(0, 10)
    : String(item.sourceName || "").trim();
  const key = [
    item.universityGroupId || item.universityId || "",
    item.category || "",
    normalizedTitleValue,
    datePart,
  ].join("|");

  const { createHash } = require("crypto");
  const contentHash = createHash("sha256")
    .update(key, "utf8")
    .digest("hex");

  if (contentHashes.has(contentHash)) {
    return { isDuplicate: true, reason: "content_hash" };
  }

  return { isDuplicate: false, reason: null };
}

/**
 * 수집된 항목 중 신규 항목만 걸러냅니다.
 * @param {Array} collectedItems - 수집된 항목 배열
 * @param {Array} existingItems - 이미 저장된 항목 배열
 * @returns {{ newItems: Array, duplicateCount: number }}
 */
function filterNewItems(collectedItems, existingItems) {
  const dedupSets = buildDedupSets(existingItems);
  const newItems = [];
  let duplicateCount = 0;

  for (const item of collectedItems) {
    const result = isDuplicate(item, dedupSets);
    if (result.isDuplicate) {
      duplicateCount++;
    } else {
      newItems.push(item);
      // 새로 추가한 항목도 즉시 Set 에 등록해서 같은 실행 내 중복을 방지
      const urlHash = createUrlHash(item.sourceUrl);
      if (urlHash) dedupSets.urlHashes.add(urlHash);
    }
  }

  return { newItems, duplicateCount };
}

module.exports = { buildDedupSets, isDuplicate, filterNewItems };
