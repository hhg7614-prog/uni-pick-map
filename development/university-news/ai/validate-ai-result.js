"use strict";
const { CATEGORY_LABELS } = require("./build-ai-prompt");
const CATEGORIES = Object.keys(CATEGORY_LABELS);
function validateAiResult(result) {
  const errors = [], warnings = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return { valid: false, errors: ["Result must be an object."], warnings };
  if (typeof result.isImportant !== "boolean") errors.push("isImportant must be boolean.");
  if (!CATEGORIES.includes(result.category)) errors.push("category is not allowed.");
  if (typeof result.summary !== "string" || !result.summary.trim()) errors.push("summary is required.");
  if (String(result.summary || "").length > 1200) errors.push("summary is too long.");
  if (/<[^>]+>|```|https?:\/\//i.test(String(result.summary || ""))) errors.push("summary contains unsafe markup or URL.");
  if (!Array.isArray(result.keywords) || result.keywords.length < 3 || result.keywords.length > 5) errors.push("keywords must have 3 to 5 values.");
  if (Array.isArray(result.keywords) && result.keywords.some((word) => typeof word !== "string" || !word.trim() || word.length > 40)) errors.push("keywords contain an invalid value.");
  if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) errors.push("confidence must be 0 to 1.");
  if (result.reason != null && typeof result.reason !== "string") warnings.push("reason was ignored.");
  const keywords = Array.isArray(result.keywords) ? [...new Set(result.keywords.map((word) => word.trim()))] : [];
  if (keywords.length < 3 || keywords.length > 5) errors.push("keywords must be unique.");
  return { valid: errors.length === 0, errors, warnings, value: { ...result, categoryLabel: CATEGORY_LABELS[result.category] || "", keywords } };
}
module.exports = { CATEGORIES, validateAiResult };
