"use strict";
function parseAiResponse(value) {
  if (value && typeof value === "object") return { ok: true, value };
  const text = String(value || "").trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  try { return { ok: true, value: JSON.parse(text) }; } catch (error) { return { ok: false, error: `JSON parse failed: ${error.message}` }; }
}
module.exports = { parseAiResponse };
