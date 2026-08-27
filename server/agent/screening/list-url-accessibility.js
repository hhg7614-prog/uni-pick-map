"use strict";

// Pure classifier for listUrl accessibility evidence. No network/filesystem
// access -- the caller (the CLI orchestrator) performs the actual fetch and
// passes in the observed evidence.

const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
  "CERT_CHAIN_TOO_LONG",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "ERR_SSL_PROTOCOL_ERROR",
]);

const TIMEOUT_ERROR_CODES = new Set(["ABORT_ERR", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

function looksLikeTlsError(error) {
  if (!error) return false;
  const code = String(error.code || "").trim();
  if (code && TLS_ERROR_CODES.has(code)) return true;
  const message = String(error.message || "");
  return /certificate|SSL|TLS/i.test(message) && !/timed out|timeout/i.test(message);
}

function looksLikeTimeout(error) {
  if (!error) return false;
  const code = String(error.code || "").trim();
  if (code && TIMEOUT_ERROR_CODES.has(code)) return true;
  const name = String(error.name || "");
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /timed out|timeout/i.test(String(error.message || ""));
}

function looksLikeLoginRedirect(evidence) {
  const finalUrl = String(evidence.finalUrl || evidence.url || "");
  const bodySample = String(evidence.bodySample || "").slice(0, 5000);
  return /login|signin|로그인/i.test(finalUrl) || /login|signin|로그인/i.test(bodySample);
}

// An immediate `alert('...')` followed shortly by `history.back()` is a
// near-zero-false-positive fingerprint for a server-side "bounce" error page
// (Gyeongsang National University `gnu-official-press-releases` case: the
// catalog's listUrl is missing a required query param, so the server
// returns HTTP 200 with a tiny page whose entire content is this
// alert+history.back() idiom). A genuine news/board page never carries this
// as its page-level content.
const ERROR_BOUNCE_SCRIPT_PATTERN = /alert\(\s*['"][^'"]*['"]\s*\)[\s\S]{0,80}?history\.back\(\)/i;

// Short, generic Korean "invalid/bad request" or "not found" phrases. Only
// treated as an error signal when the response body is short (see
// ERROR_PAGE_MAX_BODY_LENGTH below) -- a long, genuine news article that
// happens to mention one of these phrases in passing must not be
// misclassified.
const SHORT_ERROR_PHRASES = [/유효하지\s*않은\s*요청/, /잘못된\s*요청/, /페이지를\s*찾을\s*수\s*없습니다/];
const ERROR_PAGE_MAX_BODY_LENGTH = 3000;

function looksLikeErrorPageDespite200(bodySample) {
  const body = String(bodySample || "");
  if (!body.trim()) return false;
  if (ERROR_BOUNCE_SCRIPT_PATTERN.test(body)) return true;
  return body.length <= ERROR_PAGE_MAX_BODY_LENGTH && SHORT_ERROR_PHRASES.some((pattern) => pattern.test(body));
}

/**
 * Classify listUrl accessibility from observed fetch evidence.
 *
 * @param {{ status?: number, finalUrl?: string, url?: string, error?: { code?: string, name?: string, message?: string } | null, bodySample?: string }} evidence
 * @returns {"OK_200"|"NOT_FOUND_404"|"LOGIN_REDIRECT"|"ERROR_PAGE_DESPITE_200"|"TLS_ERROR"|"TIMEOUT"|"OTHER_HTTP_ERROR"|"NETWORK_ERROR"}
 */
function classifyAccessibility(evidence = {}) {
  const { status, error } = evidence;

  if (error) {
    if (looksLikeTlsError(error)) return "TLS_ERROR";
    if (looksLikeTimeout(error)) return "TIMEOUT";
    return "NETWORK_ERROR";
  }

  if (status === 404) return "NOT_FOUND_404";

  if (typeof status === "number" && status >= 200 && status < 300) {
    if (looksLikeLoginRedirect(evidence)) return "LOGIN_REDIRECT";
    if (looksLikeErrorPageDespite200(evidence.bodySample)) return "ERROR_PAGE_DESPITE_200";
    return "OK_200";
  }

  if (looksLikeLoginRedirect(evidence)) return "LOGIN_REDIRECT";

  if (typeof status === "number" && status >= 300 && status < 600) return "OTHER_HTTP_ERROR";

  return "NETWORK_ERROR";
}

module.exports = { classifyAccessibility, TLS_ERROR_CODES, TIMEOUT_ERROR_CODES };
