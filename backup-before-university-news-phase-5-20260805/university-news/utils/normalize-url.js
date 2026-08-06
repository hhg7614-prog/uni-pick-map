"use strict";

const TRACKING_PARAMETERS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"
]);

function normalizeUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate || /^(javascript|mailto|tel):/i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    });
    return url.href;
  } catch {
    return null;
  }
}

module.exports = { normalizeUrl, TRACKING_PARAMETERS };
