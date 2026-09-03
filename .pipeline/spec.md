# 목표

Phase 1 발굴 대상 큐(`.pipeline/onboarding-phase1-audit-detail.json`, 247행)에서
Nara Info CMS 를 쓰는 대학을 자동으로 골라, 뉴스/공지 게시판의 RSS 소스를
발견·검증하고, **활성화 없이** 게이트 패킷(B1 카탈로그 enabled:false 삽입 +
B2 review-packet)까지 생성하는 배치 도구를 만든다.

산출물:
- `server/agent/onboarding/tools/discover-nara-cms-batch.js`
- `server/agent/onboarding/tools/discover-nara-cms-batch.test.js`

인천대(커밋 7531f6e)로 수동 완주한 흐름을 배치화한 것이며, 인천대에서 확정된
Nara Info CMS 레시피와 이미 반영된 `rss-collector.js` 의 `.do` 링크 정규화
(커밋 482f3f1)를 그대로 재사용한다.

---

## AGENTS.md §1 도메인 순서

`UNI PICK work -> Source activation and source-quality tools`
(읽기 전용 소스 발굴 + 게이트 패킷 생성)
` -> Development work (Tests)` (단위 테스트 + 회귀).

이 작업은 §1 스코프의 "Source activation and source-quality tools" 안에 있다.
활성화(enabled:true), store/preview 쓰기, git, 배포는 하지 않는다. 산출물은
후보 파일 append + B1 을 통한 카탈로그 enabled:false 삽입 + B2 review-packet 뿐이다.

---

# 요구사항

사용자 요청 원문의 "만들 것 1-9", "제약", "완료 기준", "범위 밖"을 그대로 옮긴다.

## 만들 것

1. **후보 선정** — phase1 감사 detail JSON 에서 대상 필터. `--limit=N`(기본 10),
   `--university-id=` 단건, `--resume`(상태파일 기반 이어하기). 이미 카탈로그에
   소스 있는 대학, `제N캠퍼`/`분교` 변형(본교가 이미 소스 보유 시) 제외.
2. **Nara 탐지** — 홈페이지 fetch -> `/subview.do` 또는 `/bbs/{site}/` 패턴 존재
   확인. 없으면 `finalDecision="NOT_NARA_CMS"` 기록하고 skip.
3. **게시판 ID 발견** — 홈 네비에서 "소식/뉴스/보도/공지/알림" 키워드 링크 수집
   -> 각 `subview.do` fetch -> `/bbs/{site}/{boardId}/` 추출. `school_news`
   (보도자료/뉴스) 우선, 없으면 `school_notice`(공지사항). site 세그먼트도 추출.
4. **RSS 검증** — `/bbs/{site}/{boardId}/rssList.do` 를 rss-collector 로 수집 ->
   `items>=2 && 각 item title/link/pubDate 존재`.
5. **robots path 체크** — origin `robots.txt` 파싱(server/agent/screening 모듈 재사용)
   -> `User-agent: *` 그룹이 `/bbs/` 또는 게시판 경로/artclView 경로를 Disallow 하는지.
   `AI_BLOCKED`(evaluateRobotsPolicy) 이거나 path Disallow 면
   `finalDecision="ROBOTS_BLOCKED"`.
6. **전체 파이프 검증** — 후보 source 블록(위 레시피)을 임시로 만들어
   `run-single-school-trial.js --diagnose --allow-unverified-diagnose` 에 상당하는
   검증을 수행 -> `acceptedCount>=2 && 모든 storable item publishedAt 존재`. 실패 시
   `finalDecision="DIAGNOSE_FAILED"` + reason 기록. 날짜가 안 잡히면 대체 셀렉터
   (`dl.date dd`, `ul.board-etc li`, `.artclInfo .date`) 순차 시도 후에도 실패면 기록.
   (순서 문제 해결안은 "구현 계획 §B" 참고 — 임시 블록은 메모리 내에서만 만들고
   카탈로그를 건드리지 않는다.)
7. **통과분 처리** — `collector-config-candidates.json` 에 `COLLECTOR_CONFIG_READY`
   항목 append(source id = `{shortname}-press-release` 또는 `-notice`) ->
   `prepare-catalog-source-block.js`(B1) 로 카탈로그에 enabled:false 삽입 ->
   `build-review-packet-from-diagnose.js`(B2) 로 review-packet 생성.
8. **리포트** — `server/agent/onboarding/reports/nara-cms-batch/{runId}.json`.
   대학별 finalDecision, 발견 rssUrl/boardId, diagnose 요약, 생성한 reviewId.
   요약: 처리 N / 패킷생성 M / NOT_NARA X / ROBOTS_BLOCKED Y / DIAGNOSE_FAILED Z.
9. **상태파일** — `server/agent/onboarding/data/nara-cms-batch-state.json`
   (처리한 universityId + 결과). `--resume` 시 미처리분만.

## 제약(AGENTS.md 준수)

- `enabled:true` 전환·store/preview 쓰기·git·배포 절대 안 함. 산출물은 candidates
  append + 카탈로그 enabled:false 삽입(B1) + review-packet(B2) 뿐.
- 카탈로그 쓰기는 B1(`prepare-catalog-source-block.js`)만 경유. 직접 쓰지 않음.
- 대학 블록이 카탈로그에 없으면 그 대학 skip(`BLOCK_MISSING`) — B1 이 블록 생성
  안 하는 확정 결정 유지.
- 네트워크: origin 당 Crawl-delay 존중(최소 500ms), 요청 타임아웃 15s, 대학당
  최대 ~8 요청.
- `rss-collector.js` / 게이트 모듈 / `run-single-school-trial.js` 는 수정하지
  않는다(재사용만). 필요한 확장은 spec 에 별도 항목으로 명시하고 최소화.
  -> **본 라운드 확장 필요 없음** ("구현 계획 §E" 참고).
- 시간/난수는 테스트에서 주입 고정.

## 완료 기준(사용자 원문)

- `discover-nara-cms-batch.js --university-id=<인천대 아닌 새 Nara 대학 1곳>` 실행 시
  rssUrl 발견 -> diagnose 통과 -> review-packet 생성까지 실측 시연(1건). 실패
  대학도 1건 이상 finalDecision 분류 확인.
- `--limit=10` dry 시연: 상태파일/리포트 생성, 카탈로그 변경은 B1 통과분만 최소 diff.
- 단위 테스트: 후보 필터, Nara 탐지, boardId 추출, robots path 판정, 리포트 집계
  — 픽스처 기반.
- 전체 `npm test` 통과, 회귀 0. git push/배포 미실행. 현재 main 위에 커밋
  (코드/기록 분리).

## 범위 밖(다음 라운드)

비-Nara CMS 대학 발굴, 캠퍼스명 매칭 완화, B3 자동 서명, 스케줄 자동화.

---

# 파일

## 신규

| 경로 | 목적 |
| --- | --- |
| `server/agent/onboarding/tools/discover-nara-cms-batch.js` | 배치 발굴 도구 본체 (CLI + 순수 헬퍼 export) |
| `server/agent/onboarding/tools/discover-nara-cms-batch.test.js` | `node:test` 단위 테스트, 픽스처/주입 기반, 네트워크 없음 |
| `server/agent/onboarding/reports/nara-cms-batch/.gitkeep` | 리포트 출력 디렉터리 (런 산출물 자체는 gitignore — 질문사항 6) |

## 런타임에 append/수정 (직접 쓰기)

| 경로 | 쓰기 방식 | 비고 |
| --- | --- | --- |
| `server/agent/onboarding/data/collector-config-candidates.json` | `items[]` append (원자적: backup -> tmp -> JSON.parse 검증 -> rename) | 통과분만. 카탈로그 아님. |
| `server/agent/onboarding/data/nara-cms-batch-state.json` | 원자적 덮어쓰기 | 처리 결과 누적 |
| `server/agent/onboarding/reports/nara-cms-batch/{runId}.json` | 새 파일 쓰기 | 런 리포트 |

## 런타임에 B1/B2 를 통해서만 변경 (직접 쓰기 금지)

| 경로 | 경유 | 비고 |
| --- | --- | --- |
| `development/university-news/data/university-news-sources.final.json` | B1 `prepareCatalogSourceBlock()` | enabled:false 삽입, append-only, 원자적 |
| `server/agent/onboarding/data/catalog-prepare-log.json` | B1 내부 | 감사 로그 |
| `server/agent/gate/review-packets/<reviewId>.json` | B2 `createAndWriteReviewPacket()` | review-packet |

## 읽기 전용 입력

- `.pipeline/onboarding-phase1-audit-detail.json` (후보 큐, `--audit-file=` 로 주입 가능)
- `development/university-news/data/university-news-sources.final.json` (블록 존재 / 기존 소스 확인)
- `server/agent/onboarding/data/collector-config-candidates.json` (중복 append 방지)

## 절대 건드리지 않음

`rss-collector.js`, `run-single-school-trial.js`, `prepare-catalog-source-block.js`,
`build-review-packet-from-diagnose.js`, `server/agent/gate/*`,
`server/agent/screening/*`, `server/agent/data/agent-news-store.json`,
`data/university-news-preview.json`, 모든 배포/스케줄러 파일.

---

# 구현 계획

## §A. 재사용 모듈 인벤토리 (import — 수정 금지)

| import | 위치 | 용도 |
| --- | --- | --- |
| `rssCollector` | `development/university-news/collectors/rss-collector` | 4단계 RSS 수집 + 6단계 preflight 의 리스트 아이템. `fetchImpl` 주입 가능. |
| `extractDetail`, `titleMatches`, `universityNameMatches`, `normalizeText` | `server/agent/tools/run-single-school-trial` (module.exports) | 6단계 preflight 의 상세 페이지 검증(트라이얼 스크립트와 동일 로직). |
| `parseRobotsGroups` | `server/agent/screening/robots-group-parser` | robots.txt 그룹 파싱. `disallows` 배열이 노출되어 path-prefix 판정 가능. |
| `evaluateRobotsPolicy` | `server/agent/screening/ai-bot-policy` | AI 봇 전체차단(`Disallow: /`) 판정 -> ROBOTS_BLOCKED. |
| `classifyRobotsFetchResult` | `server/agent/tools/screen-selector-required-sources` | robots.txt fetch 결과(404/에러/본문없음)를 checked/unavailable/policy 로 분류. |
| `prepareCatalogSourceBlock`, `READY_DECISION` | `server/agent/onboarding/tools/prepare-catalog-source-block` | B1. **함수로 호출**(CLI 아님) — dryRun/now/fs 주입. |
| `buildReviewPacketFromDiagnose` | `server/agent/onboarding/tools/build-review-packet-from-diagnose` | B2. **함수로 호출** — `skipNpmTest:true` + 공용 `regressionEvidence` + `now`/`randomBytesImpl` 주입. 내부에서 `run-single-school-trial.js --diagnose` 서브프로세스를 실제 게이트로 실행. |

주의: B2 는 catalog 에 소스가 이미 있어야 동작하므로(`findSourceInCatalog`),
순서는 반드시 **append -> B1 -> B2**. B2 의 `runnerImpl` 은 실측 시연에서는
기본값(실제 서브프로세스)을 쓰고, 테스트에서는 주입한다.

## §B. 6단계 순서 문제 해결 — 채택안 (a): 메모리 내 preflight

**문제**: `run-single-school-trial.js` 는 하드코딩된 카탈로그 경로만 읽고
`--catalog-file` 주입점이 없다. 따라서 사용자 원문의 "임시 source 블록으로
diagnose 실행"을 B1 이전에 그 스크립트로 문자 그대로 수행할 수 없다.

**채택**: **(a) 메모리 내 preflight**. B1/append 이전에, 도구가 메모리에서
후보 source 객체를 만들고 다음을 읽기 전용으로 수행한다:

```
rssCollector({ university, source, limit: 3, fetchImpl })   // 리스트(=RSS) 아이템
  -> for each item:
       fetch(item.sourceUrl)                                 // 상세 페이지 (politeness gate 경유)
       extractDetail(html, source, item.publishedAt)         // 트라이얼과 동일
       universityNameMatches(source, university, html)
       titleMatches(source, item.title, detail.title)
       publishedAt 존재 여부
  -> acceptedCount / storableItems 집계
```

- **카탈로그를 전혀 건드리지 않는다.** "재사용만" 제약에 부합.
- preflight 실패 -> `finalDecision="DIAGNOSE_FAILED"` + reason, **append/B1/B2 안 함.**
- preflight 통과 -> candidates append -> B1(enabled:false 삽입) -> B2.
  B2 는 자체적으로 실제 `--diagnose` 서브프로세스를 돌려 두 번째(최종) 게이트를
  수행한다. preflight 가 B2 서브프로세스와 **동일한 수집기·동일한 헬퍼**를
  쓰므로 통과 예측력이 높다.
- (드묾) preflight 통과 후 B2 가 `DIAGNOSE_FAILED` 반환 시:
  `finalDecision="DIAGNOSE_FAILED_POST_B1"` 로 기록. 카탈로그에 남은 항목은
  **enabled:false**(비활성, 안전)이고 B1 은 append-only 이므로 **자동 롤백하지
  않는다**(카탈로그에서 항목 삭제도 그 자체로 조심스러운 변형이라 회피).
  리뷰어가 다음 라운드에서 셀렉터 보정 또는 수동 제거를 판단하도록 리포트에 표시.

**(b) B1 먼저 + 실패 시 백업 복원**은 채택하지 않음: 카탈로그를 먼저 변형하고
롤백 로직이 필요해 부수효과가 크다.

**`--limit=3` 하드캡 수용**: `run-single-school-trial.js` 의 `parseOptions` 는
`--limit` 을 `1..3` 으로 강제한다. B2 의 `minAccepted` 기본 2 이므로 "3개 중 2개
이상 accepted" 로 완료 기준(`acceptedCount>=2`)을 충족한다. preflight 도 `limit:3`
으로 맞춘다.

## §C. 후보 필터 술어 (audit JSON 대상)

`matchesCandidateFilter(row)` — 아래 3조건 AND:

1. **homeStatus**: `/^2\d\d$/.test(String(row.homeStatus).trim())` — `"200"`,`"201"`,
   `"204"` 등 2xx 문자열만 통과. `"302"`,`"404"`,`"ERR:ECONNRESET"`,`"000"` 탈락.
   (사용자 원문 "200대" = 2xx.)
2. **robots**: `["ok", "none(404)"].includes(String(row.robots).trim())`.
   `"AI_BLOCKED"`,`"not-robots(html)"`, 기타 전부 탈락.
3. **cat**: `["NO_SOURCE", "SOURCE_UNVERIFIED"].includes(String(row.cat).trim())`.
   `"ACTIVE"`,`"SOURCE_DISABLED"`,`"DEACTIVATED"` 탈락.

audit 의 `row.id` == 카탈로그 `universityId` == 후보파일 `universityId`
(예: `incheon-national-university-본교`) — 실측 확인됨.

## §D. 선정 파이프 (`selectCandidates`)

입력: `auditRows`, `catalog`, `stateData`, `{ limit=10, universityId, resume }`.

1. `universityId` 지정 시: 그 행만 대상(필터 통과 여부와 무관하게 처리하되,
   필터 탈락이면 `finalDecision="FILTERED_OUT"` 기록 후 종료 — 단건 디버깅 편의).
2. 아니면 `auditRows.filter(matchesCandidateFilter)`.
3. `resume` 시: `stateData.processed` 에 종결 결정이 있는 universityId 제외
   (`ERROR` 는 미종결로 보고 재시도).
4. **변형 캠퍼스 제외**: `isVariantCampus(row, catalog)` — `row.id` 가
   `/-제\d*캠퍼|-분교/` 또는 `row.name` 이 `/제\s*\d*\s*캠퍼|분교/` 이고,
   그 본교(`row.id.replace(/-제\d*캠퍼.*$/, "-본교")` 등으로 유도)가 카탈로그에서
   `sources.length > 0` 이면 제외 -> `finalDecision="SKIPPED_VARIANT_CAMPUS"`.
5. `limit` 로 slice (선정 순서 = audit 파일 등장 순서).
6. 각 대학은 처리 시점에 추가로:
   - 카탈로그에 대학 블록 없음 -> `BLOCK_MISSING`
   - 카탈로그 대학 블록의 `sources` 에 이미 소스 존재, 또는 후보파일에 이미
     같은 universityId 의 `COLLECTOR_CONFIG_READY` 존재 -> `SOURCE_ALREADY_EXISTS`
     (audit 의 `cat` 은 스냅샷이라 신뢰 안 함 — 라이브 카탈로그로 교차확인. 예:
     인천대는 audit 상 `NO_SOURCE` 지만 카탈로그엔 enabled 소스 존재 ->
     `SOURCE_ALREADY_EXISTS`.)

## §E. 재사용 모듈 확장 필요 여부

**없음.** 근거:
- `parseRobotsGroups` 가 그룹별 `disallows: string[]` 를 노출 -> path-prefix
  Disallow 판정을 도구 자체 순수 함수로 처리 가능(§F-5).
- `rssCollector` 는 `fetchImpl` 주입 지원.
- `run-single-school-trial.js` 의 필요한 헬퍼가 전부 `module.exports` 됨.
- B1/B2 모두 필요한 주입점(`now`,`randomBytesImpl`,`fetchImpl`,`runnerImpl`,
  `dryRun`,`skipNpmTest`,`regressionEvidence`,fs impls) 을 이미 제공.

## §F. 신규 순수 헬퍼 인벤토리 (전부 `module.exports`, 테스트 대상)

1. `parseCliArgs(argv) -> { limit, universityId, resume, dryRun, auditFile, runId, minAccepted }`
   — CLI 파싱. `--limit=` 기본 10(정수·1 이상), `--university-id=`, `--resume`,
   `--dry-run`, `--audit-file=`, `--run-id=`(테스트 주입), `--min-accepted=` 기본 2.
2. `matchesCandidateFilter(row) -> boolean` — §C 술어.
3. `isVariantCampus(row, catalog) -> boolean` — §D-4. 본교가 소스 보유 시 true.
4. `findCatalogUniversity(catalog, universityId) -> universityBlock | null` — 대학 블록 조회.
5. `universityHasCatalogSource(catalog, universityId) -> boolean` — `sources.length > 0`.
6. `selectCandidates(auditRows, catalog, stateData, opts) -> { selected[], preSkipped[] }`
   — §D 전체.
7. `detectNaraCms(html, { host, site }) -> { isNara: boolean, evidence: string[] }`
   — `html` 에 `/{seg}/{digits}/subview.do` 또는 `href="...://{host}/bbs/{seg}/"`
   패턴이 하나라도 있으면 true. evidence 에 매칭 스니펫 최대 3개.
8. `NEWS_NAV_KEYWORDS` (상수) — `["소식","뉴스","보도","보도자료","알림","공지","공지사항","새소식","대학소식","언론"]`.
9. `extractNavBoardLinks(html, { keywords }) -> [{ href, text }]`
   — `<a href>` 중 링크 텍스트가 키워드 포함하고 `href` 가 `subview.do` 또는
   `/bbs/` 를 포함하는 것. 중복 href 제거, 최대 6개.
10. `classifyBoardCategory(linkText) -> "school_news" | "school_notice" | null`
    — `보도|뉴스|소식|언론` -> `school_news`; `공지|알림` -> `school_notice`; 그 외 null.
11. `pickBestBoard(candidates) -> { site, boardId, category, categoryLabel, sourceUrl } | null`
    — `candidates` = `{ site, boardId, category, linkText, subviewUrl }[]`.
    `school_news` 우선, 없으면 `school_notice`. 동점이면 먼저 등장한 것.
12. `extractSiteAndBoardId(text, { host }) -> { site, boardId } | null`
    — 정규식 `/\/bbs\/([A-Za-z0-9_-]+)\/(\d+)\//` 첫 매칭. `text` 는 subview.do
    페이지 HTML 또는 rssList URL 문자열. `host` 는 교차검증(선택).
13. `buildCandidateSource({ host, site, boardId, category, categoryLabel, shortName, subviewUrl }) -> sourceBlock`
    — 확정 Nara 레시피 생성:
    ```json
    {
      "id": "{shortName}-press-release" | "{shortName}-notice",
      "name": "{universityName} 보도자료" | "... 공지사항",
      "category": "school_news" | "school_notice",
      "categoryLabel": "학교 소식" | "학교 공지",
      "sourceType": "official",
      "collectionType": "rss",
      "rssUrl": "https://{host}/bbs/{site}/{boardId}/rssList.do",
      "listUrl": "{subviewUrl}",
      "baseUrl": "https://{host}",
      "detailSelectors": { "title": "h2.view-title", "date": "dl.write dd" },
      "datePolicy": { "prefer": "list" },
      "verified": false,
      "enabled": false,
      "status": "collector_config_candidate",
      "healthStatus": "unknown"
    }
    ```
14. `deriveShortName(universityId, host, existingIds) -> string`
    — 우선 `host` 의 첫 라벨(`www.` 제거, `www.inu.ac.kr` -> `inu`). 소문자,
    `[a-z0-9-]` 만. 충돌 시 `-2` 등 접미사.
15. `DATE_SELECTOR_FALLBACKS` (상수) — `["dl.write dd", "dl.date dd", "ul.board-etc li", ".artclInfo .date"]`.
16. `verifyRssFeed(rssResult) -> { ok, itemCount, reasons[] }`
    — `rssResult.items.length >= 2` 그리고 각 item 에 `title`,`sourceUrl`(link),
    `publishedAt`(pubDate) 이 truthy. 아니면 `ok:false` + 이유.
17. `checkRobotsPathDisallow(groups, paths) -> { disallowed, matchedRule, group }`
    — `groups` 중 `uas` 에 `"*"` 포함 그룹의 `disallows` 각 항목 `d` 에 대해
    `d` 가 비어있지 않고 `paths` 중 하나가 `startsWith(d)` (트레일링 `*` 는 제거)
    이면 `disallowed:true`.
18. `evaluateRobots(robotsEvidence, { paths }) -> { verdict: "OK" | "ROBOTS_BLOCKED", reason }`
    — `classifyRobotsFetchResult` 결과 기준:
    - `checked===true` 이고 `policy.blocked===true` -> `ROBOTS_BLOCKED` (AI 봇 전체차단)
    - `checked===true` 이고 `checkRobotsPathDisallow(groups, paths).disallowed` -> `ROBOTS_BLOCKED`
    - `unavailable===true` -> `ROBOTS_BLOCKED` (reason=`ROBOTS_UNAVAILABLE` — B2 게이트도
      unavailable 을 통과 못 시키므로 사전 차단)
    - 그 외 -> `OK`
    `paths` = `["/bbs/", "/bbs/{site}/", "/bbs/{site}/{boardId}/", "/bbs/{site}/{boardId}/{n}/artclView.do"]`.
19. `runPreflight({ university, source, limit, fetchGate, rssCollectorImpl }) -> { ok, acceptedCount, storableItems[], triedDateSelectors[], usedDateSelector, reason }`
    — §B 로직 + §F-20 날짜 폴백 루프. `rssCollectorImpl` 기본 `rssCollector`.
20. `resolveDateSelector(detailHtmlList, listPublishedAtList, baseSource) -> { selector, publishedAtByIndex[] } | null`
    — `DATE_SELECTOR_FALLBACKS` 를 순서대로 `source.detailSelectors.date` 에 넣어
    `extractDetail` 재실행(추가 네트워크 없음). `>=2` 개 item 의 `publishedAt` 이
    잡히는 첫 셀렉터를 채택. 전부 실패면 null.
21. `buildCandidateEntry({ university, source, boardId, discoveredAt, note }) -> candidatesItem`
    — 후보파일 `items[]` 에 넣을 객체(`finalDecision: "COLLECTOR_CONFIG_READY"`,
    `universityId`,`universityName`,`universityGroupId`,`discoveredAt`,
    `discoveryNote`,`source`).
22. `appendCandidateAtomic(candidateFile, entry, fsImpls) -> void`
    — 읽기 -> `items.push` -> backup -> tmp 쓰기 -> `JSON.parse` 검증 -> rename.
    같은 `universityId+source.id` 이미 있으면 no-op(중복 방지).
23. `aggregateSummary(results) -> { processed, packetsCreated, notNaraCms, robotsBlocked, diagnoseFailed, blockMissing, sourceAlreadyExists, variantCampus, error }`
    — finalDecision 별 카운트.
24. `buildReport({ runId, startedAt, finishedAt, options, results, summary }) -> reportObject`
    — §H 스키마.
25. `loadState(stateFile, readImpl, existsImpl) -> { version:1, updatedAt:null, processed:[] }` (없으면 기본).
26. `mergeState(prev, newResults, now) -> nextState` — universityId 기준 upsert(최신 유지).
27. `writeStateAtomic(stateFile, state, fsImpls) -> void` — backup -> tmp -> parse -> rename.
28. `createFetchGate({ minDelayMs=500, maxRequests=8, timeoutMs=15000, fetchImpl, now, sleepImpl }) -> { fetch(url, init), count }`
    — 호출마다: `count >= maxRequests` 이면 `throw RequestBudgetExceeded`;
    직전 호출로부터 경과가 `minDelayMs` 미만이면 `sleepImpl(남은 ms)`;
    `AbortController` 로 `timeoutMs` 적용; `count++`. `now`/`sleepImpl` 주입으로
    테스트에서 시간 고정.
29. `processUniversity(row, ctx) -> resultObject` — 대학 1곳 전체 파이프(아래 §G).
30. `runBatch(options) -> { report, summary, statePath, reportPath }` — 오케스트레이터
    (테스트에서 fs/fetch/now/random/npmTest 전부 주입).
31. `main()` — `if (require.main === module)`.

## §G. `processUniversity` 흐름 (대학 1곳, 순차)

`ctx` = `{ catalog, candidatesFile, fetchGateFactory, rssCollectorImpl, b1Impl,
b2Impl, regressionEvidence, now, randomBytesImpl, dryRun, minAccepted, runId }`.

1. 대학당 `fetchGate = createFetchGate(...)` 새로 생성(요청 카운터 리셋, 대학당 ≤8).
2. `findCatalogUniversity` 없음 -> `BLOCK_MISSING` 반환(네트워크 0).
3. `universityHasCatalogSource` 또는 후보파일 중복 -> `SOURCE_ALREADY_EXISTS` (네트워크 0).
4. **[req 1]** `homeUrl = row.site` fetch. 실패(비200/타임아웃) -> `NOT_NARA_CMS`
   (reason=`home_fetch_failed`) 또는 `ERROR`(네트워크 예외).
5. `detectNaraCms(homeHtml)` false -> `NOT_NARA_CMS`.
6. `extractNavBoardLinks(homeHtml)` -> 상위 최대 3개 링크만 채택(예산 보호).
7. **[req 2..4]** 각 nav 링크 `subview.do` fetch -> `extractSiteAndBoardId(html, {host})`
   + `classifyBoardCategory(linkText)`. 결과 누적.
   - 홈에서 직접 `/bbs/{site}/{boardId}/` 를 뽑을 수 있으면 subview fetch 생략 가능.
8. `pickBestBoard(...)` null -> `DIAGNOSE_FAILED` (reason=`no_board_found`).
9. **[req 5]** robots: `fetchGate.fetch(origin + "/robots.txt")` ->
   `classifyRobotsFetchResult` -> `evaluateRobots(evidence, { paths })`.
   `ROBOTS_BLOCKED` -> 즉시 반환(candidates/B1/B2 안 함).
10. `source = buildCandidateSource(...)`.
11. **[req 6]** `rssCollectorImpl({ university, source, limit: 3, fetchImpl: fetchGate.fetch })`
    -> `verifyRssFeed`. 실패 -> `DIAGNOSE_FAILED` (reason=`rss_invalid:<...>`).
12. **[req 7..8]** `runPreflight(...)` — RSS item 별 상세 페이지 fetch(최대 2개까지만,
    예산 준수) + `extractDetail`/`titleMatches`/`universityNameMatches` +
    `resolveDateSelector` 폴백 루프.
    - `acceptedCount < minAccepted` 또는 storable 중 publishedAt 누락 잔존 ->
      `DIAGNOSE_FAILED` (reason + `triedDateSelectors`).
    - 폴백으로 다른 셀렉터 채택 시 `source.detailSelectors.date` 를 그 값으로 갱신.
13. `dryRun` 이면: 여기서 `PACKET_CREATED_DRYRUN`(예정) 로 기록하고 candidates/B1/B2
    **호출 안 함**(단, B1 은 `dryRun:true` 로 호출해 diff 미리보기만 얻는 것도 허용 —
    질문사항 5). 기본 `--dry-run` 정책: **아무 쓰기도 안 함**, 리포트/상태만 기록.
14. 실 실행:
    a. `appendCandidateAtomic(candidatesFile, buildCandidateEntry(...))`.
    b. `b1Impl({ universityId, sourceId: source.id, dryRun:false, now })`
       (`prepareCatalogSourceBlock`). throw(`BLOCK_MISSING`/중복) -> 잡아서
       `BLOCK_MISSING` 또는 `SOURCE_ALREADY_EXISTS` 로 분류, 반환.
    c. `b2Impl({ universityId, sourceId: source.id, limit: 3, minAccepted,
       skipNpmTest: true, regressionEvidence, now, randomBytesImpl })`
       (`buildReviewPacketFromDiagnose`).
       - `status==="PACKET_CREATED"` -> `finalDecision="PACKET_CREATED"`,
         `reviewId`, `writtenPath` 기록.
       - `status==="DIAGNOSE_FAILED"` -> `finalDecision="DIAGNOSE_FAILED_POST_B1"`
         + `evaluation.reasons`. (롤백 안 함 — §B.)
15. 반환 객체: `{ universityId, universityName, finalDecision, rssUrl, boardId, site,
    category, usedDateSelector, preflight: { acceptedCount, storableCount },
    robots: { verdict, reason }, reviewId, b1: { status }, requestCount, reason, error }`.

## §H. 리포트 스키마 (`reports/nara-cms-batch/{runId}.json`)

```json
{
  "runId": "20260831T....",
  "tool": "discover-nara-cms-batch",
  "startedAt": "ISO",
  "finishedAt": "ISO",
  "options": { "limit": 10, "universityId": null, "resume": false, "dryRun": false },
  "regressionEvidence": { "npmTestCommand": "npm test", "npmTestSummary": "...", "ranAt": "ISO" },
  "summary": {
    "processed": 10, "packetsCreated": 2, "notNaraCms": 5,
    "robotsBlocked": 1, "diagnoseFailed": 2, "blockMissing": 0,
    "sourceAlreadyExists": 0, "variantCampus": 0, "error": 0
  },
  "results": [ { "...": "§G-15 반환 객체" } ],
  "mutation": { "enabled": false, "verified": false, "status": false,
    "store": false, "preview": false, "git": false, "deploy": false }
}
```

콘솔 1줄 요약도 출력:
`[nara-cms-batch] runId=... processed=10 packets=2 NOT_NARA=5 ROBOTS_BLOCKED=1 DIAGNOSE_FAILED=2`.

## §I. 상태파일 스키마 (`data/nara-cms-batch-state.json`)

```json
{
  "version": 1,
  "updatedAt": "ISO",
  "processed": [
    { "universityId": "kongju-national-university-본교",
      "finalDecision": "PACKET_CREATED",
      "runId": "20260831T...", "at": "ISO",
      "rssUrl": "https://www.kongju.ac.kr/bbs/kongju/xxxx/rssList.do",
      "boardId": "xxxx", "reviewId": "rvw_...", "reason": null }
  ]
}
```

`--resume` 의미: `runBatch` 시작 시 `loadState` -> `selectCandidates` 가
`processed[].universityId` 중 `finalDecision !== "ERROR"` 인 것을 후보에서 제외.
런 종료 시 `mergeState(prev, results, now)` 로 upsert(같은 universityId 는 이번 런
결과로 덮어씀) 후 `writeStateAtomic`.

## §J. finalDecision enum

| 값 | 의미 | 쓰기 부수효과 |
| --- | --- | --- |
| `PACKET_CREATED` | 전체 파이프 통과. candidates append + B1 enabled:false 삽입 + B2 review-packet 생성. | candidates, catalog(B1), review-packet |
| `NOT_NARA_CMS` | 홈페이지에 `/subview.do`·`/bbs/{site}/` 패턴 없음(또는 홈 fetch 실패). | 없음 |
| `ROBOTS_BLOCKED` | `robots.txt` 의 AI 봇 전체차단(`evaluateRobotsPolicy.blocked`) 또는 `*` 그룹이 `/bbs/`·게시판·artclView 경로 Disallow, 또는 robots unavailable. | 없음 |
| `DIAGNOSE_FAILED` | Nara 이고 게시판 후보는 있으나: 게시판 미발견 / RSS `items<2` 또는 필드 누락 / preflight `acceptedCount<2` / 날짜 폴백 전부 실패. `reason` 필수. B1 이전 단계라 카탈로그 무변경. | 없음 |
| `DIAGNOSE_FAILED_POST_B1` | preflight 는 통과했으나 B2 서브프로세스 diagnose 가 실패. candidates/카탈로그(enabled:false)에 항목이 남음. 리뷰어가 다음 라운드에서 처리. | candidates, catalog(B1) |
| `BLOCK_MISSING` | 카탈로그에 대학 블록 없음. B1 이 블록 생성 안 하므로 skip. | 없음 |
| `SOURCE_ALREADY_EXISTS` | 카탈로그 대학 블록에 이미 소스 존재하거나 후보파일에 같은 대학 `COLLECTOR_CONFIG_READY` 존재. | 없음 |
| `SKIPPED_VARIANT_CAMPUS` | `제N캠퍼`/`분교` 변형이고 본교가 이미 소스 보유. | 없음 |
| `FILTERED_OUT` | `--university-id` 단건 지정인데 §C 필터 탈락(디버깅 편의용). | 없음 |
| `ERROR` | 예기치 못한 예외(네트워크 등). `--resume` 시 재시도 대상. | 없음(부분 실패 시 candidates append 까지 갔을 수 있음 -> `error` 필드에 기록) |

---

# 예외 상황

| 상황 | 처리 |
| --- | --- |
| 홈 URL 리다이렉트로 다른 도메인 이동 | `response.url` 의 origin 으로 robots 재조회(§screen 도구와 동일 관행). `host` 도 최종 응답 기준. |
| audit `homeStatus` 는 200 인데 실측 fetch 실패 | `NOT_NARA_CMS`(reason=`home_fetch_failed`) 또는 `ERROR`(예외). |
| audit `cat` 스냅샷이 낡음(인천대=NO_SOURCE 지만 실제 enabled) | 라이브 카탈로그 교차확인으로 `SOURCE_ALREADY_EXISTS`. |
| nav 링크가 5개 이상 | 상위 3개만 subview fetch(대학당 ≤8 요청). |
| 게시판은 찾았으나 `rssList.do` 가 404/HTML 반환 | `rssCollector` 가 throw -> 잡아서 `DIAGNOSE_FAILED`(reason=`rss_fetch_failed`). |
| RSS item `<pubDate>` 없음 (`datePolicy.prefer:"list"` 인데 리스트 날짜 부재) | `verifyRssFeed` 실패 -> `DIAGNOSE_FAILED`. |
| 상세 페이지 날짜가 `dl.write dd` 로 안 잡힘 | `DATE_SELECTOR_FALLBACKS` 순차 시도. 그래도 `>=2` 미달이면 `DIAGNOSE_FAILED`(reason=`published_at_not_found`, `triedDateSelectors` 기록). |
| `titleMatches`/`universityNameMatches` 실패 | 해당 item 비-storable. 누적 acceptedCount 로 판정. |
| 대학당 요청 예산(8) 초과 | `createFetchGate` 가 throw -> 그 대학 `ERROR`(reason=`request_budget_exceeded`). |
| B1 이 중복 sourceId 로 throw | 잡아서 `SOURCE_ALREADY_EXISTS`. |
| B1 이 "university block not found" throw | 잡아서 `BLOCK_MISSING`. |
| B2 가 `npm test` 를 다시 돌리려 함 | `skipNpmTest:true` + 런 시작 시 1회 수집한 `regressionEvidence` 전달 -> 재실행 안 함. |
| `regressionEvidence` 수집 시 `npm test` 실패 | 배치 전체 중단(`runBatch` 가 throw, exit 1). 어떤 candidates/B1/B2 도 실행 안 함. |
| `--dry-run` | 네트워크 조사·preflight 는 수행, candidates/B1/B2 **쓰기 없음**. 리포트/상태파일만 생성. |
| candidates 파일 append 후 B1 실패 | candidates 에 항목 남음(비활성). `DIAGNOSE_FAILED_POST_B1`/`BLOCK_MISSING` 로 기록. 자동 롤백 없음. |
| 리포트 디렉터리 없음 | `mkdir -p`. |
| `--resume` 인데 상태파일 없음 | `loadState` 가 빈 상태 반환, 전량 처리. |
| 같은 host 를 쓰는 캠퍼스 여러 개 | `deriveShortName` 충돌 시 접미사(`-2`). |
| 시간/난수 | `now`,`randomBytesImpl`,`sleepImpl` 주입. CLI 기본은 실제 값. |

---

# 완료 기준

- [ ] `node --check server/agent/onboarding/tools/discover-nara-cms-batch.js` 통과.
- [ ] `node --check server/agent/onboarding/tools/discover-nara-cms-batch.test.js` 통과.
- [ ] `node --test server/agent/onboarding/tools/discover-nara-cms-batch.test.js` — 전부 통과.
- [ ] `npm test` (`node --test` 재귀) — 기존 309 + 신규 N 통과, **회귀 0**.
- [ ] **실측 시연 1 (network permitting)**: `node server/agent/onboarding/tools/discover-nara-cms-batch.js --university-id=<인천대 아닌 Nara 대학>` 에서
      `NOT_NARA_CMS` 가 아닌 대학 1곳이 rssUrl 발견 -> preflight 통과 -> B1 삽입 ->
      B2 `PACKET_CREATED` 까지 도달, review-packet 파일 1개 생성.
- [ ] **실측 시연 2**: 실패 대학도 1건 이상 — `NOT_NARA_CMS` / `ROBOTS_BLOCKED` /
      `DIAGNOSE_FAILED` 중 하나로 분류되어 리포트에 기록.
- [ ] **`--limit=10` dry 시연**: `node ...discover-nara-cms-batch.js --limit=10 --dry-run`
      -> 상태파일 + 리포트 생성 확인, 카탈로그 diff 0(dry). 이어서 non-dry 시
      카탈로그 diff 는 B1 통과분(enabled:false 삽입)만, 최소 diff.
- [ ] 단위 테스트: 후보 필터 / Nara 탐지 / boardId 추출 / robots path 판정 /
      리포트 집계 / 상태·resume — 픽스처 기반, 전부 오프라인.
- [ ] 산출물이 candidates append + B1 enabled:false 삽입 + B2 review-packet 로 국한됨을
      리포트 `mutation` 플래그와 실제 git diff 로 확인. `enabled:true`/store/preview/
      git/deploy 변경 0.
- [ ] git push / 배포 미실행. 커밋은 사용자가 명시 요청 시에만.

---

# 테스트 계획 (`discover-nara-cms-batch.test.js`, `node:test` + `node:assert/strict`)

전부 오프라인. `fetchImpl` 은 `Map<url, { status, headers?, text }>` 기반 스텁,
`now`/`randomBytesImpl`/`sleepImpl` 고정 주입. 픽스처 HTML 은 파일 상단 상수
(인천대 실제 구조를 축약: nav 에 `/inu/13580/subview.do` "인천대소식",
subview 에 `/bbs/inu/2594/12345/artclView.do`, `rssList.do` 는 3-item RSS).

| # | 대상 | 픽스처 | 단언 |
| --- | --- | --- | --- |
| 1 | `matchesCandidateFilter` | 표: `{homeStatus, robots, cat}` 조합 12행 | `"200"/"ok"/"NO_SOURCE"` true; `"302"` false; `"404"` false; `"ERR:ECONNRESET"` false; `"AI_BLOCKED"` false; `"not-robots(html)"` false; `"ACTIVE"` false; `"SOURCE_UNVERIFIED"` true; `"none(404)"` true |
| 2 | `isVariantCampus` | catalog: `경동대 본교` sources=[{...}] + `경동대 제3캠퍼` | 제3캠퍼 -> true; 본교 -> false; 본교 sources=[] 이면 제3캠퍼 -> false |
| 3 | `selectCandidates` | audit 6행 + catalog + state(processed 2건) | limit=3 -> 3건; `--resume` 로 processed 2건(비 ERROR) 제외; `--university-id` -> 1건; ERROR 상태는 재포함 |
| 4 | `detectNaraCms` | (a) subview.do HTML (b) `/bbs/inu/` href HTML (c) 워드프레스 HTML | a,b -> `isNara:true`; c -> false; evidence 배열 비어있지 않음(a,b) |
| 5 | `extractNavBoardLinks` + `classifyBoardCategory` | nav HTML: "보도자료"(/bbs/), "공지사항"(subview.do), "입학안내"(subview.do) | 링크 2개 반환(입학안내 제외); classify: 보도자료->`school_news`, 공지사항->`school_notice`, 입학안내->null |
| 6 | `pickBestBoard` | candidates: notice + news 혼재 | `school_news` 선택; news 없으면 notice; 둘 다 없으면 null |
| 7 | `extractSiteAndBoardId` | (a) `/bbs/inu/2594/12345/artclView.do` 포함 HTML (b) `"https://x/bbs/kongju/778/rssList.do"` (c) 매칭 없음 | a -> `{site:"inu",boardId:"2594"}`; b -> `{site:"kongju",boardId:"778"}`; c -> null |
| 8 | `buildCandidateSource` | `{host:"www.inu.ac.kr", site:"inu", boardId:"2594", category:"school_news", shortName:"inu"}` | `rssUrl==="https://www.inu.ac.kr/bbs/inu/2594/rssList.do"`, `baseUrl`, `detailSelectors.title==="h2.view-title"`, `datePolicy.prefer==="list"`, `verified:false`, `enabled:false`, `id==="inu-press-release"` |
| 9 | `verifyRssFeed` | (a) 3 items 완전 (b) 1 item (c) item 1개 pubDate 없음 | a -> `ok:true,itemCount:3`; b -> `ok:false`(itemCount<2); c -> `ok:false` + reason 에 pubDate |
| 10 | `checkRobotsPathDisallow` | groups: (a) `*` Disallow `/bbs/` (b) `*` Disallow `/admin/` (c) `*` Disallow 없음 | a -> `disallowed:true, matchedRule:"/bbs/"`; b -> false; c -> false |
| 11 | `evaluateRobots` | (a) `evaluateRobotsPolicy.blocked` (ClaudeBot Disallow /) (b) path disallow (c) 404 not-found (d) 500 unavailable | a -> `ROBOTS_BLOCKED`; b -> `ROBOTS_BLOCKED`; c -> `OK`; d -> `ROBOTS_BLOCKED`(ROBOTS_UNAVAILABLE) |
| 12 | `resolveDateSelector` | 상세 HTML: `dl.write dd` 없음, `.artclInfo .date` 에 `2026.08.20` | `selector===".artclInfo .date"`, 2개 이상 index 채워짐; 아무 셀렉터도 매칭 안 되는 HTML -> null |
| 13 | `runPreflight` | rssCollectorImpl 스텁 3 items + fetchImpl 상세 HTML(제목/대학명/날짜 일치) | `ok:true, acceptedCount:3`; 제목 불일치 HTML -> `ok:false, reason` 에 mismatch; storable<2 -> `DIAGNOSE_FAILED` reason |
| 14 | `createFetchGate` | `sleepImpl` 기록용 배열, `now` 증가 스텁, fetchImpl 성공 | 2번째 호출 전 `sleepImpl(>=500-경과)` 호출됨; 9번째 호출 -> throw `request_budget_exceeded`; timeout 시 AbortController.abort 경로 |
| 15 | `appendCandidateAtomic` | tmpdir 후보파일 | 항목 append 후 `JSON.parse` OK; 같은 `universityId+id` 재호출 -> no-op(길이 불변); backup 파일 생성 |
| 16 | `aggregateSummary` | results 배열(각 finalDecision 1개씩) | 카운트가 finalDecision 분포와 일치; `DIAGNOSE_FAILED_POST_B1` 는 `diagnoseFailed` 에 합산 |
| 17 | `mergeState` / `loadState` / `writeStateAtomic` | tmpdir | 없는 파일 -> 기본 state; merge 시 같은 universityId upsert(최신); 원자적 쓰기 후 parse OK |
| 18 | `runBatch` (통합, 오프라인) | fetchImpl 전체 시나리오(홈+nav+subview+robots+rss+상세) + b1Impl/b2Impl 스텁 | Nara 대학 -> b1Impl 1회 호출(`sourceId` 정확), b2Impl 1회 호출(`skipNpmTest:true`, 동일 `regressionEvidence`), `PACKET_CREATED`; 리포트/상태 파일 기록; `--dry-run` -> b1Impl/b2Impl/append 0회 |
| 19 | `parseCliArgs` | 다양한 argv | 기본 limit=10; `--limit=abc` -> throw; `--university-id=x --resume --dry-run` 파싱 |
| 20 | `deriveShortName` | `("incheon-national-university-본교","www.inu.ac.kr",[])` / 충돌 set | `"inu"`; 충돌 시 `"inu-2"` |

신규 테스트 수 대략 20개 파일, 40+ assertion. 기존 스위트 309 유지.

---

# 검증 계획

## 오프라인 (필수)

```powershell
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js"
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
node --test "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
npm test    # 기대: 기존 309 + 신규 통과, fail 0
```

카탈로그/후보/상태 JSON 은 편집 시 다음으로 파싱 검증:

```powershell
node -e "JSON.parse(require('fs').readFileSync('D:\\hhg(code)\\server\\agent\\onboarding\\data\\collector-config-candidates.json','utf8'));console.log('JSON OK')"
```

## 실측 (network permitting — 오프라인이면 아래 픽스처 대체)

Tester 후보 대학 (audit 큐에서 §C 필터 통과 + 카탈로그 블록 존재 + Nara Info CMS
가능성 높음. 국립대는 Nara CMS 채택률이 높음):

| universityId | 대학 | host | robots(audit) | 카탈로그 블록 |
| --- | --- | --- | --- | --- |
| `kongju-national-university-본교` | 국립공주대학교 | www.kongju.ac.kr | ok | 있음 (sources=[]) |
| `kumoh-national-institute-of-technology-본교` | 국립금오공과대학교 | www.kumoh.ac.kr | ok | 있음 (sources=[]) |
| `gangneung-wonju-national-university-본교` | 국립강릉원주대학교 | www.gwnu.ac.kr | ok | 있음 |
| `gyeongguk-national-university-본교` | 국립경국대학교 | www.andong.ac.kr | none(404) | 있음 (sources=[]) |

> 참고: `kunsan-national-university-본교`(국립군산대)는 audit robots 가
> `not-robots(html)` 라 §C 필터에서 탈락 — 후보 아님.

```powershell
# 시연 1: 단건 (위 목록에서 1~3곳 시도, PACKET_CREATED 1건 확보)
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kongju-national-university-본교
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kumoh-national-institute-of-technology-본교

# 시연 2: limit=10 dry
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --limit=10 --dry-run

# (dry 확인 후) limit=10 실 실행 — 통과분만 B1/B2
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --limit=10
```

검증 포인트:
- 리포트 파일 `reports/nara-cms-batch/{runId}.json` 존재, `summary` 카운트 합 == `processed`.
- 상태파일 `data/nara-cms-batch-state.json` 의 `processed[]` 갱신.
- `git diff -- development/university-news/data/university-news-sources.final.json`
  -> B1 통과분의 `enabled:false` 소스 블록 삽입만, 다른 대학/필드 불변.
- `git status` 에 `agent-news-store.json` / `university-news-preview.json` 변경 없음.
- B2 review-packet 파일이 통과분 수(M)만큼 생성.

오프라인 대체: 위 실측을 `runBatch` 통합 테스트(#18)가 fetch/ b1/b2 주입으로 재현.
실측 불가 시 Tester 는 test #18 로그 + 픽스처 기반 `PACKET_CREATED` 경로 통과를
증거로 첨부하고 "실측 network-blocked" 명시.

---

# 커밋 계획 (main 위, **미실행 — 사용자 명시 요청 시에만**)

1. **코드 커밋**
   `feat(onboarding): Nara Info CMS 배치 발굴 도구(discover-nara-cms-batch) — B1+B2 게이트 패킷, 활성화 없음`
   - `server/agent/onboarding/tools/discover-nara-cms-batch.js`
   - `server/agent/onboarding/tools/discover-nara-cms-batch.test.js`
   - `server/agent/onboarding/reports/nara-cms-batch/.gitkeep`
   - (필요 시) `.gitignore` 에 런 산출물 패턴 추가

2. **파이프라인 기록 커밋**
   `docs(pipeline): discover-nara-cms-batch spec/changes/test-results/review 기록`
   - `.pipeline/spec.md` (본 문서)
   - `.pipeline/changes.md`, `.pipeline/test-results.md`, `.pipeline/review.md`

3. **데이터 산출물 (실측 시연 결과) — 별도 판단**
   실측 시연이 만든 `collector-config-candidates.json` append,
   카탈로그 enabled:false 삽입, review-packet, 상태/리포트 파일의 커밋 포함 여부는
   사용자 확인 필요(질문사항 2). 인천대 선례(커밋 1ca360e)는 후보 append 를 커밋함.

git push / 배포 없음.

---

# 질문사항

1. **source id 의 `{shortname}`**: 인천대는 `inu-press-release`(host 라벨 `inu`)를
   썼다. `deriveShortName` 을 host 첫 라벨 기준으로 잡는 게 맞나? (universityId
   기반 slug 가 아니라) — 본 계획은 host 라벨 채택.
2. **실측 시연 산출물 커밋 여부**: `--university-id` / `--limit=10` 실 실행이
   만든 candidates append·카탈로그 enabled:false 삽입·review-packet·상태/리포트
   파일을 이번 라운드 커밋에 포함하나, 아니면 시연 후 되돌리나?
3. **`SOURCE_ALREADY_EXISTS` 판정 근거**: audit `cat` 스냅샷이 낡았으므로
   (인천대=NO_SOURCE 지만 실제 enabled) 라이브 카탈로그 `sources.length>0` +
   후보파일 중복을 기준으로 판정하려 한다. 동의하나?
4. **변형 캠퍼스 정규식**: audit 문자열이 `제3캠퍼`(잘림, `캠퍼스` 아님)로 저장돼
   있다. `/-제\d*캠퍼|-분교/`(id) + `/제\s*\d*\s*캠퍼|분교/`(name) 로 매칭하려 한다.
   "본교" 유도는 `id.replace(/-(제\d*캠퍼[^-]*|분교)$/, "-본교")` — 예외 케이스 있나?
5. **robots path Disallow 대상 경로**: `["/bbs/", "/bbs/{site}/",
   "/bbs/{site}/{boardId}/", "/bbs/{site}/{boardId}/{n}/artclView.do"]` 를 `*` 그룹
   Disallow 와 prefix 매칭. `/{site}/{n}/subview.do`(네비 경로)까지 봐야 하나?
   (RSS 수집·상세 파싱에는 `/bbs/` 경로만 필요하므로 subview 는 제외 제안.)
6. **리포트/상태 파일 git 추적**: AGENTS.md §6("생성 리포트·런 로그·백업은
   의도적으로 추적하는 아티팩트가 아니면 소스 밖")에 따라 `reports/nara-cms-batch/`
   와 `nara-cms-batch-state.json` 을 `.gitignore` 에 넣고 `.gitkeep` 만 추적하려 한다.
   (인천대 라운드의 다른 리포트 관행과 맞나?)
7. **`--dry-run` 시 B1 dryRun 미리보기**: `--dry-run` 에서 B1 을 `dryRun:true` 로
   호출해 `checksumBefore/After` diff 미리보기를 리포트에 담을까, 아니면 조사만 하고
   B1 을 아예 호출하지 않을까? (본 계획 기본: 아예 호출 안 함.)
8. **`DIAGNOSE_FAILED_POST_B1` 무롤백**: preflight 통과 후 B2 실패 시 카탈로그의
   enabled:false 항목·후보 append 를 남기고 리포트로만 표시(자동 삭제 안 함).
   허용되나? (삭제도 조심스러운 카탈로그 변형이라 회피.)
