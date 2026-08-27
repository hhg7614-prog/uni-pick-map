"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { htmlListCollector, detailLinkFromValue, resolveJsDetailLink } = require("./html-list-collector");

// -----------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------

const UNIVERSITY = {
  universityId: "test-university",
  universityGroupId: "test-university-group",
  universityName: "테스트대학교",
  campusName: "",
};

function makeSource(overrides = {}) {
  return {
    id: "test-source",
    name: "테스트 소식",
    category: "school_news",
    categoryLabel: "학교소식",
    listUrl: "https://www.example.ac.kr/list.do",
    baseUrl: "https://www.example.ac.kr",
    selectors: { item: "li.item", title: "a.tit", link: "a.tit", date: "span.date" },
    ...overrides,
  };
}

function fetchStub(html, { url = "https://www.example.ac.kr/list.do" } = {}) {
  return async () => ({
    ok: true,
    url,
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => html,
  });
}

// htmlListCollector() defaults collectedAt to `new Date().toISOString()`,
// evaluated fresh on every call. A test that compares two separate calls'
// items with assert.deepEqual must pin this explicitly to the same value,
// or the comparison becomes flaky whenever the two calls straddle a
// millisecond boundary.
const FIXED_COLLECTED_AT = "2026-01-01T00:00:00.000Z";

// -----------------------------------------------------------------------
// Positive: real-case pattern support, tested directly against
// resolveJsDetailLink (no network involved).
// -----------------------------------------------------------------------

test("1. KHU 4-arg functionCall view(...) assembles the GET-verified detail URL, ignoring the unused empty catId arg", () => {
  const source = { baseUrl: "https://www.khu.ac.kr", listUrl: "https://www.khu.ac.kr/" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 4,
    urlTemplate: "https://www.khu.ac.kr/kor/user/bbs/{arg3}/view.do?boardId={arg0}&menuNo={arg1}",
  };
  const link = resolveJsDetailLink("view('322857', '200265', '', 'BMSR00044')", rule, source);
  assert.equal(link, "https://www.khu.ac.kr/kor/user/bbs/BMSR00044/view.do?boardId=322857&menuNo=200265");
});

test("2. KHU 1-arg board-page view(...) combined with source-level fixedParams interpolates both together", () => {
  const source = { baseUrl: "https://www.khu.ac.kr", listUrl: "https://www.khu.ac.kr/" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    fixedParams: { bbsId: "BMSR00044", menuNo: "200265" },
    urlTemplate: "https://www.khu.ac.kr/kor/user/bbs/{bbsId}/view.do?boardId={arg0}&menuNo={menuNo}",
  };
  const link = resolveJsDetailLink("view('322782')", rule, source);
  assert.equal(link, "https://www.khu.ac.kr/kor/user/bbs/BMSR00044/view.do?boardId=322782&menuNo=200265");
});

test("3. JBNU 1-arg pf_DetailMove(...) assembles the configured template", () => {
  const source = { baseUrl: "https://www.jbnu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "pf_DetailMove",
    argCount: 1,
    urlTemplate: "https://www.jbnu.ac.kr/notice/sub01/view.do?nttSn={arg0}",
  };
  const link = resolveJsDetailLink("pf_DetailMove('216600')", rule, source);
  assert.equal(link, "https://www.jbnu.ac.kr/notice/sub01/view.do?nttSn=216600");
});

test("4. GNU data-id dataAttribute assembles the configured template", () => {
  const source = { baseUrl: "https://www.gnu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "dataAttribute",
    dataAttribute: "data-id",
    urlTemplate: "https://www.gnu.ac.kr/selectNttInfo.do?bbsId=1028&mi=1126&nttSn={arg0}",
  };
  const link = resolveJsDetailLink("216600", rule, source);
  assert.equal(link, "https://www.gnu.ac.kr/selectNttInfo.do?bbsId=1028&mi=1126&nttSn=216600");
});

test("5. Dankook 3-arg _dku_bbs_web_BbsPortlet_viewMessage(...) assembles correctly using only arg0, ignoring unused true/false args", () => {
  const source = { baseUrl: "https://www.dankook.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "_dku_bbs_web_BbsPortlet_viewMessage",
    argCount: 3,
    urlTemplate: "https://www.dankook.ac.kr/web/kor/-550?messageId={arg0}",
  };
  const link = resolveJsDetailLink("_dku_bbs_web_BbsPortlet_viewMessage(181003, true, false)", rule, source);
  assert.equal(link, "https://www.dankook.ac.kr/web/kor/-550?messageId=181003");
});

// -----------------------------------------------------------------------
// Negative / safety-gate cases
// -----------------------------------------------------------------------

test("6. no jsDetailLinkRule field: static href and location.href= cases behave exactly like before (regression)", async () => {
  const staticHtml = `
    <li class="item"><a class="tit" href="https://www.example.ac.kr/view.do?id=1">제목1</a><span class="date">2026.08.20</span></li>
  `;
  const staticSource = makeSource();
  const staticResult = await htmlListCollector({
    university: UNIVERSITY,
    source: staticSource,
    limit: 10,
    fetchImpl: fetchStub(staticHtml),
  });
  assert.equal(staticResult.status, "success");
  assert.equal(staticResult.items.length, 1);
  assert.equal(staticResult.items[0].sourceUrl, "https://www.example.ac.kr/view.do?id=1");

  const locationHtml = `
    <li class="item"><a class="tit" href="#" onclick="location.href='https://www.example.ac.kr/view.do?id=2'">제목2</a><span class="date">2026.08.19</span></li>
  `;
  const locationSource = makeSource({
    selectors: { item: "li.item", title: "a.tit", link: "a.tit", linkAttribute: "onclick", date: "span.date" },
  });
  const locationResult = await htmlListCollector({
    university: UNIVERSITY,
    source: locationSource,
    limit: 10,
    fetchImpl: fetchStub(locationHtml),
  });
  assert.equal(locationResult.status, "success");
  assert.equal(locationResult.items.length, 1);
  assert.equal(locationResult.items[0].sourceUrl, "https://www.example.ac.kr/view.do?id=2");
  // Confirm detailLinkFromValue itself is untouched by this change.
  assert.equal(detailLinkFromValue("location.href='https://www.example.ac.kr/view.do?id=2'"), "https://www.example.ac.kr/view.do?id=2");
});

test("7. jsDetailLinkRule.enabled: false behaves exactly like the field being absent (double-gate)", async () => {
  const html = `
    <li class="item"><a class="tit" href="javascript:;" onclick="view('322857', '200265', '', 'BMSR00044')">제목</a><span class="date">2026.08.20</span></li>
  `;
  const selectors = { item: "li.item", title: "a.tit", link: "a.tit", linkAttribute: "onclick", date: "span.date" };
  const rule = {
    enabled: false,
    pattern: "functionCall",
    functionName: "view",
    argCount: 4,
    urlTemplate: "https://www.khu.ac.kr/kor/user/bbs/{arg3}/view.do?boardId={arg0}&menuNo={arg1}",
  };

  const sourceWithoutField = makeSource({ selectors });
  const resultWithoutField = await htmlListCollector({
    university: UNIVERSITY,
    source: sourceWithoutField,
    limit: 10,
    fetchImpl: fetchStub(html),
    collectedAt: FIXED_COLLECTED_AT,
  });

  const sourceWithDisabledRule = makeSource({ selectors, jsDetailLinkRule: rule });
  const resultWithDisabledRule = await htmlListCollector({
    university: UNIVERSITY,
    source: sourceWithDisabledRule,
    limit: 10,
    fetchImpl: fetchStub(html),
    collectedAt: FIXED_COLLECTED_AT,
  });

  // Both branches must take the exact same detailLinkFromValue() fallback
  // path -- an `enabled: false` rule must never produce a different result
  // than having no jsDetailLinkRule field at all (the "2중 게이트" design).
  assert.deepEqual(resultWithDisabledRule.items, resultWithoutField.items);
  assert.deepEqual(resultWithDisabledRule.warnings, resultWithoutField.warnings);
  assert.ok(!resultWithDisabledRule.warnings.some((warning) => /jsDetailLinkRule/.test(warning)));
});

test("8. function name mismatch is rejected (item excluded, not the whole source)", () => {
  const source = { baseUrl: "https://www.khu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    urlTemplate: "https://www.khu.ac.kr/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink("otherFn('1')", rule, source), "");
});

test("9. argCount mismatch is rejected (too many and too few arguments)", () => {
  const source = { baseUrl: "https://www.jbnu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "pf_DetailMove",
    argCount: 1,
    urlTemplate: "https://www.jbnu.ac.kr/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink("pf_DetailMove('216600', 'extra')", rule, source), "");
  assert.equal(resolveJsDetailLink("pf_DetailMove()", rule, source), "");
});

test("10. unsafe arguments (string concatenation, variable reference, whitespace/Korean text) are rejected without ever executing the expression", () => {
  const source = { baseUrl: "https://www.khu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    urlTemplate: "https://www.khu.ac.kr/view.do?id={arg0}",
  };
  // String concatenation.
  assert.equal(resolveJsDetailLink("view('x' + rowId)", rule, source), "");
  // Bare variable/property reference (no quotes).
  assert.equal(resolveJsDetailLink("view(rowId)", rule, source), "");
  assert.equal(resolveJsDetailLink("view(this.id)", rule, source), "");
  // Quoted but containing whitespace/punctuation/non-ASCII (a UI message, not an ID).
  assert.equal(resolveJsDetailLink("view('정말 삭제하시겠습니까?')", rule, source), "");
  assert.equal(resolveJsDetailLink("view('123 456')", rule, source), "");
});

test("11. an overly long opaque token (120-char base64url-style blob) is rejected by the length cap even though its character set alone would pass", () => {
  const longToken = "a".repeat(60) + "-" + "b".repeat(59); // 120 chars, all [\w-]
  assert.equal(longToken.length, 120);

  // dataAttribute path: RAW_ATTR_VALUE caps at 64 chars.
  const gnuSource = { baseUrl: "https://www.gnu.ac.kr" };
  const gnuRule = {
    enabled: true,
    pattern: "dataAttribute",
    dataAttribute: "data-id",
    urlTemplate: "https://www.gnu.ac.kr/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink(longToken, gnuRule, gnuSource), "");

  // functionCall path: the quoted-argument branch is also capped at 64 chars.
  const khuSource = { baseUrl: "https://www.khu.ac.kr" };
  const khuRule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    urlTemplate: "https://www.khu.ac.kr/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink(`view('${longToken}')`, khuRule, khuSource), "");
});

test("12. host mismatch is rejected even when the assembled URL is syntactically well-formed", () => {
  const source = { baseUrl: "https://www.khu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    // Deliberately points at a different host than source.baseUrl.
    urlTemplate: "https://www.evil-example.com/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink("view('322857')", rule, source), "");
});

test("13. an unfilled template placeholder is rejected instead of leaking a literal '{argN}' into the URL", () => {
  const source = { baseUrl: "https://www.khu.ac.kr" };
  // argCount is 1 (only {arg0} will ever be populated) but the template
  // references {arg5}, which never gets a value.
  const ruleMissingArg = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    urlTemplate: "https://www.khu.ac.kr/view.do?id={arg0}&extra={arg5}",
  };
  assert.equal(resolveJsDetailLink("view('322857')", ruleMissingArg, source), "");

  // References a fixedParams key that was never declared.
  const ruleMissingFixedParam = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    fixedParams: { bbsId: "BMSR00044" },
    urlTemplate: "https://www.khu.ac.kr/{missingFixedParam}/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink("view('322857')", ruleMissingFixedParam, source), "");
});

test("14. a data-* attribute name outside the allow-list is rejected before its value is even checked", () => {
  const source = { baseUrl: "https://www.gnu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "dataAttribute",
    dataAttribute: "data-secret",
    urlTemplate: "https://www.gnu.ac.kr/view.do?id={arg0}",
  };
  // Even a value that would otherwise be perfectly safe is still rejected,
  // because the attribute name itself is not on ALLOWED_DATA_ATTR_NAMES.
  assert.equal(resolveJsDetailLink("216600", rule, source), "");
});

test("15. real KHU markup carries the call inside href=\"javascript:view(...)\" (no separate onclick attribute) -- the javascript: prefix must be stripped before matching", () => {
  const source = { baseUrl: "https://www.khu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    fixedParams: { bbsId: "BMSR00044", menuNo: "200265" },
    urlTemplate: "https://www.khu.ac.kr/kor/user/bbs/{bbsId}/view.do?boardId={arg0}&menuNo={menuNo}",
  };
  // Actual khu.ac.kr e-News list markup: <a href="javascript:view('322857');" class="btn02">More</a>
  assert.equal(
    resolveJsDetailLink("javascript:view('322857');", rule, source),
    "https://www.khu.ac.kr/kor/user/bbs/BMSR00044/view.do?boardId=322857&menuNo=200265"
  );
});

test("16. stripping the javascript: prefix does not loosen the single-call anchor: a second statement after the prefix is still rejected", () => {
  const source = { baseUrl: "https://www.khu.ac.kr" };
  const rule = {
    enabled: true,
    pattern: "functionCall",
    functionName: "view",
    argCount: 1,
    urlTemplate: "https://www.khu.ac.kr/view.do?id={arg0}",
  };
  assert.equal(resolveJsDetailLink("javascript:alert('x');view('322857');", rule, source), "");
  assert.equal(resolveJsDetailLink("javascript:void(view('322857'))", rule, source), "");
});
