"use strict";

function getEnvironmentSummary() {
  return {
    nodeEnv: process.env.NODE_ENV || "development",
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasRedisUrl: Boolean(process.env.REDIS_URL),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  };
}

module.exports = { getEnvironmentSummary };
