# 테스트 요약 (F1/F2 수정 라운드 재검증)

Coder 가 F1(클라이언트측 리다이렉트 추적)·F2(`detectNaraCms` 호스트 교차검증)를
수정했다. 재검증 결과:

- **F1: 해결됨.** 홈 fetch 후 meta-refresh / `location.*` 스텁을 1회 따라가고
  `homeResolvedUrl` 을 기록한다. 이전 라운드에 전부 `NOT_NARA_CMS(no_nara_pattern)`
  로 끝나던 kongju·gwnu·inu·donga·gangseo 등이 이제 실제 홈으로 넘어가
  Nara 탐지·게시판 발견까지 도달한다. Phase 1 큐 117곳 전수 스캔에서
  `DIAGNOSE_FAILED` 가 1 → 16 으로 늘었다(= 더 깊은 단계까지 진입).
- **F2: 해결됨.** `www.daegu.ac.kr` 홈이 `lib.daegu.ac.kr/bbs/` 링크를 포함해도
  `detectNaraCms` 가 이제 `isNara:false` (cross-host `/bbs/` 증거 불인정). 라이브
  확인 + 단위 테스트 #4 확장 커버.
- **오프라인 검증: 전부 통과.** targeted 25/25, `npm test` 334/334 (2회 결정적),
  회귀 0 (309 + 25 = 334).
- **`.gitignore`: 정상.** `.gitkeep` stageable, 런 리포트/상태 JSON 무시,
  `reports/source-247/` 회귀 없음.
- **부수효과 억제: 통과.** 약 10회 실행(비-dry 5회 포함) 후 catalog / candidates /
  agent-news-store / preview SHA1 전부 불변. `catalog-prepare-log.json` mtime
  불변(B1 미실행). review-packet 0개. 백업 0개. mutation 플래그 전부 false.

**남은 caveat (완료 기준 1건 미달):**
실측 라이브 `PACKET_CREATED` end-to-end 를 **여전히 시연하지 못했다**. 단,
이번에는 원인이 도구 결함이 아니라 **데이터 소진**이다. 필터 통과 117곳을 전수
돌렸으나 패킷 0건 — Nara Info CMS 의 `rssList.do` 가 거의 모든 대학에서
비활성(`"This board unsupportable RSS function"`)이기 때문이다(kongju·sungshin·
seowon·shinhan 등 확인). 인천대 선례가 통한 건 inu 가 RSS 를 켜둔 예외적 케이스
(지금도 `https://www.inu.ac.kr/bbs/inu/2594/rssList.do` 가 실아이템 40개 반환 —
직접 확인). 대체 증거: 통합 테스트 #18c(리다이렉트 스텁 → `PACKET_CREATED`) +
#18 + #18d, 그리고 살아있는 inu 피드.

전체 평가: **PASS-WITH-CAVEATS.** F1·F2 는 해결. 오프라인·부수효과·`.gitignore`
전부 녹색. 그러나 이 도구의 **Phase 1 큐 실측 산출량이 0건**이며, 그 원인
(대학들이 Nara RSS 를 꺼둠)은 코드로 못 고치는 외부 요인이다. Reviewer 가
도구의 실효성(RSS 외 수집 경로 / 대학당 복수 게시판 시도 / JS 네비 처리)을
다음 라운드 범위로 판단할 필요가 있다.

---

# 완료 기준 (spec.md L477-494)

- `node --check discover-nara-cms-batch.js`: **통과**
- `node --check discover-nara-cms-batch.test.js`: **통과**
- `node --test discover-nara-cms-batch.test.js` 전부 통과: **통과** (25 pass / 0 fail)
- `npm test` 기존 309 + 신규 25, 회귀 0: **통과** (334 pass / 0 fail, 2회 실행 동일)
- 실측 시연 1 — 인천대 아닌 Nara 대학 1곳 rssUrl 발견 → preflight 통과 → B1 → B2 `PACKET_CREATED`, review-packet 파일 1개:
  **미달 (N-A: 데이터 소진)**. 필터 통과 117곳 전수 스캔 → PACKET_CREATED 0건.
  코드 결함 아님(모두 올바르게 `DIAGNOSE_FAILED`/`ROBOTS_BLOCKED`/`NOT_NARA_CMS`
  분류). 대체 증거: 통합 테스트 #18c + 확인된 inu 실피드. **라이브 B1/B2
  경로는 end-to-end 로 실행되지 않았음을 명시.**
- 실측 시연 2 — 실패 대학 1건 이상 분류·리포트 기록: **통과**
  (117곳 스캔: `NOT_NARA_CMS` 92, `DIAGNOSE_FAILED` 16, `ERROR` 4,
  `SOURCE_ALREADY_EXISTS` 3, `ROBOTS_BLOCKED` 2 — 전부 리포트·상태파일 기록)
- `--limit=10 --dry-run` — 상태파일+리포트 생성, 카탈로그 diff 0: **통과**
  (`--limit=10` 비-dry 도 실행: `regressionEvidence` = npm test 334 pass 수집,
  catalog/candidates/store/preview SHA1 불변, mutation 플래그 전부 false.
  "B1 통과분 최소 diff" 는 통과분 0곳이라 자명하게 diff 0 — B1 삽입 경로 라이브 미검증)
- 단위 테스트 — 후보 필터 / Nara 탐지 / boardId 추출 / robots path 판정 / 리포트 집계 / 상태·resume, 픽스처 기반 오프라인: **통과** (25 test)
- 산출물이 candidates append + B1 enabled:false + B2 review-packet 로 국한, `enabled:true`/store/preview/git/deploy 변경 0: **통과**
  (전 실행 후 4개 파일 SHA1 불변, mutation 플래그 전부 false. 단 B1/B2 자체가
  라이브에서 한 번도 트리거되지 않아 "통과분 처리" 쓰기 경로는 test #18 주입
  스텁으로만 커버.)
- git push / 배포 미실행: **통과**

---

# F1 / F2 해결 여부

## F1 (홈 fetch 클라이언트 리다이렉트 무시) — **해결됨**

증거:
- 신규 export 헬퍼 `extractClientRedirect(html, baseUrl)` — 단위 테스트 #4b 통과
  (meta-refresh `url=` 유/무·따옴표 유/무·포트정규화, `location.href/replace`,
  순수 지연 → null, 두꺼운 실콘텐츠 → null).
- `processUniversity` 라이브 동작 확인:

| university | homeResolvedUrl | 결과 |
| --- | --- | --- |
| kongju-national-university-본교 | `https://www.kongju.ac.kr/KNU/index.do` | Nara 탐지 O, board `KNU/2134` 발견, rssUrl 생성 → `DIAGNOSE_FAILED(rss_invalid: 그 게시판 RSS 비활성)` |
| gangneung-wonju-national-university-본교 | `https://new.gwnu.ac.kr/sites/kr/index.do` | Nara 탐지 O, board `kr/1613` 발견 → `DIAGNOSE_FAILED(preflight: budget + name mismatch)` |
| donga-university-seunghak | `https://www.donga.ac.kr/kor/Main.do` | 리다이렉트 추적 O → `NOT_NARA_CMS` (실제 비-Nara) |
| gangseo-university-본교 | `https://gangseo.ac.kr/kcua/mainService` | 리다이렉트 추적 O → `NOT_NARA_CMS` |
| incheon-national-university-본교 | (n/a) | `SOURCE_ALREADY_EXISTS` (네트워크 0 — 카탈로그 사전 차단) |

- 이전 라운드: 이 대학들 전부 `NOT_NARA_CMS(no_nara_pattern)` req=1. 지금은
  실제 홈까지 도달.
- `--limit=117 --dry-run` 전수: `DIAGNOSE_FAILED` 1→16, `no_nara_pattern` 로만
  끝나는 비율 대폭 감소.

**잔여 한계 (블로커 아님, 문서화 권고):**
`extractClientRedirect` 의 보수적 게이트는 JS 리다이렉트를
"본문 <400자 + `<a>` ≤3개" 인 얇은 스텁일 때만 신뢰한다. `www.hanbat.ac.kr`
처럼 `<script>location.href='/kor.do'</script>` 를 두되 인트로 슬라이드로 본문이
두꺼운 "살찐 스플래시" 페이지는 따라가지 않아 `NOT_NARA_CMS(no_nara_pattern)`
로 끝난다(req=1). (hanbat 은 어차피 eGov `/bbs/BBSMSTR_...` CMS 라 Nara 아님 —
이 케이스에서는 손실 없음. 하지만 동형 스플래시를 쓰는 진짜 Nara 대학은
놓칠 수 있음.) meta-refresh 쪽도 `본문≥600자 && <a>≥5개` 면 무시.

## F2 (`detectNaraCms` 호스트 교차검증 느슨) — **해결됨**

라이브 확인:
```
daegu 홈 resolved=https://www.daegu.ac.kr/main
  contains lib.daegu.ac.kr/bbs/ : true
  detectNaraCms.isNara : false   (evidence: [])
```
`--limit=40 --dry-run` 에서도 `daegu-university-본교 → NOT_NARA_CMS(no_nara_pattern)`
(이전 라운드엔 이 지점이 false-positive Nara 였음).
단위 테스트 #4 가 cross-host `/bbs/` → `isNara:false`, same-host(절대/상대)
→ `isNara:true` 를 커버.
> 참고: Coder 는 Tester 가 요구한 "equals or subdomain-of" 대신 "exact host
> (www 정규화)" 로 더 좁혔다. `lib.daegu.ac.kr` 이 `daegu.ac.kr` 의 서브도메인
> 이라 subdomain 허용 시 여전히 통과하기 때문. 타당하며 요구사항 충족.

---

# 실패한 / 미달한 항목

## C1 (완료 기준 미달, 데이터 소진) — 라이브 `PACKET_CREATED` 미시연

`--limit=117 --dry-run` (report `fullscan2.json`) 요약:
```
processed 117 | packetsCreated 0 | notNaraCms 92 | diagnoseFailed 16
              | robotsBlocked 2 | sourceAlreadyExists 3 | error 4
```

board 발견 + rssUrl 생성까지 도달했으나 RSS 단계에서 실패한 Nara 대학들:

| university | rssUrl | 실패 이유 |
| --- | --- | --- |
| kongju-national-university-본교 (+ cheonan, yesan) | `.../bbs/KNU/2134/rssList.do` | `rss_invalid: items<2 (got 0)` — 응답이 `"This board unsupportable RSS function"` |
| sungshin-womens-university-본교 | `.../bbs/main_kor/3192/rssList.do` | 동일 (해당 대학 **전 게시판** RSS 비활성 — 3181/4006/14091 직접 확인) |
| seowon-university-본교 | `.../bbs/seowon/405/rssList.do` | 동일 |
| shinhan-university (본교 + 제2캠퍼) | `.../bbs/kr/191/rssList.do` | 동일 |
| hyupsung-university-본교 | `.../bbs/uhs/4/rssList.do` | `rss_fetch_failed: XML 아닌 응답` |
| gangneung-wonju (본교 + 제2캠퍼) | `.../bbs/kr/1613/rssList.do` | `preflight_failed acceptedCount=0/2 [university_name_mismatch, detail_fetch_failed:request_budget_exceeded]` |

**근본 원인**: Nara Info CMS 의 `rssList.do` 엔드포인트가 기본 비활성이고 대부분의
대학이 켜두지 않는다. 도구는 이를 정확히 `DIAGNOSE_FAILED` 로 분류한다(코드
정상). 완료 기준의 "인천대 아닌 새 Nara 대학 1곳 PACKET_CREATED" 를 충족할
대학이 현재 Phase 1 큐 안에 존재하지 않는다.

**해피패스가 실데이터로 도달 가능하다는 정황 증거**: `inu` 를 카탈로그에서
빼고 돌린다고 가정하면 — `www.inu.ac.kr` 은 meta-refresh 스텁 → F1 이 
`https://www.inu.ac.kr/inu/index.do` 로 따라가 Nara 탐지 O, nav 5개, 그리고
`https://www.inu.ac.kr/bbs/inu/2594/rssList.do` 가 **지금도 실아이템 40개**
(제목·링크·pubDate 완비)를 반환한다. 즉 RSS 만 켜져 있으면 파이프가 끝까지 간다.

## C2 (관찰됨, 요청 예산) — `maxRequests=8` 이 preflight 상세 fetch 를 조인 사례

`gangneung-wonju` (본교/제2캠퍼): `requestCount=8`, preflight 중
`detail_fetch_failed:request_budget_exceeded`. 시퀀스 추정:
홈(1) + 리다이렉트(1) + subview 크롤(3) + robots(1) + rss(1) = 7 → 상세 1개만
받고 8 도달 → 예산 초과.
**단, 이 대학은 `university_name_mismatch` 도 함께 떠서 예산을 늘려도
PACKET_CREATED 가 보장되지 않는다.** 이번 검증에서 **오직 예산 때문에 막힌
PACKET_CREATED 는 없었다**(모든 예산-초과 케이스가 다른 실패도 동반).
→ Reviewer 판단: `maxRequests` 를 10 으로 올릴지. 현재는 spec "대학당 최대 ~8"
(틸드) 범위 내이고 graceful degradation(부분 실패 → 다음 라운드 재시도) 확인됨.

## C3 (관찰됨, 외부 요인) — `ERROR` 4건은 전부 실네트워크 실패

| university | reason | 실측 |
| --- | --- | --- |
| korea-national-university-of-transportation-본교 | `home_fetch_error` | `www.ut.ac.kr` 간헐적 `fetch failed` (재시도 시 200/132KB 정상) |
| knut-jeungpyeong-campus / knut-uiwang-campus | `home_fetch_error` | 동일 host, 동일 간헐 실패 |
| daejin-university-본교 | `home_redirect_fetch_error` | 리다이렉트 타겟 `www.daejin.ac.kr/gopage.jsp` 자체가 `fetch failed` (서버측) |

도구가 크래시 없이 `ERROR` 로 분류, 부분 쓰기 없음. `--resume` 재시도 대상 —
`--resume --limit=5 --dry-run` 실행 시 정확히 이 4건만 재처리됨(나머지 113건
스킵) 확인.

---

# 재현 방법

## 오프라인 (전부 통과)
```
cd "D:\hhg(code)"
node --check server/agent/onboarding/tools/discover-nara-cms-batch.js       # OK
node --check server/agent/onboarding/tools/discover-nara-cms-batch.test.js   # OK
node --test  server/agent/onboarding/tools/discover-nara-cms-batch.test.js   # 25 pass / 0 fail
npm test                                                                     # 334 pass / 0 fail (2회 동일)
```

## `.gitignore` sanity (전부 정상)
```
git add -A --dry-run | grep gitkeep
#  -> add 'server/agent/onboarding/reports/nara-cms-batch/.gitkeep'
git check-ignore -v server/agent/onboarding/reports/nara-cms-batch/zzz.json           # 무시됨 (L42)
git check-ignore -v server/agent/onboarding/reports/source-247/foo.json               # 무시됨 (L34)
git check-ignore -v server/agent/onboarding/data/nara-cms-batch-state.json[.bak]      # 무시됨 (L44)
git status --porcelain -u | grep nara   # .gitkeep + .js + .test.js 3개만. 런 리포트/상태 JSON 안 뜸.
```

## F1 재현
```
node server/agent/onboarding/tools/discover-nara-cms-batch.js --university-id=kongju-national-university-본교
#  -> DIAGNOSE_FAILED, homeResolvedUrl="https://www.kongju.ac.kr/KNU/index.do",
#     rssUrl="https://www.kongju.ac.kr/bbs/KNU/2134/rssList.do", reason="rss_invalid:items<2 (got 0)"
node server/agent/onboarding/tools/discover-nara-cms-batch.js --university-id=incheon-national-university-본교
#  -> SOURCE_ALREADY_EXISTS (requestCount=0)
node server/agent/onboarding/tools/discover-nara-cms-batch.js --limit=10 --dry-run     # state+report, catalog diff 0
node server/agent/onboarding/tools/discover-nara-cms-batch.js --limit=10               # regressionEvidence=npm test 334 pass, mutation 전부 false
```
```
# 리다이렉트 스텁 원문
node -e "fetch('https://www.kongju.ac.kr/').then(r=>r.text()).then(console.log)"   # <script>location.href="/KNU/index.do"</script>
node -e "fetch('https://www.inu.ac.kr/').then(r=>r.text()).then(console.log)"      # <meta http-equiv="refresh" content="0;url=.../inu/index.do">
# inu 피드는 살아있음
node -e "fetch('https://www.inu.ac.kr/bbs/inu/2594/rssList.do').then(r=>r.text()).then(t=>console.log((t.match(/<item>/g)||[]).length))"   # 40
```

## F2 재현
```
node -e "const m=require('./server/agent/onboarding/tools/discover-nara-cms-batch.js');fetch('https://www.daegu.ac.kr/').then(r=>r.text()).then(t=>console.log(m.detectNaraCms(t,{host:'www.daegu.ac.kr'})))"
#  -> { isNara: false, evidence: [], host: 'www.daegu.ac.kr' }   (lib.daegu.ac.kr/bbs/ 링크 있어도)
```

## C1 전수 스캔 재현
```
node server/agent/onboarding/tools/discover-nara-cms-batch.js --limit=117 --dry-run --run-id=fullscan2
#  -> processed=117 packets=0  (report: server/agent/onboarding/reports/nara-cms-batch/fullscan2.json)
node -e "fetch('https://www.sungshin.ac.kr/bbs/main_kor/3181/rssList.do').then(r=>r.text()).then(t=>console.log(t.slice(0,200)))"
#  -> "...This board unsupportable RSS function..."
```

---

# 위험 요소

1. **[높음 → 제품 판단 필요] 도구의 Phase 1 큐 실측 산출량 = 0건.** 코드 결함이
   아니라 대학들이 Nara `rssList.do` 를 꺼둔 탓. 인천대 1건(RSS 켜짐)이 예외.
   Reviewer/사용자 결정 필요: (a) RSS 외 수집 경로(artclList HTML 파싱),
   (b) 대학당 첫 게시판 말고 복수 게시판 RSS 시도, (c) JS 렌더 네비 처리
   — 어느 것을 다음 라운드로 잡을지. 현 상태로는 "게이트 패킷 생성" 목적이
   실데이터에서 달성되지 않는다.
2. **[중] 라이브 B1/B2 쓰기 경로 미검증.** preflight 통과 대학이 0곳이라
   `appendCandidateAtomic` → `prepareCatalogSourceBlock`(B1) →
   `buildReviewPacketFromDiagnose`(B2) 실호출이 이번에도 0회. 카탈로그
   `enabled:false` 삽입 diff, review-packet 파일 생성, `DIAGNOSE_FAILED_POST_B1`
   무롤백 동작은 전부 test #18 주입 스텁으로만 커버. `regressionEvidence`
   (npm test) 수집 → 리포트 기록 경로만 라이브 확인됨.
3. **[중] `extractClientRedirect` 보수 게이트의 false negative.** "살찐 스플래시"
   (JS 리다이렉트 + 두꺼운 인트로 본문)를 안 따라간다. hanbat 에서 관찰(hanbat 은
   Nara 아니라 무해했음). 동형 스플래시를 쓰는 진짜 Nara 대학이 있으면
   `NOT_NARA_CMS` 로 조용히 누락된다. Reviewer: 실제 누락 사례가 나오면
   게이트 임계값(400자/3링크) 재조정 검토.
4. **[낮음] 요청 예산 8.** 리다이렉트 hop + subview 크롤 + 상세 3개가 겹치면
   상세 검증이 빡빡(gwnu 관찰, req=8). 이번엔 예산만으로 막힌 패킷 없음.
   `maxRequests` 상향은 Reviewer 판단.
5. **[낮음] `changwon`·`chungbuk`·`pusan` 등 국립대가 `no_nara_pattern`.**
   실제로는 Nara 를 쓰지만 홈 raw HTML 에 `/subview.do`·same-host `/bbs/`
   링크가 없음(네비가 완전 JS 렌더 or 다른 진입 URL). F1 로도 못 잡는
   더 깊은 한계 — 위험요소 1과 연결.
6. **[낮음] 환경 HEAD.** 세션 시작 컨텍스트의 "Recent commits"(b35ba69…)와
   실제 `git log`(HEAD=7531f6e "인천대학교 활성화")가 다르다. npm test
   베이스라인 309 는 현재 트리로 재현됨(309+25=334)이라 검증엔 영향 없음.

---

# 라이브 런이 생성/변경한 것 (전부 gitignore — 되돌리지 않음, 그대로 둠)

이번 라운드 실행 목록:
- 비-dry 단건 4회: kongju, gangneung-wonju(본교), hanbat, incheon(본교)
- 비-dry `--limit=10` 1회 (run-id `live10`)
- dry 단건/소limit 다수 (run-id `probe` 재사용, `scan40`, `resumetest`)
- dry `--limit=117` 2회 (`fullscan` nohup + `fullscan2`)

생성/갱신 파일 (전부 `.gitignore`, `git status -u` 에 안 나타남):
- `server/agent/onboarding/reports/nara-cms-batch/*.json` — 이번 라운드 추가:
  `20260831T132824/132845/132851/132853/132944.json`, `probe.json`, `scan40.json`,
  `fullscan.json`, `fullscan2.json`, `live10.json`, `resumetest.json`
  (이전 라운드분 `20260831T1312*` / `131346` 도 잔존)
- `server/agent/onboarding/data/nara-cms-batch-state.json` (+ `.json.bak`)
  — `processed[]` 117건 누적, version 1, 원자적 쓰기(backup→tmp→parse→rename) 확인

변경 **안 된** 것 (baseline SHA1 대비 불변, 라이브 런 전 과정 확인):
- `development/university-news/data/university-news-sources.final.json`  7cb1617…
- `server/agent/onboarding/data/collector-config-candidates.json`        6f7cb40…
- `server/agent/data/agent-news-store.json`                              051eabc…
- `data/university-news-preview.json`                                    ce55c77…
- `server/agent/onboarding/data/catalog-prepare-log.json`  (mtime 08-31 10:21, 라운드 전 — B1 미실행)
- `server/agent/onboarding/backups/`  (새 백업 없음)
- `server/agent/gate/review-packets/`  (새 패킷 없음)

`git diff --stat -- development/university-news/data/university-news-sources.final.json` → **빈 출력**.

`git status --porcelain -u` 최종:
```
 M .gitignore
 M .pipeline/changes.md
 M .pipeline/spec.md
 M .pipeline/test-results.md
?? server/agent/onboarding/reports/nara-cms-batch/.gitkeep
?? server/agent/onboarding/tools/discover-nara-cms-batch.js
?? server/agent/onboarding/tools/discover-nara-cms-batch.test.js
```
= 예상된 코드 산출물 3개(.gitkeep, .js, .test.js) + `.gitignore` + 파이프라인 문서.
예상 밖 변경 없음.

---

# 최종 테스트 상태

**PASS-WITH-CAVEATS**

- **F1 해결, F2 해결.** 클라이언트 리다이렉트 추적으로 kongju·gwnu·inu·donga 등이
  실제 홈까지 도달하고, cross-host `/bbs/` 오탐이 사라졌다.
- 오프라인 검증(node --check ×2, node --test 25/25, npm test 334/334 ×2, 회귀 0),
  `.gitignore` 동작, 부수효과 억제(store/preview/enabled:true/git/deploy 변경 0,
  mutation 플래그 전부 false), 실패 대학 분류·리포트·상태·`--resume`: **전부 통과.**
- **완료 기준 "실측 시연 1 — 라이브 PACKET_CREATED + review-packet 1개" 는
  이번에도 미달**. 그러나 원인이 도구 결함에서 **데이터 소진**으로 바뀌었다:
  Phase 1 큐 117곳 전수 스캔에서 board·rssUrl 까지 도달한 Nara 대학들이
  전부 `rssList.do` 비활성으로 실패. 대체 증거 = 통합 테스트 #18c/#18/#18d +
  살아있는 inu 피드(40 items). **라이브 B1/B2 쓰기 경로는 end-to-end 로
  실행되지 않았음을 명시.**
- 권고: Reviewer/사용자가 이 도구의 실효성을 결정 — 현 형태로는 Phase 1
  큐에서 게이트 패킷 0건. RSS 외 수집 경로 또는 복수 게시판 시도를 다음
  라운드 범위로 검토. F1 보수 게이트의 살찐-스플래시 누락(위험요소 3)과
  요청 예산 8(위험요소 4)도 함께 판단.
- 코드는 수정하지 않음. 커밋/푸시 없음.
