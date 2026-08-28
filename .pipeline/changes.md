# 변경된 파일

## 신규 (제품 코드 + 테스트) — 8개

- `D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.js` (B1)
- `D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.test.js` (B1 테스트)
- `D:\hhg(code)\server\agent\onboarding\tools\build-review-packet-from-diagnose.js` (B2)
- `D:\hhg(code)\server\agent\onboarding\tools\build-review-packet-from-diagnose.test.js` (B2 테스트, B1→B2 시연 포함)
- `D:\hhg(code)\server\agent\gate\brain-batch-approve.js` (B3, Brain 전용·비배선)
- `D:\hhg(code)\server\agent\gate\brain-batch-approve.test.js` (B3 테스트, 비배선 검증 포함)
- `D:\hhg(code)\server\agent\gate\apply-approved-activations.js` (B4)
- `D:\hhg(code)\server\agent\gate\apply-approved-activations.test.js` (B4 테스트, --apply 시연·안전성 포함)

## 수정 (제품 코드) — 최소 diff

- `D:\hhg(code)\server\agent\tools\run-single-school-trial.js`
- `D:\hhg(code)\package.json`

## 자동 생성 데이터 (테스트에서는 임시 fixture만 사용, 이번 세션에서 실제 생성/커밋 없음)

- `server/agent/onboarding/data/catalog-prepare-log.json` — B1 감사 로그(최초 실행 시 생성)
- `server/agent/gate/data/apply-batch-reports/<runId>.json` — B4 실행 리포트(최초 실행 시 생성)
- `development/university-news/data/university-news-sources.final.json.prepare-backup.<stamp>` — B1 사전 백업

# 각 파일의 "여는 명령" (AGENTS.md 4절)

```powershell
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\onboarding\tools\build-review-packet-from-diagnose.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\onboarding\tools\build-review-packet-from-diagnose.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\gate\brain-batch-approve.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\gate\brain-batch-approve.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\gate\apply-approved-activations.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\gate\apply-approved-activations.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\tools\run-single-school-trial.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\package.json"
```

# 변경 내용

## B1 — prepare-catalog-source-block.js (신규)

- `normalizeCandidateSourceBlock(candidate)` — 후보의 `source` 블록을 카탈로그 관례로 정규화.
  확정 결정 A안대로 `verified:false, enabled:false, status:"selector_required", healthStatus:"unknown"` 강제.
- `insertSourceBlock(catalog, {universityId, sourceId}, sourceBlock)` — 순수 함수.
  대학 블록이 없으면 throw(대학 블록 생성 안 함). 같은 sourceId 존재 시 throw(이미 `enabled:true`면 별도 메시지).
  `university.sources` 배열에만 push, 원본 객체 불변(deep clone 반환).
- `prepareCatalogSourceBlock({...})` — 후보 파일 조회 → `finalDecision === "COLLECTOR_CONFIG_READY"` 검증 →
  `insertSourceBlock` → (`--dry-run`이면 요약만) → 사전 백업(`<catalog>.prepare-backup.<stamp>`) →
  tmp 쓰기 → `JSON.parse` 검증 → `rename` → `catalog-prepare-log.json` 에 append(`{preparedAt, universityId, sourceId, catalogBackupPath, checksumBefore, checksumAfter}`).
  결과 JSON 에 `mutation` 전부 false 선언.
- 시간/경로/`fs.*`는 전부 주입 가능(`now`, `readFileImpl`, `writeFileImpl`, `renameImpl`, `copyFileImpl`, `existsImpl`, `mkdirImpl`).
- 체크섬 계산은 `server/agent/gate/checksum-utils.js` 의 `sha256Hex` 재사용.

## run-single-school-trial.js (수정, 최소 diff)

- `parseOptions()`: 반환 객체에 `allowUnverifiedForDiagnose: argv.includes("--allow-unverified-diagnose")` 추가.
- `selectSource(university, sourceId, { allowUnverifiedForDiagnose = false } = {})`: 세 번째 인자(옵션) 추가.
  `allowUnverifiedForDiagnose && sourceId && entry.id === sourceId` 인 소스에 한해 `verified !== true` 여도 후보 인정.
  기존 2-인자 호출은 기본값으로 동작 불변.
- `main()`: `selectSource(university, options.sourceId, { allowUnverifiedForDiagnose: options.diagnose && options.allowUnverifiedForDiagnose })`.
  플래그는 `--diagnose` 일 때만 효력(읽기 전용). `assertSourceEnabledForSave`/저장/`backupBeforeSave`/export 목록 전부 불변.

## B2 — build-review-packet-from-diagnose.js (신규)

- `parseJsonObjectsFromStdout(text)` — 문자열/이스케이프 상태를 추적하는 중괄호 스캐너로
  `run-single-school-trial.js` stdout 의 pretty-print JSON 2개를 분리. 마지막 객체를 결과로 사용.
- `runDiagnose({universityId, sourceId, limit, runnerImpl})` — 기본 runner 는 `execFileSync` 로
  `run-single-school-trial.js --diagnose --allow-unverified-diagnose` 실행. 테스트는 `runnerImpl` 주입.
- `collectRobotsEvidence(source, {fetchImpl, timeoutMs})` — `<origin>/robots.txt` 조회 후
  `screen-selector-required-sources.js` 의 `classifyRobotsFetchResult` 결과 그대로 사용(+`robotsUrl`).
- `evaluateDiagnose(diagnoseResult, source, robotsEvidence, {minAccepted=2})` — 순수 통과 판정:
  `foundCount>0` && `acceptedCount>=minAccepted` && `published_at_not_found` 없음 &&
  `detail_title_or_university_mismatch` 없음 && robots `checked===true && !unavailable && policy.blocked!==true` &&
  `jsDetailLinkRule.enabled!==true`.
- `collectRegressionEvidence({npmTestImpl, now})` / `extractNpmTestSummary(raw)` — `npm test` 출력에서
  `fail N` 형태를 뽑아 `regressionEvidence` 생성. (review-packet.js 가 `/fail\s+(\d+)/i` 로 재검증.)
- `reconstructAcceptedNewItems(diagnoseResult, {university, source})` — 확정 결정 3: diagnose 결과의
  `diagnostics[]` 중 `storable===true` 항목에서 `{title, sourceUrl, publishedAt, universityId, universityGroupId, category, sourceId}` 재구성.
- `buildReviewPacketFromDiagnose({...})` — 위를 조립. **미통과면 패킷을 만들지 않고** `{status:"DIAGNOSE_FAILED"}` 반환(CLI exit 1).
  통과 시에만 `createAndWriteReviewPacket()` 호출(`findSourceInCatalog` 로 `sourceSnapshot`/`universityGroupId` 확보).
  `--skip-npm-test` 는 호출자가 `regressionEvidence` 를 명시 주입해야 하고 미주입 시 throw.
- `review-decision-writer.js` 를 require 하지 않음.

## B3 — brain-batch-approve.js (신규, Brain 전용·비배선)

- gate 모듈 중 `review-decision-writer.js` 만 require. 서명 키 환경변수 이름(`UNIPICK_GATE_SIGNING_KEY`)은
  `signing-utils.js` 를 require 하지 않기 위해 파일에 독립 선언(apply-source-activation.js 의
  BLOCKED_REVIEWER_NAMES 재정의 선례와 동일).
- `listPendingReviews({dataDir,...})` — 패킷은 있으나 판정 파일이 없는 reviewId + 패킷 요약(scope/diagnostics 카운트/robots 요약/regression 요약).
  확정 결정 6: 소스별(`universityId+sourceId`) 최신 패킷 1개만(`createdAt` 기준).
- `approveOne(reviewId, {...})` — `writeReviewDecision` 래퍼. 서명 키 없으면 `SIGNING_KEY_UNAVAILABLE` 로 throw(파일 미생성).
- `batchApprove(reviewIds, {...})` — 시작 시 서명 키 1회 사전 검사(없으면 파일 0개 + throw).
  이미 판정 파일이 있는 reviewId 는 `skipped[]` 기록. 한 건 실패해도 나머지 진행(`failed[]`).
  `checkedItems` 위반 플래그 + APPROVE 는 `writeReviewDecision` 이 거부 → `failed[]`.
- CLI: `--list` / `--approve --review-ids=` / `--approve --all-pending` (+ `--reviewed-by` / `--reason` / `--checked-items-file` / `--verdict`).
- `package.json` 및 어떤 온보딩/tools/스케줄러/runner 코드에서도 require 되지 않음(테스트로 grep 검증).

## B4 — apply-approved-activations.js (신규)

- `apply-source-activation.js` 의 `runAllGuards` / `performActivationAndSave` / `writeJsonOnce` 재사용.
- `listApprovedUnapplied({dataDir,...})` — `verdict==="APPROVE"` && `<reviewId>.applied.json` 없는 판정 순회.
  확정 결정 6: 패킷 scope+createdAt 으로 소스별 최신 1개만.
- `applyApprovedActivations({apply, stopOnFirstApplied, ...})`:
  - 확정 결정 7: `runtime-lock.js` 의 `acquireRuntimeLock("news-update-agent")` 획득. 실패 시 `RUNTIME_LOCK_UNAVAILABLE` throw(아무것도 적용 안 함). 테스트에서 lock impl 주입.
  - `getTargetUniversities().length` 를 before/after 로 기록(`countTargetsImpl` 주입 가능 —
    테스트는 `countTargetUniversitiesInCatalogFile(fixtureCatalog)` 로 프로덕션 카탈로그 미접근).
  - 각 건: `runAllGuards` 실패 → `skipped[]`(`STALE_REVIEW_PACKET_INVALIDATED` / `SIGNATURE_MISSING` 등 코드+사유 기록, 예외 없음).
    통과 + `!apply` → `skipped[]` `VALIDATED_NOT_APPLIED`.
    통과 + `apply` → `performActivationAndSave` → 성공 `applied[]`(+`stopOnFirstApplied` 면 이후 `SKIPPED_AFTER_STOP`).
    `GateApplyFailure` → `failed[]`(code/rollback/backupDir). `ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED` 만 즉시 중단.
  - `apply-batch-reports/<runId>.json` 에 `writeJsonOnce` 로 리포트 저장.
- STALE 연쇄(첫 apply 성공 후 카탈로그 바이트 변경 → 나머지 STALE)는 정상 흐름으로 `skipped[]` 기록.
- CLI: 기본 검증만, `--apply`, `--apply --stop-on-first-applied`. `failed` 또는 수동개입 필요 시 exit 1.
- `review-decision-writer.js` 를 require 하지 않음.

## package.json (수정)

`scripts` 에 3개만 추가(B3 스크립트 없음):

```
"news:onboard:prepare-source": "node server/agent/onboarding/tools/prepare-catalog-source-block.js"
"news:onboard:review-packet": "node server/agent/onboarding/tools/build-review-packet-from-diagnose.js"
"gate:apply-approved": "node server/agent/gate/apply-approved-activations.js"
```

# 변경 이유

- `.pipeline/spec.md` "# 확정된 설계 결정 (2026-08-28, 사용자 승인)" 및 "# 완료 기준 1~12" 를 그대로 구현.
- 온보딩 검증 통과 후보 → (B1) 카탈로그 비활성 삽입 → (B2) diagnose 통과 시 review-packet 생성 →
  (B3, Brain 수동) 일괄 APPROVE 서명 → (B4) `--apply` 배치 활성화 로 이어지는 4개 "다리"를
  기존 gate 모듈/스케줄러 락/store 원자적 쓰기 경로만 재사용해 배선.
- 신규 npm 의존성 없음(Node 내장 `fs`/`path`/`crypto`/`child_process`만).
- run-single-school-trial.js 수정은 확정 결정 1 A안(플래그 최소 추가)에 따른 것이며,
  `--diagnose` 읽기 전용성과 기존 export/저장 로직을 보존.

# 검증 결과

## node --check (신규/수정 .js 전부)

```
OK server/agent/onboarding/tools/prepare-catalog-source-block.js
OK server/agent/onboarding/tools/prepare-catalog-source-block.test.js
OK server/agent/onboarding/tools/build-review-packet-from-diagnose.js
OK server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js
OK server/agent/gate/brain-batch-approve.js
OK server/agent/gate/brain-batch-approve.test.js
OK server/agent/gate/apply-approved-activations.js
OK server/agent/gate/apply-approved-activations.test.js
OK server/agent/tools/run-single-school-trial.js
```

## package.json JSON 파싱

```
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('package.json JSON OK')"
=> package.json JSON OK
```

## 신규 테스트 파일 개별 실행 (node --test)

- `prepare-catalog-source-block.test.js` — tests 11, pass 11, fail 0
- `build-review-packet-from-diagnose.test.js` — tests 13, pass 13, fail 0
- `brain-batch-approve.test.js` — tests 8, pass 8, fail 0
- `apply-approved-activations.test.js` — tests 9, pass 9, fail 0
- (회귀) `run-single-school-trial.test.js` — tests 16, pass 16, fail 0 (파일 무수정)
- (회귀) `server/agent/gate/*.test.js` — 기존 66 테스트 전부 pass

## 전체 npm test 3회 연속

| 실행 | tests | pass | fail | cancelled |
|---|---|---|---|---|
| 1회 | 274 | 274 | 0 | 0 |
| 2회 | 274 | 274 | 0 | 0 |
| 3회 | 274 | 274 | 0 | 0 |

- 변경 전 baseline: tests 233 / pass 233 / fail 0.
- 신규 +41 테스트(B1 11 + B2 13 + B3 8 + B4 9). 3회 모두 동일 결과 → 결정적(flaky 0).
- 시간/난수/타임스탬프/락/`fs.*`/`fetch`/`npm test`/diagnose runner 는 전부 주입으로 고정,
  테스트는 임시 fixture 디렉터리만 사용(프로덕션 카탈로그/store/preview/네트워크 미접근).

# 미구현 항목 / 보류

- 없음. spec "# 파일" 표의 신규 8개 파일 + 명시된 최소 수정(run-single-school-trial.js A안 플래그,
  package.json 스크립트 3개)만 구현.
- Code Agent 는 APPROVE 판정 파일 생성/서명/`--apply` 자동 실행을 하지 않음(B3 은 Brain 수동 단계).
- 실제 44번째 대학 활성화(프로덕션 카탈로그 쓰기)는 사용자 승인 후 별도 — 이번엔 fixture 시연만.
- `.gitignore` 는 spec 허용 파일 목록 밖이라 수정하지 않음(아래 참고사항 참조).
- B5(스케줄러 워크트리 자동 동기화)는 이번 범위 아님.

# 참고사항 (Tester가 알아야 할 내용)

- `npm test` 는 Windows PowerShell / Git Bash 어느 쪽에서도 `npm test` 로 실행(`node --test` 내장 러너).
- 신규 테스트는 전부 `os.tmpdir()` 아래 `fs.mkdtempSync` fixture + 의존성 주입만 사용.
  실제 `development/university-news/data/university-news-sources.final.json`,
  `server/agent/data/agent-news-store.json`, `data/university-news-preview.json`, 네트워크를 건드리지 않음.
- 결정적 재현용 고정값: `FIXED_NOW = new Date("2026-08-28T09:15:00.000Z")`,
  `randomBytesImpl = () => Buffer.from("a1b2c3","hex")`, 더미 서명 키
  `"test-only-dummy-signing-key-do-not-use-in-production"`.
- B2 통과 시 결정적 reviewId 예: `rp-test-university-test-press-20260828181500-a1b2c3`
  (타임스탬프는 로컬시간 기준 압축 — gate `review-packet.js` 의 `formatCompactTimestamp` 사용).
- B3 `brain-batch-approve.js` 는 `node server/agent/gate/brain-batch-approve.js` 로 직접 실행만 가능하고
  `npm run` 스크립트가 없음(의도). 실제 서명은 `UNIPICK_GATE_SIGNING_KEY` 가 설정된 Brain 컨텍스트에서만 동작.
- B4 CLI 를 실제로 돌리면(`npm run gate:apply-approved`) `runtime-lock.js` 의
  `server/agent/runtime/news-update-agent.lock` 를 스케줄러와 공유하므로, 스케줄러 실행 중에는 즉시 exit 1.
- 자동 생성물(`server/agent/onboarding/data/catalog-prepare-log.json`,
  `server/agent/gate/data/apply-batch-reports/*.json`,
  `server/agent/gate/data/review-packets/*.json`, `review-decisions/*.json`,
  `*.prepare-backup.*`)은 커밋 대상이 아님. 현재 `.gitignore` 에 명시 규칙이 없으므로
  (기존 `server/agent/gate/data/` 는 `.gitkeep` 만 추적) 운영자가 `git add` 시 제외해야 함.
- git add/commit/push/배포 미실행. `server/agent/gate/data/` 커밋 미실행.
- 사용자가 직접 확인할 것:
  1) `.gitignore` 에 위 자동 생성물 경로를 추가할지 여부(이번 세션 범위 밖으로 남김).
  2) 실제 후보(`collector-config-candidates.json`)로 B1→B2→(B3 서명)→B4 를 프로덕션에 적용할지 승인.
  3) `UNIPICK_GATE_SIGNING_KEY` 운영 값 관리(코드/로그에 절대 미포함).

# P1 보완 (Reviewer 지적)

## 결함

`server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js` 의
`FIXED_NOW = new Date("2026-08-28T09:15:00.000Z")` + 하드코딩 reviewId 단언
`"...-20260828181500-a1b2c3"`. `181500` 은 gate `formatCompactTimestamp` 의
로컬 `getHours()` 압축이라 UTC 문자열을 쓰면 UTC+9 이외 환경에서 결정적으로
어긋남 → spec 공통 제약 4번(시간 필드 고정) 위반.

## 수정

- `FIXED_NOW` 를 로컬 시간 성분 생성자 `new Date(2026, 7, 28, 9, 15, 0)` 로 교체
  (`server/agent/gate/review-packet.test.js:151` 의 타임존 무관 패턴과 동일).
  이 값의 압축 스탬프는 어느 타임존에서든 `20260828091500`.
- reviewId 단언을 `"rp-test-university-test-press-20260828091500-a1b2c3"` 로 교정하고,
  타임존 무관 정규식 `/^rp-test-university-test-press-\d{14}-a1b2c3$/` 단언을 추가.
  reviewId 결정성은 유지.
- 그 외 파일은 건드리지 않음.

## 재검증

- `node --check server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js` — 통과.
- `node --test .../build-review-packet-from-diagnose.test.js` — tests 13, pass 13, fail 0.
- 전체 `npm test` 1회 — tests 274, pass 274, fail 0 (카운트 불변).
