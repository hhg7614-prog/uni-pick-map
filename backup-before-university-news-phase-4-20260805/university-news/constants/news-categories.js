"use strict";

/** 개발 단계에서만 사용하는 대학 소식 분류입니다. 현재 웹 화면에서는 불러오지 않습니다. */
const UNIVERSITY_NEWS_CATEGORIES = Object.freeze({
  SCHOOL_NEWS: "school_news",
  SCHOOL_NOTICE: "school_notice",
  MEDIA_NEWS: "media_news",
  SCHOOL_EVENT: "school_event"
});
const UNIVERSITY_NEWS_CATEGORY_LABELS = Object.freeze({
  school_news: "학교 소식",
  school_notice: "학교 공지사항",
  media_news: "뉴스 기사",
  school_event: "행사 소식"
});
const UNIVERSITY_NEWS_CATEGORY_VALUES = Object.freeze(Object.values(UNIVERSITY_NEWS_CATEGORIES));
function isValidUniversityNewsCategory(category) { return UNIVERSITY_NEWS_CATEGORY_VALUES.includes(category); }
function getUniversityNewsCategoryLabel(category) { return UNIVERSITY_NEWS_CATEGORY_LABELS[category] || ""; }
module.exports = { UNIVERSITY_NEWS_CATEGORIES, UNIVERSITY_NEWS_CATEGORY_LABELS, UNIVERSITY_NEWS_CATEGORY_VALUES, isValidUniversityNewsCategory, getUniversityNewsCategoryLabel };
