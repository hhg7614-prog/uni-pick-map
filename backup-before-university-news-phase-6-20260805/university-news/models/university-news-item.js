"use strict";
const { UNIVERSITY_NEWS_CATEGORIES, getUniversityNewsCategoryLabel } = require("../constants/news-categories");
const UNIVERSITY_NEWS_SOURCE_TYPES = Object.freeze(["official", "media"]);
const UNIVERSITY_NEWS_STATUSES = Object.freeze(["pending", "collected", "processed", "ignored", "failed"]);
/** 수집기가 나중에 만들 소식 항목의 기본 형태입니다. 네트워크 요청은 하지 않습니다. */
function createUniversityNewsItem(values = {}) {
  const category = values.category || UNIVERSITY_NEWS_CATEGORIES.SCHOOL_NEWS;
  return { id: values.id || "", universityId: values.universityId || "", universityGroupId: values.universityGroupId || "", universityName: values.universityName || "", campusName: values.campusName || "", category, categoryLabel: values.categoryLabel || getUniversityNewsCategoryLabel(category), title: values.title || "", summary: values.summary || "", contentText: values.contentText || "", sourceName: values.sourceName || "", sourceType: values.sourceType || "official", sourceUrl: values.sourceUrl || "", sourceSiteUrl: values.sourceSiteUrl || "", thumbnailUrl: values.thumbnailUrl || "", publishedAt: values.publishedAt ?? null, collectedAt: values.collectedAt ?? null, processedAt: values.processedAt ?? null, urlHash: values.urlHash || "", contentHash: values.contentHash || "", isImportant: values.isImportant ?? null, keywords: Array.isArray(values.keywords) ? values.keywords : [], aiProcessed: false, status: values.status || "pending", errorMessage: values.errorMessage ?? null };
}
module.exports = { UNIVERSITY_NEWS_SOURCE_TYPES, UNIVERSITY_NEWS_STATUSES, createUniversityNewsItem };
