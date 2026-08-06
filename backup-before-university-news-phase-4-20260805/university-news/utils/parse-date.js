"use strict";

function parseDate(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return { value: null, warning: null };

  const match = text.match(/\b(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\b/);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return { value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, warning: null };
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(text)) return { value: parsed.toISOString(), warning: null };
  return { value: null, warning: "게시일 형식을 확인하지 못했습니다." };
}

module.exports = { parseDate };
