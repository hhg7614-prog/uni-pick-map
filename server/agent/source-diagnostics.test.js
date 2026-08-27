"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const diagnostics = require("./source-diagnostics");

test("247개 대학 진단 dry-run은 외부 요청 없이 전체 목록을 확인한다", () => {
  const catalog = diagnostics.loadCatalog();
  const result = diagnostics.createDryRun(catalog);
  assert.equal(catalog.length, 247);
  assert.equal(result.totalUniversities, 247);
  assert.equal(result.validUniversityIds, 247);
  assert.equal(result.expectedBatches, 25);
});

test("게시일은 실제 한국어 날짜 형식만 ISO 날짜로 변환한다", () => {
  assert.equal(diagnostics.parseDate("등록일 2026. 8. 7.").value, "2026-08-07");
  assert.equal(diagnostics.parseDate("2026년 8월 7일").value, "2026-08-07");
  assert.equal(diagnostics.parseDate("조회수 123").value, null);
});

test("추적 파라미터가 달라도 같은 공식 URL로 정규화한다", () => {
  assert.equal(
    diagnostics.canonicalUrl("https://WWW.example.ac.kr/news?id=1&utm_source=test#section"),
    "https://www.example.ac.kr/news?id=1"
  );
});

test("후보 점수는 공식 상세 링크와 실제 날짜가 있을 때만 높은 등급이 된다", () => {
  const accepted = diagnostics.scoreCandidate({ official: true, recent: true, detailCount: 1, dateCount: 1, titleMatches: 1, stable: true, pagination: true, social: false, error: false });
  const rejected = diagnostics.scoreCandidate({ official: false, recent: false, detailCount: 0, dateCount: 0, titleMatches: 0, stable: false, pagination: false, social: true, error: true });
  assert.equal(accepted.grade, "A");
  assert.equal(rejected.grade, "D");
});
