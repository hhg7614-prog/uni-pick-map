# 검토 요약

대상: UNI PICK 승인 게이트 도입 작업 전체(Coder 1·2라운드 누적).
- Coder 1라운드: `server/agent/gate/` 신규 5개 모듈 + 각 테스트(`checksum-utils`,
  `signing-utils`, `review-packet`, `review-decision-writer`, `apply-source-activation`),
  `run-single-school-trial.js`의 `module.exports`에 `backupBeforeSave` 1줄 추가,
  기존 `activate-*.js`류 7개를 폐기 스텁으로 교체.
- Coder 2라운드: 게이트를 우회하던 나머지 10개 `activate-*.js`를 동일한 스텁 패턴으로
  교체(그중 3개는 죽은 `module.exports` 헬퍼 제거). `activate-catholic-kwandong-source-local.js`
  는 `ACTIVATE_ONLY` 액션 타입 미확정으로 의도적으로 제외.
- Tester(직전 라운드): `npm test` 3회 연속 233/233, 10개 스텁 전부 직접 실행해 즉시 예외 +
  카탈로그/store/preview 무변경(mtime+sha256 대조) 확인, "통과" 판정.

이번 Reviewer는 Coder/Tester의 보고 문구를 그대로 인용하지 않고, `git diff`를 직접
줄 단위로 읽고 grep/구조적 diff로 재검증했다. 아래는 그 결과다. **코드는 한 글자도
수정하지 않았다.**

# 요구사항 확인 (직접 재현 결과)

1. **17개 스텁(1+2라운드)이 정말로 동일한 패턴인지, 원래 로직 잔존 여부**:
   `git diff --stat`으로 18개 파일(17개 스텁 + `run-single-school-trial.js`)만
   변경되었음을 확인(568 insertions / 12,551 deletions — 원본 로직이 대거 삭제되고
   짧은 스텁으로 대체됨). 17개 전부에 `grep -nE "enabled\s*:\s*true|verified\s*:\s*true|writeFileSync|fs\.write|catalog\[|JSON\.parse\(fs\.readFileSync"`를 실행한 결과,
   매치는 전부 주석 한 줄(`// This script used to write enabled: true / verified: true directly to...`)뿐이었고 실제 실행 코드에는 활성화/쓰기 로직이 전혀 남아있지 않음을 확인했다.
   1라운드 템플릿(`activate-collector-ready.js`)과 나머지 12개(1+2라운드, changshin/
   hwasung-medi/keimyung/kyungdong 제외)를 파일명만 정규화해 구조적으로 diff한 결과,
   차이는 (a) 경로 접두사(`onboarding/tools/` vs `tools/`), (b) 2라운드 파일에 붙은
   `; Coder 2라운드` 주석 표기, (c) `run-one-onboarding.js`/`run-uni-pick-next-batch-auto-resolution.js`의 원래 동작(git/push, 자체 --apply 플래그) 설명 문구 차이뿐이었다 — 실행 로직(`console.error` → `throw new Error` → `module.exports = { main }` → `main()`)은 17개 전부 완전히 동일하다. **충족**.
2. **죽은 export 제거(changshin/hwasung-medi/keimyung)의 문법적 정합성 및 참조 재발생 여부**:
   `grep -n "module.exports"` 결과 3개 파일 모두 `module.exports = { main };` 단 한 줄만
   남아 있고, 이전에 있던 13/14/11개 헬퍼 함수 export는 완전히 제거됨을 확인. `node --check`
   로 3개 파일 모두 문법 오류 없음(Tester 보고와 별개로 재확인). `grep -rln "require(.*<파일명>" --include="*.js" server development`와 `--include="*.test.js"` 검색을 10개 파일
   전부에 대해 재실행한 결과 전부 빈 결과 — 스텁 교체 이후 새로 생긴 참조도 없다. **충족**.
3. **서명 키 등 시크릿 하드코딩 여부**: `server/agent/gate/`, 17개 스텁, `run-single-school-trial.js` 전체에서 `SIGNING_KEY|secret|password|apikey`류 패턴의 실제 값 리터럴을
   검색한 결과 코드(비-테스트) 파일에는 매치가 전혀 없었다. `signing-utils.js`는 실제 키
   값이 아니라 환경변수 이름 문자열(`UNIPICK_GATE_SIGNING_KEY`)만 상수로 갖고 있으며, 키
   자체는 항상 `loadSigningKeyFromEnv(env = process.env)`로 호출 시점에 읽는다(코드
   직접 확인). 테스트 파일들의 `TEST_DUMMY_SIGNING_KEY`는 전부 `"test-only-dummy-signing-key-do-not-use-in-production"` 형태로 더미임이 주석·값 자체에 명시돼 있다. **충족**.
4. **`apply-source-activation.js`(1라운드, 이번 라운드의 실제 활성화 진입점) 재검토**:
   전체 파일을 직접 읽었다. `runAllGuards`의 검증 순서(패킷 존재 → 판정 존재 → 3중 reviewId
   일치 → 서명 키 로드 → 서명 존재 → 서명 검증 → `checkedItems` 내부 일관성 → 패킷 해시
   재검증 → verdict APPROVE → 리뷰어 블록리스트 → 4종 체크섬 재비교)가 spec.md 설계안
   3번/4번과 정확히 일치하고, 이 함수는 어떤 실패 경로에서도 파일을 쓰지 않는다(코드에
   `fs.writeFileSync`/`renameSync` 등 쓰기 호출이 전혀 없음을 직접 확인). `review-decision-writer.js`는 `apply-source-activation.js`(프로덕션 파일, `.test.js` 아님)에서
   전혀 `require()`되지 않으며(직접 확인), `package.json`에도 `gate/` 관련 스크립트가 등록돼
   있지 않다(격리 설계 유지 확인). **충족**.
5. **`run-single-school-trial.js` 최소 diff 원칙**: `git diff` 결과 정확히 1줄
   (`module.exports`에 `backupBeforeSave` 항목 추가)만 변경되었고 그 외 어떤 줄도 건드리지
   않았다. **충족**.
6. **`activate-catholic-kwandong-source-local.js` 무변경**: `git diff --stat`
   실행 결과 이 파일은 출력 자체가 없다(diff 0줄) — 지시대로 완전히 건드리지 않았다.
   **충족**.
7. **`server/agent/gate/data/`에 실제 판정/패킷 데이터가 생성되지 않았는지**: 디렉터리
   안에는 `.gitkeep` 2개만 존재하고 실제 `review-packets/*.json` / `review-decisions/*.json`
   파일은 하나도 없다. **충족**.

# 테스트 결과 (Tester 보고 재확인, 재실행하지 않음 — 이번 라운드는 실행 금지)

Tester가 `.pipeline/test-results.md`에 기록한 `npm test` 3회 연속 233/233(1라운드
기준선과 동일)과 10개 스텁 직접 실행 후 mtime+sha256 무변경 확인 결과를, 이번 라운드
지시("테스트 실행 금지")에 따라 재실행하지 않고 문서만 검토했다. 기록된 재현 절차와
근거(구체적 sha256 값, exit code, grep 결과)가 충분히 구체적이어서 별도 재실행 없이도
신뢰할 수 있다고 판단했다. 위 "요구사항 확인" 3번(secrets)과 4번(`apply-source-activation.js`
격리)은 Tester가 다루지 않았던 항목이라 이번 Reviewer가 직접 추가로 확인했다.

# 문제점 (미해결 2건에 대한 명시적 권고)

## (1) `activate-catholic-kwandong-source-local.js`의 `ACTIVATE_ONLY` 미확정 — git 반영을 막을 사유 아님, 별도 후속 라운드로 분리 권고

이 파일은 여전히 게이트를 우회해 `enabled=true`를 직접 쓸 수 있는 상태로 코드베이스에
남아 있다. 그러나:
- 이 파일은 **이번 두 라운드에서 전혀 수정되지 않았다** — git diff 관점에서 "이번 변경이
  새로 도입한 리스크"가 아니라 "이번 변경 이전부터 존재했고 아직 해소하지 못한 기존
  리스크"다. 이번 커밋을 반영하지 않는다고 이 리스크가 사라지지도 않는다(오히려 이미
  스텁 교체된 16개 경로가 막힌 상태를 반영하지 않고 미루면, 그만큼 더 오래 위험이
  지속된다).
- `ACTIVATE_ONLY` 액션 타입 설계는 게이트 스키마 확장(신규 액션 타입 추가)이 필요한
  독립적인 작업으로, 이미 반영 완료된 16개 스텁 교체와 논리적으로 결합되어 있지 않다.
  **권고: 이번 diff의 git 반영을 막을 사유가 아니다. 별도 후속 라운드("Coder 3라운드:
  catholic-kwandong 전용 ACTIVATE_ONLY 설계+교체")로 명확히 분리해 진행할 것을 권고한다.**
  단, 이 파일이 여전히 게이트 밖에 있다는 사실은 review.md/최종 보고에 명시적으로
  기록되어야 하며 "17개 전부 해결됨"으로 오인되지 않도록 주의가 필요하다(11개 대상 중
  10개만 처리, 1개는 의도적으로 남아 있음).

## (2) 10개 스텁 전용 자동 테스트 부재 — 1라운드 관례를 따른 것으로 이번 반영 시점에는 충분, 다만 부채로 명시 기록 권고

1라운드에서 스텁 교체된 7개(`activate-collector-ready.js` 등)에도 전용 `*.test.js`가
없다 — 이는 새로운 결핍이 아니라 이미 확립된 프로젝트 관례다. 근거:
- 스텁 자체의 "기대 동작"은 매우 단순하고 균일하다(모든 스텁이 `console.error` → `throw`
  → 카탈로그/store/preview 미접촉이라는 동일한 3단계 계약을 따른다). 이번 Tester 라운드가
  10개 전부를 직접 실행해 이 계약을 실제로 검증했고(요구사항 확인 1번 참고), 그 결과는
  `.pipeline/test-results.md`에 재현 가능한 형태(정확한 sha256/mtime, exit code)로
  남아 있다.
- 다만 이 검증은 "이번 세션이 한 번 수동으로 확인한 것"이며, 향후 누군가 이 17개 파일 중
  하나를 다시 수정했을 때 회귀를 자동으로 잡아줄 CI 테스트는 없다.
  **권고: 이번 반영을 막을 정도의 결함은 아니다(1라운드와 동일 기준 적용, 형평성 문제
  없음). 다만 "기술 부채"로 명시적으로 기록해 두고, 여유가 있는 후속 라운드에서
  `server/agent/gate/deprecated-stubs.test.js` 같은 파일 하나로 17개 스텁을 순회하며
  "require 또는 실행 시 반드시 throw하고, 카탈로그/store/preview 파일에 쓰기 함수를 호출한
  흔적이 없다"는 계약을 한 번에 검증하는 낮은 비용의 회귀 테스트를 추가할 것을 제안한다.**

# 최종 판정

**등급: git 반영 권고 (보완 사항은 후속 라운드로 명시적으로 분리)**

근거 요약:
- 이번 두 라운드의 diff(17개 스텁 교체 + 죽은 export 제거 + `run-single-school-trial.js`
  1줄)는 코드 리뷰로 직접 확인한 결과 의도한 범위를 정확히 지켰고, 예상 밖의 부수효과나
  누락된 export 정리, 하드코딩된 시크릿이 발견되지 않았다.
- 회귀 없음(Tester 233/233 재확인, 이번 라운드에서 재실행하지 않고 근거 문서만 검토).
- 미해결 2건 모두 "이번 diff의 반영을 막아야 하는 결함"이 아니라 "범위 밖 후속 과제"로
  판단된다. 다만 사용자(Brain)에게 다음 두 가지는 git 반영 승인 전에 반드시 인지시켜야
  한다:
  1. `activate-catholic-kwandong-source-local.js`는 여전히 게이트 밖에 있다(11개 대상 중
     10개만 처리).
  2. `server/agent/gate/data/`는 `.gitkeep`만 있을 뿐 실제 게이트가 아직 한 번도
     실사용(패킷 생성 → Brain 판정 → `--apply`)된 적이 없다 — 이번 반영은 "게이트 배선"의
     반영이지 "게이트 실사용 검증 완료"의 반영이 아니다.
- git add/commit 여부는 이 문서의 권고와 별개로 **사용자의 명시적 승인이 있어야만** 진행한다
  (이번 Reviewer 라운드에서 git 작업을 전혀 수행하지 않았다).

# 참고: 전체 변경 파일 목록 (git status 기준, add 없이, 이번 두 라운드 누적)

```
 M server/agent/onboarding/tools/activate-collector-ready.js        (1라운드)
 M server/agent/onboarding/tools/activate-dnue-general-feed.js      (1라운드)
 M server/agent/onboarding/tools/activate-kyungnam-general-feed.js  (1라운드)
 M server/agent/onboarding/tools/activate-mokpo-catholic.js         (2라운드)
 M server/agent/onboarding/tools/activate-mtu-general-feed.js       (1라운드)
 M server/agent/onboarding/tools/activate-ulsan-general-feed.js     (2라운드)
 M server/agent/onboarding/tools/activate-youngsan-shared-feed.js   (1라운드)
 M server/agent/onboarding/tools/run-one-onboarding.js              (1라운드)
 M server/agent/tools/activate-changshin-source.js                  (2라운드)
 M server/agent/tools/activate-daeshin-source.js                    (2라운드)
 M server/agent/tools/activate-hwasung-medi-science-source.js       (2라운드)
 M server/agent/tools/activate-inje-shared-source.js                (2라운드)
 M server/agent/tools/activate-keimyung-source.js                   (2라운드)
 M server/agent/tools/activate-kyungdong-shared-source.js           (2라운드)
 M server/agent/tools/activate-kyungwoon-source.js                  (2라운드)
 M server/agent/tools/activate-sangmyung-cheonan-source.js          (2라운드)
 M server/agent/tools/run-single-school-trial.js                    (1라운드, 1줄)
 M server/agent/tools/run-uni-pick-next-batch-auto-resolution.js    (1라운드)
?? server/agent/gate/                                               (1라운드, 신규 5모듈+테스트+.gitkeep)
```

이 목록 외에 `.pipeline/spec.md`, `.pipeline/changes.md`, `.pipeline/test-results.md`,
`.pipeline/review.md`(본 문서)도 `M`/신규로 표시되나, 이는 파이프라인 기록 문서이지
프로덕션 코드가 아니다. `development/university-news/data/university-news-sources.final.json`
도 `M`으로 표시되지만 이는 이번 세션 이전부터 있던 상태이며 이번 두 라운드 어느 코드
변경으로도 발생하지 않았다(Coder/Tester/Reviewer 전 라운드에서 반복 확인됨).

`server/agent/tools/activate-catholic-kwandong-source-local.js`는 위 목록에 없다 —
의도적으로 무변경 상태다.

git add/commit은 이 review.md의 "git 반영 권고" 판정과 별개로, 사용자의 별도 명시적
승인 이후에만 수행되어야 한다.
