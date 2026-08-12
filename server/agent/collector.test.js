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

test("external video URLs are excluded before they can become null-dated news", () => {
  assert.equal(isExternalNewsUrl("https://youtu.be/example"), true);
  assert.equal(isExternalNewsUrl("https://news.yonsei.ac.kr/kr/academia/detail?bbSeq=1"), false);
});
