"use strict";

const REGION_GROUPS = {
  수도권: ["서울특별시", "경기도", "인천광역시"],
  충청권: ["대전광역시", "세종특별자치시", "충청북도", "충청남도"],
  전라권: ["광주광역시", "전북특별자치도", "전라남도"],
  경상권: ["부산광역시", "대구광역시", "울산광역시", "경상북도", "경상남도"],
  강원권: ["강원특별자치도"],
  제주권: ["제주특별자치도"],
};
const SCORE_PATTERN = /내신|수능|등급|합격선|경쟁률|합격\s*가능|안정권|적정\s*지원|성적/;

function blankIntent() {
  return { regions: [], cities: [], majorKeywords: [], relatedMajorKeywords: [], universityTypes: [], categories: [], campusTypes: [], keywords: [], limit: 5, needsScoreData: false, needsClarification: false, clarificationQuestion: "" };
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

function parseIntentLocally(message, data) {
  const intent = blankIntent();
  const text = String(message || "").trim();
  const lower = text.toLocaleLowerCase("ko");
  const regions = unique(data.universities.map((university) => university.region));
  const cities = unique(data.universities.map((university) => university.city));

  Object.entries(REGION_GROUPS).forEach(([group, values]) => {
    if (lower.includes(group) || (group === "수도권" && /서울\s*(근처|인근)/.test(lower))) intent.regions.push(...values);
  });
  regions.forEach((region) => { if (lower.includes(region.toLocaleLowerCase("ko"))) intent.regions.push(region); });
  cities.forEach((city) => { if (lower.includes(city.toLocaleLowerCase("ko"))) intent.cities.push(city); });
  if (lower.includes("서울에") || lower.includes("서울에 있는")) intent.regions.push("서울특별시");
  if (lower.includes("부산")) intent.regions.push("부산광역시");
  if (lower.includes("제주")) intent.regions.push("제주특별자치도");
  intent.regions = unique(intent.regions);
  intent.cities = unique(intent.cities);

  ["국립", "공립", "사립"].forEach((type) => { if (lower.includes(type)) intent.universityTypes.push(type); });
  ["일반대학", "교육대학", "산업대학"].forEach((category) => { if (lower.includes(category) || (category === "교육대학" && /교육대|교대/.test(lower))) intent.categories.push(category); });
  ["본교", "분교", "캠퍼스"].forEach((campusType) => { if (lower.includes(campusType)) intent.campusTypes.push(campusType); });

  Object.entries(data.synonyms).forEach(([keyword, related]) => {
    if (lower.includes(keyword.toLocaleLowerCase("ko")) || related.some((term) => lower.includes(term.toLocaleLowerCase("ko")))) {
      intent.majorKeywords.push(keyword);
      intent.relatedMajorKeywords.push(...related);
    }
  });
  intent.majorKeywords = unique(intent.majorKeywords);
  intent.relatedMajorKeywords = unique(intent.relatedMajorKeywords);
  intent.needsScoreData = SCORE_PATTERN.test(lower);
  const hasKnownMajor = intent.majorKeywords.length > 0;
  if (/(달|우주|없는대학교)/.test(lower)) intent.keywords.push("__unmatched_location_or_school__");
  if (/(학과|전공)/.test(lower) && !hasKnownMajor) {
    const unknownMajor = text.match(/([가-힣a-zA-Z]{2,})(?:학과|전공)/)?.[1];
    if (unknownMajor) intent.keywords.push(unknownMajor);
  }
  intent.keywords = unique(intent.keywords);
  if (intent.needsScoreData && !intent.regions.length && !intent.cities.length && !intent.majorKeywords.length && !intent.universityTypes.length && !intent.categories.length) {
    intent.needsClarification = true;
    intent.clarificationQuestion = "성적 정보만으로는 합격 가능성을 안내할 수 없습니다. 희망 지역, 관심 전공, 국립·사립 여부를 알려 주시면 대학을 찾아드릴게요.";
  }
  if (!text) {
    intent.needsClarification = true;
    intent.clarificationQuestion = "희망 지역, 관심 전공, 국립·사립 여부 중 한 가지 이상을 입력해 주세요.";
  }
  return intent;
}

function validateIntent(input, data) {
  const source = input && typeof input === "object" ? input : {};
  const allowedRegions = new Set(data.universities.map((university) => university.region));
  const allowedCities = new Set(data.universities.map((university) => university.city));
  const validValues = (value, allowed) => Array.isArray(value) ? unique(value.map(String).filter((item) => allowed.has(item))) : [];
  const strings = (value) => Array.isArray(value) ? unique(value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12)) : [];
  return {
    regions: validValues(source.regions, allowedRegions),
    cities: validValues(source.cities, allowedCities),
    majorKeywords: strings(source.majorKeywords),
    relatedMajorKeywords: strings(source.relatedMajorKeywords),
    universityTypes: validValues(source.universityTypes, new Set(["국립", "공립", "사립"])),
    categories: validValues(source.categories, new Set(["일반대학", "교육대학", "산업대학"])),
    campusTypes: validValues(source.campusTypes, new Set(["본교", "분교", "캠퍼스"])),
    keywords: strings(source.keywords),
    limit: Math.max(1, Math.min(10, Number.parseInt(source.limit, 10) || 5)),
    needsScoreData: Boolean(source.needsScoreData),
    needsClarification: Boolean(source.needsClarification),
    clarificationQuestion: typeof source.clarificationQuestion === "string" ? source.clarificationQuestion.slice(0, 300) : "",
  };
}

module.exports = { REGION_GROUPS, blankIntent, parseIntentLocally, validateIntent };
