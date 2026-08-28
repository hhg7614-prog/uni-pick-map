# 테스트 요약

전체 결과: **합격 (PASS)**

- 신규/수정 `.js` 9개 전부 `node --check` 통과.
- `package.json` JSON 파싱 정상, 스크립트 정확히 3개만 추가(B3 스크립트 없음).
- 전체 `npm test` 3회 연속 실행 — 매회 `tests 274 / pass 274 / fail 0 / cancelled 0` 동일. flaky 없음.
- 완료 기준 1~12 전부 대응 테스트 존재 + 통과.
- 비배선(grep) 검증 통과: `brain-batch-approve.js` / `review-decision-writer.js` 는 배선 경로 어디에서도 require 되지 않음.
- 최소 diff 검증 통과: `run-single-school-trial.js` 변경은 플래그 + selectSource 옵션에 국한, export/저장/`assertSourceEnabledForSave` 불변.
- 테스트는 임시 fixture + 의존성 주입만 사용 — 프로덕션 카탈로그/store/preview/네트워크 미접근. `git status` 상 프로덕션 데이터 파일 변경 없음.

발견된 문제: **차단(blocker) 없음.** 경미한 위험 요소 3건은 아래 "위험 요소" 참조.

---

# 완료 기준

- 조건 1 (8개 파일 설계대로 구현 + `node --check`): **통과**
  - 9개 파일(`node --check`) 전부 OK. B1/B2/B3/B4 함수 시그니처가 spec "함수 시그니처(제안)"와 일치
    (`normalizeCandidateSourceBlock`, `insertSourceBlock`, `prepareCatalogSourceBlock`,
    `evaluateDiagnose`, `runDiagnose`, `collectRobotsEvidence`, `collectRegressionEvidence`,
    `reconstructAcceptedNewItems`, `buildReviewPacketFromDiagnose`,
    `listPendingReviews`, `approveOne`, `batchApprove`,
    `listApprovedUnapplied`, `applyApprovedActivations`).
- 조건 2 (B1→B2 시연 통합 테스트): **통과**
  - `build-review-packet-from-diagnose.test.js` > "B1 -> B2 demo: candidate -> prepare -> diagnose passes -> review packet created"
  - 단언: `computePacketSha256(packet) === packet.packetSha256`, `Object.values(packet.mutation).every(v=>v===false)`,
    `packet.regressionEvidence.npmTestSummary` 가 `/fail 0/`, `packet.scope.universityId`, `packet.sourceSnapshot.enabled === false`.
- 조건 3 (B2 미통과 차단 4케이스, 패킷 미생성): **통과**
  - "no packet when foundCount is 0" → `countPacketFiles === 0`
  - "no packet when an item is missing publishedAt" → `countPacketFiles === 0`
  - "no packet when robots.txt is unavailable" → `countPacketFiles === 0` + reason에 "robots"
  - "no packet when acceptedCount is below the minimum" → `countPacketFiles === 0`
  - (추가) "buildReviewPacket rejects (throws) ... when npm test reports fail > 0" → `countPacketFiles === 0`
- 조건 4 (B4 `--apply` 시연, before→before+1, `<reviewId>.applied.json`): **통과**
  - "--apply applies exactly one item; the rest go STALE; target university count goes before -> before+1"
    → `applied.length===1`, `targetUniversityCountAfter === before+1`, `<reviewId>.applied.json` 존재, 카탈로그 `source.enabled===true`
  - "integration demo: dummy-key-signed APPROVE is applied by --apply, target count +1, applied.json written" (더미 키 `signDecision` 직접 서명)
- 조건 5 (B4 안전성): **통과**
  - "no --apply: every guard-passing item is VALIDATED_NOT_APPLIED and files are untouched" → `mtimes` 불변
  - "an unsigned APPROVE decision is skipped with SIGNATURE_MISSING and throws nothing" → `skipped[0].code === "SIGNATURE_MISSING"`, mtime 불변, 예외 없음
  - "--apply applies exactly one item; the rest go STALE" → 나머지 `skipped[0].code === "STALE_REVIEW_PACKET_INVALIDATED"`, 예외 없음
  - "when saveNewItems throws ... SAVE_FAILED_ROLLBACK_SUCCESS ... catalog rolls back to enabled:false" → `failed[0].code === "SAVE_FAILED_ROLLBACK_SUCCESS"`, `rollback === "success"`, `source.enabled === false`
  - (추가) "a missing runtime lock aborts before anything is applied" → `RUNTIME_LOCK_UNAVAILABLE`, 카탈로그 불변
- 조건 6 (B3 비배선 + 키 미설정 시 파일 미생성): **통과**
  - "brain-batch-approve.js is not wired into package.json or code-agent execution paths"
    → `package.json` 에 `brain-batch-approve`/`review-decision-writer` 문자열 없음,
    scheduler/once/runner/run-scheduled-news-update/run-single-school-trial/prepare-catalog-source-block/
    build-review-packet-from-diagnose/apply-approved-activations/apply-source-activation 에 forbidden require 없음.
  - 독립 grep(아래 "재현 방법" 참조)에서도 동일 확인.
  - "approveOne / batchApprove refuse and write nothing when the signing key is unavailable"
    → `SIGNING_KEY_UNAVAILABLE`, `review-decisions/<id>.json` 미생성.
- 조건 7 (B3 더미 키 서명 → `verifyDecisionSignature` + `runAllGuards` 통과): **통과**
  - "batchApprove signs N decisions that pass verifyDecisionSignature and runAllGuards"
    → 각 판정 `verifyDecisionSignature(...) === true`, `runAllGuards(...).failed === false`.
- 조건 8 (전체 `npm test` 3회 결정적 통과 + 프로덕션 미접근): **통과**
  - 3회 모두 `tests 274 / pass 274 / fail 0 / cancelled 0`. 원본 출력 아래 첨부.
  - 신규 테스트는 `os.tmpdir()` + `fs.mkdtempSync` fixture + `runnerImpl`/`fetchImpl`/`npmTestImpl`/
    `acquireLockImpl`/`countTargetsImpl`/`*Impl` 주입만 사용. 프로덕션 카탈로그/store/preview/네트워크 미접근.
    테스트 실행 후 `git status` 상 프로덕션 데이터 변경/신규 데이터 파일 없음.
- 조건 9 (`package.json` 스크립트 3개만 추가, B3 없음, JSON 유효): **통과**
  - `news:onboard:prepare-source` → `node server/agent/onboarding/tools/prepare-catalog-source-block.js`
  - `news:onboard:review-packet` → `node server/agent/onboarding/tools/build-review-packet-from-diagnose.js`
  - `gate:apply-approved` → `node server/agent/gate/apply-approved-activations.js`
  - `brain`/`batch-approve` 계열 스크립트 0개. `JSON.parse` 정상.
- 조건 10 (`run-single-school-trial.js` 수정 시 기존 테스트 무수정 통과 + `--diagnose` 읽기 전용성 유지): **통과**
  - `git status`: `run-single-school-trial.js` 만 modified, `run-single-school-trial.test.js` 무수정.
  - 전체 스위트 274 통과에 기존 `run-single-school-trial.test.js` 포함.
  - `git diff` 상 변경은 `parseOptions` 에 `allowUnverifiedForDiagnose` 플래그, `selectSource` 3번째 옵션 인자,
    `main()` 의 `selectSource` 호출 인자(플래그를 `options.diagnose &&` 로 게이팅)뿐.
    `assertSourceEnabledForSave` 본문/`saveNewItems`/`backupBeforeSave`/`module.exports` 불변.
- 조건 11 (`.pipeline/changes.md` 기록): **통과**
  - 변경 파일 목록, 변경 내용, 변경 이유, `node --check` 결과, `npm test` 3회 표, 미구현 항목("없음"), 참고사항 포함.
- 조건 12 (git add/commit/push/배포 미실행, `server/agent/gate/data/` 커밋 미실행): **통과**
  - 이번 검증 중 어떤 git 상태 변경 명령도 실행하지 않음. `server/agent/gate/data/` 에 신규 추적 파일 없음.

---

# 실패한 테스트

없음.

- `node --check` 9/9 OK
- `npm test` 3회 연속 274/274 pass, 0 fail, 0 cancelled
- 개별 신규 테스트 카운트(스위트 내 포함): B1 11 + B2 13 + B3 8 + B4 9 = 41 (baseline 233 + 41 = 274, changes.md 기재와 일치)

## `npm test` 3회 원본 출력 (요약 라인)

```
===== RUN 1 =====
npm exit: 0
ℹ tests 274
ℹ pass 274
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 807.6185
===== RUN 2 =====
npm exit: 0
ℹ tests 274
ℹ pass 274
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 809.1009
===== RUN 3 =====
npm exit: 0
ℹ tests 274
ℹ pass 274
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 845.6718
```

(첫 실행 전체 tail 확인: `ℹ tests 274 / ℹ suites 0 / ℹ pass 274 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0`)

## `node --check` 원본 출력

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

## package.json 파싱 + 스크립트 확인 원본 출력

```
parse OK
news:onboard:prepare-source => node server/agent/onboarding/tools/prepare-catalog-source-block.js
news:onboard:review-packet => node server/agent/onboarding/tools/build-review-packet-from-diagnose.js
gate:apply-approved => node server/agent/gate/apply-approved-activations.js
brain/batch scripts: []
total scripts: 79
```

## 비배선(grep) 검증 원본 출력

```
$ grep -rn "require(.*\(review-decision-writer\|brain-batch-approve\)" \
    server/agent/onboarding server/agent/tools server/agent/scheduler.js \
    server/agent/runner.js server/agent/once.js \
    server/agent/tools/run-scheduled-news-update.js | grep -v "\.test\.js"
NO MATCHES (prod code)

$ grep -n "brain-batch-approve\|review-decision-writer" package.json
NO MATCHES (package.json)
```

`review-decision-writer` 를 require 하는 프로덕션 파일은 `server/agent/gate/brain-batch-approve.js` 하나뿐이며
(spec 46/330행: "review-decision-writer.js 만 require" 허용), 나머지 참조는 전부 `.test.js` 또는 주석
(`server/agent/tools/activate-*.js` 의 14행 주석 등)이다. `brain-batch-approve` 는 자기 자신의 테스트 외에는 어디에서도 require 되지 않는다.

## `run-single-school-trial.js` 최소 diff (git diff 발췌)

```
 function selectSource(university, sourceId, { allowUnverifiedForDiagnose = false } = {}) {
   const qualifying = (university.sources || []).filter(
-    (entry) => entry.sourceType === "official" && entry.verified && ["rss", "html"].includes(entry.collectionType)
+    (entry) =>
+      entry.sourceType === "official" &&
+      (entry.verified || (allowUnverifiedForDiagnose && Boolean(sourceId) && entry.id === sourceId)) &&
+      ["rss", "html"].includes(entry.collectionType)
   );
...
-  const source = selectSource(university, options.sourceId);
+  const source = selectSource(university, options.sourceId, {
+    allowUnverifiedForDiagnose: options.diagnose && options.allowUnverifiedForDiagnose,
+  });
```

`module.exports` 라인 무변경:
`module.exports = { assertSourceEnabledForSave, normalizeText, sameText, extractDetail, selectSource, titleMatches, universityNameMatches, backupBeforeSave };`

## git status (테스트 실행 후)

```
 M .pipeline/changes.md
 M .pipeline/spec.md
 M package.json
 M server/agent/tools/run-single-school-trial.js
?? .pipeline/merge-analysis.md
?? server/agent/gate/apply-approved-activations.js(.test.js)
?? server/agent/gate/brain-batch-approve.js(.test.js)
?? server/agent/onboarding/tools/build-review-packet-from-diagnose.js(.test.js)
?? server/agent/onboarding/tools/prepare-catalog-source-block.js(.test.js)
```
프로덕션 데이터 파일(`development/university-news/data/*.json`, `server/agent/data/*`, `data/*`) 변경 없음.
`server/agent/gate/data/`, `server/agent/onboarding/data/` 에 신규 추적 파일 없음(테스트가 tmpdir만 사용).

---

# 재현 방법

프로젝트 루트 `D:\hhg(code)` 에서:

1. 구문 검사
   ```
   for f in server/agent/onboarding/tools/prepare-catalog-source-block.js \
            server/agent/onboarding/tools/prepare-catalog-source-block.test.js \
            server/agent/onboarding/tools/build-review-packet-from-diagnose.js \
            server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js \
            server/agent/gate/brain-batch-approve.js \
            server/agent/gate/brain-batch-approve.test.js \
            server/agent/gate/apply-approved-activations.js \
            server/agent/gate/apply-approved-activations.test.js \
            server/agent/tools/run-single-school-trial.js; do node --check "$f"; done
   ```
2. `package.json` 파싱
   ```
   node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));['news:onboard:prepare-source','news:onboard:review-packet','gate:apply-approved'].forEach(k=>console.log(k,p.scripts[k]));console.log(Object.keys(p.scripts).filter(k=>/brain|batch-approve/.test(k)))"
   ```
3. 전체 테스트 3회
   ```
   for i in 1 2 3; do npm test 2>&1 | grep -E "tests [0-9]+|pass [0-9]+|fail [0-9]+"; done
   ```
4. 개별 스위트
   ```
   node --test server/agent/onboarding/tools/prepare-catalog-source-block.test.js
   node --test server/agent/onboarding/tools/build-review-packet-from-diagnose.test.js
   node --test server/agent/gate/brain-batch-approve.test.js
   node --test server/agent/gate/apply-approved-activations.test.js
   node --test server/agent/tools/run-single-school-trial.test.js
   ```
5. 비배선 grep
   ```
   grep -rn "require(.*\(review-decision-writer\|brain-batch-approve\)" server/agent/onboarding server/agent/tools server/agent/scheduler.js server/agent/runner.js server/agent/once.js | grep -v "\.test\.js"
   grep -n "brain-batch-approve\|review-decision-writer" package.json
   ```
6. 최소 diff
   ```
   git diff server/agent/tools/run-single-school-trial.js package.json
   ```

---

# 위험 요소

1. **B2 결정적 reviewId 단언이 로컬 타임존 의존적.**
   `build-review-packet-from-diagnose.test.js` 의 "writes a self-consistent packet" 테스트는
   `out.reviewId === "rp-test-university-test-press-20260828181500-a1b2c3"` 를 단언한다.
   `181500`(=18:15:00)은 `FIXED_NOW`(09:15:00Z) 를 `formatCompactTimestamp`(로컬시간 `getHours()` 등)로
   압축한 값이라 KST(UTC+9) 이외 타임존 CI에서는 이 한 테스트가 실패한다.
   입력값은 고정되어 있으므로 spec의 "시간/난수 주입 고정" 위반은 아니지만, 이식성/재현성 위험.
   → 권장: 해당 단언을 정규식(`/^rp-test-university-test-press-\d{14}-a1b2c3$/`)으로 완화하거나
   `process.env.TZ` 를 테스트에서 고정.

2. **자동 생성물이 `.gitignore` 에 없음.**
   `server/agent/onboarding/data/catalog-prepare-log.json`,
   `server/agent/gate/data/apply-batch-reports/*.json`,
   `development/university-news/data/university-news-sources.final.json.prepare-backup.*`
   는 실제 CLI 실행 시 생성되며 현재 무시 규칙이 없다(Coder가 changes.md에 명시). 운영자가 `git add .`
   하면 감사 로그/백업이 커밋될 수 있음. 완료 기준 위반은 아니나 운영 실수 위험.

3. **`collectRegressionEvidence` 기본 구현이 `execSync("npm test")`.**
   B2 를 `--skip-npm-test` 없이 실서버에서 실행하면 `npm test` 하위 프로세스가 다시 도는데, 만약 그 컨텍스트가
   `npm test` 안이라면 재귀 실행 위험. 테스트에서는 항상 `npmTestImpl` 주입이라 문제 없음. 실사용 문서화 필요.

4. (참고, 이번 범위 밖) `.pipeline/merge-analysis.md` 가 untracked 로 남아 있고 `origin/main` 과의
   카탈로그/store 병합이 미해결 상태. 이번 B1~B4 배선과 직접 충돌하진 않으나, B4가 실제로 프로덕션
   카탈로그에 쓰기 시작하기 전에 병합이 선행되어야 함(merge-analysis.md 결론과 동일).

---

# 최종 테스트 상태

**통과 (합격)**

- 완료 기준 1~12 전부 통과.
- 차단 결함 0건. 위 위험 요소 1~3은 후속 개선 권장 사항이며 이번 인수를 막지 않음.
