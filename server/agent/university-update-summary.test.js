"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyUniversityResults,
  buildUniversitySummaryLines,
  buildTailLines,
} = require("./university-update-summary");

// 기존 payload 술어(회귀 안전용) — run-scheduled-news-update.js 와 동일한 식.
const hasErrorPredicate = x => x.error || (x.errors || []).length;

test("혼합 입력을 세 배열과 카운트 4종으로 정확히 분류한다", () => {
  const input = [
    { universityName: "가대", newCount: 3, duplicateCount: 1 },
    { universityName: "나대", newCount: 4, duplicateCount: 0 },
    { universityName: "다대", newCount: 0, duplicateCount: 2 },
    { universityName: "라대", newCount: 0, duplicateCount: 0 },
    { universityName: "마대", newCount: 0 },
    { universityName: "바대", error: "WAF 차단" },
  ];
  const b = classifyUniversityResults(input);
  assert.deepEqual(b.updated, [
    { universityName: "가대", newCount: 3 },
    { universityName: "나대", newCount: 4 },
  ]);
  assert.deepEqual(b.noNewItems, [
    { universityName: "다대", reason: "신규 게시물 없음 (중복 2건)" },
    { universityName: "라대", reason: "신규 게시물 없음 (중복 0건)" },
    { universityName: "마대", reason: "신규 게시물 없음 (중복 0건)" },
  ]);
  assert.deepEqual(b.failed, [{ universityName: "바대", reason: "WAF 차단" }]);
  assert.equal(b.updatedCount, 2);
  assert.equal(b.noNewItemsCount, 3);
  assert.equal(b.failedCount, 1);
  assert.equal(b.totalTargets, 6);
});

test("updated 항목은 newCount > 0 인 학교만 { universityName, newCount } 형태로 포함한다", () => {
  const b = classifyUniversityResults([
    { universityName: "A", newCount: 0 },
    { universityName: "B", newCount: 2 },
  ]);
  assert.equal(b.updated.length, 1);
  assert.deepEqual(b.updated[0], { universityName: "B", newCount: 2 });
});

test("noNewItems reason 은 duplicateCount 를 사용하고 누락 시 0 이다", () => {
  const b = classifyUniversityResults([
    { universityName: "A", newCount: 0, duplicateCount: 7 },
    { universityName: "B", newCount: 0 },
  ]);
  assert.equal(b.noNewItems[0].reason, "신규 게시물 없음 (중복 7건)");
  assert.equal(b.noNewItems[1].reason, "신규 게시물 없음 (중복 0건)");
});

test("빈 입력과 undefined 입력은 전부 0 이다", () => {
  for (const input of [[], undefined]) {
    const b = classifyUniversityResults(input);
    assert.deepEqual(b.updated, []);
    assert.deepEqual(b.noNewItems, []);
    assert.deepEqual(b.failed, []);
    assert.equal(b.updatedCount, 0);
    assert.equal(b.noNewItemsCount, 0);
    assert.equal(b.failedCount, 0);
    assert.equal(b.totalTargets, 0);
  }
});

test("불변식: updatedCount + noNewItemsCount + failedCount === totalTargets", () => {
  const input = [
    { universityName: "A", newCount: 1 },
    { universityName: "B", newCount: 0, duplicateCount: 3 },
    { universityName: "C", error: "boom" },
    { universityName: "D", errors: ["s1: 403"] },
    { universityName: "E", newCount: 0 },
  ];
  const b = classifyUniversityResults(input);
  assert.equal(b.updatedCount + b.noNewItemsCount + b.failedCount, b.totalTargets);
});

test("실패 사유: r.error 는 String(r.error) 그대로 전달한다", () => {
  const b = classifyUniversityResults([{ universityName: "A", error: "SCHEDULER_WAF_BLOCK" }]);
  assert.equal(b.failed[0].reason, "SCHEDULER_WAF_BLOCK");
});

test("실패 사유: errors 배열은 '; ' 로 결합하고 순서를 보존한다", () => {
  const b = classifyUniversityResults([
    { universityName: "A", errors: ["main-notice: 403", "press: timeout"] },
  ]);
  assert.equal(b.failed[0].reason, "main-notice: 403; press: timeout");
});

test("실패 사유: errors 의 falsy 항목은 제거한다", () => {
  const b = classifyUniversityResults([{ universityName: "A", errors: ["a", "", null, "b"] }]);
  assert.equal(b.failed[0].reason, "a; b");
});

test("우선순위: newCount > 0 이어도 errors 가 있으면 failed 로 분류한다", () => {
  const b = classifyUniversityResults([
    { universityName: "A", newCount: 5, errors: ["x: 500"] },
  ]);
  assert.equal(b.updatedCount, 0);
  assert.equal(b.failedCount, 1);
  assert.equal(b.failed[0].reason, "x: 500");
});

test("errors: [] (빈 배열) 은 실패가 아니다", () => {
  const b = classifyUniversityResults([
    { universityName: "A", newCount: 2, errors: [] },
    { universityName: "B", newCount: 0, errors: [] },
  ]);
  assert.equal(b.updatedCount, 1);
  assert.equal(b.noNewItemsCount, 1);
  assert.equal(b.failedCount, 0);
});

test("이름 누락 시 '(이름 없음)' 으로 채운다", () => {
  const b = classifyUniversityResults([{ newCount: 1 }]);
  assert.equal(b.updated[0].universityName, "(이름 없음)");
});

test("기존 payload 술어와의 불변식이 성립한다 (하위 호환)", () => {
  const universityResults = [
    { universityName: "A", newCount: 3 },
    { universityName: "B", newCount: 0, duplicateCount: 1 },
    { universityName: "C", newCount: 0 },
    { universityName: "D", error: "boom" },
    { universityName: "E", errors: ["s: 1"] },
  ];
  const b = classifyUniversityResults(universityResults);
  const legacyProcessed = universityResults.length;
  const legacyFailed = universityResults.filter(hasErrorPredicate).length;
  const legacySuccess = universityResults.filter(x => !hasErrorPredicate(x)).length;
  assert.equal(b.failedCount, legacyFailed);
  assert.equal(b.totalTargets, legacyProcessed);
  assert.equal(b.updatedCount + b.noNewItemsCount, legacySuccess);
});

test("buildUniversitySummaryLines 는 3줄 고정 형식 + 실패 상세를 낸다", () => {
  const b = classifyUniversityResults([
    { universityName: "가대", newCount: 3 },
    { universityName: "나대", newCount: 4 },
    { universityName: "다대", newCount: 0 },
    { universityName: "라대", newCount: 0 },
    { universityName: "마대", newCount: 0 },
    { universityName: "목포대학교", error: "WAF 차단" },
  ]);
  assert.deepEqual(buildUniversitySummaryLines(b), [
    "업데이트 완료: 2개교 (신규 7건)",
    "변경 없음: 3개교",
    "수집 실패: 1개교",
    "- 목포대학교: WAF 차단",
  ]);
});

test("buildUniversitySummaryLines 는 카운트가 0이어도 3줄을 항상 낸다", () => {
  assert.deepEqual(buildUniversitySummaryLines(classifyUniversityResults([])), [
    "업데이트 완료: 0개교 (신규 0건)",
    "변경 없음: 0개교",
    "수집 실패: 0개교",
  ]);
  assert.deepEqual(buildUniversitySummaryLines(undefined), [
    "업데이트 완료: 0개교 (신규 0건)",
    "변경 없음: 0개교",
    "수집 실패: 0개교",
  ]);
});

test("messageKo 시연: base / 요약 / 꼬리 줄이 빈 줄로 구분되어 조립된다", () => {
  // run-scheduled-news-update.js 성공 분기의 messageKo 조립을 그대로 재현.
  const universityResults = [
    { universityName: "가대", newCount: 3 },
    { universityName: "나대", newCount: 4 },
    { universityName: "다대", newCount: 0, duplicateCount: 2 },
    { universityName: "라대", newCount: 0 },
    { universityName: "마대", newCount: 0 },
    { universityName: "목포대학교", error: "WAF 차단" },
  ];
  const breakdown = classifyUniversityResults(universityResults);
  const base = "뉴스 업데이트와 배포 요청이 완료되었습니다.";
  const payload = { storeAfter: 758, commitHash: "abc1234def5678" };
  const messageKo = [
    base,
    "",
    ...buildUniversitySummaryLines(breakdown),
    "",
    ...buildTailLines(payload, new Date("2026-08-28T09:31:00")),
  ].join("\n");
  assert.equal(
    messageKo,
    "뉴스 업데이트와 배포 요청이 완료되었습니다.\n" +
      "\n" +
      "업데이트 완료: 2개교 (신규 7건)\n" +
      "변경 없음: 3개교\n" +
      "수집 실패: 1개교\n" +
      "- 목포대학교: WAF 차단\n" +
      "\n" +
      "전체 758건 저장 · 커밋 abc1234 배포\n" +
      "다음 실행: 16:30"
  );
});

test("buildTailLines: 배포된 성공 분기 payload", () => {
  assert.deepEqual(
    buildTailLines({ storeAfter: 758, commitHash: "abc1234def" }, new Date("2026-08-28T09:00:00")),
    ["전체 758건 저장 · 커밋 abc1234 배포", "다음 실행: 16:30"]
  );
});

test("buildTailLines: NO_CHANGES(커밋 없음) 는 '배포 안 함'", () => {
  assert.deepEqual(
    buildTailLines({ storeAfter: 758, commitHash: null }, new Date("2026-08-28T16:45:00")),
    ["전체 758건 저장 · 배포 안 함", "다음 실행: 09:30"]
  );
});

test("buildTailLines: catch 분기(storeAfter/commitHash 없음) 는 다음 실행 줄만", () => {
  assert.deepEqual(
    buildTailLines({}, new Date("2026-08-28T09:00:00")),
    ["다음 실행: 16:30"]
  );
});

test("buildUniversitySummaryLines: 실패 학교가 여러 개면 전부 나열한다", () => {
  const b = classifyUniversityResults([
    { universityName: "A", error: "e1" },
    { universityName: "B", errors: ["main-notice: 403", "press: timeout"] },
  ]);
  const lines = buildUniversitySummaryLines(b);
  assert.equal(lines[2], "수집 실패: 2개교");
  assert.equal(lines[3], "- A: e1");
  assert.equal(lines[4], "- B: main-notice: 403; press: timeout");
});
