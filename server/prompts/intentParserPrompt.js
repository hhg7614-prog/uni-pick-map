"use strict";

const intentParserPrompt = `You extract university-search filters from a Korean user message. Return JSON only. Never return SQL. Use only this schema: regions, cities, majorKeywords, relatedMajorKeywords, universityTypes, categories, campusTypes, keywords, limit, needsScoreData, needsClarification, clarificationQuestion. Unknown values must be empty arrays. limit is 1 to 10.`;

module.exports = { intentParserPrompt };
