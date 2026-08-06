"use strict";
const { isValidUniversityNewsCategory } = require("../constants/news-categories");
const { COLLECTION_TYPES, SOURCE_STATUSES } = require("../models/university-news-source");
const { isValidHttpUrl } = require("./validate-news-item");
function validateUniversityNewsSource(sourceConfig) {
  const errors = [], warnings = [];
  if (!sourceConfig || typeof sourceConfig !== "object" || Array.isArray(sourceConfig)) return { valid: false, errors: ["출처 설정은 객체여야 합니다."], warnings };
  if (typeof sourceConfig.universityId !== "string" || !sourceConfig.universityId.trim()) errors.push("universityId 값이 필요합니다.");
  if (!Array.isArray(sourceConfig.sources)) return { valid: false, errors: [...errors, "sources는 배열이어야 합니다."], warnings };
  sourceConfig.sources.forEach((source, index) => {
    const prefix = `sources[${index}]`;
    if (!source || typeof source !== "object") { errors.push(`${prefix}는 객체여야 합니다.`); return; }
    if (!isValidUniversityNewsCategory(source.category)) errors.push(`${prefix}.category 값이 올바르지 않습니다.`);
    if (!COLLECTION_TYPES.includes(source.collectionType)) errors.push(`${prefix}.collectionType 값이 올바르지 않습니다.`);
    if (!SOURCE_STATUSES.includes(source.status)) errors.push(`${prefix}.status 값이 올바르지 않습니다.`);
    const urls = [source.listUrl, source.rssUrl, source.baseUrl].filter(Boolean);
    if (urls.some((url) => !isValidHttpUrl(url))) errors.push(`${prefix} URL 형식이 올바르지 않습니다.`);
    if (source.enabled === true && urls.length === 0) errors.push(`${prefix}는 enabled=true일 때 실제 URL이 필요합니다.`);
    if (source.enabled !== true && urls.length === 0) warnings.push(`${prefix}는 비활성화된 예시 출처입니다.`);
    if (source.enabled === true && source.verified !== true) warnings.push(`${prefix}는 활성화되어 있지만 검증되지 않았습니다.`);
  });
  if (sourceConfig.enabled === true) warnings.push("1단계에서는 최상위 enabled 값을 false로 유지해야 합니다.");
  return { valid: errors.length === 0, errors, warnings };
}
module.exports = { validateUniversityNewsSource };
