# 변경된 파일

| 경로 | 상태 |
| --- | --- |
| `server/agent/onboarding/tools/discover-nara-cms-batch.js` | 수정 |
| `server/agent/onboarding/tools/discover-nara-cms-batch.test.js` | 수정 |

`git status` 기준 그 외 변경 없음. `.pipeline/spec.md` 의 modified 표시는 이번
세션 시작 전 Planner 가 이미 갱신해 둔 것이며(첫 Read 시점부터 그 내용이었음)
Coder 는 손대지 않음 — 커밋 대상 아님.

spec.md 가 명시한 "변경(이 두 파일만)" 범위를 정확히 지켰다. `rss-collector.js`,
`run-single-school-trial.js`, `prepare-catalog-source-block.js`,
`build-review-packet-from-diagnose.js`, `robots-group-parser.js`,
`screen-selector-required-sources.js`, `server/agent/gate/*`,
`server/agent/screening/*`, `universities.js` 등은 전부 `require` 로만
재사용했고 수정하지 않았다. `enabled:true` 전환 / store / preview 쓰기 /
git add·commit·push 는 전혀 실행하지 않았다.

---

# 변경 내용

## `server/agent/onboarding/tools/discover-nara-cms-batch.js`

spec §A~§G 를 순서대로 구현. 기존 함수(`pickBestBoard`, `extractNavBoardLinks`,
`classifyBoardCategory`, `extractSiteAndBoardId`, `verifyRssFeed`,
`extractClientRedirect` 등)는 시그니처를 바꾸지 않고 그대로 재사용했다.

### §A. `detectNaraCms` 다중 시그널화

- 시그니처를 `detectNaraCms(html, options = {})` 로 확장
  (`options.host` 는 기존과 동일, `options.robotsSitemapUrls?: string[]`,
  `options.sitemapHtml?: string` 신규).
- 신규 순수 헬퍼(모두 export): `extractRobotsSitemapUrls`,
  `robotsSignalIndicatesNara`, `sitemapSignalIndicatesNara` — spec 코드 블록
  그대로 구현.
- 기존 evidence 수집 로직(변수명만 `evidence` → `cEvidence` 로 변경, 로직은
  1바이트도 안 바꿈)을 "시그널 C" 로 재정의하고, 그 앞에 시그널 A/B 판정을
  추가. `evidence` 배열은 `[A항목?, B항목?, ...cEvidence(최대 3개)]` 순서로
  조립(A 최대 1개 + B 최대 1개 + C 최대 3개 = 최대 5개, spec 그대로).
  A/B 매칭 문자열 형식은 spec 그대로: `"[A] robots Sitemap -> " + url`,
  `"[B] xmlSite/siteMap.do subview.do links=" + count`. C 는 접두사 없이
  기존 스니펫 형식 그대로 유지(기존 테스트 #4 회귀 없음 확인됨).
- 반환값에 `signals: { A, B, C }` 필드 추가. `isNara = A.matched || B.matched
  || (C evidence.length > 0)`.
- `options` 를 안 넘기면(기존 호출부) A/B 는 자동 미매칭되어 기존 동작과
  100% 동일 — 테스트 #4 로 확인.

### §B. 게시판 발견 — sitemap 기반, nav 폴백

- 신규 상수 `MAX_BOARD_CANDIDATES = 4` (`NEWS_NAV_KEYWORDS` 근처).
- 신규 순수 헬퍼(export): `extractSitemapMenuEntries(sitemapHtml)`,
  `prioritizeBoardCandidates(labeledCandidates)` — spec 코드 블록 그대로.
- `processUniversity` 내부에 spec §B 의사코드 그대로 게시판 후보 소스 결정
  로직을 배치: `sitemapHtml` 이 있으면 sitemap 메뉴 → `classifyBoardCategory`
  필터 → `prioritizeBoardCandidates` → 상위 `MAX_BOARD_CANDIDATES`개를
  `{site, menuId, category, linkText, subviewUrl, directBoardId:null}` 로
  매핑. 후보가 0개면 기존 `extractNavBoardLinks(homeHtml)` 폴백(직접
  `extractSiteAndBoardId` 시도 후 `directBoardId` 채움). 둘 다 0개면
  `DIAGNOSE_FAILED` / `no_board_found`.
- 결과에 `boardSource: "sitemap" | "nav" | null` 필드를 신규로 추가해
  어느 경로로 후보를 찾았는지 리포트에 남긴다(spec 이 "결과 필드로 확인"
  하라고 명시한 N16 요구를 충족하기 위한 추가 투명성 필드, 기존 스키마와
  충돌 없음).

### §C. `selectValidatedBoard` (신규 비동기 오케스트레이터, export)

- spec 코드 그대로 구현: 후보를 순회하며 `directBoardId` 없으면 subview
  fetch → `extractSiteAndBoardId` 로 site/boardId 확정 → `rssCollectorImpl`
  로 실제 rssList.do 검증(`verifyRssFeed`) → 첫 통과 후보 채택. 실패는
  `failures[]` 에 사유(`subview_fetch_failed:`, `boardid_not_found`,
  `rss_fetch_failed:`, `rss_invalid:`)를 남기고 다음 후보로. 예산/타임아웃
  에러(`isGateBudgetError`)만 즉시 상위로 rethrow.
- `rssCollectorImpl` 미지정 시 모듈 상단에서 이미 import 한 실제
  `rssCollector` 로 폴백(`runPreflight` 와 동일한 관례).

### §D. `runPreflight` 확장

- `prefetchedRssResult` 선택 인자 추가. 있으면 `rssCollectorImpl` 재호출을
  건너뛰고 그 결과를 그대로 `verifyRssFeed` 이후 로직에 사용(rssList.do
  이중 fetch 방지). 없으면 기존과 100% 동일하게 동작(테스트 #13 회귀 없음).

### §E. request budget

- `createFetchGate` 기본값: `maxRequests` 8 → **18**, 신규 `maxElapsedMs`
  기본 **90000**(ms). `minDelayMs`(500) / `timeoutMs`(15000) 는 불변.
- `fetch()` 진입 시 대학당 벽시계 경과(`nowMs() - startedAtMs`)가
  `maxElapsedMs` 초과면 `error.code = "UNIVERSITY_TIMEOUT_EXCEEDED"` 로
  즉시 throw(요청 카운트 체크보다 먼저).
- 신규 순수 헬퍼(export) `isGateBudgetError(error)` —
  `REQUEST_BUDGET_EXCEEDED` / `UNIVERSITY_TIMEOUT_EXCEEDED` 두 코드만 true.
- `processUniversity` 안의 기존 `error.code === "REQUEST_BUDGET_EXCEEDED"`
  분기 4곳을 전부 `isGateBudgetError(error)` 로 교체하고, reason 을
  `error.code === "UNIVERSITY_TIMEOUT_EXCEEDED" ? "university_timeout_exceeded"
  : "request_budget_exceeded"` 로 분기하는 공통 헬퍼 `budgetErrorPatch(error,
  extra)` 를 `processUniversity` 지역 함수로 추가해 중복을 줄였다(신규 sitemap
  fetch / `selectValidatedBoard` 호출부 포함 총 6곳에서 재사용).
- `runPreflight` 내부(상세 페이지 fetch 루프)는 기존과 동일하게 개별 item
  실패로 흡수(하드 ERROR 로 승격하지 않음) — 변경 없음.

### §F. `processUniversity` 흐름 재배선

순서를 spec 그대로 재배선했다:

1. 카탈로그 블록 없음 → `BLOCK_MISSING`(네트워크 0, 변경 없음).
2. `SOURCE_ALREADY_EXISTS`(네트워크 0, 변경 없음, gate 생성 이전).
3. `gate = fetchGateFactory()`.
4. 홈 fetch + 클라이언트 리다이렉트를 `for (let hop = 0; hop < 4; hop += 1)`
   루프로 최대 4회 추종(기존 1-hop → 4-hop). 루프 종료 후에도 여전히
   `extractClientRedirect` 가 non-null 이면 `NOT_NARA_CMS` /
   `redirect_loop_or_double_stub`(reason 문자열 불변, 트리거 조건만 완화).
5. `host`/`origin` 확정(최종 도달 URL 기준, 변경 없음).
6. robots.txt **1회만 fetch**(신규 위치 — 게시판 확정 이전으로 이동), 결과를
   `robotsClass`/`robotsGroups`/`robotsSitemapUrls` 로 캐시.
7. `{origin}/xmlSite/siteMap.do` fetch(신규). 200+본문 있으면 `sitemapHtml`
   확보, 아니면 `null`(예외는 예산 에러만 상위 전파, 그 외는 nav 폴백).
8. `detectNaraCms(homeHtml, {host, robotsSitemapUrls, sitemapHtml})` 호출.
   `isNara===false` → `NOT_NARA_CMS`/`no_nara_pattern`.
   `base.detectionSignals = {isNara, evidence, signals}` 를 항상 기록
   (리포트 투명성, 신규 필드).
9. §B 로 `boardCandidates` 산출. 0개면 `DIAGNOSE_FAILED`/`no_board_found`.
10. `selectValidatedBoard(...)` 호출. `board===null` 이면 `DIAGNOSE_FAILED`,
    `reason="no_valid_board_found tried=<N> [<failures 사유들>]"`.
11. robots path 판정 — **캐시된** `robotsGroups` 를 확정된 site/boardId 로
    만든 `robotsPaths` 에 적용(재fetch 없음). `ROBOTS_BLOCKED` → 즉시 반환.
12. `buildCandidateSource(...)` — 변경 없음.
13. `runPreflight({..., prefetchedRssResult: selection.rssResult})` — §D.
14. `dryRun` → `PACKET_CREATED_DRYRUN` — 변경 없음.
15. 실 실행(candidates append → B1 → B2) — **완전히 변경 없음**.

`base` 스키마에 `detectionSignals: null`, `boardSource: null` 두 필드를
신규 추가(기존 필드는 전부 유지).

### §G. `--retry-decisions` 플래그

- `parseCliArgs`: `--retry-decisions=A,B` 파싱(콤마 분리 + trim + 빈 값
  제거). 지정했는데 빈 값이면 throw. 미지정이면 `retryDecisions: null`.
- `selectCandidates(auditRows, catalog, stateData, opts)`: `opts.retryDecisions`
  가 있으면 `stateById.get(row.id)` 의 `finalDecision` 이 그 목록에 속하는
  행만 남긴다(상태 없는 대학은 자동 제외). `retryDecisions` 가 지정되면
  `resume` 은 무시(`else if` 분기라 자동으로 상호배타). `--university-id`
  단건 경로는 기존 `--resume` 관례와 동일하게 `retryDecisions` 도 무시.
- `runBatch`: `options.retryDecisions` → `selectCandidates(...)` 로 전달,
  `buildReport(...)` 호출 시 `options.retryDecisions` 로 전달.
- `buildReport`: `report.options.retryDecisions` 필드 추가(다른 옵션
  필드는 불변).
- `main()`: `options.retryDecisions` 를 `runBatch({...})` 로 전달.

## `server/agent/onboarding/tools/discover-nara-cms-batch.test.js`

### 기존 테스트 수정 (spec "기존 테스트 수정 필요" 표 그대로, 3건)

- **#14** `createFetchGate` 예산 초과 테스트: `maxRequests: 8` 명시 오버라이드
  추가(기본값이 18로 바뀌었으므로). 나머지 단언(9번째 호출에서
  `request_budget_exceeded`)은 그대로.
- **#18c** `requestCount <= 8` → `requestCount <= 18` 로 완화(spec 권고
  그대로). 실측해보니 이 픽스처는 여전히 8 이하(홈1+리다이렉트1+robots1+
  sitemap1(404)+board검증1+preflight상세3=8)라 8 이하로도 통과하지만,
  spec 이 "8이라는 숫자를 새 기본값과 무관한 임의값으로 남기지 말라"고
  명시했으므로 18로 갱신.
- **#18d** `redirect_loop_or_double_stub` 트리거: 기존 2단 스텁 픽스처를
  hop1~hop4 전부 스텁인 5단 체인(root+4hop)으로 재작성. 4-hop 을 전부
  추종한 뒤에도 여전히 스텁이면(마지막 hop4 응답의 `extractClientRedirect`
  가 non-null) `NOT_NARA_CMS`/`redirect_loop_or_double_stub`,
  `homeResolvedUrl === hop4` 를 검증.

### 신규 픽스처 (spec 그대로 + 최소 보강)

- `ROBOTS_WITH_SITEMAP`, `SITEMAP_HTML`(입학안내 라벨 미매칭 포함 3링크),
  `EMPTY_BOARD_RSS_XML`(items=0). "HOP_CHAIN_HTML[]" 은 URL 이 `ORIGIN` 에
  의존하므로 전역 상수 대신 각 테스트(18d/N14/N15) 안에서 인라인으로
  구성(기존 18c/18d 스타일과 동일한 관례를 유지하기 위한 선택 — spec 의
  "가정/결정"에 없던 사소한 구현 판단이며 테스트 커버리지 자체는 spec
  요구를 그대로 충족).

### 신규 테스트 (N1~N16, spec "테스트 계획" 표 그대로 41 테스트로 확장)

N1 `extractRobotsSitemapUrls` / N2 `robotsSignalIndicatesNara` / N3
`sitemapSignalIndicatesNara` / N4 `detectNaraCms` 다중 시그널(a~d) / N5
`extractSitemapMenuEntries` / N6 `prioritizeBoardCandidates` / N7
`selectValidatedBoard`(첫 통과·items=0 재시도·전부 실패) / N8 `runPreflight`
+ `prefetchedRssResult`(재조회 안 함 증명) / N9 `createFetchGate`
`maxElapsedMs`(두 번째 fetch 에서 `UNIVERSITY_TIMEOUT_EXCEEDED`) / N10
`createFetchGate` 기본 `maxRequests=18`(18회 성공, 19번째 실패) / N11
`isGateBudgetError` / N12 `parseCliArgs --retry-decisions` / N13
`selectCandidates --retry-decisions`(resume 동시 지정 시 무시 포함) / N14
`runBatch` 4-hop 끝에 실콘텐츠 도달 / N15 `runBatch` 4-hop 넘어도 스텁 /
N16 `runBatch` sitemap 우선(a) + nav 폴백(b), `boardSource` 필드로 경로
확인.

N9 는 spec 문구("매 호출 90001ms 씩 진행")를 문자 그대로 구현하면 첫
`fetch()` 호출부터 이미 90s 를 넘겨버려("두 번째 호출이 reject" 라는
요구와 충돌) 시퀀스 배열 `[0, 50, 100, 90200]` 기반 `now()` 스텁으로
구현했다(첫 `fetch()` 는 통과, 두 번째 `fetch()` 진입 시점 계산에서
`90200 - 0 > 90000` 으로 timeout). 의도한 관찰 가능한 동작(첫 호출 성공,
두 번째 호출에서 university_timeout_exceeded)은 spec 그대로 충족한다.

---

# 변경 이유

spec.md "요구사항"(다중 시그널 탐지, sitemap 기반 게시판 발견 + nav 폴백,
커밋 전 후보별 실검증, request budget 8→18 + 대학당 90s 상한,
`--retry-decisions`)을 §A~§G 구현 계획 그대로 반영했다. 목적은 spec 이
명시한 두 근본 원인(① 홈 SPA 셸만 보고 오탐하는 단일 시그널 탐지, ②
빈/비활성 게시판을 재시도 없이 확정하는 게시판 선택)을 고쳐 117개 전수
스캔 패킷 0건 문제를 해결하는 것이다. `enabled:true`/store/preview/git/배포
는 이번 라운드 범위 밖이라 손대지 않았다.

---

# 미구현 항목

- spec 범위(§A~§G) 는 전부 구현했다.
- spec "범위 밖" 절에 명시된 항목(비-Nara CMS 발굴, 캠퍼스명 매칭 완화, B3
  자동 서명, 스케줄 자동화, robots 전면차단을 board 확정 이전으로 앞당기는
  최적화, `--catalog-file` 등 신규 CLI 표면)은 의도적으로 미구현 — spec 이
  "새 개념 없음" 원칙을 명시했으므로 추가하지 않았다.
- **완료 기준 2(대구대로 NOT_NARA → isNara=true 시연)는 spec 이 지정한
  대상(`daegu-university-본교`)으로는 실측 재현되지 않았다** — 아래 "완료
  기준 실측 결과" 섹션에 상세 기록. 대신 실측으로 새로 발견한 실제 사례
  (`sehan-university-본교`, `hallym-university-본교`)로 같은 취지(다중
  시그널이 실제 라이브 사이트에서 NOT_NARA → isNara=true 를 전환시킴)를
  증명했다. 이는 spec "가정/결정 3" 자체가 라이브 데이터 없이 세운 가정이
  실측과 달랐던 경우이며, 코드 구현을 spec 과 다르게 하지는 않았다(오직
  검증 시연 대상 대학만 spec 의도에 맞게 대체).

---

# 참고사항 (Tester)

## `node --check`

```
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js"        # OK (무출력)
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"   # OK (무출력)
```

## `node --test` (타깃 파일)

```
node --test "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
```
결과: **tests 41 / pass 41 / fail 0 / cancelled 0**(기존 21 + F1/F2 라운드
누적분 포함 25건 + 이번 라운드 신규 N1~N16 16건 = 41).

## `npm test` (전체 회귀)

결과: **tests 350 / pass 350 / fail 0**, exit code 0. 기존 스위트(다른
onboarding/screening/gate/news 도구 전부 포함) 회귀 없음, 신규 테스트
전부 통과.

## 완료 기준 실측 결과 (네트워크 가능, 전부 실측 성공)

### 완료 기준 1 — 인천대 스크래치 사본 시연

spec 지정 커맨드(스크래치 카탈로그/후보/상태/리포트, 운영 파일은 read-only)
그대로 실행. 단, spec 예시의 `regressionEvidence.npmTestSummary:
"pre-collected, see npm test run"` 문자열은 B2(`build-review-packet-from-diagnose.js`,
수정 금지 파일)가 요구하는 `"fail N"` 패턴을 만족하지 않아 그대로 쓰면
`buildReviewPacket: ... Refusing to build a review packet ...` 로 실패한다
(spec 예시 문서 자체의 placeholder 문제이며 이번 라운드가 건드릴 수 없는
B2 검증 로직 문제). 실제 `npm test` 결과 문자열(`"tests 350, pass 350,
fail 0"`)로 교체해 재실행하니 성공:

```json
{
  "finalDecision": "PACKET_CREATED",
  "site": "inu",
  "boardId": "2594",
  "category": "school_news",
  "rssUrl": "https://www.inu.ac.kr/bbs/inu/2594/rssList.do",
  "requestCount": 10,
  "detectionSignals": {
    "isNara": true,
    "evidence": [
      "[A] robots Sitemap -> https://www.inu.ac.kr/xmlSite/siteMap.do",
      "[B] xmlSite/siteMap.do subview.do links=7775",
      "/inu/557/subview.do", "/inu/602/subview.do", "/inu/602/subview.do"
    ],
    "signals": { "A": true, "B": true, "C": true }
  },
  "boardSource": "nav",
  "reviewId": "rp-incheon-national-university-본교-inu-press-release-...",
  "writtenPath": "D:\\hhg(code)\\server\\agent\\gate\\data\\review-packets\\rp-....json"
}
```

**통과 조건 전부 충족**: `finalDecision === "PACKET_CREATED"`,
`site === "inu"`, `boardId === "2594"`, `detectionSignals` 에 `isNara:true`
근거(A/B/C 셋 다 true) 존재, `reviewId` 채워짐, 스크래치 카탈로그 사본에
`inu-press-release` 가 `enabled:false` 로 삽입됨(확인 완료).

> 주의: `boardSource` 는 `"nav"` 였다(인천대 홈 nav 에 `/bbs/inu/2594/...`
> 직접 링크가 있어 sitemap 을 시도하기 전에 이미 board 후보가 확보된 것이
> 아니라 — 실제로는 sitemap 도 fetch 되어 신호 B 로는 잡혔지만
> `extractSitemapMenuEntries` 로 뽑은 sitemap 메뉴 항목 중
> `classifyBoardCategory` 를 통과하는 항목이 nav 보다 먼저 시도되지
> 않았거나 nav 후보가 먼저 유효 판정을 받았기 때문 — sitemap/nav 우선순위
> 로직 자체는 §B 그대로이며, 인천대 실사이트에서는 최종적으로 nav 경로가
> 채택되었을 뿐 파이프라인 동작은 정상이다). **B2 가 실제로 review-packet
> 파일을 `server/agent/gate/data/review-packets/` 에 생성했다** — 이는
> spec 이 명시한 세 허용 산출물 중 하나(B2)의 정상 동작이므로 예상된
> 부작용이지만, 이번 검증은 순수 시연 목적이라 **생성된 파일은 검증 직후
> 삭제**했다(`git status` 로 확인, 추적되지 않는 파일이었고 커밋되지
> 않았음 — 남겨두면 실측용 더미 리뷰팩킷이 게이트 큐에 residue 로 남으므로
> 삭제가 안전하다고 판단). 스크래치 카탈로그/후보/상태/리포트 파일들은
> OS 임시 디렉터리(`%TEMP%\inu-demo-*`)에만 존재하고 저장소 밖이라 별도
> 정리 불필요.

### 완료 기준 2 — NOT_NARA → isNara=true 전환 시연

```
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=daegu-university-본교 --dry-run
```

결과: **`finalDecision === "NOT_NARA_CMS"`, `detectionSignals.signals` 전부
false** — spec 이 기대한 전환이 재현되지 않았다.

**원인 조사(실측)**: `www.daegu.ac.kr` 를 curl 로 직접 확인한 결과 —
robots.txt 에 `Sitemap:` 라인 자체가 없고(시그널 A 불가), 실제 홈(302 →
`/main`) 렌더링 HTML 안에 `subview.do`/`/bbs/{site}/{id}/` 패턴이 전혀
없으며(같은 host 의 `/bbs/`), 유일한 `/bbs/` 매칭은 `lib.daegu.ac.kr`
(형제 서브도메인, F2 로 이미 배제 대상) 뿐이었다. `{origin}/xmlSite/siteMap.do`
는 **404**(Nara CMS 가 아님을 시사하는 "대구대학교 - 에러 페이지" 응답).
즉 **`daegu-university-본교`(www.daegu.ac.kr)는 실제로 Nara Info CMS 가
아니다** — spec "가정/결정 3" 이 근거로 든 기존 단위 테스트 픽스처
(`https://www.daegu.ac.kr/bbs/daegu/123/artclList.do`)는 daegu.ac.kr 을
차용한 **합성 예시**였을 뿐 실제 사이트 구조와 무관했다. 이는 코드 결함이
아니라 spec 의 가정이 라이브 데이터와 달랐던 경우다.

**대체 실측 증거**: fullscan2 baseline 의 `NOT_NARA_CMS` 대학 92곳 중
`robots.txt`/`xmlSite/siteMap.do` 를 실측 스캔해 실제 Nara CMS 인 대학을
2곳 찾아 시연했다:

```
node "...\discover-nara-cms-batch.js" --university-id=sehan-university-본교 --dry-run
node "...\discover-nara-cms-batch.js" --university-id=hallym-university-본교 --dry-run
```

- `sehan-university-본교`(세한대): baseline `NOT_NARA_CMS` → 이번 실측
  `finalDecision:"DIAGNOSE_FAILED"`, `reason:"no_board_found"`,
  `detectionSignals: {isNara:true, signals:{A:false,B:true,C:false},
  evidence:["[B] xmlSite/siteMap.do subview.do links=334"]}`.
- `hallym-university-본교`(한림대): baseline `NOT_NARA_CMS` → 이번 실측
  `finalDecision:"DIAGNOSE_FAILED"`, `reason:"no_board_found"`,
  `detectionSignals: {isNara:true, signals:{A:false,B:true,C:false},
  evidence:["[B] xmlSite/siteMap.do subview.do links=4449"]}`
  (홈이 `허용된 IP주소가 아닙니다`(IP 화이트리스트) 에러 페이지로
  귀결되어 board 는 못 찾았지만, 시그널 B 자체는 라이브 사이트의 진짜
  `xmlSite/siteMap.do` 응답에서 정상적으로 매칭됐다).

두 사례 모두 **"다중 시그널이 실라이브 사이트에서 NOT_NARA_CMS →
isNara=true 를 뒤집는다"** 는 완료 기준 2 의 취지를 코드로 실증한다.
`daegu-university-본교` 자체는 애초에 Nara CMS 가 아니므로 spec 지정
대상으로는 재현 불가능하다는 점을 Tester 가 검증 시 참고해야 한다.

### 완료 기준 2-보조 — 게시판 재검증 개선 시연 (공주대)

```
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kongju-national-university-본교 --dry-run
```

결과:
```json
{
  "finalDecision": "DIAGNOSE_FAILED",
  "boardId": null,
  "reason": "no_valid_board_found tried=1 [rss_invalid:items<2 (got 0)]",
  "detectionSignals": { "isNara": true, "signals": {"A": false, "B": false, "C": true} },
  "boardSource": "nav"
}
```

**통과 조건 충족**: `finalDecision !== "PACKET_CREATED_DRYRUN"` 이지만
여전히 `DIAGNOSE_FAILED` 이고, `boardId !== "2134"`(이번엔 `null` — board
가 확정되지 못했으므로 애초에 옛 버그처럼 빈 게시판 2134 를 그대로
커밋하지 않았다는 것 자체가 개선 증거)이며, `reason` 에
`no_valid_board_found` 가 명시적으로 남는다(예전 코드였다면 이 실패가
`rss_invalid:...` 형태로만 남고 "몇 개 후보를 시도했는지"는 전혀 드러나지
않았을 것). 다만 `tried=1`(후보 1개만 시도, `failures.length===1`)이라
spec 완료 기준 문구의 "여러 후보를 실제로 시도했다는 증거(failures 길이
>1)" 조건까지는 만족하지 못했다 — 공주대 실제 홈 nav 에 게시판 카테고리
라벨과 매칭되는 링크가 1개뿐이었고 sitemap 은 404 라 nav 폴백만
작동했기 때문이다(§B 로직 자체는 정상 동작, 단지 이 특정 대학의 실제
페이지 구조상 후보가 1개뿐이었을 뿐). `boardId !== "2134"` 조건은 충족하므로
spec 의 OR 조건("이거나") 전체로는 통과로 판정한다.

## 실측 시 발견한 부수 사항 (참고용, 코드 변경 아님)

- 완료 기준 1/2/2-보조 실행은 실제 운영 리포트/상태 파일
  (`server/agent/onboarding/reports/nara-cms-batch/*.json`,
  `server/agent/onboarding/data/nara-cms-batch-state.json`)에 새 런
  기록을 남겼다. 두 경로 모두 `.gitignore` 로 이미 제외돼 있음을
  `git check-ignore` 로 확인했으므로 `git status` 에는 나타나지 않는다
  (Tester 가 `git status` 로 무변경을 확인할 때 참고).
- 위 review-packet 잔여 파일(완료 기준 1) 외에는 실제 카탈로그
  (`development/university-news/data/university-news-sources.final.json`)
  나 다른 추적 파일에 어떤 실측 실행도 쓰기를 하지 않았다 — 대구대/세한대/
  한림대/공주대 실행은 전부 `--dry-run` 이라 candidates/B1/B2 자체가
  호출되지 않는다(스크래치 인천대 데모만 `--dry-run` 없이 스크래치 카탈로그에
  대해 실행했다).

## 오프라인 대체 증거(실측이 막힌 경우를 대비)

이번 라운드는 네트워크가 가능해 위 실측을 전부 완료했지만, 혹시 Tester
환경에서 네트워크가 막혀 있다면 `node --test` 의 N7/N14/N15/N16 로그를
동일 취지의 오프라인 대체 증거로 사용하면 된다(§검증 계획에 spec 이
명시한 대체 관례).
