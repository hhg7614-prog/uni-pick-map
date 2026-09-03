# 테스트 요약

`discover-nara-cms-batch.js`/`.test.js` 변경분을 spec.md/changes.md 대비 코드
직독 + 직접 재실행(정적 검사, 단위 테스트, 전체 회귀, 완료 기준 1/2/2-보조 실측
재현)으로 검증했다. spec.md §A~§G 요구사항이 실제 코드에 그대로 구현돼 있고,
changes.md 가 보고한 수치(node --check OK, node --test 41/41, npm test 350/350,
완료 기준 1/2/2-보조 실측 결과)를 전부 독립적으로 재현해 일치를 확인했다.
변경 범위(이 두 파일만)와 "절대 건드리지 않음" 목록도 git status/diff 로
위반 없음을 확인했다. 발견된 결함(코드 버그) 없음. 한 가지 경미한 관찰 사항
(§B sitemap 경로가 실전에서는 nav 폴백보다 덜 채택됨, "완료 기준 2-보조"의
`tried>1` 조건 미충족 등)은 changes.md 가 이미 투명하게 밝힌 것과 일치하며
완료 기준 자체는 OR 조건으로 통과.

전체 결과: **통과**

# 완료 기준

- 조건 1 (인천대 실측 시연: `detectNaraCms=true`, board 2594, `rssList.do items>=2`,
  diagnose 통과, review-packet 생성): 통과 — 직접 재현 완료(아래 재현 방법 참고).
- 조건 2 (NOT_NARA → isNara=true 전환, 대구대 지정): **부분통과(취지는 충족, 지정
  대상 자체는 spec 가정 오류로 재현 불가)** — 아래 상세 참고. 대체 대상(세한대/
  한림대)으로 취지 실증은 통과.
- 조건 2-보조 (공주대 게시판 재검증 개선): 통과(OR 조건 중 `boardId !== "2134"`
  충족, `tried>1` 조건은 미충족하나 spec 문구가 "이거나"로 OR 결합이므로 전체
  통과로 판정) — 단, 아래 "위험 요소"에 재확인 포인트 기록.
- 조건 3 (단위 테스트): 통과 — `node --test` 41/41 재현.
- 조건 4 (전체 회귀): 통과 — `npm test` 350/350 재현.
- 부가: 변경 범위 준수(이 두 파일만, 절대 건드리지 않음 목록 무결): 통과.
- 부가: `enabled:true`/store/preview/git/배포 없음: 통과.

# 검증 항목별 근거

## 1. spec.md 대비 코드 구현 일치 여부 (§A~§G)

`server/agent/onboarding/tools/discover-nara-cms-batch.js` 전체를 직접 읽고
spec.md 의사코드/시그니처와 라인 단위로 대조했다.

- **§A `detectNaraCms` 다중 시그널**(파일 350-459행): `extractRobotsSitemapUrls`
  (367행), `robotsSignalIndicatesNara`(380행), `sitemapSignalIndicatesNara`
  (397행) 가 spec 코드 블록과 정확히 동일. `detectNaraCms(html, options={})`
  가 A→B→C 순서로 평가하고(444-446행), evidence 조립이 `[A?, B?, ...C(최대3)]`
  (448-451행)으로 spec의 "최대 5개(A1+B1+C3)" 규칙과 일치. A/B 문자열 접두사
  형식(`"[A] robots Sitemap -> ..."`, `"[B] xmlSite/siteMap.do subview.do
  links=..."`)도 spec 그대로. C 는 접두사 없이 기존 스니펫 형식 유지(410-442행,
  기존 로직 변수명만 `evidence`→`cEvidence` 변경, 로직 불변 — 회귀 없음, 아래
  §3 재실행으로 재확인).
- **§B sitemap 기반 게시판 발견 + nav 폴백**(494-523행, 1315-1349행):
  `extractSitemapMenuEntries`/`prioritizeBoardCandidates` 순수 함수가 spec
  그대로. `processUniversity` 내부(1315행부터)에서 `sitemapHtml` 있으면 sitemap
  경로 시도 → 후보 0개면 자동으로 `extractNavBoardLinks` 폴백(1333행 `if
  (!boardCandidates.length)`) → 그래도 0개면 `DIAGNOSE_FAILED`/`no_board_found`
  (1350행). `MAX_BOARD_CANDIDATES=4` 상수(72행) 로 두 경로 모두 상한 적용.
  `boardSource` 필드(sitemap/nav/null)로 실제 채택 경로를 리포트에 남김(신규
  투명성 필드, spec N16 "결과 필드로 확인" 요구를 충족하기 위한 추가 — spec 이
  금지한 "새 개념"이 아니라 기존 스키마에 부가 필드를 얹은 것뿐이므로 §제약
  위반 아님).
- **§C `selectValidatedBoard`**(622-685행): 후보를 순회하며 `directBoardId`
  없으면 subview fetch→`extractSiteAndBoardId`, 있으면 바로 `rssCollectorImpl`
  로 rssList.do 검증(`verifyRssFeed`), 실패 시 `failures[]`에 사유 남기고
  **다음 후보로 계속**(668행 `continue`), 첫 통과만 채택해 즉시 반환
  (671-682행). 예산/타임아웃 에러(`isGateBudgetError`)만 즉시 rethrow(643,
  661행) — spec §C 의사코드와 완전히 일치. 실제 동작은 N7(922행)로 확인,
  아래 §6 참고.
- **§D `runPreflight` 의 `prefetchedRssResult`**(754-783행): 인자가 있으면
  `rssCollectorImpl` 재호출을 건너뛰고 그대로 사용(766-769행), 없으면 기존과
  100% 동일 fetch 경로(771행부터). N8 테스트가 "rssUrl 매핑을 일부러 안 넣어
  재조회하면 실패"하는 방식으로 실제 재조회 스킵을 증명 — 실행해 통과 확인.
- **§E request budget**: `createFetchGate` 기본값 `maxRequests: 18`(1079행),
  `maxElapsedMs: 90000`(1081행), `minDelayMs: 500`/`timeoutMs: 15000` 불변
  (1078, 1080행) — spec 그대로. `isGateBudgetError`(1139-1141행) 신규 헬퍼가
  두 코드만 true 반환. `processUniversity` 내 4곳+신규 2곳(sitemap fetch,
  selectValidatedBoard 호출) 총 6곳에서 `isGateBudgetError` 로 예산/타임아웃
  에러를 감지해 `finalDecision="ERROR"` 로 즉시 반환(`budgetErrorPatch` 헬퍼,
  1184-1189행) — spec §E 요구와 일치. 대학당 최악 요청 수 계산(홈1+리다이렉트
  4+robots1+sitemap1+게시판루프8+preflight상세3=18) 도 실제 코드 흐름과 일치
  (1206-1428행 순서 확인).
- **§F `processUniversity` 흐름 재배선**: 순서(BLOCK_MISSING→
  SOURCE_ALREADY_EXISTS→gate 생성→홈+4-hop 리다이렉트→host/origin 확정→
  robots 1회 fetch(신규 위치)→sitemap fetch(신규)→detectNaraCms 다중시그널→
  boardCandidates(§B)→selectValidatedBoard(§C)→robots path 판정(캐시 재사용)→
  buildCandidateSource→runPreflight(prefetchedRssResult)→dryRun 분기→실쓰기)
  가 파일 1145-1530행 그대로 정확히 이 순서. 4-hop 리다이렉트 루프
  (`for (let hop = 0; hop < 4; hop += 1)`, 1221행)와 루프 후에도 여전히
  스텁이면 `NOT_NARA_CMS`/`redirect_loop_or_double_stub`(1250행) 로직도
  spec 과 일치.
- **§G `--retry-decisions`**: `parseCliArgs`(134-146행) 콤마 파싱+trim+빈값
  제거, 빈 값 지정 시 throw. `selectCandidates`(247-263행) 에서
  `retryDecisions` 있으면 상태의 `finalDecision` 매칭 필터(상태 없는 대학은
  자동 제외), `resume` 은 `else if` 로 자동 배타(spec 의도 그대로). `runBatch`
  (1539, 1572-1577행)→`selectCandidates` 전달, `buildReport`(998행)의
  `report.options.retryDecisions` 필드 기록, `main()`(1689행)에서
  `runBatch` 로 전달 — 배선 전체 확인.

**결론**: spec §A~§G 전 항목이 실제 코드에 정확히 구현돼 있다. changes.md 의
"spec 코드 블록 그대로 구현했다"는 주장은 사실과 일치한다.

## 2. 변경 범위 및 수정 금지 파일 확인

```
git status --porcelain=v1 -uall
```
결과: `.pipeline/changes.md`, `.pipeline/spec.md`,
`server/agent/onboarding/tools/discover-nara-cms-batch.js`,
`server/agent/onboarding/tools/discover-nara-cms-batch.test.js` 4개만 수정
표시. 추가로:

```
git diff --stat -- development/university-news/collectors/rss-collector.js \
  server/agent/tools/run-single-school-trial.js \
  server/agent/onboarding/tools/prepare-catalog-source-block.js \
  server/agent/onboarding/tools/build-review-packet-from-diagnose.js \
  server/agent/gate server/agent/screening universities.js
```
출력 없음(diff 0) — spec.md "절대 건드리지 않음" 목록 전체 무결 확인. 게이트/
스크리닝 모듈, `universities.js`, rss-collector 등 재사용만 하고 수정하지
않았다는 changes.md 주장과 일치.

`git log --oneline -5` 확인 결과 세션 시작 시점 이후 새 커밋 없음(`e06af01`
그대로 HEAD) — git commit/push 를 실행하지 않았다는 changes.md 주장과 일치.
`server/agent/data/agent-news-store.json`, `data/university-news-preview.json`
diff 도 0 — store/preview 미변경 확인.

## 3. 직접 재실행 — 정적 검사 / 단위 테스트 / 전체 회귀

```
node --check "server/agent/onboarding/tools/discover-nara-cms-batch.js"
node --check "server/agent/onboarding/tools/discover-nara-cms-batch.test.js"
```
→ 둘 다 무출력(OK). changes.md 주장과 일치.

```
node --test "server/agent/onboarding/tools/discover-nara-cms-batch.test.js"
```
→ `tests 41 / pass 41 / fail 0 / cancelled 0`. changes.md 가 보고한
"41/41" 과 정확히 일치(테스트 이름 목록도 spec §테스트 계획의 N1~N16, 기존
1-21(#14/#18c/#18d 수정 포함) 과 일치).

```
npm test
```
→ `tests 350 / pass 350 / fail 0`. changes.md 가 보고한 "350/350" 과 정확히
일치. 기존 스위트(onboarding/screening/gate/news 등) 회귀 없음.

## 4. 완료 기준 실측 재현 (네트워크 가능 확인됨)

네트워크 접근이 가능함을 `fetch('https://www.inu.ac.kr/')` 로 먼저 확인
(status 200) 한 뒤, spec.md 가 명시한 완료 기준 커맨드를 그대로 재실행했다.

### 완료 기준 1 — 인천대 스크래치 시연

spec.md 커맨드를 거의 그대로 사용(단, `--university-id` 로 넘기는 한글
universityId 문자열을 bash 도구 경유 시 NFC/NFD 정규화 차이로 카탈로그의
원본 NFD 문자열과 바이트 단위로 어긋나는 환경 이슈가 있어, 카탈로그에서 찾은
`uni.universityId` 원본 문자열을 그대로 `runBatch({ universityId: uni.universityId,
... })` 로 넘기는 방식으로 대체 — 이는 테스트 실행 환경의 인코딩 이슈이며
`selectCandidates` 자체는 NFC 정규화 비교를 이미 하고 있어 코드 결함이
아니다). `regressionEvidence.npmTestSummary` 도 changes.md 가 지적한 대로
spec 예시의 `"pre-collected, see npm test run"` 문자열을 그대로 쓰면 B2 의
`/\bfail\s+[1-9]/` 미검출 요구(정상 문자열 필요) 검증에 걸려 실행조차 안 되는
것을 직접 재현으로 확인했고, `"tests 350, pass 350, fail 0"` 로 교체하니
정상 진행됨 — changes.md 의 "spec 예시 placeholder 문제" 주장은 사실이었다.

실행 결과(직접 재현):
```
"finalDecision": "PACKET_CREATED",
"site": "inu",
"boardId": "2594",
"rssUrl": "https://www.inu.ac.kr/bbs/inu/2594/rssList.do",
"requestCount": 10,
"detectionSignals": { "isNara": true, "signals": { "A": true, "B": true, "C": true } },
"boardSource": "nav",
"reviewId": "rp-incheon-national-university-본교-inu-press-release-20260903142011-8a03d4",
"writtenPath": "...review-packets\\rp-...-20260903142011-8a03d4.json"
```
스크래치 카탈로그 사본(OS 임시 디렉터리) 사용, 운영 카탈로그
(`development/university-news/data/university-news-sources.final.json`)
diff 0 확인. B2 가 실제로 `server/agent/gate/data/review-packets/`에 새
review-packet 파일을 생성하는 부작용은 changes.md 가 미리 경고한 대로였고,
Tester 도 검증 직후 해당 파일을 삭제해 `git status` 를 재확인, 잔여물 없음을
확인했다(첫 삭제 시도는 한글 파일명 인코딩 문제로 bash `rm` 이 실패해 Node
`fs.unlinkSync` 로 재시도해 성공 — 이 역시 Windows 셸/파일시스템 인코딩
환경 이슈이며 코드 결함이 아니다).

**통과 조건 전부 재현 확인**: `finalDecision===PACKET_CREATED`,
`site===inu`, `boardId===2594`, `detectionSignals.isNara===true`, `reviewId`
채워짐. changes.md 의 완료 기준 1 실측 로그와 값(evidence, requestCount=10 등)
까지 동일하게 재현됐다 — 신뢰도 높음(같은 라이브 사이트를 같은 코드로 재실행한
결과이므로 당연하지만, 독립 재현 자체가 검증 목적).

### 완료 기준 2 — NOT_NARA → isNara=true 전환 (대구대)

```
node "server/agent/onboarding/tools/discover-nara-cms-batch.js" \
  --university-id=daegu-university-본교 --dry-run
```
→ `NOT_NARA=1`(즉 `finalDecision==="NOT_NARA_CMS"`), 리포트 확인:
`detectionSignals: {isNara:false, evidence:[], signals:{A:false,B:false,C:false}}`,
`reason:"no_nara_pattern"`. **spec 이 기대한 전환이 재현되지 않는다** —
changes.md 의 주장과 정확히 일치.

이 판단의 타당성을 독립적으로 재검증했다:
```
node -e "fetch('https://www.daegu.ac.kr/robots.txt')...; fetch('.../xmlSite/siteMap.do')..."
```
→ robots.txt 에 `Sitemap:` 라인 자체가 없음(시그널 A 불가), `xmlSite/siteMap.do`
는 404(시그널 B 불가). fullscan2.json 베이스라인도 직접 확인:
`daegu-university-본교` → 베이스라인부터 `NOT_NARA_CMS`/`no_nara_pattern`
(변경 없음, 실제로 전환 대상이 아니었음을 뒷받침). 즉 **`daegu-university-본교`
(www.daegu.ac.kr) 는 실측상 Nara CMS 가 아니며, spec.md "가정/결정 3" 의
근거(기존 단위 테스트 픽스처가 `www.daegu.ac.kr/bbs/daegu/...` 를 다룬다)는
합성 테스트 픽스처였을 뿐 실제 라이브 사이트 구조와 무관했다** — changes.md 의
원인 분석이 타당하다고 판단.

changes.md 가 제시한 대체 시연(세한대/한림대)도 독립 재현:
```
node "...discover-nara-cms-batch.js" --university-id=sehan-university-본교 --dry-run
node "...discover-nara-cms-batch.js" --university-id=hallym-university-본교 --dry-run
```
→ 둘 다 `NOT_NARA=0`, 리포트: `sehan` → `{isNara:true, signals:{A:false,B:true,C:false}}
evidence:["[B] xmlSite/siteMap.do subview.do links=334"]`, `hallym` → 동일 패턴
(`links=4449`). fullscan2.json 베이스라인 재확인: 두 대학 모두 베이스라인에서는
`NOT_NARA_CMS`/`no_nara_pattern` 이었음을 직접 확인 — **다중 시그널(특히 신규
시그널 B) 이 실제 라이브 사이트에서 `NOT_NARA_CMS`→`isNara=true` 전환을
일으킨다는 완료 기준 2 의 취지는 실측으로 명확히 증명됐다.**

**판정**: spec 이 지정한 정확한 대상(`daegu-university-본교`) 로는 재현 불가능
(spec 자체의 가정 오류, 코드 결함 아님) → 이 좁은 의미로는 **실패**. 그러나
"NOT_NARA_CMS 오탐을 다중 시그널로 고친다"는 완료 기준의 취지는 대체 대상으로
명확히 실증됨 → 넓은 의미로는 **통과**. Tester 판정: **부분통과(취지 충족)** 로
기록하며, spec.md 자체의 대상 선정 오류(라이브 데이터 없이 문서 작성 시점에
합성 픽스처를 근거로 삼음)가 원인이라는 점을 명확히 남긴다. Reviewer/사용자가
"완료 기준 문구를 문자 그대로" 요구한다면 이 기준은 재작성(대상 대학 변경)이
필요하다는 점을 참고할 것.

### 완료 기준 2-보조 — 공주대 게시판 재검증 개선

```
node "server/agent/onboarding/tools/discover-nara-cms-batch.js" \
  --university-id=kongju-national-university-본교 --dry-run
```
→ `DIAGNOSE_FAILED=1`. 리포트 확인:
```
"boardId": null,
"reason": "no_valid_board_found tried=1 [rss_invalid:items<2 (got 0)]",
"detectionSignals": {"isNara": true, "signals": {"A": false, "B": false, "C": true}},
"boardSource": "nav"
```
changes.md 의 보고와 정확히 일치. fullscan2.json 베이스라인 재확인:
베이스라인은 `boardId:"2134"`, `reason:"rss_invalid:items<2 (got 0)"` (빈
게시판을 그대로 커밋 시도하고 끝났었음). 새 실행은 `boardId!==2134`(빈
게시판을 커밋하지 않고 `null` 로 명시적으로 "실패"를 리포트) — spec 의 OR
조건(`boardId !== "2134"` 이거나 `failures.length > 1`) 중 첫 항을 충족한다.

추가로 원인을 직접 확인했다: `https://www.kongju.ac.kr/xmlSite/siteMap.do` 는
실제로 HTTP 200 을 반환하지만 본문은 사이트맵 메뉴가 아니라 "Alert" 오류
페이지(K2WebWizard CMS 프레임워크의 JS 경고 페이지, `subview.do` 문자열
0개)였다 — `extractSitemapMenuEntries` 가 정상적으로 0개 항목을 반환해
자동으로 nav 폴백 경로로 진입했고(§B 의사코드/예외 상황 표 그대로 동작),
nav 에서 발견된 라벨 매칭 후보가 1개뿐이라 `tried=1` 로 끝났다. 이는 spec
"가정/결정 4"(sitemap 실제 마크업 미검증, 정규식이 실제와 다를 수 있음을
사전에 명시)가 예견한 상황이 실측으로 그대로 나타난 것이며, 파이프라인은
예외 상황 표대로 정상 동작했다(막히지 않고 nav 폴백으로 계속 진행) —
**코드 결함이 아니다.**

**판정**: 통과(OR 조건 중 한 항목 충족). 다만 spec 문구의 "여러 후보를 실제로
시도했다는 증거(failures 길이 > 1)" 는 이번 실측에서는 충족하지 못했다는
점(`tried=1`)을 changes.md 도 이미 투명하게 기록했고, Tester 도 원인(실제
사이트 구조상 라벨 매칭 후보가 nav 기준 1개뿐)을 직접 확인해 동일 결론에
도달했다.

# 실패한 테스트

없음(node --check/--test/npm test 전부 성공, changes.md 주장과 완전 일치).
"실패"로 분류할 만한 항목은 완료 기준 2 하나뿐이며, 이는 spec.md 자체가
지정한 시연 대상(`daegu-university-본교`)의 전제(실측 없이 세운 가정)가
틀렸기 때문이지 Coder 의 구현 결함이 아니다(§완료 기준 2 상세 참고). Coder 가
대체 대상으로 취지를 실증했고 그 판단도 Tester 가 독립적으로 재현·검증했다.

# 재현 방법

```powershell
# 정적 검사 + 단위 테스트 + 전체 회귀
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js"
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
node --test "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
npm test

# 완료 기준 2 / 2-보조 (네트워크 필요, --dry-run 이라 카탈로그/후보/B1/B2 미호출)
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=daegu-university-본교 --dry-run
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=sehan-university-본교 --dry-run
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=hallym-university-본교 --dry-run
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kongju-national-university-본교 --dry-run
# (각 실행 후 생성된 report/state 파일은 server/agent/onboarding/reports|data 아래
#  .gitignore 로 이미 제외돼 있음 — 별도 정리 불필요, git status 로 확인 가능)

# 완료 기준 1 (스크래치 카탈로그 사본, 운영 파일 read-only) — spec.md §완료 기준 1
# 커맨드 그대로. 단, regressionEvidence.npmTestSummary 는 "tests 350, pass 350,
# fail 0" 같은 실제 npm test 요약 문자열이어야 B2 검증을 통과한다(spec 예시의
# "pre-collected, see npm test run" placeholder 는 실패한다 — 재현 완료).
# 실행 후 server/agent/gate/data/review-packets/ 에 새 파일이 생기므로(B2 정상
# 동작) 검증 후 그 파일만 삭제할 것(운영 카탈로그/후보/상태는 스크래치 디렉터리
# 안에만 존재하므로 정리 불필요).
```

# 위험 요소

1. **완료 기준 2 의 지정 대상 재선정 필요**: spec.md 를 문자 그대로 실행하면
   이 기준은 항상 실패한다(`daegu-university-본교` 가 실제로 Nara CMS 가
   아니므로). 다음 라운드에서 spec.md 를 갱신할 때 완료 기준 2 의 대상을
   `sehan-university-본교`/`hallym-university-본교` 로 공식 교체하거나, 최소
   변경만 하는 게 아니라면 대상 재검증 후 spec 을 고정할 것을 권고.
2. **§B sitemap 경로가 실전에서 잘 안 쓰임**: 인천대(신호 B 는 매칭됐지만
   `boardSource:"nav"`), 공주대(sitemap 200 이지만 실제로는 "Alert" 오류
   페이지라 `subview.do` 0개) 두 실측 사례 모두 최종적으로 nav 폴백 경로로
   귀결됐다. `extractSitemapMenuEntries` 의 정규식(라벨이 앵커 안에 바로
   있어야 매칭)이 실제 대학 sitemap 마크업(중첩 서브메뉴 구조 등)과 안 맞을
   가능성이 높다 — spec "가정/결정 4"가 이미 이 리스크를 명시했고 예외 처리
   (자동 nav 폴백)도 정상 동작하므로 파이프라인이 막히지는 않지만, §B 가
   의도한 "sitemap 우선" 효과가 실전에서 얼마나 발휘될지는 이번 2건의 표본
   만으로는 낮아 보인다. 다음 라운드에서 sitemap 마크업 실측 샘플을 더 모아
   정규식을 보정할 필요가 있어 보인다(코드 결함이 아니라 개선 여지).
3. **완료 기준 2-보조의 `tried=1`**: spec 문구의 "여러 후보 시도" 증거까지는
   못 만든 채 OR 조건의 다른 항목으로만 통과했다. 공주대의 실제 nav 후보가
   1개뿐이라는 게 원인이므로 코드 결함은 아니지만, "여러 후보 재시도" 라는
   원래 요구사항의 핵심 시나리오(N7 의 (b) 케이스)는 실측이 아니라 오프라인
   단위 테스트로만 증명됐다는 점은 남는다(N7 자체는 충분히 견고한 테스트).
4. **한글 universityId 인코딩(NFC/NFD)**: 이번 검증 중 Bash 도구를 경유해
   한글 `--university-id` 값을 JS 문자열 리터럴로 인라인할 때 NFC/NFD 정규화
   차이로 카탈로그 조회가 실패하는 환경 이슈를 겪었다(코드 자체는
   `selectCandidates` 에서 이미 NFC 정규화 비교를 하고 있어 정상). 실제 CLI
   경유 실행(`--university-id=daegu-university-본교` 등, PowerShell/CLI 인자)
   에서는 문제없이 동작함을 확인했으므로 **이 도구의 결함이 아니라 테스트
   스크립트 작성 환경 특이사항**으로 기록한다.
5. **B2 부작용(review-packet 실제 파일 생성)**: 완료 기준 1 실측(스크래치
   카탈로그 사용)이라도 B2(`build-review-packet-from-diagnose.js`, 수정 금지
   파일)는 실제로 `server/agent/gate/data/review-packets/`(스크래치 밖, 저장소
   경로)에 파일을 쓴다는 점은 spec.md 의 "가정/결정 2"에 명시돼 있고
   changes.md 도 인지·정리했다. Tester 도 재현 중 동일 부작용을 확인하고
   정리했다 — 향후 이 커맨드를 재실행하는 사람은 반드시 사후 정리가
   필요하다는 점을 기록해 둔다(리뷰 큐에 더미 review-packet 이 residue 로
   남을 위험).

# 최종 테스트 상태

통과

(완료 기준 1/3/4 는 완전 통과, 완료 기준 2 는 spec 자체의 대상 선정 오류로
좁은 의미에서는 재현 실패지만 취지는 대체 대상으로 명확히 실증, 완료 기준
2-보조는 OR 조건 중 한 항목으로 통과. 코드 구현·테스트 자체에서 발견된
결함은 없음. 위 "위험 요소"는 결함이 아니라 다음 라운드 참고용 리스크임.)
