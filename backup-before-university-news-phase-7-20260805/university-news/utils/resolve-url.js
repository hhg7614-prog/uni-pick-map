"use strict";

function resolveUrl(value, baseUrl) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.startsWith("#") || /^(javascript|mailto|tel):/i.test(candidate)) return null;

  try {
    const url = new URL(candidate, baseUrl);
    return /^https?:$/i.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

module.exports = { resolveUrl };
