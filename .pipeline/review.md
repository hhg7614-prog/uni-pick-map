# 검토 요약

카탈로그 포맷 정규화(Option A) 작업. `feat/onboarding-gate-bridges` 위에 3커밋:

- `b20d55e` chore(catalog): 정규화 (카탈로그 1파일, 41 insert / 12 delete, 순수 reflow)
- `fe69441` test(catalog): `.gitattributes` 신규 + `.gitignore` 2줄 + 회귀 테스트 2종 (4파일, 156 insert)
- `5ed7eaf` feat(catalog): `knsu-press-release` 비활성 삽입 (카탈로그 1파일, 28 insert / 1 delete)

Reviewer 가 직접 재현·교차 확인한 항목:

- 정규화 무손실: `JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))` → true, 대학 247=247, 소스 91=91, **부모 커밋을 동일 정규화기에 통과시킨 결과가 커밋 A 와 바이트 단위 완전 일치** → true.
- 커밋 A diff 12개 하이라이트 전부 `officialNames` / `fixedParams` / `titleCleanupTokens` 인라인 압축 구조의 다중 라인 reflow. 값·키·배열순서 토큰 변경 0.
- 제품 writer 코드 4파일(`prepare-catalog-source-block.js`, `apply-source-activation.js`, `store.js`, `targets.js`) `git diff 3e602ed..HEAD` → 출력 없음(diff 0).
- 커밋 C diff: `"sources": [],` → `"sources": [` 컨테이너 라인 1줄 + knsu 블록 27줄 연속 삽입. 타 대학·소스 라인 변경 0. `정규화본 + knsu === HEAD` 의미 동일.
- `knsu-press-release` 최종 상태: `verified:false / enabled:false / status:"selector_required" / healthStatus:"unknown"`. `getTargetUniversities().length` = 43 (정규화 전후 동일).
- `npm test` → tests 300 / pass 300 / fail 0. 대상 2파일 `node --test` → 34/34 pass (신규 케이스 2개 pass 확인).
- `.gitattributes`: 카탈로그 + `server/agent/gate/data/**` → `text: set / eol: lf` (`git check-attr` 확인). 전역 `*.json` 규칙 없음.
- `.gitignore`: `*.prepare-backup.*` + `catalog-prepare-log.json` 2줄 추가, `git check-ignore` 로 두 산출물 매칭 확인.
- 브랜치 `feat/onboarding-gate-bridges`. `git branch -r --contains b20d55e` → 없음(push 흔적 없음). `main` 커밋 없음. `stash@{0}` 미접촉.
- 커밋 메시지에 `Co-Authored-By: Claude Sonnet 5` + `Claude-Session` 트레일러 포함(저장소 관례 부합).

# 요구사항 확인

| spec 완료 기준 | 상태 | 근거 |
|---|---|---|
| 1. 정규화 커밋 A (카탈로그 1파일, 값 무변경, JSON OK, 무손실/카운트 로그) | 충족 (문구 1건 예외) | 카탈로그 단독 커밋. deep re-serialize 동일 + 카운트 동일 + 바이트 재현 일치. `git diff -w` "비어 있음"은 물리적으로 불가능(아래 문제점 1). |
| 2. B1 회귀 테스트 (삭제 0줄 / 타 대학·소스 라인 변경 0 / 삽입 블록 필드 단언) | 충족 (문구 1건 예외) | 테스트 존재·pass. `assertSingleContiguousInsertion` 이 `"sources": []` 컨테이너 라인 1줄만 예외 허용, 그 외 삭제/치환 전부 실패 처리. "삭제 0줄"은 empty→nonempty 배열에서 불가능(아래 문제점 2). |
| 3. 게이트 회귀 테스트 (`enabled`/`status` 2줄만 변경, 라인 수 불변, 무관 소스 불변) | 충족 | 테스트 존재·pass. `assertOnlyLinesChanged` 자동 단언. |
| 4. 한국체육대 `knsu-press-release` 삽입 + 커밋 + 타깃 수 불변 | 충족 | `korea-national-sport-university-본교` 블록에 지정 4필드로 존재, 커밋 `5ed7eaf`. `getTargetUniversities().length` 43 불변. |
| 5. `.gitattributes` + `.gitignore` | 충족 | 스코프 규칙 2줄. `.gitignore` 2줄. `git status` 에 백업/로그 미노출. |
| 6. `npm test` 전/후 통과 + 커밋 3개 순서 + main/push/배포 없음 | 충족 | 298 → 300. 커밋 순서·브랜치·push 정책 준수. |
| 7. `node --check` 2파일 통과 + 제품 코드 diff 0 | 충족 | 제품 4파일 diff 0 재확인. |
| 8. `.pipeline/changes.md` 기록 | 충족 | 사전 측정·커밋 해시·검증 로그·`git diff -w` 편차까지 기록. |

최초 요구사항(카탈로그를 writer 직렬화 형식으로 1회 정규화 + 최소 diff 회귀 테스트 고정 + Option A writer 미수정 + knsu 1건 비활성 삽입)은 모두 달성.

# 테스트 결과

- `npm test`: tests 300 / pass 300 / fail 0 (Reviewer 재실행으로 확인). baseline 298 → +2 신규.
- 대상 2파일 `node --test`: 34 / 34 pass. 신규 케이스 2개 모두 pass.
- Tester 종합 판정 "합격(조건부), 차단 요소 없음" — Reviewer 교차 확인 결과 타당.
- 조건부 사유 2건은 구현 결함이 아니라 spec 완료 기준 문구의 실현 불가능성에서 기인.

# 문제점

## 문제점 1 — spec 완료 기준 1.2 "`git diff -w` 결과가 비어 있음" 은 실현 불가능 (심각도: 낮음, spec 결함)

`git diff -w`(`--ignore-all-space`)는 라인 내부 공백만 무시하고 인라인 배열/객체를
여러 줄로 펼칠 때 추가되는 개행은 변경으로 남긴다. spec 의 "조사로 확인된 현재 상태"
표 자체가 "-12줄 / +40~55줄 reflow" 를 예측하므로, 같은 spec 안에서 1.2 와 내부 모순이다.
어떤 JSON pretty-print 정규화로도 문자 그대로 만족 불가.

- 판정: **(b) 승인 + spec 개정 권고**. Coder 가 중단하지 않고 진행한 판단은 타당하다.
  값 무변경 증거는 (a) deep re-serialize 동일 (b) 대학/소스 수 동일
  (c) **커밋 A 부모를 동일 정규화기에 통과 → 커밋 A 와 바이트 단위 완전 일치**
  3중으로 대체되었고, (c)는 `git diff -w` 보다 강한 증거다. Reviewer 가 직접 재현해 확인했다.
- 향후 조치: spec 완료 기준을 "`git diff -w` 비어 있음" 대신
  "`JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))` + 대학/소스 수 동일
  + 부모 재직렬화 바이트 일치" 로 개정 권고.

## 문제점 2 — B1 회귀 테스트가 "삭제 0줄" 을 컨테이너 라인 1줄 예외로 우회 (심각도: 낮음, 타당)

병합 스텁이 남긴 빈 `"sources": []` 에 원소를 append 하면 `JSON.stringify` 규칙상
`"sources": [` 로 그 여는 라인이 반드시 재작성된다. 헬퍼는 `/^\s*"sources": \[\],?$/`
정규식으로 이 1줄만 허용하고 그 외 삭제/치환은 전부 실패로 처리한다.

- 판정: **타당(승인)**. "삭제 0줄" 은 empty→nonempty 배열에서 물리적으로 불가능하며,
  대안은 (제품 코드 수정 = Option A 위반) 또는 (B1 미사용 = 요구사항 위반)뿐이다.
  완료 기준의 실제 의도("타 대학·소스 라인 변경 0")는 그대로 강제된다.
  Reviewer 가 커밋 C 실제 diff 로 확인: 컨테이너 라인 1줄 외 삭제/치환 0.
- 향후 조치: spec 완료 기준 2를 "삭제 0줄" 대신 "타 대학·소스 라인 변경 0줄" 로 개정 권고.

## 문제점 3 — 요청하지 않은 변경 없음 (확인 완료)

3커밋이 건드린 파일은 카탈로그(A/C), `.gitattributes`·`.gitignore`·테스트 2파일(B)뿐.
제품 코드·무관 파일 혼입 0. `stash@{0}`(CAU rss) 미접촉. 전역 `*.json` 규칙 미적용,
`apply-batch-reports/` 미추가 — 모두 spec 의 미회신 기본값대로.

# 잔여 위험 (이번 라운드 범위 밖, 후속 필요)

1. **`origin/main` 카탈로그 분기 (`.pipeline/merge-analysis.md`)** — 로컬이 33개 소스에서
   앞서고 원격이 1개(`knue-general-notice`)에서 앞섬. 이 feat 브랜치가 나중에
   `main`/`origin/main` 과 병합될 때 정규화 reflow + `korea-national-sport-university-본교`
   블록이 대규모 텍스트 충돌을 낼 수 있다. 병합 담당자는 필드 단위 수동 병합 +
   병합 후 정규화 직렬화 1회 재적용 필요. Brain/사용자 승인 후 별도 라운드에서 처리.
2. **`core.autocrlf=true` + 신규 `.gitattributes`** — 다른 워킹트리에서 `.gitattributes`
   반영 전 카탈로그를 수정하면 CRLF 로 저장돼 전체 파일 diff 가 재발할 수 있다.
   `.gitattributes` 병합 시 `git add --renormalize` 동반 권장.
3. **`.pipeline/spec.md` / `changes.md` / `test-results.md` 워킹트리 미커밋, `merge-analysis.md` untracked**
   — 파이프라인 산출물이며 이 작업 커밋이 만든 것이 아니다. 커밋 대상 아님(정상).
   프로젝트 관례에 따라 별도 처리.
4. **B1 회귀 테스트가 실제 카탈로그·후보 파일에 의존** — `korea-national-sport-university-본교`
   블록 또는 knsu 후보의 `finalDecision` 이 바뀌면 테스트가 깨진다(설계된 동작이나 리팩터 시 취약).

# 최종 판정
승인

# 판정 이유

- spec 완료 기준 1~8 이 모두 충족되었고, Reviewer 가 정규화 무손실성(deep re-serialize
  동일 + 대학/소스 수 동일 + 부모 재직렬화 바이트 일치)·Option A 준수(제품 4파일 diff 0)·
  커밋 위생(카탈로그 단독 A 커밋, 3커밋 순서, main 미커밋, push/배포 없음, 트레일러 부합)·
  knsu 삽입 상태·`npm test` 300/300 을 직접 재현해 확인했다.
- 문자 그대로 불충족한 완료 기준 문구 2건(1.2 "`git diff -w` 비어 있음", 2 "삭제 0줄")은
  **spec 자체의 실현 불가능한 조건**이며 구현 결함이 아니다. 두 경우 모두 완료 기준의
  실제 의도(값 무변경 / 타 대학·소스 라인 변경 0)는 더 강한 증거로 충족되었고,
  Coder 의 두 확인필요 판단과 Tester 의 수용은 타당하다.
- 잔여 위험(원격 병합 분기, autocrlf)은 모두 이번 라운드 범위 밖이며 문서화되어 있어
  배포 게이트가 아니다. 요청하지 않은 변경, 명백한 오류, 안전 문제 없음.
- 조건: Planner 는 향후 spec 작성 시 완료 기준 1.2 / 2 문구를 위 "향후 조치" 대로 개정하고,
  병합 담당자는 잔여 위험 1을 인지할 것.
