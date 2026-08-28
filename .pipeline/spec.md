# 목표

`/ship` 온보딩(43개교 → 247개교 확장) 결과가, 이미 완성돼 있으나 "빈 배선 상태"인
`server/agent/gate/` 승인 게이트(review-packet → 서명 ReviewDecision → `--apply`)를
거쳐 기존 스케줄러(`run-scheduled-news-update.js`: 수집 → publishedAt/JSON 검증 →
`npm test` → commit → push → 배포)로 자동으로 이어지도록, 4개의 "다리"(B1~B4)
호출 경로를 새로 만든다.

핵심 흐름:

```
온보딩 검증 통과 후보
  └─(B1) university-news-sources.final.json 에 비활성 소스 블록 삽입 (enabled:false)
       └─(B2) run-single-school-trial --diagnose 통과 시 gate createAndWriteReviewPacket() 호출
            └─ review-packets/<reviewId>.json 생성
                 └─(B3, Brain 수동/비배선) 대기 패킷 일괄 APPROVE 서명 → review-decisions/<reviewId>.json
                      └─(B4) verdict=APPROVE & 미적용 reviewId 순회 → apply-source-activation.js --apply
                           └─ catalog enabled:true + saveNewItems() → targets.js 대상 +1개교
                                └─ (이후) 기존 스케줄러가 자동으로 수집·검증·commit·push·배포
```

이번 세션(Planner)은 설계만 한다. 제품 코드/JSON/store/preview/테스트/git 는
건드리지 않는다. 유일한 쓰기는 이 `.pipeline/spec.md` 다. (직전 라운드까지의 게이트
설계 원문은 git 이력 커밋 `aaeb34f` 의 `.pipeline/spec.md` 에 보존돼 있다.)

# 요구사항

## 공통 제약 (기존 spec.md 원칙 유지)

1. Code Agent(구현 코드)는 스스로 APPROVE 판정 파일을 만들거나 서명하거나 `--apply`
   를 자동 실행할 수 없다. B3(서명)은 사람/Brain 수동 단계로 남긴다.
2. 신규 npm 의존성 없음. Node 내장 모듈(`fs`, `path`, `crypto`, `child_process`)만 사용.
3. catalog/store/preview 쓰기는 gate 의 원자적 쓰기·백업·롤백 경로
   (`apply-source-activation.js` 의 `writeJsonAtomic`/`performActivationAndSave`,
   `store.js` 의 `saveNewItems`/`writeAtomic`)만 사용한다. B1 의 catalog 삽입도
   동일하게 tmp → `JSON.parse` 검증 → `rename` 원자적 쓰기 + 사전 백업을 쓴다.
4. 시간/난수 필드(`now`, `randomBytesImpl`, `ranAt`, 백업 디렉터리 타임스탬프 등)는
   전부 의존성 주입으로 고정 가능해야 하며, 테스트는 고정값만 사용한다
   (직전 라운드 flaky 선례: `collectedAt` 미고정).
5. `git add`/`commit`/`push`/배포는 이번 작업에서 실행하지 않는다.
   `server/agent/gate/data/` 커밋도 이번 범위 밖.
6. 실제 프로덕션 카탈로그/store/preview 는 테스트에서 절대 건드리지 않는다
   (임시 fixture 디렉터리 + 경로 주입만 사용 —
   `apply-source-activation.test.js` 의 `makeFixture()` 패턴 재사용).
7. B3(`review-decision-writer.js` 를 호출하는 도구)은 `package.json` 스크립트,
   `server/agent/onboarding/**`, `server/agent/tools/**` 등 Code Agent 실행 경로
   어디에도 `require`/연결하지 않는다. `node --test` 로만 실행되는 독립 도구다.

## 조사로 확인된 사실 (계획의 근거)

- `server/agent/gate/` 5개 모듈 export 시그니처
  - `review-packet.js`: `buildReviewPacket(input)`(순수), `writeReviewPacketOnce(packet, {dataDir, existsImpl, mkdirImpl, writeFileImpl})`,
    `createAndWriteReviewPacket(input, writeOptions) → { packet, writtenPath }`,
    `reviewPacketPath(reviewId, dataDir)`, `computePacketSha256(packet)`, `generateReviewId({universityId, sourceId, now, randomBytesImpl})`,
    `SCHEMA_VERSION`, `DEFAULT_DATA_DIR`(= `server/agent/gate/data`).
    - `buildReviewPacket` 필수 입력: `universityId`, `sourceId`, `sourceSnapshot`,
      `diagnostics`{`command`,`rawOutput`,`foundCount`,`acceptedCount`,`newCount`,`duplicateCount`,`excludedCount`,`acceptedNewItemsForSave`},
      `robotsEvidence`, `regressionEvidence`{`npmTestCommand`,`npmTestSummary`,`ranAt`}, `paths`{`sourceCatalogFile`,`storeFile`,`previewFile`}.
    - `regressionEvidence.npmTestSummary` 가 `/fail\s+(\d+)/i` 로 파싱 안 되거나 값이 0이 아니면 **패킷 생성 자체를 거부**(throw).
    - `sourceSnapshot.jsDetailLinkRule?.enabled === true` 이면 `jsRuleEvidence`{`engineUnitTestsPassed`, `manualGetVerification`} 필수.
    - 옵션: `now`(기본 `new Date()`), `randomBytesImpl`(기본 `crypto.randomBytes`), `readFileImpl`, `createdBy`(기본 `"code-agent"`), `proposedChange`.
    - `proposedChange` 기본값: `{enabled:{from:snapshot.enabled===true,to:true}, verified:{from:snapshot.verified===true,to:true}, status:{from:snapshot.status,to:"verified"}}`.
  - `review-decision-writer.js` (**Brain 전용**): `writeReviewDecision({reviewId, dataDir, packetPathOverride, verdict, reasons, checkedItems, reviewedBy, signingKey, keyId, now, readFileImpl, existsImpl, mkdirImpl, writeFileImpl}) → { decision, writtenPath }`.
    - `verdict ∈ {APPROVE,HOLD,REJECT}`, `reasons` 비어있지 않은 배열, `checkedItems` 객체 필수.
    - `reviewedBy` 가 `["code-agent","planner","coder","tester","reviewer"]`(대소문자 무관)이면 거부.
    - 위반 플래그(`robotsPolicyViolation`/`jsRuleUnverified`/`diagnoseFailed`) 중 하나라도 true + `verdict==="APPROVE"` → 거부.
    - 패킷 파일을 읽어 `computePacketSha256` 재계산, `packet.packetSha256` 과 불일치 시 거부.
    - 서명 대상: `{reviewId, packetSha256Recomputed, verdict, reasons, checkedItems}` canonical → HMAC-SHA256.
    - 같은 `reviewId` 판정 파일이 이미 있으면 거부(append-only).
  - `apply-source-activation.js`: `parseArgs(argv) → {reviewId, apply}`,
    `runAllGuards(reviewId, {dataDir, readFileImpl, existsImpl, sourceCatalogFile, storeFile, previewFile, env, blockedReviewerNames}) → {failed, code, reasons} | {failed:false, packet, decision, reviewId}`,
    `performActivationAndSave(packet, {reviewId, dataDir, sourceCatalogFile, storeFile, previewFile, backupBeforeSaveImpl, saveNewItemsImpl, readFileImpl, writeFileImpl, copyFileImpl, renameImpl, existsImpl, mkdirImpl, nowImpl}) → {status:"APPLIED", reviewId, backupDir, saveResult}` (실패 시 `GateApplyFailure` throw, `.code`/`.rollback`/`.backupDir` 포함),
    `findSourceInCatalog(catalog, scope) → {university, source}` (scope = `{universityId, sourceId}`),
    `applyMinimalDiff(catalog, scope, proposedChange)`, `writeJsonAtomic`, `writeJsonOnce`, `restoreFromBackup`,
    `DEFAULT_SOURCE_CATALOG_FILE`(= `development/university-news/data/university-news-sources.final.json`), `GateApplyFailure`.
    - `runAllGuards` 실패 코드: `REVIEW_PACKET_NOT_FOUND`, `NO_DECISION_YET`, `REVIEW_ID_MISMATCH`,
      `SIGNING_KEY_UNAVAILABLE`, `SIGNATURE_MISSING`, `SIGNATURE_INVALID`,
      `INVALID_DECISION_APPROVE_WITH_VIOLATION`, `STALE_REVIEW_PACKET_INVALIDATED`,
      `VERDICT_NOT_APPROVED`, `REVIEWER_BLOCKED`.
    - `performActivationAndSave` 성공 시 `review-decisions/<reviewId>.applied.json` 를 `writeJsonOnce` 로 생성(이미 있으면 throw).
  - `signing-utils.js`: `SIGNING_KEY_ENV_VAR = "UNIPICK_GATE_SIGNING_KEY"`, `signDecision(key, decision)`,
    `verifyDecisionSignature(key, decision, value)`, `signingKeyId(key)`, `loadSigningKeyFromEnv(env)`.
  - `checksum-utils.js`: `canonicalStringify`, `sha256Hex`, `sha256OfCanonicalObject`, `sha256OfFile`,
    `computeAllChecksums({sourceCatalogFile, storeFile, previewFile, sourceSnapshot, readFileImpl})`
    → `{sourceCatalogFile:{path,sha256}, sourceBlockCanonical:{sha256}, storeFile:{path,sha256}, previewFile:{path,sha256}}`.
- `runAllGuards` 의 staleness 검사는 `packet.checksums` 4종을 "지금 이 순간"의 값과 전수 비교한다.
  **`sourceCatalogFile` 은 파일 바이트 전체의 sha256** 이므로, 카탈로그의 무관한 부분이
  1바이트라도 바뀌면 `STALE_REVIEW_PACKET_INVALIDATED` 가 된다 → **B4 배치에서 첫 apply
  성공 후 나머지 APPROVE 패킷은 전부 STALE 이 된다**(아래 B4 설계/예외 참고).
- `run-single-school-trial.js` (`server/agent/tools/`)
  - `parseOptions`: `--university-id`(필수), `--source-id`(선택), `--limit`(1~3), `--diagnose`.
  - `selectSource(university, sourceId)`: `sourceType==="official" && verified===true && collectionType∈{rss,html}` 인 소스만 후보.
    **`verified !== true` 이면 `--source-id` 를 줘도 여기서 즉시 throw** → B1 이 삽입할 소스의
    `verified` 값과 B2 의 diagnose 호출 방식이 충돌한다(아래 "미해결 설계 결정 1" 참고).
  - `--diagnose` 는 읽기 전용: `assertSourceEnabledForSave` 는 `diagnose===true` 면 항상 통과, `saveNewItems`/`backupBeforeSave` 미호출.
  - `main()` 은 stdout 에 JSON 2개를 출력: (1) 헤더(`phase`,`university`,`source`,`limits`),
    (2) 결과 `{foundCount, acceptedCount, newCount, duplicateCount, excludedCount, diagnostics[], sourceWarnings[], backupDir, saveResult}`.
    - `diagnostics[i]` = `{title, sourceUrl, publishedAtRaw, dateLocation, method, publishedAt, detailValidation, storable, reason, error?}`.
    - accepted 항목은 `detail.publishedAt` 이 truthy 일 때만 push 됨(즉 `acceptedCount>=1` 이면 그 항목들은 모두 publishedAt 보유).
    - `reason` 후보: `required_field_or_identity_mismatch`, `not_a_valid_detail_url`,
      `login_or_error_or_non_detail_page`, `detail_title_or_university_mismatch`,
      `published_at_not_found`, `detail_fetch_failed`.
  - export: `assertSourceEnabledForSave, normalizeText, sameText, extractDetail, selectSource, titleMatches, universityNameMatches, backupBeforeSave`.
- `screen-selector-required-sources.js` export: `classifyRobotsFetchResult(result) → {checked, unavailable, reasonCode?, policy}`,
  `runScreening`, `screenCandidate`, `parseArgs`, `PROTECTED_WRITE_PATHS`, `assertNotProtectedWritePath`, `SOURCE_FILE`.
  - `classifyRobotsFetchResult` 는 robots 못 가져오면 `{checked:false, unavailable:true, reasonCode:"ROBOTS_UNAVAILABLE"}` (제한 없음으로 단정하지 않음).
- `store.js` export: `loadStore, saveNewItems(newItems)→{savedCount,totalCount}, getAllItems, rebuildPreviewFromStore, isPublicPreviewItem, STORE_PATH, PREVIEW_PATH`.
- `targets.js`: `getTargetUniversities()` = `verified===true && enabled===true` 이고 방식별 필수 필드
  (`html`: `listUrl` + `selectors.item/title/link`, `rss`: `rssUrl`)를 채운 소스가 1개 이상인 대학.
  현재 대상 43개교. `isSourceCollectible(src)` 도 export.
- 온보딩 큐/후보 파일 스키마
  - `onboarding-review-queue.json` (81건): `{items:[{universityId, status:"review", result:{universityName, diagnosis, recommendedSource:{url, type, category, listConfidence, selectors:{listItem,title,link,date,detailTitle,detailDate,selectorStable}}, score, grade, sourceActivated, ...}, updatedAt}]}`.
    현재 대부분 `selectors.*: null`, `selectorStable:false`, `grade` C/D → **활성화 후보로 부적합**.
  - `onboarding-queue.json` (202건): `{items:[{order, universityId, universityName, campusName, officialUrl, status:"pending", attemptCount, ...}]}` — 소스 미탐색 상태.
  - `collector-config-candidates.json` (4건): `{items:[{universityId, universityName, universityGroupId, finalDecision:"COLLECTOR_CONFIG_READY", source:{id, name, category, categoryLabel, sourceType, collectionType, listUrl, selectors{item,title,link,date,dateIndex?}, detailSelectors{title,date}, datePolicy?, verified:false, enabled:false, status:"collector_config_candidate", healthStatus:"unknown"}}]}`.
    **이 파일이 "완성된 소스 블록"을 가진 유일한 후보 소스**지만 데이터가 낡음: 4건 중
    `sungkyunkwan-university-natural-sciences` 는 이미 카탈로그에 `enabled:true` 로 활성화됨,
    나머지 3건(`daegu-catholic-university-본교`, `tongmyong-university-본교`, `korea-national-sport-university-본교`)은
    **카탈로그에 대학 블록 자체가 없음**.
  - `activation-ready-queue.json`, `onboarding-approval-queue.json`: 현재 `items: []`.
- 카탈로그(`university-news-sources.final.json`) 대학/소스 블록 스키마
  - 대학: `{universityId, universityGroupId, universityName, campusName, enabled, verificationStatus, healthStatus, sources:[...], searchKeywords, lastCheckedAt, lastSuccessfulCollectionAt, coverage:{schoolNews,schoolNotice,schoolEvent,mediaNews}}`.
  - 소스: `{id, name, category, sourceType, collectionType, listUrl|rssUrl, baseUrl?, selectors:{item,title,link,date?}, detailSelectors:{title,date}, titleCleanupTokens?, officialNames?, verified, enabled, status, healthStatus, notes?}`.
  - "검증됐지만 미활성" 관례 = `verified:true, enabled:false, status:"verified"` (예: `snu-school-news`) 또는
    `verified:false, enabled:false, status:"selector_required"` (예: `konkuk` 첫 소스).
- 테스트 구조: `package.json` `"test": "node --test"` (내장 러너, `*.test.js` 자동 탐색).
  gate 테스트 현재 66개(5파일). 시간/난수 고정 패턴:
  `const FIXED_NOW = new Date("2026-08-27T14:30:00.000Z"); const FIXED_RANDOM_BYTES = () => Buffer.from("a1b2c3","hex");`,
  임시 디렉터리 fixture + `readFileImpl`/`fetchImpl`/`*Impl` 주입.
- 스케줄러(`run-scheduled-news-update.js`): `getTargetUniversities()` 기반으로 수집 →
  `validateGenerated`(GENERATED 파일 JSON 파싱 + 신규 항목 publishedAt null 검사) →
  `runTests`(`npm test`) → `git add`(GENERATED 파일만) → `git commit` → `git push origin HEAD:main` → 배포.
  **소스 활성화 로직이 전혀 없다** — B1~B4 가 그 앞단을 채운다. (B5 스케줄러 워크트리 자동
  동기화는 이번 범위 아님.)

# 파일

## 신규 (제품 코드 + 테스트)

| 다리 | 파일 | 역할 |
|---|---|---|
| B1 | `server/agent/onboarding/tools/prepare-catalog-source-block.js` | 후보의 소스 블록을 카탈로그에 비활성 상태로 삽입 |
| B1 | `server/agent/onboarding/tools/prepare-catalog-source-block.test.js` | 단위 테스트 |
| B2 | `server/agent/onboarding/tools/build-review-packet-from-diagnose.js` | diagnose 실행 → 통과 시 `createAndWriteReviewPacket()` 호출 |
| B2 | `server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js` | 단위 테스트 |
| B3 | `server/agent/gate/brain-batch-approve.js` | **Brain 전용, 비배선** — 대기 패킷 목록 + 일괄 APPROVE 서명 |
| B3 | `server/agent/gate/brain-batch-approve.test.js` | 단위 테스트(`node --test` 로만 실행) |
| B4 | `server/agent/gate/apply-approved-activations.js` | verdict=APPROVE & 미적용 reviewId 순회 → `--apply` 배치 + 요약 리포트 |
| B4 | `server/agent/gate/apply-approved-activations.test.js` | 단위 테스트 |

## 신규 (데이터/큐, 최초 실행 시 자동 생성 — 커밋 안 함)

- `server/agent/onboarding/data/catalog-prepare-log.json` — B1 삽입 이력(append-only 감사 로그: `{preparedAt, universityId, sourceId, catalogBackupPath, checksumBefore, checksumAfter}`).
- `server/agent/gate/data/apply-batch-reports/<runId>.json` — B4 실행별 요약 리포트.
- `server/agent/gate/data/review-packets/`, `review-decisions/` — 기존 디렉터리 재사용.

## 수정 (제품 코드) — 최소 diff

- `server/agent/tools/run-single-school-trial.js` — **미해결 설계 결정 1 의 채택안에 따라** 둘 중 하나:
  - (권장안 A) `selectSource()` 에 `allowUnverifiedForDiagnose` 옵션을 추가하고,
    `parseOptions()` 에 `--allow-unverified-diagnose` 플래그를 추가해 `--diagnose` +
    `--source-id` + 이 플래그가 모두 있을 때만 `verified !== true` 소스도 후보로 인정
    (여전히 읽기 전용, `enabled`/저장 로직 불변). export 목록 변화 없음.
  - (대안 B) 수정 없음. 대신 B1 이 소스를 `verified:true, enabled:false, status:"verified"`
    로 삽입(기존 `snu-school-news` 관례와 gate 테스트 fixture 관례에 부합).
- `package.json` — 스크립트 3개 추가(B3 은 추가하지 않음):
  - `"news:onboard:prepare-source": "node server/agent/onboarding/tools/prepare-catalog-source-block.js"`
  - `"news:onboard:review-packet": "node server/agent/onboarding/tools/build-review-packet-from-diagnose.js"`
  - `"gate:apply-approved": "node server/agent/gate/apply-approved-activations.js"`

## 수정 (문서)

- 없음(필수 아님). `AGENTS.md`/`.claude/CLAUDE.md` 에 온보딩→게이트 배선 절 추가는
  사용자 승인 후 별도 처리.

## 건드리지 않음

- `server/agent/gate/` 기존 5개 모듈(호출만, 시그니처 변경 없음).
- `server/agent/scheduler.js`, `once.js`, `run-scheduled-news-update.js`, `runner.js`.
- `targets.js`, `store.js`.
- 봉쇄된 레거시 `activate-*.js` 17개, gutted `run-one-onboarding.js`.

# 구현 계획

## B1 — `prepare-catalog-source-block.js`

**목적**: 온보딩 검증을 통과한 후보 1건의 소스 블록을 카탈로그에 **비활성** 상태로
삽입해, `apply-source-activation.js` 의 `findSourceInCatalog(catalog, {universityId, sourceId})`
가 나중에 그 소스를 찾을 수 있게 한다. catalog 최소 diff, 다른 대학/다른 소스 불변.

**입력 소스**: `collector-config-candidates.json` 의 `finalDecision === "COLLECTOR_CONFIG_READY"`
항목(스키마상 완성된 `source` 블록 보유). (미해결 설계 결정 2: 다른 큐도 지원할지)

**CLI**
```
node .../prepare-catalog-source-block.js --university-id=<id> --source-id=<id> [--candidate-file=<path>] [--dry-run]
```

**함수 시그니처(제안)**
```js
// 순수: 후보 → 카탈로그에 삽입할 소스 블록(정규화). 이미 카탈로그 관례에 맞게 필드 정리.
function normalizeCandidateSourceBlock(candidate, { allowUnverifiedForDiagnose = true } = {}) → sourceBlock
//   sourceBlock = { ...candidate.source, verified: <결정 1 채택안>, enabled: false,
//                   status: "selector_required" | "verified", healthStatus: "unknown" }

// 순수: 카탈로그 객체에 소스 블록 삽입(부수효과 없음). 반환: 새 catalog 객체.
function insertSourceBlock(catalog, { universityId, sourceId }, sourceBlock) → catalog
//   - 대학 블록이 없으면 throw("university block not found ...") — 대학 블록 자동 생성 안 함(결정 3)
//   - 같은 sourceId 가 이미 있으면 throw (중복 삽입 금지, append-only)
//   - university.sources 배열에만 push, 그 외 필드/다른 대학 불변

// 부수효과: 백업 → 원자적 쓰기 → 검증 → 감사 로그 append
function prepareCatalogSourceBlock({
  universityId, sourceId, candidateFile, dryRun = false,
  catalogFile = DEFAULT_SOURCE_CATALOG_FILE,
  backupDirImpl, now = () => new Date(), readFileImpl = fs.readFileSync,
  writeFileImpl = fs.writeFileSync, renameImpl = fs.renameSync, copyFileImpl = fs.copyFileSync,
}) → { status: "PREPARED"|"DRY_RUN", universityId, sourceId, catalogBackupPath, checksumBefore, checksumAfter, sourceBlock }
```

**절차**
1. 후보 파일에서 `universityId`+`sourceId` 항목 조회. 없으면 실패 종료(exit 1, JSON 에러).
2. `finalDecision` 이 통과 상태가 아니면 거부.
3. 카탈로그 읽기 → `insertSourceBlock` 으로 새 객체 생성(대학 블록 없음/중복 소스면 여기서 실패).
4. `--dry-run` 이면 diff 요약만 출력하고 종료(쓰기 없음).
5. 아니면: 카탈로그를 `<catalog>.prepare-backup.<stamp>` 로 복사 → `JSON.parse` 검증
   → `<catalog>.tmp` 에 `JSON.stringify(catalog, null, 2) + "\n"` 쓰기 → `JSON.parse` 검증
   → `rename`. (gate `writeJsonAtomic` 와 동일 패턴, 필요 시 그대로 재사용.)
6. `catalog-prepare-log.json` 에 이력 append.
7. stdout 에 결과 JSON 출력. `mutation` 선언 필드 포함(`{enabled:false, verified:false 또는 결정1값, store:false, preview:false, git:false, deploy:false}`).

**완료 기준**
- 삽입 후 카탈로그를 `JSON.parse` 했을 때 대상 대학의 `sources` 에 `sourceId` 가 존재하고
  `enabled === false`.
- 다른 모든 대학/소스의 canonical 직렬화 값이 삽입 전과 동일(테스트에서 전수 비교).
- `insertSourceBlock` 이 대학 블록 없음/중복 소스에서 throw.
- `--dry-run` 실행 후 카탈로그 파일 mtime 불변.

**테스트 방법** (임시 fixture 카탈로그)
- 최소 카탈로그 fixture(대학 2개, 소스 각 1개) + 후보 fixture 로 삽입 → 대상 소스만 추가됐고
  무관한 대학 불변 확인.
- 대학 블록 없는 후보 → throw.
- 이미 있는 sourceId → throw.
- `--dry-run` → mtime/내용 불변.
- 삽입된 블록이 `run-single-school-trial.js selectSource()` 후보 조건을 만족하는지
  (결정 1 채택안에 맞춰) 단언.

## B2 — `build-review-packet-from-diagnose.js`

**목적**: B1 이 삽입한(또는 이미 카탈로그에 있는 미활성) 소스에 대해
`run-single-school-trial.js --diagnose` 를 실행하고, **통과한 경우에만**
gate `createAndWriteReviewPacket()` 을 호출해 `review-packets/<reviewId>.json` 을 만든다.
통과 못 한 후보는 패킷을 만들지 않는다.

**CLI**
```
node .../build-review-packet-from-diagnose.js --university-id=<id> --source-id=<id> [--limit=3] [--min-accepted=2] [--skip-npm-test]
```

**함수 시그니처(제안)**
```js
// diagnose 결과 객체(run-single-school-trial 두 번째 JSON) → 통과 판정
function evaluateDiagnose(diagnoseResult, source, robotsEvidence, { minAccepted = 2 } = {}) → {
  passed: boolean,
  checks: {
    itemsCollected: diagnoseResult.foundCount > 0,
    accepted: diagnoseResult.acceptedCount >= minAccepted,        // 셀렉터 안정 휴리스틱(diagnose-source.js 의 ">=2 PASS" 관례)
    allPublishedAt: !diagnoseResult.diagnostics.some(d => d.reason === "published_at_not_found"),
    noSelectorMismatch: !diagnoseResult.diagnostics.some(d => d.reason === "detail_title_or_university_mismatch"),
    robotsOk: robotsEvidence.checked === true && !robotsEvidence.unavailable && robotsEvidence.policy?.blocked !== true,
    jsRuleOk: source.jsDetailLinkRule?.enabled !== true || <jsRuleEvidence 충분>,
  },
  reasons: string[],
}

// diagnose 실행(child_process). 테스트에서 runnerImpl 주입.
function runDiagnose({ universityId, sourceId, limit, runnerImpl }) → { command: string, result: object, rawStdout: string }

// robots.txt 재확인. 테스트에서 fetchImpl 주입. classifyRobotsFetchResult 재사용.
async function collectRobotsEvidence(source, { fetchImpl, timeoutMs = 15000 }) → robotsEvidence

// npm test 실행 → regressionEvidence. 테스트에서 npmTestImpl 주입.
function collectRegressionEvidence({ npmTestImpl, now }) → { npmTestCommand, npmTestSummary, ranAt }
//   npmTestSummary 는 반드시 "... fail N" 형태(node --test tap: "# fail 0")를 포함해야 함

async function buildReviewPacketFromDiagnose({
  universityId, sourceId, limit = 3, minAccepted = 2, skipNpmTest = false,
  catalogFile, storeFile, previewFile, dataDir,
  runnerImpl, fetchImpl, npmTestImpl, now = () => new Date(), randomBytesImpl,
}) → { status: "PACKET_CREATED"|"DIAGNOSE_FAILED", reviewId?, writtenPath?, evaluation }
```

**절차**
1. 카탈로그에서 소스 블록 로드(`findSourceInCatalog` 재사용). `sourceSnapshot` = 그 블록 전체.
2. `runDiagnose()` → diagnose 결과 파싱(stdout 마지막 JSON 객체).
3. `collectRobotsEvidence()` → `classifyRobotsFetchResult` 결과 그대로.
4. `evaluateDiagnose()` → `passed === false` 면 `DIAGNOSE_FAILED` 로 종료(패킷 미생성, exit 1).
5. `collectRegressionEvidence()`(`--skip-npm-test` 면 호출자가 `regressionEvidence` 를 명시 주입해야 함 — 미주입 시 실패).
6. `createAndWriteReviewPacket({ universityId, universityGroupId, sourceId, sourceSnapshot,
   diagnostics: { command, rawOutput: diagnoseResult, foundCount, acceptedCount, newCount,
   duplicateCount, excludedCount, acceptedNewItemsForSave: <accepted 항목들, saveNewItems 입력 형태> },
   robotsEvidence, jsRuleEvidence, regressionEvidence,
   paths: { sourceCatalogFile, storeFile, previewFile }, now, randomBytesImpl }, { dataDir })`.
   - `acceptedNewItemsForSave`: diagnose 는 accepted 항목을 결과 JSON 에 직접 담지 않으므로,
     B2 는 `diagnostics[]` 의 `storable === true` 항목에서 `{title, sourceUrl, publishedAt, universityId, universityGroupId, category, sourceId}` 를 재구성한다.
     (미해결 설계 결정 4: diagnose 가 accepted 원본 항목을 출력하도록 `run-single-school-trial.js` 를
     확장할지 vs B2 가 재구성할지.)
7. stdout 에 결과 JSON 출력.

**완료 기준**
- 통과 후보 → `review-packets/<reviewId>.json` 생성, `computePacketSha256` 자체 검증 통과,
  `packet.mutation` 전부 false, `packet.regressionEvidence.npmTestSummary` 가 `fail 0`.
- 미통과 후보(수집 0건 / publishedAt 누락 / accepted < minAccepted / robots unavailable/blocked)
  → 패킷 파일이 생성되지 않음(디렉터리에 새 파일 0개).
- 시간/난수 주입으로 `reviewId` 가 결정적.

**테스트 방법**
- `runnerImpl` 로 가짜 diagnose 결과(통과/각 실패 케이스) 주입, `fetchImpl` 로 robots 응답 모킹,
  `npmTestImpl` 로 `"# fail 0"` / `"# fail 1"` 주입.
- 통과 케이스: 임시 `dataDir` 에 패킷 1개 생성 확인 + 필드 단언.
- robots unavailable, publishedAt 누락, accepted 부족 각각 → 패킷 미생성 확인.
- `npmTestImpl` 가 `fail 1` → `buildReviewPacket` 이 throw(패킷 미생성) 확인.

## B3 — `brain-batch-approve.js` (Brain 전용, 비배선)

**목적**: 판정 대기(패킷은 있으나 `review-decisions/<reviewId>.json` 이 없는) 목록을
보여주고, Brain(서명 키 보유)이 여러 건을 한 번에 APPROVE 서명하도록 돕는다.
**서명·판정 파일 생성은 인가된 실행 컨텍스트(`UNIPICK_GATE_SIGNING_KEY` 보유)에서만
가능**하며, `package.json`/온보딩 도구/`server/agent/tools/**` 어디에도 배선하지 않는다.
`review-decision-writer.js` 만 `require` 한다.

**CLI**
```
node server/agent/gate/brain-batch-approve.js --list
node server/agent/gate/brain-batch-approve.js --approve --review-ids=<id1,id2,...> --reviewed-by=<name> --reason="..." [--checked-items-file=<path>]
node server/agent/gate/brain-batch-approve.js --approve --all-pending --reviewed-by=<name> --reason="..."
```

**함수 시그니처(제안)**
```js
// 패킷은 있으나 판정 파일이 없는 reviewId 목록 + 패킷 요약(scope, diagnostics 카운트, robotsEvidence 요약, regression 요약)
function listPendingReviews({ dataDir, readFileImpl, existsImpl, readdirImpl }) → [{ reviewId, scope, summary }]

// 한 건 서명. writeReviewDecision 래퍼. checkedItems 기본값 = 전부 false(호출자가 override).
function approveOne(reviewId, {
  dataDir, reviewedBy, reasons, checkedItems = { robotsPolicyViolation:false, jsRuleUnverified:false, diagnoseFailed:false },
  signingKey = loadSigningKeyFromEnv(process.env), now,
}) → { reviewId, verdict:"APPROVE", writtenPath }

// 여러 건 순회. 한 건 실패해도 나머지 진행. 요약 반환.
function batchApprove(reviewIds, options) → { approved: [...], failed: [{ reviewId, error }] }
```

**절차/원칙**
- `--list`: `listPendingReviews()` 결과를 사람이 읽기 좋게 출력(패킷 근거 요약 포함) + 전체 JSON.
- `--approve`: 서명 키가 없으면(`loadSigningKeyFromEnv` null) 즉시 종료(exit 1,
  `SIGNING_KEY_UNAVAILABLE`) — 서명 없이 아무 파일도 만들지 않는다.
- `reviewedBy` 가 블록리스트면 `writeReviewDecision` 이 거부(재확인).
- 각 건은 `writeReviewDecision` 이 패킷 sha256 재검증 + 위반/verdict 일관성 검증을 수행.
- 이미 판정 파일이 있는 reviewId 는 건너뛰고 기록(append-only).
- HOLD/REJECT 는 이 도구 범위 밖(일괄 승인 전용). 필요 시 `--verdict` 를 열되 기본 APPROVE.

**완료 기준**
- `--list` 가 대기 패킷만 정확히 나열(판정 파일 있는 건 제외).
- `--approve` 로 N건 서명 시 `review-decisions/<id>.json` N개 생성, 각 서명이
  `verifyDecisionSignature` 통과.
- 서명 키 미설정 환경에서 `--approve` → 파일 0개 생성 + `SIGNING_KEY_UNAVAILABLE`.
- 이 파일이 `package.json` 및 온보딩/tools 코드 어디에서도 `require` 되지 않음(리뷰 + grep).

**테스트 방법**
- 임시 `dataDir` 에 패킷 2개 + 그중 1개는 판정 파일 존재 → `--list` 가 1개만 반환.
- 더미 키 주입 → `batchApprove(["id1","id2"])` → 2개 판정 파일 + 서명 검증 통과.
- 키 없음(`env` 주입 `{}`) → `approveOne` 이 `SIGNING_KEY_UNAVAILABLE` 로 실패, 파일 미생성.
- 위반 플래그 true + APPROVE → `writeReviewDecision` 거부 확인.

## B4 — `apply-approved-activations.js`

**목적**: `verdict === "APPROVE"` 이고 아직 적용 안 된(`<reviewId>.applied.json` 없음)
reviewId 를 전부 순회하며 `runAllGuards` + `performActivationAndSave` 를 실행.
성공/실패/롤백 요약 리포트를 남긴다. STALE 패킷·서명 실패는 건너뛰고 기록만 한다.

**CLI**
```
node server/agent/gate/apply-approved-activations.js            # 검증만(각 건 --apply 없이 runAllGuards)
node server/agent/gate/apply-approved-activations.js --apply    # 검증 통과 건만 실제 적용
node server/agent/gate/apply-approved-activations.js --apply --stop-on-first-applied   # 첫 성공 후 중단(STALE 연쇄 회피)
```

**함수 시그니처(제안)**
```js
// review-decisions/ 스캔 → 적용 대상 reviewId 목록
function listApprovedUnapplied({ dataDir, readFileImpl, existsImpl, readdirImpl }) → [{ reviewId, decisionPath }]

// 한 건 처리. runAllGuards 실패 시 {status:"SKIPPED", code, reasons}. apply 성공 시 {status:"APPLIED", saveResult, backupDir}.
// GateApplyFailure 발생 시 {status:"APPLY_FAILED", code, rollback, backupDir}.
function applyOne(reviewId, { apply, dataDir, sourceCatalogFile, storeFile, previewFile, env,
  runAllGuardsImpl, performActivationAndSaveImpl, nowImpl }) → result

function applyApprovedActivations({
  apply = false, stopOnFirstApplied = false, dataDir, sourceCatalogFile, storeFile, previewFile, env,
  runId = `apply-${<stampFromNow>}`, now,
  runAllGuardsImpl = runAllGuards, performActivationAndSaveImpl = performActivationAndSave,
}) → {
  runId, startedAt, finishedAt,
  applied: [{ reviewId, saveResult, backupDir }],
  skipped: [{ reviewId, code, reasons }],        // STALE_REVIEW_PACKET_INVALIDATED / SIGNATURE_* / NO_DECISION_YET 등
  failed:  [{ reviewId, code, rollback, backupDir }],
  targetUniversityCountBefore, targetUniversityCountAfter,   // getTargetUniversities().length
}
```

**절차**
1. `listApprovedUnapplied()`.
2. `getTargetUniversities().length` 를 before 로 기록.
3. 각 reviewId:
   - `runAllGuardsImpl(reviewId, {dataDir, sourceCatalogFile, storeFile, previewFile, env})`.
   - `failed === true` → `skipped[]` 에 `{reviewId, code, reasons}` 기록, 다음 건으로.
     (`STALE_REVIEW_PACKET_INVALIDATED`, `SIGNATURE_MISSING/INVALID`, `SIGNING_KEY_UNAVAILABLE`,
     `VERDICT_NOT_APPROVED`, `REVIEWER_BLOCKED` 모두 여기서 skip+기록.)
   - 통과 + `!apply` → `skipped[]` 에 `{code:"VALIDATED_NOT_APPLIED"}` 로 기록(검증 전용 실행).
   - 통과 + `apply` → `performActivationAndSaveImpl(guard.packet, {reviewId, dataDir, sourceCatalogFile, storeFile, previewFile})`.
     - 성공 → `applied[]` 기록. `stopOnFirstApplied` 면 루프 중단.
     - `GateApplyFailure` → `failed[]` 에 `{code, rollback, backupDir}` 기록. `rollback === "success"`
       면 다음 건 계속, `ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED` 면 즉시 중단(exit 1).
4. `getTargetUniversities().length` 를 after 로 기록.
5. `apply-batch-reports/<runId>.json` 에 요약 저장(`writeJsonOnce`).
6. stdout 에 요약 JSON. 실패/롤백 있으면 exit 1.

**STALE 연쇄에 대한 명시적 처리**
- 첫 apply 성공 시 카탈로그 파일 바이트가 바뀌므로, 같은 실행 내 **나머지 APPROVE 패킷은
  전부 `STALE_REVIEW_PACKET_INVALIDATED` 로 skip 된다**. 이는 게이트의 의도된 동작이다.
- B4 는 이를 정상 흐름으로 간주하고 `skipped[]` 에 STALE 로 기록한다. 나머지 건을 적용하려면
  운영자가 B1/B2 를 다시 돌려(새 카탈로그 상태 기준) 새 reviewId 패킷을 만들고 B3 재서명 후
  B4 를 다시 실행한다. `--stop-on-first-applied` 는 이 재작업 단위를 1건으로 명확히 하기 위한 옵션.
- (선택, 미해결 설계 결정 5) B4 가 각 apply 성공 후 남은 대상에 대해 B2 재실행 + B3 는
  사람 대기로 두는 반복 루프는 이번 범위에서 제외. 필요 시 후속 라운드.

**완료 기준**
- APPROVE + 미적용 1건에 대해 `--apply` 실행 시 `performActivationAndSave` 호출,
  `<reviewId>.applied.json` 생성, `getTargetUniversities().length` 가 43 → 44(fixture 기준
  before → before+1).
- `--apply` 없이 실행 시 카탈로그/store/preview mtime 불변, 모든 건 `VALIDATED_NOT_APPLIED` 또는 skip.
- STALE/서명 실패 건은 `skipped[]` 에 코드와 함께 기록되고 예외를 던지지 않음.
- 2건 이상 APPROVE 상태에서 `--apply` → 1건 `applied`, 나머지 `skipped(STALE)`.
- 리포트 파일이 `apply-batch-reports/<runId>.json` 에 생성.

**테스트 방법** (`apply-source-activation.test.js` 의 fixture 헬퍼 재사용)
- fixture 카탈로그(대상 대학 N개 활성) + 패킷/판정 fixture 2개(둘 다 APPROVE 서명) →
  `applyApprovedActivations({apply:true, ...})` → `applied.length === 1`,
  `skipped` 에 나머지 1건 `STALE_REVIEW_PACKET_INVALIDATED`.
- `targetUniversityCountAfter === targetUniversityCountBefore + 1`.
- `--apply` 없이 → mtime 불변, `applied.length === 0`.
- 서명 없는 판정 fixture → `skipped` 에 `SIGNATURE_MISSING`, 예외 없음.
- `saveNewItemsImpl` 이 throw 하도록 주입 → `failed[]` 에 `SAVE_FAILED_ROLLBACK_SUCCESS`,
  카탈로그 `enabled:false` 로 롤백 확인.

## 배선 순서(구현 권장 순서)

1. 미해결 설계 결정 1~5 를 사용자/Brain 이 확정.
2. B1 구현 + 테스트 → `node --check` + 대상 테스트.
3. (결정 1 A안이면) `run-single-school-trial.js` 최소 수정 + 기존 테스트 회귀 확인.
4. B2 구현 + 테스트.
5. B4 구현 + 테스트(B3 없이도 서명 fixture 로 검증 가능).
6. B3 구현 + 테스트.
7. 전체 `npm test` 3회 반복 실행(결정성 확인).
8. B1→B2 시연용 통합 테스트 1개(임시 fixture, 네트워크 모킹) 작성:
   후보 → B1 삽입 → B2 diagnose(모킹) 통과 → 패킷 생성까지.
9. 수동 서명(B3 더미 키) → B4 `--apply` → 대상 +1 시연 통합 테스트 1개.
10. `.pipeline/changes.md` 작성.

# 예외 상황

| 상황 | 처리 |
|---|---|
| B1: 후보의 대학 블록이 카탈로그에 없음 | `insertSourceBlock` throw, exit 1. 대학 블록 자동 생성 안 함(최소 diff, 결정 3). |
| B1: 같은 sourceId 가 이미 카탈로그에 존재 | throw(중복 삽입 금지). 이미 활성(`enabled:true`)이면 별도 코드로 안내. |
| B1: 카탈로그 원자적 쓰기 중 `JSON.parse` 검증 실패 | tmp 파일 폐기, 원본 불변, exit 1. 백업은 이미 떠 있음. |
| B1: 후보 파일에 항목 없음 / `finalDecision` 미통과 | exit 1, JSON 에러. 카탈로그 불변. |
| B2: diagnose 가 네트워크 실패로 수집 0건 | `evaluateDiagnose.passed=false` → 패킷 미생성, exit 1. |
| B2: 일부 항목 `publishedAt` 누락(`reason:"published_at_not_found"`) | 패킷 미생성(요구사항: 모든 항목 publishedAt 필수). |
| B2: robots.txt 확인 불가(`ROBOTS_UNAVAILABLE`) 또는 `policy.blocked` | 패킷 미생성(robots 위반 없음 조건 불충족). |
| B2: `jsDetailLinkRule.enabled === true` 인데 jsRuleEvidence 없음 | `evaluateDiagnose` 에서 실패 처리 → 패킷 미생성(`buildReviewPacket` 도 이중 차단). |
| B2: `npm test` 가 `fail > 0` 또는 요약 파싱 불가 | `buildReviewPacket` 이 throw → 패킷 미생성. 회귀 상태에서 활성화 진입 원천 차단. |
| B2: `run-single-school-trial selectSource` 가 verified 아님으로 throw | 결정 1 미채택 시 발생하는 버그. 채택안에 따라 A(플래그) 또는 B(verified:true 삽입)로 해소. |
| B2: 같은 소스로 두 번 실행 | 새 `reviewId`(타임스탬프+난수)로 새 패킷 생성됨 — 중복 패킷 누적 가능. `--list`(B3)/B4 가 최신만 쓰도록? → 결정 6. |
| B3: 서명 키 미설정 | `SIGNING_KEY_UNAVAILABLE`, 파일 0개 생성, exit 1. |
| B3: `reviewedBy` 블록리스트 | `writeReviewDecision` 거부, 해당 건만 실패 기록, 나머지 진행. |
| B3: 패킷 sha256 자체 검증 실패(패킷 손상) | 해당 건 실패 기록, 판정 파일 미생성. |
| B3: 판정 파일 이미 존재 | 건너뛰고 기록(append-only). |
| B4: 첫 apply 성공 후 나머지 STALE | 정상 동작. `skipped[]` 에 STALE 기록. 재작업은 B1/B2/B3 재실행. |
| B4: `performActivationAndSave` 중 `saveNewItems` 실패 | 게이트가 3파일 백업 롤백 + `enabled` 원복. B4 는 `failed[]` 기록 후 다음 건 계속. |
| B4: 롤백 자체 실패(`ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED`) | 즉시 중단, exit 1, 수동 개입 안내. |
| B4: 판정은 APPROVE 인데 패킷/판정 reviewId 불일치 | `runAllGuards` 가 `REVIEW_ID_MISMATCH` → skip 기록. |
| B4: 서명 키가 apply 실행 컨텍스트에 없음 | `runAllGuards` 가 `SIGNING_KEY_UNAVAILABLE` → 모든 건 skip, 파일 불변. |
| 동시 실행(B1 과 스케줄러, 또는 B4 2개) | B1/B4 는 원자적 쓰기 + 게이트 staleness 재검증으로 부분 손상 방지. 명시적 락은 이번 범위 밖(스케줄러 `acquireRuntimeLock` 은 B4 에 재사용 검토 가능 — 결정 7). |
| 시연용 실데이터 후보 부재(큐가 낡음) | 완료 기준을 "동등한 단위/통합 테스트(임시 fixture)"로 충족. 실제 44번째 대학 활성화는 사용자 승인 후 별도. |

# 완료 기준

1. `server/agent/onboarding/tools/prepare-catalog-source-block.js` + `.test.js`,
   `server/agent/onboarding/tools/build-review-packet-from-diagnose.js` + `.test.js`,
   `server/agent/gate/brain-batch-approve.js` + `.test.js`,
   `server/agent/gate/apply-approved-activations.js` + `.test.js` 가 위 설계대로 구현되고
   전부 `node --check` 통과.
2. **B1→B2 시연**: 통합 테스트 1개가 (임시 fixture 카탈로그 + 후보 fixture + diagnose/robots/npm test
   모킹) 후보 1건을 B1 삽입 → B2 통과 → `review-packets/<reviewId>.json` 생성까지 재현하고,
   패킷 `packetSha256` 자체 검증·`mutation` 전부 false·`regressionEvidence` fail 0 을 단언.
3. **B2 미통과 차단**: publishedAt 누락 / 수집 0건 / robots unavailable / accepted 부족
   각각에 대해 패킷 파일이 생성되지 않음을 테스트로 증명.
4. **B4 apply 시연**: 수동 서명(B3 또는 더미 키)된 APPROVE 판정 1건을 B4 `--apply` 가
   적용해 fixture 기준 `getTargetUniversities().length` 가 `before → before+1`(43→44 상당)로
   증가하고 `<reviewId>.applied.json` 이 생성됨을 테스트로 증명.
5. **B4 안전성**: `--apply` 없이 실행 시 카탈로그/store/preview mtime 불변;
   STALE·`SIGNATURE_MISSING` 건은 예외 없이 `skipped[]` 기록;
   `saveNewItems` 실패 시 `enabled:false` 롤백 확인.
6. **B3 비배선**: `brain-batch-approve.js` 와 `review-decision-writer.js` 가 `package.json`
   스크립트 및 `server/agent/onboarding/**`, `server/agent/tools/**`, `server/agent/scheduler.js`,
   `runner.js` 어디에서도 `require` 되지 않음을 grep + 코드 리뷰로 확인.
   서명 키 미설정 시 판정 파일이 생성되지 않음을 테스트로 증명.
7. **B3 서명 검증**: 더미 키로 서명한 판정이 `verifyDecisionSignature` 및
   `apply-source-activation.runAllGuards` 를 통과.
8. **회귀 없음**: 전체 `npm test` 가 3회 연속 결정적으로 통과(기존 gate 66 테스트 포함,
   시간/난수 미고정으로 인한 flaky 0건). 신규 테스트가 실제 프로덕션
   카탈로그/store/preview/네트워크를 건드리지 않음(fixture + 주입만).
9. `package.json` 에 `news:onboard:prepare-source`, `news:onboard:review-packet`,
   `gate:apply-approved` 3개 스크립트만 추가(B3 스크립트 없음). JSON 유효성 검증 통과.
10. `run-single-school-trial.js` 를 수정한 경우(결정 1 A안), 기존
    `run-single-school-trial.test.js` 가 무수정 통과하고 `--diagnose` 읽기 전용성
    (`saveNewItems`/`backupBeforeSave` 미호출)이 유지됨.
11. `.pipeline/changes.md` 에 변경 파일·이유·`node --check`/`npm test` 결과·미구현 항목 기록.
12. git add/commit/push/배포 미실행. `server/agent/gate/data/` 커밋 미실행.

# 확정된 설계 결정 (2026-08-28, 사용자 승인)

1. **B1 verified 값 / diagnose 호출** — **A안 채택**: B1 은 `verified:false,
   status:"selector_required", enabled:false` 로 삽입한다. `run-single-school-trial.js`
   에 `--allow-unverified-diagnose` 읽기 전용 플래그(+ `selectSource(university,
   sourceId, { allowUnverifiedForDiagnose })` 옵션)를 최소 추가해 `--diagnose` +
   `--source-id` + 이 플래그가 모두 있을 때만 `verified !== true` 소스도 후보로
   인정한다. `enabled`/저장/`assertSourceEnabledForSave` 로직은 불변, export 목록 변화 없음.
2. **B1 입력 후보 / 대학 블록 생성** — `collector-config-candidates.json` 의
   `finalDecision === "COLLECTOR_CONFIG_READY"` 항목만 지원. **대학 블록이 카탈로그에
   없으면 `insertSourceBlock` 이 throw(exit 1). B1 은 대학 블록을 생성하지 않는다.**
   `onboarding-review-queue.json` 승격은 이번 범위 밖. 시연은 임시 fixture 기반.
3. **`acceptedNewItemsForSave` 확보** — **B2 가 재구성**한다. `run-single-school-trial.js`
   는 이 목적으로 수정하지 않는다. B2 는 diagnose 결과의 `diagnostics[]` 중
   `storable === true` 항목에서 `{title, sourceUrl, publishedAt, universityId,
   universityGroupId, category, sourceId}` 를 재구성하고, 재구성 필드 정확성을
   단위 테스트로 단언한다.
4. **나머지 세부 결정 — 전부 제안 기본값 채택:**
   - (결정 5) B2 통과 기준: `acceptedCount >= 2`, `--limit` 기본 3.
   - (결정 6) 중복 패킷: B3 `--list` / B4 는 **소스별(`universityId+sourceId`) 최신
     `reviewId` 패킷 1개만** 취급한다(생성 시각 기준). 나머지는 목록에서 제외.
   - (결정 7) B4 에 스케줄러의 `acquireRuntimeLock`/`releaseRuntimeLock` 을 재사용해
     스케줄러 수집과 B4 활성화가 동시에 돌지 않게 한다. 락 획득 실패 시 exit 1,
     아무것도 적용하지 않는다. 테스트에서 lock impl 주입.
   - (결정 8) npm 스크립트 이름: `news:onboard:prepare-source`,
     `news:onboard:review-packet`, `gate:apply-approved` 3개만 신규 추가. B3 스크립트 없음.
   - (결정 9) `AGENTS.md`/`.claude/CLAUDE.md` 문서 갱신은 하지 않는다. `.pipeline/changes.md` 만 작성.

---

# (참고) 원래 질문사항 — 위에서 전부 확정됨

**미해결 설계 결정(구현 착수 전 확정 필요) — 임의 추측 금지:**

1. **B1 이 삽입하는 소스의 `verified` 값 / B2 의 diagnose 호출 방식.**
   요청문은 "enabled:false / verified:false" 를 명시했으나, `run-single-school-trial.js`
   `selectSource()` 는 `verified !== true` 소스를 `--diagnose` 에서도 즉시 거부한다.
   - A안(권장): B1 은 `verified:false, status:"selector_required"` 로 삽입하고,
     `run-single-school-trial.js` 에 `--allow-unverified-diagnose` 읽기 전용 플래그를 최소 추가.
   - B안: B1 이 `verified:true, enabled:false, status:"verified"` 로 삽입(기존 `snu-school-news`
     및 gate 테스트 fixture 관례와 일치, `run-single-school-trial` 무수정). 이 경우
     "verified:false" 요구와 어긋남 — 승인 필요.
   어느 쪽으로 갈지 확정 바람.

2. **B1 의 입력 후보 소스.** `collector-config-candidates.json`(완성된 소스 블록 4건, 단
   데이터 낡음) 하나만 지원할지, `onboarding-review-queue.json`(81건, 대부분 selectors null)
   에서도 `selectorStable === true && grade ∈ {A,B}` 등 기준으로 승격 지원할지.
   후자면 큐 selector 스키마(`{listItem,title,link,date,detailTitle,detailDate}`) →
   카탈로그 스키마(`selectors{item,title,link,date}` + `detailSelectors{title,date}`) 매핑
   규칙을 확정해야 함.

3. **B1 이 카탈로그에 없는 대학 블록을 만들 수 있는지.** `collector-config-candidates.json`
   4건 중 3건은 대학 블록 자체가 카탈로그에 없음. 대학 블록 생성은 "소스 최소 diff" 범위를
   넘어선다. 현재 계획은 "대학 블록 없으면 거부". 대학 블록 생성까지 B1 범위에 넣을지 확정 바람.

4. **`acceptedNewItemsForSave` 확보 방식.** diagnose 결과 JSON 은 accepted 원본 항목을
   담지 않는다(`diagnostics[]` 요약만). B2 가 `storable:true` 진단에서 항목을 재구성할지,
   아니면 `run-single-school-trial.js` 를 확장해 `--diagnose` 시에도 accepted 원본 배열을
   출력하게 할지. 재구성 시 카테고리/식별자 필드 정확성 확인 필요.

5. **B2 통과 기준 임계값.** "셀렉터 안정 = `acceptedCount >= 2`"(diagnose-source.js 관례
   차용)와 `--limit` 기본 3 을 그대로 쓸지, 다른 비율/최소값을 쓸지.

6. **중복 패킷 정책.** 같은 소스로 B2 를 여러 번 실행하면 `reviewId` 가 매번 달라 패킷이
   누적된다. B3 `--list` / B4 가 "소스별 최신 패킷 1개만" 취급할지, 전부 나열할지.

7. **B4 실행 락.** 스케줄러의 `acquireRuntimeLock`/`releaseRuntimeLock` 을 B4 에도 적용해
   스케줄러 수집과 B4 활성화가 동시에 돌지 않도록 할지(권장), 이번 범위 밖으로 둘지.

8. **npm 스크립트 이름.** 제안한 `news:onboard:prepare-source` /
   `news:onboard:review-packet` / `gate:apply-approved` 로 확정할지. 기존
   `news:onboard:prepare`(큐 생성용, 의미 다름)와 혼동 주의 — 재사용/개명 없이 신규 추가 권장.

9. **`.pipeline/changes.md` 외 문서 갱신.** `AGENTS.md`/`.claude/CLAUDE.md` 에 온보딩→게이트
   배선 흐름 절을 추가할지(사용자 승인 필요 항목).
