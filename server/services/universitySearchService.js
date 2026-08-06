"use strict";

function normalize(value) { return String(value || "").toLocaleLowerCase("ko"); }
function includesTerm(value, term) { return normalize(value).includes(normalize(term)); }

function findMajorMatches(majors, filters) {
  const exactTerms = filters.majorKeywords || [];
  const relatedTerms = filters.relatedMajorKeywords || [];
  return majors.map((major) => {
    const searchable = [major.departmentName, ...(major.departmentKeywords || [])].join(" ");
    const exact = exactTerms.some((term) => includesTerm(searchable, term));
    const related = !exact && relatedTerms.some((term) => includesTerm(searchable, term));
    return exact || related ? { ...major, matchType: exact ? "exact" : "related" } : null;
  }).filter(Boolean);
}

function searchUniversities(filters, data) {
  const majorSearchEnabled = filters.majorKeywords.length > 0 || filters.relatedMajorKeywords.length > 0;
  const majorMatches = findMajorMatches(data.majors, filters);
  const majorsByUniversity = new Map();
  majorMatches.forEach((major) => {
    const list = majorsByUniversity.get(major.universityId) || [];
    list.push(major);
    majorsByUniversity.set(major.universityId, list);
  });
  const results = data.universities.map((university) => {
    const matches = majorsByUniversity.get(university.id) || [];
    if (filters.regions.length && !filters.regions.includes(university.region)) return null;
    if (filters.cities.length && !filters.cities.includes(university.city)) return null;
    if (filters.universityTypes.length && !filters.universityTypes.includes(university.type)) return null;
    if (filters.categories.length && !filters.categories.includes(university.category)) return null;
    if (filters.campusTypes.length && !filters.campusTypes.includes(university.campusType)) return null;
    if (majorSearchEnabled && !matches.length) return null;
    const keywordText = [university.name, university.shortName, university.field, university.address, university.description].join(" ");
    if (filters.keywords.length && !filters.keywords.every((keyword) => includesTerm(keywordText, keyword))) return null;
    let score = 0;
    if (filters.regions.includes(university.region)) score += 30;
    if (filters.cities.includes(university.city)) score += 15;
    if (filters.universityTypes.includes(university.type)) score += 25;
    if (filters.categories.includes(university.category)) score += 15;
    if (filters.campusTypes.includes(university.campusType)) score += 10;
    if (matches.some((major) => major.matchType === "exact")) score += 40;
    else if (matches.some((major) => major.matchType === "related")) score += 20;
    score += filters.keywords.filter((keyword) => includesTerm(keywordText, keyword)).length * 5;
    return { university, majors: matches, score };
  }).filter(Boolean);
  return results.sort((a, b) => b.score - a.score || a.university.name.localeCompare(b.university.name, "ko")).slice(0, filters.limit);
}

module.exports = { searchUniversities };
