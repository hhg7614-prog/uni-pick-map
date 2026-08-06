"use strict";
const { buildPrompt } = require("./build-ai-prompt"); const { parseAiResponse } = require("./parse-ai-response");
function createOpenAiProvider(env) {
  const key = env.OPENAI_API_KEY, model = env.NEWS_AI_MODEL || "";
  return { name: "openai", model, async process(input) {
    if (!key || !model) return { status: "skipped", reason: "OPENAI_API_KEY or NEWS_AI_MODEL is not configured." };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Number(env.NEWS_AI_REQUEST_TIMEOUT_MS || 30000));
    try { const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: buildPrompt(input), text: { format: { type: "json_object" } } }) }); if (!response.ok) return { status: "provider_failed", reason: `OpenAI request failed (${response.status}).` }; const data = await response.json(); const parsed = parseAiResponse(data.output_text || ""); return parsed.ok ? { status: "completed", result: parsed.value } : { status: "parse_failed", reason: parsed.error }; } catch (error) { return { status: "provider_failed", reason: error.name === "AbortError" ? "OpenAI request timed out." : "OpenAI request failed." }; } finally { clearTimeout(timer); }
  } };
}
module.exports = { createOpenAiProvider };
