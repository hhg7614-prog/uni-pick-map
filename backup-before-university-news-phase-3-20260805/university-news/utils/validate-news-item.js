"use strict";
const { isValidUniversityNewsCategory } = require("../constants/news-categories");
const { UNIVERSITY_NEWS_SOURCE_TYPES, UNIVERSITY_NEWS_STATUSES } = require("../models/university-news-item");
function isValidDate(value) { return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value))); }
function isValidHttpUrl(value) { if (typeof value !== "string" || !value) return false; try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function validateUniversityNewsItem(item) {
  const errors = [], warnings = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) return { valid: false, errors: ["소식 항목은 객체여야 합니다."], warnings };
  ["id", "universityId", "title", "sourceName"].forEach((field) => { if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${field} 값이 필요합니다.`); });
  if (!isValidUniversityNewsCategory(item.category)) errors.push("허용되지 않은 category 값입니다.");
  if (!UNIVERSITY_NEWS_SOURCE_TYPES.includes(item.sourceType)) errors.push("허용되지 않은 sourceType 값입니다.");
  if (!UNIVERSITY_NEWS_STATUSES.includes(item.status)) errors.push("허용되지 않은 status 값입니다.");
  ["publishedAt", "collectedAt", "processedAt"].forEach((field) => { if (!isValidDate(item[field])) errors.push(`${field} 날짜 형식이 올바르지 않습니다.`); });
  ["sourceUrl", "sourceSiteUrl", "thumbnailUrl"].forEach((field) => { if (item[field] && !isValidHttpUrl(item[field])) errors.push(`${field} URL 형식이 올바르지 않습니다.`); });
  if (!item.sourceUrl) warnings.push("sourceUrl이 비어 있습니다. 실제 수집 전에는 원문 주소가 필요합니다.");
  if (item.aiProcessed !== false) warnings.push("1단계에서는 aiProcessed가 false여야 합니다.");
  return { valid: errors.length === 0, errors, warnings };
}
module.exports = { validateUniversityNewsItem, isValidDate, isValidHttpUrl };
