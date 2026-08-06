"use strict";
const COLLECTION_TYPES = Object.freeze(["rss", "html", "api", "playwright", "news_api"]);
const SOURCE_STATUSES = Object.freeze(["pending", "verified", "unreachable", "unsupported", "requires_playwright", "disabled"]);
/** 개발용 수집 출처 설정의 기본 형태입니다. 기본값은 항상 비활성화입니다. */
function createUniversityNewsSourceConfig(values = {}) {
  return { universityId: values.universityId || "", universityGroupId: values.universityGroupId || "", universityName: values.universityName || "", campusName: values.campusName || "", enabled: false, sources: Array.isArray(values.sources) ? values.sources : [], searchKeywords: Array.isArray(values.searchKeywords) ? values.searchKeywords : [], createdAt: values.createdAt ?? null, updatedAt: values.updatedAt ?? null };
}
module.exports = { COLLECTION_TYPES, SOURCE_STATUSES, createUniversityNewsSourceConfig };
