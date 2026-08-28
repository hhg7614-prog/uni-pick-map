# 검토 요약

"학교별 업데이트 내역" 기능(스케줄러 뉴스 업데이트 결과에 학교별 3분류 반영)의
계획·구현·테스트를 종합 검토했다. Reviewer 1차 검토 후 나온 후속 권고 #2(catch 분기 payload
수치 디커플링)를 Coder 가 반영했고, 2차 검토에서 해당 수정을 재검증했다.

- 최초 요구사항(순수 함수 / payload 새 필드 / messageKo 요약 줄 / HTML 표 / PS1 자동 반영)
  5개 항목 모두 구현됨.
- spec 완료 기준 1~9 전부 충족, Tester 결과와 교차 확인 일치.
- spec 제약(수집 로직 불변, 기존 payload 필드·타입·status 분기 유지, 새 필드만 추가,
  신규 의존성 0, git/배포 미실행, 수정 금지 파일 불변) 전부 준수.
- `git diff` 로 실제 변경 범위 확인: 제품 코드 수정은 `report-html.js`,
  `run-scheduled-news-update.js` 두 파일 최소 diff. 신규 3파일은 순수 모듈 + 테스트 2종.
- 후속 권고 #2 반영 후: `node --check` OK, 신규 테스트 21/21, 전체 `npm test` 295/295/0 유지.
- 요청하지 않은 제품 코드 변경 없음. (`.pipeline/*.md` 변경은 파이프라인 산출물로 정상.
  `.pipeline/merge-analysis.md` 는 이번 작업 이전부터 존재하던 untracked 파일.)

최종 판정: **승인**.

# 요구사항 확인

## 최초 요구사항 매핑

| 요구 | 구현 | 확인 |
|---|---|---|
| (1) 재사용 가능한 순수 함수 | `server/agent/university-update-summary.js` 의 `classifyUniversityResults`, `buildUniversitySummaryLines`. I/O·시간·난수·부수효과 없음 | 충족 |
| (2) payload 새 필드 | `payload.universityBreakdown{updated,noNewItems,failed}` + `updatedCount / noNewItemsCount / failedCount / totalTargets` | 충족 |
| (3) payload.messageKo 요약 줄 | 성공 분기에서 base 문구와 이미지 통계 줄 사이에 요약 4줄 삽입, 기존 문구·순서 유지 | 충족 |
| (4) HTML 리포트 표 | `renderBreakdownCell` 로 3개 소표 렌더, 그 외 키는 기존 `<pre>` 유지 | 충족 |
| (5) PS1 팝업 자동 반영 | `show-uni-pick-agent-result.ps1` 미변경, `messageKo` 를 그대로 출력하므로 자동 반영 | 충족 |

## spec 완료 기준 1~9

| 완료 기준 | 판정 | 근거 |
|---|---|---|
| 1 순수 분류 함수 단위 테스트 | 충족 | `university-update-summary.test.js` 혼합 분류 / updated 형태 / noNewItems reason(N=duplicateCount, 누락 시 0) / 빈·undefined → 0 / 불변식 `updatedCount+noNewItemsCount+failedCount===totalTargets` |
| 2 실패 사유 원본 전달 | 충족 | `{error}` → `String(error)`, `errors[]` → `"; "` 결합·순서 보존, falsy 제거, `newCount>0 + errors` → failed |
| 3 messageKo / 요약 줄 시연 | 충족 | 3줄 고정 형식 + 실패 상세 + `(신규 K건)` = newCount 합. 통합 시연이 성공 분기 조립식을 그대로 재현해 최종 블록 문자열 정확 일치 검증 (spec 3번이 허용한 간접 검증 방식) |
| 4 HTML 리포트 표 렌더 | 충족 | `report-html.test.js` 헤더/학교명/신규수/사유 포함, `< & ` → `&lt; &amp;` 이스케이프, 빈 목록 `없음` 3회, `universityBreakdown` 없는 payload 회귀, 신규 카운트 키는 여전히 `<pre>` |
| 5 하위 호환 | 충족 (후속 권고 #2 반영으로 catch 경로 포함 해소) | 성공·NO_CHANGES payload 에서 `failedCount===failed`, `totalTargets===processed`, `updatedCount+noNewItemsCount===success` 성립. catch(WARNING/FAILED) 분기는 스칼라 카운트 4종을 세팅하지 않게 수정되어 `payload.failed(스칼라)` 와 모순되는 키가 생기지 않음. `universityBreakdown.failed` 는 배열이므로 스칼라 `payload.failed` 와 이름·타입이 구분됨 |
| 6 전체 npm test 통과 / 회귀 0 / 결정적 | 충족 | 1차 3회 295/295/0, 후속 수정 후 재확인 295/295/0. 신규 테스트는 순수 함수 + `os.tmpdir()` 임시 디렉터리만 사용 |
| 7 node --check 3개 .js 통과 | 충족 | 수정/신규 5개 파일 전부 OK (후속 수정 후 재확인) |
| 8 scripts/*.ps1 미변경, git add/commit/push/배포 미실행 | 충족 | `git status` 로 확인. ps1 3종 불변 |
| 9 changes.md 기록 | 충족 | 변경 파일 절대경로·이유·`node --check`·`npm test` 결과·시연 출력 + 후속 보완 절 포함 |

## 제약 준수 체크

| 제약 | 판정 | 근거 |
|---|---|---|
| runner.js / collector.js 수집·중복 로직 불변 | 준수 | `git status` 에 미포함. diff 없음 |
| 기존 payload 필드/타입/status 분기(SUCCESS/NO_CHANGES/WARNING/FAILED) 유지 | 준수 | payload 리터럴 diff 없음, 새 키만 추가. status 분기 로직 미변경 |
| 새 필드만 추가 | 준수 | `universityBreakdown` 및 카운트 4종 전부 신규 키. catch 분기는 배열 + messageKo 요약만 추가 |
| 신규 npm 의존성 0 | 준수 | `require` 추가는 로컬 모듈 1줄뿐. package.json 불변 |
| git / 배포 미실행, 프로덕션 store/preview/카탈로그 미변경 | 준수 | `git status` 로 확인 |
| 수정 금지 파일 불변 | 준수 | runner.js / collector.js / dedup.js / store.js / report.js / *.ps1 / package.json / collection-report.js 전부 diff 없음 |
| 시간/난수 테스트 고정 주입 | 준수 | 순수 함수 자체가 시간/난수 미사용 |

# 테스트 결과

- `node --check` 5개 파일 전부 OK (후속 수정 후 재확인).
- 신규 테스트 개별: `university-update-summary.test.js` 16, `report-html.test.js` 5 = 21 pass / 0 fail.
- 전체 `npm test`: 1차 3회 연속 295/295/0, 후속 수정 후 재확인 295/295/0. baseline 274 대비 +21,
  회귀 0.
- 신규 테스트 격리 확인: 순수 함수 + `fs.mkdtempSync(os.tmpdir())` + `fs.rmSync` 정리.
- Tester 종합 판정: 통과. Reviewer 재확인 결과 동일.

# 문제점

## 후속 권고 #2 — catch 분기 payload 수치 디커플링 — 해소됨

1차 검토에서 지적한 catch(WARNING/FAILED) 분기의 스칼라 카운트 4종(`updatedCount /
noNewItemsCount / failedCount / totalTargets`)이 하드코딩 `processed:0 / success:0 / failed:1`
과 모순될 수 있던 문제를 Coder 가 반영했다.

`git diff` 로 확인한 수정 범위:
- `run-scheduled-news-update.js` **성공 분기**: 1차 검토 시점과 바이트 단위로 동일 (변경 없음).
  breakdown 배열 3종 + 스칼라 카운트 4종 + messageKo 요약 4줄을 그대로 세팅.
- `run-scheduled-news-update.js` **catch 분기**: `payload.universityBreakdown`(배열 3종) +
  messageKo 요약 줄만 유지, 스칼라 카운트 4종 세팅 라인 **제거**. 의도 설명 주석 4줄 추가
  (그 분기의 processed/success/failed 는 하드코딩값이라 카운트를 함께 두면 모순).
- `university-update-summary.js`: 함수 로직 **변경 없음**. 파일 상단에 소비처 계약 주석
  (성공 = 배열 + 카운트 + 요약 / catch = 배열 + 요약) 6줄 추가.

회귀 여부: 성공 분기 diff 무변화, 순수 함수 로직 무변화, `node --check` OK, 신규 테스트 21/21,
전체 `npm test` 295/295/0 유지. 수정이 권고 #2 범위에 국한되고 다른 로직에 영향 없음을 확인.

결과: 완료 기준 5 불변식(`payload.failedCount === payload.failed` 등)이 이제 무조건 성립한다.
카운트 4종은 성공 분기에서만 존재하며, catch 분기의 `universityBreakdown.failed` 는 배열이라
스칼라 `payload.failed` 와 키 의미가 명확히 구분된다. WARNING/FAILED 리포트는 배열 breakdown +
messageKo 요약으로 부분 수집 정보를 여전히 제공한다.

## 나머지 위험 요소 심각도 판정 (전부 비차단)

- **위험 #1 (hasError 술어 `filter(Boolean)` 미세 불일치)** — 무시 가능. 순수 함수는
  `errors.filter(Boolean).length > 0`, 기존 payload 술어는 `(x.errors||[]).length`. `errors` 가
  전부 falsy 인 경우에만 갈리는데 `runner.js` 는 `errors` 항목을 항상 `` `${sourceName}: ${error}` ``
  (truthy)로 생성하므로 프로덕션 미발생. spec 요구사항 2 + 구현 계획 pseudo-code 가 `filter(Boolean)`
  를 강제(spec 내부 모순)하며 Coder 는 계획을 정확히 따랐다.
- **위험 #3 (`universityBreakdown` 값이 null/배열일 때 폴백 전용 테스트 부재)** — 무시 가능.
  `value && typeof value === "object" && !Array.isArray(value)` 가드로 기존 `<pre>` 경로 폴백,
  `JSON.stringify(null)` → `"null"` 로 크래시 없음. 코드 인스펙션 확인. 실사용상 payload 는 항상
  객체이거나 키 자체가 없음.
- **위험 #4 (catch 분기 `run` undefined 가드 전용 테스트 부재)** — 무시 가능. `let status,run`
  초기 undefined → `run && Array.isArray(...)` false → 새 필드 미세팅 → 기존 동작 유지. 코드
  인스펙션 확인. 이 경로는 `asyncMain()` 즉시 실행 구조 + Q4 기본값(require.main 가드 미추가)으로
  자동 테스트 불가.
- **위험 #5 (HTML 중첩 표 육안 확인 미수행)** — 후속 권고(우선순위 하, 비차단). `.ubk th{width:auto}`
  가 전역 `th{width:260px}` 를 오버라이드하는지 브라우저 확인은 환경상 불가. 렌더 구조는
  테스트로 고정되어 데이터 정확성에는 영향 없음. 배포 전
  `server/agent/news/reports/ui/latest-news-update-report.html` 1회 육안 확인 권장.
- **위험 #6 (`run-scheduled-news-update.js` 실환경 실행 미검증)** — 무시 가능. 네트워크/git push/
  배포를 수행하므로 범위 밖이자 금지 규칙. 이번 변경은 payload 표현 계층에 국한되어 스케줄러
  핵심 흐름(수집/커밋/푸시)에 손대지 않았다. 순수 함수 + HTML 렌더 + `node --check` + 전체
  `npm test` 로 대체 검증.

## 그 외

- 명백한 오류·안전 문제 없음. `esc()` 로 실패 사유 특수문자 이스케이프 처리됨.
- `.pipeline/spec.md` 가 diff 상 대폭 축소되었으나 파이프라인 산출물이며 제품 코드가 아니다.
  현재 spec 내용 기준으로 완료 기준 충족을 확인했다.

# 최종 판정
승인

# 판정 이유

1. **최초 요구사항 5개 항목과 spec 완료 기준 1~9 를 모두 충족**했고, Tester 결과와 Reviewer
   2차 재확인이 일치한다. 21개 신규 테스트, 전체 `npm test` 295/295/0 (1차 3회 + 후속 수정 후
   재확인) 결정적 통과.

2. **spec 제약을 전부 준수**한다: 수집·중복 로직(runner.js/collector.js) 불변, 기존 payload
   필드·타입·status 4분기 유지(하위 호환), 새 필드만 추가, 신규 npm 의존성 0, git add/commit/
   push/배포 미실행, 수정 금지 파일 8종 전부 불변. `git diff` 로 제품 코드 변경이 2파일 최소
   diff 임을 직접 확인했다.

3. **1차 검토의 유일한 실질 쟁점(위험 #2, catch 분기 payload 수치 디커플링)이 해소되었다.**
   catch 분기에서 스칼라 카운트 4종 세팅을 제거하고 배열 breakdown + messageKo 요약만 남겨,
   완료 기준 5 불변식이 무조건 성립한다. 성공 분기와 순수 함수 로직에는 회귀가 없음을 diff·
   테스트로 확인했다. 의도 설명 주석과 소비처 계약 주석도 추가되어 유지보수성이 개선됐다.

4. 나머지 위험 #1·#3·#4·#6 은 프로덕션 미발생이거나 코드 인스펙션으로 확인된 방어 로직이며,
   #5(HTML 육안 확인)는 데이터 정확성 무관한 레이아웃 항목으로 배포 전 1회 확인만 권고한다.

현재 상태는 배포(병합) 가능하다.
