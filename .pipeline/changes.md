# 변경된 파일

## 신규 (server/agent/gate/)
- `server/agent/gate/checksum-utils.js`
- `server/agent/gate/checksum-utils.test.js`
- `server/agent/gate/signing-utils.js`
- `server/agent/gate/signing-utils.test.js`
- `server/agent/gate/review-packet.js`
- `server/agent/gate/review-packet.test.js`
- `server/agent/gate/review-decision-writer.js`
- `server/agent/gate/review-decision-writer.test.js` (spec.md 9번에는 명시돼 있지 않지만, 프로젝트 관례상 모든 모듈에 짝이 되는 `*.test.js`를 두는 패턴을 따라 추가 — "미구현/임의 결정 항목" 참고)
- `server/agent/gate/apply-source-activation.js`
- `server/agent/gate/apply-source-activation.test.js`
- `server/agent/gate/data/review-packets/.gitkeep`
- `server/agent/gate/data/review-decisions/.gitkeep` (실제 패킷/판정 파일은 이번 라운드에 만들지 않음 — 디렉터리 존재만 보장)

## 수정
- `server/agent/tools/run-single-school-trial.js` — `module.exports`에 `backupBeforeSave` 추가(그 외 어떤 줄도 변경하지 않음)
- `server/agent/onboarding/tools/activate-collector-ready.js` — 폐기 스텁으로 교체
- `server/agent/onboarding/tools/activate-kyungnam-general-feed.js` — 폐기 스텁으로 교체
- `server/agent/onboarding/tools/activate-dnue-general-feed.js` — 폐기 스텁으로 교체
- `server/agent/onboarding/tools/activate-youngsan-shared-feed.js` — 폐기 스텁으로 교체
- `server/agent/onboarding/tools/activate-mtu-general-feed.js` — 폐기 스텁으로 교체
- `server/agent/tools/run-uni-pick-next-batch-auto-resolution.js` — 폐기 스텁으로 교체
- `server/agent/onboarding/tools/run-one-onboarding.js` — 폐기 스텁으로 교체

`package.json`은 건드리지 않았습니다(지시대로). `review-decision-writer.js`는 어떤 `npm run` 스크립트/다른 온보딩 도구/`apply-source-activation.js`에서도 `require()`되지 않습니다(코드 검토로 확인 — 아래 참고 참조).

# 변경 내용

## checksum-utils.js
`canonicalStringify`(키 재귀 정렬 JSON 직렬화), `sha256Hex`, `sha256OfCanonicalObject`, `sha256OfFile`, `computeAllChecksums`(카탈로그/소스블록/store/preview 4종 체크섬을 한 번에 계산)를 구현. `review-packet.js`(패킷 생성 시점)와 `apply-source-activation.js`(`--apply` 검증 시점, "지금 이 순간" 재계산)가 이 함수를 공통 재사용하도록 설계했습니다(spec.md "checksum-utils.js: store.js/카탈로그/패킷에 공통 사용" 요구사항 반영).

## signing-utils.js
`signDecision`/`verifyDecisionSignature`(HMAC-SHA256, 서명 대상 필드는 `reviewId + packetSha256Recomputed + verdict + reasons + checkedItems`만, spec.md 설계안 7-3), `signingKeyId`(키 자체가 아닌 짧은 지문만 반환), `loadSigningKeyFromEnv`(환경변수 미설정/공백이면 `null`, 예외 던지지 않음)를 구현. 실제 키 값은 코드 어디에도 없고, 항상 `process.env.UNIPICK_GATE_SIGNING_KEY`(호출자가 전달)로만 읽습니다.

## review-packet.js
`generateReviewId`(형식: `rp-${universityId}-${sourceId}-${yyyyMMddHHmmss}-${6자리hex}`), `computePacketSha256`(자기 자신 필드 제외 후 canonical 직렬화 + sha256), `buildReviewPacket`(스키마 검증 + 패킷 객체 생성, 디스크 쓰기 없음), `writeReviewPacketOnce`(append-only 디스크 쓰기), `createAndWriteReviewPacket`(둘을 합친 편의 함수)를 구현. spec.md 설계안 1번 스키마를 그대로 따르며:
- `robotsPolicyViolation`/`jsRuleUnverified`/`diagnoseFailed` 같은 위반 판정 필드를 전혀 계산/저장하지 않음(원본 근거만: `robotsEvidence`/`jsRuleEvidence`/`diagnostics.rawOutput`).
- `regressionEvidence.npmTestSummary`에서 `fail N`을 파싱해 `N !== 0`이거나 형식을 해석할 수 없으면 패킷 생성 자체를 거부(spec.md §8/예외 상황).
- `source.jsDetailLinkRule?.enabled === true`인 경우 `jsRuleEvidence`가 없으면 패킷 생성을 거부하고, 그 외에는 항상 `null`로 명시.

## review-decision-writer.js
`writeReviewDecision`(Brain 전용) — 패킷을 읽어 `packetSha256`을 독립적으로 재계산해 자체 검증한 뒤, `checkedItems`의 위반 플래그와 `verdict`의 구조적 일관성(위반이 하나라도 true면 APPROVE 불가)을 확인하고, `signDecision`으로 서명해 append-only로 판정 파일을 씁니다. `BLOCKED_REVIEWER_NAMES` 블록리스트도 이 파일에 정의됩니다. **이 파일은 `apply-source-activation.js`를 포함해 어떤 다른 프로덕션 코드에서도 `require()`되지 않습니다**(의도적 격리 — 아래 "임의로 결정한 부분" 참고).

## apply-source-activation.js
- `parseArgs`: `--review-id=`(필수) / `--apply`(플래그, 기본 false) 파싱.
- `runAllGuards(reviewId, options)`: 패킷/판정 파일 존재 확인 → 3중 reviewId 일치 → 서명 키 로드(`SIGNING_KEY_UNAVAILABLE`) → 서명 존재(`SIGNATURE_MISSING`) → 서명 검증(`SIGNATURE_INVALID`) → 판정 내부 일관성(위반 플래그 vs APPROVE) → `packetSha256Recomputed` 재검증(`STALE_REVIEW_PACKET_INVALIDATED`) → `verdict==="APPROVE"`(`VERDICT_NOT_APPROVED`) → 리뷰어 블록리스트(`REVIEWER_BLOCKED`) → 카탈로그/소스블록/store/preview 4종 체크섬 재비교(`STALE_REVIEW_PACKET_INVALIDATED`, 어느 항목이 불일치했는지 이유에 명시). 어떤 경우에도 파일을 쓰지 않는 읽기 전용 함수입니다.
- `performActivationAndSave(packet, options)`: `run-single-school-trial.js`의 `backupBeforeSave()`를 기본값으로 재사용(운영 시), 백업된 store/preview 파일에 JSON 파싱 검증 추가(기존 `backupBeforeSave()`가 하지 않던 것), 카탈로그도 별도로 백업+검증. `applyMinimalDiff`로 `enabled`/`verified`/`status` 3개 필드만 최소 변경 후 원자적 쓰기(`writeJsonAtomic`), `saveNewItems` 호출. 실패 시 카탈로그/store/preview 모두 백업에서 롤백하고 `enabled` 원복을 재확인, 복구 자체가 실패하면 `ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED`로 명확히 실패, 정상 롤백이면 `SAVE_FAILED_ROLLBACK_SUCCESS`로 실패를 보고. 성공 시 `review-decisions/<reviewId>.applied.json`을 append-only로 기록.
- `main()`: 검증 실패 시 REJECTED(쓰기 없음), `--apply` 없으면 `VALIDATED_READY_FOR_APPLY`(쓰기 없음), `--apply` 있고 검증 통과 시에만 `performActivationAndSave` 호출.
- `review-decision-writer.js`를 `require()`하지 않으며, `BLOCKED_REVIEWER_NAMES`도 독립적으로 재정의(의도적 격리).

## run-single-school-trial.js
`module.exports`에 `backupBeforeSave`만 추가. 그 외 어떤 줄도 변경하지 않음(diff 1줄).

## activate-*.js / run-one-onboarding.js / run-uni-pick-next-batch-auto-resolution.js (7개)
원래 로직을 전부 제거하고, 호출 시(require 또는 직접 실행 시) 즉시 `console.error`로 감사 로그를 남긴 뒤 명확한 `Error`를 던지는 스텁으로 교체. 에러 메시지에 "`server/agent/gate/apply-source-activation.js --apply` 경로를 사용하라"는 안내를 포함. 카탈로그/store/preview 파일을 전혀 열지 않습니다.

이 7개 파일을 호출하던 다른 코드(`run-quality-recovery-test20.js`, `run-smart-retry.js`, `run-onboarding-batch.js`, `package.json`의 `news:onboard:one`/`news:onboard:activate:collector-ready` 스크립트)는 전부 `spawnSync`로 별도 프로세스 실행 후 종료 코드를 확인하는 방식이라, 스텁이 즉시 비정상 종료(코드 1)해도 기존 에러 처리 경로를 그대로 타므로 별도 수정이 필요하지 않았습니다(코드 검토로 확인, `git grep`으로 `require(...)`형태의 직접 의존은 없음을 확인).

# 변경 이유

`.pipeline/spec.md`에 설계된 "패킷 생성(Code Agent) → 서명된 승인 판정(Brain 전용) → `--apply`(사용자 명시 승인)" 3단계 게이트를 코드로 구현해, 기존에 파편화돼 있던 `activate-*.js`류 스크립트들이 각자 개별적으로 `enabled=true`를 직접 써버리던 구조를 단일 진입점(`apply-source-activation.js --apply`)으로 수렴시키기 위함입니다. Code Agent 세션은 패킷 생성까지만 할 수 있고, 판정 파일 작성(`review-decision-writer.js`)과 실제 활성화(`--apply`)는 각각 별도 실행 컨텍스트/서명 키/사용자 승인이 있어야만 가능하도록 파일 단위로 권한 경계를 분리했습니다.

# 미구현 / 임의로 결정해야 했던 항목

1. **서명 키 환경변수 이름**: spec.md 설계안 7-2는 "`BRAIN_REVIEW_SIGNING_KEY`(환경변수 주입) vs OS 파일 권한 분리 디렉터리" 중 실제 운영 방식을 "다음 Coder 단계에서 확정"하도록 명시적으로 열어둔 상태였습니다(질문사항 1 하위 항목). 이번 라운드 상위 지시에서 "spec.md에 이미 확정된 이름이 없다면 `UNIPICK_GATE_SIGNING_KEY`로 하라"고 명시했으므로, `BRAIN_REVIEW_SIGNING_KEY`(예시로만 언급됨)가 아니라 `UNIPICK_GATE_SIGNING_KEY`를 채택했습니다. 다음 라운드에서 실제 운영 방식(환경변수 vs 파일 권한 분리)을 최종 확정해야 합니다.
2. **`review-decision-writer.js` 테스트 파일**: spec.md 9번 "단위 테스트 계획"에는 이 파일 전용 테스트가 명시돼 있지 않았습니다(Brain 전용이라 Code Agent 실행 경로에 연결되지 않기 때문으로 추정). 프로젝트 관례(모든 모듈에 짝이 되는 `*.test.js`)를 따라 최소한의 유효성 검사 테스트(`review-decision-writer.test.js`)를 추가로 작성했습니다. 이 테스트 파일도 어떤 `npm run` 스크립트에 연결돼 있지 않으며 `node --test`로 직접 실행될 때만 동작합니다.
3. **`sourceBlockCanonical` 재검증 의미 해석**: spec.md 의사코드는 `currentChecksums = computeAllChecksums()`만 적혀 있고 `sourceBlockCanonical` 입력값이 패킷의 `sourceSnapshot`인지 "지금 카탈로그의 살아있는 소스 블록"인지 문자 그대로 명시하지 않았습니다. 전자로 해석하면 자기 자신과 항상 같아 검증 의미가 없으므로(동어반복), `--apply` 쪽에서는 "지금 카탈로그를 다시 읽어 `packet.scope`로 찾은 현재 소스 블록"을 사용하도록 구현했습니다(반대로 `review-packet.js`의 패킷 생성 시점에는 당연히 `sourceSnapshot` 그 자체를 사용). 이 해석을 `apply-source-activation.js`의 `runAllGuards` 주석에 명시했습니다.
4. **일부 실패 코드 이름**: spec.md가 명시적으로 이름을 정한 코드(`STALE_REVIEW_PACKET_INVALIDATED`/`SIGNATURE_MISSING`/`SIGNATURE_INVALID`/`SIGNING_KEY_UNAVAILABLE`/`NO_DECISION_YET`)는 그대로 사용했지만, 그 외 실패 경로(패킷 자체가 없음, reviewId 3중 불일치, verdict가 HOLD/REJECT, 리뷰어 블록리스트, 판정 내부 일관성 위반, 백업/롤백 실패)에는 spec.md에 정해진 이름이 없어 다음 코드를 새로 명명했습니다: `REVIEW_PACKET_NOT_FOUND`, `REVIEW_ID_MISMATCH`, `VERDICT_NOT_APPROVED`, `REVIEWER_BLOCKED`, `INVALID_DECISION_APPROVE_WITH_VIOLATION`, `BACKUP_VALIDATION_FAILED`, `SAVE_FAILED_ROLLBACK_SUCCESS`, `ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED`. 모두 "즉시 중단, 쓰기 없음"(검증 실패) 또는 "롤백 성공/실패 구분"(쓰기 실패) 원칙은 spec.md 그대로 따랐습니다.
5. **폐기 대상 스크립트 목록**: 상위 지시("spec.md의 목록을 그대로 사용, 임의로 추측하지 마세요")에 따라 spec.md에 명시된 7개 파일만 스텁으로 교체했습니다. 다만 `git grep`으로 재확인한 결과 spec.md 목록에 없는 `server/agent/onboarding/tools/activate-mokpo-catholic.js`와 `server/agent/onboarding/tools/activate-ulsan-general-feed.js` 두 파일도 동일하게 `enabled: true`를 직접 쓰는 것을 확인했습니다(spec.md 자체도 "Coder 단계 착수 시 이 목록 외에도 유사 스크립트가 있는지 재확인 필요"라고 명시했던 부분). 이번 라운드 범위 밖으로 판단해 건드리지 않았으며, 다음 라운드에서 이 두 파일의 처리 여부를 Planner/사용자가 결정해야 합니다.
6. **`apply-source-activation.js`의 `writeJsonOnce`/`writeJsonAtomic`/`restoreFromBackup` 등 소형 헬퍼**: `review-packet.js`/`review-decision-writer.js`에도 같은 이름의 유사 헬퍼가 각각 독립적으로 정의돼 있습니다(코드 중복). spec.md가 "판정 파일을 쓰는 코드는 별도 파일에 두고 Code Agent 실행 경로에 연결하지 않는다"는 격리 원칙을 명시했으므로, 공용 유틸 모듈로 묶기보다 각 파일에 소형 헬퍼를 중복 구현해 파일 간 `require` 연결을 만들지 않는 쪽을 선택했습니다.
7. **`server/agent/gate/data/` 실제 데이터 파일**: 지시대로 실제 패킷/판정 파일(더미 아닌 실사용 데이터)은 만들지 않았습니다. `review-packets/`와 `review-decisions/` 아래에 `.gitkeep`만 두었습니다.

# 참고사항 (Tester가 알아야 할 내용)

- **테스트를 실행하지 않았습니다**(이번 라운드 지시에 따라 `node --test`/`npm test` 실행 금지). 문법 검증 목적의 `node --check`만 아래처럼 실행해 전부 통과를 확인했습니다:
  ```
  node --check server/agent/gate/checksum-utils.js            OK
  node --check server/agent/gate/checksum-utils.test.js       OK
  node --check server/agent/gate/signing-utils.js              OK
  node --check server/agent/gate/signing-utils.test.js         OK
  node --check server/agent/gate/review-packet.js               OK
  node --check server/agent/gate/review-packet.test.js          OK
  node --check server/agent/gate/review-decision-writer.js      OK
  node --check server/agent/gate/review-decision-writer.test.js OK
  node --check server/agent/gate/apply-source-activation.js     OK
  node --check server/agent/gate/apply-source-activation.test.js OK
  node --check server/agent/tools/run-single-school-trial.js    OK
  node --check server/agent/onboarding/tools/activate-collector-ready.js       OK
  node --check server/agent/onboarding/tools/activate-kyungnam-general-feed.js OK
  node --check server/agent/onboarding/tools/activate-dnue-general-feed.js     OK
  node --check server/agent/onboarding/tools/activate-youngsan-shared-feed.js  OK
  node --check server/agent/onboarding/tools/activate-mtu-general-feed.js      OK
  node --check server/agent/tools/run-uni-pick-next-batch-auto-resolution.js   OK
  node --check server/agent/onboarding/tools/run-one-onboarding.js             OK
  ```
- Tester 라운드에서 `node --test server/agent/gate/*.test.js`(개별) 및 전체 `npm test`를 3회 이상 연속 실행해 `fail 0`인지 확인해야 합니다(spec.md "다음 Coder 단계 완료 기준" 항목).
- 모든 테스트는 fixture 임시 디렉터리(`fs.mkdtempSync(os.tmpdir())`)만 사용하고, 실제 프로덕션 카탈로그/store/preview 파일(`development/university-news/data/university-news-sources.final.json`, `server/agent/data/agent-news-store.json`, `data/university-news-preview.json`)은 어떤 테스트에서도 열거나 쓰지 않습니다.
- 모든 테스트의 시각/난수 값은 고정 주입(`now`/`randomBytesImpl` 옵션)입니다 — spec.md에 기록된 직전 라운드 flaky 테스트 선례를 반영한 조치입니다.
- `apply-source-activation.test.js`는 spec.md 9)/10)의 (a)~(k) 단위 테스트 시나리오와 통합 테스트 시나리오 1/3/6을 포함합니다(2/4/5는 각각 (f)/(b)/(g) 테스트와 사실상 동일한 내용이라 별도로 중복 작성하지 않았습니다 — 필요 시 Tester가 이름을 확인해 커버리지를 재확인해 주세요).
- `grep`으로 실제 서명 키 값이 코드/테스트 어디에도 하드코딩되지 않았음을 재확인했습니다(위 "임의로 결정한 항목 1" 참고) — 테스트 파일에 있는 `TEST_DUMMY_SIGNING_KEY` 류 상수는 전부 "실제 키가 아님"이라는 주석이 붙은 더미 문자열입니다.
- `git status` 기준 이번 라운드에서 변경된 파일(`git add`/`commit`은 수행하지 않았습니다):
  ```
   M server/agent/onboarding/tools/activate-collector-ready.js
   M server/agent/onboarding/tools/activate-dnue-general-feed.js
   M server/agent/onboarding/tools/activate-kyungnam-general-feed.js
   M server/agent/onboarding/tools/activate-mtu-general-feed.js
   M server/agent/onboarding/tools/activate-youngsan-shared-feed.js
   M server/agent/onboarding/tools/run-one-onboarding.js
   M server/agent/tools/run-single-school-trial.js
   M server/agent/tools/run-uni-pick-next-batch-auto-resolution.js
  ?? server/agent/gate/
  ```
  (`.pipeline/spec.md`가 `M`으로 표시되는 것은 이번 세션 시작 이전부터 있던 상태이며, 이번 세션에서는 `.pipeline/spec.md`를 Read만 했을 뿐 수정하지 않았습니다.)
- `server/agent/gate/apply-source-activation.js`는 기본 실행(`--apply` 없이)에서 파일을 전혀 쓰지 않으며, `--apply`가 있어도 `runAllGuards`가 실패하면 아무것도 쓰지 않습니다(둘 다 테스트로 mtime 불변을 확인).
- git add/commit, `source.enabled=true` 변경, `review-decisions/` 아래 실제 판정 파일 생성, scheduler/배포 작업은 이번 라운드에서 전혀 수행하지 않았습니다.

---

# Coder 2라운드 — 10개 `activate-*.js` 스텁 교체 (catholic-kwandong 제외)

## 변경된 파일 (10개, 전부 "수정" — 신규/삭제 없음)

우선 처리(가드 없는 즉시실행 구조였던 4개):
- `server/agent/tools/activate-inje-shared-source.js`
- `server/agent/tools/activate-daeshin-source.js`
- `server/agent/onboarding/tools/activate-mokpo-catholic.js`
- `server/agent/onboarding/tools/activate-ulsan-general-feed.js`

이어서 처리(6개):
- `server/agent/tools/activate-kyungdong-shared-source.js`
- `server/agent/tools/activate-sangmyung-cheonan-source.js`
- `server/agent/tools/activate-kyungwoon-source.js`
- `server/agent/tools/activate-changshin-source.js` (`module.exports` 13개 헬퍼 제거)
- `server/agent/tools/activate-hwasung-medi-science-source.js` (`module.exports` 14개 헬퍼 제거)
- `server/agent/tools/activate-keimyung-source.js` (`module.exports` 11개 헬퍼 + `runDryValidation` 제거)

`server/agent/tools/activate-catholic-kwandong-source-local.js`는 지시대로 **전혀 건드리지 않았습니다** — `git diff --stat`으로 무변경(diff 없음)임을 확인했습니다.

## 변경 내용

10개 파일 모두 1라운드에서 이미 검증된 것과 동일한 스텁 패턴으로 전체 교체했습니다: 원래의 활성화 로직(카탈로그 읽기/백업/`enabled:true` 병합/쓰기, 일부 파일의 curl 기반 dry-run·`npm test` 실행·`node --check` 자기검증 등 부가 기능 포함)을 전부 제거하고, `main()` 호출 시 `console.error`로 감사 로그를 남긴 뒤 `server/agent/gate/apply-source-activation.js --review-id=<reviewId> --apply` 경로를 안내하는 `Error`를 던지는 구조로 통일했습니다. 카탈로그/store/preview 파일을 전혀 열지 않습니다. `module.exports = { main }`만 남기고 `main()`을 무조건 호출하는 구조(가드 없음)는 1라운드 스텁 7개와 동일하게 유지했습니다(기존 관례 일치).

- `activate-changshin-source.js`/`activate-hwasung-medi-science-source.js`/`activate-keimyung-source.js` 3개는 스텁 교체 전 `module.exports`로 각각 13/14/11개의 파싱·검증 헬퍼 함수(및 `keimyung`의 네트워크 `runDryValidation`)를 노출하고 있었습니다. 스텁 교체 직전 `grep -rn "require(...)"`로 repo 전체를 재검색해 이 3개 파일을 `require()`하는 코드가 여전히 없음을 재확인(spec.md 조사 결과와 동일)한 뒤, export 선언 자체도 완전히 제거했습니다.
- `activate-kyungdong-shared-source.js`는 스텁 교체 전 spec.md에 기록된 대로 "레거시 캠퍼스 소스 4개 삭제 + 공유소스 병합" 마이그레이션이 이미 카탈로그에 반영·커밋(`ff28464`)되어 있음을 전제로 교체했습니다 — 이번 라운드에서 카탈로그를 다시 확인하거나 수정하지 않았습니다(스크립트 코드만 교체).

## 재확인 절차 (지시대로 수행)

10개 파일 각각에 대해 교체 후 `grep -rn "require(.*<파일명>" --include="*.js" server development`를 재실행해 어디에서도 `require()`되지 않음을 확인했습니다(모두 빈 결과 — Research 결과와 동일). `*.test.js` 대상 검색도 동일하게 빈 결과였습니다. 불일치가 발견되면 즉시 중단하라는 지시였으나, 10개 전부 일치했으므로 중단 없이 진행했습니다.

## 변경 이유

`.pipeline/spec.md` "Coder 2라운드 대상" 섹션에서 확정된 11개 게이트-우회 활성화 스크립트 중 `catholic-kwandong-source-local.js`(ACTIVATE_ONLY 액션 타입 미확정)를 제외한 10개를 1라운드와 동일한 패턴으로 정리해, 신규 소스 활성화가 `apply-source-activation.js --apply` 단일 경로로만 가능하도록 수렴시키기 위함입니다.

## 미구현 / 다음 라운드로 이월된 항목

1. **`activate-catholic-kwandong-source-local.js`**: 지시대로 이번 라운드에서 제외했습니다. 이 파일은 `saveNewItems`(store/preview 저장)를 호출하지 않고 카탈로그만 변경하는 유일한 예외이므로(spec.md 판정 근거 참고), 게이트의 `ACTIVATE_AND_SAVE_INITIAL_ITEMS` 단일 액션 스키마와 별도로 "활성화만 하는" `ACTIVATE_ONLY` 액션 타입 설계가 먼저 확정되어야 합니다.
2. **테스트 실행**: 지시대로 `node --test`/`npm test`는 실행하지 않았습니다. 문법 검증 목적의 `node --check`(파일을 파싱만 하고 실행하지 않음 — `main()`이 호출되지 않으므로 "테스트 실행 금지" 지시와 무관)만 10개 파일 전부에 실행해 전부 통과를 확인했습니다.
3. **git add/commit**: 수행하지 않았습니다. 아래 "참고사항" 절의 `git status` 목록이 이번 라운드의 전체 변경분입니다.

## 참고사항 (Tester가 알아야 할 내용)

- 문법 검증(`node --check`, 10개 전부 OK):
  ```
  node --check server/agent/tools/activate-inje-shared-source.js              OK
  node --check server/agent/tools/activate-daeshin-source.js                  OK
  node --check server/agent/onboarding/tools/activate-mokpo-catholic.js       OK
  node --check server/agent/onboarding/tools/activate-ulsan-general-feed.js   OK
  node --check server/agent/tools/activate-kyungdong-shared-source.js         OK
  node --check server/agent/tools/activate-sangmyung-cheonan-source.js        OK
  node --check server/agent/tools/activate-kyungwoon-source.js                OK
  node --check server/agent/tools/activate-changshin-source.js                OK
  node --check server/agent/tools/activate-hwasung-medi-science-source.js     OK
  node --check server/agent/tools/activate-keimyung-source.js                 OK
  ```
- Tester 라운드에서 확인이 필요한 항목: (a) 10개 스텁 모두 `require()` 또는 직접 실행 시 예외를 던지고 카탈로그/store/preview를 전혀 건드리지 않는지, (b) `activate-catholic-kwandong-source-local.js`가 이번 커밋 대상에 전혀 포함되지 않았는지(diff 없음), (c) 기존 `npm test` 233/233(1라운드 기준)이 이번 교체 이후에도 여전히 fail 0인지(이 10개 파일을 요구하는 테스트가 없었으므로 회귀는 없을 것으로 예상되나, Tester가 직접 실행해 확인 필요 — 이번 라운드에서는 실행하지 않았습니다).
- `git status --porcelain` 기준 이번 라운드 포함 전체 변경 파일 목록(`git add` 없이 확인):
  ```
   M .pipeline/changes.md
   M .pipeline/spec.md
   M development/university-news/data/university-news-sources.final.json   (이번 세션 이전부터 있던 상태 — 이번 라운드에서 건드리지 않음)
   M server/agent/onboarding/tools/activate-collector-ready.js             (1라운드)
   M server/agent/onboarding/tools/activate-dnue-general-feed.js           (1라운드)
   M server/agent/onboarding/tools/activate-kyungnam-general-feed.js       (1라운드)
   M server/agent/onboarding/tools/activate-mokpo-catholic.js              (2라운드, 신규)
   M server/agent/onboarding/tools/activate-mtu-general-feed.js            (1라운드)
   M server/agent/onboarding/tools/activate-ulsan-general-feed.js          (2라운드, 신규)
   M server/agent/onboarding/tools/activate-youngsan-shared-feed.js        (1라운드)
   M server/agent/onboarding/tools/run-one-onboarding.js                  (1라운드)
   M server/agent/tools/activate-changshin-source.js                      (2라운드, 신규)
   M server/agent/tools/activate-daeshin-source.js                        (2라운드, 신규)
   M server/agent/tools/activate-hwasung-medi-science-source.js           (2라운드, 신규)
   M server/agent/tools/activate-inje-shared-source.js                    (2라운드, 신규)
   M server/agent/tools/activate-keimyung-source.js                       (2라운드, 신규)
   M server/agent/tools/activate-kyungdong-shared-source.js               (2라운드, 신규)
   M server/agent/tools/activate-kyungwoon-source.js                      (2라운드, 신규)
   M server/agent/tools/activate-sangmyung-cheonan-source.js              (2라운드, 신규)
   M server/agent/tools/run-single-school-trial.js                        (1라운드)
   M server/agent/tools/run-uni-pick-next-batch-auto-resolution.js        (1라운드)
  ?? server/agent/gate/                                                   (1라운드)
  ```
  `server/agent/tools/activate-catholic-kwandong-source-local.js`는 이 목록에 없습니다(무변경 확인됨).
- git add/commit, `source.enabled=true` 변경, 카탈로그 데이터 수정, 실제 서명 키 설정, `review-decisions/` 실데이터 생성, scheduler 등록, 배포는 이번 2라운드에서도 전혀 수행하지 않았습니다.
