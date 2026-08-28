# 변경된 파일

- `D:\hhg(code)\development\university-news\data\university-news-sources.final.json` (커밋 A: 정규화 / 커밋 C: knsu 소스 1건 삽입)
- `D:\hhg(code)\.gitattributes` (신규, 커밋 B)
- `D:\hhg(code)\.gitignore` (커밋 B, 2줄 추가)
- `D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.test.js` (커밋 B, 헬퍼+테스트 추가)
- `D:\hhg(code)\server\agent\gate\apply-source-activation.test.js` (커밋 B, 헬퍼+테스트 추가)

제품 writer 코드(`prepare-catalog-source-block.js`, `apply-source-activation.js`, `store.js`, `targets.js`)는 **diff 0** (아래 검증 참조).

---

# AGENTS.md 4절 "여는 명령"

편집 전 각 파일을 여는 명령(PowerShell):

```powershell
Get-Content -Raw -LiteralPath "D:\hhg(code)\development\university-news\data\university-news-sources.final.json"
Get-Content -Raw -LiteralPath "D:\hhg(code)\.gitignore"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.test.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\server\agent\gate\apply-source-activation.test.js"
```

편집 후 검증:

```powershell
node --check "D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.test.js"
node --check "D:\hhg(code)\server\agent\gate\apply-source-activation.test.js"
node -e "JSON.parse(require('fs').readFileSync('D:\\hhg(code)\\development\\university-news\\data\\university-news-sources.final.json','utf8'));console.log('JSON OK')"
```

전부 통과 (`checks ok`, `JSON OK`).

---

# 변경 내용

## 사전 측정 (구현 계획 0)

| 항목 | 결과 |
|---|---|
| 1. `git rev-parse --abbrev-ref HEAD` | `feat/onboarding-gate-bridges` (일치, 진행) |
| 2. `git status --porcelain` (카탈로그) | 클린 (`.pipeline/spec.md` M, `.pipeline/merge-analysis.md` ?? 만 존재 — 이 작업과 무관, 미접촉) |
| 3. `git stash list` | `stash@{0}: On main: pre-existing uncommitted CAU rss source edit` — **미접촉 (pop 안 함)** |
| 3. `git stash show -p stash@{0} --stat` | `university-news-sources.final.json | 14 ++++++++++----` (10 insertions / 4 deletions). CAU(중앙대) `cau-official-news` 소스 블록 1건을 html→rss 로 바꾸고 `rssUrl`/`baseUrl`/`officialNames`/`detailSelectors` 추가, `verified` false→true. 카탈로그 줄 ~355 부근 (정규화가 건드린 첫 인라인 구조 줄 404보다 앞). |
| 4. 카탈로그 측정 (정규화 전, 워킹트리) | `bytes 262948`, `crlf 7690`, `lines 7691`, `endsNL true`, `alreadyNormalized false`, `semanticEqual true`, `universities 247`, `sources 91` |
| 4. `alreadyNormalized` | **false** → 커밋 A 필요 (12곳 인라인 구조 reflow) |
| 5. `git ls-files --eol "*.json"` CRLF tracked | 카탈로그 포함 모든 tracked JSON 이 `i/lf` (인덱스=LF). 워킹트리만 `w/crlf` (core.autocrlf=true 체크아웃). **CRLF 로 커밋된 JSON 은 0건.** → 기본값대로 스코프 규칙만 적용 (전역 `*.json` 규칙 미적용). |
| 6. `npm test` 정규화 전 기준선 | `tests 298, pass 298, fail 0` |
| `getTargetUniversities().length` 정규화 전 | **43** |

`core.autocrlf=true`. 카탈로그의 커밋본(인덱스)은 이미 LF 였고, 워킹트리 파일만 체크아웃 시 CRLF 로 변환된 상태였음.

## 커밋 A — 카탈로그 정규화 (`b20d55e`)

- `const out = JSON.stringify(JSON.parse(raw), null, 2) + "\n";` 로 카탈로그 1파일 전체 1회 덮어쓰기 (LF).
- 손으로 압축한 인라인 구조 12곳이 여러 줄로 reflow: `khu officialNames`, `khu fixedParams`, `jbnu fixedParams(menu 2377)`, `jbnu fixedParams(menu 2382)`, `gachon titleCleanupTokens`, `gachon officialNames`, `dankook officialNames`, `dankook titleCleanupTokens`, `dankook officialNames(2번째 블록)`, `postech officialNames`, `unist officialNames`, `pukyong officialNames`.
- 커밋 stat: `1 file changed, 41 insertions(+), 12 deletions(-)` (순수 reflow, 12줄 → 41줄).

### 정규화 무손실 단언 (전부 통과)

- 의미 무손실: `JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))` → **true**
- 대학 수: `247 === 247` → **true**
- 소스 수: `sum(u.sources.length)` `91 === 91` → **true**
- **추가(가장 강한) 증거**: 커밋 A 직전 HEAD(`b20d55e~1`) 의 카탈로그를 동일 정규화기(`JSON.stringify(JSON.parse(x),null,2)+"\n"`)에 통과시킨 결과가 워킹트리 파일과 **바이트 단위 완전 일치** (`HEAD normalized === working tree : true`). 즉 값·키 순서·배열 순서 변경 0을 독립 재현으로 증명.
- 커밋 후 `node -e "JSON.parse(...)"` → **JSON OK**
- `git diff --stat` → 카탈로그 1파일만.

### `git diff -w` 관련 — spec 단언과의 편차 (Reviewer 확인 필요, 아래 "참고사항" 상세)

`git diff -w`(= `--ignore-all-space`)는 **라인 내부 공백만** 무시하고, 인라인 구조를 여러 줄로 펼칠 때 **추가되는 개행은 무시하지 않는다**. 따라서 `["경희대학교"]` → 3줄 reflow 는 `git diff -w` 에서도 변경으로 표시되어, spec 1.2 의 "`git diff -w` 결과가 비어 있음" 단언은 **어떤 JSON pretty-print 정규화로도 문자 그대로 만족 불가능**하다. (spec 파일 표 자체가 "-12줄/+40~55줄 reflow" 를 예상하고 있어 내부 모순.) 값 무변경은 위의 4개 단언 + 바이트 단위 재현으로 확정했고, 실제 `git diff` 육안 확인 결과 12곳 reflow 외 토큰 변경 0. 이 편차를 이유로 중단하지 않고 진행함.

## 커밋 B — .gitattributes + .gitignore + 회귀 테스트 2종 (`fe69441`)

- `.gitattributes` (신규):
  ```
  development/university-news/data/university-news-sources.final.json text eol=lf
  server/agent/gate/data/** text eol=lf
  ```
  전역 `*.json` 규칙은 기본값대로 **미적용** (사전 측정 5: CRLF tracked JSON 0건이라 기술적으로는 안전하나, 요청 기본값이 "스코프 규칙만").
- `.gitignore` 파일 끝에 2줄 추가:
  ```
  development/university-news/data/*.prepare-backup.*
  server/agent/onboarding/data/catalog-prepare-log.json
  ```
- `prepare-catalog-source-block.test.js`: `assertSingleContiguousInsertion` 헬퍼 + 테스트 1개 추가.
  정규화된 실제 카탈로그 사본 + 실제 후보 파일(`collector-config-candidates.json`)에서 `knsu-press-release` 후보의 `universityId` 를 **exact string 으로 읽어**(하드코딩 아님) `prepareCatalogSourceBlock` 실행 → 삽입 결과가 연속 1블록이고, 삽입 블록에 `"id": "knsu-press-release"` / `"status": "selector_required"` / `"enabled": false` / `"verified": false` 포함, `"universityId"` 미포함(대학 블록 신규 생성 안 함), `enabled/verified/status/healthStatus` 값 단언.
- `apply-source-activation.test.js`: `assertOnlyLinesChanged` 헬퍼 + 테스트 1개 추가.
  writer 형식(`+ "\n"`) 카탈로그 fixture 에 `applyMinimalDiff` + `writeJsonAtomic` 적용 → `enabled`/`status` 2줄만 변경(verified 는 from===to 라 불변), 라인 수 불변, 무관한 소스(`unrelated-source`) `enabled:true` 불변 단언. `writeJsonAtomic` 를 require 목록에 추가.
- 커밋 stat: `4 files changed, 156 insertions(+)`.

## 커밋 C — 한국체육대 knsu-press-release 실제 삽입 (`5ed7eaf`)

- 스크래치패드 임시 node 러너(커밋 안 함)로 실행. `universityId` 를 `collector-config-candidates.json` 에서 exact string(`"korea-national-sport-university-본교"`, 한글 `본교` 포함)으로 읽어 `prepareCatalogSourceBlock({ universityId, sourceId: "knsu-press-release" })` 호출.
- 러너 출력: `status: "PREPARED"`, `checksumBefore e9bf65c3...`, `checksumAfter 45bf1aee...`, `sourceBlock` = `{ id: knsu-press-release, ..., verified:false, enabled:false, status:"selector_required", healthStatus:"unknown" }`, `mutation` 전부 false.
- 삽입 위치: 카탈로그 `korea-national-sport-university-본교` 블록의 `"sources": []` → 소스 1건.
- 커밋 stat: `1 file changed, 28 insertions(+), 1 deletion(-)`.
  `-1` 은 `"sources": [],` 컨테이너 라인이 `"sources": [` 로 열리는 변경 (빈 배열 → 원소 1개일 때 `JSON.stringify` 상 불가피). 다른 대학/소스 라인 변경 0.
- `git status` 에 `*.prepare-backup.*` / `catalog-prepare-log.json` **나타나지 않음** (gitignore 확인: `git check-ignore -v` 로 두 파일 모두 매칭 확인).
- 임시 러너 삭제 완료.

---

# 검증 결과

| 시점 | `npm test` | `getTargetUniversities().length` |
|---|---|---|
| 정규화 전 (기준선) | tests 298 / pass 298 / fail 0 | 43 |
| 커밋 A 후 | tests 298 / pass 298 / fail 0 | 43 |
| 커밋 B 후 | tests 300 / pass 300 / fail 0 (신규 테스트 2개 +) | 43 |
| 커밋 C 후 | tests 300 / pass 300 / fail 0 | 43 |

회귀 0.

- `node --check` — `prepare-catalog-source-block.test.js`, `apply-source-activation.test.js` 둘 다 통과.
- 제품 writer 코드 4개 파일 `git diff 3e602ed HEAD -- <4파일>` → **출력 없음 (diff 0)**.
- 커밋 3개가 `feat/onboarding-gate-bridges` 위에 순서대로 존재:
  - `b20d55e` chore(catalog): normalize university-news-sources.final.json to writer format
  - `fe69441` test(catalog): lock in minimal-diff of B1 + gate writers on normalized catalog; add scoped .gitattributes
  - `5ed7eaf` feat(catalog): register knsu-press-release for 한국체육대 as disabled (selector_required)
- `main` 직접 커밋 없음. `git push` 없음. 배포/스케줄러 실행 없음.
- `stash@{0}` 미접촉 (여전히 `git stash list` 에 존재).

## 정규화 무손실 재확인 (커밋 A 부모 vs 커밋 A)

```
semantic equal: true
unis 247 247   sources 91 91
```

## knsu 삽입 diff (커밋 C)

```
@@ -6902,7 +6902,34 @@
-      "sources": [],
+      "sources": [
+        { "id": "knsu-press-release", ... "verified": false, "enabled": false,
+          "status": "selector_required", "healthStatus": "unknown" }
+      ],
```
삭제 1줄(컨테이너 오픈), 삽입 27줄, 타 대학/소스 라인 변경 0.

---

# 미구현 항목 / 보류

- 없음. 요청한 커밋 A/B/C 전부 완료.
- 전역 `.gitattributes *.json text eol=lf` 규칙: 기본값대로 미적용 (사전 측정 5 에서 CRLF tracked JSON 0건이라 안전하긴 하나 요청 기본값이 스코프 한정).
- `apply-batch-reports/` gitignore: 요청 기본값대로 미추가.
- `stash@{0}` (CAU rss 편집): 요청 기본값대로 미접촉.

---

# 참고사항 (Tester가 알아야 할 내용)

1. **`git diff -w` "비어 있음" 단언은 이번 정규화로 문자 그대로 충족 불가** — Reviewer 확인 요망.
   `-w`(`--ignore-all-space`)는 라인 내부 공백만 무시하며, 인라인 배열/객체를 여러 줄로 펼칠 때
   추가되는 개행은 diff 에서 변경으로 남는다. spec 파일 표가 예측한 "reflow -12/+40~55줄" 과
   spec 1.2 의 "`git diff -w` 비어 있음" 은 서로 모순이다.
   값 무변경 증거는 다음 3중으로 대체·강화했다:
   (a) `JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))` = true
   (b) 대학 수 247=247, 소스 수 91=91
   (c) **커밋 A 직전 HEAD 를 동일 정규화기에 통과 → 워킹트리와 바이트 단위 완전 일치** (가장 강한 증거)
   Tester 는 `git diff -w` 대신 (a)~(c) 로 무손실을 검증할 것.

2. **B1 회귀 테스트의 헬퍼는 "빈 sources 배열 오픈 1줄" 을 유일 예외로 허용**한다.
   한국체육대 대학 블록이 병합 스텁으로 `"sources": []` 상태이므로, 소스를 append 하면
   `JSON.stringify` 상 `"sources": [],` → `"sources": [` 로 그 컨테이너 라인 1줄이 반드시 다시 써진다.
   이는 삽입 대상 배열 자신의 여는 라인이고 다른 대학/소스와 무관하다. 헬퍼는
   `/^\s*"sources": \[\],?$/` 정규식으로 이 1줄만 허용하고 그 외 삭제/치환은 전부 실패로 본다.
   spec 완료기준 2의 "삭제 0줄" 은 empty→nonempty 배열에서 불가능하므로 이렇게 조정함
   (제품 코드 미수정, 완료기준 의도 = "타 대학·소스 라인 변경 0" 은 유지).
   커밋 C 후에도 테스트는 knsu-press-release 를 먼저 필터링 제거하므로 계속 green.

3. `core.autocrlf=true` 환경. 새 `.gitattributes` 가 카탈로그와 `server/agent/gate/data/**` 를
   `text eol=lf` 로 고정한다. 워킹트리에서 해당 파일을 다시 체크아웃하면 LF 로 정규화된다.
   커밋 시 `warning: LF will be replaced by CRLF` 경고가 뜨지만 인덱스에는 LF 로 저장된다(정상).

4. 임시 산출물 `university-news-sources.final.json.prepare-backup.20260828153340`,
   `server/agent/onboarding/data/catalog-prepare-log.json` 은 워킹트리에 남아 있으나
   `.gitignore` 로 제외됨 (무해, 삭제해도 됨).

5. 신규 npm 의존성 없음. 테스트는 `npm test` (= `node --test` 자동 탐색).

6. 별도 이슈(이번 범위 밖): `.pipeline/spec.md` 가 워킹트리에서 M 상태, `.pipeline/merge-analysis.md`
   untracked — 이 작업이 만든 것이 아니며 커밋하지 않았다.
