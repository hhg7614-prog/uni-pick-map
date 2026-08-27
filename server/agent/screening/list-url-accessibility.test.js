"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyAccessibility } = require("./list-url-accessibility");

test("HTTP 200 with no login markers classifies as OK_200", () => {
  const result = classifyAccessibility({ status: 200, finalUrl: "https://www.knu.ac.kr/wbbs/wbbs/bbs/btin/list.action", error: null, bodySample: "<html>공지사항 목록</html>" });
  assert.equal(result, "OK_200");
});

test("HTTP 404 classifies as NOT_FOUND_404", () => {
  const result = classifyAccessibility({ status: 404, finalUrl: "https://www.chungbuk.ac.kr/robots.txt", error: null, bodySample: "" });
  assert.equal(result, "NOT_FOUND_404");
});

test("a final URL containing a login path classifies as LOGIN_REDIRECT even with HTTP 200", () => {
  const result = classifyAccessibility({ status: 200, finalUrl: "https://example.ac.kr/member/login.do", error: null, bodySample: "" });
  assert.equal(result, "LOGIN_REDIRECT");
});

test("a Korean 로그인 marker in the body classifies as LOGIN_REDIRECT", () => {
  const result = classifyAccessibility({ status: 200, finalUrl: "https://example.ac.kr/board/list.do", error: null, bodySample: "<html>로그인이 필요합니다</html>" });
  assert.equal(result, "LOGIN_REDIRECT");
});

test("a Node TLS error code (UNABLE_TO_VERIFY_LEAF_SIGNATURE, Jeju National University case) classifies as TLS_ERROR", () => {
  const result = classifyAccessibility({ status: null, finalUrl: "https://www.jejunu.ac.kr/ara/noticesurvey/outEvent.htm?category=321", error: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", message: "unable to verify the first certificate" } });
  assert.equal(result, "TLS_ERROR");
});

test("CERT_HAS_EXPIRED classifies as TLS_ERROR", () => {
  const result = classifyAccessibility({ status: null, error: { code: "CERT_HAS_EXPIRED", message: "certificate has expired" } });
  assert.equal(result, "TLS_ERROR");
});

test("an AbortError from a fetch timeout classifies as TIMEOUT", () => {
  const result = classifyAccessibility({ status: null, error: { name: "AbortError", message: "The operation was aborted" } });
  assert.equal(result, "TIMEOUT");
});

test("ETIMEDOUT classifies as TIMEOUT", () => {
  const result = classifyAccessibility({ status: null, error: { code: "ETIMEDOUT", message: "connect ETIMEDOUT" } });
  assert.equal(result, "TIMEOUT");
});

test("an unrecognized network error classifies as NETWORK_ERROR", () => {
  const result = classifyAccessibility({ status: null, error: { code: "ECONNRESET", message: "socket hang up" } });
  assert.equal(result, "NETWORK_ERROR");
});

test("HTTP 403/429/5xx classify as OTHER_HTTP_ERROR", () => {
  assert.equal(classifyAccessibility({ status: 403, error: null }), "OTHER_HTTP_ERROR");
  assert.equal(classifyAccessibility({ status: 429, error: null }), "OTHER_HTTP_ERROR");
  assert.equal(classifyAccessibility({ status: 500, error: null }), "OTHER_HTTP_ERROR");
  assert.equal(classifyAccessibility({ status: 502, error: null }), "OTHER_HTTP_ERROR");
});

// --- Regression: Gyeongsang National University gnu-official-press-releases.
// The catalog's listUrl is missing a required bbsId query param, so the
// server returns HTTP 200 with a tiny "invalid request" bounce page
// (alert(...) + history.back()) instead of the real board list. This must
// not be classified as OK_200 -- exact body captured during investigation. ---

const GNU_INVALID_REQUEST_BOUNCE_HTML = `<!DOCTYPE html><html lang="ko"><head><title>시스템안내</title><meta charset="utf-8">
<script language='javascript'>
alert('유효하지 않은 요청입니다.');
history.back();
</script>
</head></html>
`;

test("HTTP 200 with the real GNU invalid-request bounce page (alert + history.back()) classifies as ERROR_PAGE_DESPITE_200, not OK_200", () => {
  const result = classifyAccessibility({
    status: 200,
    finalUrl: "https://www.gnu.ac.kr/main/na/ntt/selectNttList.do?mi=1070",
    error: null,
    bodySample: GNU_INVALID_REQUEST_BOUNCE_HTML,
  });
  assert.equal(result, "ERROR_PAGE_DESPITE_200");
});

test("a long, genuine news article that happens to mention '페이지를 찾을 수 없습니다' in passing stays OK_200 (no alert+history.back() structure, body exceeds the short-body threshold)", () => {
  const longArticleBody =
    "<html><body><article>" +
    "학교 홈페이지 개편 안내 기사입니다. 지난주 시스템 점검 중 일부 이용자에게 '페이지를 찾을 수 없습니다'라는 안내가 표시된 사례가 있었으나, 현재는 정상화되었습니다. " +
    "이하 본문이 이어집니다. ".repeat(300) +
    "</article></body></html>";
  const result = classifyAccessibility({
    status: 200,
    finalUrl: "https://example.ac.kr/board/news/12345.do",
    error: null,
    bodySample: longArticleBody,
  });
  assert.equal(result, "OK_200");
});
