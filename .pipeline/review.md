# 검토 요약

`discover-nara-cms-batch` (`/ship` 최종 검토).

- 대상: `server/agent/onboarding/tools/discover-nara-cms-batch.js` (신규),
  `discover-nara-cms-batch.test.js` (신규), `reports/nara-cms-batch/.gitkeep` (신규),
  `.gitignore` (수정).
- Reviewer 재검증: `node --check` 2건 통과, 타깃 테스트 25/25 통과,
  `npm test` **334 pass / 0 fail** (직접 실행 확인), 회귀 0.
- `git status`: 코드 3파일 + `.gitignore` + `.pipeline/*` 문서만. 예상 밖 변경 없음.
- 재사용 모듈(`rss-collector.js`, `run-single-school-trial.js`,
  `prepare-catalog-source-block.js`, `build-review-packet-from-diagnose.js`,
  screening 모듈) **git diff 완전 무변경** — import 만 함.
- F1(클라이언트 리다이렉트 추적)·F2(`detectNaraCms` host 교차검증) 코드 확인 결과
  실제로 수정됨.

판정: **승인**. 단, 아래 잔여 위험(중 1건)을 다음 라운드에서 다룰 것.

---

# 요구사항 확인

## 사용자 최초 요구사항

Nara Info CMS 대학을 자동 선별 → 뉴스/공지 게시판 RSS 발견·검증 → **활성화 없이**
게이트 패킷(B1 카탈로그 enabled:false 삽입 + B2 review-packet) 생성하는 배치 도구.
→ 구현됨. "만들 것 1~9" 전부 코드에 존재(선정 필터, Nara 탐지, boardId 추출,
RSS 검증, robots path 판정, 메모리 내 preflight, candidates append + B1 + B2,
리포트, 상태파일/`--resume`).

## spec.md 완료 기준 체크리스트 (L477-494)

| 기준 | 결과 |
| --- | --- |
| `node --check` (도구) | 통과 (재확인) |
| `node --check` (테스트) | 통과 (재확인) |
| `node --test` 도구 테스트 전부 통과 | 통과 — 25/25 |
| `npm test` 기존 309 + 신규, 회귀 0 | 통과 — 334 pass / 0 fail (Reviewer 직접 실행) |
| 실측 시연 1 — 라이브 `PACKET_CREATED` + review-packet 1개 | **N/A — 외부요인(Nara `rssList.do` 가 inu 외 전 대학 비활성), 사용자 수용, 통합 테스트 #18c 로 커버** |
| 실측 시연 2 — 실패 대학 1건+ 분류·리포트 | 통과 — 117곳 스캔에서 NOT_NARA_CMS/DIAGNOSE_FAILED/ROBOTS_BLOCKED/ERROR/SOURCE_ALREADY_EXISTS 분류·기록 |
| `--limit=10 --dry-run` — 상태·리포트 생성, 카탈로그 diff 0 | 통과 (dry 시 카탈로그 4파일 SHA1 불변, mutation 전부 false) |
| 단위 테스트 — 필터/탐지/boardId/robots/집계/상태·resume, 오프라인 | 통과 — 25 test, 완전 오프라인(fetch/now/random/sleep 주입) |
| 산출물이 candidates append + B1 enabled:false + B2 로 국한, enabled:true/store/preview/git/deploy 0 | 통과 (코드 경로 확인 + 라이브 SHA1 불변) |
| git push / 배포 미실행 | 통과 |

## 제약(AGENTS.md) 준수

- **§1 스코프**: "UNI PICK work → Source activation and source-quality tools"
  안. 읽기 전용 발굴 + 게이트 패킷. 범위 내.
- **§3**: 활성화/수집/프리뷰/배포가 별도 게이트로 분리 유지됨. 도구는 B1/B2
  게이트 앞단까지만.
- **§4**: 코더 핸드오프(changes.md)에 파일 경로·검증 결과 기재. Reviewer 재검증 완료.
- **§5**: `node --check` + 타깃 테스트 + `npm test` 전부 실행·통과.
- **§6**: 런 리포트/상태/백업을 `.gitignore` 로 소스 밖에 둠. `.gitkeep` 만 추적.

---

# 테스트 결과

- 오프라인: `node --check` ×2 통과. `node --test discover-nara-cms-batch.test.js`
  → **25 pass / 0 fail**. `npm test` → **334 pass / 0 fail** (Reviewer 직접 실행,
  test-results.md 의 334 와 일치).
- 회귀: 309 → 334 (+25 신규). 인접 스위트(prepare-catalog-source-block,
  build-review-packet-from-diagnose) 무변경·통과.
- 테스트 품질:
  - spec "테스트 계획" 표 20개 항목 + F1/F2 확장(#4 cross-host, #4b
    `extractClientRedirect`, #18c/#18d 리다이렉트 통합) 커버.
  - 헬퍼는 픽스처 + 주입(fetch=Map 스텁, now/random/sleep 고정)으로 오프라인 검증.
  - **#18c 는 `runBatch` 의 실제 `PACKET_CREATED` 쓰기 경로 통합 테스트**:
    루트 URL 이 meta-refresh+JS 스텁 → 1-hop 추적 → Nara 탐지 → 게시판 발견 →
    preflight 통과 → `appendCandidateAtomic` 실행 → `b1Impl` 1회(`sourceId`
    정확) → `b2Impl` 1회(`skipNpmTest:true` + 동일 `regressionEvidence`) →
    `PACKET_CREATED` + `homeResolvedUrl` 기록 + `requestCount <= 8`. B1/B2
    **내부**는 스텁이지만 오케스트레이션·후보파일·리포트·상태 쓰기는 실제 실행.
- 라이브: Phase 1 큐 117곳 전수 dry 스캔 → 패킷 0건. 원인은 코드 결함이 아니라
  Nara `rssList.do` 가 대학들에서 꺼져 있음(`"This board unsupportable RSS
  function"`). 도구는 이를 정확히 `DIAGNOSE_FAILED(rss_invalid)` 로 분류.
  살아있는 `inu` 피드(40 items)가 해피패스의 정황 증거.

---

# 문제점

## 명백한 오류 / 안전 문제

없음. 구체적으로 확인한 것:

1. **부수효과 억제 (코드 경로 확인, 리포트 신뢰 아님)**
   - `buildCandidateSource` 가 `enabled:false`, `verified:false`,
     `status:"collector_config_candidate"` 를 **하드코딩**. enabled:true 생성 경로 없음.
   - `agent-news-store.json` / `university-news-preview.json` / `git` / `deploy` /
     `exec`·`spawn` **참조 0건** (grep 확인). npm test 서브프로세스는 재사용 모듈
     `build-review-packet-from-diagnose.js` 안에서만, 증거 수집 목적.
   - 카탈로그 쓰기는 `b1Impl`(기본 `prepareCatalogSourceBlock`) 경유만. 도구가
     `catalogFile` 을 직접 write 하는 코드 없음. `PACKET_CREATED`/
     `DIAGNOSE_FAILED_POST_B1` 후 `catalogFile` 을 다시 **읽기**만 함(메모리 갱신).
   - `--dry-run`: `processUniversity` 가 실쓰기 블록 이전에
     `PACKET_CREATED_DRYRUN` 으로 조기 반환(L1184). `appendCandidateAtomic`/b1/b2
     호출 0회. `regressionEvidence`(npm test)도 수집 안 함. 리포트/상태만 기록.
     테스트 #18b 로 검증.
2. **재사용 모듈 무수정**: `git diff` 상 `rss-collector.js`,
   `run-single-school-trial.js`, `prepare-catalog-source-block.js`,
   `build-review-packet-from-diagnose.js`, `robots-group-parser.js`,
   `screen-selector-required-sources.js` 전부 변경 없음.
3. **B2 배치 사용**: `collectRegressionEvidence` 는 `runBatch` 에서 루프 이전
   **1회만** 호출(L1313), `!dryRun && !regressionEvidence && selected.length`
   가드. 실패 감지(`/\bfail\s+[1-9]/`) 시 candidates/B1/B2 이전에 throw.
   각 `b2Impl` 호출에 `skipNpmTest:true` + 공용 `regressionEvidence` 전달(L1234).
4. **F1 `extractClientRedirect`**: 보수적.
   - meta-refresh 는 브라우저 지시라 신뢰하되 `본문≥600자 && <a>≥5개` 면 무시.
   - JS `location.*` 는 `본문<400자 && <a>≤3개` 얇은 스텁일 때만 신뢰.
   - `safeOrigin(redirectTarget)` 로 파싱 가능한 목적지만 추적.
   - **1-hop 한정**: 따라간 페이지가 또 스텁이면
     `NOT_NARA_CMS(redirect_loop_or_double_stub)`.
   - host/origin 은 따라간 최종 URL(`finalHomeUrl`) 기준으로 재계산(L1036,
     L1049-1050). 오탐으로 엉뚱한 페이지에 갈 위험 낮음.
5. **F2 same-host 체크**: `sameUniversityHost` 가 `www.` 정규화 후 **정확히
   일치**만 인정. `lib.daegu.ac.kr` 같은 형제 서브도메인 탈락. 상대 경로 href 는
   같은 host 로 간주. 근거 타당(Nara `/bbs/` 는 메인 host 서빙, 우리가 만드는
   rssUrl 도 해결된 홈 host 기준이므로 다른 host 증거는 어차피 잘못된 rssUrl).
6. **`DIAGNOSE_FAILED_POST_B1` 무롤백** (사용자 Q8 승인): B1 통과 후 B2 실패 시
   candidates + 카탈로그 항목을 남기고 `finalDecision` + `b2Reasons` 로 리포트
   기록. 남는 카탈로그 항목은 `enabled:false / verified:false /
   status:"collector_config_candidate"` — inert. spec §B/§J·changes.md 에 명기됨.
7. **`.gitignore`**: `git check-ignore` 로 확인 —
   `.gitkeep` 추적 가능 / 런 `*.json` 무시 / `reports/source-247/foo.json` 여전히
   무시(회귀 없음) / `nara-cms-batch-state.json(.bak)` 무시. `reports/` →
   `reports/*` 변경 근거 정확: 디렉터리 통짜 무시(`reports/`)는 중첩 negation 으로
   재포함 불가하므로 `reports/*` 로 바꿔야 `!.../nara-cms-batch/` 가 먹힌다.
   현재 `reports/` 하위에 추적 중인 파일 없음(`git ls-files` 빈 결과) → 무해.
   신규 추적 대상은 `.gitkeep` 하나뿐(`git status` 확인).

## 요청하지 않은 변경

없음. `.pipeline/spec.md` 의 modified 표시는 Planner 산출물로 이번 코드 커밋과
분리. 그 외 전부 spec 범위 내.

## 개선 권고 (비차단)

- **요청 예산**: `maxRequests=8` 유지. 최악(리다이렉트 hop + subview 크롤 3 +
  상세 3 = 10) 초과 시 `runPreflight` 의 per-item catch 가 `detail_fetch_failed`
  로 처리(B1 이전, 부분 쓰기 없음). **그러나** 그 결과가
  `DIAGNOSE_FAILED`(종결 결정)이면 `--resume` 재시도 대상이 아니다
  (resume 은 `ERROR` 만 재처리). 예산 때문에만 막힌 대학이 영구 오분류될 수 있음.
  → 권고: `maxRequests` 를 10 으로 상향(전부 B1 이전이라 안전) **또는** 예산
  소진을 `DIAGNOSE_FAILED` 가 아닌 `ERROR` 로 반환. 현재 라이브 산출 0건이라
  머지 조건은 아님. 다음 라운드.
- 리포트 `mutation` 플래그가 B1 카탈로그 삽입 시에도 전부 `false`. spec §H
  정의(= "위험 변형 안 함")에는 부합하나, "아무것도 안 씀"으로 오독될 수 있음.
  향후 `catalogCandidateInserted` 같은 별도 불리언 추가 검토.
- `location=...` 정규식이 얇은 스텁 한정이지만 `mylocation="..."` 부분 매칭
  가능성 이론상 존재(본문<400자·링크≤3 게이트로 확률 낮음).

---

# 최종 판정

승인

---

# 판정 이유

- **필수 조건 충족**: `node --check` ×2, 타깃 테스트 25/25, `npm test`
  334/334(회귀 0), 오프라인 단위/통합 테스트, `--dry-run` 무쓰기, git/deploy
  미실행 — 전부 Reviewer 가 직접 재확인.
- **안전성**: 부수효과 억제를 리포트가 아니라 **코드 경로**로 확인했다.
  enabled:false 하드코딩, store/preview/git/deploy 참조 없음, 카탈로그는 B1
  경유만, `--dry-run` 은 실쓰기 블록 이전 조기 반환. 재사용 모듈은 `git diff`
  상 완전 무변경.
- **F1/F2 진짜 수정됨**: `extractClientRedirect`(보수적 1-hop, 최종 URL 기준
  host 재계산)와 `sameUniversityHost`(정확 일치) 코드 확인 + 테스트 #4/#4b/
  #18c/#18d + Tester 라이브 확인.
- **완료 기준 "라이브 PACKET_CREATED" 1건 미달은 N/A**: 원인이 도구 결함이
  아니라 외부요인(Nara `rssList.do` 가 inu 외 전 대학 비활성)이며, 사용자가
  RSS-only 경로로 as-is 머지를 명시 결정했다. 해당 쓰기 경로는 통합 테스트
  #18c(오케스트레이션·후보·리포트·상태는 실제 실행, B1/B2 내부만 스텁) +
  독립적으로 통과하는 B1/B2 자체 스위트 + 살아있는 inu 피드로 커버된다.
- **잔여 위험은 전부 낮음~중간이고 비차단**: 최고 위험(라이브 B1/B2 end-to-end
  미검증)도 B1/B2 모듈이 무변경·독립 테스트되고 inu 수동 선례(커밋 1ca360e)로
  한 번 완주된 바 있어 수용 가능. 요청 예산 건은 다음 라운드 권고.

---

# 잔여 위험 (심각도순)

1. **[중] 라이브 B1/B2 쓰기 경로가 end-to-end 로 한 번도 실행되지 않음.**
   preflight 통과 대학이 라이브 큐에 0곳이라 `appendCandidateAtomic` →
   `prepareCatalogSourceBlock` → `buildReviewPacketFromDiagnose` 실호출·
   카탈로그 enabled:false 삽입 diff·review-packet 파일 생성·
   `DIAGNOSE_FAILED_POST_B1` 무롤백이 전부 스텁 커버. 완화: B1/B2 무변경·독립
   테스트 통과, inu 수동 선례 존재. 첫 실제 비-inu 통과 대학에서 육안 확인 필요.
2. **[낮~중] 예산 소진발 `DIAGNOSE_FAILED` 는 `--resume` 재시도 안 됨.**
   위 "개선 권고" 참고. `maxRequests` 10 상향 또는 예산소진→`ERROR` 반환 권고.
3. **[낮] `extractClientRedirect` 보수 게이트의 false negative.** "살찐 스플래시"
   (JS 리다이렉트 + 두꺼운 인트로)를 안 따라감. hanbat 에서 관찰(비-Nara,
   무해). 동형 스플래시 쓰는 진짜 Nara 대학이 있으면 조용히 `NOT_NARA_CMS`.
4. **[낮] `location=` 정규식 부분 매칭 가능성** (얇은 스텁 게이트로 확률 낮음).
5. **[낮] 리포트 `mutation` 플래그가 B1 삽입 시에도 전부 false** — spec 정의엔
   부합하나 오독 소지.
6. **[정보] 도구의 Phase 1 큐 라이브 산출량 = 0건.** Nara RSS 가 inu 외 전부
   꺼져 있음. 사용자가 as-is 머지 결정. HTML-list 폴백은 별도 라운드.

---

# 요청 예산(≤8) 권고

**머지 조건 아님.** 근거:
- 예산 초과는 전부 B1 이전(preflight) 단계 → 부분 쓰기·크래시 없음.
- Tester 관찰상 "오직 예산 때문에" 막힌 `PACKET_CREATED` 는 0건(예산 초과
  케이스는 전부 `university_name_mismatch` 등 다른 실패 동반).
- 알려진 유일한 해피패스(inu)는 홈(1)+리다이렉트(1)+nav 직접링크(subview 0)+
  robots(1)+rss(1)+상세(3) = **7 ≤ 8** 로 예산 안에 들어옴.
- spec 이 "대학당 최대 ~8"(틸드)로 명시.

**다음 라운드 권고**: `maxRequests` 를 10 으로 올리고(전부 B1 이전이라 안전),
예산 소진을 `DIAGNOSE_FAILED`(종결·resume 제외) 대신 `ERROR`(resume 재시도)
로 반환. RSS 폴백 라운드와 함께 처리.

---

# 커밋 계획 (main 위, **미실행** — 사용자 명시 요청 시에만)

라이브 런 산출물(리포트/상태/백업)은 전부 `.gitignore` 대상이라 수동 제외 불필요.
`git status` 확인 결과 스테이징 대상은 아래 6개 파일뿐.

## 커밋 1 — 코드

```
feat(onboarding): Nara Info CMS 배치 발굴 도구(discover-nara-cms-batch) — B1+B2 게이트 패킷, 활성화 없음
```

```
git add server/agent/onboarding/tools/discover-nara-cms-batch.js
git add server/agent/onboarding/tools/discover-nara-cms-batch.test.js
git add server/agent/onboarding/reports/nara-cms-batch/.gitkeep
git add .gitignore
```

## 커밋 2 — 파이프라인 기록

```
docs(pipeline): discover-nara-cms-batch spec/changes/test-results/review 기록
```

```
git add .pipeline/spec.md .pipeline/changes.md .pipeline/test-results.md .pipeline/review.md
```

git push / 배포 없음. 데이터 산출물(candidates append·카탈로그 삽입·review-packet)은
이번 라운드에 생성된 것이 없으므로 커밋 대상 없음.
