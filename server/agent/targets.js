"use strict";

/**
 * 대상 대학 자동 판정
 *
 * university-news-sources.final.json 에서
 * verified=true 이고 enabled=true 인 소스를 1개 이상 가진 대학만 수집 대상으로 판정합니다.
 * 현재 약 50개 대학이 대상입니다.
 */

const fs = require("fs");
const path = require("path");

// 최종 소스 파일 위치 (development 폴더 안의 검증된 소스 목록)
const SOURCES_FILE = path.resolve(
  __dirname,
  "../../development/university-news/data/university-news-sources.final.json"
);

/**
 * 소스 1개가 수집 대상이 될 수 있는지 판정합니다.
 * 조건: verified=true 이고 enabled=true 이며, 방식별 필수 필드가 채워진 경우
 *   - html: listUrl, selectors.item, selectors.title, selectors.link
 *   - rss: rssUrl
 * @param {object} src
 * @returns {boolean}
 */
function isSourceCollectible(src) {
  if (!src.verified || src.enabled !== true) return false;
  if (src.collectionType === "html") {
    // HTML 수집: item, title, link 선택자 모두 필요
    const s = src.selectors || {};
    return Boolean(src.listUrl && s.item && s.title && s.link);
  }
  if (src.collectionType === "rss") {
    return Boolean(src.rssUrl);
  }
  return false;
}

/**
 * 수집 대상 대학 목록을 반환합니다.
 * 조건: 소스 중 하나라도 verified=true 이고 enabled=true 이며 selectors(또는 rssUrl)가 채워진 경우
 */
function getTargetUniversities() {
  if (!fs.existsSync(SOURCES_FILE)) {
    console.warn("[agent/targets] 소스 파일을 찾을 수 없습니다:", SOURCES_FILE);
    return [];
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  } catch (error) {
    console.error("[agent/targets] 소스 파일 읽기 실패:", error.message);
    return [];
  }

  const universities = Array.isArray(data.universities) ? data.universities : [];
  const targets = [];

  for (const uni of universities) {
    const sources = Array.isArray(uni.sources) ? uni.sources : [];

    // verified=true 이고 enabled=true 이며 selector(또는 rssUrl)가 채워진 소스만 활성화
    const activeSources = sources.filter(isSourceCollectible);

    if (activeSources.length === 0) continue;

    targets.push({
      universityId: uni.universityId,
      universityGroupId: uni.universityGroupId || uni.universityId,
      universityName: uni.universityName,
      campusName: uni.campusName || "",
      sources: activeSources,
    });
  }

  return targets;
}

module.exports = { getTargetUniversities, isSourceCollectible };
