"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.OPENAI_API_KEY = "";
const { loadData } = require("./dataService");
const { recommend } = require("./recommendationService");

const data = loadData();
const query = (message) => recommend(message, data);

test("수도권 국립 컴퓨터 검색은 검증된 서울대·인천대 학과만 반환한다", async () => {
  const result = await query("수도권에 컴퓨터 전공할 수 있는 국립대 있어?");
  assert.deepEqual(Array.from(result.recommendations, (item) => item.university.id), ["seoul-national-university-gwanak", "incheon-national-university-본교"]);
  assert.ok(result.recommendations.every((item) => item.majors.some((major) => major.departmentName === "컴퓨터공학부")));
});

test("부산 사립 사회복지는 동아대 부민캠퍼스의 확인된 학과를 반환한다", async () => {
  const result = await query("부산에서 사회복지학과가 있는 사립대 알려줘.");
  assert.deepEqual(Array.from(result.recommendations, (item) => item.university.id), ["dong-a-university-bumin"]);
});

test("성적만 입력하면 추정하지 않고 제한 안내로 끝낸다", async () => {
  const result = await query("내신 3등급으로 갈 수 있는 대학 알려줘.");
  assert.equal(result.filters.needsScoreData, true);
  assert.equal(result.recommendations.length, 0);
  assert.match(result.answer, /성적 정보만으로는 합격 가능성을 안내할 수 없습니다/);
});

test("존재하지 않는 위치와 학교는 결과 없음으로 처리한다", async () => {
  assert.equal((await query("달에 있는 국립대 추천해 줘.")).recommendations.length, 0);
  assert.equal((await query("없는대학교 우주공학과 추천해 줘.")).recommendations.length, 0);
});

test("서울 근처는 수도권으로 변환한다", async () => {
  const result = await query("서울 근처에서 상담심리를 공부하고 싶어.");
  assert.deepEqual(Array.from(result.filters.regions), ["서울특별시", "경기도", "인천광역시"]);
  assert.match(result.notices.join(" "), /수도권 기준/);
});
