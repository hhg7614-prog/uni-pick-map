"use strict";

const CATEGORY_LABELS = { school_news: "학교 소식", school_notice: "학교 공지사항", media_news: "뉴스 기사", school_event: "행사 소식" };
function clip(value, length) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, length); }
function buildAiInput(item) {
  const parts = [clip(item.title, 300), clip(item.summary, 1000), clip(item.contentText, 5000)].filter(Boolean);
  return {
    universityName: clip(item.universityName, 120), campusName: clip(item.campusName, 120),
    originalCategory: item.category, title: clip(item.title, 300), summary: clip(item.summary, 1000),
    contentText: clip(item.contentText, 5000), sourceName: clip(item.sourceName, 160), publishedAt: item.publishedAt || null,
    inputText: clip(parts.join("\n"), 7000)
  };
}
function buildPrompt(input) {
  return `당신은 대학 공식 소식 편집 보조자입니다. 제공된 내용에 없는 사실, 날짜, 장소, URL, 숫자를 만들지 마세요. JSON 객체만 반환하세요. category는 school_news, school_notice, media_news, school_event 중 하나입니다. summary는 한국어 2~3문장, keywords는 중복 없는 핵심 명사 3~5개, confidence는 0~1입니다.\n입력: ${JSON.stringify(input)}`;
}
module.exports = { CATEGORY_LABELS, buildAiInput, buildPrompt, clip };
