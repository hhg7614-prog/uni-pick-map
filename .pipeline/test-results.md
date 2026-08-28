# 테스트 요약

전체 결과: 합격 (조건부 아님, 경미한 위험 요소 4건 기록)

- `node --check` 5개 파일 전부 통과.
- 신규 테스트 개별 실행: `university-update-summary.test.js` 16 / `report-html.test.js` 5 = 21 pass, 0 fail.
- 전체 `npm test` 3회 연속: 매회 tests 295 / pass 295 / fail 0. baseline 274 → +21 (신규 테스트 2파일).
- `git diff` 결과 변경은 spec 범위(새 payload 필드 + `universityBreakdown` 분기 + `.ubk` CSS + require 1줄)에 국한.
- 수정 금지 파일(`runner.js` / `collector.js` / `dedup.js` / `scripts/*.ps1` / `package.json`) 전부 불변.
- git add/commit/push/배포 미실행.

검증 환경: 브랜치 `feat/onboarding-gate-bridges`, HEAD `32ab124` (대화 시작 시점 스냅샷과 다르나 파이프라인 진행 중 정상).

---

# 완료 기준

- 조건 1 (순수 분류 함수 단위 테스트): 통과
  - 혼합 입력 3배열 + 카운트 4종 + totalTargets: `university-update-summary.test.js:13-37`
  - updated 는 `{universityName,newCount}` 형태, newCount>0 만: `:39-46`
  - noNewItems reason `"신규 게시물 없음 (중복 N건)"`, duplicateCount 누락 시 0: `:48-55`
  - 빈/undefined → 전부 0: `:57-68`
  - 불변식 `updatedCount+noNewItemsCount+failedCount===totalTargets`: `:70-80`
- 조건 2 (실패 사유 원본 전달): 통과
  - `{error:"SCHEDULER_WAF_BLOCK"}` → `"SCHEDULER_WAF_BLOCK"`: `:82-85`
  - `{errors:["main-notice: 403","press: timeout"]}` → `"main-notice: 403; press: timeout"`: `:87-92`
  - `{errors:["a","",null,"b"]}` → `"a; b"`: `:94-97`
  - `newCount:5 + errors:["x: 500"]` → failed 분류 + reason `"x: 500"`: `:99-106`
- 조건 3 (messageKo / 요약 줄 시연): 통과
  - `buildUniversitySummaryLines` 3줄 고정 + 실패 상세 + `(신규 K건)` = newCount 합: `:140-155`, `:201-210`
  - 카운트 0 에도 3줄: `:157-168`
  - 통합 시연: fixture(완료 2 / 변경없음 3 / 실패 1) → 최종 messageKo 블록 문자열 정확 일치: `:170-199`
    (`run-scheduled-news-update.js` 성공 분기의 조립식을 테스트가 그대로 재현. 실제 모듈 require 불가하므로 간접 검증 — spec 3번이 허용한 방식.)
- 조건 4 (HTML 리포트 표 렌더): 통과
  - `학교별 업데이트 내역` / `업데이트 완료` / `변경 없음` / `수집 실패` 헤더 + 학교명 / 신규수 / 사유: `report-html.test.js:21-41`
  - `<`·`&` 이스케이프(`타임아웃 &amp; &lt;error&gt;`, `A대 &lt;b&gt;`, `doesNotMatch(/<error>/)`): `:43-54`
  - 빈 목록 → `없음` 정확히 3회: `:56-62`
  - `universityBreakdown` 없는 payload → 기존 `<pre>` 렌더 회귀: `:64-74`
  - 신규 카운트 키(updatedCount 등)는 여전히 `<pre>`: `:76-86`
- 조건 5 (하위 호환): 통과 (경미한 술어 차이는 위험 요소 1 참조)
  - 기존 payload 필드/타입 불변: `git diff` 상 기존 payload 리터럴 미변경, 새 키만 추가.
  - `failedCount===payload.failed`, `totalTargets===payload.processed`,
    `updatedCount+noNewItemsCount===payload.success` 를 순수 함수 + 기존 술어 병렬 검증: `university-update-summary.test.js:123-138`
- 조건 6 (전체 npm test 통과 + 회귀 0 + 2~3회 결정적): 통과
  - 3회 연속 295/295/0. 신규 테스트는 순수 함수 + `os.tmpdir()` 임시 디렉터리만 사용, 네트워크/프로덕션 store/preview/카탈로그/`data/` 미접근.
- 조건 7 (`node --check` 3개 .js 통과): 통과 (신규 test 2개 포함 5개 전부 OK)
- 조건 8 (`scripts/*.ps1` 미변경, git add/commit/push/배포 미실행): 통과 (`git status` 확인)
- 조건 9 (`.pipeline/changes.md` 기록): 통과 (변경 파일 절대경로 / 이유 / `node --check` / `npm test` 3회 / 시연 출력 포함)

## 추가 확인 항목 (Tester 지시 1~10)

- 1 `node --check` 3파일: PASS
- 2 `npm test` 3회 동일 카운트 0 fail: PASS (원본 출력 아래)
- 3 신규 테스트 개별 통과: PASS (21/21)
- 4 완료 기준별 대응 테스트 매핑: PASS (위 조건 1~5)
- 5 하위 호환 불변식 테스트 고정: PASS (순수 함수 레벨. payload 객체 레벨은 module require 불가로 미검증 — 위험 요소 2)
- 6 최소 diff 검증: PASS (`git diff` 범위 확인 — 기존 status 분기 / 수집 로직 / 다른 payload 필드 불변)
- 7 수정 금지 파일 불변: PASS (`git status`: `report-html.js`, `run-scheduled-news-update.js`, `.pipeline/*` 만 수정. 신규 3파일 untracked)
- 8 신규 테스트 격리: PASS (`report-html.test.js` 는 `fs.mkdtempSync(os.tmpdir())` + `fs.rmSync` 정리, summary 테스트는 순수)
- 9 `universityBreakdown` 값이 배열/null 일 때: 코드상 폴백 확인 (`value && typeof value === "object" && !Array.isArray(value)` → false 시 기존 `<pre>` 경로, `JSON.stringify` 로 크래시 없음). 전용 테스트 없음 — 위험 요소 3
- 10 catch 분기 `run` undefined 가드: 코드상 `let ... run` 초기 undefined → `run && Array.isArray(run.universityResults)` false → 새 필드 미세팅 → 기존 동작 유지. 전용 테스트 없음 — 위험 요소 4

---

# 실패한 테스트

없음. 전체 및 신규 테스트 모두 통과.

## npm test 3회 원본 출력 (요약 라인)

```
===== RUN 1 =====
ℹ tests 295
ℹ pass 295
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
===== RUN 2 =====
ℹ tests 295
ℹ pass 295
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
===== RUN 3 =====
ℹ tests 295
ℹ pass 295
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

## 신규 테스트 개별 (`node --test server/agent/university-update-summary.test.js server/agent/report-html.test.js`)

```
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## node --check

```
OK summary            (server/agent/university-update-summary.js)
OK report-html        (server/agent/report-html.js)
OK run-scheduled      (server/agent/tools/run-scheduled-news-update.js)
OK summary.test       (server/agent/university-update-summary.test.js)
OK report-html.test   (server/agent/report-html.test.js)
```

## 완료 기준 1~9 매핑 표

| 완료 기준 | 상태 | 근거 |
|---|---|---|
| 1 순수 분류 함수 단위 테스트 | 통과 | `university-update-summary.test.js:13-121` |
| 2 실패 사유 원본 전달 | 통과 | `university-update-summary.test.js:82-106` |
| 3 messageKo / 요약 줄 시연 | 통과 | `university-update-summary.test.js:140-210` |
| 4 HTML 리포트 표 렌더 | 통과 | `report-html.test.js:21-86` |
| 5 하위 호환 불변식 | 통과 | `university-update-summary.test.js:123-138` + `git diff` |
| 6 전체 npm test / 회귀 0 / 결정적 | 통과 | 3회 295/295/0 |
| 7 node --check 3개 | 통과 | 위 출력 |
| 8 ps1 미변경 / 배포 미실행 | 통과 | `git status` |
| 9 changes.md 기록 | 통과 | `.pipeline/changes.md` |

---

# 재현 방법

```bash
cd "D:/hhg(code)"

# 1. 문법 체크
node --check server/agent/university-update-summary.js
node --check server/agent/report-html.js
node --check server/agent/tools/run-scheduled-news-update.js

# 2. 신규 테스트 개별
node --test server/agent/university-update-summary.test.js server/agent/report-html.test.js

# 3. 전체 회귀 3회
for i in 1 2 3; do echo "RUN $i"; npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"; done

# 4. 변경 범위 확인
git diff HEAD -- server/agent/report-html.js server/agent/tools/run-scheduled-news-update.js
git status
```

## 위험 요소 1 재현 (예: 술어 차이 노출)

```bash
node -e "const {classifyUniversityResults}=require('./server/agent/university-update-summary');
const r=[{universityName:'X',errors:['',null]}];
const b=classifyUniversityResults(r);
const legacyFailed=r.filter(x=>x.error||(x.errors||[]).length).length;
console.log('failedCount(new)=',b.failedCount,' payload.failed(legacy)=',legacyFailed);"
# 출력: failedCount(new)= 0  payload.failed(legacy)= 1  → 불일치
```
(`runner.js` 는 `errors` 에 falsy 항목을 넣지 않으므로 프로덕션에서는 발생하지 않음.)

## 위험 요소 2 재현 (catch/WARNING payload 수치 모순) — 코드 리뷰로만 확인

`run-scheduled-news-update.js:89` catch payload 는 `processed:0, success:0, failed:1` 하드코딩.
`:90-98` 에서 `run` 존재 시 `payload.totalTargets / failedCount / updatedCount / noNewItemsCount` 를
breakdown 값으로 세팅. → WARNING 리포트에서 `payload.failed(1) !== payload.failedCount`,
`payload.processed(0) !== payload.totalTargets`, `payload.success(0) !== updatedCount+noNewItemsCount` 가
동시에 성립할 수 있음. spec 완료 기준 5 불변식은 성공 분기에만 적용됨(예외 상황 표가 catch 분기는
"기존 error/status 필드는 그대로"라고만 명시). Planner 계획(구현 계획 > catch 분기) 그대로 구현됨.

---

# 위험 요소

1. **불변식 술어 미세 불일치 (경미, 프로덕션 미발생)**: 순수 함수의 `hasError` 는
   `errors.filter(Boolean).length > 0` 를 쓰고, 기존 `payload.failed` 술어는
   `(x.errors||[]).length` (필터 없음). `errors` 가 전부 falsy(`["",null]`)인 경우에만
   `failedCount !== payload.failed` 로 갈림. spec 요구사항 2(`"a; b"` 결과)와 구현 계획
   pseudo-code 자체가 `filter(Boolean)` 를 강제하므로 이는 spec 내부 모순이며 Coder 는 계획을
   충실히 따름. `runner.js` 의 `errors` 는 `\`${sourceName}: ${error}\`` 형태라 항상 truthy →
   실제로는 발생하지 않음. 전부-falsy `errors` 배열에 대한 테스트는 없음.

2. **catch(WARNING/FAILED) 분기 payload 수치 모순 (경미, spec 승인됨)**: 위 재현 참조.
   WARNING 리포트를 소비하는 운영자/도구가 `processed=0` 과 `totalTargets=27` 을 동시에 보게 됨.
   Planner 가 명시적으로 계획한 동작이라 스펙 위반은 아니나, 하위 호환 불변식이 이 경로에서는
   깨진다는 점을 리뷰어/운영자가 인지해야 함. 이 분기의 payload 조립 로직은 자동 테스트가 없음
   (`run-scheduled-news-update.js` 는 require 시 `asyncMain()` 즉시 실행 → 테스트 불가, spec Q4
   기본값대로 `require.main` 가드 미추가).

3. **`universityBreakdown` 값이 `null` / 배열일 때 폴백에 대한 전용 테스트 없음**: 코드 인스펙션상
   안전(`value && typeof value === "object" && !Array.isArray(value)` 가드로 기존 `<pre>` 경로로
   폴백, `JSON.stringify(null)` → `"null"`, 크래시 없음). `report-html.test.js` 에 회귀 케이스로
   `universityBreakdown` "키 없음"만 있고 "키는 있으나 null/배열"은 없음.

4. **catch 분기 `run` undefined 가드 전용 테스트 없음**: 코드상 `let status="FAILED", run` 로
   초기 undefined → 가드 false → 기존 동작 유지. 자동 테스트 없이 코드 리뷰로만 확인.

5. **HTML 육안 확인 미수행**: `.ubk th{width:auto}` 가 전역 `th{width:260px}` 를 오버라이드해
   중첩 표 레이아웃이 정상인지 브라우저 확인은 안 함(환경상 불가). CSS 규칙 문자열은 diff 로 확인.

6. **`run-scheduled-news-update.js` 실환경 실행 미검증**: 네트워크/git push/배포를 수행하므로
   범위 밖. 순수 함수 + HTML 렌더 + `node --check` + 전체 `npm test` 로 대체 검증.

---

# 최종 테스트 상태

통과

모든 완료 기준(1~9)과 Tester 지시 항목(1~10)이 통과. 위험 요소 6건은 전부 경미(프로덕션
데이터에서 미발생하거나 Planner 가 명시적으로 계획한 동작 또는 환경 제약으로 인한 육안/실환경
검증 생략)하며, 코드 수정 없이 리뷰어가 인지하고 넘어갈 수 있는 수준. 특히 위험 요소 2(catch
분기 payload 수치 모순)는 리뷰어가 "허용 가능한 트레이드오프"인지 한 번 확인할 것을 권장.
