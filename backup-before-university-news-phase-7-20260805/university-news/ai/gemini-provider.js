"use strict";
const { buildPrompt } = require("./build-ai-prompt"); const { parseAiResponse } = require("./parse-ai-response");
function createGeminiProvider(env) {
  const key = env.GEMINI_API_KEY, model = env.NEWS_AI_MODEL || "";
  return { name: "gemini", model, async process(input) {
    if (!key || !model) return { status: "skipped", reason: "GEMINI_API_KEY or NEWS_AI_MODEL is not configured." };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Number(env.NEWS_AI_REQUEST_TIMEOUT_MS || 30000));
    try { const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt(input) }] }], generationConfig: { responseMimeType: "application/json" } }) }); if (!response.ok) return { status: "provider_failed", reason: `Gemini request failed (${response.status}).` }; const data = await response.json(); const parsed = parseAiResponse(data.candidates?.[0]?.content?.parts?.[0]?.text || ""); return parsed.ok ? { status: "completed", result: parsed.value } : { status: "parse_failed", reason: parsed.error }; } catch (error) { return { status: "provider_failed", reason: error.name === "AbortError" ? "Gemini request timed out." : "Gemini request failed." }; } finally { clearTimeout(timer); }
  } };
}
module.exports = { createGeminiProvider };
