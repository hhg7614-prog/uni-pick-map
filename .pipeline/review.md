# 검토 요약

`discover-nara-cms-batch.js`의 Nara CMS 탐지·게시판 선택 개선 라운드(다중 시그널
탐지 §A, sitemap 기반 게시판 발견+nav 폴백 §B, 커밋 전 후보별 실검증 §C,
request budget 8→18+90s 상한 §E, `--retry-decisions` 플래그 §G)를 spec.md /
changes.md / test-results.md 및 실제 git diff, 실행 재현을 통해 검토했다.

spec.md는 사용자 원문 요구 5개 항목·제약·완료 기준을 코드 위치까지 구체화해
충실히 반영했다. changes.md의 구현은 spec §A~§G와 라인 단위로 대조한 결과
정확히 일치했다(직접 diff 확인). test-results.md의 검증도 Coder 주장을 그대로
베끼지 않고 코드 대조 + `node --test`/`npm test` 독립 재실행 + 완료 기준 1/2/
2-보조의 실측 네트워크 재현까지 수행한 것으로 판단된다(본 Reviewer도 동일
명령을 독립적으로 재실행해 41/41, 350/350을 재확인했고, fullscan2.json
베이스라인의 daegu/sehan/hallym/kongju 레코드를 직접 조회해 Tester의 주장과
정확히 일치함을 확인했다).

# 요구사항 확인

## 1. spec.md의 사용자 요구 반영 타당성

- 만들 것 1-5(다중 시그널, sitemap 기반 발견+nav 폴백, 커밋 전 검증, budget
  8→18, `--retry-decisions`)를 §A~§G에 정확히 대응시켰다.
- **인천대 SOURCE_ALREADY_EXISTS 문제 → 스크래치 사본 방식**: 타당하다.
  인천대는 이미 `inu-press-release` 소스를 보유해 실제 파이프라인이
  `SOURCE_ALREADY_EXISTS`로 즉시 반환하는 것이 정상 동작(중복 방지)이며,
  이를 우회하려고 실제 코드 로직을 바꾸는 대신 `runBatch()`가 이미 받는
  `catalogFile`/`candidatesFile`/`stateFile`/`reportDir` 옵션을 스크래치
  디렉터리로 격리해 시연한 것은 "새 CLI 플래그 추가 금지" 원칙과 부합하는
  합리적 선택이다. 운영 카탈로그는 read-only로 유지됐다(diff 0 확인).
- **완료 기준 2의 대구대 재선정 근거**: fullscan2.json을 직접 조회해
  `kongju-national-university-본교`/`gangneung-wonju-national-university-*`가
  이미 `DIAGNOSE_FAILED`(isNara 이미 true)였지 `NOT_NARA_CMS`가 아니었다는
  Planner의 판단이 정확함을 확인했다. `daegu-university-본교`가 실제
  `NOT_NARA_CMS`/`no_nara_pattern`이었다는 것도 fullscan2.json에서 확인했다.
  다만 이 대상 선정의 최종 전제("기존 단위 테스트 픽스처가 실제 Nara CMS
  가능성을 시사한다")는 실측 결과 틀린 것으로 드러났다(§3 참고) — 이는 아래
  "문제점"에서 별도로 다룬다.

# 테스트 결과

- `node --check` 양쪽 파일 OK(Reviewer 재실행 확인).
- `node --test discover-nara-cms-batch.test.js` → **41/41 pass**(Reviewer
  독립 재실행으로 일치 확인).
- `npm test` → **350/350 pass**(Reviewer 독립 재실행으로 일치 확인).
- 완료 기준 1(인천대 스크래치 시연): PACKET_CREATED, site=inu, boardId=2594,
  detectionSignals.isNara=true, reviewId 채워짐 — changes.md/test-results.md
  보고와 일치. 생성된 review-packet 잔여 파일은 정리됐고(`git status`/
  `ls`로 확인, Aug 31 기존 커밋 파일만 남아 있고 이번 라운드 생성분은 없음),
  스크래치 카탈로그/상태 파일은 저장소 밖(OS temp)에만 존재.
- 완료 기준 2(대구대): spec 지정 대상으로는 재현 불가(NOT_NARA_CMS 그대로).
  대체 대상(세한대/한림대)으로 취지 실증. fullscan2.json에서 세 대학 모두
  베이스라인 `NOT_NARA_CMS`/`no_nara_pattern`이었음을 Reviewer가 직접
  재확인.
- 완료 기준 2-보조(공주대): `DIAGNOSE_FAILED`, `boardId=null`(옛 코드의
  `2134` 고정 커밋과 다름), `reason`에 `no_valid_board_found` 명시.
  fullscan2.json 베이스라인(`boardId:"2134"`, `reason:"rss_invalid:items<2"`)
  과 대조해 개선을 확인. `tried=1`로 OR 조건 중 `boardId!=="2134"` 항만
  충족(`failures.length>1`은 미충족) — 실제 사이트 구조(nav 후보 1개뿐)에
  기인하며 코드 결함이 아니라는 Tester 판단이 타당하다.

# 문제점

1. **완료 기준 2가 spec 지정 정확한 대상(대구대)으로 재현되지 않음**
   (`server/agent/onboarding/tools/discover-nara-cms-batch.js` 자체 결함
   아님, `.pipeline/spec.md` "가정/결정 3"의 전제 오류). 근본 원인은 spec
   작성 시점에 라이브 네트워크 접근 없이 기존 단위 테스트의 **합성
   픽스처**(`www.daegu.ac.kr/bbs/daegu/123/artclList.do`, 실제로는
   cross-host 판정 테스트용으로 만든 가상 URL)를 실제 사이트 구조의
   근거로 오인한 것이다. Reviewer가 테스트 파일 230-241행을 직접 확인해
   이 픽스처가 실제 대구대 사이트 캡처가 아닌 합성 데이터임을 재확인했다.
   → 이는 문서(spec.md)의 사실 오류이지 이번 라운드가 구현한 코드의
   버그가 아니다. 코드는 세한대/한림대에서 정확히 의도대로 동작했다.
2. **완료 기준 2-보조의 `tried=1`**: spec 문구가 요구한 "여러 후보를 실제로
   시도했다는 증거(`failures.length > 1`)"는 공주대 실측에서 충족되지
   못했다(OR 조건의 다른 절로만 통과). 실제 원인(공주대 nav 후보가 라벨
   매칭 기준 1개뿐, sitemap은 200이지만 K2WebWizard 오류 페이지라 0개
   추출)도 Tester가 직접 조사해 코드 결함이 아님을 확인했고, 오프라인
   단위 테스트 N7(b) 케이스가 "여러 후보 재시도" 시나리오 자체는 별도로
   견고하게 커버하고 있어 리스크는 낮다.
3. **§B sitemap 경로가 실전에서 잘 안 쓰임**(위험 요소, 결함 아님): 인천대/
   공주대 실측 모두 최종적으로 nav 폴백으로 귀결됐다. `extractSitemapMenuEntries`
   정규식이 실제 대학 sitemap 마크업(중첩 구조 등)과 안 맞을 가능성이 있다는
   점을 spec "가정/결정 4"가 이미 명시했고, 예외 처리(자동 nav 폴백)도 정상
   동작하므로 파이프라인이 막히지는 않는다. 다음 라운드에서 표본을 더 모아
   정규식을 보정할 필요가 있다는 코멘트는 타당하나 이번 라운드 승인 여부와는
   무관하다.
4. **경미한 문서/재현 노이즈**(코드 결함 아님): spec.md의 완료 기준 1 예시
   커맨드 중 `regressionEvidence.npmTestSummary` placeholder 문자열이 B2의
   패턴 검증(`/\bfail\s+[1-9]/` 부재 요구)에 걸려 그대로 실행하면 실패한다는
   점을 Coder/Tester가 공통으로 발견하고 실제 npm test 요약 문자열로
   대체해 우회했다. 코드 수정 없이 검증 커맨드 문서만의 문제이므로 다음
   spec 갱신 시 예시를 고쳐두면 된다.

요청하지 않은 변경 여부: `boardSource`(sitemap/nav/null) 필드와
`detectionSignals` 필드가 base 스키마에 추가됐으나, spec §F 8단계와 N16
요구사항이 "결과 필드로 확인"하라고 명시적으로 요청한 투명성 필드이며 기존
스키마 필드는 전혀 제거·변경되지 않았다 — 범위를 벗어난 변경이 아니다.
그 외 사용자가 요청하지 않은 기능 추가나 무관한 리팩터링은 발견되지 않았다.

AGENTS.md/제약 위반 여부: `git diff --stat`으로 `rss-collector.js`,
`run-single-school-trial.js`, `prepare-catalog-source-block.js`,
`build-review-packet-from-diagnose.js`, `server/agent/gate/*`,
`server/agent/screening/*`, `universities.js`, `server/agent/data/agent-news-store.json`,
`data/university-news-preview.json`, 운영 카탈로그(`university-news-sources.final.json`)
전체에 diff 0임을 Reviewer가 직접 재확인했다. `enabled:true` 전환, store/
preview 직접 쓰기, git commit/push, 배포는 전혀 실행되지 않았다(`git log`
HEAD 그대로, `git status`도 의도한 5개 파일만 modified).

# 최종 판정
승인

# 판정 이유

spec.md → changes.md → test-results.md 세 문서가 서로 정합적이고, 실제
코드(diff)와 대조한 결과 spec §A~§G 요구사항이 정확히 구현돼 있음을 직접
확인했다. 단위 테스트(N1~N16 + 기존 #14/#18c/#18d 수정분)는 형식적 통과용이
아니라 실제 회귀 방지력을 갖는다 — 특히 N7(첫 통과/재시도/전부 실패 3분기),
N9/N10(budget 경계값), N14/N15(4-hop 경계), N16(sitemap/nav 분기)은 이번
라운드가 고치려는 두 근본 원인(단일 시그널 오탐, 빈 게시판 재시도 없이 확정)을
정확히 겨냥한 케이스다. `node --check`/`node --test`(41/41)/`npm test`
(350/350)를 Reviewer가 독립적으로 재실행해 모두 일치함을 확인했고, 금지
파일 무변경과 커밋/배포 없음도 git으로 직접 재확인했다.

완료 기준 2가 spec이 지정한 정확한 대상(대구대)으로는 재현되지 않지만, 이는
spec.md 자체의 가정 오류(라이브 데이터 검증 없이 합성 테스트 픽스처를
근거로 대상을 선정)에서 비롯된 것이지 코드 결함이 아니다. Reviewer가 직접
fullscan2.json 베이스라인과 테스트 픽스처 원문을 조회해 이 원인 분석이
사실임을 검증했다. 코드는 세한대·한림대라는 실제 라이브 사례에서 의도한
전환(NOT_NARA_CMS → isNara=true)을 정확히 재현했으며, Tester도 이 사실을
투명하게 기록하고 "부분통과(취지 충족)"로 명확히 표시했다. 완료 기준
2-보조의 `tried=1` 역시 OR 조건의 다른 절로 통과했고 원인이 코드가 아닌
실제 사이트 구조임이 확인됐다. 두 사안 모두 "코드 품질과 무관한 문서상
이슈"로 분류하는 것이 타당하며, 승인을 막을 만한 결함으로 보지 않는다.

# 사용자가 직접 확인해야 할 사항

1. `.pipeline/spec.md`의 완료 기준 2가 실측상 재현 불가능한 대상
   (`daegu-university-본교`)을 지정하고 있다는 점을 인지하고, 다음 라운드
   진행 전에 spec.md의 이 항목을 세한대/한림대 등 실측 확인된 대상으로
   갱신할지 결정이 필요하다(코드 변경 불필요, 문서만 수정하면 됨).
2. 이번 라운드는 대구대/세한대/한림대/공주대에 대해 실제 운영 카탈로그를
   전혀 변경하지 않았다(전부 `--dry-run` 또는 스크래치 사본). 실제로 이
   대학들을 운영 파이프라인에 태워 후보를 등록하려면 사용자가 별도로
   `--limit=N`(운영 경로) 실행을 명시적으로 요청해야 한다.
3. §B(sitemap 기반 게시판 발견)가 실전 2개 표본(인천대/공주대) 모두에서
   최종적으로 nav 폴백으로 귀결됐다는 점 — 파이프라인은 정상 동작하지만
   "sitemap 우선" 효과가 아직 실증되지 않았다. 다음 라운드에서 실제
   sitemap 마크업 샘플을 더 수집해 `extractSitemapMenuEntries` 정규식을
   보정할 필요가 있어 보인다(이번 승인과는 무관한 개선 여지).
