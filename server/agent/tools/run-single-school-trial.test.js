"use strict";

// Requiring this file must never trigger a real run (network fetch, backup,
// save) -- main() only auto-runs when this file is executed directly via
// `node run-single-school-trial.js`, guarded by `require.main === module`.
const assert = require("node:assert/strict");
const test = require("node:test");
const { assertSourceEnabledForSave, sameText, extractDetail, selectSource, titleMatches, universityNameMatches } = require("./run-single-school-trial");

test("a real save is blocked while the source is verified but not yet enabled", () => {
  const source = { id: "kaist-official-news", enabled: false };
  assert.throws(
    () => assertSourceEnabledForSave(source, "kaist-daejeon", false),
    (error) => {
      assert.match(error.message, /kaist-official-news/);
      assert.match(error.message, /kaist-daejeon/);
      assert.match(error.message, /not yet activated/i);
      assert.match(error.message, /enabled=false/);
      return true;
    }
  );
});

test("--diagnose is allowed against a verified source even when enabled=false", () => {
  const source = { id: "kaist-official-news", enabled: false };
  assert.doesNotThrow(() => assertSourceEnabledForSave(source, "kaist-daejeon", true));
});

test("a real save proceeds once the source is enabled=true", () => {
  const source = { id: "kaist-official-news", enabled: true };
  assert.doesNotThrow(() => assertSourceEnabledForSave(source, "kaist-daejeon", false));
});

test("enabled=false still blocks a real save for a non-KAIST source (not KAIST-specific)", () => {
  const source = { id: "some-other-source", enabled: false };
  assert.throws(() => assertSourceEnabledForSave(source, "some-other-university", false));
});

test("sameText() still matches a detail title against the list title despite a trailing invisible character (KAIST-style)", () => {
  const source = { detailSelectors: { title: "div.prog_tit strong", date: "div.prog_stit span.date" } };
  const html = '<div class="prog_tit"><strong>전기차 급속충전 배터리 수명 두 마리 토끼 잡는다​</strong></div>'
    + '<div class="prog_stit"><span class="date">등록일 : 2026-08-24</span></div>';
  const detail = extractDetail(html, source, null);
  // cleanTitle() only strips tokens explicitly listed in titleCleanupTokens
  // (none here), so the raw invisible character stays in detail.title --
  // it is normalizeText()/sameText() that neutralizes it for comparison.
  assert.equal(detail.publishedAt, "2026-08-24");
  assert.equal(sameText("전기차 급속충전 배터리 수명 두 마리 토끼 잡는다", detail.title), true);
});

test("extractDetail applies source.titleCleanupTokens so a detail-only badge does not break the title match", () => {
  const source = { detailSelectors: { title: "div.title strong", date: "ul.detail li" }, titleCleanupTokens: ["새글"] };
  const html = '<div class="title"><strong>새글 고려대 공식 소식</strong></div><ul class="detail"><li>2026.08.10</li></ul>';
  const detail = extractDetail(html, source, null);
  assert.equal(detail.title, "고려대 공식 소식");
  assert.equal(sameText("고려대 공식 소식", detail.title), true);
});

test("selectSource picks the source whose id matches --source-id, among multiple qualifying sources", () => {
  const university = {
    universityId: "pusan-national-university",
    sources: [
      { id: "pnu-main-notice", sourceType: "official", verified: true, collectionType: "html" },
      { id: "pnu-press-release", sourceType: "official", verified: true, collectionType: "html" },
    ],
  };
  const source = selectSource(university, "pnu-press-release");
  assert.equal(source.id, "pnu-press-release");
});

test("selectSource fails clearly (before any network/save work) when --source-id does not match a qualifying source", () => {
  const university = {
    universityId: "pusan-national-university",
    sources: [
      { id: "pnu-main-notice", sourceType: "official", verified: true, collectionType: "html" },
      { id: "pnu-press-release", sourceType: "official", verified: true, collectionType: "html" },
    ],
  };
  assert.throws(
    () => selectSource(university, "does-not-exist"),
    (error) => {
      assert.match(error.message, /does-not-exist/);
      assert.match(error.message, /pusan-national-university/);
      return true;
    }
  );
});

test("selectSource without --source-id keeps the original behavior: first qualifying source", () => {
  const university = {
    universityId: "pusan-national-university",
    sources: [
      { id: "pnu-main-notice", sourceType: "official", verified: true, collectionType: "html" },
      { id: "pnu-press-release", sourceType: "official", verified: true, collectionType: "html" },
    ],
  };
  const source = selectSource(university, null);
  assert.equal(source.id, "pnu-main-notice");
});

test("titleMatches: identical list/detail titles pass with no flag needed (no regression)", () => {
  const source = { id: "some-source" };
  const title = "부산대학교 2026학년도 정시모집 요강 발표 및 세부 일정 안내";
  assert.equal(titleMatches(source, title, title), true);
});

test("titleMatches: allowTruncatedListTitle=true accepts a literal-ellipsis-truncated list title as a prefix of the detail title", () => {
  const source = { id: "pnu-main-notice", allowTruncatedListTitle: true };
  const listTitle = "부산대학교 2026학년도 정시모집 요강 발표...";
  const detailTitle = "부산대학교 2026학년도 정시모집 요강 발표 및 세부 일정 안내";
  assert.equal(titleMatches(source, listTitle, detailTitle), true);
});

test("titleMatches: allowTruncatedListTitle=true also accepts the unicode ellipsis (…) form", () => {
  const source = { id: "pnu-main-notice", allowTruncatedListTitle: true };
  const listTitle = "부산대학교 2026학년도 정시모집 요강 발표…";
  const detailTitle = "부산대학교 2026학년도 정시모집 요강 발표 및 세부 일정 안내";
  assert.equal(titleMatches(source, listTitle, detailTitle), true);
});

test("titleMatches: without the opt-in flag, the same truncated title still fails (core regression guard)", () => {
  const sourceWithoutFlag = { id: "some-other-source" };
  const sourceWithFlagFalse = { id: "some-other-source", allowTruncatedListTitle: false };
  const listTitle = "부산대학교 2026학년도 정시모집 요강 발표...";
  const detailTitle = "부산대학교 2026학년도 정시모집 요강 발표 및 세부 일정 안내";
  assert.equal(titleMatches(sourceWithoutFlag, listTitle, detailTitle), false);
  assert.equal(titleMatches(sourceWithFlagFalse, listTitle, detailTitle), false);
});

test("titleMatches: a similar-looking prefix that is actually a different article still fails", () => {
  const source = { id: "pnu-main-notice", allowTruncatedListTitle: true };
  const listTitle = "부산대학교 총장배 전국 고등학생 토론대회 개최 안내...";
  const detailTitle = "부산대학교 총장배 전국 고등학생 토론대회 결과 발표";
  assert.equal(titleMatches(source, listTitle, detailTitle), false);
});

test("titleMatches: a too-short truncated prefix is rejected even with the flag on", () => {
  const source = { id: "pnu-main-notice", allowTruncatedListTitle: true };
  const listTitle = "안내...";
  const detailTitle = "안내 드립니다 관련 세부 사항을 확인하세요";
  assert.equal(titleMatches(source, listTitle, detailTitle), false);
});

test("universityNameMatches: fails independently of the title check when the official name is absent from the detail HTML", () => {
  const source = { id: "pnu-main-notice" };
  const university = { universityName: "부산대학교" };
  const html = "<html><body><h1>알 수 없는 사이트</h1><p>공지사항 본문</p></body></html>";
  assert.equal(universityNameMatches(source, university, html), false);
});
