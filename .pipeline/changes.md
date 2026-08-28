# 변경된 파일

## 신규
- `D:\hhg(code)\server\agent\university-update-summary.js` (순수 모듈)
- `D:\hhg(code)\server\agent\university-update-summary.test.js` (단위 테스트)
- `D:\hhg(code)\server\agent\report-html.test.js` (HTML 리포트 렌더/회귀 테스트)

## 수정
- `D:\hhg(code)\server\agent\report-html.js`
- `D:\hhg(code)\server\agent\tools\run-scheduled-news-update.js`

그 외 파일(`runner.js` / `collector.js` / `dedup.js` / `store.js` / `report.js` / `*.ps1` /
`package.json` / `collection-report.js`)은 수정하지 않았습니다.

---

# 변경 내용

## `server/agent/university-update-summary.js` (신규)
spec "# 구현 계획 > 1" 코드 블록을 그대로 구현. 부수효과·I/O·시간·난수 없음.
- `classifyUniversityResults(universityResults = [])` → `{ updated[], noNewItems[], failed[],
  updatedCount, noNewItemsCount, failedCount, totalTargets }`.
  - 우선순위: `failed`(`r.error` truthy 또는 `errors.filter(Boolean).length > 0`) → `updated`
    (`newCount > 0`) → `noNewItems`.
  - 실패 사유: `r.error` truthy면 `String(r.error)`, 아니면 `errors.filter(Boolean).join("; ")`.
  - `noNewItems.reason` = `` `신규 게시물 없음 (중복 ${duplicateCount ?? 0}건)` ``.
  - 배열이 아닌 입력/`undefined`는 빈 배열로 처리(카운트 전부 0).
  - 이름 누락 시 `"(이름 없음)"`.
- `buildUniversitySummaryLines(breakdown)` → `string[]`. 3줄 고정
  (`업데이트 완료: N개교 (신규 K건)` / `변경 없음: N개교` / `수집 실패: N개교`) +
  `failed[]` 전부 `- 이름: 사유`. `breakdown` 없으면 빈 분류로 폴백.

## `server/agent/tools/run-scheduled-news-update.js` (수정, 3곳)
1. 상단 require 추가:
   `const { classifyUniversityResults, buildUniversitySummaryLines } = require("../university-update-summary");`
2. `asyncMain()` 성공 분기 — `payload.cleanupStats` 세팅 직후:
   - `breakdown` 계산 → `payload.universityBreakdown = { updated, noNewItems, failed }`,
     `payload.updatedCount / noNewItemsCount / failedCount / totalTargets` 세팅.
   - 기존 `payload.messageKo = ...\n대표 이미지...\n이미지 보완...` 한 줄을 배열 `.join("\n")`
     조립으로 교체. 순서: `base` → 요약 4번 줄 → `대표 이미지` 줄 → `이미지 보완` 줄.
     (base 문구/이미지 통계 문구·순서는 불변, 요약 줄만 사이에 삽입.)
3. `catch` 분기 — `writeResult(payload)` 직전:
   - `run && Array.isArray(run.universityResults)` 이면 `payload.universityBreakdown`(배열 3종)
     세팅 + `payload.messageKo = [payload.messageKo, ...요약줄].join("\n")`
     (이미지 통계 줄은 catch payload에 없으므로 미포함).
   - **스칼라 카운트 4종은 catch 분기에서 세팅하지 않음** (후속 보완 #2 참조).
   - `run` 이 undefined(runOnce 이전 throw)면 아무것도 안 함 → 기존 동작 유지.

기존 `payload` 필드/타입/`status` 분기(SUCCESS/NO_CHANGES/WARNING/FAILED)는 전부 유지, 새 키만 추가.

## `server/agent/report-html.js` (수정)
- `renderBreakdownCell(v)` 함수 추가: `updated / noNewItems / failed` 3개 소표(`<table class="ubk">`)
  + 요약 `<p><strong>...</strong></p>`. 빈 목록은 `<p class="ubk-empty">없음</p>`.
  값은 전부 기존 `esc()` 로 이스케이프.
- `writeHtmlReport` 의 rows 생성부: `key === "universityBreakdown"` 이고 값이 (배열 아닌) 객체이면
  `<pre>` 대신 `renderBreakdownCell` 결과를 `<td>` 에 렌더, `<th>` 는 `학교별 업데이트 내역`.
  그 외 모든 키는 기존 `<pre>` 방식 그대로.
- `<style>` 에 `.ubk{width:auto;margin:4px 0 12px}.ubk th{width:auto;background:#fff}h4{margin:12px 0 4px}`
  추가(전역 `th{width:260px}` 가 중첩 표에 먹지 않도록). 기존 CSS 규칙은 불변.

## 테스트 파일 2종 (신규)
- `university-update-summary.test.js` (16 테스트): 혼합 분류, updated 형태, noNewItems reason,
  빈/undefined 입력, 불변식 `updatedCount+noNewItemsCount+failedCount===totalTargets`,
  실패 사유 원본 전달 4종(`SCHEDULER_WAF_BLOCK` / `"main-notice: 403; press: timeout"` /
  `"a; b"` / `newCount:5+errors` → failed), 기존 payload 술어 불변식(`failedCount===payload.failed`
  등), `buildUniversitySummaryLines` 3줄 고정 + 실패 상세, messageKo 최종 블록 정확 일치 시연.
- `report-html.test.js` (5 테스트): `universityBreakdown` 3소표 렌더/헤더/학교명/신규수/사유,
  `<`·`&` 이스케이프, 빈 목록 `없음` 3회, `universityBreakdown` 없는 payload 회귀(`<pre>` 유지),
  신규 카운트 키는 여전히 `<pre>`. 임시 디렉터리(`fs.mkdtempSync`)만 사용, 프로덕션 경로 미접근.

---

# 변경 이유

`runOnce()` 가 이미 반환하는 학교별 세부(`run.universityResults[]`)를
`run-scheduled-news-update.js` 가 집계 수치만 남기고 버리고 있었음. spec 요구대로
학교별 결과를 3분류(업데이트 완료 / 변경 없음 / 수집 실패)로 정리해
(1) 재사용 순수 함수, (2) `payload` 새 필드, (3) `payload.messageKo` 요약 줄,
(4) HTML 리포트 표에 반영. PS1 팝업은 `messageKo` 를 그대로 출력하므로 자동 반영(미변경).
수집/중복 로직(`runner.js`/`collector.js`)은 건드리지 않고 집계·표현 계층만 수정.

순수 함수를 별도 모듈로 분리한 이유: `run-scheduled-news-update.js` 는 파일 끝에서
`asyncMain()` 을 무조건 실행(`require.main` 가드 없음)하므로 `require` 로 테스트 불가.
spec 질문사항 4건은 전부 기본값(계획대로)으로 확정: (1) 에러 보유 시 무조건 failed,
(2) 배열 3종은 `payload.universityBreakdown` 중첩, (3) catch 분기에도 `run` 있으면 요약 추가,
(4) `require.main` 가드 미추가.

---

# AGENTS.md 4절 — 각 파일 "여는 명령"

```powershell
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\university-update-summary.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\university-update-summary.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\report-html.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\report-html.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\tools\run-scheduled-news-update.js"
```

편집 전 5개 파일 모두 전체 내용을 읽고 최소 diff로 수정함.

---

# 검증 결과

## `node --check` (AGENTS.md 5절)

```
node --check "D:\hhg(code)\server\agent\university-update-summary.js"          → OK
node --check "D:\hhg(code)\server\agent\report-html.js"                        → OK
node --check "D:\hhg(code)\server\agent\tools\run-scheduled-news-update.js"    → OK
node --check "D:\hhg(code)\server\agent\university-update-summary.test.js"     → OK
node --check "D:\hhg(code)\server\agent\report-html.test.js"                   → OK
(출력: "ALL CHECKS OK")
```

## 신규 테스트 개별 (`node --test`)

```
node --test server/agent/university-update-summary.test.js   → tests 16, pass 16, fail 0
node --test server/agent/report-html.test.js                 → tests 5,  pass 5,  fail 0
```

## 전체 `npm test` 3회 연속

| 회차 | tests | pass | fail |
|---|---|---|---|
| baseline (변경 전) | 274 | 274 | 0 |
| 1 | 295 | 295 | 0 |
| 2 | 295 | 295 | 0 |
| 3 | 295 | 295 | 0 |

증가분: +21 (university-update-summary.test.js 16 + report-html.test.js 5). 회귀 0, 결정적 통과.

---

# 시연 출력 발췌

## messageKo (성공 분기, fixture: 완료 2 / 변경없음 3 / 실패 1)

```
뉴스 업데이트와 배포 요청이 완료되었습니다.
업데이트 완료: 2개교 (신규 7건)
변경 없음: 3개교
수집 실패: 1개교
- 목포대학교: WAF 차단
대표 이미지: 34건
이미지 보완: 3건
```

## HTML 리포트 `universityBreakdown` 셀

```html
<tr><th>학교별 업데이트 내역</th><td><p><strong>업데이트 완료 2개교 (신규 7건) / 변경 없음 3개교 / 수집 실패 1개교</strong></p><h4>업데이트 완료</h4><table class="ubk"><thead><tr><th>학교</th><th>신규</th></tr></thead><tbody><tr><td>가대</td><td>3</td></tr><tr><td>나대</td><td>4</td></tr></tbody></table><h4>변경 없음</h4><table class="ubk"><thead><tr><th>학교</th><th>사유</th></tr></thead><tbody><tr><td>다대</td><td>신규 게시물 없음 (중복 2건)</td></tr><tr><td>라대</td><td>신규 게시물 없음 (중복 0건)</td></tr><tr><td>마대</td><td>신규 게시물 없음 (중복 0건)</td></tr></tbody></table><h4>수집 실패</h4><table class="ubk"><thead><tr><th>학교</th><th>사유</th></tr></thead><tbody><tr><td>목포대학교</td><td>WAF 차단</td></tr></tbody></table></td></tr>
```

특수문자 이스케이프 확인: `reason: "타임아웃 & <error>"` → `타임아웃 &amp; &lt;error&gt;` 로 렌더됨.

---

# 불변식 (테스트로 고정)

- `payload.failedCount === payload.failed` (동일 술어 `x.error || (x.errors||[]).length` 재사용)
- `payload.totalTargets === payload.processed` (`(run.universityResults||[]).length`)
- `payload.updatedCount + payload.noNewItemsCount === payload.success`
- `updatedCount + noNewItemsCount + failedCount === totalTargets`

---

# 미구현 / 보류 항목

- `run-scheduled-news-update.js` 에 `require.main === module` 가드 및 `module.exports` 미추가
  (spec 질문사항 4 기본값). 따라서 `asyncMain()` 자체의 스모크 테스트는 없음.
  성공/catch 분기의 payload 조립 로직은 순수 함수 조합이라 `university-update-summary.test.js`
  의 "messageKo 시연" 테스트에서 동일 조립을 재현해 간접 검증함.
- `run-scheduled-news-update.js` 는 네트워크/git push/실제 배포를 수행하므로 실환경 실행 검증은
  하지 않음(범위 밖, 그리고 git/배포 금지 규칙). 순수 함수 + HTML 렌더 + `node --check` +
  전체 `npm test` 로 검증.

---

# Tester가 알아야 할 내용

- baseline 테스트 수 274 → 295 (+21). `npm test` 는 `node --test` 자동 탐색이라 별도 스크립트 없음.
- 신규 테스트는 네트워크/프로덕션 store/preview/카탈로그를 건드리지 않음.
  `report-html.test.js` 는 `os.tmpdir()` 하위 임시 디렉터리에만 파일을 쓰고 정리함.
- `run-scheduled-news-update.js` 는 `require` 시 `asyncMain()` 이 즉시 실행되므로
  테스트에서 직접 require하지 말 것. payload 조립 검증은 순수 함수로.
- 새 `payload` 키: `universityBreakdown`(객체 `{updated,noNewItems,failed}` 배열 3종),
  `updatedCount`, `noNewItemsCount`, `failedCount`, `totalTargets`. 기존 키/타입 전부 유지.
- HTML 회귀 확인 포인트: `universityBreakdown` 없는 payload는 모든 키가 기존처럼
  `<tr><th>key</th><td><pre>...</pre></td></tr>` 로 렌더됨.
- 직접 확인 권장: `server/agent/news/reports/ui/latest-news-update-report.html` 을 브라우저로 열어
  중첩 표 레이아웃(전역 `th{width:260px}` 미적용, `.ubk th{width:auto}` 적용) 육안 확인.

---

## 후속 보완 (Reviewer 권고 #2 — catch 분기 payload 수치 디커플링)

### 문제
catch(WARNING/FAILED) 분기 payload 는 `processed:0, success:0, failed:1` 을 하드코딩한다.
초기 구현은 이 분기에서도 `run` 존재 시 스칼라 카운트 4종
(`updatedCount / noNewItemsCount / failedCount / totalTargets`)을 breakdown 값으로 세팅했다
→ 같은 payload 안에서 `payload.failed(1) !== payload.failedCount(예:3)` 모순.

### 수정 (`server/agent/tools/run-scheduled-news-update.js`, catch 분기만)
- `payload.universityBreakdown = { updated, noNewItems, failed }` (배열 3종): **유지**
- `payload.messageKo` 요약 줄 삽입: **유지**
- 스칼라 카운트 4종(`updatedCount / noNewItemsCount / failedCount / totalTargets`):
  **catch 분기에서 세팅하지 않음** — 성공 분기(SUCCESS/NO_CHANGES) 전용으로 남김.
- 성공 분기는 변경 없음(4종 카운트 + breakdown + 요약 전부 유지).
- catch 분기 삽입부에 의도 설명 주석 4줄 추가.

### 주석 (`server/agent/university-update-summary.js` 상단)
소비처(성공 분기 = 배열+카운트4종+요약 / catch 분기 = 배열+요약만)를 명시하는 주석 6줄 추가.

### 효과
완료 기준 5의 불변식(`payload.failedCount === payload.failed` 등)은
"해당 키가 존재하는 경로 = 성공 분기"에서만 평가되므로 항상 성립.
기존 catch 분기 카운트 4종을 단언하는 테스트는 없음(신규 테스트는 순수 함수/HTML 렌더 대상) → 수정 불필요.

### 재검증
```
node --check "server/agent/tools/run-scheduled-news-update.js"   → OK
node --check "server/agent/university-update-summary.js"          → OK
node --test university-update-summary.test.js report-html.test.js → tests 21, pass 21, fail 0
npm test (1회)                                                    → tests 295, pass 295, fail 0
```
테스트 수 변동 없음(295 유지). 회귀 0.
