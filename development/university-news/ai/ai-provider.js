"use strict";

const { createMockProvider } = require("./mock-provider");
const { createOpenAiProvider } = require("./openai-provider");
const { createGeminiProvider } = require("./gemini-provider");

function getProvider(name, env = process.env) {
  const provider = String(name || env.NEWS_AI_PROVIDER || "disabled").toLowerCase();
  if (provider === "disabled") return { name: "disabled", model: "", async process() { return { status: "skipped", reason: "AI provider is disabled." }; } };
  if (provider === "mock") return createMockProvider();
  if (provider === "openai") return createOpenAiProvider(env);
  if (provider === "gemini") return createGeminiProvider(env);
  throw new Error(`Unsupported NEWS_AI_PROVIDER: ${provider}`);
}

module.exports = { getProvider };
