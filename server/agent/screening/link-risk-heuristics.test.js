"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { detectJsOnlyLinkRisk, detectSpaRisk, detectNonKoreanBoardFlag, scoreStaticHtmlLikelihood } = require("./link-risk-heuristics");

// Seoul National University of Education (SNUE) list markup pattern: real
// navigation is carried by data-url/data-param, not by href.
const SNUE_LIST_HTML = `
  <ul class="board-list">
    <li>
      <a href="javascript:;" data-url="/snue/na/ntt/selectNttInfo.do" data-nm="nttSn" data-param="54635">2026학년도 1학기 수강신청 안내</a>
    </li>
    <li>
      <a href="javascript:;" data-url="/snue/na/ntt/selectNttInfo.do" data-nm="nttSn" data-param="54634">등록금 분할납부 신청 안내</a>
    </li>
  </ul>
`;

// Gachon University Global Campus list markup pattern: clean absolute
// hrefs, no javascript:-only links.
const GACHON_LIST_HTML = `
  <table>
    <tr class="thumb">
      <td class="td-subject"><a href="https://www.gachon.ac.kr/pr/1443/subview.do?idx=12345"><strong>가천대학교 글로벌캠퍼스 소식</strong></a></td>
      <td class="td-date">2026.08.20</td>
    </tr>
    <tr class="thumb">
      <td class="td-subject"><a href="https://www.gachon.ac.kr/pr/1443/subview.do?idx=12344"><strong>가천뉴스 두 번째 소식</strong></a></td>
      <td class="td-date">2026.08.19</td>
    </tr>
  </table>
`;

const SPA_EMPTY_ROOT_HTML = `
  <html>
    <body>
      <div id="app"></div>
      <script src="/static/js/main.a1b2c3.js"></script>
      <script src="/static/js/chunk-vendors.js"></script>
    </body>
  </html>
`;

// Jeonbuk National University (jbnu-official-news) real list markup pattern:
// no static href and no data-url/data-param -- navigation is carried purely
// by an onclick call with a string ID argument.
const JBNU_LIST_HTML = `
  <ul class="com-brd-list-05">
    <li><a href="javascript:;" onclick="pf_DetailMove('216600')">
      <div class="txt-box">
        <p class="title">송문호 교수, AI 시대 법 대응 통찰 담은 서적 출간</p>
      </div>
    </a></li>
    <li><a href="javascript:;" onclick="pf_DetailMove('216557')">
      <div class="txt-box">
        <p class="title">전북대, 지역 미래산업 도약 위한 역량 한데 모은다</p>
      </div>
    </a></li>
  </ul>
`;

// Same onclick-ID-call shape, but with a trailing semicolon inside the
// attribute value (pf_DetailMove('216600');) -- must still be detected.
const JBNU_LIST_HTML_WITH_SEMICOLON = `
  <ul class="com-brd-list-05">
    <li><a href="javascript:;" onclick="pf_DetailMove('216600');">첫 번째 공지</a></li>
    <li><a href="javascript:;" onclick="pf_DetailMove('216557');">두 번째 공지</a></li>
  </ul>
`;

// Generic UI click handlers that must NOT be mistaken for ID-based
// detail-navigation: a zero-argument toggle, and an alert/confirm with a
// human-readable (spaced, Korean, punctuated) message argument.
const GENERIC_ONCLICK_HTML = `
  <ul>
    <li><a href="javascript:;" onclick="toggleMenu()">메뉴</a></li>
    <li><a href="javascript:;" onclick="alert('정말 삭제하시겠습니까?')">삭제</a></li>
    <li><a href="javascript:void(0)" onclick="return false;">맨 위로</a></li>
  </ul>
`;

// A composite fixture reproducing the shape actually found on the real
// jbnu-official-news full page: a large header/footer nav (many ordinary
// static hrefs), a login shortcut duplicated identically in a desktop +
// mobile menu (`cf_login('currentPage')` twice, SAME argument both times),
// and 5 real list items each calling the same function with a DIFFERENT
// numeric id. The old "risky count >= static count" dominance rule alone
// would never fire here (static links vastly outnumber the risky ones).
function buildRealPageShapedHtml() {
  const staticNavLinks = Array.from({ length: 40 }, (_, i) => `<li><a href="/menu/path-${i}.do">메뉴 ${i}</a></li>`).join("\n");
  const duplicateLoginButton = `
    <a href="javascript:;" onclick="cf_login('currentPage');" title="로그인 화면 바로가기">로그인</a>
    <a href="javascript:;" onclick="cf_login('currentPage');" title="로그인 바로가기">로그인</a>
  `;
  const listItems = ["216600", "216557", "216554", "216552", "216524"]
    .map((id) => `<li><a href="javascript:;" onclick="pf_DetailMove('${id}')"><p class="title">공지 ${id}</p></a></li>`)
    .join("\n");
  return `<ul class="gnb">${staticNavLinks}</ul>${duplicateLoginButton}<ul class="com-brd-list-05">${listItems}</ul>`;
}

// The same duplicated login button in isolation, with NO list items at all --
// must never trigger the repetition signal on its own (same function, same
// argument every time = not "different targets").
const DUPLICATE_LOGIN_BUTTON_ONLY_HTML = `
  <ul class="gnb">
    ${Array.from({ length: 20 }, (_, i) => `<li><a href="/menu/path-${i}.do">메뉴 ${i}</a></li>`).join("\n")}
  </ul>
  <a href="javascript:;" onclick="cf_login('currentPage');" title="로그인 화면 바로가기">로그인</a>
  <a href="javascript:;" onclick="cf_login('currentPage');" title="로그인 바로가기">로그인</a>
`;

// A single onclick(id)-call anchor surrounded by many ordinary static
// links -- one button alone must not trigger the repetition signal.
const SINGLE_ONCLICK_CALL_HTML = `
  <ul class="gnb">
    ${Array.from({ length: 20 }, (_, i) => `<li><a href="/menu/path-${i}.do">메뉴 ${i}</a></li>`).join("\n")}
  </ul>
  <li><a href="javascript:;" onclick="pf_DetailMove('216600')">공지 하나</a></li>
`;

// Two data-url/data-param anchors surrounded by many static links, with
// DIFFERENT data-param values -- must bypass the dominance rule via the new
// value-based repetition signal.
function buildDataAttrRepeatedAmongManyStaticLinksHtml() {
  const staticNavLinks = Array.from({ length: 40 }, (_, i) => `<li><a href="/menu/path-${i}.do">메뉴 ${i}</a></li>`).join("\n");
  const listItems = ["54635", "54634"]
    .map((id) => `<li><a href="javascript:;" data-url="/snue/na/ntt/selectNttInfo.do" data-nm="nttSn" data-param="${id}">공지 ${id}</a></li>`)
    .join("\n");
  return `<ul class="gnb">${staticNavLinks}</ul><ul class="board-list">${listItems}</ul>`;
}

// Two anchors carrying the exact same data-url/data-param/data-nm *values*,
// but with the raw attribute text differing (different attribute order and
// spacing) -- distinctness must be judged on the extracted values, not the
// raw attribute string, so this must NOT count as "different targets".
const DATA_ATTR_SAME_VALUES_DIFFERENT_RAW_TEXT_HTML = `
  <li><a href="javascript:;" data-url="/board/x.do" data-nm="nttSn" data-param="123">공지</a></li>
  <li><a data-param="123"   data-nm="nttSn"  data-url="/board/x.do" href="javascript:;">같은 공지 (속성 순서만 다름)</a></li>
`;

// Dankook University Jukjeon (dankook-university-news) real list markup
// pattern: no `javascript:` href and no data-url/data-param -- navigation is
// carried by `href="#none"` plus an onclick call with an ID argument
// followed by boolean flags (isAuth, isGuestBbsMessage). Real IDs pulled
// from the live site during investigation.
const DANKOOK_LIST_HTML = `
  <div class="dku-list-body-item"><h4><a href="#none" onclick="_dku_bbs_web_BbsPortlet_viewMessage(181003, true, false)">'더 큰 세상으로' 2026년 가을 학위수여식 열려, 단국인 1,969명 새 출발</a></h4></div>
  <div class="dku-list-body-item"><h4><a href="#none" onclick="_dku_bbs_web_BbsPortlet_viewMessage(180021, true, false)">대학혁신지원사업 성과평가 3년 연속 'S등급' 획득!!</a></h4></div>
  <div class="dku-list-body-item"><h4><a href="#none" onclick="_dku_bbs_web_BbsPortlet_viewMessage(181008, true, false)">"AI 시대 대학 혁신 주역" 신임 교직원·보직자 58명 임명장 수여</a></h4></div>
`;

// A page's ordinary in-page navigation anchors (`href="#section"`,
// `href="#top"`) must NOT be treated as non-navigating -- only an exact `#`
// or `#none` match should widen the js-only gate.
const HASH_FRAGMENT_ANCHORS_HTML = `
  <nav>
    <a href="#section">본문 바로가기</a>
    <a href="#top">맨 위로</a>
    <a href="#footer">푸터로 이동</a>
  </nav>
`;

// The Dankook pattern reproduced inside a realistic page shape: many static
// nav links surrounding the board's list items, same as the JBNU composite
// fixture above -- the old "risky count >= static count" dominance rule
// alone would not fire here.
function buildDankookRealPageShapedHtml() {
  const staticNavLinks = Array.from({ length: 40 }, (_, i) => `<li><a href="/menu/path-${i}.do">메뉴 ${i}</a></li>`).join("\n");
  const listItems = ["181003", "180021", "181008", "181115", "181002"]
    .map((id) => `<div class="dku-list-body-item"><h4><a href="#none" onclick="_dku_bbs_web_BbsPortlet_viewMessage(${id}, true, false)">뉴스 ${id}</a></h4></div>`)
    .join("\n");
  return `<ul class="gnb">${staticNavLinks}</ul>${listItems}`;
}

// A single `href="#none"` + onclick(id) anchor surrounded by many ordinary
// static links -- one button alone must not trigger the repetition signal,
// mirroring the existing JBNU single-button negative test above.
const SINGLE_DANKOOK_STYLE_BUTTON_HTML = `
  <ul class="gnb">
    ${Array.from({ length: 20 }, (_, i) => `<li><a href="/menu/path-${i}.do">메뉴 ${i}</a></li>`).join("\n")}
  </ul>
  <a href="#none" onclick="_dku_bbs_web_BbsPortlet_viewMessage(181003, true, false)">단일 게시물 바로가기</a>
`;

const CNU_ENGLISH_LIST_HTML = `
  <table>
    <tr><td><a href="https://plus.cnu.ac.kr/_prog/_board/?code=sub0307&amp;menu_dvs_cd=0507&amp;site_dvs_cd=en&amp;idx=1">CNU launches new global partnership program</a></td></tr>
    <tr><td><a href="https://plus.cnu.ac.kr/_prog/_board/?code=sub0307&amp;menu_dvs_cd=0507&amp;site_dvs_cd=en&amp;idx=2">Chungnam National University hosts international symposium</a></td></tr>
  </table>
`;

test("detectJsOnlyLinkRisk flags the SNUE javascript:+data-url pattern", () => {
  const result = detectJsOnlyLinkRisk(SNUE_LIST_HTML);
  assert.equal(result.detected, true);
  assert.equal(result.staticHrefCount, 0);
  assert.ok(result.jsOnlyCount >= 2);
});

test("detectJsOnlyLinkRisk does not flag a normal absolute-href list (Gachon Global Campus pattern)", () => {
  const result = detectJsOnlyLinkRisk(GACHON_LIST_HTML);
  assert.equal(result.detected, false);
  assert.ok(result.staticHrefCount >= 2);
  assert.equal(result.jsOnlyCount, 0);
});

// --- Regression: onclick="functionName('id')" ID-call pattern (Jeonbuk
// National University jbnu-official-news) must be detected even though it
// has neither a static href nor a data-url/data-param attribute. ---

test("detectJsOnlyLinkRisk flags the JBNU onclick(id)-call pattern (no data-url/data-param at all)", () => {
  const result = detectJsOnlyLinkRisk(JBNU_LIST_HTML);
  assert.equal(result.detected, true);
  assert.equal(result.staticHrefCount, 0);
  assert.equal(result.dataAttrMatchCount, 0);
  assert.ok(result.onclickIdCallMatchCount >= 2);
  assert.ok(result.sampleAttrs.some((attrs) => attrs.includes("pf_DetailMove")));
});

test("detectJsOnlyLinkRisk flags the JBNU pattern even with a trailing semicolon inside onclick (pf_DetailMove('216600');)", () => {
  const result = detectJsOnlyLinkRisk(JBNU_LIST_HTML_WITH_SEMICOLON);
  assert.equal(result.detected, true);
  assert.ok(result.onclickIdCallMatchCount >= 2);
});

test("detectJsOnlyLinkRisk does not flag generic onclick handlers (zero-arg toggle, human-readable message argument, bare 'return false;')", () => {
  const result = detectJsOnlyLinkRisk(GENERIC_ONCLICK_HTML);
  assert.equal(result.detected, false);
  assert.equal(result.onclickIdCallMatchCount, 0);
  assert.equal(result.dataAttrMatchCount, 0);
});

test("data-url/data-param detection still takes priority and is unaffected by the new onclick check (SNUE regression)", () => {
  const result = detectJsOnlyLinkRisk(SNUE_LIST_HTML);
  assert.equal(result.detected, true);
  assert.ok(result.dataAttrMatchCount >= 2);
  assert.equal(result.onclickIdCallMatchCount, 0);
});

// --- Regression: Dankook University Jukjeon (dankook-university-news) uses
// href="#none" (not "javascript:") plus onclick("functionName(id, true,
// false)") -- neither the old javascript:-only gate nor the old
// numeric/quoted-only argument check recognized this pattern, so it was
// misclassified as READY. Both the href gate and the argument shape check
// needed to widen for this real pattern to be caught. ---

test("detectJsOnlyLinkRisk flags the real Dankook University href=#none + onclick(id, true, false) pattern", () => {
  const result = detectJsOnlyLinkRisk(DANKOOK_LIST_HTML);
  assert.equal(result.detected, true);
  assert.equal(result.staticHrefCount, 0);
  assert.equal(result.dataAttrMatchCount, 0);
  assert.equal(result.onclickIdCallMatchCount, 3);
  assert.equal(result.onclickIdCallRepeated, true);
  assert.ok(result.sampleAttrs.some((attrs) => attrs.includes("_dku_bbs_web_BbsPortlet_viewMessage")));
});

test("detectJsOnlyLinkRisk does not flag ordinary in-page hash anchors (href=#section, href=#top) as non-navigating", () => {
  const result = detectJsOnlyLinkRisk(HASH_FRAGMENT_ANCHORS_HTML);
  assert.equal(result.detected, false);
  assert.equal(result.jsOnlyCount, 0);
  assert.ok(result.staticHrefCount >= 3);
});

test("detectJsOnlyLinkRisk flags the Dankook pattern even surrounded by many ordinary static nav links (dominance rule alone would not fire)", () => {
  const result = detectJsOnlyLinkRisk(buildDankookRealPageShapedHtml());
  assert.ok(result.staticHrefCount > result.onclickIdCallMatchCount, "this fixture must reproduce a static-link-dominant page");
  assert.equal(result.detected, true);
  assert.equal(result.onclickIdCallRepeated, true);
});

test("detectJsOnlyLinkRisk does NOT flag a single href=#none onclick(id) anchor surrounded by many static links (one button alone must not trigger)", () => {
  const result = detectJsOnlyLinkRisk(SINGLE_DANKOOK_STYLE_BUTTON_HTML);
  assert.equal(result.detected, false);
  assert.equal(result.onclickIdCallRepeated, false);
  assert.equal(result.onclickIdCallMatchCount, 1);
});

// --- Regression: the real jbnu-official-news full page has 642 ordinary
// static hrefs against only 12 onclick-based list items, so the old
// "risky count >= static count" dominance rule alone never fires. The new
// "same function, different targets, repeated >=2 times" signal must catch
// this regardless of how many unrelated static links exist on the page. ---

test("detectJsOnlyLinkRisk flags the real jbnu-official-news page shape (many static nav links + duplicated login button + 5 distinct-id list items) even though static links vastly outnumber risky ones", () => {
  const result = detectJsOnlyLinkRisk(buildRealPageShapedHtml());
  assert.ok(result.staticHrefCount > result.onclickIdCallMatchCount + result.dataAttrMatchCount, "this fixture must reproduce a static-link-dominant page");
  assert.equal(result.detected, true);
  assert.equal(result.onclickIdCallRepeated, true);
});

test("detectJsOnlyLinkRisk does NOT flag a login button duplicated with the identical argument (desktop + mobile nav), even with no list items", () => {
  const result = detectJsOnlyLinkRisk(DUPLICATE_LOGIN_BUTTON_ONLY_HTML);
  assert.equal(result.detected, false);
  assert.equal(result.onclickIdCallRepeated, false);
  assert.ok(result.onclickIdCallMatchCount >= 2, "cf_login(...) must still be recognized as an ID-like call, just not as a repeated-distinct-target pattern");
});

test("detectJsOnlyLinkRisk does NOT flag a single onclick(id)-call anchor surrounded by many static links (one button alone must not trigger)", () => {
  const result = detectJsOnlyLinkRisk(SINGLE_ONCLICK_CALL_HTML);
  assert.equal(result.detected, false);
  assert.equal(result.onclickIdCallRepeated, false);
  assert.equal(result.onclickIdCallMatchCount, 1);
});

test("detectJsOnlyLinkRisk flags data-url/data-param anchors with distinct data-param values even among many static links", () => {
  const result = detectJsOnlyLinkRisk(buildDataAttrRepeatedAmongManyStaticLinksHtml());
  assert.ok(result.staticHrefCount > result.dataAttrMatchCount, "this fixture must reproduce a static-link-dominant page");
  assert.equal(result.detected, true);
  assert.equal(result.dataAttrRepeated, true);
});

test("data-url/data-param distinctness is judged by extracted attribute VALUES, not raw attribute text (same values, different attribute order/spacing must NOT count as different targets)", () => {
  const result = detectJsOnlyLinkRisk(DATA_ATTR_SAME_VALUES_DIFFERENT_RAW_TEXT_HTML);
  assert.equal(result.dataAttrMatchCount, 2);
  assert.equal(result.dataAttrRepeated, false, "identical data-url/data-param/data-nm values must be treated as the same target regardless of raw attribute text differences");
});

test("detectSpaRisk flags an empty app root plus bundled script markers with no static anchors", () => {
  const result = detectSpaRisk(SPA_EMPTY_ROOT_HTML);
  assert.equal(result.detected, true);
  assert.equal(result.hasSpaRootMarker, true);
  assert.equal(result.hasScriptBundleMarker, true);
  assert.equal(result.staticAnchorCount, 0);
});

test("detectSpaRisk does not flag a normal server-rendered list (Gachon Global Campus pattern)", () => {
  const result = detectSpaRisk(GACHON_LIST_HTML);
  assert.equal(result.detected, false);
});

test("detectNonKoreanBoardFlag flags the CNU site_dvs_cd=en listUrl pattern", () => {
  const result = detectNonKoreanBoardFlag({ listUrl: "https://plus.cnu.ac.kr/_prog/_board/?code=sub0307&menu_dvs_cd=0507&site_dvs_cd=en", html: CNU_ENGLISH_LIST_HTML });
  assert.equal(result.detected, true);
  assert.match(result.reason, /site_dvs_cd=en/);
});

test("detectNonKoreanBoardFlag flags English-only body content even without an explicit query hint", () => {
  const result = detectNonKoreanBoardFlag({ listUrl: "https://example.ac.kr/board/list.do", html: "<html><body>Notice: Spring semester registration opens Monday.</body></html>" });
  assert.equal(result.detected, true);
});

test("detectNonKoreanBoardFlag does not flag a Korean-language board (Gachon Global Campus pattern)", () => {
  const result = detectNonKoreanBoardFlag({ listUrl: "https://www.gachon.ac.kr/pr/1443/subview.do", html: GACHON_LIST_HTML });
  assert.equal(result.detected, false);
});

test("scoreStaticHtmlLikelihood scores higher for a link-rich list than for an empty SPA root", () => {
  const richScore = scoreStaticHtmlLikelihood(GACHON_LIST_HTML).score;
  const spaScore = scoreStaticHtmlLikelihood(SPA_EMPTY_ROOT_HTML).score;
  assert.ok(richScore > spaScore);
});

test("all heuristics tolerate empty/missing HTML without throwing", () => {
  assert.doesNotThrow(() => detectJsOnlyLinkRisk(""));
  assert.doesNotThrow(() => detectJsOnlyLinkRisk(undefined));
  assert.doesNotThrow(() => detectSpaRisk(""));
  assert.doesNotThrow(() => detectNonKoreanBoardFlag({}));
  assert.doesNotThrow(() => scoreStaticHtmlLikelihood(""));
});
