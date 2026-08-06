"use strict";
const { CATEGORY_LABELS } = require("./build-ai-prompt");
function includes(text, words) { return words.some((word) => text.includes(word)); }
function createMockProvider() {
  return { name: "mock", model: "rule-based-test", async process(input) {
    const text = `${input.title} ${input.summary} ${input.contentText}`.toLowerCase();
    let category = input.originalCategory || "school_news";
    if (includes(text, ["행사", "세미나", "특강", "축제", "공연", "전시", "경진대회", "설명회"])) category = "school_event";
    else if (includes(text, ["공지", "안내", "신청", "모집", "접수", "학사", "등록"])) category = "school_notice";
    else if (includes(text, ["연구", "수상", "성과", "보도", "개발"])) category = "school_news";
    const important = includes(text, ["모집", "신청", "접수", "행사", "연구", "수상", "성과", "공지", "장학"]);
    const source = input.summary || input.title;
    const sentence = source.replace(/\s+/g, " ").trim();
    const summary = `${input.universityName}의 ${sentence}`.slice(0, 420) + (sentence.endsWith(".") ? "" : ".") + " 원문에서 세부 내용을 확인할 수 있습니다.";
    const keywords = [...new Set((`${input.title} ${input.originalCategory}`.match(/[가-힣A-Za-z0-9]{2,}/g) || []).filter((word) => !["대학교", "학교"].includes(word)))].slice(0, 5);
    while (keywords.length < 3) keywords.push(["대학소식", "공식안내", "캠퍼스"][keywords.length]);
    return { status: "completed", result: { isImportant: important, category, categoryLabel: CATEGORY_LABELS[category], summary, keywords, reason: "규칙 기반 테스트 분류 결과입니다.", confidence: 0.78, aiProvider: "mock", isMockAiResult: true } };
  } };
}
module.exports = { createMockProvider };
