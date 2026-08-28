# 목표

스케줄러 뉴스 업데이트(`run-scheduled-news-update.js`) 결과에 **학교별 업데이트 내역**을
추가한다. 현재는 `processed / success / failed` 같은 집계 수치만 남기고, `runOnce()` 가
이미 돌려주는 학교별 세부(`run.universityResults[]` 의 `collectedCount / newCount /
duplicateCount / error / errors[]`)를 그대로 버린다.

이번 작업으로 학교별 결과를 다음 3분류로 정리해서
(1) 재사용 가능한 **순수 함수**, (2) `payload` 의 **새 필드**, (3) `payload.messageKo`
**요약 줄**, (4) HTML 리포트의 **읽기 쉬운 표**, (5) 알림 팝업(PS1) 에 자동 반영되게 한다.

수집/중복 로직(`runner.js`, `collector.js`)은 절대 건드리지 않는다. 결과 집계·표현
계층에만 손댄다. git add/commit/push/배포는 실행하지 않는다.

# 요구사항

## 필수 기능

1. **순수 분류 함수** `classifyUniversityResults(universityResults)` 신설:
   입력 `run.universityResults[]` → 출력
   `{ updated[], noNewItems[], failed[], updatedCount, noNewItemsCount, failedCount, totalTargets }`.
   - `updated`: `newCount > 0` 인 학교 → `{ universityName, newCount }`
   - `noNewItems`: `error` 없고 `errors` 비어있고 `newCount === 0` →
     `{ universityName, reason: "신규 게시물 없음 (중복 N건)" }` (N = `duplicateCount ?? 0`)
   - `failed`: `error` 가 truthy 이거나 `errors` 배열에 항목이 1개 이상 →
     `{ universityName, reason }` (reason 규칙은 아래)
   - 카운트 4종은 각 배열 길이 / 전체 항목 수.
2. **실패 사유 문자열 규칙** (원본에서 정확히 전달, 가공/요약 금지):
   - `r.error` 가 truthy → `reason = String(r.error)`
   - 아니고 `r.errors` 에 항목이 있으면 → `reason = r.errors.filter(Boolean).join("; ")`
   - `runner.js` 근거: `collectForUniversity` 자체가 throw 하면 항목에 `error: error.message`
     (문자열, `errors` 없음). 소스 수집은 됐지만 일부 소스가 실패하면
     `errors: uResult.sourceResults.filter(s => s.error).map(s => \`${s.sourceName}: ${s.error}\`)`
     (배열, `error` 없음). 두 필드가 동시에 채워지는 경로는 현재 없다.
3. **분류 우선순위** (한 학교가 여러 조건에 걸릴 때):
   `failed`(에러 보유) → `updated`(newCount > 0) → `noNewItems`.
   근거: 기존 `payload.success` / `payload.failed` 카운트가 이미
   `hasError = x.error || (x.errors||[]).length` 를 "실패"로 본다. 같은 술어를 재사용해
   `failedCount === payload.failed`, `updatedCount + noNewItemsCount === payload.success`,
   `totalTargets === payload.processed` 가 성립하도록 한다(회귀 안전 + 테스트 불변식).
4. **요약 줄 빌더** `buildUniversitySummaryLines(breakdown)` → `string[]`:
   ```
   업데이트 완료: {updatedCount}개교 (신규 {sumNewCount}건)
   변경 없음: {noNewItemsCount}개교
   수집 실패: {failedCount}개교
   - {실패학교1}: {사유1}
   - {실패학교2}: {사유2}
   ```
   - `sumNewCount = updated.reduce((n, u) => n + u.newCount, 0)`
   - 요약 3줄은 카운트가 0이어도 **항상** 출력(형식 고정).
   - 실패 상세(`- 학교: 사유`)는 `failedCount > 0` 일 때만, `failed[]` 전부 나열.
   - 완료/변경없음 학교는 개수만(이름 나열 안 함).
5. **`payload` 새 필드** (기존 필드/타입 절대 변경 금지, 추가만):
   - `payload.universityBreakdown = { updated, noNewItems, failed }` (배열 3종)
     — 주의: `payload.failed` 는 이미 **숫자** 카운트로 존재하므로 최상위에 `failed` 배열을
     둘 수 없다. 배열 3종은 `universityBreakdown` 아래에만 둔다.
   - `payload.updatedCount`, `payload.noNewItemsCount`, `payload.failedCount`,
     `payload.totalTargets` (전부 신규 키. 현재 payload 에 없음을 확인함.)
   - `payload.failedCount` 는 기존 `payload.failed`(숫자)와 값이 같아야 한다(불변식).
6. **`payload.messageKo` 요약 줄 추가**:
   기존 base 문구와 이미지 통계 줄 사이에 4번의 요약 줄을 끼워 넣는다.
   조립 규칙은 "구현 계획 > messageKo 조립" 참조. 기존 문구·순서는 유지.
7. **HTML 리포트**(`report-html.js`): `writeHtmlReport` 가 `data` 를 순회하며
   `<tr><th>key</th><td><pre>value</pre></td></tr>` 를 찍는데,
   `key === "universityBreakdown"` 이고 값이 객체이면 `<pre>` 대신 **3개 소표**로 렌더한다.
   나머지 모든 키(신규 카운트 4종 포함)는 기존 방식 그대로.
8. **PS1 팝업**(`show-uni-pick-agent-result.ps1`): 비-온보딩 경로에서 이미
   `messageKo` 를 그대로 출력하므로 요약이 자동 반영된다. **변경하지 않는다.**

## 제약

- `runner.js` / `collector.js` 수집·중복 로직 불변. 결과 집계·표현 계층만.
- git add / commit / push / 배포 미실행. 프로덕션 store/preview/카탈로그 미변경.
- 기존 `status` 분기(SUCCESS / NO_CHANGES / WARNING / FAILED), 기존 `payload` 필드/타입
  전부 유지(하위 호환). **새 필드만 추가.**
- 신규 npm 의존성 없음. Node 내장 모듈만.
- 시간/난수는 테스트에서 고정 주입(순수 함수 자체는 시간/난수 미사용).

# 파일

## 신규 (제품 코드 + 테스트)

| 절대경로 | 역할 |
|---|---|
| `D:\hhg(code)\server\agent\university-update-summary.js` | 순수 함수 2개: `classifyUniversityResults`, `buildUniversitySummaryLines`. 부수효과·I/O·시간·난수 없음. |
| `D:\hhg(code)\server\agent\university-update-summary.test.js` | 위 두 함수 단위 테스트 (`node --test`). |
| `D:\hhg(code)\server\agent\report-html.test.js` | `writeHtmlReport` 의 `universityBreakdown` 표 렌더 + 회귀 테스트(신규 파일). |

## 수정 (제품 코드) — 최소 diff

| 절대경로 | 변경 내용 |
|---|---|
| `D:\hhg(code)\server\agent\tools\run-scheduled-news-update.js` | ① 상단에 `const { classifyUniversityResults, buildUniversitySummaryLines } = require("../university-update-summary");` 추가. ② `asyncMain()` 성공 분기(현재 69~74행)에서 `run.universityResults` 로 `breakdown` 계산 → `payload.universityBreakdown` + 카운트 4종 세팅, `payload.messageKo` 에 요약 줄 삽입. ③ `catch` 분기에서 `run && Array.isArray(run.universityResults)` 이면 동일하게 세팅(WARNING 케이스 커버). 그 외에는 손대지 않음. |

## 수정하지 않음

- `D:\hhg(code)\server\agent\runner.js`, `collector.js`, `dedup.js`, `store.js`, `report.js`
- `D:\hhg(code)\scripts\show-uni-pick-agent-result.ps1` (messageKo 자동 반영)
- `D:\hhg(code)\scripts\run-scheduled-news-update.ps1`
- `D:\hhg(code)\package.json` (신규 스크립트 불필요 — 테스트는 `node --test` 자동 탐색)
- `D:\hhg(code)\server\agent\collection-report.js` (별도 공개 리포트 경로, 이번 범위 밖)

# 구현 계획

## 1. `server/agent/university-update-summary.js` (순수 모듈)

```js
"use strict";

/**
 * @param {Array<{universityName?:string, newCount?:number, duplicateCount?:number,
 *   error?:string, errors?:string[]}>} universityResults
 * @returns {{updated:Array<{universityName:string,newCount:number}>,
 *   noNewItems:Array<{universityName:string,reason:string}>,
 *   failed:Array<{universityName:string,reason:string}>,
 *   updatedCount:number, noNewItemsCount:number, failedCount:number, totalTargets:number}}
 */
function classifyUniversityResults(universityResults = []) {
  const list = Array.isArray(universityResults) ? universityResults : [];
  const updated = [];
  const noNewItems = [];
  const failed = [];
  for (const r of list) {
    const name = r && r.universityName ? String(r.universityName) : "(이름 없음)";
    const errors = Array.isArray(r && r.errors) ? r.errors.filter(Boolean) : [];
    const hasError = Boolean(r && r.error) || errors.length > 0;
    const newCount = Number(r && r.newCount) || 0;
    if (hasError) {
      const reason = r && r.error ? String(r.error) : errors.join("; ");
      failed.push({ universityName: name, reason });
    } else if (newCount > 0) {
      updated.push({ universityName: name, newCount });
    } else {
      const dup = Number(r && r.duplicateCount) || 0;
      noNewItems.push({ universityName: name, reason: `신규 게시물 없음 (중복 ${dup}건)` });
    }
  }
  return {
    updated, noNewItems, failed,
    updatedCount: updated.length,
    noNewItemsCount: noNewItems.length,
    failedCount: failed.length,
    totalTargets: list.length,
  };
}

/**
 * @param {ReturnType<typeof classifyUniversityResults>} breakdown
 * @returns {string[]}
 */
function buildUniversitySummaryLines(breakdown) {
  const b = breakdown || classifyUniversityResults([]);
  const sumNew = b.updated.reduce((n, u) => n + (Number(u.newCount) || 0), 0);
  const lines = [
    `업데이트 완료: ${b.updatedCount}개교 (신규 ${sumNew}건)`,
    `변경 없음: ${b.noNewItemsCount}개교`,
    `수집 실패: ${b.failedCount}개교`,
  ];
  for (const f of b.failed) lines.push(`- ${f.universityName}: ${f.reason}`);
  return lines;
}

module.exports = { classifyUniversityResults, buildUniversitySummaryLines };
```

- 시간/난수/파일 접근 없음 → 테스트에서 별도 주입 불필요.
- `run-scheduled-news-update.js` 를 `require` 하면 파일 맨 끝 `asyncMain()` 이 즉시 실행되므로
  (현재 `require.main` 가드 없음) 순수 함수는 **별도 모듈**에 둔다. (조사 결과 반영)

## 2. `run-scheduled-news-update.js` 수정 (asyncMain 성공 분기)

현재 69~74행 사이(payload 생성 후 ~ `writeResult(payload)` 전)에 삽입:

```js
const breakdown = classifyUniversityResults(run.universityResults || []);
payload.universityBreakdown = {
  updated: breakdown.updated,
  noNewItems: breakdown.noNewItems,
  failed: breakdown.failed,
};
payload.updatedCount = breakdown.updatedCount;
payload.noNewItemsCount = breakdown.noNewItemsCount;
payload.failedCount = breakdown.failedCount;
payload.totalTargets = breakdown.totalTargets;
```

### messageKo 조립

현재 72행:
```js
payload.messageKo = `${payload.messageKo}\n대표 이미지: ${payload.imageStats.withImage}건\n이미지 보완: ${payload.imageStats.backfilledImages}건`;
```
을 다음으로 교체(요약 줄을 base 와 이미지 줄 사이에 삽입):
```js
payload.messageKo = [
  payload.messageKo,
  ...buildUniversitySummaryLines(breakdown),
  `대표 이미지: ${payload.imageStats.withImage}건`,
  `이미지 보완: ${payload.imageStats.backfilledImages}건`,
].join("\n");
```
결과 예시(status = SUCCESS):
```
뉴스 업데이트와 배포 요청이 완료되었습니다.
업데이트 완료: 12개교 (신규 21건)
변경 없음: 15개교
수집 실패: 2개교
- 목포대학교: WAF 차단
- ○○대학교: main-notice: 403; press: timeout
대표 이미지: 34건
이미지 보완: 3건
```

### catch 분기 (WARNING / FAILED)

현재 77행 payload 생성 직후에 조건부 삽입:
```js
if (run && Array.isArray(run.universityResults)) {
  const breakdown = classifyUniversityResults(run.universityResults);
  payload.universityBreakdown = {
    updated: breakdown.updated, noNewItems: breakdown.noNewItems, failed: breakdown.failed,
  };
  payload.updatedCount = breakdown.updatedCount;
  payload.noNewItemsCount = breakdown.noNewItemsCount;
  payload.failedCount = breakdown.failedCount;
  payload.totalTargets = breakdown.totalTargets;
  payload.messageKo = [payload.messageKo, ...buildUniversitySummaryLines(breakdown)].join("\n");
}
```
`run` 이 undefined(=`runOnce` 이전에 throw)면 아무것도 안 함 → 기존 동작 유지.

## 3. `report-html.js` 수정

`writeHtmlReport` 의 `rows` 생성부를 다음처럼 분기:

```js
function renderBreakdownCell(v) {
  const updated = Array.isArray(v.updated) ? v.updated : [];
  const noNew = Array.isArray(v.noNewItems) ? v.noNewItems : [];
  const failed = Array.isArray(v.failed) ? v.failed : [];
  const sumNew = updated.reduce((n, u) => n + (Number(u.newCount) || 0), 0);
  const t2 = (rowsHtml, head) => rowsHtml
    ? `<table class="ubk"><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table>`
    : `<p class="ubk-empty">없음</p>`;
  const updatedRows = updated.map(u => `<tr><td>${esc(u.universityName)}</td><td>${esc(u.newCount)}</td></tr>`).join("");
  const noNewRows = noNew.map(u => `<tr><td>${esc(u.universityName)}</td><td>${esc(u.reason)}</td></tr>`).join("");
  const failedRows = failed.map(u => `<tr><td>${esc(u.universityName)}</td><td>${esc(u.reason)}</td></tr>`).join("");
  return `<p><strong>업데이트 완료 ${updated.length}개교 (신규 ${sumNew}건) / 변경 없음 ${noNew.length}개교 / 수집 실패 ${failed.length}개교</strong></p>`
    + `<h4>업데이트 완료</h4>${t2(updatedRows, "<th>학교</th><th>신규</th>")}`
    + `<h4>변경 없음</h4>${t2(noNewRows, "<th>학교</th><th>사유</th>")}`
    + `<h4>수집 실패</h4>${t2(failedRows, "<th>학교</th><th>사유</th>")}`;
}

const rows = Object.entries(data).map(([key, value]) => {
  if (key === "universityBreakdown" && value && typeof value === "object" && !Array.isArray(value)) {
    return `<tr><th>${esc("학교별 업데이트 내역")}</th><td>${renderBreakdownCell(value)}</td></tr>`;
  }
  return `<tr><th>${esc(key)}</th><td><pre>${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre></td></tr>`;
}).join("\n");
```

`<style>` 에 최소 규칙 추가(전역 `th{width:260px}` 가 중첩 표 헤더에 먹지 않게):
```
.ubk{width:auto;margin:4px 0 12px}.ubk th{width:auto;background:#fff}h4{margin:12px 0 4px}
```

- `esc()` 는 이미 `null/undefined` 를 `""` 로 처리하고 `& < > "` 를 이스케이프하므로
  실패 사유의 특수문자도 안전.
- `universityBreakdown` 키가 없는 payload(기존 실패 payload 등)는 분기 미진입 → 기존과 동일.

## 4. 검증

- `node --check "D:\hhg(code)\server\agent\university-update-summary.js"`
- `node --check "D:\hhg(code)\server\agent\report-html.js"`
- `node --check "D:\hhg(code)\server\agent\tools\run-scheduled-news-update.js"`
- 대상 테스트: `node --test server/agent/university-update-summary.test.js server/agent/report-html.test.js`
- 전체 회귀: `npm test` (agent/데이터 흐름 변경이므로 전체 실행). 2~3회 반복해 flaky 0 확인.

## 구현 순서

1. `university-update-summary.js` 작성 → `node --check`.
2. `university-update-summary.test.js` 작성 → 통과 확인.
3. `report-html.js` 수정 → `node --check`.
4. `report-html.test.js` 작성 → 통과 확인.
5. `run-scheduled-news-update.js` 수정(성공 분기 → catch 분기) → `node --check`.
6. `npm test` 전체 2~3회.
7. `.pipeline/changes.md` 작성(변경 파일·이유·검증 결과·시연 로그).

# 예외 상황

| 상황 | 처리 |
|---|---|
| `run.universityResults` 가 `undefined` / 배열 아님 | `classifyUniversityResults` 가 빈 배열로 처리 → 모든 카운트 0, `totalTargets 0`. messageKo 요약은 "0개교" 3줄. |
| `runOnce()` 가 `{ skipped: true, reason: "overlap" }` 반환(락 겹침) | `universityResults` 없음 → 위와 동일하게 빈 분류. 기존 흐름 영향 없음. (단 이 경우 `run.newCount` 등도 undefined → 기존 코드가 이미 `||0` 처리) |
| 한 학교가 `newCount > 0` + `errors` 동시 보유 | 우선순위 규칙에 따라 `failed` 로 분류(에러 우선). 현재 runner 경로상 발생하지 않지만 방어적으로 정의. 테스트로 고정. |
| `errors: []` (빈 배열, 정상 완료) | `hasError = false` → `failed` 아님. `newCount` 에 따라 updated / noNewItems. |
| 실패 사유에 `<`, `&`, 개행 등 포함 | `classify` 는 원본 문자열 그대로 보존. HTML 은 `esc()` 로 이스케이프. messageKo 는 평문이라 그대로 노출(팝업/텍스트 리포트 특성상 허용). |
| `duplicateCount` 누락 | `?? 0` → `"신규 게시물 없음 (중복 0건)"`. |
| catch 분기에서 `runTests()`(`npm test`) 가 throw 해 진입 | `run` 은 이미 채워짐 → 요약이 실패 리포트에도 포함됨(운영자가 어느 학교가 수집됐는지 파악 가능). 기존 `error`/`status` 필드는 그대로. |
| 기존 `payload.failed`(숫자)와 새 `payload.failedCount` 불일치 우려 | 동일 술어(`x.error || (x.errors||[]).length`) 사용으로 항상 일치. 테스트 불변식으로 고정. |
| HTML 중첩 표가 기존 CSS(`th{width:260px}`)와 충돌 | `.ubk th{width:auto}` 규칙 추가로 해소. 기존 최상위 표 레이아웃은 불변. |
| 다른 payload 소비자(스키마 검증 등) | grep 결과 `news-update-result.json` / payload 를 소비하는 코드는 `show-uni-pick-agent-result.ps1`(messageKo 만 사용) 와 `run-scheduled-news-update.ps1`(파일 존재 여부만) 뿐. 새 키 추가는 안전. |

# 완료 기준

1. **순수 분류 함수 단위 테스트** (`university-update-summary.test.js`):
   - updated/noNewItems/failed 혼합 입력 → 세 배열 내용과 카운트 4종, `totalTargets` 정확.
   - `updated` 항목이 `{ universityName, newCount }` 형태이고 `newCount > 0` 만 포함.
   - `noNewItems` reason 이 정확히 `"신규 게시물 없음 (중복 N건)"` (N = duplicateCount, 누락 시 0).
   - 빈 입력 / `undefined` → 전부 0.
   - 불변식: `updatedCount + noNewItemsCount + failedCount === totalTargets`.
2. **실패 사유 원본 전달 테스트**:
   - `{ error: "SCHEDULER_WAF_BLOCK" }` → `failed[0].reason === "SCHEDULER_WAF_BLOCK"` (문자열 동일).
   - `{ errors: ["main-notice: 403", "press: timeout"] }` →
     `failed[0].reason === "main-notice: 403; press: timeout"` (`"; "` 결합, 순서 보존).
   - `{ errors: ["a", "", null, "b"] }` → `"a; b"` (falsy 제거).
   - `newCount: 5` + `errors: ["x: 500"]` → `failed` 로 분류되고 reason `"x: 500"`.
3. **messageKo / 요약 줄 시연**:
   - `buildUniversitySummaryLines` 테스트: 3줄 고정 형식 + 실패 학교마다 `- 이름: 사유` 줄,
     `(신규 K건)` 이 `updated[].newCount` 합과 일치.
   - 통합 시연 테스트(옵션, 권장): 대표 fixture `universityResults`(완료 2 / 변경없음 3 / 실패 1)
     → 최종 messageKo 블록 문자열이
     `"...\n업데이트 완료: 2개교 (신규 7건)\n변경 없음: 3개교\n수집 실패: 1개교\n- 목포대학교: WAF 차단\n대표 이미지: ..."`
     형태와 정확히 일치.
4. **HTML 리포트 표 렌더 테스트** (`report-html.test.js`):
   - `universityBreakdown` 포함 payload → 출력 HTML 에 `학교별 업데이트 내역`,
     `업데이트 완료`, `변경 없음`, `수집 실패` 헤더, 각 학교명/신규 수/사유가 포함.
   - 사유의 `<`, `&` 가 `&lt;`, `&amp;` 로 이스케이프됨.
   - `universityBreakdown` 없는 payload → 기존과 동일하게 렌더(회귀: 다른 키가 `<pre>` 로 나옴).
   - 빈 목록 → `없음` 표시.
5. **하위 호환**:
   - 기존 `payload` 필드(`processed / success / failed / newItems / ...`)와 타입 불변.
   - `payload.failedCount === payload.failed`, `payload.totalTargets === payload.processed`,
     `payload.updatedCount + payload.noNewItemsCount === payload.success` 를 테스트로 고정
     (가능하면 순수 함수 + 기존 술어를 나란히 검증하는 단위 테스트로).
6. **전체 `npm test` 통과, 회귀 0** — 2~3회 반복 결정적 통과. 신규 테스트가 네트워크/프로덕션
   store/preview/카탈로그를 건드리지 않음(순수 함수 + 임시 경로만).
7. `node --check` 가 수정/신규 `.js` 3개 전부 통과.
8. `scripts/*.ps1` 미변경. git add/commit/push/배포 미실행.
9. `.pipeline/changes.md` 에 변경 파일 절대경로·이유·`node --check`/`npm test` 결과·시연 출력 기록.

# 질문사항

1. **분류 우선순위 (failed vs updated 겹침)** — 본 계획은 "에러 보유 시 무조건 `failed`"
   (기존 `payload.success/failed` 술어와 일치, 카운트 불변식 성립)로 확정 제안한다.
   만약 "일부 소스만 실패해도 신규가 있으면 `updated` 에 넣고 `failed` 에는 안 넣는다"를
   원하면 알려달라(그 경우 `failedCount !== payload.failed` 가 되어 별도 표기 필요).
   → **미회신 시 계획대로 "에러 우선" 진행.**

2. **배열 3종의 payload 위치** — `payload.failed` 가 이미 숫자라서 배열을
   `payload.universityBreakdown.{updated,noNewItems,failed}` 아래에 둔다(단일 신규 키).
   요청문의 "updated/noNewItems/failed 세 목록"을 최상위 키로 원했다면
   `updatedUniversities / noNewItemsUniversities / failedUniversities` 로 이름을 바꿔
   최상위에 둘 수도 있다. → **미회신 시 `universityBreakdown` 중첩으로 진행.**

3. **catch(WARNING/FAILED) 분기에도 요약 추가** — 본 계획은 `run` 이 있으면 추가하는 것으로
   제안(운영자가 부분 수집 상황을 파악하기 좋음). 성공 분기만 원하면 알려달라.
   → **미회신 시 catch 분기에도 조건부 추가.**

4. **`run-scheduled-news-update.js` 에 `require.main === module` 가드 추가 여부** —
   현재 파일은 맨 끝에서 `asyncMain()` 을 무조건 실행한다(테스트에서 `require` 불가).
   이번 계획은 순수 함수를 별도 모듈로 빼서 가드 추가 없이 진행한다. 다만 repo 관례상
   (`run-single-school-trial.js`) 가드 패턴을 쓰므로, 원한다면
   `if (require.main === module) asyncMain();` + `module.exports = { asyncMain }` 최소 추가로
   `asyncMain` 자체의 스모크 테스트도 가능하다. → **미회신 시 가드 미추가(범위 최소화).**
