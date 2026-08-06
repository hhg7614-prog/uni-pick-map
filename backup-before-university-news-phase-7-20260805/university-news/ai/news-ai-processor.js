"use strict";
const { buildAiInput } = require("./build-ai-prompt"); const { validateAiResult } = require("./validate-ai-result");
async function processNewsItem(item, provider) {
  const response = await provider.process(buildAiInput(item));
  if (response.status !== "completed") return { ok: false, status: response.status || "provider_failed", reason: response.reason || "Provider failed." };
  const validation = validateAiResult(response.result);
  if (!validation.valid) return { ok: false, status: "invalid", reason: validation.errors.join(" "), warnings: validation.warnings };
  return { ok: true, status: "valid", aiResult: validation.value, warnings: validation.warnings || [] };
}
module.exports = { processNewsItem };
