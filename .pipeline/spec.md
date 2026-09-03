# 목표

`server/agent/onboarding/tools/discover-nara-cms-batch.js` 의 Nara CMS 탐지·게시판
선택 정확도를 개선해, 117개 전수 스캔에서 패킷 0건이었던 근본 원인 두 가지를
고친다.

- **근본 원인 1**: `detectNaraCms()` 가 raw 홈페이지 HTML(대부분 SPA 셸)의
  `/{seg}/{digits}/subview.do`·`/bbs/{seg}/` 마커에만 의존해, 이미 활성화된
  인천대조차 이 함수만으로는 NOT_NARA 오탐이다.
- **근본 원인 2**: 게시판 선택이 라벨 휴리스틱으로 "하나 고르고 끝"이라, 빈/비활성
  게시판(rssList.do items=0)을 골라도 재시도하지 않고 그대로 DIAGNOSE_FAILED.

이번 라운드는 **기존 도구 튜닝**이며 새 개념·새 산출물 유형을 추가하지 않는다.
산출물은 여전히 candidates append + B1(카탈로그 enabled:false 삽입) + B2
(review-packet) 뿐이다. `enabled:true` 전환, store/preview 쓰기, git, 배포는 하지
않는다.

---

# AGENTS.md §1 도메인 순서

`UNI PICK work -> Source activation and source-quality tools`(탐지/게시판 선택
정확도 개선, 읽기 전용 조사 + 게이트 패킷 생성) ` -> Development work (Tests)`
(단위 테스트 + 회귀).

---

# 요구사항

사용자 요청 원문의 "만들 것 1-5", "제약", "완료 기준", "범위 밖"을 그대로 반영한다
(아래 "구현 계획"에서 각 항목을 코드 위치까지 구체화).

1. `detectNaraCms` 다중 시그널화(리다이렉트 최대 4회 추종 + 시그널 A/B/C).
2. 게시판 발견을 sitemap(`{origin}/xmlSite/siteMap.do`) 기반으로, nav 추출은 폴백.
3. 게시판 검증(rss-collector 재사용)을 커밋(카탈로그 삽입) **이전에** 후보별로
   수행 — items<2 나 XML 아니면 다음 후보로, 첫 통과 게시판을 채택.
4. request budget 대학당 8 -> 18, origin 당 Crawl-delay 최소 500ms 유지, 대학당
   전체 타임아웃 90s 상한 신설.
5. `--retry-decisions=A,B,...` 플래그 — 상태파일의 마지막 `finalDecision` 이 그
   목록에 속한 대학만 재처리, 나머지(다른 결정)는 손대지 않음.

## 제약 (AGENTS.md 그대로)

- `enabled:true`·store/preview·git·배포 안 함. 산출물 = candidates append +
  B1 enabled:false 삽입 + B2 review-packet 뿐.
- `rss-collector.js` / 게이트 모듈(`server/agent/gate/*`) / `run-single-school-trial.js`
  수정 금지(재사용만). `prepare-catalog-source-block.js`,
  `build-review-packet-from-diagnose.js`, `server/agent/screening/robots-group-parser.js`,
  `server/agent/tools/screen-selector-required-sources.js` 도 이번 라운드는 수정
  없이 재사용만(§구현 계획 참고 — 새 Sitemap 파서는 이 파일들이 아니라
  `discover-nara-cms-batch.js` 내부 로컬 함수로 둔다).
- 캠퍼스명 불일치(`run-single-school-trial.js` 의 `universityNameMatches` 문제)는
  범위 밖. 발생 시 기존과 동일하게 `DIAGNOSE_FAILED`(reason=`university_name_mismatch`,
  runPreflight 내부에서 이미 처리됨)로 두고 손대지 않는다.
- 시간/난수/네트워크는 전부 테스트에서 주입 고정(기존 관례 유지).

---

# 파일

## 변경 (이 두 파일만)

| 경로 | 무엇을 바꾸는지 |
| --- | --- |
| `server/agent/onboarding/tools/discover-nara-cms-batch.js` | ① `detectNaraCms` 시그니처 확장(다중 시그널, 하위호환). ② 신규 순수 헬퍼 6개(로봇 Sitemap 라인 추출/판정, sitemap 신호 판정, sitemap 메뉴 추출, 후보 우선순위). ③ 신규 비동기 오케스트레이터 `selectValidatedBoard`(§구현 계획 D). ④ `runPreflight` 에 `prefetchedRssResult` 선택 인자 추가(중복 RSS fetch 방지). ⑤ `createFetchGate` 에 `maxElapsedMs`(기본 90000) + `UNIVERSITY_TIMEOUT_EXCEEDED` 추가, `maxRequests` 기본값 8→18. ⑥ `processUniversity` 흐름 재배선(§구현 계획 F): 홈 리다이렉트 최대 4회, robots 를 Nara 판정 이전으로 이동(1회만 fetch 후 재사용), sitemap fetch 추가, 게시판 선택을 `selectValidatedBoard` 경유로 교체. ⑦ `parseCliArgs`/`selectCandidates`/`runBatch`/`main` 에 `--retry-decisions` 배선. ⑧ `buildReport.options` 에 `retryDecisions` 필드 추가(투명성). `pickBestBoard`,`extractNavBoardLinks`,`classifyBoardCategory`,`extractSiteAndBoardId`,`verifyRssFeed`,`extractClientRedirect` 등 기존 순수 함수는 **그대로 재사용**(대부분 이름 변경 없이 새 오케스트레이터 안에서 호출). |
| `server/agent/onboarding/tools/discover-nara-cms-batch.test.js` | 신규 픽스처(로봇 Sitemap 라인, `xmlSite/siteMap.do` HTML, 4-hop 리다이렉트 체인, 상태파일 다중 finalDecision) + 신규 테스트(§테스트 계획) + 기존 테스트 3건 필수 수정(§테스트 계획 "기존 테스트 수정 필요" 표). |

## 읽기 전용 참조 (수정 안 함, 확인만)

- `universities.js` — 인천대(`incheon-national-university-본교`, `website: "https://www.inu.ac.kr/"`), 대구대(`daegu-university-본교`, `website: "https://www.daegu.ac.kr"`, `sources: []`).
- `development/university-news/data/university-news-sources.final.json` — 인천대는 **이미 `inu-press-release` 소스 보유**(수동 완주 완료, `SOURCE_ALREADY_EXISTS` 대상). 대구대는 `sources: []`(신규 대상).
- `.pipeline/onboarding-phase1-audit-detail.json` — 후보 큐(변경 없음).
- `server/agent/onboarding/reports/nara-cms-batch/fullscan2.json` — 개선 전 베이스라인(비교용).
- `development/university-news/collectors/rss-collector.js`, `server/agent/tools/run-single-school-trial.js`, `server/agent/onboarding/tools/prepare-catalog-source-block.js`, `server/agent/onboarding/tools/build-review-packet-from-diagnose.js`, `server/agent/screening/robots-group-parser.js`, `server/agent/tools/screen-selector-required-sources.js` — 전부 `require` 로만 재사용, 수정 없음.

## 절대 건드리지 않음

`rss-collector.js`, `run-single-school-trial.js`, `prepare-catalog-source-block.js`,
`build-review-packet-from-diagnose.js`, `server/agent/gate/*`,
`server/agent/screening/*`, `universities.js`, `server/agent/data/agent-news-store.json`,
`data/university-news-preview.json`, 모든 배포/스케줄러 파일, 실제 카탈로그
(`development/university-news/data/university-news-sources.final.json`) 는 B1
경유로만 변경(직접 쓰기 금지, 기존과 동일).

---

# 구현 계획

## §A. `detectNaraCms` 다중 시그널화 — 정확한 순서/우선순위 + evidence 형식

**시그니처 확장(하위호환, 기존 호출부/테스트 무변경)**:

```js
detectNaraCms(html, options = {})
// options: { host, robotsSitemapUrls?: string[], sitemapHtml?: string }
```

`options.robotsSitemapUrls`/`options.sitemapHtml` 를 안 넘기면(기존 테스트 #4 처럼)
시그널 A/B 는 자동으로 미매칭(`matched:false`) 취급되고, 기존 시그널 C(마커 스캔)만
동작 — **기존 동작·기존 단위 테스트 결과 불변**.

**판정 순서(호출 시 평가 순서 = A -> B -> C, OR 결합)**:

1. **시그널 A** — `robotsSignalIndicatesNara(options.robotsSitemapUrls || [])`.
   `robots.txt` 의 `Sitemap:` 라인 중 하나라도 URL 의 `pathname` 이(소문자 비교)
   `/xmlsite/sitemap.do` 로 끝나거나 `/bbs/` 를 포함하면 매칭.
2. **시그널 B** — `sitemapSignalIndicatesNara(options.sitemapHtml)`.
   `options.sitemapHtml` 이 비어있지 않은 문자열이고, 그 안에서
   `/[A-Za-z0-9_-]+\/\d+\/subview\.do/g` 매칭 링크가 **2개 이상**(다수) 발견되면
   매칭. (호출부는 `{origin}/xmlSite/siteMap.do` fetch 가 실패/404 면 이 인자를
   아예 넘기지 않는다 — "fetch 성공 + 본문 있음" 만 시그널 B 후보.)
3. **시그널 C** — 기존 로직 그대로: `html`(홈페이지, 리다이렉트 최종 도달 페이지)
   안의 `/{seg}/{digits}/subview.do` 또는 same-host `/bbs/{seg}/` href.
4. `isNara = A.matched || B.matched || (C 증거 1개 이상)`.

**반환값(evidence 기록 형식)**:

```js
{
  isNara: boolean,
  evidence: string[],          // 최대 5개: A 최대 1개, B 최대 1개, C 최대 3개(기존과 동일 cap)
  signals: { A: boolean, B: boolean, C: boolean },
  host: string | null
}
```

evidence 문자열 형식(신설, 접두사로 신호 출처 표시):

- A 매칭 시: `"[A] robots Sitemap -> " + matchedSitemapUrl`
- B 매칭 시: `"[B] xmlSite/siteMap.do subview.do links=" + subviewLinkCount`
- C 매칭 시: 기존 그대로(스니펫 문자열, 접두사 없음 — 기존 테스트 #4 가
  `evidence[i]` 를 스니펫 원문으로 비교하므로 접두사를 붙이면 회귀. **C 항목은
  기존 형식 유지, A/B 만 신규 접두사 형식.**)

**신규 순수 함수(모두 `module.exports`, 네트워크 없음)**:

```js
// robots.txt 원문에서 Sitemap: 라인 값들을 추출한다.
// (server/agent/screening/robots-group-parser.js 는 수정하지 않는다 —
//  Sitemap 지시어는 User-agent 그룹에 속하지 않으므로 그 파서의 그룹 모델과
//  무관한 별도의 로컬 정규식 스캔으로 처리한다.)
function extractRobotsSitemapUrls(robotsText) {
  const out = [];
  const re = /^sitemap\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(String(robotsText || "")))) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

function robotsSignalIndicatesNara(sitemapUrls) {
  for (const raw of sitemapUrls || []) {
    let pathname = "";
    try { pathname = new URL(raw).pathname.toLowerCase(); } catch { continue; }
    if (pathname.endsWith("/xmlsite/sitemap.do") || pathname.includes("/bbs/")) {
      return { matched: true, matchedUrl: raw };
    }
  }
  return { matched: false, matchedUrl: null };
}

function sitemapSignalIndicatesNara(sitemapHtml) {
  const text = String(sitemapHtml || "");
  if (!text) return { matched: false, subviewLinkCount: 0 };
  const matches = text.match(/\/[A-Za-z0-9_-]+\/\d+\/subview\.do/g) || [];
  const count = new Set(matches).size;
  return { matched: count >= 2, subviewLinkCount: count };
}
```

## §B. 게시판 발견 — sitemap 기반 (신규 순수 헬퍼)

**sitemap 메뉴 항목 추출** (신규, 순수):

```js
// sitemapHtml: {origin}/xmlSite/siteMap.do 응답 본문.
// 반환: 중복 제거된 메뉴 항목 목록(순서는 문서 등장 순).
function extractSitemapMenuEntries(sitemapHtml) {
  const text = String(sitemapHtml || "");
  const anchorRe =
    /<a\b[^>]*href\s*=\s*["']([^"']*\/([A-Za-z0-9_-]+)\/(\d+)\/subview\.do)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = anchorRe.exec(text))) {
    const [, href, site, menuId, innerHtml] = m;
    const label = innerHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const key = `${site}/${menuId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, site, menuId, text: label });
  }
  return out;
}

// classifyBoardCategory(entry.text) 로 라벨 분류 후 school_news 우선 정렬.
// (기존 함수 재사용 — 새 분류 로직 안 만듦. "알림"이 school_notice 로 분류되는
// 기존 정규식 동작은 그대로 유지한다 — 아래 "가정/결정" 참고.)
function prioritizeBoardCandidates(labeledCandidates) {
  return [
    ...labeledCandidates.filter((c) => c.category === "school_news"),
    ...labeledCandidates.filter((c) => c.category === "school_notice"),
  ];
}
```

**게시판 후보 소스 결정 의사코드** (processUniversity 내부, §F 에서 다시 배치):

```
if (sitemapHtml && sitemapFetchOk) {
  const entries = extractSitemapMenuEntries(sitemapHtml)
    .map(e => ({ ...e, category: classifyBoardCategory(e.text) }))
    .filter(e => e.category);                    // 뉴스/보도/소식/공지/알림 라벨만
  boardCandidates = prioritizeBoardCandidates(entries)
    .slice(0, MAX_BOARD_CANDIDATES)               // = 4 (§E 예산 계산 참고)
    .map(e => ({
      site: e.site, menuId: e.menuId, category: e.category,
      linkText: e.text, subviewUrl: absoluteUrl(e.href, origin),
      directBoardId: null,                        // sitemap 후보는 subview fetch 필요
    }));
}
if (!boardCandidates.length) {
  // 폴백: 기존 extractNavBoardLinks(homeHtml) — SPA 라 대개 비거나 적음.
  boardCandidates = extractNavBoardLinks(homeHtml).slice(0, MAX_BOARD_CANDIDATES)
    .map(link => {
      const direct = extractSiteAndBoardId(link.href, { host }); // href 가 이미 /bbs/.../ 면 subview fetch 생략
      return {
        site: direct?.site ?? null, menuId: null, category: classifyBoardCategory(link.text),
        linkText: link.text, subviewUrl: absoluteUrl(link.href, origin),
        directBoardId: direct?.boardId ?? null,
      };
    })
    .filter(c => c.category);
}
if (!boardCandidates.length) return DIAGNOSE_FAILED(reason: "no_board_found");
```

`sitemap 없거나 메뉴가 안 잡히면 기존 nav 추출로 폴백` 요구사항을 그대로 만족.
`pickBestBoard`(기존 순수 함수)는 **그대로 export/테스트 유지**하되, `processUniversity`
내부 실제 선택 로직은 §C 의 `selectValidatedBoard` 로 대체한다(카테고리 우선순위만
고르고 검증하지 않는 옛 방식은 근본 원인 2 를 재현하므로 더 이상 단독 사용 안 함).

## §C. 게시판 검증 — 커밋 전 후보 순회 (신규 비동기 오케스트레이터)

`verifyRssFeed`(기존 순수 함수, 무변경: `items>=2 && title/link/pubDate 존재`)를
후보마다 실제 rss-collector 호출 결과에 적용해, **첫 통과 후보를 채택**.

```js
// candidates: §B 의 boardCandidates (순서 = 우선순위).
// 반환: { board, rssResult, triedCount, failures[] } | { board: null, triedCount, failures[] }
async function selectValidatedBoard({ candidates, university, host, origin, gate, rssCollectorImpl }) {
  const failures = [];
  for (const cand of candidates) {
    let site = cand.site, boardId = cand.directBoardId;
    if (!boardId) {
      // sitemap 후보(또는 direct 추출 실패한 nav 후보): subview.do fetch 필요.
      let html = "";
      try {
        const res = await gate.fetch(cand.subviewUrl);
        if (res.ok) html = await res.text();
      } catch (error) {
        if (isGateBudgetError(error)) throw error;          // 예산/타임아웃은 즉시 상위로 전파
        failures.push({ candidate: cand, reason: `subview_fetch_failed:${error.message}` });
        continue;
      }
      const found = extractSiteAndBoardId(html, { host });
      if (!found) { failures.push({ candidate: cand, reason: "boardid_not_found" }); continue; }
      site = found.site; boardId = found.boardId;
    }

    const trialSource = { rssUrl: `https://${host}/bbs/${site}/${boardId}/rssList.do` };
    let rssResult;
    try {
      rssResult = await rssCollectorImpl({ university, source: trialSource, limit: 3, fetchImpl: gate.fetch });
    } catch (error) {
      if (isGateBudgetError(error)) throw error;
      failures.push({ candidate: cand, site, boardId, reason: `rss_fetch_failed:${error.message}` });
      continue;
    }
    const feed = verifyRssFeed(rssResult);
    if (!feed.ok) {
      failures.push({ candidate: cand, site, boardId, reason: `rss_invalid:${feed.reasons.join(";")}` });
      continue;                                              // 다음 후보로 (요구사항 그대로)
    }

    return {
      board: {
        site, boardId, category: cand.category,
        categoryLabel: cand.category === "school_news" ? "학교 소식" : "학교 공지",
        sourceUrl: cand.subviewUrl,
      },
      rssResult, triedCount: failures.length + 1, failures,
    };
  }
  return { board: null, triedCount: failures.length, failures };
}
```

호출부(processUniversity): `selectValidatedBoard(...)` 결과의 `board === null` 이면
`finalDecision="DIAGNOSE_FAILED"`, `reason="no_valid_board_found tried=" + triedCount +
" [" + failures.map(f=>f.reason).join(",") + "]"`. `board` 확보 시 `rssResult` 를
`runPreflight` 에 `prefetchedRssResult` 로 전달해 **rssList.do 를 두 번 fetch하지
않는다**(§E 예산).

## §D. `runPreflight` 확장 — RSS 재조회 방지

```js
async function runPreflight({ university, source, limit = 3, fetchGate, rssCollectorImpl,
  minAccepted = 2, maxDetailFetches, prefetchedRssResult }) {
  const collector = rssCollectorImpl || rssCollector;
  let rssResult;
  if (prefetchedRssResult) {
    rssResult = prefetchedRssResult;                // §C 에서 이미 검증 통과한 결과 재사용
  } else {
    try { rssResult = await collector({ university, source, limit, fetchImpl: fetchGate.fetch }); }
    catch (error) { return { ok:false, ..., reason: `rss_fetch_failed:${error.message}` }; }
  }
  // 이하 기존 로직 100% 동일(verifyRssFeed, 상세 fetch 루프, 날짜 폴백).
}
```

기존 호출부(테스트 #13 등)는 `prefetchedRssResult` 를 안 넘기므로 동작 불변.

## §E. request budget — 8 -> 18 적용 지점 + 정확한 카운팅

**`createFetchGate` 변경** (line ~890-940 부근, `discover-nara-cms-batch.js`):

```js
function createFetchGate({
  minDelayMs = 500,      // 변경 없음 — origin 당 Crawl-delay 최소 500ms 그대로 유지
  maxRequests = 18,      // 8 -> 18 (요청 사항)
  timeoutMs = 15000,     // 변경 없음 — 요청 1건당 타임아웃
  maxElapsedMs = 90000,  // 신규 — 대학당 전체 벽시계 타임아웃 90s
  fetchImpl, now = () => Date.now(), sleepImpl,
} = {}) {
  ...
  const startedAtMs = nowMs();
  const gate = {
    count: 0, lastAt: null,
    async fetch(url, init = {}) {
      if (nowMs() - startedAtMs > maxElapsedMs) {
        const error = new Error(`university_timeout_exceeded (max ${maxElapsedMs}ms wall-clock per university)`);
        error.code = "UNIVERSITY_TIMEOUT_EXCEEDED";
        throw error;
      }
      if (gate.count >= maxRequests) {
        const error = new Error(`request_budget_exceeded (max ${maxRequests} requests per university)`);
        error.code = "REQUEST_BUDGET_EXCEEDED";
        throw error;
      }
      // ...기존 crawl-delay/timeout/count++ 로직 그대로...
    },
  };
  return gate;
}
```

`isGateBudgetError(error)` 헬퍼(신규, 순수) 추가:
```js
function isGateBudgetError(error) {
  return Boolean(error) && ["REQUEST_BUDGET_EXCEEDED", "UNIVERSITY_TIMEOUT_EXCEEDED"].includes(error.code);
}
```
`processUniversity` 의 기존 `error.code === "REQUEST_BUDGET_EXCEEDED"` 분기 4곳
(홈 fetch, 리다이렉트 fetch, nav 폴백 루프, robots fetch) 을 전부
`isGateBudgetError(error)` 로 교체하고, 신규 sitemap fetch / `selectValidatedBoard`
호출부에도 동일 패턴 적용. `finalDecision="ERROR"`, `reason` 은
`error.code === "UNIVERSITY_TIMEOUT_EXCEEDED" ? "university_timeout_exceeded" : "request_budget_exceeded"`.

`runPreflight` 내부(상세 페이지 fetch 루프)는 **기존과 동일하게 예외를 개별
item 실패(`detail_fetch_failed:<message>`)로 흡수**한다(하드 ERROR 로 승격하지
않음 — 기존 동작·기존 fullscan2 로그 패턴과 일관).

**대학당 최악 요청 수 계산** (18 상한 검증):

| 단계 | 요청 수 |
| --- | --- |
| 홈 최초 fetch | 1 |
| 클라이언트 리다이렉트 추종(최대 4회, §F) | +4 |
| robots.txt (1회만 fetch, 이후 재사용) | +1 |
| `{origin}/xmlSite/siteMap.do` | +1 |
| 게시판 후보 루프: `MAX_BOARD_CANDIDATES=4` × (subview fetch + rssList.do 검증 fetch) | +8 |
| preflight 상세 페이지 fetch(limit=3, rssList.do 는 `prefetchedRssResult` 재사용이라 0) | +3 |
| **합계(최악)** | **18** |

`MAX_BOARD_CANDIDATES = 4` 를 상수로 선언(`discover-nara-cms-batch.js` 상단,
`NEWS_NAV_KEYWORDS` 근처). 실제로는 direct-extraction(nav href 가 이미
`/bbs/.../` 포함)이나 조기 통과(첫 후보에서 바로 검증 성공)로 대부분 이보다
훨씬 적게 소모된다(인천대 픽스처 기준 home(1)+robots(1)+sitemap(1, 404)+
board검증(1)+preflight상세(3) = 6).

## §F. `processUniversity` 흐름 재배선

기존 순서(홈 -> Nara 판정 -> nav -> robots -> source -> preflight)를 다음으로
변경:

1. `gate = createFetchGate(...)` (대학당 1개, 예산/타임아웃 리셋).
2. 카탈로그 블록 없음 -> `BLOCK_MISSING` (네트워크 0, 기존과 동일).
3. `universityHasCatalogSource` 또는 후보파일 중복 -> `SOURCE_ALREADY_EXISTS`
   (네트워크 0, 기존과 동일 — **인천대는 여기서 걸린다**, §완료 기준 참고).
4. **홈 fetch + 클라이언트 리다이렉트 최대 4회 추종** — 기존 1-hop 루프를
   `for (let hop = 0; hop < 4; hop += 1)` 루프로 확장. 매 hop 마다
   `extractClientRedirect(currentHtml, currentUrl)` 재평가, target 없으면 루프
   탈출. 4회를 다 돌았는데도 여전히 스텁이면(`extractClientRedirect` 가 non-null
   반환) `finalDecision="NOT_NARA_CMS"`, `reason="redirect_loop_or_double_stub"`
   (기존 reason 문자열 유지, 트리거 조건만 1-hop -> 4-hop 으로 완화).
5. `host`/`origin` 확정(최종 도달 URL 기준, 기존과 동일).
6. **robots.txt 1회 fetch** (신규 위치 — 예전엔 게시판 확정 후였다). 응답을
   `{ robotsBody, robotsStatus, robotsFinalUrl, robotsGroups: parseRobotsGroups(robotsBody) }`
   로 캐시해 이후 재사용(재fetch 안 함). `extractRobotsSitemapUrls(robotsBody)` 로
   시그널 A 입력 산출.
7. **`{origin}/xmlSite/siteMap.do` fetch** (신규). 200 이고 본문 있으면
   `sitemapHtml` 확보(시그널 B + §B 게시판 후보 소스). 실패/404 면 `sitemapHtml=null`
   (시그널 B 자동 미매칭, §B 는 nav 폴백).
8. `detectNaraCms(homeHtml, { host, robotsSitemapUrls, sitemapHtml })` — §A.
   `isNara===false` -> `NOT_NARA_CMS`, `reason="no_nara_pattern"`, `base.detectionSignals` 에
   `signals`(A/B/C) 기록(리포트 투명성용, 신규 필드).
9. §B 로 `boardCandidates` 산출(sitemap 우선, nav 폴백). 없으면 `DIAGNOSE_FAILED`
   (`no_board_found`).
10. §C `selectValidatedBoard(...)` 호출. `board===null` -> `DIAGNOSE_FAILED`
    (`no_valid_board_found ...`).
11. **robots 판정(캐시 재사용, 재fetch 없음)**: `checkRobotsPathDisallow`/
    `evaluateRobots` 를 이제 확정된 `site`/`boardId` 로 만든 `robotsPaths` 에 적용
    (기존 로직 그대로, 입력만 캐시된 `robotsGroups`). `ROBOTS_BLOCKED` -> 즉시 반환.
12. `source = buildCandidateSource(...)` (기존과 동일 레시피, 무변경).
13. `runPreflight({ ..., prefetchedRssResult: selectValidatedBoard 결과의 rssResult })`
    (§D). 실패 -> `DIAGNOSE_FAILED`. 날짜 폴백 셀렉터 채택 로직 기존과 동일.
14. `dryRun` -> `PACKET_CREATED_DRYRUN` (기존과 동일).
15. 실 실행: candidates append -> B1 -> B2 (기존과 100% 동일, 무변경).

## §G. `--retry-decisions` 플래그

**`parseCliArgs`**: `--retry-decisions=NOT_NARA_CMS,DIAGNOSE_FAILED` 파싱.

```js
const retryDecisionsRaw = read("--retry-decisions");
const retryDecisions = retryDecisionsRaw === undefined ? null
  : retryDecisionsRaw.split(",").map(s => s.trim()).filter(Boolean);
if (retryDecisionsRaw !== undefined && !retryDecisions.length) {
  throw new Error('--retry-decisions requires at least one finalDecision value (e.g. "NOT_NARA_CMS,DIAGNOSE_FAILED").');
}
```
반환 객체에 `retryDecisions` 필드 추가(기본 `null` = 필터 없음, 기존 동작 그대로).

**`selectCandidates(auditRows, catalog, stateData, opts)`** — `opts.retryDecisions`
처리 추가:

```
1. `--university-id` 단건 지정: 기존과 동일하게 retryDecisions 무시(단건 디버깅
   경로는 원래도 --resume 를 무시하던 기존 관례와 동일하게 취급).
2. pool = auditRows.filter(matchesCandidateFilter)   // 변경 없음
3. 변형 캠퍼스 제외(preSkipped 기록)                    // 변경 없음
4. const stateById = new Map((stateData?.processed || []).map(e => [e.universityId, e]));
5. if (opts.retryDecisions && opts.retryDecisions.length) {
     pool = pool.filter(row => {
       const st = stateById.get(row.id);
       return Boolean(st) && opts.retryDecisions.includes(st.finalDecision);
     });
     // resume 은 여기서 무시한다(상호배타) — retryDecisions 가 지정되면
     // "다른 결정은 건드리지 않음" 요구사항이 곧 필터 그 자체이므로
     // resume 의 "종결분 제외" 규칙과 충돌한다.
   } else if (opts.resume) {
     const done = new Set([...stateById.values()]
       .filter(e => e.finalDecision !== "ERROR").map(e => e.universityId));
     pool = pool.filter(row => !done.has(row.id));
   }
6. limit 로 slice.
```

`resume`/`retryDecisions` 둘 다 넘어오면 `retryDecisions` 우선(4단계 분기가
`else if` 이므로 자동으로 그렇게 됨) — 별도 경고 로그는 필요 없음(순수 함수라
console 부작용 안 만듦; 필요하면 `runBatch` 쪽에서 1줄 로그 가능하지만 이번
라운드는 생략, "새 개념 없음" 원칙 유지).

**`runBatch`**: `options.retryDecisions` -> `selectCandidates(..., { ..., retryDecisions })`
로 전달. **`buildReport`**: `options.retryDecisions` 를 `report.options.retryDecisions`
에 기록(기존 `options` 서브필드에 한 줄 추가, 다른 필드 불변). **`main()`**:
`options.retryDecisions` 를 `runBatch({ ..., retryDecisions: options.retryDecisions })`
로 전달(현재 `main()` 이 `minAccepted` 등을 이미 개별 전달하는 패턴과 동일).

상태에 기록되지 않은 대학(한 번도 처리 안 됨)은 `stateById.get(row.id)` 가
`undefined` 라 자동으로 제외됨 — 별도 분기 불필요("해당 finalDecision 인 대학만"
요구사항과 정합).

---

# 가정/결정 (질문 아님 — 근거와 함께 확정)

1. **`classifyBoardCategory` 재사용, 무변경**: 사용자 원문은 "라벨이 뉴스/보도/
   소식/알림(school_news 우선) 또는 공지사항(school_notice 폴백)" 이라고 썼지만,
   기존(이미 테스트된) `classifyBoardCategory` 정규식은 `공지|알림` 을
   `school_notice` 로 분류한다("알림"이 news 가 아니라 notice). 새 개념을 만들지
   않기 위해 **기존 함수를 그대로 재사용**하고 이 미세한 문구 차이는 무시한다.
   회귀 방지가 "요청 문구 100% 일치"보다 우선이라는 판단.
2. **인천대 완료 기준 시연 경로**: 인천대는 이미 카탈로그에 `inu-press-release`
   소스가 있어(`sources.length>0`), 실제 파이프라인(§F step 3)이 즉시
   `SOURCE_ALREADY_EXISTS` 로 반환한다 — 이는 **정상 동작**(중복 방지)이며 버그가
   아니다. 따라서 "detectNaraCms=true, board 2594 발견, rssList.do items>=2,
   diagnose 통과, review-packet 생성까지 실측 시연"은 **운영 카탈로그를 건드리지
   않는 스크래치 사본**으로 수행한다(§완료 기준 검증 커맨드 참고) — 실제
   inu.ac.kr 에 대한 진짜 네트워크 호출이지만 쓰기 대상 파일만 임시 디렉터리로
   격리한다. `runBatch()` 함수 자체가 이미 `catalogFile`/`candidatesFile`/
   `stateFile`/`reportDir` 를 전부 옵션으로 받으므로 **CLI 확장(`--catalog-file`
   추가 등) 없이** 그대로 가능하다 — 새 CLI 플래그를 만들지 않는다("새 개념 없음"
   원칙 유지).
3. **완료 기준 2번의 "NOT_NARA -> isNara=true" 대상 재선정**: fullscan2 를 직접
   확인한 결과 `kongju-national-university-본교`/`gangneung-wonju-national-university-*`
   는 이미 `DIAGNOSE_FAILED`(`isNara` 는 이미 true, 게시판 2134/1613 이 빈 게시판
   이라 `rss_invalid:items<2`)였고 `NOT_NARA_CMS` 가 아니었다. 반면
   `daegu-university-본교`(대구대, `www.daegu.ac.kr`, 카탈로그 `sources: []`)는
   실제 `NOT_NARA_CMS`(`reason="no_nara_pattern"`)였고, 이 저장소의 **기존
   단위 테스트(§4, cross-host 케이스)가 이미 `www.daegu.ac.kr/bbs/daegu/...`
   구조를 Nara 패턴으로 다루고 있어** 실제 Nara CMS 일 가능성이 높다. 따라서:
   - **완료 기준 2번(다중 시그널로 NOT_NARA -> isNara=true 전환)** 은
     `daegu-university-본교` 로 시연한다.
   - **kongju/gwnu 는 완료 기준 2번의 취지(같은 라운드가 고치려는 "실제 Nara CMS
     인데 패킷이 안 나옴" 문제)를 게시판 재검증 개선(§C)으로 시연하는 데 쓴다**
     — `kongju-national-university-본교` 가 `DIAGNOSE_FAILED(board 2134, items=0)`
     에서 새 로직으로 다른(유효한) boardId 를 찾아 `PACKET_CREATED` 또는 최소한
     `유효한 board 로 바뀐 DIAGNOSE_FAILED` 로 이동하는지 확인.
4. **`{origin}/xmlSite/siteMap.do` 실제 마크업은 미검증**: 이 문서를 쓰는 시점엔
   라이브 네트워크 접근이 없어 실제 사이트맵 페이지의 정확한 HTML 구조를 확인하지
   못했다. §B 의 `extractSitemapMenuEntries` 정규식은 홈페이지 nav 마커와 동일한
   `/{site}/{menuId}/subview.do` 컨벤션을 그대로 확장한 것이며, Coder/Tester 가
   실제 `https://www.inu.ac.kr/xmlSite/siteMap.do` 를 fetch 해 마크업을 확인하고
   필요하면 정규식을 미세조정해야 한다(§예외 상황에도 명시). 실패해도 nav 폴백이
   있어 파이프라인이 완전히 막히지는 않는다.

---

# 예외 상황

| 상황 | 처리 |
| --- | --- |
| 클라이언트 리다이렉트가 4회를 넘어가도 계속 스텁 | `NOT_NARA_CMS`(`redirect_loop_or_double_stub`), 네트워크 조기 종료. |
| `{origin}/xmlSite/siteMap.do` 이 404/비-200/타임아웃 | 시그널 B 미매칭 취급, §B 게시판 후보는 nav 폴백. 시그널 A/C 로도 `isNara` 못 정하면 `NOT_NARA_CMS`. |
| 실제 sitemap 마크업이 예상 정규식과 다름(가정/결정 4) | `extractSitemapMenuEntries` 가 빈 배열 반환 -> 자동으로 nav 폴백 경로 진입(파이프라인 안 막힘). Coder 가 실측 후 정규식 보정 필요할 수 있음. |
| sitemap/ nav 후보 전부 `rssList.do` 검증 실패(items<2 또는 필드 누락) | `DIAGNOSE_FAILED`(`no_valid_board_found`, `failures[]` 사유 나열). candidates/B1/B2 호출 안 함. |
| 후보 순회 도중 요청 예산(18) 또는 대학당 90s 초과 | `isGateBudgetError` 로 감지 -> 즉시 상위로 throw -> `processUniversity` 최상위 분기가 `finalDecision="ERROR"`, `reason` = `request_budget_exceeded` \| `university_timeout_exceeded`. 남은 후보 시도 안 함(추가 요청 자체가 예산 초과이므로 무의미). |
| robots.txt 캐시 재사용 중 실제로는 board 확정 전에 이미 AI 봇 전면차단(`Disallow: /`) 인 경우 | 캐시된 `robotsGroups`/`evaluateRobotsPolicy` 로 board 확정 후 바로 `ROBOTS_BLOCKED` 반환(게시판 검증에 시간 쓰기 전에 걸러야 한다는 반론이 있으나, robots 전면차단 여부는 board 와 무관하게 §F step 6 캐시 시점에 이미 알 수 있음 — **개선 여지**로 남기되 이번 라운드는 사용자 스펙 순서(робots path 판정은 board 확정 이후, §F step 11)를 그대로 따른다. jsRuleOk/AI 전면차단만 확정판 board 이전에 미리 끊고 싶다면 후속 라운드에서 별도 승인 필요.) |
| `--retry-decisions` 지정 값이 실제 finalDecision enum 에 없는 문자열(오타 등) | 에러 아님 — 단순히 매칭되는 상태 항목이 없어 pool 이 빈 배열이 되고 `processed:0` 으로 정상 종료(사용자가 오타를 리포트에서 알아챌 수 있게 `summary.processed===0` 으로 드러남). |
| `--retry-decisions` 와 `--resume` 동시 지정 | `--retry-decisions` 우선(§G), `--resume` 무시. 별도 에러 없음. |
| `--university-id` 와 `--retry-decisions` 동시 지정 | 기존 `--resume`+`--university-id` 관례와 동일하게 `--retry-decisions` 도 단건 경로에서는 무시(§G step 1). |
| `runPreflight` 에 `prefetchedRssResult` 를 넘겼는데 그 안의 items 가 실제로는 `verifyRssFeed` 를 통과 못하는 상태(이론상 없음 — `selectValidatedBoard` 가 이미 통과분만 넘김) | 방어적으로 `runPreflight` 내부의 기존 `verifyRssFeed(rssResult)` 재검증은 그대로 유지(코드 경로 단순화를 위해 재검증 스킵하지 않음) — 이중 검증 비용은 네트워크 요청이 아니므로(순수 함수) 예산에 영향 없음. |
| 카탈로그 스크래치 사본 시연(가정/결정 2) 후 실제 운영 데이터에 반영할지 | 이번 라운드 범위 밖. 시연은 검증 목적이며, 실제 대구대/공주대 등 후보에 대한 운영 카탈로그 반영은 완료 기준 충족 후 사용자가 별도로 `--limit=N`(운영 경로, 스크래치 아님) 실행을 명시 요청할 때 수행. |

---

# 완료 기준

사용자 원문 그대로 + 각 기준의 실측 검증 커맨드.

## 1. 인천대 실측 시연

**기준**: `--university-id` 로 인천대를 넣었을 때 `detectNaraCms=true`, board 2594
발견, `rssList.do` items>=2, diagnose 통과, review-packet 생성까지 실측 시연.

**검증 커맨드**(운영 카탈로그/데이터는 건드리지 않는 스크래치 사본 — 가정/결정 2):

```powershell
node -e "
const fs = require('fs'); const path = require('path');
const ROOT = 'D:/hhg(code)';
const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'inu-demo-'));
const catalogSrc = path.join(ROOT, 'development/university-news/data/university-news-sources.final.json');
const catalog = JSON.parse(fs.readFileSync(catalogSrc, 'utf8'));
const uni = catalog.universities.find(u => u.universityId === 'incheon-national-university-본교');
uni.sources = [];                      // 스크래치 사본에서만 소스 제거(운영 파일은 원본 그대로 read-only)
const catalogFile = path.join(scratch, 'catalog.json');
fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, '.pipeline/onboarding-phase1-audit-detail.json'), 'utf8'));
const auditFile = path.join(scratch, 'audit.json');
fs.writeFileSync(auditFile, JSON.stringify(audit));
const candidatesFile = path.join(scratch, 'candidates.json');
fs.writeFileSync(candidatesFile, JSON.stringify({ generatedAt: null, items: [] }, null, 2));
const stateFile = path.join(scratch, 'state.json');
const reportDir = path.join(scratch, 'reports');
const { runBatch } = require(path.join(ROOT, 'server/agent/onboarding/tools/discover-nara-cms-batch.js'));
runBatch({
  universityId: 'incheon-national-university-본교',
  auditFile, catalogFile, candidatesFile, stateFile, reportDir,
  regressionEvidence: { npmTestCommand: 'npm test', npmTestSummary: 'pre-collected, see npm test run', ranAt: new Date().toISOString() },
}).then(r => { console.log(JSON.stringify(r.report.results[0], null, 2)); console.log('scratch dir:', scratch); });
"
```

**통과 조건**: `results[0].finalDecision === "PACKET_CREATED"`,
`results[0].site === "inu"`, `results[0].boardId === "2594"`,
`results[0].detectionSignals` 에 `isNara:true` 근거 존재, `reviewId` 가 채워짐,
스크래치 `reports/nara-cms-batch/<runId>.json` 과 스크래치 카탈로그 사본에
`inu-press-release` 가 `enabled:false` 로 삽입.

## 2. NOT_NARA -> isNara=true 전환 시연 (대구대)

**기준(재해석, 가정/결정 3)**: fullscan2 에서 `NOT_NARA_CMS` 였던 대학 중 실제
Nara CMS 인 곳(`daegu-university-본교`) 이 새 탐지로 `isNara=true` 로 바뀜.

```powershell
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=daegu-university-본교 --dry-run
```

**통과 조건**: 콘솔/리포트의 `results[0].finalDecision !== "NOT_NARA_CMS"`
(즉 `PACKET_CREATED_DRYRUN` 또는 최소 `DIAGNOSE_FAILED`/`ROBOTS_BLOCKED` 로 진행
— "NOT_NARA_CMS 오탐"이 아니게 됨). 리포트에 `detectionSignals.signals` 중 하나
이상 `true`.

## 2-보조. 게시판 재검증 개선 시연 (공주대)

```powershell
node "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js" --university-id=kongju-national-university-본교 --dry-run
```

**통과 조건**: `finalDecision` 이 `PACKET_CREATED_DRYRUN` 이거나, 여전히
`DIAGNOSE_FAILED` 라면 **`boardId !== "2134"`**(기존에 잘못 고른 빈 게시판이
아닌 다른 후보로 이동했음을 증명) 이거나 `reason` 에 `no_valid_board_found`
(여러 후보를 실제로 시도했다는 증거, `failures` 배열 길이 > 1).

## 3. 단위 테스트

리다이렉트 추종(4-hop), sitemap 파싱->menuId 추출, 라벨 분류, 후보 게시판
`items>=2` 선별, `--retry-decisions` 필터 — 전부 §테스트 계획 대로 픽스처 기반.

```powershell
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js"
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
node --test "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
```

## 4. 전체 회귀

```powershell
npm test
```

**통과 조건**: 기존 스위트 전부 통과 + 신규 테스트 전부 통과, fail 0. git push/배포
미실행. 현재 main 위에 커밋(코드/기록 분리, 커밋 자체는 사용자가 명시 요청할 때만
실행).

---

# 테스트 계획 (`discover-nara-cms-batch.test.js`)

전부 오프라인. `fetchImpl` 은 기존과 동일한 `Map<url,{status,text}>` 기반
`stubFetch`, `now`/`sleepImpl` 고정 주입.

## 신규 픽스처

- `ROBOTS_WITH_SITEMAP` — `"User-agent: *\nDisallow: /admin/\nSitemap: https://www.inu.ac.kr/xmlSite/siteMap.do\n"`.
- `SITEMAP_HTML` — `<a href="/inu/13580/subview.do">인천대소식</a><a href="/inu/13600/subview.do">공지사항</a><a href="/inu/1/subview.do">입학안내</a>`
  (마지막 항목은 라벨 미매칭 -> 필터링 확인용).
- `HOP_CHAIN_HTML[]` — 4단 클라이언트 리다이렉트 체인(hop0 stub -> hop1 stub ->
  hop2 stub -> hop3 실제 콘텐츠) + 별도로 "5회째도 스텁"(전부 stub) 체인.
- `EMPTY_BOARD_RSS_XML` — `items.length===0` RSS(빈 게시판 재현, 공주대 2134 유사).

## 신규/변경 테스트

| # | 대상 | 픽스처 | 단언 |
| --- | --- | --- | --- |
| N1 | `extractRobotsSitemapUrls` | `ROBOTS_WITH_SITEMAP`, Sitemap 라인 없는 robots, 대소문자 혼용(`SITEMAP:`) | 값 배열 정확 추출; 없으면 `[]`; 대소문자 무관 매칭 |
| N2 | `robotsSignalIndicatesNara` | `["https://x/xmlSite/siteMap.do"]`, `["https://x/sitemap.xml"]`, `["https://x/bbs/foo/sitemap.xml"]`, `[]` | 1,3 -> matched:true; 2 -> false; `[]` -> false |
| N3 | `sitemapSignalIndicatesNara` | `SITEMAP_HTML`(subview.do 2개 이상), 링크 1개짜리 HTML, 빈 문자열 | 2개 이상 -> matched:true + count 정확; 1개 -> false; 빈 문자열 -> false |
| N4 | `detectNaraCms` 다중 시그널(하위호환 포함) | (a) 옵션 없이 기존 호출(기존 테스트 #4 그대로 재확인) (b) `robotsSitemapUrls` 만 매칭 (c) `sitemapHtml` 만 매칭 (d) 셋 다 미매칭 워드프레스 HTML | a: 기존 결과 100% 동일; b: `isNara:true, signals.A:true`, evidence 에 `"[A] ..."` 포함; c: `isNara:true, signals.B:true`, evidence 에 `"[B] ..."` 포함; d: `isNara:false` |
| N5 | `extractSitemapMenuEntries` | `SITEMAP_HTML` | 라벨 있는 2개 항목만(입학안내도 항목 자체는 추출되지만 이후 `classifyBoardCategory` 필터링에서 제외됨을 별도 확인), `{site:"inu", menuId:"13580", text:"인천대소식"}` 형태 정확 |
| N6 | `prioritizeBoardCandidates` | school_notice, school_news 섞인 배열 | school_news 전체가 school_notice 전체보다 앞에 옴, 각 그룹 내부 순서 유지 |
| N7 | `selectValidatedBoard` | (a) 첫 후보가 바로 통과(정상 rssXml) (b) 첫 후보 `items=0`(EMPTY_BOARD_RSS_XML) 이고 두 번째 후보가 통과 (c) 전부 실패 | a: `board` 확정, `failures.length===0`; b: `board` 는 두 번째 후보 것, `failures.length===1` (첫 후보 `rss_invalid:...`); c: `board===null`, `failures.length===candidates.length` |
| N8 | `runPreflight` with `prefetchedRssResult` | 미리 만든 `rssResult` 주입, `fetchGate` 에는 rssUrl 매핑을 **일부러 넣지 않음**(재조회 시 실패하도록) | `ok:true` 도달(=rssList.do 를 다시 fetch 하지 않았다는 증거) |
| N9 | `createFetchGate` — `maxElapsedMs`/`UNIVERSITY_TIMEOUT_EXCEEDED` | `now` 를 매 호출 90001ms 씩 진행시키는 스텁 | 두 번째 `fetch()` 호출이 `/university_timeout_exceeded/` 로 reject |
| N10 | `createFetchGate` — 기본 `maxRequests` | 옵션 없이 생성 후 18회 연속 `fetch()` | 18회 전부 성공, 19번째만 `/request_budget_exceeded/` |
| N11 | `isGateBudgetError` | `REQUEST_BUDGET_EXCEEDED`/`UNIVERSITY_TIMEOUT_EXCEEDED`/일반 에러/`undefined` | 앞 2개만 true |
| N12 | `parseCliArgs` — `--retry-decisions` | `--retry-decisions=NOT_NARA_CMS,DIAGNOSE_FAILED`, `--retry-decisions=` (빈 값), 미지정 | 배열 파싱(trim 포함); 빈 값 -> throw; 미지정 -> `null` |
| N13 | `selectCandidates` — `--retry-decisions` 필터 | audit 4행 + state(각각 `NOT_NARA_CMS`/`DIAGNOSE_FAILED`/`PACKET_CREATED`/미기록) | `retryDecisions:["NOT_NARA_CMS","DIAGNOSE_FAILED"]` -> 해당 2건만 선택, 나머지(같은 필터 통과분이라도) 제외; `resume` 도 같이 넘겨도 무시됨(§G) |
| N14 | 처리흐름(processUniversity) — 4-hop 리다이렉트 | `HOP_CHAIN_HTML[0..3]`(3 stub + 1 실콘텐츠) | 4번째에서 실콘텐츠 도달 -> 이후 파이프 정상 진행(`NOT_NARA_CMS`/`redirect_loop_or_double_stub` 아님) |
| N15 | 처리흐름 — 4-hop 넘어도 스텁 | 전부 stub 인 체인(5개 이상) | `NOT_NARA_CMS`, `reason==="redirect_loop_or_double_stub"` |
| N16 | 처리흐름 — sitemap 우선 + nav 폴백 | (a) sitemap 200+유효 메뉴 (b) sitemap 404 -> nav 사용 | a: `requestCount` 에 subview.do 개별 fetch 없이(직접 방식 아니므로 실제론 fetch 필요 — a 는 board 발견 경로가 sitemap 기반임을 결과 필드로 확인) b: nav 기반으로도 기존과 동일하게 성공 |

## 기존 테스트 수정 필요 (회귀 유발 지점 — Coder 가 반드시 갱신)

| # | 파일 내 위치 | 왜 깨지는지 | 수정 방향 |
| --- | --- | --- | --- |
| 14 | `createFetchGate` 예산 초과 테스트(현재 8회 하드코딩) | `maxRequests` 기본값이 8->18 로 바뀌어 9번째 호출이 더 이상 throw 하지 않음 | `createFetchGate({ ..., maxRequests: 8 })` 로 소규모 시나리오를 명시적으로 오버라이드하거나, 반복 횟수를 18/19 로 조정. 신규 N10 이 새 기본값(18) 자체를 별도로 커버하므로 기존 #14 는 오버라이드 방식 권장(작은 diff). |
| 18c | `assert.ok(row.requestCount <= 8, ...)` | 리다이렉트 4-hop 추종 + robots(위치 이동, 횟수는 그대로 1) + sitemap 신규 fetch(+1) 로 실제 소모 요청 수가 늘어남(픽스처 자체는 sitemap 404 라 여전히 적지만 8 은 더 이상 의미있는 상한이 아님) | `<= 18` 로 완화하거나, 픽스처 기준 실제 도달 값(예: `<= 10`)으로 더 타이트하게 재계산해 하드코딩. 8 이라는 숫자 자체를 새 기본값(18)과 무관한 임의값으로 남기지 않는다. |
| 18d | `redirect_loop_or_double_stub` 트리거(현재 2단 스텁으로 유발) | 이제 4-hop 까지 추종하므로 2단 스텁은 3번째 hop 에서 미매핑 URL(404) 을 만나 `NOT_NARA_CMS`(`home_fetch_failed`) 로 끝나 버려 원래 의도(redirect loop)를 더 이상 재현하지 않음 | fx.map 에 hop2/hop3 까지 전부 스텁 응답을 추가해 진짜 5단 이상 스텁 체인을 만들고(N15 와 동일 취지), `redirect_loop_or_double_stub` 를 그 지점에서 재확인하도록 재작성. |

기존 통과 테스트 중 위 3건 외(1-13, 15-21)는 로직 변경 없이 그대로 통과해야
한다(특히 #4 detectNaraCms, #13 runPreflight, #18/18b `PACKET_CREATED`/dry-run
경로 — Incheon 픽스처는 sitemap 미스텁 -> 404 -> nav 폴백으로 기존과 동일한
`inu-press-release`/boardId 2594 결과에 도달해야 함).

---

# 검증 계획

```powershell
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.js"
node --check "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
node --test "D:\hhg(code)\server\agent\onboarding\tools\discover-nara-cms-batch.test.js"
npm test
```

실측(네트워크 가능 시): 완료 기준 1/2/2-보조 커맨드 그대로. 실측 불가 시 N7/N14/N15/
N16 통합 테스트 로그를 대체 증거로 첨부하고 "실측 network-blocked" 명시(기존 spec.md
관례와 동일).

---

# 범위 밖 (다음)

비-Nara CMS 발굴, 캠퍼스명 매칭 완화, B3 자동 서명, 스케줄 자동화, robots 전면차단을
board 확정 이전으로 앞당기는 최적화(예외 상황 표 참고), `--catalog-file` 등 신규
CLI 표면 추가.
