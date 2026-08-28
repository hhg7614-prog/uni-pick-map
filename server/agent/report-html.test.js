"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeHtmlReport } = require("./report-html");

function render(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uni-pick-report-"));
  const file = path.join(dir, "report.html");
  try {
    writeHtmlReport(file, "테스트 리포트", data);
    return fs.readFileSync(file, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("universityBreakdown 은 3개 소표로 렌더되고 학교명/신규수/사유를 포함한다", () => {
  const html = render({
    status: "SUCCESS",
    universityBreakdown: {
      updated: [{ universityName: "가대", newCount: 3 }],
      noNewItems: [{ universityName: "나대", reason: "신규 게시물 없음 (중복 1건)" }],
      failed: [{ universityName: "목포대학교", reason: "WAF 차단" }],
    },
  });
  assert.match(html, /학교별 업데이트 내역/);
  assert.match(html, /<h4>업데이트 완료<\/h4>/);
  assert.match(html, /<h4>변경 없음<\/h4>/);
  assert.match(html, /<h4>수집 실패<\/h4>/);
  assert.match(html, /가대/);
  assert.match(html, /<td>3<\/td>/);
  assert.match(html, /나대/);
  assert.match(html, /신규 게시물 없음 \(중복 1건\)/);
  assert.match(html, /목포대학교/);
  assert.match(html, /WAF 차단/);
  assert.match(html, /업데이트 완료 1개교 \(신규 3건\) \/ 변경 없음 1개교 \/ 수집 실패 1개교/);
});

test("사유의 < 와 & 는 이스케이프된다", () => {
  const html = render({
    universityBreakdown: {
      updated: [],
      noNewItems: [],
      failed: [{ universityName: "A대 <b>", reason: "타임아웃 & <error>" }],
    },
  });
  assert.match(html, /타임아웃 &amp; &lt;error&gt;/);
  assert.match(html, /A대 &lt;b&gt;/);
  assert.doesNotMatch(html, /<error>/);
});

test("빈 목록은 '없음' 으로 표시된다", () => {
  const html = render({
    universityBreakdown: { updated: [], noNewItems: [], failed: [] },
  });
  const matches = html.match(/<p class="ubk-empty">없음<\/p>/g) || [];
  assert.equal(matches.length, 3);
});

test("universityBreakdown 이 없는 payload 는 기존과 동일하게 <pre> 로 렌더된다 (회귀)", () => {
  const html = render({
    status: "NO_CHANGES",
    processed: 42,
    messageKo: "새로운 뉴스가 없습니다.",
  });
  assert.match(html, /<th>status<\/th><td><pre>NO_CHANGES<\/pre><\/td>/);
  assert.match(html, /<th>processed<\/th><td><pre>42<\/pre><\/td>/);
  assert.match(html, /<th>messageKo<\/th><td><pre>새로운 뉴스가 없습니다\.<\/pre><\/td>/);
  assert.doesNotMatch(html, /학교별 업데이트 내역/);
});

test("신규 카운트 키(updatedCount 등)는 여전히 <pre> 로 렌더된다", () => {
  const html = render({
    updatedCount: 2,
    noNewItemsCount: 3,
    failedCount: 1,
    totalTargets: 6,
    universityBreakdown: { updated: [], noNewItems: [], failed: [] },
  });
  assert.match(html, /<th>updatedCount<\/th><td><pre>2<\/pre><\/td>/);
  assert.match(html, /<th>totalTargets<\/th><td><pre>6<\/pre><\/td>/);
});
