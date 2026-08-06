"use strict";

const { intentParserPrompt } = require("../prompts/intentParserPrompt");
let aiDisabledForProcess = false;

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const messages = Array.isArray(payload.output) ? payload.output : [];
  return messages.flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
}

async function parseIntentWithOpenAI(message) {
  if (!process.env.OPENAI_API_KEY || aiDisabledForProcess) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5.6-luna", reasoning: { effort: "low" }, input: [{ role: "system", content: intentParserPrompt }, { role: "user", content: String(message) }], max_output_tokens: 700 }),
    });
    if (!response.ok) {
      aiDisabledForProcess = true;
      throw new Error(`OpenAI request failed (${response.status})`);
    }
    const text = extractOutputText(await response.json()).trim();
    return text ? JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()) : null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { parseIntentWithOpenAI };
