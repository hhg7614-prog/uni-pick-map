"use strict";

const { parseIntentLocally, validateIntent } = require("./intentParserService");
const { searchUniversities } = require("./universitySearchService");
const { validateRecommendations } = require("../validators/recommendationValidator");
const { parseIntentWithOpenAI } = require("./aiService");

function formatAnswer(message, filters, recommendations) {
  const notices = [];
  if (filters.needsScoreData) notices.push("현재 합격선과 성적 데이터는 준비 중이어서 정확한 합격 가능성을 안내하기 어렵습니다. 대신 희망 지역, 관심 전공, 국립·사립 여부에 맞는 대학을 추천해 드릴 수 있습니다.");
  if (/서울\s*(근처|인근)/.test(message)) notices.push("서울 근처를 수도권 기준으로 검색했습니다.");
  if (filters.needsClarification) return { answer: filters.clarificationQuestion || "희망 지역이나 관심 전공을 알려 주세요.", notices, noResults: true };
  if (!recommendations.length) return { answer: "현재 대학 데이터에서는 입력하신 모든 조건을 동시에 만족하는 학교를 찾지 못했습니다.", notices, noResults: true };
  const conditionParts = [...filters.regions, ...filters.majorKeywords, ...filters.universityTypes, ...filters.categories];
  const intro = conditionParts.length ? `요청하신 ${conditionParts.join("·")} 조건으로 대학 데이터를 검색했습니다.` : "요청하신 조건으로 대학 데이터를 검색했습니다.";
  const relatedUsed = recommendations.some((item) => item.majors.some((major) => major.matchType === "related"));
  if (relatedUsed) notices.push("요청하신 전공과 정확히 같은 명칭뿐 아니라 관련 학과도 함께 검색했습니다.");
  const body = recommendations.map((item, index) => {
    const university = item.university;
    const majors = item.majors.map((major) => major.departmentName).join(", ");
    const reason = item.majors.some((major) => major.matchType === "exact") ? "입력하신 조건과 확인된 학과 정보가 일치합니다." : item.majors.length ? "입력하신 조건과 관련 학과 정보가 확인되었습니다." : "입력하신 지역·학교 조건과 일치합니다.";
    return `${index + 1}. ${university.name}\n- 지역: ${university.region} ${university.city || ""}\n${majors ? `- 확인된 학과: ${majors}\n` : ""}- 추천 사유: ${reason}`;
  }).join("\n\n");
  return { answer: `${intro}\n\n${body}\n\n학교 카드를 선택하면 지도에서 위치와 상세정보를 확인할 수 있습니다.`, notices, noResults: false };
}

async function recommend(message, data) {
  const localIntent = parseIntentLocally(message, data);
  let modelIntent = null;
  try { modelIntent = await parseIntentWithOpenAI(message); } catch (error) { console.warn("Intent model unavailable; using local parser.", error.message); }
  const filters = validateIntent(modelIntent || localIntent, data);
  // The fallback keeps required Korean region/score rules even if a model omits them.
  if (!filters.regions.length) filters.regions = localIntent.regions;
  if (!filters.majorKeywords.length) filters.majorKeywords = localIntent.majorKeywords;
  if (!filters.relatedMajorKeywords.length) filters.relatedMajorKeywords = localIntent.relatedMajorKeywords;
  if (!filters.universityTypes.length) filters.universityTypes = localIntent.universityTypes;
  if (!filters.categories.length) filters.categories = localIntent.categories;
  if (!filters.campusTypes.length) filters.campusTypes = localIntent.campusTypes;
  filters.keywords = [...new Set([...filters.keywords, ...localIntent.keywords])];
  filters.needsScoreData ||= localIntent.needsScoreData;
  filters.needsClarification ||= localIntent.needsClarification;
  if (!filters.clarificationQuestion) filters.clarificationQuestion = localIntent.clarificationQuestion;
  const rawResults = filters.needsClarification ? [] : searchUniversities(filters, data);
  const recommendations = validateRecommendations(rawResults, data);
  const response = formatAnswer(message, filters, recommendations);
  return { filters, recommendations, ...response };
}

module.exports = { recommend, formatAnswer };
