# 검토 요약

온보딩→게이트→스케줄러 배선(B1~B4)의 계획·구현·테스트를 종합 검토했다. (2차 라운드 갱신)

- 대상 파일: 신규 8개(B1/B2/B3/B4 각 제품코드+테스트), 수정 2개(`run-single-school-trial.js`, `package.json`).
- 전부 읽고 확인: `.pipeline/spec.md`, `.pipeline/changes.md`, `.pipeline/test-results.md`,
  실제 신규/수정 소스, `runtime-lock.js`, `review-packet.js`, 기존 gate 테스트, git diff.
- 전체 방향과 구현 품질은 spec "확정된 설계 결정(2026-08-28)"에 정확히 부합한다.
- 완료 기준 1~12 전부 대응 테스트가 존재하고 통과한다. 전체 `npm test` 274/274.
- 프로덕션 데이터/네트워크/git 미변경 확인.
- 1차 검토에서 지적한 P1(B2 테스트의 타임존 의존 단언, spec 공통 제약 4번 위반)은
  2차 라운드에서 Coder가 테스트 파일 1개만 수정해 해소했다(아래 "P1 보완 확인").
- 차단(blocker) 결함 없음. 잔여 항목은 P2/P3(후속)뿐. **승인**으로 판정한다.

# P1 보완 확인 (2차 라운드)

Coder 수정 범위: `server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js` **한 파일만**.
프로덕션 코드(`*.js` 본체), 다른 테스트, `package.json` 무변경 — 리뷰어가 직접 확인.
(신규 파일이라 `git diff` 는 비어 있고, 파일 내용을 직접 대조함.)

- `FIXED_NOW` = `new Date(2026, 7, 28, 9, 15, 0)` (로컬 성분 생성자, `review-packet.test.js:151`
  의 타임존 무관 패턴과 동일). 압축 스탬프는 어느 타임존에서도 항상 `20260828091500`.
- reviewId 정확 단언을 `rp-test-university-test-press-20260828091500-a1b2c3` 로 교정(line 213)
  + 타임존 무관 정규식 단언 `/^rp-test-university-test-press-\d{14}-a1b2c3$/` 추가(line 214).
- 이탈 사유를 설명하는 주석(line 19~22) 추가.
- 나머지 `now: () => FIXED_NOW` 사용처(9곳)는 전부 그대로 — 회귀 없음.
- `.pipeline/changes.md` 에 "P1 보완" 절 추가됨.

재검증(리뷰어 직접 실행):
- `node --test build-review-packet-from-diagnose.test.js` → tests 13 / pass 13 / fail 0.
- 전체 `npm test` 2회 연속 → `tests 274 / pass 274 / fail 0 / cancelled 0` 동일.
- 개발 머신 타임존 `Asia/Seoul` 확인. 정규식 단언 추가로 UTC 등 타 타임존에서도 이제 통과한다.

# 요구사항 확인

## 최초 요구사항 (4개 다리 배선)

| 다리 | 요구 | 충족 |
|---|---|---|
| B1 | 후보 소스 블록을 카탈로그에 `enabled:false` 삽입, 원자적 쓰기+백업+감사로그 | 충족. `prepareCatalogSourceBlock`: 사전 백업(`.prepare-backup.<stamp>`) → tmp 쓰기 → `JSON.parse` 검증 → `rename`, `catalog-prepare-log.json` append. `insertSourceBlock` 순수함수(deep clone), 대학 블록 없음/중복 sourceId throw. |
| B2 | diagnose 통과 시에만 `createAndWriteReviewPacket()` 호출 | 충족. `evaluateDiagnose.passed===false` → `DIAGNOSE_FAILED` 반환, 패킷 미생성. 통과 시에만 패킷 생성. `review-decision-writer.js` 미require. |
| B3 | Brain 전용·비배선 일괄 APPROVE 서명 | 충족. `review-decision-writer.js`만 require. 서명 키 없으면 `SIGNING_KEY_UNAVAILABLE` throw, 파일 0개. `package.json`/온보딩/tools/scheduler/runner 어디에도 미배선(grep 재확인 완료 — 자기 테스트 외 참조 없음, `activate-*.js` 참조는 전부 주석). |
| B4 | verdict=APPROVE & 미적용 reviewId 순회 → `--apply` 배치 + 리포트 | 충족. `runAllGuards`+`performActivationAndSave` 재사용, `--apply` 기본 false(검증만), STALE/서명실패 skip 기록, 롤백 실패만 즉시 중단, `acquireRuntimeLock` 재사용, `apply-batch-reports/<runId>.json` 리포트. |

## spec 완료 기준 1~12

| # | 기준 | 판정 | 근거 |
|---|---|---|---|
| 1 | 8개 파일 설계대로 + `node --check` | 통과 | 9개 파일 `node --check` OK. 함수 시그니처가 spec "함수 시그니처(제안)"과 일치. |
| 2 | B1→B2 시연 통합 테스트 (packetSha256 자체검증, mutation 전부 false, regression fail 0) | 통과 | `build-review-packet-from-diagnose.test.js`의 "B1 -> B2 demo" 테스트가 단언. |
| 3 | B2 미통과 4케이스 패킷 미생성 | 통과 | foundCount 0 / publishedAt 누락 / robots unavailable / accepted 부족 + npm test fail>0 각각 `countPacketFiles===0`. |
| 4 | B4 `--apply` 시연 before→before+1, `<reviewId>.applied.json` | 통과 | `applied.length===1`, `targetUniversityCountAfter===before+1`, applied.json 존재, 더미키 서명 통합 시연 포함. |
| 5 | B4 안전성 (mtime 불변 / STALE·SIGNATURE_MISSING skip / saveNewItems 실패 롤백) | 통과 | 각 케이스 테스트 존재. `SAVE_FAILED_ROLLBACK_SUCCESS` + `enabled:false` 롤백 단언. |
| 6 | B3 비배선 + 키 미설정 시 파일 미생성 | 통과 | grep + 코드리뷰 재확인. `SIGNING_KEY_UNAVAILABLE` 시 판정파일 미생성 테스트. |
| 7 | B3 더미키 서명이 `verifyDecisionSignature` + `runAllGuards` 통과 | 통과 | `batchApprove` N건 서명 → 각 검증 통과 테스트. |
| 8 | 전체 `npm test` 3회 결정적 통과, 프로덕션 미접근 | 통과 | 274/274 반복 동일. tmpdir fixture + 주입만. P1 보완으로 타임존 의존 제거 → 이제 환경 독립적. |
| 9 | `package.json` 스크립트 정확히 3개, B3 없음, JSON 유효 | 통과 | `news:onboard:prepare-source`, `news:onboard:review-packet`, `gate:apply-approved`만 추가. `brain`/`batch-approve` 스크립트 0개. |
| 10 | `run-single-school-trial.js` 수정 시 기존 테스트 무수정 통과 + `--diagnose` 읽기전용성 유지 | 통과 | diff는 `parseOptions` 플래그 1개, `selectSource` 3번째 옵션 인자, `main()` 호출 인자(`options.diagnose &&` 게이팅)뿐. `assertSourceEnabledForSave`/`saveNewItems`/`backupBeforeSave`/`module.exports` 불변. 기존 16 테스트 무수정 통과. |
| 11 | `.pipeline/changes.md` 기록 | 통과 | 변경 파일·이유·`node --check`/`npm test` 결과·미구현("없음")·P1 보완 절 기록. |
| 12 | git add/commit/push/배포 미실행, `gate/data/` 커밋 미실행 | 통과 | git status에 프로덕션 데이터 변경 없음. 신규 추적 데이터 파일 없음. |

## spec 공통 제약 준수 체크

| 제약 | 판정 | 근거 |
|---|---|---|
| 1. Code Agent 자동 서명/`--apply` 금지, B3 수동 | 준수 | B3는 env 서명키 필수·비배선. B4 `--apply`는 운영자 CLI 인자, 자동 실행 경로 없음(기본 검증만). |
| 2. 신규 npm 의존성 0 | 준수 | `fs`/`path`/`crypto`(via checksum-utils)/`child_process`만. `package.json` dependencies 변화 없음. |
| 3. 원자적 쓰기·백업·롤백 경로만 사용 | 준수 | B1: 백업→tmp→`JSON.parse`→`rename`. B4: gate `performActivationAndSave`/`writeJsonOnce` 재사용. |
| 4. 시간/난수 필드 테스트 주입 고정 | 준수 (P1 보완 후) | 전 도구가 `now`/`randomBytesImpl` 주입. B2 테스트도 로컬 성분 생성자 + 정규식 단언으로 교정 완료. |
| 5. git/배포 미실행 | 준수 | 어떤 git 상태변경 명령도 없음. |
| 6. 프로덕션 카탈로그/store/preview 미접근 | 준수 | 신규 테스트 전부 `os.tmpdir()` + `mkdtempSync` + `*Impl` 주입. |
| 7. B3 미배선 (`package.json`/onboarding/tools 등) | 준수 | grep 재확인. `brain-batch-approve.js`는 자기 테스트만이 require. `review-decision-writer.js` 프로덕션 require는 `brain-batch-approve.js` 1곳(spec 허용). |
| B3 완전 비배선 | 준수 | npm 스크립트 없음, `require.main === module` 직접 실행만. |

# 테스트 결과

- `node --check`: 9/9 OK.
- 전체 `npm test`: 반복 `tests 274 / pass 274 / fail 0 / cancelled 0` (baseline 233 + 신규 41).
- 신규 테스트 카운트: B1 11 / B2 13 / B3 8 / B4 9.
- 회귀: 기존 gate 66 테스트 + `run-single-school-trial` 16 테스트 무수정 통과.
- 검토 환경 확인: `.github` 등 CI 설정 없음. 개발 머신 타임존 `Asia/Seoul`(UTC+9).
- Tester 종합 판정 PASS + 경미한 위험 3건 보고. #1은 P1 보완으로 해소, #2/#3은 후속.

# 문제점

## #1 (P1) — B2 테스트의 reviewId 단언이 로컬 타임존 의존 → **2차 라운드에서 해소됨**

1차 지적: `FIXED_NOW = new Date("2026-08-28T09:15:00.000Z")`(UTC 순간값)을
`formatCompactTimestamp`(로컬 `getHours()`)로 압축한 `...181500...`을 정확 단언해
UTC+9 이외 타임존에서 결정적으로 실패. spec 공통 제약 4번(테스트의 시간 필드
환경 독립 재현성) 위반이자 `review-packet.test.js:151`의 확립된 패턴에서 이탈.

Coder 조치(테스트 파일 1개 한정): `FIXED_NOW`를 로컬 성분 생성자
`new Date(2026, 7, 28, 9, 15, 0)`로 교체 + 정확 단언 교정(`...091500...`) +
타임존 무관 정규식 단언 추가. 리뷰어 재검증: 개별 13/13, 전체 274/274 2회 동일.
→ **해소 확인.**

## #2 (P2, 인수 후 후속) — 자동 생성물이 `.gitignore` 에 없음

`server/agent/onboarding/data/catalog-prepare-log.json`,
`server/agent/gate/data/apply-batch-reports/*.json`,
`*.prepare-backup.<stamp>` 는 실제 CLI 실행 시 생성되며 무시 규칙이 없다. 운영자가
`git add .` 하면 감사 로그/백업이 커밋될 수 있다. Coder가 changes.md에 명시했고
완료 기준 위반은 아니다(이번 세션은 CLI 미실행). `.gitignore` 수정은 spec 허용 파일
목록 밖이라 이번에 손대지 않은 것이 오히려 제약 준수. 사용자 승인 후 별도 처리 권장.

## #3 (P3, 문서화로 충분) — `collectRegressionEvidence` 기본 구현이 `execSync("npm test")`

B2를 `--skip-npm-test` 없이 `npm test` 컨텍스트 안에서 실행하면 재귀 실행 위험.
테스트는 항상 `npmTestImpl` 주입이라 문제 없음. 실사용 시 `--skip-npm-test` +
`regressionEvidence` 명시 주입 경로가 이미 있으므로 운영 문서에 주의만 남기면 된다.

## 요청하지 않은 변경 여부

없음. 모든 변경이 spec "확정된 설계 결정"과 "# 파일" 표에 매핑된다.
`package.json`은 정확히 3개 스크립트만, `run-single-school-trial.js`는 최소 diff(플래그+옵션 인자).
2차 라운드 수정도 테스트 파일 1개(P1)에 국한.

## 명백한 오류/위험

- B1 카탈로그 삽입: `insertSourceBlock` 이 deep clone 반환 + `university.sources` push만 →
  다른 대학/필드 불변(테스트 전수 비교). 대학 블록 없음/중복 sourceId throw. 계약 준수.
- B4 활성화: gate `runAllGuards`(staleness 4종 sha256 전수 비교) + `performActivationAndSave`
  (3파일 백업·롤백·`<reviewId>.applied.json` append-only) 를 그대로 위임. 첫 apply 후
  나머지 STALE 연쇄를 `skipped[]`에 정상 기록, `--stop-on-first-applied` 제공. 계약 준수.
- 락: `acquireRuntimeLock("news-update-agent")` 로 스케줄러와 상호배제. 획득 실패 시
  `RUNTIME_LOCK_UNAVAILABLE` throw(아무것도 적용 안 함). `finally`에서 release. 정상.
- B3: 서명 키 사전 1회 검사 → 없으면 파일 0개 throw. 위반 플래그+APPROVE는
  `writeReviewDecision`이 거부(이중 차단). 정상.

# 최종 판정
승인

# 판정 이유

전체 방향, 아키텍처, spec 완료 기준 1~12, 공통 제약이 모두 충족됐고 회귀도 없다.
차단할 만한 안전 결함(자동 서명, 자동 `--apply`, 프로덕션 쓰기, git 실행, npm 의존성
추가, B3 배선)은 전혀 없다.

1차 검토에서 유일하게 걸었던 P1(B2 테스트의 타임존 의존 단언, spec 공통 제약 4번
위반)은 2차 라운드에서 Coder가 테스트 파일 1개만 최소 수정해 해소했고, 리뷰어가
직접 재검증(개별 13/13, 전체 `npm test` 274/274 2회 연속)했다. 수정 범위가 P1에
정확히 국한되고 다른 회귀가 없음을 파일 대조로 확인했다.

배포 가능한 상태다. 단 아래 후속 항목은 실제 프로덕션 활성화(44번째 대학) 착수 전에
처리할 것을 권고한다 — 이는 이번 인수를 막지 않는다.

**후속 항목(비차단):**
1. (P2) `.gitignore` 에 B1/B4 자동 생성물·백업 경로 추가 여부 사용자 결정.
2. (P3) B2 실사용 시 `npm test` 재귀 방지(`--skip-npm-test` + `regressionEvidence`
   주입) 를 운영 문서/`--help` 에 명시.
3. (Tester #4, 범위 밖) `.pipeline/merge-analysis.md` 의 `origin/main` 카탈로그/store
   병합이 B4의 실제 프로덕션 카탈로그 쓰기보다 선행되어야 함.
4. 실제 후보(`collector-config-candidates.json`)로 B1→B2→(B3 서명)→B4 를 프로덕션에
   적용하는 것과 `UNIPICK_GATE_SIGNING_KEY` 운영값 관리는 사용자 승인 사항.
