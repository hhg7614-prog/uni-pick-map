# 변경된 파일

| 경로 | 상태 |
| --- | --- |
| `server/agent/onboarding/tools/discover-nara-cms-batch.js` | 신규 |
| `server/agent/onboarding/tools/discover-nara-cms-batch.test.js` | 신규 |
| `server/agent/onboarding/reports/nara-cms-batch/.gitkeep` | 신규 (빈 파일) |
| `.gitignore` | 수정 (런 산출물 패턴 추가, `reports/` 규칙을 `reports/*` 로 변경) |

`git status` 기준 그 외 변경 없음. `.pipeline/spec.md` 의 modified 표시는
Planner 산출물이며 이번 작업과 무관(커밋하지 않음).

---

# 변경 내용

## `server/agent/onboarding/tools/discover-nara-cms-batch.js` (신규)

Nara Info CMS 배치 발굴 도구. spec §F 의 순수 헬퍼 + §G `processUniversity`
흐름 + §H 리포트 + §I 상태파일 + §J finalDecision enum + "예외 상황" 표를 구현.

CLI: `parseCliArgs` + `if (require.main === module) main()`.
`main()` 은 `runBatch()` 를 호출하며, `--limit`(기본 10), `--university-id=`,
`--resume`, `--dry-run`, `--audit-file=`, `--run-id=`, `--min-accepted=`(기본 2)
를 받는다.

`module.exports` 하는 순수/오케스트레이션 헬퍼 (37개 키):

- 상수: `NEWS_NAV_KEYWORDS`, `DATE_SELECTOR_FALLBACKS`,
  `DEFAULT_AUDIT_FILE`, `DEFAULT_CATALOG_FILE`, `DEFAULT_CANDIDATE_FILE`,
  `DEFAULT_STATE_FILE`, `DEFAULT_REPORT_DIR`
- 선정: `parseCliArgs`, `matchesCandidateFilter`, `isVariantCampus`,
  `findCatalogUniversity`, `universityHasCatalogSource`, `selectCandidates`
- 탐지/추출: `detectNaraCms`, `extractNavBoardLinks`, `classifyBoardCategory`,
  `pickBestBoard`, `extractSiteAndBoardId`, `buildCandidateSource`,
  `deriveShortName`
- 검증: `verifyRssFeed`, `checkRobotsPathDisallow`, `evaluateRobots`,
  `runPreflight`, `resolveDateSelector`
- 산출물: `buildCandidateEntry`, `appendCandidateAtomic`,
  `candidateFileHasReady`, `aggregateSummary`, `buildReport`
- 상태: `loadState`, `mergeState`, `writeStateAtomic`
- 네트워크: `createFetchGate`
- 오케스트레이션: `processUniversity`, `runBatch`, `main`

주입 가능(테스트 완전 오프라인): `fetchImpl`, `now`, `randomBytesImpl`,
`sleepImpl`, `b1Impl`, `b2Impl`, `rssCollectorImpl`, `npmTestImpl`,
`regressionEvidence`, 그리고 `readFileImpl` / `writeFileImpl` / `renameImpl` /
`copyFileImpl` / `existsImpl` / `mkdirImpl` (fs 임플).

재사용(수정 없음, import 만): `rss-collector.js` 의 `rssCollector`;
`run-single-school-trial.js` 의 `extractDetail`, `titleMatches`,
`universityNameMatches`; `robots-group-parser.js` 의 `parseRobotsGroups`;
`screen-selector-required-sources.js` 의 `classifyRobotsFetchResult`;
`prepare-catalog-source-block.js` 의 `prepareCatalogSourceBlock` (B1);
`build-review-packet-from-diagnose.js` 의 `buildReviewPacketFromDiagnose` (B2)
+ `collectRegressionEvidence`.

주요 구현 결정:

- **§B 채택안 (a) 메모리 내 preflight**: `runPreflight` 가 후보 source 객체를
  메모리에서만 만들어 `rssCollector` + `extractDetail`/`titleMatches`/
  `universityNameMatches` 로 읽기 전용 검증. 카탈로그를 전혀 건드리지 않음.
  통과 시에만 candidates append -> B1 -> B2 순서.
- **B1 이전 무쓰기**: preflight 실패 -> `DIAGNOSE_FAILED`, append/B1/B2 안 함.
- **`DIAGNOSE_FAILED_POST_B1` 무롤백** (Q8): preflight 통과 후 B2 서브프로세스
  diagnose 실패 시 candidates + 카탈로그(enabled:false) 항목을 남기고 리포트에만
  기록. 자동 삭제 안 함.
- **`--dry-run`** (Q7): 홈/네비/robots/RSS/상세 조사 + preflight 까지만 수행,
  candidates/B1/B2 **호출 0회**. `regressionEvidence`(npm test)도 수집 안 함.
  리포트 + 상태파일만 기록. finalDecision = `PACKET_CREATED_DRYRUN`.
- **`SOURCE_ALREADY_EXISTS`** (Q3): 라이브 카탈로그 `sources.length>0` 또는
  후보파일에 같은 universityId 의 `COLLECTOR_CONFIG_READY` 존재로 판정.
  audit 의 `cat` 스냅샷은 신뢰하지 않음.
- **shortName** (Q1): host 첫 라벨(`www.inu.ac.kr` -> `inu`), 충돌 시 `-2`.
- **robots path 목록** (Q5): `["/bbs/", "/bbs/{site}/", "/bbs/{site}/{boardId}/",
  "/bbs/{site}/{boardId}/{n}/artclView.do"]` — subview 네비 경로 미포함.
- **변형 캠퍼스** (Q4): id `/-제\d*캠퍼|-분교/` 또는 name `/제\s*\d*\s*캠퍼|분교/`
  이고 본교(`id.replace(/-(제\d*캠퍼[^-]*|분교)$/, "-본교")`)가 카탈로그에
  소스 보유 시 `SKIPPED_VARIANT_CAMPUS`.
- **요청 예산**: `createFetchGate` — origin 당 Crawl-delay 최소 500ms(`sleepImpl`),
  타임아웃 15s(`AbortController`), 대학당 최대 8요청(초과 시
  `REQUEST_BUDGET_EXCEEDED` throw -> `ERROR`).
- **NFD/NFC 정규화**: audit/카탈로그/후보 파일의 한글 id 는 NFD(조합형)로
  저장돼 있음. `selectCandidates` 의 `--university-id` 단건 매칭만
  `.normalize("NFC")` 비교로 보정(셸 인자는 보통 NFC). 이후 파이프는 audit 의
  원본 `row.id`(NFD)를 그대로 사용해 카탈로그/B1/B2 와 일치.
- **원자적 쓰기**: `appendCandidateAtomic` / `writeStateAtomic` 모두
  backup -> tmp 쓰기 -> `JSON.parse` 검증 -> rename. 후보파일 backup 은
  `server/agent/onboarding/backups/` (이미 gitignore) 로 감.
- **리포트 `mutation` 플래그** 항상 전부 false (enabled/verified/status/store/
  preview/git/deploy).

## `server/agent/onboarding/tools/discover-nara-cms-batch.test.js` (신규)

`node:test` + `node:assert/strict`, 완전 오프라인. spec "테스트 계획" 20개 그룹
(+ 보조 1개) = **22 test, 90+ assertion**. 픽스처 HTML 은 파일 상단 상수
(인천대 Nara CMS 구조 축약: nav `/bbs/inu/2594/artclList.do` "인천대소식",
상세 `h2.view-title` + `dl.write dd`, `rssList.do` 3-item RSS(CDATA title)).

- 1 `matchesCandidateFilter` (12행 조합)
- 2 `isVariantCampus` (본교 소스 유무)
- 3 `selectCandidates` (limit / resume / university-id / ERROR 재포함)
- 4 `detectNaraCms` (subview.do / /bbs/ href / 워드프레스)
- 5 `extractNavBoardLinks` + `classifyBoardCategory`
- 6 `pickBestBoard`
- 7 `extractSiteAndBoardId`
- 8 `buildCandidateSource`
- 9 `verifyRssFeed`
- 10 `checkRobotsPathDisallow`
- 11 `evaluateRobots` (policy blocked / path disallow / 404 / 500 unavailable)
- 12 `resolveDateSelector` (`.artclInfo .date` 폴백 / null)
- 13 `runPreflight` (happy / 제목 불일치 / storable 부족)
- 14 `createFetchGate` (crawl-delay 500 / 9번째 예산 초과 / 타임아웃 abort)
- 15 `appendCandidateAtomic` (append / 중복 no-op / 백업)
- 16 `aggregateSummary` (`DIAGNOSE_FAILED_POST_B1` 는 diagnoseFailed 합산)
- 17 `loadState`/`mergeState`/`writeStateAtomic`
- 18 `runBatch` 통합: Nara 대학 -> b1Impl 1회(`sourceId="inu-press-release"`),
  b2Impl 1회(`skipNpmTest:true`, 동일 `regressionEvidence`), `PACKET_CREATED`,
  리포트/상태/후보파일 기록
- 18b `runBatch --dry-run`: b1Impl/b2Impl/append 0회, 리포트+상태만
- 19 `parseCliArgs` (기본 limit=10, `--limit=abc`/`--limit=0` throw)
- 20 `deriveShortName` (host 라벨 + 충돌 접미사)
- 21 `buildReport` 스키마 + `mutation` 플래그 + `universityHasCatalogSource`

## `server/agent/onboarding/reports/nara-cms-batch/.gitkeep`

빈 파일. 리포트 출력 디렉터리 유지용.

## `.gitignore`

- `server/agent/onboarding/reports/` -> `server/agent/onboarding/reports/*`
  로 변경 (git 이 디렉터리 자체를 제외하면 하위 재포함이 불가능하므로).
  기존 동작 유지: `reports/` 하위 다른 서브디렉터리(`source-247/` 등)는 여전히
  전부 무시됨.
- 추가:
  ```
  !server/agent/onboarding/reports/nara-cms-batch/
  server/agent/onboarding/reports/nara-cms-batch/*
  !server/agent/onboarding/reports/nara-cms-batch/.gitkeep
  server/agent/onboarding/data/nara-cms-batch-state.json*
  ```
  결과: `.gitkeep` 만 추적, 런 리포트 `*.json` + 상태파일(+`.bak`)은 무시.

`git check-ignore` 확인:
- `reports/nara-cms-batch/.gitkeep` -> 무시 안 됨 (추적 가능)
- `reports/nara-cms-batch/<runId>.json` -> 무시됨
- `reports/source-247/foo.json` -> 무시됨 (회귀 없음)
- `data/nara-cms-batch-state.json` / `.json.bak` -> 무시됨

---

# 변경 이유

spec.md "목표" + "만들 것 1-9" + Coder 지시(Resolved decisions Q1-Q8) 구현.
활성화·store/preview·git·배포 없이 후보 append + B1(enabled:false 삽입) +
B2(review-packet) 게이트 패킷 생성까지 자동화하기 위함. 인천대 수동 완주
(커밋 1ca360e / 7531f6e) 흐름을 배치화.

`.gitignore` 변경은 AGENTS.md §6("생성 리포트·런 로그·백업은 소스 밖")과
Coder 지시(Q6)에 따라 런 산출물을 추적에서 제외하되 출력 디렉터리 placeholder
(`.gitkeep`)만 유지하기 위함.

NFC 정규화는 audit 큐가 NFD 로 저장돼 있어 셸에서 넘긴 `--university-id`(NFC)가
매칭 실패하는 것을 막기 위한 최소 방어(단건 선택 경로에만 적용).

---

# 미구현 항목

- 없음(spec 범위 전부 구현). spec "범위 밖" 항목(비-Nara CMS 발굴, 캠퍼스명
  매칭 완화, B3 자동 서명, 스케줄 자동화)은 의도적으로 미구현.
- 실측 시연(네트워크 필요)은 Coder 지시대로 Tester 몫으로 남김 — 실행 안 함.
- `npm test` 전체는 Coder 지시대로 실행 안 함(Tester 몫).

---

# 참고사항 (Tester)

## 오프라인 검증 (완료됨)

```
node --check server/agent/onboarding/tools/discover-nara-cms-batch.js        # OK
node --check server/agent/onboarding/tools/discover-nara-cms-batch.test.js   # OK
node --test  server/agent/onboarding/tools/discover-nara-cms-batch.test.js   # 22 pass / 0 fail
```

인접 스위트도 회귀 없음 확인:
`node --test prepare-catalog-source-block.test.js build-review-packet-from-diagnose.test.js`
-> 25 pass (합쳐서 47 pass / 0 fail).

`npm test` 전체(기존 309 + 신규 22)는 미실행 — Tester 가 돌려서 회귀 0 확인 요망.

## 실측 시연 (network permitting)

spec "실측" 표의 후보 (audit §C 필터 통과 + 카탈로그 블록 존재 + 국립대):

| universityId (NFC 표기) | host | robots(audit) |
| --- | --- | --- |
| `kongju-national-university-본교` | www.kongju.ac.kr | ok |
| `kumoh-national-institute-of-technology-본교` | www.kumoh.ac.kr | ok |
| `gangneung-wonju-national-university-본교` | www.gwnu.ac.kr | ok |
| `gyeongguk-national-university-본교` | www.andong.ac.kr | none(404) |

> audit/카탈로그 id 는 NFD 저장. `--university-id` 단건 매칭은 NFC 보정이
> 들어가므로 셸에서 `kongju-national-university-본교` 로 그대로 입력 가능.
> (내부 B1/B2 호출은 audit 원본 NFD id 를 그대로 전달.)

```powershell
# 시연 1: 단건 (PACKET_CREATED 1건 확보까지 1~3곳 시도)
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kongju-national-university-본교
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kumoh-national-institute-of-technology-본교

# 시연 2: limit=10 dry (쓰기 0, 조사만)
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --limit=10 --dry-run

# (dry 확인 후) limit=10 실행 — 통과분만 B1/B2
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --limit=10
```

- 실 실행(비 dry)은 **시작 시 `npm test` 를 1회** 돌려 `regressionEvidence` 를
  수집한다(B2 에 전달, B2 는 재실행 안 함). npm test 가 실패하면 `runBatch` 가
  throw 하고 exit 1, candidates/B1/B2 아무것도 실행 안 함.
- `--dry-run` 은 npm test 도 안 돌린다.

## git diff 로 확인할 것

**보여야 하는 것 (비 dry 실 실행 시):**
- `development/university-news/data/university-news-sources.final.json`:
  B1 통과분(`PACKET_CREATED`)의 `enabled:false` 소스 블록이 해당 대학
  `sources[]` 에 **1개씩 append** (다른 대학/필드 불변, 연속 블록).
- `server/agent/onboarding/data/collector-config-candidates.json`:
  통과분 `COLLECTOR_CONFIG_READY` 항목 append.
- `server/agent/onboarding/data/catalog-prepare-log.json`: B1 감사 로그 append
  (이 파일은 gitignore 라 `git status` 엔 안 뜸).

**보이면 안 되는 것:**
- `server/agent/data/agent-news-store.json` 변경 없음.
- `data/university-news-preview.json` 변경 없음.
- 카탈로그에서 `enabled:true` / `verified:true` / `status` 변경 없음.
- 리포트/상태 파일은 gitignore 라 `git status` 에 안 뜸 (`.gitkeep` 만 추적).
- `--limit=10 --dry-run` 실행 후 `git status` 는 **완전 무변경**이어야 함
  (리포트/상태는 gitignore).

## 리포트/상태 파일 위치

- 리포트: `server/agent/onboarding/reports/nara-cms-batch/{runId}.json`
  — `summary` 카운트 및 `results[]`, `mutation` 플래그(전부 false) 확인.
  콘솔 1줄 요약: `[nara-cms-batch] runId=... processed=N packets=M NOT_NARA=X ROBOTS_BLOCKED=Y DIAGNOSE_FAILED=Z`
- 상태: `server/agent/onboarding/data/nara-cms-batch-state.json`
  — `processed[]` 에 universityId + finalDecision + reviewId. `--resume` 시
  `finalDecision !== "ERROR"` 인 항목은 다음 런에서 제외.

## 오프라인 대체 증거

실측 불가 시 test #18(`runBatch` 통합) 로그 + `PACKET_CREATED` 경로가
증거. "실측 network-blocked" 명시.

## 커밋

커밋/푸시 안 함 (사용자 명시 요청 시에만). 데이터 산출물(실측 시연 결과)
커밋 포함 여부는 사용자 확인 필요(spec 질문사항 2).

---

# F1/F2 수정 라운드 (Tester 결함 대응)

Tester 가 `.pipeline/test-results.md` 에서 보고한 2건을 최소 수정.

## F1 (머지 블로커) — 홈 fetch 가 클라이언트측 리다이렉트를 무시

### 문제
`processUniversity` 의 홈 fetch 는 HTTP 3xx 만 따라갔다. 한국 대학 루트
도메인은 대부분 `<meta http-equiv="refresh">` 또는 `<script>location.href=...`
스텁으로 실제 홈을 넘긴다(모델 인천대 `www.inu.ac.kr` 포함). 그 결과
`detectNaraCms` 가 스텁 HTML 에서 돌아 Phase 1 큐 전체가 `NOT_NARA_CMS` →
패킷 0건.

### 변경

**신규 순수 헬퍼 `extractClientRedirect(html, baseUrl) -> string | null`**
(export, 테스트). 우선순위:
1. `<meta http-equiv="refresh" content="...">` — 속성 순서 무관, 따옴표
   선택, `url=` 있으면 그 값, 없으면 `;` 뒤 전체. 순수 지연(`content="5"`)은
   리다이렉트 아님 → null.
2. `location.replace(...)` / `location.assign(...)` / `location.href=...` /
   `location=...` (`window.`/`self.`/`top.`/`document.` 접두 허용) — 문서
   상단 4000자 이내에서만.
보수적 게이트: 태그 제거 후 본문 ≥600자 + `<a href>` ≥5개면 "실제 콘텐츠"로
보고 meta 도 무시(null). JS 리다이렉트는 본문 <400자 + 링크 ≤3개인 얇은
스텁일 때만 신뢰. 목적지는 `baseUrl` 기준 절대 URL 로 해석.
(내부 보조: `matchMetaRefreshContent`, `parseRefreshTarget`,
`matchJsLocationTarget` — export 안 함.)

**`processUniversity` 홈 fetch 로직 (before → after)**

- before: `homeResponse` 받고 `homeHtml`/`finalHomeUrl`/`host`/`origin` 확정 →
  바로 `detectNaraCms`.
- after: `homeHtml` 획득 후 `extractClientRedirect(homeHtml, finalHomeUrl)`
  호출.
  - null 이면 기존과 동일.
  - URL 이면 **`fetchGate.fetch` 를 딱 1회 더** 호출(요청 예산에 카운트).
    - 실패(비2xx) → `NOT_NARA_CMS` (reason `home_fetch_failed`) + `homeResolvedUrl`.
    - 네트워크 예외 → `ERROR` (reason `home_redirect_fetch_error`) / 예산 초과 →
      `ERROR` (reason `request_budget_exceeded`).
    - 성공 → 그 응답을 홈 HTML/URL 로 채택. **1 hop 만**: 따라간 페이지도
      스텁이면(`extractClientRedirect` 재호출이 non-null) 더 쫓지 않고
      `NOT_NARA_CMS` (reason `redirect_loop_or_double_stub`) + `homeResolvedUrl`.
  - 이후 `host`/`origin` 은 **최종(따라간) URL** 기준으로 계산.

**결과 객체(§G-15) + 리포트**: `homeResolvedUrl` 필드 추가
(`base` 객체에 `homeResolvedUrl: null` 추가, 리다이렉트 추적 시 그 URL,
아니면 null). `report.results[]` 에 그대로 실림.

**finalDecision enum**: 값 추가 없음. `NOT_NARA_CMS` 에 새 reason
`redirect_loop_or_double_stub`, `ERROR` 에 새 reason `home_redirect_fetch_error`.

## F2 (경미) — `detectNaraCms` 호스트 교차검증 느슨

### 문제
`www.daegu.ac.kr` 홈이 도서관 서브도메인 링크
`https://lib.daegu.ac.kr/bbs/content/1_57524` 를 포함해 `/bbs/{seg}/` 패턴에
매칭 → `isNara:true` 오탐.

### 변경 (before → after)

- before: 3개 정규식(`subview.do` / `href=...://.../bbs/{seg}/` / bare
  `/bbs/{seg}/{digits}/`) 을 host 검증 없이 순차 매칭.
- after:
  1. `/{seg}/{digits}/subview.do` — 경로 전용, 그대로(어디에 있든 안전).
  2. `/bbs/{seg}/` **href** — 링크 host 를 파싱해 대학 자체 host 와
     **정확히 일치**(양쪽 `www.` 정규화)할 때만 증거로 인정. 상대 경로
     href 는 같은 host 로 간주. 형제 서브도메인(`lib.` 등)은 탈락.
  3. bare `/bbs/{seg}/{digits}/` 경로 — `options.host` 가 **없을 때만**
     최후의 수단으로 사용(host 검증 불가한 상황 한정).
  - 신규 보조 `sameUniversityHost(linkHost, universityHost)` (export 안 함).

> Tester 지시문은 "equals **또는 subdomain of**" 였으나, 그 경우
> `lib.daegu.ac.kr` 이 `daegu.ac.kr` 의 서브도메인이라 여전히 통과한다.
> Nara `/bbs/` 는 항상 메인 사이트와 **동일 host** 에서 서빙되고, 우리가
> 만드는 rssUrl 도 해결된 홈 host 기준이므로 **정확히 일치**로 좁혔다
> (Tester 가 요구한 `lib.daegu.ac.kr` 탈락 + 테스트도 충족).

## 테스트 (22 → 25)

- **4 확장** `detectNaraCms`: cross-host `/bbs/` → `isNara:false`,
  same-host(절대/상대) → `isNara:true` 케이스 추가.
- **4b 신규** `extractClientRedirect`: meta-refresh(`url=` 유/무, 따옴표
  유/무, 포트 정규화), `location.href`, `location.replace`(타 도메인),
  순수 지연 → null, 실제 콘텐츠 페이지 → null, 두꺼운 본문의 JS → null.
- **18c 신규** 통합: 루트 URL 이 리다이렉트 스텁 → 따라간 URL 에 실제 Nara
  홈 → `PACKET_CREATED` 도달 + `homeResolvedUrl` 기록 + `requestCount <= 8`.
- **18d 신규** 통합: 따라간 페이지도 스텁 → `NOT_NARA_CMS` /
  `redirect_loop_or_double_stub` + `homeResolvedUrl`.

## 검증

```
node --check server/agent/onboarding/tools/discover-nara-cms-batch.js        # OK
node --check server/agent/onboarding/tools/discover-nara-cms-batch.test.js   # OK
node --test  server/agent/onboarding/tools/discover-nara-cms-batch.test.js   # 25 pass / 0 fail
# 인접 스위트 회귀: prepare-catalog + build-review-packet 합쳐 50 pass / 0 fail
```

`npm test` 전체 / 라이브 런은 미실행 — Tester 재검증 몫.

## 요청 예산(≤8) 현황 — Tester 참고

`createFetchGate` maxRequests 는 **8 유지**(Tester 지시 "still ≤8").

대학당 요청 시퀀스:
1. 홈 fetch — 항상 1
2. 클라이언트 리다이렉트 추적 — 조건부 0~1 (**신규**)
3. nav subview fetch — 홈에 `/bbs/{site}/{id}/` 직접 링크가 있으면 0,
   없으면 최대 3
4. robots.txt — 항상 1
5. rssList.do — 항상 1
6. preflight 상세 페이지 — 최대 3

- **일반 경로**(홈에 게시판 직접 링크 有 — Tester 스캔상 대다수):
  1+1+0+1+1+3 = **7 ≤ 8**. 여유 있음.
- **최악**(리다이렉트 추적 + subview 크롤 필요 + 상세 3개):
  1+1+3+1+1+3 = 10. 예산 초과 시 `createFetchGate` 가 상세 루프 중
  `REQUEST_BUDGET_EXCEEDED` throw → runPreflight 의 per-item catch 가
  `detail_fetch_failed` 로 처리. 이미 2건 accepted 면 preflight 통과,
  아니면 `DIAGNOSE_FAILED`. **크래시·부분쓰기 없음**(preflight 는 B1 이전
  단계). 이런 대학은 다음 라운드에서 재시도.
- 즉 리다이렉트 추적 1회 추가로 "리다이렉트 + subview 크롤 동시 필요"
  대학만 상세 검증이 빡빡해진다. spec 의 "대학당 최대 ~8"(틸드) 범위 내로
  판단.
