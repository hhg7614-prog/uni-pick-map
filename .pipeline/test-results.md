# 테스트 요약

전체 결과: **합격 (조건부)**

- 3개 커밋(`b20d55e` 정규화 / `fe69441` 테스트+gitattributes / `5ed7eaf` knsu 삽입)이
  `feat/onboarding-gate-bridges` 위에 순서대로 존재. `main` 커밋·`git push`·배포 없음.
- `npm test` 2회 연속 `tests 300 / pass 300 / fail 0` (baseline 298 → +2 신규 테스트).
- 제품 writer 코드 4개 파일 diff 0. 정규화 무손실 3중 증명.
- 조건부 사유 2건은 **구현 결함이 아니라 spec 완료기준 문구 자체의 실현 불가능성**이며,
  Coder 의 재평가(확인필요 #1·#2)를 Tester 가 수용함(아래 판정 참조).

---

# 완료 기준

- **조건 1 (정규화 커밋 A / `git diff -w` 공백 외 변경 0 / JSON OK / 무손실 로그): 통과 (조건부)**
  - 커밋 `b20d55e` 는 카탈로그 1파일만 포함 (`git show --stat`: `1 file changed, 41 insertions(+), 12 deletions(-)`). 통과.
  - 커밋 후 `node -e "JSON.parse(...)"` → `JSON OK`. 통과.
  - `JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))` → **true** (직접 실행). 통과.
  - 대학 수 `247 === 247`, 소스 수 `91 === 91` (직접 실행). 통과.
  - **`git diff -w` 가 비어있지 않음 (실패, 그러나 spec 자체 모순)**: `git show -w b20d55e` 결과는
    풀 diff 와 동일. `-w`(`--ignore-all-space`)는 라인 내부 공백만 무시하고 인라인 구조를
    여러 줄로 펼칠 때 추가되는 개행은 무시하지 않음. spec 파일 표가 예측한 "reflow -12/+40~55줄"
    과 "1.2 `git diff -w` 비어 있음" 은 서로 모순 → 어떤 pretty-print 정규화로도 문자 그대로 충족 불가.
    값 무변경은 아래 3중 증거로 대체 확인했으므로 **완료기준의 의도(값 무변경)는 충족**.

- **조건 2 (B1 회귀 테스트): 통과 (조건부)**
  - `B1 on the normalized real catalog inserts knsu-press-release as one contiguous block` 테스트가
    실제 존재하고 pass. 실제 카탈로그 + 실제 후보 파일에서 `universityId` 를 exact string 으로 읽음.
  - 삽입 블록에 `"id": "knsu-press-release"` / `"status": "selector_required"` / `"enabled": false`
    / `"verified": false` 포함, `"universityId"` 미포함 단언. `healthStatus:"unknown"` 단언.
  - **"삭제 0줄" 은 문자 그대로 불충족**: 헬퍼 `assertSingleContiguousInsertion` 이
    `"sources": []` → `"sources": [` 컨테이너 라인 1줄을 유일 예외로 허용(`/^\s*"sources": \[\],?$/`).
    빈 배열 → 원소 1개는 `JSON.stringify` 상 이 컨테이너 라인이 반드시 재작성됨. 다른 대학/소스
    라인 변경은 0줄로 강제 → **완료기준 의도(타 대학·소스 라인 변경 0) 충족**.

- **조건 3 (게이트 회귀 테스트): 통과**
  - `gate writeJsonAtomic + applyMinimalDiff on a writer-format catalog only rewrites the targeted field lines`
    테스트 존재 + pass. writer 형식(`+ "\n"`) fixture 에 `applyMinimalDiff` + `writeJsonAtomic` 적용 →
    `assertOnlyLinesChanged` 가 `enabled`/`status` 2줄만 변경 + 라인 수 불변 + 무관한 소스
    (`unrelated-source` `enabled:true`) 불변을 자동 단언. `verified` 는 from===to 라 불변.

- **조건 4 (한국체육대 소스 존재 + getTargetUniversities 불변): 통과**
  - 카탈로그 `korea-national-sport-university-본교` 블록에 `knsu-press-release` 1건 존재.
    `{"enabled":false,"verified":false,"status":"selector_required","healthStatus":"unknown"}` 확인 (node 파싱).
  - 커밋 `5ed7eaf` 에 포함됨. `getTargetUniversities().length === 43` (정규화 전 기록치와 동일).

- **조건 5 (.gitattributes + .gitignore): 통과**
  - `.gitattributes`: `development/university-news/data/university-news-sources.final.json text eol=lf`
    + `server/agent/gate/data/** text eol=lf` 2줄만. 전역 `*.json` 규칙 없음.
    `git check-attr` 로 두 경로 모두 `text: set / eol: lf` 적용 확인.
  - `.gitignore`: `development/university-news/data/*.prepare-backup.*` +
    `server/agent/onboarding/data/catalog-prepare-log.json` 2줄 추가(커밋 `fe69441`).
  - 워킹트리에 백업/로그 파일이 실재하지만 `git status --porcelain` 에 미노출.
    `git check-ignore -v` 로 두 파일 모두 매칭 확인.

- **조건 6 (npm test 전/후 통과 + 커밋 3개 순서 + main/push/배포 없음): 통과**
  - `npm test` 2회 연속 `tests 300 / pass 300 / fail 0` (원본 아래).
  - baseline 298 (changes.md 기록) → 300, 델타 +2 = 신규 테스트 2개.
  - 커밋 순서: `b20d55e`(A) → `fe69441`(B) → `5ed7eaf`(C), 부모 `3e602ed`. reflog 일치.
  - `main` == `origin/main` == `1d46917`, 우리 3커밋을 포함하는 원격 브랜치 없음. push 흔적 없음.

- **조건 7 (node --check 2개 + 제품 코드 diff 0): 통과**
  - `node --check` — `prepare-catalog-source-block.test.js`, `apply-source-activation.test.js` 둘 다 통과.
  - `git diff 3e602ed HEAD -- prepare-catalog-source-block.js apply-source-activation.js store.js targets.js`
    → **출력 없음 (diff 0)**.

- **조건 8 (changes.md 기록): 통과**
  - 사전 측정 수치, 3개 커밋 해시, 무손실 단언 로그, `git diff --stat`, `npm test` 전/후 요약,
    `getTargetUniversities().length` 전/후, knsu 삽입 diff 기록됨. `git diff -w` 편차도 명시.

---

# 실패한 테스트

없음. `node --test` 대상 테스트 전부 pass (2회 연속 300/300).

문자 그대로 불충족한 완료기준 문구 2건(둘 다 spec 자체의 실현 불가능한 조건):

1. **완료기준 1.2 "`git diff -w` 결과가 비어 있음"** — 인라인 구조를 다중 라인으로 펼치는 어떤
   정규화로도 불가능. `-w` 는 개행 추가를 무시하지 않음. spec 표(`-12/+40~55줄 reflow`)와 모순.
2. **완료기준 2 "삭제 0줄"** — 병합 스텁이 남긴 빈 `"sources": []` 배열에 원소를 넣으면
   `JSON.stringify` 상 컨테이너 라인 1줄이 반드시 재작성됨. empty→nonempty 배열에서 불가능.

두 경우 모두 **값/타 대학·소스 라인 무변경이라는 완료기준의 의도는 충족**됨.

---

# 재현 방법

## 정규화 무손실 (완료기준 1)
```
cd "D:/hhg(code)"
node -e "
const cp=require('child_process');
const P='development/university-news/data/university-news-sources.final.json';
const before=cp.execSync('git show b20d55e~1:'+P,{maxBuffer:1e9}).toString('utf8');
const after=cp.execSync('git show b20d55e:'+P,{maxBuffer:1e9}).toString('utf8');
const jb=JSON.parse(before), ja=JSON.parse(after);
console.log('semanticEqual', JSON.stringify(jb)===JSON.stringify(ja));            // true
console.log('unis', jb.universities.length, ja.universities.length);              // 247 247
const cnt=c=>c.universities.reduce((a,u)=>a+(u.sources||[]).length,0);
console.log('sources', cnt(jb), cnt(ja));                                        // 91 91
console.log('parentNormalized===after', (JSON.stringify(jb,null,2)+String.fromCharCode(10))===after); // true (가장 강한 증거)
"
```
`git show b20d55e -- <catalog>` 육안: 12곳 전부 `"officialNames": [...]` / `"fixedParams": {...}` /
`"titleCleanupTokens": [...]` 인라인 압축 구조의 다중 라인 reflow. 값/키/배열순서 토큰 변경 0.

## knsu 삽입 diff (완료기준 2·4)
```
git show 5ed7eaf -- development/university-news/data/university-news-sources.final.json
```
→ `@@ -6902,7 +6902,34 @@`, `-  "sources": [],` / `+  "sources": [` + knsu 블록 27줄.
삭제/치환 라인은 컨테이너 라인 1개뿐, 다른 대학/소스 라인 0건.

## 회귀 테스트 2종
```
node --test server/agent/onboarding/tools/prepare-catalog-source-block.test.js server/agent/gate/apply-source-activation.test.js
```
→ `tests 34 / pass 34 / fail 0`. 신규 케이스:
- `B1 on the normalized real catalog inserts knsu-press-release as one contiguous block (0 deletions, no other lines touched)`
- `gate writeJsonAtomic + applyMinimalDiff on a writer-format catalog only rewrites the targeted field lines`

## 커밋 구조 / push 없음
```
git log --oneline 3e602ed..HEAD           # 3커밋
git show --stat b20d55e                   # 카탈로그 1파일
git branch -r --contains b20d55e          # 출력 없음
git stash list                            # stash@{0} 1개 (미접촉)
```

## knsu 상태 / 타깃 수
```
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('development/university-news/data/university-news-sources.final.json','utf8'));const u=c.universities.find(x=>x.universityId.startsWith('korea-national-sport-university'));console.log(JSON.stringify(u.sources.find(s=>s.id==='knsu-press-release')));"
node -e "console.log(require('./server/agent/targets').getTargetUniversities().length)"   # 43
```

---

# npm test 2회 원본 (꼬리)

## 1회차
```
✔ 부산 사립 사회복지는 동아대 부민캠퍼스의 확인된 학과를 반환한다 (1.522ms)
✔ 성적만 입력하면 추정하지 않고 제한 안내로 끝낸다 (0.8532ms)
✔ 존재하지 않는 위치와 학교는 결과 없음으로 처리한다 (1.5804ms)
✔ 서울 근처는 수도권으로 변환한다 (1.2076ms)
ℹ tests 300
ℹ suites 0
ℹ pass 300
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 843.3391
```

## 2회차
```
✔ 부산 사립 사회복지는 동아대 부민캠퍼스의 확인된 학과를 반환한다 (1.259ms)
✔ 성적만 입력하면 추정하지 않고 제한 안내로 끝낸다 (0.6825ms)
✔ 존재하지 않는 위치와 학교는 결과 없음으로 처리한다 (1.3873ms)
✔ 서울 근처는 수도권으로 변환한다 (1.044ms)
ℹ tests 300
ℹ suites 0
ℹ pass 300
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 854.2468
```

정규화 전 baseline(changes.md 기록): `tests 298 / pass 298 / fail 0`. Tester 는 정규화 전 상태를
되돌리지 않았으나(작업 트리 오염 방지), 델타 +2 는 확인된 신규 테스트 2개와 정확히 일치.

---

# Coder 확인필요 2건에 대한 Tester 판정

## 확인필요 #1 — "`git diff -w` 비어 있음" 문자 그대로 불가 → **수용 (PASS)**

`git show -w b20d55e -- <catalog>` 를 직접 실행한 결과 풀 diff 와 동일하게 12곳 reflow 가
그대로 남음. `-w`(`--ignore-all-space`)의 정의상 라인 내부 공백만 무시하고 인라인
배열/객체를 다중 라인으로 펼칠 때 추가되는 개행은 변경으로 남는다. spec 파일의
"조사로 확인된 현재 상태" 표가 이미 "-12줄/+40~55줄 reflow" 를 예상하고 있어 spec 1.2 와
내부 모순이다. 값 무변경은 (a) deep re-serialize 동일 (b) 대학/소스 수 동일
(c) **커밋 A 부모를 동일 정규화기에 통과 → 커밋 A 와 바이트 단위 완전 일치** 로 확정.
이는 `git diff -w` 보다 강한 증거이며, 완료기준의 실제 의도(값 무변경)를 충족한다.
Coder 가 이 편차로 중단하지 않은 판단은 타당함.

## 확인필요 #2 — B1 헬퍼의 `"sources": []` → `[` 컨테이너 라인 1줄 예외 → **수용 (PASS)**

`git show 5ed7eaf -- <catalog>` 로 실제 삽입 diff 확인: 삭제/치환 라인은
`"sources": [],` → `"sources": [` 단 1줄이고, 그 외 모든 변경은 knsu 블록 내부의 순수
삽입(27줄)이다. 다른 대학·다른 소스의 라인 변경은 0건. 한국체육대 대학 블록이 병합
스텁으로 `"sources": []` 이므로 소스를 append 하면 `JSON.stringify` 규칙상 이 컨테이너
라인이 반드시 재작성된다. 이는 "삽입 대상 배열 자신의 여는 라인"이며 최소 diff 원칙을
깨지 않는다. 헬퍼는 `/^\s*"sources": \[\],?$/` 로 이 1줄만 허용하고 그 외 삭제/치환은
전부 실패로 처리하므로 회귀 방어력은 유지된다. 완료기준 2 "삭제 0줄" 은
empty→nonempty 배열에서 실현 불가능하므로 이 조정은 정당하며, 의도("타 대학·소스
라인 변경 0")는 그대로 지켜진다.

---

# 발견 문제

## 차단 요소 (blocker)
- 없음.

## 경미 / 범위 밖
1. **`.pipeline/spec.md` 워킹트리 수정 미커밋** (`342 insertions / 317 deletions`).
   이 작업 커밋이 만든 것이 아니며(마지막 spec.md 커밋은 `0d7a8b2`), Coder/Tester 는
   커밋하지 않았다. Planner/파이프라인 산출물로 보임. 이번 검증 대상 아님.
2. **`.pipeline/merge-analysis.md` untracked**, `.pipeline/changes.md` 수정 — 파이프라인 문서.
   커밋 대상 아님(정상).
3. 임시 산출물 `university-news-sources.final.json.prepare-backup.20260828153340`,
   `server/agent/onboarding/data/catalog-prepare-log.json` 이 워킹트리에 잔존하나
   `.gitignore` 로 제외되어 `git status` 에 안 나타남. 무해(삭제 가능).
4. spec 완료기준 1.2 / 2 의 문구가 물리적으로 실현 불가능 — **Reviewer/Planner 가 향후
   spec 작성 시 `git diff -w` 대신 "deep re-serialize 동일 + 카운트 동일" 을,
   "삭제 0줄" 대신 "타 대학·소스 라인 변경 0줄" 을 완료기준으로 쓸 것을 권장**.

---

# 위험 요소

1. **`core.autocrlf=true` 환경 + 새 `.gitattributes`**: 카탈로그와 `server/agent/gate/data/**`
   를 재체크아웃하면 LF 로 정규화된다. 커밋 시 `warning: LF will be replaced by CRLF`
   경고가 뜨지만 인덱스에는 LF 저장(정상). 다른 개발자의 워킹트리에서 카탈로그를
   수정하면 `.gitattributes` 반영 전 CRLF 로 저장돼 전체 파일 diff 가 재발할 수 있으니
   `git add --renormalize` 없이 `.gitattributes` 만 병합되는 상황을 주의.
2. **`stash@{0}` (CAU rss 편집, On main) 나중 pop 시**: CAU 블록(카탈로그 상단, 첫 인라인
   구조보다 앞)이 정규화로 인라인 구조가 아니므로 직접 충돌 가능성은 낮으나, 스태시가
   "On main" 기준이고 현재 브랜치는 `feat/onboarding-gate-bridges` 이므로 pop 시 컨텍스트
   불일치 가능. 해소 시 스태시 필드 값 채택 후 정규화 직렬화 1회 재적용 권장(spec 예외표).
3. **원격 병합 미해결**: `merge-analysis.md` 기준 `origin/main` 과 카탈로그 활성화 필드가
   33 vs 1 로 분기. 이 작업(feat 브랜치)이 나중에 `main`/`origin/main` 과 병합될 때
   `korea-national-sport-university-본교` 블록·정규화 reflow 가 대규모 텍스트 충돌을 낼
   수 있음. 이번 라운드 범위 밖이나 병합 담당자가 인지 필요.
4. **B1 회귀 테스트가 실제 카탈로그 파일에 의존**: `korea-national-sport-university-본교`
   대학 블록이 카탈로그에서 사라지거나 `collector-config-candidates.json` 에서
   `knsu-press-release` 후보의 `finalDecision` 이 바뀌면 테스트가 깨진다(설계된 동작이나,
   카탈로그 리팩터 시 취약).
5. **게이트 회귀 테스트는 합성 fixture 사용**: 실제 `server/agent/gate/data` 산출물 형식과
   미세하게 다를 수 있음. 다만 `writeJsonAtomic` + `applyMinimalDiff` 자체를 호출하므로
   writer 형식 회귀는 포착 가능.

---

# 최종 테스트 상태

**통과 (조건부 합격)**

- 모든 구현 요구사항(정규화 / `.gitattributes` / `.gitignore` / 회귀 테스트 2종 / knsu 삽입)이
  구현·커밋됨. 제품 코드 diff 0. `npm test` 300/300 2회 연속. 커밋 구조·브랜치·push 정책 준수.
- 조건부 사유는 spec 완료기준 1.2("`git diff -w` 비어 있음")·2("삭제 0줄") 문구가 물리적으로
  실현 불가능한 데서 비롯되며, 구현 결함이 아니다. 완료기준의 실제 의도(값·타 소스 라인
  무변경)는 더 강한 증거로 충족되었고 Coder 의 두 확인필요 판단을 Tester 가 수용한다.
- Reviewer 는 위 "발견 문제 4" (spec 문구 개선)와 "위험 요소 3" (원격 병합)을 확인할 것.
