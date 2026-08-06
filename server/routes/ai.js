"use strict";

const { parseIntentLocally, validateIntent } = require("../services/intentParserService");
const { searchUniversities } = require("../services/universitySearchService");
const { validateRecommendations } = require("../validators/recommendationValidator");
const { formatAnswer, recommend } = require("../services/recommendationService");

async function handleAiRoute(pathname, body, data) {
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (pathname === "/api/ai/parse-intent") return { status: 200, payload: validateIntent(parseIntentLocally(message, data), data) };
  if (pathname === "/api/universities/recommend") {
    const filters = validateIntent(body.filters, data);
    return { status: 200, payload: { filters, recommendations: validateRecommendations(searchUniversities(filters, data), data) } };
  }
  if (pathname === "/api/ai/generate-answer") {
    const filters = validateIntent(body.filters, data);
    const recommendations = validateRecommendations(Array.isArray(body.recommendations) ? body.recommendations : [], data);
    return { status: 200, payload: formatAnswer(message, filters, recommendations) };
  }
  if (pathname === "/api/ai/recommend") {
    if (!message) return { status: 400, payload: { error: "message is required" } };
    return { status: 200, payload: await recommend(message, data) };
  }
  return null;
}

module.exports = { handleAiRoute };
