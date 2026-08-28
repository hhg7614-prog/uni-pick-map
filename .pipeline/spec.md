# 목표

D:\hhg(code) 대학 뉴스 온보딩 흐름을 다음 구조로 재설계한다(이번 세션은 **설계만** 수행, 코드/JSON/store/preview/테스트/git 파일은 단 하나도 만들거나 수정하지 않았다 — 쓰기는 이 `.pipeline/spec.md` 하나뿐):

```
사용자
  -> Brain(로컬 AI, 별도 세션, 총괄 판단 + 최종 읽기전용 검토)
  -> Code Agent(현재 이 세션 — 조사/구현/테스트 실행, Planner 모드)
  -> Brain 최종 읽기전용 검토 (APPROVE / HOLD / REJECT)
  -> 사용자 명시 승인 (`--apply` 실행)
  -> 실제 활성화(`enabled=true`) + 최초 저장(store/preview)
```

Code Agent(현재 세션)는 스스로 APPROVE 판정을 만들거나 `--apply`를 실행할 수 없어야 한다. 실제 활성화·저장은 Brain의 APPROVE + reviewId + 패킷 SHA-256 + 현재 JSON/store/preview 체크섬이 모두 일치할 때만 가능하다.

**이번 갱신(2차 라운드)에서 반영된 사용자(Brain) 확정 결정 4가지**(각 질문사항 1~4에 대한 답, 아래 관련 섹션에 전부 반영됨):

1. 권한 경계: 현재는 "같은 로컬 환경, 역할만 분리"로 간주하고 설계한다. `review-decisions/<reviewId>.json`은 Code Agent 세션이 쓰기 권한을 갖지 않는 **서명 키**로 서명되어야 하며, `--apply`는 서명 검증 실패 시 무조건 거부한다(설계안 7번, 신규 서명 설계).
2. 위반 판정 주체: Code Agent(패킷 빌더)는 `robotsPolicyViolation`/`jsRuleUnverified`/`diagnoseFailed`를 스스로 계산하지 않는다. 패킷에는 원본 근거만 담고, 위반 여부의 최종 판정은 전부 Brain이 `ReviewDecision.checkedItems`에 직접 기록한다.
3. 기존 `activate-*.js` 스크립트: 게이트 도입과 **동시에** 폐기/차단한다(실제 폐기 코드 작성은 이번 라운드 범위 밖 — 다음 Coder 단계 구현 대상에만 명시).
4. git 정책: `server/agent/gate/data/`(패킷/판정 파일)는 git 커밋 대상으로 남겨 감사기록을 보존한다(`.gitignore` 미적용). 단, 실제 `git add`/`commit` 실행은 매 라운드 사용자의 별도 승인 후에만 수행한다.

(질문사항 5 — `agent-brain.js`와의 네임스페이스 분리는 이전 라운드에서 이미 `server/agent/gate/` 제안으로 답변된 것으로 간주하고 유지한다.)

# Research 조사 결과

## 1. `server/agent/tools/run-single-school-trial.js` — 현재 `--diagnose`/저장/백업 흐름

- `parseOptions()`(19~27번째 줄): `--university-id`, `--source-id`(선택), `--limit`(1~3, `MAX_ITEMS=3`), `--diagnose` 플래그 파싱.
- `selectSource()`(35~52번째 줄): `sourceType === "official" && entry.verified === true && ["rss","html"].includes(entry.collectionType)`인 소스만 후보로 인정. `verified !== true`인 소스는 `--source-id`를 지정해도 **여기서 즉시 예외**가 발생한다(이전 라운드 `.pipeline/changes.md`에서 `khu-official-news`가 `verified:false`라서 이 지점에서 조기 차단된 실제 선례가 있음 — 새 게이트 설계는 이 사실을 전제해야 함).
- `assertSourceEnabledForSave()`(160~172번째 줄): `diagnose===true`면 항상 통과(읽기 전용 trial은 `enabled` 무관하게 허용). `diagnose===false`(실제 저장)면 `source.enabled !== true`일 때 명시적 에러를 던지고 저장을 중단한다. 이것이 현재 유일한 "저장 전 활성화 게이트"이며, 새 승인 게이트는 이 지점을 대체하거나 그 앞단에 추가로 위치해야 한다.
- `backupBeforeSave()`(137~146번째 줄): `--diagnose`가 아닐 때만 호출됨. 타임스탬프 디렉터리(`server/agent/data/single-school-trial-backups/<stamp>/`)를 만들고 `agent-news-store.json`, `data/university-news-preview.json` 두 파일을 그대로 복사(파싱 검증 없이 `copyFileSync`만 수행 — 새 게이트는 복사 후 JSON 파싱 검증을 추가로 요구해야 함).
- `main()`(174~235번째 줄): `assertSourceEnabledForSave` 통과 후 실제 수집(`rssCollector`/`htmlListCollector`) → 항목별 상세 페이지 재검증(호스트/로그인·에러 페이지/제목·대학명 일치/`publishedAt` 존재) → `filterNewItems`로 중복 제거 → `--diagnose`면 `saveNewItems` 호출 없이 dry-run 결과만 출력, 아니면 `saveNewItems(newItems)` 호출.
- 이 파일은 카탈로그 JSON(`university-news-sources.final.json`)을 **읽기만** 하고 쓰지 않는다 — `enabled` 전환은 이 파일이 아니라 별도의 `activate-*.js`/`onboarding/tools/*.js` 도구들이 담당한다(아래 4번 참고).

## 2. `server/agent/store.js` — store/preview 저장 방식

- `STORE_PATH = server/agent/data/agent-news-store.json`, `PREVIEW_PATH = data/university-news-preview.json`(15~19번째 줄).
- `writeAtomic()`(106~113번째 줄): `<path>.tmp`에 먼저 쓰고 `JSON.parse`로 검증한 뒤 `renameSync`. 두 파일(store, preview) 각각 독립적으로 원자적이지만, **두 파일 사이의 원자성은 보장되지 않는다**(store를 쓰고 preview를 쓰는 사이 프로세스가 죽으면 store만 갱신된 상태가 될 수 있음 — 새 게이트의 실패 복구 설계에서 반드시 고려).
- `saveNewItems()`(140~173번째 줄): 신규 항목을 앞에 붙이고 `MAX_STORE_ITEMS=1000`으로 트림 → store 저장 → `createPreview()`로 preview 재생성 후 저장. 체크섬 관련 로직은 전혀 없음(새 기능).
- `getAllItems()`, `rebuildPreviewFromStore()`도 존재. `module.exports`에 `STORE_PATH`, `PREVIEW_PATH` 상수가 이미 export되어 있어 체크섬 계산 시 재사용 가능.

## 3. `server/agent/tools/screen-selector-required-sources.js` — read-only 설계 선례

- 기본 실행은 콘솔 출력만 하는 완전 읽기 전용 도구(1~12번째 줄 주석에 명시). 유일한 부수효과는 `--write-report=<path>`이며, `assertNotProtectedWritePath()`(55~62번째 줄)가 `PROTECTED_WRITE_PATHS`(카탈로그 JSON/store/preview, 25~29번째 줄)에는 절대 쓸 수 없도록 가드한다.
- `runScreening()`의 반환값에 `mutation: { enabled:false, verified:false, status:false, store:false, preview:false, git:false, deploy:false }`(246번째 줄)를 명시적으로 포함시켜 "이 실행이 아무것도 바꾸지 않았음"을 결과 자체에 기록하는 패턴 — **새 검토 패킷 스키마에도 동일한 `mutation` 선언 필드를 넣을 좋은 선례**.
- `alreadyEnabledResult()`(146~158번째 줄): `source.enabled === true`인 소스는 네트워크 요청 자체를 하지 않고 즉시 `ALREADY_ENABLED`로 분류 — 이미 활성화된 소스를 재차 건드리지 않는 방어 패턴.
- `classifyRobotsFetchResult()`(99~123번째 줄): robots.txt를 못 가져오면(403/429/5xx/네트워크 오류/빈 본문) **"제한 없음"으로 단정하지 않고** `ROBOTS_UNAVAILABLE`로 분류해 `classifySource()`가 HOLD 처리하도록 만든다 — 사용자가 요청한 "robots 정책 위반... HOLD 처리" 요구사항과 정확히 같은 안전 원칙이 이미 이 도구에 구현돼 있으므로, 새 게이트는 이 결과를 검토 패킷에 그대로 인용할 수 있다.

## 4. `development/university-news/collectors/html-list-collector.js`의 `jsDetailLinkRule`

- `resolveJsDetailLink()`(126~144번째 줄): `rule.enabled !== true`면 즉시 `""` 반환(완전 opt-in), `eval`/`new Function`/`vm` 등 실행 코드 전혀 없이 정규식 매칭 + 화이트리스트 인자만으로 URL을 조립한다. 실패(패턴 불일치/안전검사 실패/호스트 불일치) 시 항목 하나만 조용히 제외되고 소스 전체가 실패하지 않는다(항목 단위 격리 — `htmlListCollector()` 178~184번째 줄).
- `interpolateTemplate()`(108~118번째 줄): 플레이스홀더가 하나라도 안 채워지면 전체 실패(null 반환) — "부분적으로 깨진 URL을 절대 조립하지 않는다"는 안전 원칙.
- 직전 라운드(`.pipeline/changes.md`/`review.md`/`test-results.md`)에서 이 엔진은 이미 **승인(APPROVE에 해당하는 "승인")까지 받았고 `khu-official-news` 소스에만 필드가 반영됨**(그러나 `verified`/`enabled`는 여전히 `false`) — 즉 "엔진 승인"과 "실제 활성화 승인"이 이미 이 프로젝트 관례상 **분리된 두 단계**로 처리된 선례가 있다. 새 게이트 설계도 이 분리(엔진/코드 변경 승인 vs 특정 소스 활성화 승인)를 유지해야 한다.
- 이 파일은 `enabled`/`verified`를 전혀 건드리지 않는다 — 순수 수집 로직.

## 5. `enabled` 필드가 실제로 바뀌는 지점 (git grep 기반)

- `enabled`를 **쓰는(true로 전환)** 코드는 전부 `server/agent/onboarding/tools/activate-*.js`류의 개별 스크립트에 있다(예: `activate-collector-ready.js:119`, `activate-kyungnam-general-feed.js:32`, `activate-dnue-general-feed.js:34`, `activate-youngsan-shared-feed.js:39`, `activate-mtu-general-feed.js:53`, `run-uni-pick-next-batch-auto-resolution.js:60`, `run-one-onboarding.js:81`). 공통 패턴: `catalog`를 읽고 → 백업 → `source`에 `{...source, verified:true, enabled:true, status:"verified", healthStatus:"healthy"}`를 병합해 `university.sources.push(...)` 또는 `Object.assign` → `write(CATALOG, catalog)` → `saveNewItems(newItems)`. **이 도구들 각각이 개별적으로 백업/쓰기/저장을 구현하고 있어 로직이 파편화돼 있다** — 새 게이트는 이 파편화된 활성화 로직들을 대체할 **단일 `--apply` 진입점**으로 수렴시켜야 한다(이번 갱신에서 사용자가 확정: 게이트 도입과 동시에 이 스크립트들을 폐기/차단한다 — 아래 "Report Agent 종합"/"다음 Coder 단계 구현 대상" 참고).
- `enabled`를 **읽기만(게이트 조건)** 하는 지점: `targets.js`의 `isSourceCollectible()`(`targets.test.js:13~15` 테스트로 `verified && enabled` 둘 다 필요함이 확인됨), `run-single-school-trial.js:166`(위 1번), 여러 `verify-*-activation-ready.js`/`prepare-uni-pick-next-university-batch.js`/`evaluate-uni-pick-next-batch-candidates.js`의 `source?.enabled === true` 사전조건 체크.
- `screen-selector-required-sources.js:162`(위 3번)는 `enabled===true`면 스크리닝 대상에서 제외.

## 6. 현재 테스트/검증 방식

- `package.json`(7번째 줄) `"test": "node --test"` — `node:test` 내장 러너, 파일별 `*.test.js` 자동 탐색.
- `server/agent/tools/run-single-school-trial.test.js`: `assertSourceEnabledForSave`, `selectSource`, `titleMatches`, `universityNameMatches` 등 순수 함수 단위 테스트(네트워크 없음). `require.main === module` 가드로 `require`만으로는 실행되지 않음(4~5번째 줄 주석).
- `server/agent/tools/screen-selector-required-sources.test.js`: `fetchImpl` 주입으로 네트워크 모킹, `mutation` 필드 불변 검증(158번째 줄), `ALREADY_ENABLED` 분기 검증(289번째 줄).
- 직전 라운드 사례(`.pipeline/test-results.md`)에서 `collectedAt` 미고정으로 인한 flaky 테스트가 실제로 발생했었다(간헐적 `AssertionError`) — 새 게이트의 단위 테스트 설계 시 시간/난수 관련 필드는 반드시 고정값을 주입해야 한다는 교훈을 그대로 반영해야 한다.

## 7. `.pipeline/` 기존 관례

- `spec.md`(Planner) → `changes.md`(Coder, "변경된 파일"/"변경 내용"/"변경 이유"/"미구현 항목"/"참고사항: node --check/npm test 실행 결과") → `test-results.md`(Tester, "완료 기준"/"실패한 테스트"/"재현 방법"/"위험 요소"/"최종 테스트 상태") → `review.md`(Reviewer, "검토 요약"/"요구사항 확인"/"테스트 결과"/"문제점"/"최종 판정"). `spec-*-update.md`처럼 이름을 붙인 하위 스펙 파일도 존재(세부 라운드용) — 이번 문서는 지시대로 `.pipeline/spec.md`(기본 파일명, 이전 라운드 내용을 덮어씀)에 저장한다.
- 직전 라운드 `review.md`는 "승인 범위를 명확히 좁혀 기록"하는 관례(예: "이번 승인 판정의 범위는 ... 엔진에 한정된다")를 보였다 — 새 게이트의 검토 패킷도 반드시 "이 판정이 정확히 어떤 소스/어떤 변경에 대한 것인지"를 명시적 범위로 못박아야 한다(범위 밖 항목까지 승인된 것으로 오인되는 사고를 방지).

## 8. 기타 참고 — 기존 "Brain" 코드와의 충돌 주의

- `server/agent/brain/agent-brain.js`(untracked, 새 파일)는 이번 요청과 **다른 개념**이다: 범용 목표 분해용 THINK_ONLY 에이전트(`server/agent/memory/*.json`에 상태/목표/결정을 저장, `execution.allowed: false` 고정, 55~65번째 줄 `main()`이 실제 파일쓰기/네트워크/git을 전혀 하지 않음)로, "소스 활성화 승인 판정"과는 무관하다. **이름 충돌 위험**: 사용자가 말하는 "Brain(로컬 AI, 별도 세션)"과 이 파일의 `"brain": "AGENT_BRAIN"` 식별자가 혼동될 수 있으므로, 새 승인 게이트 모듈은 이 파일과 다른 디렉터리/네임스페이스(`server/agent/gate/` 제안, 아래 설계안 참고)에 두고 문서에서 명확히 구분해야 한다(질문사항 5 — 결정됨).
- `server/agent/onboarding/tools/validate-source-quality.js`(29~61번째 줄)의 `QUALITY_APPROVED`/`QUALITY_REVIEW` 이분법과 `qualityScore` 가중치 방식은 "여러 신호를 종합해 하나의 verdict로 수렴시키는" 패턴의 선례로, Brain 판정 문서화 방식에 참고할 만하다(그대로 재사용하지는 않음 — 별도 목적).
- `crypto`의 `createHash("sha256")` 사용 선례가 이미 `server/agent/dedup.js:69~72`에 있음(`contentHash` 계산) — 새 체크섬 계산도 동일한 Node 내장 `crypto` 모듈을 그대로 사용하면 된다(신규 의존성 불필요). 서명(HMAC)도 같은 `crypto` 모듈의 `createHmac`으로 구현 가능하다(아래 설계안 7번 참고).

# 설계안 (Code Agent Planner 모드 산출물 — 의사코드/구조도/인터페이스 수준, 실제 코드 아님)

## 설계 원칙

1. Brain은 **읽기 전용**으로 검토하고, 유일한 부수효과는 "판정 파일 1개 작성"이다(그 파일 외 어떤 파일도 쓰지 않는다).
2. Code Agent(이번 세션)는 "검토 패킷 생성" 액션까지만 수행할 수 있고, "판정 파일 생성" 액션과 "`--apply` 실행" 액션은 **애초에 Code Agent의 허용 액션 목록(allowlist)에 포함시키지 않는다**(AGENTS.md §2 "Executors may call only an explicit allowlist of named actions" 원칙을 그대로 적용).
3. `--apply`는 기본이 read-only 검증 모드이고, `--apply` 플래그를 명시해야만 실제 쓰기가 일어난다(`screen-selector-required-sources.js`의 `--write-report=` 패턴과 동일한 "기본 무해, 명시적 플래그로만 부수효과" 관례를 따름).
4. 패킷 생성 이후 대상이 바뀌면 승인은 자동 무효화된다(별도 무효화 프로세스/데몬 없이, `--apply` 실행 시점에 항상 재계산·재비교하는 **stateless 검증**으로 구현 — 무효화를 별도로 "선언"할 필요 없이 항상 최신 상태와 대조).
5. **(결정됨, 질문사항 2)** Code Agent(패킷 빌더)는 위반 여부(robots 정책 위반/JS 규칙 미검증/진단 실패)를 스스로 판정하지 않는다 — 패킷에는 원본 근거(robots 응답, jsRule 검증 기록, diagnose raw 결과)만 담고, 위반 여부의 최종 판정은 전부 Brain이 `ReviewDecision.checkedItems`에 직접 기록한다.
6. **(결정됨, 질문사항 1)** `review-decisions/<reviewId>.json`은 Code Agent 세션이 쓰기 권한을 갖지 않는 서명 키로 서명되어야 하며, `--apply`는 서명 검증에 실패하면 무조건 거부한다. 상세 설계는 아래 7번 참고.

## 디렉터리/파일 구조 (신규 제안, 이번 세션에서 생성하지 않음)

```
server/agent/gate/                              (신규 디렉터리, agent-brain.js와 네임스페이스 분리)
  review-packet.js                              (패킷 빌더 + 체크섬 계산, Code Agent가 호출)
  review-packet.test.js
  signing-utils.js                              (신규 — HMAC-SHA256 서명/검증 함수, sign()은 서명 키 보유 컨텍스트에서만 호출 가능, verify()는 apply-source-activation.js가 사용. 7번 설계 참고)
  signing-utils.test.js
  apply-source-activation.js                    (--apply CLI, Brain APPROVE 이후 사용자가 직접 실행)
  apply-source-activation.test.js
  checksum-utils.js                              (sha256 계산 공용 함수, store.js/카탈로그/패킷에 공통 사용)
  data/                                          (패킷/판정 파일 — git 커밋 대상, 감사기록 보존. 결정됨, 질문사항 4. 실제 git add/commit은 매 라운드 사용자 승인 후에만 수행)
    review-packets/<reviewId>.json               (Code Agent가 생성, 이후 불변/append-only)
    review-decisions/<reviewId>.json             (Brain 전용 쓰기 — Code Agent 액션 목록에 없음, signature 필드로 서명됨)
    review-decisions/<reviewId>.applied.json      (--apply 성공 후 감사 기록, apply-source-activation.js가 생성)
    review-decisions/<reviewId>.invalidated.json  (선택, --apply가 무효화를 감지할 때마다 append, 감사용)
```

## 1) 검토 패킷(review packet) 스키마 및 저장 경로

저장 경로: `server/agent/gate/data/review-packets/<reviewId>.json` (신규, 위 구조 참고)

```
reviewId 형식 = `rp-${universityId}-${sourceId}-${yyyyMMddHHmmss}-${6자리랜덤hex}`
// 예: rp-jbnu-official-news-20260827143000-a1b2c3

ReviewPacket = {
  schemaVersion: "1.0",
  reviewId: string,
  createdAt: ISO8601,
  createdBy: "code-agent",             // 고정 문자열 — Brain/사용자가 아님을 명시
  scope: {                              // review.md 관례: 판정 범위를 명시적으로 못박음
    universityId, universityGroupId, sourceId,
    action: "ACTIVATE_AND_SAVE_INITIAL_ITEMS"
  },
  sourceSnapshot: <source 객체 전체 그대로, enabled/verified 등 현재 값 포함>,
  proposedChange: {                     // --apply가 실제로 쓸 diff (최소 diff 원칙)
    enabled: { from: false, to: true },
    verified: { from: <현재값>, to: true },   // 이미 true면 from===to
    status:   { from: <현재값>, to: "verified" }
  },
  diagnostics: {                        // run-single-school-trial.js --diagnose 결과 그대로 인용
    command: "node server/agent/tools/run-single-school-trial.js --university-id=... --source-id=... --diagnose --limit=3",
    rawOutput: <위 명령의 JSON stdout 그대로>,
    foundCount, acceptedCount, newCount, duplicateCount, excludedCount,
    acceptedNewItemsForSave: [...]      // --apply가 그대로 saveNewItems()에 넘길 정확한 항목들
  },
  robotsEvidence: <screen-selector-required-sources.js classifyRobotsFetchResult() 결과 그대로 인용, 또는 별도 robots.txt 재확인 결과 — 원본 근거만, 위반 여부 판정 없음>,
  jsRuleEvidence: source.jsDetailLinkRule?.enabled === true 인 경우만: {
    engineUnitTestsPassed: bool,        // html-list-collector.test.js 실행 결과
    manualGetVerification: [...]        // curl GET 동치성 검증 기록(선례: 직전 라운드 spec.md 방식) — 원본 근거만
  } | null,
  regressionEvidence: {
    npmTestCommand: "npm test",
    npmTestSummary: "tests N, pass N, fail 0",  // fail>0이면 패킷 자체를 만들지 않음(아래 예외 상황 참고)
    ranAt: ISO8601
  },
  checksums: {                           // --apply가 재계산해 대조할 기준값
    sourceCatalogFile: { path: "development/university-news/data/university-news-sources.final.json", sha256 },
    sourceBlockCanonical: { sha256 },    // sourceSnapshot을 canonical JSON(키 정렬)으로 직렬화한 값의 sha256
    storeFile: { path: STORE_PATH, sha256 },
    previewFile: { path: PREVIEW_PATH, sha256 }
  },
  mutation: { enabled:false, verified:false, status:false, store:false, preview:false, git:false, deploy:false }, // 패킷 생성 자체는 아무것도 안 바꿨다는 선언(screen-selector-required-sources.js 246번째 줄 관례 재사용)
  packetSha256: <아래 참고>
}

// packetSha256 계산 (의사코드)
function computePacketSha256(packet) {
  const { packetSha256, ...rest } = packet;   // 자기 자신 필드는 제외
  const canonical = canonicalStringify(rest); // 키를 재귀적으로 정렬한 JSON 문자열
  return sha256(canonical);
}
```

**(결정됨, 질문사항 2)** 위 스키마에는 `robotsPolicyViolation`/`jsRuleUnverified`/`diagnoseFailed` 같은 위반 여부 필드가 존재하지 않는다 — `robotsEvidence`/`jsRuleEvidence`/`diagnostics.rawOutput`은 전부 원본 근거이며, 위반 여부의 최종 판정은 오직 `ReviewDecision.checkedItems`에서 Brain이 수행한다. 패킷 빌더(Code Agent)는 이 판정을 계산하거나 미리 채워 넣지 않는다.

## 2) Brain의 APPROVE / HOLD / REJECT 판정 형식

저장 경로: `server/agent/gate/data/review-decisions/<reviewId>.json` (Brain 전용 쓰기, Code Agent 액션 목록에 없음)

```
ReviewDecision = {
  schemaVersion: "1.0",
  reviewId: string,                     // ReviewPacket.reviewId와 반드시 일치
  reviewedAt: ISO8601,
  reviewedBy: string,                   // "code-agent"/"planner"/"coder"/"tester"/"reviewer"와 달라야 함(문자열 블록리스트 검사, 아래 3번 참고)
  packetPathRead: string,               // Brain이 실제로 읽은 패킷 파일 경로(감사용)
  packetSha256Recomputed: string,       // Brain이 패킷 파일을 직접 읽어 독립적으로 재계산한 해시 — packet.packetSha256을 그대로 베끼지 않음
  verdict: "APPROVE" | "HOLD" | "REJECT",
  reasons: string[],                    // 최소 1개 필수
  checkedItems: {                       // Brain이 원본 근거(robotsEvidence/jsRuleEvidence/diagnostics.rawOutput)를 직접 검토해 채우는 필드 — 패킷 빌더가 미리 계산해 넣지 않음(결정됨, 질문사항 2)
    robotsPolicyViolation: bool,        // true면 verdict는 반드시 HOLD/REJECT
    jsRuleUnverified: bool,             // jsRuleEvidence 필요한데 없거나 불충분하면 true
    diagnoseFailed: bool                // diagnostics.excludedCount>0 등 실패 신호 존재 시 true
  },
  signature: {                          // 신규(결정됨, 질문사항 1) — Brain 전용 서명 키로 서명, 상세는 아래 7번 참고
    alg: "HMAC-SHA256",                 // 향후 비대칭키(Ed25519 등)로 확장 시 값만 교체, 스키마는 그대로
    keyId: string,                      // 서명에 사용된 키 식별자(키 로테이션 대비, 실제 키 값 아님)
    value: string                       // 서명 대상 필드를 canonical 직렬화한 문자열에 대한 서명값(hex)
  }
}
```

- 유효성 규칙(패킷 빌더/`--apply` 양쪽에서 공통 검증): `robotsPolicyViolation || jsRuleUnverified || diagnoseFailed`가 하나라도 `true`이면 `verdict === "APPROVE"`는 **구조적으로 불가능**(스키마 검증 단계에서 거부) — 사용자가 명시한 "robots 정책 위반, JS 규칙 미검증, 진단 실패는 HOLD 처리" 요구사항을 판정 파일 자체의 무결성 규칙으로 강제. 이 검증은 **Brain이 이미 작성한 `checkedItems`의 내부 일관성만 확인**하는 것이며, Code Agent가 위반 여부를 대신 판단하는 것이 아니다(결정됨, 질문사항 2).

## 3) reviewId / 패킷 SHA-256 / 체크섬 연결 방식

```
연결 체인(의사코드):

buildReviewPacket(target) -> packet
  packet.reviewId = generateReviewId(target)
  packet.checksums = computeAllChecksums()   // 카탈로그/소스블록/store/preview 현재 상태 스냅샷
  packet.packetSha256 = computePacketSha256(packet)
  writeJsonOnce(`review-packets/${packet.reviewId}.json`, packet)  // 이미 존재하면 에러(덮어쓰기 금지, append-only 원칙)
  return packet

// Brain 세션(별도 프로세스 또는 서명 키를 보유한 별도 실행 컨텍스트에서만 실행 가능)
brainReview(reviewId) -> decision
  packet = readJson(`review-packets/${reviewId}.json`)
  recomputed = computePacketSha256(packet)          // Brain이 독립적으로 재계산
  assert(recomputed === packet.packetSha256)        // 패킷 파일 자체가 손상/변조되지 않았는지 자체 검증
  verdict = <Brain의 판단>
  checkedItems = <Brain이 robotsEvidence/jsRuleEvidence/diagnostics.rawOutput을 직접 검토해 채움 — Code Agent가 계산하지 않음>
  decision = { reviewId, packetSha256Recomputed: recomputed, verdict, reasons, checkedItems, reviewedBy, reviewedAt, packetPathRead }
  signingKey = loadSigningKey()                     // BRAIN_REVIEW_SIGNING_KEY 등 Brain 전용 컨텍스트에서만 로드 가능(7번 참고)
  signedFields = canonicalStringify({ reviewId: decision.reviewId, packetSha256Recomputed: decision.packetSha256Recomputed, verdict: decision.verdict, reasons: decision.reasons, checkedItems: decision.checkedItems })
  decision.signature = { alg: "HMAC-SHA256", keyId: signingKeyId(signingKey), value: hmacSha256(signingKey, signedFields) }
  writeJsonOnce(`review-decisions/${reviewId}.json`, decision)  // 이미 존재하면 에러(재판정은 새 reviewId로)

// --apply 시점 (사용자가 직접 실행)
applySourceActivation(reviewId, { apply: bool })
  packet   = readJson(`review-packets/${reviewId}.json`)
  decision = readJson(`review-decisions/${reviewId}.json`)      // 없으면 즉시 실패: "NO_DECISION_YET"
  assert(decision.reviewId === packet.reviewId === reviewId)     // 3중 일치

  // 서명 검증(신규, 결정됨 — 질문사항 1, 상세는 7번 참고). 체크섬/verdict 검증보다 먼저 수행.
  signingKey = loadSigningKeyForApply()             // 사용자가 --apply 실행 시점에 자신의 실행 컨텍스트에서 로드
  if (!signingKey) throw GateApplyFailure({ code: "SIGNING_KEY_UNAVAILABLE", reviewId })
  if (!decision.signature) throw GateApplyFailure({ code: "SIGNATURE_MISSING", reviewId })
  signedFields = canonicalStringify({ reviewId: decision.reviewId, packetSha256Recomputed: decision.packetSha256Recomputed, verdict: decision.verdict, reasons: decision.reasons, checkedItems: decision.checkedItems })
  if (!verifyHmacSha256(signingKey, signedFields, decision.signature.value)) throw GateApplyFailure({ code: "SIGNATURE_INVALID", reviewId })

  assert(decision.packetSha256Recomputed === computePacketSha256(packet))  // 지금 다시 계산해도 같아야 함(패킷 파일이 그 사이 변조되지 않았는지)
  assert(decision.verdict === "APPROVE")                          // HOLD/REJECT면 즉시 중단
  assert(!blockedReviewerNames.includes(normalize(decision.reviewedBy)))
  currentChecksums = computeAllChecksums()                        // 지금 이 순간의 카탈로그/소스블록/store/preview
  assert(currentChecksums.sourceCatalogFile.sha256 === packet.checksums.sourceCatalogFile.sha256)
  assert(currentChecksums.sourceBlockCanonical.sha256 === packet.checksums.sourceBlockCanonical.sha256)
  assert(currentChecksums.storeFile.sha256 === packet.checksums.storeFile.sha256)
  assert(currentChecksums.previewFile.sha256 === packet.checksums.previewFile.sha256)
  // 위 4개 중 하나라도 다르면 -> "STALE_REVIEW_PACKET_INVALIDATED" 로 즉시 중단(자동 무효화, 아래 5번)
  if (!apply) return { status: "VALIDATED_READY_FOR_APPLY", reviewId }   // 기본 동작: 아무것도 쓰지 않음
  // apply === true 인 경우만 아래 실제 쓰기 진행 (6번 CLI 인터페이스 참고)
```

## 4) `--apply` CLI 인터페이스와 승인 검증 흐름

```
사용법:
  node server/agent/gate/apply-source-activation.js --review-id=<reviewId>            // 기본: 검증만, 쓰기 없음
  node server/agent/gate/apply-source-activation.js --review-id=<reviewId> --apply    // 검증 통과 시에만 실제 활성화+저장

parseArgs(argv):
  reviewId = required(--review-id=)
  apply    = argv.includes("--apply")
  return { reviewId, apply }

main():
  options = parseArgs(process.argv.slice(2))
  validation = runAllGuards(options.reviewId)   // 위 3번의 assert 체인 전체(서명 검증 포함)
  if (validation.failed) {
    console.error(JSON.stringify({ status: "REJECTED", reviewId, reasons: validation.reasons }))
    process.exitCode = 1
    return                                        // --apply 여부와 무관하게 여기서 끝, 아무 파일도 안 건드림
  }
  if (!options.apply) {
    console.log(JSON.stringify({ status: "VALIDATED_READY_FOR_APPLY", reviewId }))
    return                                        // 검증만 통과, 실제 쓰기는 --apply 없이는 절대 발생 안 함
  }
  performActivationAndSave(packet)                 // 5)/6) 참고
```

`runAllGuards`가 실패하는 세부 사유 코드는 기존 `NO_DECISION_YET`/`STALE_REVIEW_PACKET_INVALIDATED`/`HOLD`/`REJECT`/블록리스트 위반 외에, 서명 검증 실패를 나타내는 `SIGNATURE_MISSING`(서명 필드 자체가 없음) / `SIGNATURE_INVALID`(서명값이 재계산 결과와 불일치 — 판정 파일 내용이 서명 후 조금이라도 바뀐 경우 포함) / `SIGNING_KEY_UNAVAILABLE`(`--apply` 실행 컨텍스트가 서명 검증에 필요한 키를 로드하지 못함, 예: 환경변수 누락)를 포함한다. 세 코드 모두 `STALE_REVIEW_PACKET_INVALIDATED`와 동일하게 "즉시 중단, 아무 파일도 쓰지 않음" 원칙을 따른다.

## 5) 승인 후 설정/데이터 변경 시 자동 무효화

- 별도의 "무효화 상태 저장/전파" 메커니즘을 두지 않는다(상태 동기화 버그 위험을 줄이기 위해 **stateless 재검증**을 원칙으로 함).
- `--apply`(플래그 유무와 무관, 검증 단계 공통)는 실행될 때마다 항상 `packet.checksums`와 "지금 이 순간" 다시 계산한 체크섬을 비교한다. 하나라도 다르면:
  1. 그 어떤 쓰기도 하지 않고 즉시 중단(backup도 만들지 않음 — 아직 아무것도 건드리지 않았으므로 백업이 불필요).
  2. `STALE_REVIEW_PACKET_INVALIDATED` 상태와 함께 "무엇이 바뀌었는지"(어느 체크섬이 불일치했는지)를 명시해 보고.
  3. (감사 기록용, 선택) `review-decisions/<reviewId>.invalidated.json`에 무효화 감지 사실을 append(패킷/판정 파일 자체는 수정하지 않음 — 새 파일만 추가).
  4. 재검토가 필요하면 Code Agent가 **새 reviewId로 새 패킷**을 처음부터 다시 만들어야 한다(기존 패킷 재사용 금지 — 이미 한 번 무효화된 패킷은 영구히 무효).
- 서명 검증 실패(`SIGNATURE_MISSING`/`SIGNATURE_INVALID`/`SIGNING_KEY_UNAVAILABLE`)도 동일한 "즉시 중단, 쓰기 없음" 원칙을 따르되, 원인 코드는 체크섬 불일치(`STALE_REVIEW_PACKET_INVALIDATED`)와 구분해 감사 기록에 남긴다(체크섬 문제와 서명 문제는 원인이 다르므로 재검토 시 취해야 할 조치도 다를 수 있음 — 4번 CLI 설계 참고).

## 6) 실패 시 `enabled=false` 복구 · 저장 중단 · 백업 검증 흐름

```
performActivationAndSave(packet):
  // 사전 조건: 이 함수는 runAllGuards()가 전부 통과한 뒤에만 호출됨(서명 검증 포함)
  backupDir = backupBeforeSave()                     // run-single-school-trial.js의 기존 함수 재사용
  for (file of [backupDir/agent-news-store.json, backupDir/university-news-preview.json]) {
    assert(JSON.parse(readFile(file)))                // 복사만 하고 검증 안 하던 기존 backupBeforeSave()보다 강화 — 백업 파일이 실제로 유효한 JSON인지 확인
  }
  catalogBackupPath = copyFile(sourceCatalogFile, `${backupDir}/university-news-sources.final.json`)
  assert(JSON.parse(readFile(catalogBackupPath)))     // 카탈로그도 동일하게 백업 + 검증(기존 backupBeforeSave()는 카탈로그를 백업하지 않았음 — 새로 추가)

  try {
    catalog = readJson(sourceCatalogFile)
    applyMinimalDiff(catalog, packet.scope, packet.proposedChange)  // enabled/verified/status 3개 필드만 변경, 다른 필드/다른 대학/다른 소스는 절대 건드리지 않음
    writeJsonAtomic(sourceCatalogFile, catalog)         // tmp+rename+파싱검증, store.js writeAtomic()과 동일 패턴

    saveResult = saveNewItems(packet.diagnostics.acceptedNewItemsForSave)  // store.js 기존 함수 그대로 재사용
  } catch (error) {
    // 카탈로그 쓰기는 성공했는데 saveNewItems가 실패하는 경우(또는 그 반대)까지 커버
    restoreFromBackup(sourceCatalogFile, catalogBackupPath)
    restoreFromBackup(storeFile, `${backupDir}/agent-news-store.json`)
    restoreFromBackup(previewFile, `${backupDir}/university-news-preview.json`)
    verifyRestored = [sourceCatalogFile, storeFile, previewFile].every(f => isValidJson(readFile(f)))
    assert(verifyRestored)                              // 복구 자체가 실패하면 더 심각한 오류로 별도 보고(수동 개입 필요 상태로 명시 종료)
    // 복구 후에도 source.enabled는 원래 값(false)으로 되돌아가 있어야 함 — 재확인
    restoredCatalog = readJson(sourceCatalogFile)
    restoredSource = findSource(restoredCatalog, packet.scope)
    assert(restoredSource.enabled === packet.sourceSnapshot.enabled)  // 원상복구 확인
    throw new GateApplyFailure({ reviewId, backupDir, rollback: "success", originalError: error })
  }

  writeJsonOnce(`review-decisions/${reviewId}.applied.json`, {
    reviewId, appliedAt: now(), backupDir, saveResult, catalogChecksumAfter: computeChecksum(sourceCatalogFile)
  })
  return { status: "APPLIED", reviewId, backupDir, saveResult }
```

## 7) Code Agent가 스스로 APPROVE를 만들거나 `--apply`를 실행할 수 없도록 하는 권한 경계 (서명 기반 강화, 결정됨 — 질문사항 1)

전제(결정됨): 현재는 Brain 세션과 Code Agent 세션이 "같은 로컬 환경, 역할만 분리"된 상태로 간주하고 설계한다. 아래 서명 설계는 이 전제 하에서 우회 가능성을 **줄이는** 조치이지, 완전히 **없애는** 조치가 아니다(같은 로컬 환경이라는 전제가 유지되는 한 구조적 한계는 남는다 — 아래 7-6 "잔여 한계" 참고). 이 설계는 Brain이 나중에 실제로 별도 프로세스/기기로 분리되더라도 그대로 재사용 가능하도록 만든다.

### 7-1. 기존 이중 방어(유지)

1. **액션 화이트리스트 경계(AGENTS.md §2 원칙 적용)**: Code Agent(이번 세션 및 이후 Coder 세션)에게 실제로 노출되는 도구/스크립트 집합에는 애초에 "판정 파일 쓰기" 액션이 존재하지 않는다. `server/agent/gate/review-packet.js`는 패킷 생성만 export하고, 판정 파일을 쓰는 코드(`writeDecision` 류 함수)는 **별도 파일**(예: `server/agent/gate/review-decision-writer.js`)에 두되, 이 파일은 Code Agent용 실행 스크립트/`npm run` 항목에 절대 연결하지 않는다(Brain 세션이 자신의 로컬 도구에서만 호출).
2. **실행 계층 경계(정책/사용자 승인) — 서명으로 보강(7-2~7-5 참고)**: `--apply`는 사람이 터미널에서 직접 실행하는 것을 전제로 문서화한다. Claude Code 세션에서 Bash 도구로 임의 명령을 실행하려면 이미 기존 권한 시스템(사용자 승인)이 개입하므로, `--apply` 실행 자체도 그 승인 게이트를 통과해야 한다.
3. **신원 검사(약한 방어, 감사용)**: `decision.reviewedBy`가 `["code-agent","planner","coder","tester","reviewer"]` 블록리스트에 속하면 `--apply`가 즉시 거부한다. 이는 "실수로 같은 세션이 판정까지 흉내 낸" 경우를 잡는 최소 방어이며, **의도적 우회(Brain 흉내)까지 막지는 못한다**.
4. **역할 분리의 물리적 근거 — 서명으로 보강(7-2~7-5 참고)**: 판정 파일은 설계상 이 Code Agent 세션이 접근할 수 없는 별도 프로세스/세션에서 생성되는 것을 전제로 한다. 이 전제가 실제로 지켜지는지는 기술적으로 이 설계만으로 보장할 수 없다(아래 7-6 참고).

### 7-2. 키 관리 방식

- 서명 알고리즘: 기본은 HMAC-SHA256(대칭키, Node 내장 `crypto.createHmac`로 즉시 구현 가능 — `dedup.js`의 `createHash` 선례와 동일한 모듈 재사용). `signature.alg` 필드로 알고리즘을 명시해 두어, 나중에 비대칭키(예: Ed25519, `crypto.sign`/`crypto.verify`)로 교체해도 `ReviewDecision` 스키마 자체는 바뀌지 않도록 설계한다(`alg` 값과 `keyId`만 바뀜).
- 키 보관 위치(둘 중 하나, Coder 단계에서 실제 운영 환경에 맞춰 확정 — 질문사항 참고):
  (a) 환경변수 `BRAIN_REVIEW_SIGNING_KEY`를 Brain이 판정 파일을 쓸 때 실행하는 프로세스/스크립트에만 주입한다(예: Brain 전용 실행 스크립트가 이 환경변수를 읽고, Code Agent 세션이 실행하는 `npm test`/일반 Bash 세션에는 이 환경변수를 설정하지 않는다).
  (b) OS 파일 권한으로 분리된 디렉터리(예: `server/agent/gate/.secrets/signing-key`, `.gitignore` 처리하고 파일 권한을 Code Agent 세션의 프로세스 사용자가 읽을 수 없도록 제한)에 키를 저장하고, Brain 전용 스크립트만 이 경로를 읽는다.
- 어느 방식이든 **Code Agent 세션이 이 키(또는 키가 담긴 파일/환경변수)에 접근할 수 있는 경로가 하나라도 남아있으면 이 설계는 무력화된다** — 예를 들어 Code Agent 세션이 `.env`를 읽거나 환경변수를 덤프할 수 있는 Bash 권한을 그대로 갖고 있다면 (a) 방식은 방어력이 없다. 따라서 키 주입은 Brain 전용 실행 컨텍스트에서만 이뤄져야 하고, Code Agent 세션의 허용 도구 목록에서 해당 환경변수/파일 경로에 접근하는 명령이 배제되어야 한다(운영 정책 문제, 이 설계 문서만으로 강제할 수 없음 — 아래 7-6 참고).
- `--apply` 실행 컨텍스트(사용자가 직접 실행)도 대칭키(HMAC) 검증에는 같은 비밀키가 필요하다(예: 사용자 자신의 셸 환경변수로 `BRAIN_REVIEW_SIGNING_KEY` 보유). 향후 비대칭키로 전환하면 `--apply`는 공개키만으로 검증 가능해져 이 요구가 사라진다(설계상 확장 여지를 `alg`/`keyId` 필드로 이미 남겨둠).

### 7-3. 서명 대상 필드

- `ReviewDecision`의 **모든 필드를 서명하지 않는다** — `packetPathRead`/`reviewedAt` 같은 감사용 메타데이터는 서명 대상에서 제외하고, 판정의 실질적 내용만 서명한다.
- 서명 대상(canonical 직렬화 후 서명): `reviewId + packetSha256Recomputed + verdict + reasons + checkedItems`.
- canonical 직렬화는 `packetSha256` 계산에 쓰는 것과 동일한 `canonicalStringify`(키 재귀 정렬) 함수를 재사용한다(신규 구현 불필요, `checksum-utils.js`에 정의될 함수를 `signing-utils.js`에서도 재사용).
- 서명 결과는 `ReviewDecision.signature = { alg, keyId, value }`에 저장한다(위 2번 스키마 참고).

### 7-4. 검증 절차 (의사코드는 위 3번 `applySourceActivation` 참고, 여기서는 원칙만 요약)

- `--apply`는 판정 파일을 읽을 때마다 서명을 **항상 재계산**한다(별도 "서명 검증 완료" 캐시/상태를 두지 않음 — stateless 원칙, 5번 설계와 동일).
- 서명 키(대칭키 검증 시)는 `--apply`를 실행하는 사용자의 실행 컨텍스트에서 로드하며, 로드 실패 시 `SIGNING_KEY_UNAVAILABLE`로 즉시 중단.
- 서명이 없으면 `SIGNATURE_MISSING`, 재계산한 서명값과 저장된 `signature.value`가 다르면 `SIGNATURE_INVALID`(판정 파일 내용이 서명 후 한 글자라도 바뀐 경우 포함 — canonical 직렬화 특성상 필드 값이 하나라도 다르면 서명 대상 문자열이 달라져 서명값도 달라짐).

### 7-5. 검증 실패 시 처리

- `SIGNATURE_MISSING`/`SIGNATURE_INVALID`/`SIGNING_KEY_UNAVAILABLE` 세 경우 모두 `--apply`는 **무조건 거부**하고 아무 파일도 쓰지 않는다(백업조차 만들지 않음 — 아직 아무것도 건드리지 않았으므로).
- 이 세 원인 코드는 `STALE_REVIEW_PACKET_INVALIDATED`와 "즉시 중단, 쓰기 없음"이라는 원칙은 동일하되, 원인은 명확히 구분해 감사 기록에 남긴다(체크섬 불일치와 서명 문제는 재검토 시 필요한 조치가 다를 수 있으므로).

### 7-6. 잔여 한계(정직하게 인정)

- 이 서명 설계는 "같은 로컬 환경, 역할만 분리"라는 현재 전제 하에서 위조 가능성을 **줄이는** 조치이며 **완전히 없애지 못한다**. Code Agent 세션이 어떤 경로로든 서명 키(환경변수/파일)에 접근할 수 있다면, Code Agent 세션이 직접 유효한 서명을 계산해 `review-decisions/<reviewId>.json`을 위조할 수 있다 — 이는 아래 "Report Agent 종합 > 권한 경계와 우회 가능성"에서 이미 인정한 구조적 한계(파일 쓰기 권한만으로는 "누가 썼는가"를 증명할 수 없다는 한계)를 **줄이는 것이지 없애는 것이 아니다**.
- 진짜 방어선은 여전히 "Code Agent에게 서명 키에 접근하는 도구/권한을 아예 주지 않는다"는 운영 정책이다. 서명은 이 정책이 실수로 깨졌을 때(예: 판정 파일을 텍스트 에디터로 직접 수정하려는 실수) 이를 잡아내는 **추가 안전망**이지, 정책 자체를 대체하지 않는다.
- Brain이 실제로 별도 프로세스/기기로 분리되면 이 설계(서명 대상 필드, 검증 절차, 실패 코드)는 그대로 재사용 가능하며, 키 관리 방식만 "환경변수 주입" 대신 "별도 기기의 안전한 키 저장소"로 바뀌면 된다.

## 8) 기존 정적 href / JS 링크 / 말줄임표 제목 소스의 회귀 방지 전략

- 패킷의 `regressionEvidence.npmTestSummary`가 `fail 0`이 아니면 **패킷 자체를 생성하지 않는다**(빌더 단계에서 차단 — Brain에게 넘어가지도 못함).
- `jsRuleEvidence`는 `source.jsDetailLinkRule?.enabled === true`인 소스에 한해 필수이며, 없으면 패킷 빌더가 실패 처리(→ Brain 판정 자체가 불가능하므로 자연히 활성화 불가). 이때도 패킷 빌더는 "필수 근거 누락"만 감지할 뿐, `jsRuleUnverified` 같은 위반 판정 필드를 채우지 않는다(결정됨, 질문사항 2 — 판정은 Brain의 몫).
- 말줄임표 제목(`allowTruncatedListTitle`) 관련: `diagnostics.rawOutput.diagnostics[]`에 이미 `titleMatches`/`detailValidation` 결과가 소스별로 남으므로, 패킷은 이 raw 배열을 그대로 인용하고 Brain이 `excludedCount`/`reason: "detail_title_or_university_mismatch"` 항목이 있는지 직접 확인하도록 요구한다(별도 요약 없이 원본 그대로 인용 — 요약 과정에서 실패가 가려지는 것을 방지).
- 정적 href 소스(가장 흔한 케이스)는 `jsRuleEvidence: null`로 패킷에 명시되어, Brain이 "JS 규칙 미검증" HOLD 조건과 혼동하지 않도록 스키마 수준에서 구분한다.

## 9) 단위 테스트 계획

- `checksum-utils.test.js`: 동일 객체를 키 순서만 바꿔 canonical 직렬화해도 같은 해시가 나오는지, 값이 하나라도 다르면 해시가 달라지는지.
- `review-packet.test.js`: (a) 스키마 필수 필드 누락 시 생성 거부, (b) 패킷에 `robotsPolicyViolation`/`jsRuleUnverified`/`diagnoseFailed` 같은 위반 판정 필드가 존재하지 않고 원본 근거(`robotsEvidence`/`jsRuleEvidence`/`diagnostics.rawOutput`)만 담기는지(결정됨, 질문사항 2 검증), (c) `packetSha256`이 필드 하나만 바뀌어도 달라지는지, (d) 동일 `reviewId`로 두 번 쓰기 시도 시 에러(append-only 보장).
- `signing-utils.test.js`(신규, 7번 설계 참고): (a) 동일 서명 대상 필드는 항상 같은 서명값을 생성하는지, (b) 서명 대상 필드(`reviewId`/`packetSha256Recomputed`/`verdict`/`reasons`/`checkedItems`) 중 하나라도 값이 바뀌면 서명값이 달라지는지, (c) 잘못된 키로 검증하면 실패하는지.
- `apply-source-activation.test.js`: (a) 판정 파일이 없으면 `NO_DECISION_YET`으로 거부, (b) `verdict:"HOLD"`/`"REJECT"`면 `--apply` 유무와 무관하게 항상 거부, (c) `reviewedBy`가 블록리스트에 있으면 거부, (d) 패킷 생성 이후 카탈로그/store/preview 중 하나라도 바뀌면 `STALE_REVIEW_PACKET_INVALIDATED`로 거부(4가지 체크섬 각각에 대해 개별 테스트), (e) `--apply` 없이 실행하면 모든 검증을 통과해도 실제 파일 변화가 0건인지(`fs.statSync` mtime 불변으로 검증), (f) 모든 검증 통과 + `--apply` 있을 때만 `enabled:true` 반영 + `saveNewItems` 호출을 확인(저장소/카탈로그는 임시 디렉터리에 복사한 fixture로 검증, 실제 프로덕션 파일은 절대 건드리지 않음), (g) `saveNewItems`가 실패하도록 모킹했을 때 카탈로그가 원래 `enabled:false`로 롤백되는지, (h) **(신규)** 서명 필드가 없는 판정 파일은 `SIGNATURE_MISSING`으로 거부하고 아무 파일도 쓰지 않는지, (i) **(신규)** 서명값을 임의로 위조(다른 임의 hex 문자열로 교체)한 판정 파일은 `SIGNATURE_INVALID`로 거부하는지, (j) **(신규)** 서명 이후 판정 파일의 필드(`verdict`/`reasons`/`checkedItems` 등) 중 단 하나라도 수정되면 서명 검증이 실패해 `SIGNATURE_INVALID`로 거부하는지(서명 대상 필드가 한 글자라도 바뀌면 반드시 걸림을 증명), (k) **(신규)** 서명 검증에 필요한 키를 로드할 수 없는 실행 환경(예: 환경변수 미설정)에서는 `SIGNING_KEY_UNAVAILABLE`로 거부하는지.

## 10) 통합 테스트 계획

- 임시 디렉터리에 카탈로그/store/preview fixture 3종을 복사해 실제 파일 경로를 주입 가능하게 만든 뒤(의존성 주입 패턴, `screen-selector-required-sources.js`의 `fetchImpl`/`readFileImpl` 옵션 패턴을 그대로 재사용):
  1. 패킷 생성 → 가짜 APPROVE 판정 파일(서명 포함, 테스트 전용 키로 서명 — 실제 Brain 아님) 작성 → `--apply` 없이 실행 → 검증 통과 로그만 확인, fixture 파일 변화 없음 확인.
  2. 같은 패킷 → `--apply` 실행 → fixture 카탈로그의 `enabled:true` 반영, fixture store/preview에 신규 항목 반영 확인.
  3. 패킷 생성 후, `--apply` 실행 전에 fixture 카탈로그를 임의로 수정(다른 필드 하나) → `--apply` 실행 → `STALE_REVIEW_PACKET_INVALIDATED`로 거부, fixture 파일 변화 없음 확인.
  4. `verdict:"HOLD"` 판정 파일로 `--apply --apply` 실행 → 거부, 이유에 HOLD 사유 포함 확인.
  5. `saveNewItems` 단계에서 강제로 예외를 던지는 fixture(디스크 쓰기 권한 없는 경로 등)로 롤백 시나리오 재현 → 카탈로그가 `enabled:false`로 복구됨을 확인.
  6. (신규, 서명 관련) 서명 키를 테스트 환경변수에서 제거한 채 `--apply` 실행 → `SIGNING_KEY_UNAVAILABLE`로 거부, fixture 파일 변화 없음 확인.

# Report Agent 종합

## 제안 구조 요약

`server/agent/gate/`라는 새 네임스페이스에 "패킷 빌더(Code Agent 전용) / 판정 파일 스키마 + 서명(Brain 전용 쓰기) / `--apply` CLI(사용자 전용 실행, 서명 검증 포함)"를 분리 배치한다. 세 역할이 각각 정확히 파일 하나(또는 한 쌍)씩만 건드리도록 좁혀서, "누가 무엇을 쓸 수 있는가"가 파일 시스템 경로 수준에서 드러나게 한다. 실제 활성화·저장 로직은 기존 `run-single-school-trial.js`의 `backupBeforeSave()`/`assertSourceEnabledForSave()`와 `store.js`의 `saveNewItems()`/`writeAtomic()`를 그대로 재사용하고, 그 앞에 체크섬·서명·판정 검증 계층만 새로 추가한다(기존 안전장치를 대체하지 않고 감싼다).

## 예상 변경 파일 목록 (다음 Coder 단계, 이번 세션에서는 미작성)

신규:
- `server/agent/gate/checksum-utils.js`, `checksum-utils.test.js`
- `server/agent/gate/review-packet.js`, `review-packet.test.js`
- `server/agent/gate/review-decision-writer.js` (Brain 전용, Code Agent 실행 경로에 연결 안 함)
- `server/agent/gate/signing-utils.js`, `signing-utils.test.js` (신규 — HMAC-SHA256 서명/검증, 설계안 7번 참고)
- `server/agent/gate/apply-source-activation.js`, `apply-source-activation.test.js`
- `server/agent/gate/data/`(패킷/판정 파일) — **git 커밋 대상으로 유지**(감사기록 보존, `.gitignore` 미적용, 결정됨 — 질문사항 4). 단, 실제 `git add`/`commit` 실행은 이번 라운드는 물론 앞으로도 매 라운드 사용자의 별도 승인 후에만 수행한다.

폐기/차단 대상(결정됨 — 질문사항 3, 게이트 도입과 **동시에** 처리. 이번 세션에서는 아래 목록에 추가만 하고 실제로 건드리지 않음):
- `server/agent/onboarding/tools/activate-collector-ready.js`
- `server/agent/onboarding/tools/activate-kyungnam-general-feed.js`
- `server/agent/onboarding/tools/activate-dnue-general-feed.js`
- `server/agent/onboarding/tools/activate-youngsan-shared-feed.js`
- `server/agent/onboarding/tools/activate-mtu-general-feed.js`
- `server/agent/tools/run-uni-pick-next-batch-auto-resolution.js`
- `server/agent/onboarding/tools/run-one-onboarding.js`

  (위 7개는 Research 5번에서 이미 확인된 목록. Coder 단계 착수 시 이 목록 외에도 `enabled`를 직접 쓰는 유사 스크립트가 있는지 `git grep`으로 다시 확인 필요 — 이번 조사 이후 유사 스크립트가 추가됐을 수 있음. 실제 처리 방식(완전 삭제 vs 실행 시 즉시 에러를 던지는 스텁으로 교체)은 다음 Coder 단계에서 확정한다 — 아래 "질문사항" 참고.)

기존 파일 중 **읽기만 하고 로직은 바꾸지 않을** 대상(재사용):
- `server/agent/tools/run-single-school-trial.js`(`backupBeforeSave`, `assertSourceEnabledForSave` 등 export 필요 여부 확인 필요 — 현재 이 두 함수는 export되어 있지 않음, 241번째 줄 `module.exports` 확인 결과 `assertSourceEnabledForSave`만 export되어 있고 `backupBeforeSave`는 export 안 됨 → Coder 단계에서 `backupBeforeSave`를 export에 추가하거나 게이트 쪽에 동등한 함수를 새로 작성해야 함, 최소 diff 원칙상 export 추가 쪽을 권장)
- `server/agent/store.js`(`saveNewItems`, `STORE_PATH`, `PREVIEW_PATH` 이미 export됨, 그대로 재사용 가능)

수정 가능성이 있는 문서 파일(코드 아님, 정책 반영용):
- `AGENTS.md`/`.claude/CLAUDE.md`에 "Brain 최종 승인 게이트" 관련 절 추가 여부(사용자 승인 필요)

## 권한 경계와 우회 가능성 (반드시 사용자/Brain이 인지해야 할 한계)

1. **결정됨(질문사항 1) — 가장 중요한 구조적 한계는 여전히 남아 있음**: Brain 세션과 Code Agent 세션은 현재 같은 로컬 환경에서 역할만 분리된 것으로 간주한다. 이 설계의 모든 방어(체크섬 일치, `reviewedBy` 블록리스트, `verdict==="APPROVE"` 요구, 그리고 이번 갱신에서 추가한 HMAC 서명 검증)는 **파일 내용에 대한 검증**일 뿐, "그 판정 파일을 실제로 누가 썼는가"를 완전히 암호학적으로 증명하지 않는다. Code Agent 세션이 서명 키(환경변수/파일) 자체에 접근할 수 있는 경로가 하나라도 남아 있으면, Code Agent 세션이 직접 유효한 서명을 계산해 `review-decisions/<reviewId>.json`을 위조할 수 있고, 이는 `--apply`의 모든 assert(서명 검증 포함)를 그대로 통과한다. 즉 **진짜 방어선은 여전히 코드가 아니라 "Code Agent에게 이 판정 파일을 쓰는 도구/서명 키 접근 권한을 아예 주지 않는다"는 운영 정책**이다(설계안 7-6 "잔여 한계" 참고). 서명은 이 한계를 **줄이지만 없애지는 못한다**.
2. HMAC 서명(설계안 7번, 이번 갱신에서 신규 반영)을 추가함으로써 "판정 파일을 실수로 또는 형식적으로 위조하는" 시나리오는 상당 부분 차단된다. 다만 이 방어가 실질적이려면 비밀키를 Code Agent가 접근 못 하는 곳에 보관해야 한다는 전제가 성립해야 하며, 그 구체적 운영 방법(환경변수 주입 vs 파일 권한 분리)은 다음 Coder 단계에서 확정한다(질문사항 참고).
3. `--apply`가 사람이 터미널에서 직접 실행한다는 전제도 마찬가지로 정책 의존적이다 — Code Agent 세션이 Bash 도구로 `--apply`를 직접 호출하는 것을 막는 것은 코드가 아니라 Claude Code의 도구 권한(사용자 승인 프롬프트) 시스템이다.

## 위험 요소와 실패 처리

| 위험 | 대응 |
|---|---|
| store/preview 두 파일 사이의 비원자성(store.js 자체 한계) | `performActivationAndSave` 실패 시 두 파일 모두 백업에서 복구 + 재검증(6번 설계) |
| 카탈로그 쓰기 성공 후 `saveNewItems` 실패 | catch 블록에서 카탈로그를 백업본으로 롤백, `enabled` 원복 재확인(6번 설계) |
| 패킷 생성 후 소스가 다른 프로세스에 의해 바뀜(레이스 컨디션) | `--apply` 실행 시점에 항상 재계산·재비교(5번 설계, stateless) |
| Brain이 패킷 파일 자체를 잘못 읽거나 손상된 패킷을 검토 | Brain이 `packetSha256`을 직접 재계산해 자체 검증(2번 설계) |
| 판정 파일이 위조됨(가장 심각) | 코드로는 완전 차단 불가 — HMAC-SHA256 서명 검증(7번 설계, 결정됨)으로 우회 가능성을 줄임. 다만 서명 키 자체가 Code Agent 세션에 노출되면 여전히 위조 가능 — 최종 방어는 운영 정책/도구 권한 경계(7-6 잔여 한계 참고) |
| flaky 테스트로 인한 오탐(직전 라운드 실제 선례) | 패킷/`--apply` 테스트에서 시간/난수 필드는 전부 고정값 주입 |
| 기존 파편화된 `activate-*.js` 스크립트가 게이트를 우회해 계속 `enabled=true`로 직접 쓸 수 있음 | **결정됨(질문사항 3)**: 게이트 도입과 동시에 폐기/차단. 실제 폐기 작업은 다음 Coder 단계 구현 대상에 명시(위 "예상 변경 파일 목록 > 폐기/차단 대상" 참고). 완전 삭제 vs 스텁 교체는 Coder 단계에서 확정 |
| 패킷/판정 파일이 git 이력에 계속 쌓임(감사 목적상 의도된 동작이나 저장소 용량 증가 가능) | **결정됨(질문사항 4)**: git 커밋 대상 유지. 단 실제 `git add`/`commit`은 매 라운드 사용자 승인 후에만 실행 — 이번 라운드를 포함해 어떤 라운드에서도 자동 커밋 금지 |

## 다음 Coder 단계 완료 기준 (제안, 사용자 확정 필요)

- [ ] `server/agent/gate/checksum-utils.js`/`review-packet.js`/`signing-utils.js`/`apply-source-activation.js`와 각 테스트 파일이 위 설계대로 구현되고 `node --check` 통과.
- [ ] `npm test` 전체가 결정적으로(반복 실행 3회 이상) `fail 0`.
- [ ] `apply-source-activation.js`를 `--apply` 없이 실행했을 때 카탈로그/store/preview 파일의 mtime이 전혀 바뀌지 않음을 자동 테스트로 증명.
- [ ] HOLD/REJECT 판정 파일로는 `--apply`가 어떤 조합으로도 절대 활성화·저장을 수행하지 않음을 자동 테스트로 증명.
- [ ] 체크섬 4종(카탈로그 파일/소스 블록/store/preview) 각각에 대해 "패킷 생성 후 변경 시 무효화" 테스트가 개별적으로 존재.
- [ ] **(신규)** 서명 검증(`SIGNATURE_MISSING`/`SIGNATURE_INVALID`/`SIGNING_KEY_UNAVAILABLE`) 각각에 대해 `--apply`가 거부하고 아무 파일도 쓰지 않음을 자동 테스트로 증명.
- [ ] **(신규)** 판정 파일 내용(서명 대상 필드 중 하나라도)이 서명 후 변경되면 서명 검증이 반드시 실패함을 자동 테스트로 증명.
- [ ] `saveNewItems` 실패 시 롤백 후 `enabled`가 원래 값으로 복구됨을 자동 테스트로 증명.
- [ ] `review-decision-writer.js`(Brain 전용 쓰기)가 Code Agent용 `npm run`/기존 온보딩 스크립트 어디에서도 호출되지 않음을 코드 리뷰로 확인.
- [ ] **(신규)** 위 "폐기/차단 대상" 목록의 `activate-*.js`류 스크립트(및 재확인으로 추가 발견된 유사 스크립트)가 게이트 도입과 동시에 폐기/차단되어, 신규 소스 활성화가 `--apply` 경로로만 가능함을 코드 리뷰 또는 자동 테스트로 증명.
- [ ] **(신규)** `server/agent/gate/data/`를 실제 `git add`/`commit`하기 전, 사용자에게 별도 승인을 요청함(자동 커밋 금지) — Coder/Reviewer 단계 모두에서 지켜야 할 절차로 명시.
- [ ] 실제 프로덕션 카탈로그/store/preview 파일은 이번 Coder 단계에서도 건드리지 않음(테스트는 임시 fixture만 사용).

## 사용자가 정해야 할 정책 항목 (요약, 아래 "질문사항"과 동일)

1. **결정됨**: 같은 로컬 환경, 역할만 분리로 간주한다. HMAC-SHA256 서명 기반 권한 경계를 설계안 7번에 추가로 반영했다. 서명 키를 실제로 어디에(환경변수 vs 파일 권한 분리 디렉터리) 어떻게 주입할지의 구체적 운영 방법은 다음 Coder 단계에서 확정한다.
2. **결정됨**: 위반 여부 판정(`robotsPolicyViolation`/`jsRuleUnverified`/`diagnoseFailed`)은 Code Agent가 계산하지 않는다. 패킷에는 원본 근거만 담고, 최종 판정은 전부 Brain이 `ReviewDecision.checkedItems`에 직접 기록한다.
3. **결정됨**: 기존 `activate-*.js`류 스크립트는 게이트 도입과 동시에 폐기/차단한다(목록은 위 참고). 완전 삭제할지 실행 시 즉시 에러를 던지는 스텁으로 남길지는 다음 Coder 단계에서 확정한다.
4. **결정됨**: `server/agent/gate/data/`(패킷/판정 파일)는 git 커밋 대상으로 남긴다(`.gitignore` 미적용, 감사기록 보존). 단 실제 `git add`/`commit`은 매 라운드 사용자 승인 후에만 수행한다.

# Coder 2라운드 대상 (11개 파일 조사 결과 — Research Agent, 읽기 전용 조사만 수행)

Coder 1라운드에서 `server/agent/gate/` 5개 모듈 + 테스트를 신규 작성하고, spec.md에 명시된 7개 `activate-*.js`를 스텁으로 교체했다(신규 게이트 테스트 66/66, 스테일 패킷 거부 5/5, 전체 `npm test` 233/233 통과 — 커밋은 아직 안 함). 이후 완전성 감사에서 게이트를 우회해 `enabled=true`를 직접 쓰는 경로가 총 18개임이 드러났고, 그중 미처리 11개(`server/agent/tools/` 대형 스크립트 9개 + 기존에 알려져 있던 미처리 2개)에 대해 이번 라운드에서 읽기 전용 Research Agent를 실행해 조사했다. 코드/테스트 파일은 수정하지 않았다.

## 조사 결과 요약

| 파일 | 공통 패턴 일치 | 기타 기능 | 외부 참조 | 권장 |
|---|---|---|---|---|
| `server/agent/tools/activate-catholic-kwandong-source-local.js` | N (`healthStatus:"validated"`, store/preview 미접촉) | N | N | 전체 스텁 교체 |
| `server/agent/tools/activate-kyungdong-shared-source.js` | N (레거시 캠퍼스 소스 4개 삭제 + 공유소스 병합 마이그레이션) | Y (`node --check` 자기검증) | N | 전체 스텁 교체 (마이그레이션 **이미 완료됨** — 아래 참고) |
| `server/agent/tools/activate-inje-shared-source.js` | N (소스 정의 하드코딩, **가드 없는 즉시실행**) | Y (curl 기반 dry-run, `npm test`) | N | 전체 스텁 교체 |
| `server/agent/tools/activate-daeshin-source.js` | N (**가드 없는 즉시실행**) | Y (curl 기반 dry-run, `npm test`) | N | 전체 스텁 교체 |
| `server/agent/tools/activate-sangmyung-cheonan-source.js` | 유사 (`verifiedAt` 추가) | Y (curl dry-run, `npm test`) | N | 전체 스텁 교체 |
| `server/agent/tools/activate-kyungwoon-source.js` | 유사 (`verifiedAt` 추가) | Y (curl dry-run, `npm test`) | N | 전체 스텁 교체 |
| `server/agent/tools/activate-changshin-source.js` | 유사 | Y (13개 함수 `module.exports`, `npm test`) | N (export되나 소비자 없음) | 전체 스텁 교체 |
| `server/agent/tools/activate-hwasung-medi-science-source.js` | 유사 | Y (14개 함수 `module.exports`, `npm test`) | N (export되나 소비자 없음) | 전체 스텁 교체 |
| `server/agent/tools/activate-keimyung-source.js` | N (READY + FINALIZATION 2단계 게이트) | Y (11개 함수 `module.exports`, 그중 `runDryValidation`은 네트워크 fetch 포함) | N (export되나 소비자 없음) | 전체 스텁 교체 |
| `server/agent/onboarding/tools/activate-mokpo-catholic.js` | Y (완전 일치) | N (**가드 없는 즉시실행**) | N | 전체 스텁 교체 |
| `server/agent/onboarding/tools/activate-ulsan-general-feed.js` | Y (완전 일치) | N (**가드 없는 즉시실행**) | N | 전체 스텁 교체 |

## 판정 근거 및 유의사항

- **11개 전부 "전체 스텁 교체" 권장.** repo 전체 grep(`require(...)` 호출부, `*.test.js`) 결과 이 11개 파일을 요구하는(require하는) 다른 코드나 테스트가 하나도 없음을 확인했다 — 즉 "부분 보존"이 필요할 외부 의존성이 없다.
- **`activate-changshin-source.js` / `activate-hwasung-medi-science-source.js` / `activate-keimyung-source.js`** 3개는 `module.exports`로 각각 13/14/11개의 파싱·검증 헬퍼 함수(및 `keimyung`의 경우 네트워크 `runDryValidation`)를 노출하고 있으나, 현재 이 export를 소비하는 코드가 전혀 없어 스텁 교체 시 이 export 자체도 함께 제거하는 편이 안전하다(향후 아무도 `require()`해서 `undefined` 함수를 호출할 일이 없음을 확인했으므로).
- **`activate-inje-shared-source.js` / `activate-daeshin-source.js` / `activate-mokpo-catholic.js` / `activate-ulsan-general-feed.js`** 4개는 `require.main === module` 가드 없이 파일 하단에서 `main()`을 무조건 실행하는 구조다(즉 이 파일을 어디선가 `require()`만 해도 활성화 로직이 즉시 돈다). 기존에 이미 스텁 교체된 7개 파일도 동일하게 가드 없이 `main()`을 호출하는 관례이므로 스텁 형태 자체는 기존 관례와 일치하지만, **스텁 교체 순서상 이 4개(특히 inje/daeshin/mokpo-catholic/ulsan)를 우선 처리 대상으로 표시**해 둔다(가드 없는 즉시실행 구조상 방치 위험이 상대적으로 더 크다는 근거).
- **`activate-kyungdong-shared-source.js`**는 단순 활성화가 아니라 "레거시 캠퍼스 소스 4개 삭제 + 본교 공유소스 1개 추가"라는 마이그레이션 로직을 겸하고 있다. **(갱신, 카탈로그 데이터 직접 확인 완료 — 읽기 전용)** 스크립트가 정의한 `LEGACY_SOURCE_IDS`(`kyungdong-main-general-notice`/`kyungdong-campus2-general-notice`/`kyungdong-campus3-general-notice`/`kyungdong-campus4-general-notice`, 스크립트 91~96행)는 현재 카탈로그(`development/university-news/data/university-news-sources.final.json`)에 **전혀 존재하지 않는다**(`kyungdong-university-제2/3/4캠퍼` 3개 대학 블록 모두 `sources: []`로 비어 있음, 2488/2510/2532행). 병합 대상 공유소스 `kyungdong-shared-general-notice`는 `kyungdong-university-본교` 블록에 이미 존재하며(2556행), 스크립트의 `CANONICAL_OWNER`/`VISIBLE_TO_CAMPUSES` 상수(81~89행)와 카탈로그의 `canonicalOwner`/`visibleToCampuses` 값(2564~2570행)이 정확히 일치한다. 이 소스는 이미 `verified:true, enabled:true, status:"verified", healthStatus:"validated"`(2582~2585행)로 **활성화까지 완료되어 있고**, `git log -S "kyungdong-shared-general-notice"` 결과 이 상태는 이번 게이트 작업 이전인 커밋 `ff28464`(레포 기존 커밋)에서 이미 반영·커밋된 상태임을 확인했다(이번 세션이나 미커밋 변경사항이 아님). **결론: 마이그레이션 이미 완료됨 — 스텁 교체 즉시 안전.** 스텁 교체 대상은 스크립트 코드뿐이며, 카탈로그 데이터는 이미 최종 상태이므로 별도 처리가 필요 없다.
- **`activate-catholic-kwandong-source-local.js`**는 카탈로그만 건드리고 `saveNewItems`(store/preview 저장)를 호출하지 않는 유일한 파일이다 — 스텁 교체 시 이 차이(활성화만 하고 초기 저장은 안 함)가 게이트의 `ACTIVATE_AND_SAVE_INITIAL_ITEMS` 단일 액션 가정과 다를 수 있음을 다음 Coder 단계에서 감안해야 한다(활성화만 하는 별도 액션 타입이 필요할 수 있음).
- 11개 파일 모두 `enabled`를 쓰는 지점의 필드 조합(`enabled`/`verified`/`status`/`healthStatus`/`verifiedAt`/`campusScope` 등)이 조금씩 다르므로, 스텁 교체 자체는 안전하지만 **게이트의 `proposedChange` 스키마가 이 필드 조합 차이를 전부 흡수할 수 있는지**는 다음 Coder 단계에서 소스별로 재확인이 필요하다.

## 다음 단계 (사용자 승인 대기, 이번 라운드에서는 미착수)

- 이 11개 파일에 대한 "전체 스텁 교체" 실행은 사용자 확인 후 Coder 2라운드에서 진행한다.
- 스텁 교체 순서 제안: (1) 가드 없는 즉시실행 4개(`inje-shared`, `daeshin`, `mokpo-catholic`, `ulsan-general-feed`) → (2) 나머지 7개.
- 이번 라운드는 조사만 수행했으며 코드/테스트/git 상태는 변경하지 않았다.

## 사용자가 정해야 할 정책 항목 (요약, 아래 "질문사항"과 동일)
</content>
