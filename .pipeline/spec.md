# 목표

`development/university-news/data/university-news-sources.final.json`(뉴스 소스 카탈로그)를
**B1 / 게이트 writer 가 쓰는 직렬화 형식**(`JSON.stringify(JSON.parse(raw), null, 2) + "\n"`, LF)으로
**1회 정규화**한다. 정규화 이후 두 writer(B1 `prepare-catalog-source-block.js`,
게이트 `apply-source-activation.js` 의 `writeJsonAtomic`)가 소스 1건을 삽입/수정할 때
**최소 diff**(해당 소스 블록 라인만)만 내는지 회귀 테스트로 고정한다.

Option A 전략: **writer 코드(JSON.stringify 방식)는 고치지 않는다.** 파일을 writer 형식에 맞춘다.

작업 도메인 순서: `Development work (code reading -> code changes -> tests)`.
프로덕션 데이터 변경은 카탈로그 정규화 + 한국체육대 소스 1건 비활성 삽입뿐이며,
git push / 배포 / 스케줄러 실행은 하지 않는다. `main` 직접 커밋 금지.

# 요구사항

## 필수

1. **카탈로그 정규화 커밋 1개 (순수 whitespace/EOL, 값 무변경).**
   - `const out = JSON.stringify(JSON.parse(raw), null, 2) + "\n";` 로 파일 전체 1회 덮어쓰기.
   - 커밋 전 단언(하나라도 실패하면 중단, 커밋 금지):
     - 의미 무손실: `JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))`
     - 대학 수 동일: `JSON.parse(before).universities.length === JSON.parse(after).universities.length`
     - 소스 수 동일: `sum(u.sources.length)` before == after
     - `git diff -w` 결과가 **비어 있음**(공백 외 변경 0)
   - 이 정규화만 담은 **독립 커밋**. 다른 변경(테스트/gitattributes/삽입)을 섞지 않는다.

2. **`.gitattributes` 신규 추가 (최소 범위).**
   - 카탈로그 파일 + `server/agent/gate/data/**` 에 `text eol=lf` 지정.
   - 저장소 전역 `*.json text eol=lf` 는 **CRLF 로 커밋된 tracked JSON 이 하나도 없을 때만** 적용
     (판단 근거는 "구현 계획 > 0. 사전 측정" 참조). 기본값: 파일/디렉터리 단위 스코프만.

3. **writer 무변경 회귀 테스트 2종 추가 (제품 코드 미수정).**
   - B1: 정규화된 실제 카탈로그 사본 + 실제 후보(`knsu-press-release`, universityId 는
     `collector-config-candidates.json` 에서 exact string 으로 읽음)로
     `prepareCatalogSourceBlock` 실행 → 결과가 **연속된 1개 블록 삽입**(삭제 0줄,
     다른 대학/소스 라인 변경 0줄)임을 문자열 라인 비교로 단언.
   - 게이트: writer 형식(`+ "\n"`)으로 쓴 카탈로그 fixture 에 `applyMinimalDiff` +
     `writeJsonAtomic` 적용 → **대상 소스의 지정 필드 라인만** 바뀌고 나머지 라인은
     바이트 동일임을 단언. 기존 `apply-source-activation.test.js` 에 케이스 추가.

4. **한국체육대 `knsu-press-release` 실제 삽입 (유지).**
   - 정규화 후 B1 재실행 → `enabled:false / verified:false / status:"selector_required" /
     healthStatus:"unknown"` 로 카탈로그에 삽입, 이번엔 유지(커밋).
   - `catalog-prepare-log.json` 과 `*.prepare-backup.*` 는 `.gitignore` 에 추가(커밋 제외).

## 제약

- writer 로직(`JSON.stringify(x, null, 2) + "\n"`) 불변. `prepare-catalog-source-block.js`,
  `apply-source-activation.js`, `store.js`, `targets.js` 의 제품 코드는 수정하지 않는다.
- 정규화 커밋은 순수 whitespace/EOL. 어떤 필드 값·키 순서·배열 순서도 안 바뀜을 diff 로 재확인.
- git push / 배포 / 스케줄러 미실행. `main` 직접 커밋 금지. 현재 브랜치
  `feat/onboarding-gate-bridges` 위에 쌓는다.
- 정규화 전후 `npm test` 전체 통과 유지.
- 신규 npm 의존성 없음. 테스트는 `node --test` 자동 탐색(`npm test`).

# 파일

## 조사로 확인된 현재 상태 (읽기 전용)

| 항목 | 확인 결과 |
|---|---|
| 카탈로그 파일 | `development/university-news/data/university-news-sources.final.json`, 약 **7,690줄**, 2-space pretty-print. **손으로 압축한 인라인 구조 12곳**(줄 407·413·689·736·1969·1970·2023·2066·2071·2214·2265·2338 — `"officialNames": [...]`, `"fixedParams": {...}`, `"titleCleanupTokens": [...]`). 전부 파일 상단부(407~2338)에 몰려 있음. |
| 정규화 diff 예상 | 인라인 구조 12곳이 여러 줄로 펼쳐짐 → 대략 `-12줄 / +40~55줄`. (EOL 이 CRLF 면 전 줄이 추가 변경 — 사전 측정 필수.) 값 변경 0. |
| B1 writer | `prepareCatalogSourceBlock()` → `serialized = \`${JSON.stringify(nextCatalog, null, 2)}\n\``, tmp 쓰기 → `JSON.parse` 검증 → `renameSync`. `fs.writeFileSync(tmp, serialized, "utf8")` (CRLF 변환 없음 = LF). |
| 게이트 writer | `apply-source-activation.js` `writeJsonAtomic()` → `const content = \`${JSON.stringify(data, null, 2)}\n\``, tmp → `JSON.parse` 검증 → rename. `writeJsonOnce()` 도 동일. 전부 LF. |
| store/preview writer | `server/agent/store.js` `writeAtomic()` → `JSON.stringify(data, null, 2) + "\n"`, `fs.writeFileSync(tmp, content, "utf8")` → rename. LF. `review-packet.js` / `review-decision-writer.js` 도 `... + "\n"` LF. → **알려진 JSON writer 는 전부 LF.** (전역 `*.json` 규칙은 기술적으로 정합하나, 손편집 JSON 의 커밋 EOL 미감사 상태이므로 기본 스코프만 적용.) |
| 한국체육대 후보 | `server/agent/onboarding/data/collector-config-candidates.json` — `universityId: "korea-national-sport-university-본교"`(한글 `본교` 포함), `source.id: "knsu-press-release"`, `finalDecision: "COLLECTOR_CONFIG_READY"`. |
| 한국체육대 대학 블록 | 카탈로그 **줄 6869 에 존재**(`universityId: "korea-national-sport-university-본교"`, `sources: []`). → B1 이 throw 하지 않음. 완료 기준 4 달성 가능. (직전 조사의 "대학 블록 없음"은 오류로 확인됨.) |
| `getTargetUniversities()` | `targets.js` `isSourceCollectible()` → `if (!src.verified || src.enabled !== true) return false`. 비활성 소스는 대상에서 제외됨. `targets.test.js` 는 정확한 개수를 단언하지 않음(`length > 0` + 각 소스 verified&enabled 만). |
| CLI 한글 인자 | `parseCliArgs` 는 `hit.slice(indexOf("=")+1).trim()` — argv 값 그대로 사용. PowerShell argv 한글 인코딩이 불안정하므로 실제 삽입은 **CLI 대신 node 스크립트**로 `universityId` 를 후보 파일에서 읽어 호출 권장. |
| `.gitattributes` | 저장소에 **없음**. |
| `.gitignore` | `catalog-prepare-log.json`, `*.prepare-backup.*`, `apply-batch-reports/` **미등록**. `development/university-news/data/source-config-backups/` 는 등록됨. |
| stash | `stash@{0}` "pre-existing uncommitted CAU rss source edit" (On main) 존재. CAU(중앙대 서울) 블록은 카탈로그 **줄 344~370**, 첫 인라인 구조(줄 407)보다 앞. 정규화는 이 영역을 건드리지 않음. planner 는 `git`/`node` 실행 불가로 stash 내용 직접 확인 못 함 — 사전 측정 항목. |
| 브랜치 | `.git/HEAD` = `refs/heads/feat/onboarding-gate-bridges`. B1/게이트 4개 파일 모두 현재 브랜치에 존재(확인). |

## 생성

| 절대경로 | 역할 |
|---|---|
| `D:\hhg(code)\.gitattributes` | 카탈로그 + `server/agent/gate/data/**` 를 `text eol=lf` 로 고정. |

## 수정

| 절대경로 | 변경 내용 |
|---|---|
| `D:\hhg(code)\development\university-news\data\university-news-sources.final.json` | (커밋 A) 정규화 1회 덮어쓰기. (커밋 C) B1 이 `knsu-press-release` 소스 블록 1개 append. |
| `D:\hhg(code)\.gitignore` | `development/university-news/data/*.prepare-backup.*` + `server/agent/onboarding/data/catalog-prepare-log.json` 2줄 추가. |
| `D:\hhg(code)\server\agent\onboarding\tools\prepare-catalog-source-block.test.js` | B1 최소 diff 회귀 테스트 1개 + `assertSingleContiguousInsertion` 헬퍼 추가. |
| `D:\hhg(code)\server\agent\gate\apply-source-activation.test.js` | 게이트 최소 diff 회귀 테스트 1개 + `assertOnlyLinesChanged` 헬퍼 추가. |

## 수정하지 않음 (Option A)

- `server\agent\onboarding\tools\prepare-catalog-source-block.js`
- `server\agent\gate\apply-source-activation.js`
- `server\agent\store.js`, `server\agent\targets.js`
- stash@{0} (CAU rss) — 이 작업 범위 밖. 아래 질문사항 1 참조.

# 구현 계획

## 0. 사전 측정 (Coder 가 실행, 전부 `.pipeline/changes.md` 에 기록)

planner 는 이 세션에서 Bash/PowerShell 실행이 막혀 아래를 직접 측정하지 못했다. Coder 필수:

1. `git rev-parse --abbrev-ref HEAD` → `feat/onboarding-gate-bridges` 여야 함. 아니면 중단.
2. `git status --porcelain` → 카탈로그 파일이 **깨끗**(미변경)해야 정규화 시작 가능.
3. `git stash list` / `git stash show -p stash@{0} --stat` → 어떤 파일·라인이 들어있는지 기록.
   **pop 하지 않는다.** (질문사항 1)
4. 카탈로그 측정:
   ```
   node -e "const fs=require('fs');const p='development/university-news/data/university-news-sources.final.json';const raw=fs.readFileSync(p,'utf8');const out=JSON.stringify(JSON.parse(raw),null,2)+String.fromCharCode(10);console.log('bytes',Buffer.byteLength(raw),'crlf',(raw.match(/\r\n/g)||[]).length,'lines',raw.split(/\r?\n/).length,'endsNL',raw.endsWith('\n'),'alreadyNormalized',out===raw,'semanticEqual',JSON.stringify(JSON.parse(raw))===JSON.stringify(JSON.parse(out)))"
   ```
   `alreadyNormalized === true` 면 커밋 A 는 no-op → Coder 는 그 사실을 보고하고 커밋 A 생략,
   B/C 만 진행(인라인 구조 12곳이 있으므로 실제로는 false 예상).
5. `git ls-files --eol "*.json"` → CRLF(`w/crlf` 또는 `i/crlf`)로 커밋된 tracked JSON 이 있는지.
   - **하나도 없으면**: 전역 `*.json text eol=lf` 추가가 안전·권장(질문사항 2, 기본은 스코프).
   - **하나라도 있으면**: 스코프 규칙만.
6. `node --test`(= `npm test`) 정규화 **전** 전체 통과 확인 + 요약 기록(기준선).

## 1. 커밋 A — 카탈로그 정규화 (카탈로그 파일만)

1. `const raw = fs.readFileSync(P, "utf8"); const out = JSON.stringify(JSON.parse(raw), null, 2) + "\n";`
2. 단언(실패 시 즉시 중단, 커밋 금지, 실패한 키/원인 보고):
   - `JSON.stringify(JSON.parse(raw)) === JSON.stringify(JSON.parse(out))`
   - `JSON.parse(raw).universities.length === JSON.parse(out).universities.length`
   - 소스 수: `const cnt = c => c.universities.reduce((a,u)=>a+(u.sources||[]).length,0);` before == after
   - `getTargetUniversities()` length 기록(정규화 전 파일 상태 기준).
3. `fs.writeFileSync(P, out, "utf8")`.
4. 사후 검증:
   - `node -e "JSON.parse(require('fs').readFileSync(P,'utf8'));console.log('JSON OK')"`
   - `git diff --stat` → 이 파일 1개만.
   - `git diff -w` → **출력 없음**(공백 외 변경 0). 비어있지 않으면 **중단**(값이 바뀐 것).
   - `git diff` 육안 확인: 인라인 구조 12곳 reflow + (필요 시)말미 개행 추가 외에 토큰 변경 없음.
   - `npm test` 전체 통과(요약 기록). `getTargetUniversities().length` 가 2번과 동일.
5. 커밋:
   ```
   git add development/university-news/data/university-news-sources.final.json
   git commit -m "chore(catalog): normalize university-news-sources.final.json to writer format" \
     -m "Whitespace/EOL only: JSON.stringify(JSON.parse(raw), null, 2) + \"\n\" (LF). Verified semantically identical via deep re-serialize; university/source counts and getTargetUniversities() unchanged; git diff -w empty. Aligns the file with the B1 and gate LF writers so single-source inserts produce minimal diffs (AGENTS.md 4.4)."
   ```

## 2. 커밋 B — .gitattributes + .gitignore + 회귀 테스트 2종

### 2a. `.gitattributes` (신규)

```
# The news source catalog and gate data files are written by JS writers that
# always emit LF (JSON.stringify(data, null, 2) + "\n"). Pin them to LF so a
# Windows checkout never reintroduces CRLF and turns a 1-source insert into a
# whole-file diff. See AGENTS.md section 4.4.
development/university-news/data/university-news-sources.final.json text eol=lf
server/agent/gate/data/** text eol=lf
```
(사전 측정 5 에서 CRLF tracked JSON 이 0 이고 사용자가 승인하면 맨 위에
`*.json text eol=lf` 한 줄을 추가 가능 — 질문사항 2.)

### 2b. `.gitignore` (2줄 추가, 파일 끝)

```
development/university-news/data/*.prepare-backup.*
server/agent/onboarding/data/catalog-prepare-log.json
```

### 2c. B1 회귀 테스트 — `prepare-catalog-source-block.test.js` 에 추가

- 새 헬퍼(파일 상단):
  ```js
  // before/after 텍스트가 "정확히 연속된 1개 라인 블록만 삽입"됐는지 단언한다.
  // git 을 호출하지 않고 순수 라인 비교로 판정한다.
  function assertSingleContiguousInsertion(beforeText, afterText, { mustInclude = [], mustNotInclude = [] } = {}) {
    const b = beforeText.split("\n");
    const a = afterText.split("\n");
    let p = 0;
    while (p < b.length && p < a.length && b[p] === a[p]) p += 1;
    let s = 0;
    while (s < b.length - p && s < a.length - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s += 1;
    assert.equal(p + s, b.length, "before 쪽에서 삭제/치환된 라인이 있음 (연속 삽입이 아님)");
    const inserted = a.slice(p, a.length - s).join("\n");
    for (const needle of mustInclude) assert.ok(inserted.includes(needle), `삽입 블록에 ${needle} 없음`);
    for (const needle of mustNotInclude) assert.ok(!inserted.includes(needle), `삽입 블록에 ${needle} 가 있으면 안 됨`);
    return inserted;
  }
  ```
- 새 테스트:
  ```
  test("B1 on the normalized real catalog inserts knsu-press-release as one contiguous block (0 deletions, no other lines touched)", () => {
    const realCatalog   = path.resolve(__dirname, "../../../../development/university-news/data/university-news-sources.final.json");
    const realCandidates = path.resolve(__dirname, "../data/collector-config-candidates.json");

    const catalog = JSON.parse(fs.readFileSync(realCatalog, "utf8"));
    const uni = catalog.universities.find((u) => u.universityId === "korea-national-sport-university-본교");
    assert.ok(uni, "카탈로그에 한국체육대 대학 블록이 있어야 함");
    // 커밋 C(실제 삽입) 이후에도 테스트가 유효하도록, 있으면 제거하고 시작
    uni.sources = (uni.sources || []).filter((src) => src.id !== "knsu-press-release");

    const candItems = JSON.parse(fs.readFileSync(realCandidates, "utf8")).items || [];
    const cand = candItems.find((it) => it.source && it.source.id === "knsu-press-release");
    assert.ok(cand && cand.finalDecision === "COLLECTOR_CONFIG_READY", "knsu 후보가 READY 여야 함");

    const dir = makeTempDir("b1-knsu-");
    const catalogFile = path.join(dir, "catalog.json");
    const prepareLogFile = path.join(dir, "log.json");
    const beforeText = JSON.stringify(catalog, null, 2) + "\n";
    fs.writeFileSync(catalogFile, beforeText, "utf8");

    const result = prepareCatalogSourceBlock({
      universityId: cand.universityId,      // exact string, 하드코딩 아님
      sourceId: "knsu-press-release",
      candidateFile: realCandidates,
      catalogFile,
      prepareLogFile,
      now: () => FIXED_NOW,
    });
    assert.equal(result.status, "PREPARED");

    const afterText = fs.readFileSync(catalogFile, "utf8");
    assertSingleContiguousInsertion(beforeText, afterText, {
      mustInclude: ['"id": "knsu-press-release"', '"status": "selector_required"', '"enabled": false', '"verified": false'],
      mustNotInclude: ['"universityId"'],   // 대학 블록을 새로 만들지 않았음을 증명
    });

    const after = JSON.parse(afterText);
    const knsu = after.universities.find((u) => u.universityId === cand.universityId).sources.filter((s) => s.id === "knsu-press-release");
    assert.equal(knsu.length, 1);
    assert.equal(knsu[0].enabled, false);
    assert.equal(knsu[0].verified, false);
    assert.equal(knsu[0].status, "selector_required");
  });
  ```

### 2d. 게이트 회귀 테스트 — `apply-source-activation.test.js` 에 추가

- 새 헬퍼:
  ```js
  // before/after 라인 수가 같고, 지정한 부분문자열을 포함한 라인들만 바뀌었는지 단언.
  function assertOnlyLinesChanged(beforeText, afterText, { changedLineSubstrings }) {
    const b = beforeText.split("\n");
    const a = afterText.split("\n");
    assert.equal(a.length, b.length, "라인 수가 달라짐 (구조가 재정렬됨)");
    const changed = [];
    for (let i = 0; i < b.length; i += 1) if (b[i] !== a[i]) changed.push(i);
    assert.equal(changed.length, changedLineSubstrings.length, `바뀐 라인 수 불일치: ${JSON.stringify(changed.map((i) => a[i]))}`);
    for (const i of changed) {
      assert.ok(
        changedLineSubstrings.some((sub) => a[i].includes(sub)),
        `예상치 못한 라인 변경: ${JSON.stringify(a[i])}`
      );
    }
  }
  ```
- 새 테스트:
  ```
  test("gate writeJsonAtomic + applyMinimalDiff on a writer-format catalog only rewrites the targeted field lines", () => {
    const dir = makeTempDir("gate-mindiff-");
    const catalogFile = path.join(dir, "catalog.json");
    const catalog = {
      universities: [
        { universityId: "test-university", universityGroupId: "g1", universityName: "테스트대학교",
          sources: [{ id: "test-official-news", enabled: false, verified: true, status: "selector_required", listUrl: "https://news.example.ac.kr/list" }] },
        { universityId: "unrelated-university", universityGroupId: "g2", universityName: "무관한대학교",
          sources: [{ id: "unrelated-source", enabled: true, verified: true, status: "verified" }] },
      ],
    };
    const beforeText = JSON.stringify(catalog, null, 2) + "\n";   // writer 형식(+ "\n")
    fs.writeFileSync(catalogFile, beforeText, "utf8");

    const scope = { universityId: "test-university", sourceId: "test-official-news" };
    const proposedChange = { enabled: { from: false, to: true }, verified: { from: true, to: true }, status: { from: "selector_required", to: "verified" } };

    const parsed = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    applyMinimalDiff(parsed, scope, proposedChange);
    writeJsonAtomic(catalogFile, parsed);

    const afterText = fs.readFileSync(catalogFile, "utf8");
    // verified 는 from===to 라 안 바뀜 → enabled/status 2줄만 변경
    assertOnlyLinesChanged(beforeText, afterText, { changedLineSubstrings: ['"enabled"', '"status"'] });
    assert.ok(afterText.includes('"unrelated-source"'));
    const after = JSON.parse(afterText);
    assert.equal(after.universities[1].sources[0].enabled, true);   // 무관한 소스 불변
  });
  ```
- 검증: `node --check` 2개 테스트 파일, `npm test` 전체.
- 커밋:
  ```
  git add .gitattributes .gitignore server/agent/onboarding/tools/prepare-catalog-source-block.test.js server/agent/gate/apply-source-activation.test.js
  git commit -m "test(catalog): lock in minimal-diff of B1 + gate writers on normalized catalog; add scoped .gitattributes"
  ```

## 3. 커밋 C — 한국체육대 knsu-press-release 실제 삽입 (카탈로그 파일만)

1. Coder 가 스크래치패드에 임시 러너(커밋 안 함) 작성:
   ```js
   // 이유: universityId 에 한글("본교")이 있어 PowerShell argv 인코딩이 불안정.
   const fs = require("fs");
   const { prepareCatalogSourceBlock, DEFAULT_CANDIDATE_FILE } = require("D:/hhg(code)/server/agent/onboarding/tools/prepare-catalog-source-block");
   const cand = (JSON.parse(fs.readFileSync(DEFAULT_CANDIDATE_FILE, "utf8")).items || [])
     .find((it) => it.source && it.source.id === "knsu-press-release");
   console.log(prepareCatalogSourceBlock({ universityId: cand.universityId, sourceId: "knsu-press-release" }));
   ```
2. 실행 후 검증:
   - `git status --porcelain` → 카탈로그만 수정으로 보이고 `catalog-prepare-log.json` /
     `*.prepare-backup.*` 는 **나타나지 않음**(gitignore 확인).
   - `git diff development/university-news/data/university-news-sources.final.json`
     → knsu 블록 안에 **연속 삽입 ~14~16줄, 삭제 0줄**, 다른 대학/소스 라인 변경 0.
   - `node -e "JSON.parse(...)"` OK.
   - 삽입 블록에 `"enabled": false`, `"verified": false`, `"status": "selector_required"`,
     `"healthStatus": "unknown"` 존재(= `normalizeCandidateSourceBlock` 출력).
   - `node -e "console.log(require('D:/hhg(code)/server/agent/targets').getTargetUniversities().length)"`
     → 정규화 후 값과 동일(기록. 예상 43).
   - `npm test` 전체 통과(2c 테스트는 knsu 를 먼저 제거하므로 계속 green).
3. 백업/로그 파일은 gitignore 대상이라 그대로 두거나 삭제(무해). 임시 러너는 삭제.
4. 커밋:
   ```
   git add development/university-news/data/university-news-sources.final.json
   git commit -m "feat(catalog): register knsu-press-release for 한국체육대 as disabled (selector_required)"
   ```

## 4. 마무리

- `.pipeline/changes.md` 에 변경 파일 절대경로·이유, 사전 측정 수치, 3개 커밋 해시,
  `git diff -w`(비어있음) 증거, `git diff --stat`(커밋 A/C), `npm test` 요약(정규화 전/후),
  `getTargetUniversities().length`(전/후), 임시 러너 출력 로그를 기록.
- `git push` / 배포 / 스케줄러 미실행.

# 예외 상황

| 상황 | 처리 |
|---|---|
| 사전 측정 4 에서 `alreadyNormalized === true` | 커밋 A 생략(보고), B/C 만 진행. |
| 의미 무손실 단언 실패 (`JSON.stringify` 재직렬화 불일치) | **중단**. 어떤 값이 달라졌는지(숫자 포맷 등) 보고. 커밋 금지. |
| `git diff -w` 가 비어있지 않음 | 공백 외 변경 발생 → **중단**, 원인 규명 후 보고. |
| 한국체육대 대학 블록이 카탈로그에 없음 | B1 `insertSourceBlock` 이 `university block not found` throw. 커밋 C 불가 → **중단하고 사용자에게 질문**. (현재 줄 6869 에 존재 확인됨 — 방어용.) |
| `knsu-press-release` 가 이미 카탈로그에 있음 (병합 등으로) | B1 `already exists` throw. 커밋 C 는 no-op. 기존 블록이 `enabled:false/verified:false/status:"selector_required"` 면 그대로 두고 커밋 C 생략(보고). 다른 값(특히 `enabled:true`)이면 **중단하고 질문**(질문사항 5). |
| 후보 `finalDecision !== "COLLECTOR_CONFIG_READY"` | B1 throw → 중단, 보고. (현재 READY 확인됨.) |
| PowerShell 로 CLI 직접 실행 시 한글 universityId 깨짐 | CLI 대신 3.1 의 node 러너 사용(universityId 를 JSON 에서 읽음). |
| 정규화 후 `npm test` 실패 | 어떤 테스트가 카탈로그의 줄 수/바이트/특정 라인 위치를 가정하는지 조사. 형식 가정이면 보고(테스트를 임의 수정하지 말 것). 실제 회귀면 정규화 자체 재검토. (`targets.test.js` 는 개수 미단언 — 안전 확인됨.) |
| 사전 측정 5 에서 CRLF tracked JSON 발견 | `.gitattributes` 전역 `*.json` 규칙 **미적용**, 스코프 규칙만. |
| stash@{0} 를 나중에 `git stash pop` 시 카탈로그 충돌 | 이 작업 범위 밖. CAU 블록(줄 344~370)은 정규화가 안 건드리는 영역이라 충돌 가능성 낮음. 충돌 시 해소법: 스태시의 필드 값을 채택 → 정규화 직렬화(`JSON.stringify(JSON.parse(x),null,2)+"\n"`) 1회 재적용. (질문사항 1) |
| 커밋 C 의 삽입 diff 에 삭제 줄(>0)이나 다른 대학/소스 라인 변경이 보임 | 정규화가 불완전했다는 신호 → **중단**, 커밋 A 재검토. |
| gate 회귀 테스트에서 라인 수가 변함 | writer/`applyMinimalDiff` 가 구조를 재배열한 것 → 조사 후 보고(제품 코드는 안 고침이 원칙이므로 사용자 확인). |

# 완료 기준

1. **정규화 커밋(A)** 이 카탈로그 파일 1개만 포함하고, 커밋 diff 가 `git diff -w` 기준
   공백 외 변경 0. 커밋 후 `node -e "JSON.parse(fs.readFileSync(...))"` → `JSON OK`.
   `JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))` 단언 통과 로그 존재.
   대학 수·소스 수 before==after 로그 존재.
2. **B1 회귀 테스트** 통과: 정규화된 실제 카탈로그 사본 + 실제 후보로
   `prepareCatalogSourceBlock` 실행 시 `assertSingleContiguousInsertion` 이
   삭제 0줄 / 다른 대학·소스 라인 변경 0줄 / 삽입 블록에 `knsu-press-release` +
   `selector_required` + `enabled:false` 포함을 자동 단언.
3. **게이트 회귀 테스트** 통과: writer 형식 카탈로그에 `applyMinimalDiff` + `writeJsonAtomic`
   적용 시 `assertOnlyLinesChanged` 가 대상 소스의 `enabled`/`status` 라인 2개만 변경되고
   라인 수 불변 + 무관한 소스 불변을 자동 단언.
4. **한국체육대 소스 존재**: `knsu-press-release` 가 카탈로그의
   `korea-national-sport-university-본교` 블록에 `enabled:false / verified:false /
   status:"selector_required" / healthStatus:"unknown"` 로 존재하고 커밋됨.
   `getTargetUniversities().length` 가 정규화 직후 값과 동일(비활성이므로 불변; 기록치 예상 43).
5. **`.gitattributes`** 가 카탈로그 파일 + `server/agent/gate/data/**` 를 `text eol=lf` 로 지정.
   `.gitignore` 에 `*.prepare-backup.*` + `catalog-prepare-log.json` 추가되어
   `git status` 에 해당 산출물이 나타나지 않음.
6. **`npm test` 전체 통과** — 정규화 전/후 모두. 커밋 3개(A: 정규화 / B: 테스트+attributes /
   C: 삽입) 가 `feat/onboarding-gate-bridges` 위에 순서대로 존재. `main` 커밋·`git push`·배포 없음.
7. `node --check` 가 수정한 테스트 파일 2개에서 통과. 제품 코드(`prepare-catalog-source-block.js`,
   `apply-source-activation.js`, `store.js`, `targets.js`) diff 0.
8. `.pipeline/changes.md` 에 사전 측정 수치·커밋 해시·검증 로그 기록.

# 질문사항

1. **stash@{0} (CAU rss) 처리** — 기본안: 이 작업에서 **건드리지 않는다**(별개 관심사, "On main"
   으로 스태시됨). 정규화는 CAU 영역(줄 344~370)을 안 건드리므로 나중에 pop 해도 충돌 위험 낮음.
   → 만약 "CAU 편집을 먼저 pop·커밋해서 정규화가 그 내용까지 포함하게 하라"를 원하면 알려주세요
   (그 경우 커밋 순서: CAU 커밋 → 정규화 A → B → C). **미회신 시 stash 미접촉으로 진행.**

2. **`.gitattributes` 스코프** — 기본안: 카탈로그 파일 + `server/agent/gate/data/**` 만
   `text eol=lf`. 사전 측정 5(`git ls-files --eol "*.json"`)에서 CRLF 로 커밋된 tracked JSON 이
   **0** 이면 전역 `*.json text eol=lf` 도 안전·권장. 전역 규칙을 넣을까요?
   **미회신 시 스코프 규칙만.**

3. **커밋 분리** — 기본안: 3개(A 정규화 / B 테스트+gitattributes+gitignore / C 실제 삽입).
   요청문은 "정규화 1개 / 나머지 별도"로 2그룹을 언급 — B 와 C 를 한 커밋으로 합쳐도 되나요?
   **미회신 시 3개 커밋으로 진행(A 는 반드시 독립).**

4. **`apply-batch-reports/` gitignore** — 조사 목록에 언급됐으나 요청문 "만들 것"에는 없음
   (`server/agent/gate/data/apply-batch-reports/<runId>.json` 은 게이트 배치 산출물).
   이번에 함께 `.gitignore` 에 추가할까요? **미회신 시 추가하지 않음(범위 밖).**

5. **`knsu-press-release` 가 이미 카탈로그에 존재할 경우** — 병합 등으로 이미 있고 값이
   `enabled:false/verified:false/status:"selector_required"` 면 그대로 두고 커밋 C 생략.
   값이 다르면(특히 `enabled:true`) 어떻게 할까요? **미회신 시 중단하고 재질의.**
