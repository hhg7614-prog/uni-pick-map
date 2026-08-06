"use strict";

const NEWS_CATEGORY_LABELS = Object.freeze({
  school_news: "학교 소식",
  school_notice: "학교 공지사항",
  media_news: "뉴스 기사",
  school_event: "행사 소식",
});

function isValidNewsCategory(category) {
  return Object.hasOwn(NEWS_CATEGORY_LABELS, category);
}

function normalizeNewsCategory(category) {
  return category === "all" || category == null || category === "" ? "all" : (isValidNewsCategory(category) ? category : null);
}

function getNewsCategoryLabel(category) {
  return NEWS_CATEGORY_LABELS[category] || "기타";
}

module.exports = { NEWS_CATEGORY_LABELS, isValidNewsCategory, normalizeNewsCategory, getNewsCategoryLabel };
