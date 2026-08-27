"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { officialDetailDate, isExternalNewsUrl } = require("./collector");

test("official detail date is used only when the visible detail title matches", () => {
  const source = { detailSelectors: { title: "h3.view__tit", date: "span.viewInfo__txt" } };
  const item = { title: "연세 공식 소식" };
  const html = '<h3 class="view__tit">연세 공식 소식</h3><span class="viewInfo__txt">2026.08.06</span>';
  assert.deepEqual(officialDetailDate(html, item, source), { value: "2026-08-06", rawDate: "2026.08.06" });
  assert.equal(officialDetailDate(html, { title: "다른 제목" }, source), null);
  assert.deepEqual(
    officialDetailDate('<h3 class="view__tit">연세 &#039;공식&#039; 소식</h3><span class="viewInfo__txt">2026.08.05</span>', { title: "연세 '공식' 소식" }, source),
    { value: "2026-08-05", rawDate: "2026.08.05" }
  );
});

test("official detail date survives an invisible character the list title does not have", () => {
  const source = { detailSelectors: { title: "div.prog_tit strong", date: "div.prog_stit span.date" } };
  const item = { title: "전기차 급속충전 배터리 수명 두 마리 토끼 잡는다" };
  const html = '<div class="prog_tit"><strong>전기차 급속충전 배터리 수명 두 마리 토끼 잡는다​</strong></div>'
    + '<div class="prog_stit"><span class="date">등록일 : 2026-08-24</span></div>';
  assert.deepEqual(officialDetailDate(html, item, source), { value: "2026-08-24", rawDate: "등록일 : 2026-08-24" });
});

test("official detail date is matched after titleCleanupTokens strips a badge only present on the detail page", () => {
  const source = {
    detailSelectors: { title: "div.title strong", date: "ul.detail li" },
    titleCleanupTokens: ["새글"],
  };
  const item = { title: "고려대 공식 소식" };
  const html = '<div class="title"><strong>새글 고려대 공식 소식</strong></div><ul class="detail"><li>2026.08.10</li></ul>';
  assert.deepEqual(officialDetailDate(html, item, source), { value: "2026-08-10", rawDate: "2026.08.10" });
});

test("a genuinely different detail title still fails to match, invisible characters aside", () => {
  const source = { detailSelectors: { title: "div.prog_tit strong", date: "div.prog_stit span.date" } };
  const item = { title: "전기차 급속충전 배터리 수명 두 마리 토끼 잡는다" };
  const html = '<div class="prog_tit"><strong>전혀 다른 기사 제목​</strong></div>'
    + '<div class="prog_stit"><span class="date">등록일 : 2026-08-24</span></div>';
  assert.equal(officialDetailDate(html, item, source), null);
});

test("external video URLs are excluded before they can become null-dated news", () => {
  assert.equal(isExternalNewsUrl("https://youtu.be/example"), true);
  assert.equal(isExternalNewsUrl("https://news.yonsei.ac.kr/kr/academia/detail?bbSeq=1"), false);
});
