# 검토 요약

대상: UNI PICK "JS 전용 목록 링크 안전 수집 엔진"(`jsDetailLinkRule`) 구현.
Planner(spec.md) 요구사항을 Coder(changes.md)가 구현했고, Tester가 두 가지
문제(테스트 7 flaky, `notes` 필드 추가로 인한 완료 기준 위반 의혹)를 보고하며
"실패"로 판정했다. Reviewer(본 문서)는 changes.md/test-results.md를 그대로
인용하지 않고 실제 코드·JSON·테스트를 직접 재실행/재확인했다.

**중요**: 이번 승인 판정의 범위는 `jsDetailLinkRule` 엔진(안전 정규식 모듈,
콜렉터 확장, 단위 테스트, `khu-official-news` JSON 필드 추가)에 한정된다.
경희대 `selectors.item`/`title` 등 선택자 반영, `verified`/`enabled` 전환,
diagnose 3/3 통과, 저장/활성화는 spec.md가 명시적으로 이번 라운드 범위 밖으로
분리했으며, 이번 승인 여부와 무관하다.

# 요구사항 확인

spec.md 요구사항 1~8 대비 직접 재현 결과:

1. onclick/속성값 실행 금지 — `safe-onclick-call.js`, `html-list-collector.js`
   전체에 `eval(`, `new Function(`, `require("vm")` 계열 실행 코드가 전혀 없음을
   grep으로 직접 확인(주석 설명 문구만 매치). 정규식 매칭 후 캡처값만
   반환하는 구조를 코드로 직접 읽어 확인. **충족**.
2. 완전 opt-in, source별 개별 필드 — `resolveJsDetailLink`는
   `rule.enabled !== true`면 즉시 `""`을 반환하고, `htmlListCollector` 내부
   분기도 `source.jsDetailLinkRule && source.jsDetailLinkRule.enabled === true`
   조건으로 정확히 게이트됨. `node -e`로 `rule` 미지정/`enabled:false` 양쪽
   모두 직접 호출해 빈 문자열 반환을 재확인. **충족**.
3. 인자 안전 문자집합 + 길이 상한, 위반 시 항목만 제외 — `node -e`로 63/64자
   통과, 65자 거부를 직접 재현. 항목 제외 시 `htmlListCollector`가 `link=""`로
   두고 `warnings`에 사유만 남기고 계속 진행하는 구조(코드 리뷰로 확인, 소스
   전체 중단 없음). **충족**.
4. 조립 URL과 `baseUrl`/`listUrl` 동일 호스트 필수, 이 검증이
   `server/agent/collector.js`(프로덕션 경로)에도 적용 — `sameHost`가
   `html-list-collector.js` 내부에 있고 `collector.js`는 이 파일의
   `htmlListCollector`를 그대로 호출하므로 자동 적용됨을 확인. `node -e`로
   `www.`유무 허용/서브도메인 거부/lookalike 도메인(`khu.ac.kr.evil.com`) 거부를
   직접 재현. **충족**.
5. `urlTemplate`은 사람이 사전에 GET 검증한 값만 — `khu-official-news`
   JSON 블록에 `verification.method: "manual-curl-get-equivalence"`와 실측
   `sampleRequests`가 스키마에 그대로 존재. 코드가 이 필드를 파싱해 안전
   검사를 건너뛰지 않는 구조(런타임 무관, 사람용 감사 기록)임을 코드에서
   확인. **충족**.
6. 지원 범위 축소 + HOLD 명시 — `parseSimpleFunctionCall`은 중첩 괄호/복수
   statement/변수참조/문자열 연결을 모두 거부(정규식 구조상 매칭 자체가
   실패). 단위 테스트 10, 11에서 직접 검증됨. **충족**.
7. 기존 정적 href 회귀 없음, `npm test` 전체 통과 — `detailLinkFromValue`
   함수 본문은 `git diff`상 단 한 글자도 수정되지 않았고(순수 추가), 링크
   조립 한 줄만 조건부 확장된 구조를 diff로 직접 확인. 다만 **`npm test`
   "전체 통과"는 결정적으로 재현되지 않음** — 아래 "테스트 결과" 참고.
   **부분 충족(테스트 신뢰성 이슈 있음)**.
8. `--diagnose --limit=3` 진단, 실패 시 활성화·저장 중단 — changes.md
   자체 보고(“verified:false로 조기 제외”)와 spec.md의 사전 예측이 일치하고,
   `enabled`/`verified`가 여전히 `false`로 유지됨을 JSON diff에서 직접 확인.
   이번 라운드 범위상 diagnose 3/3 통과는 완료 기준에서 제외됨(spec.md
   "예외 상황"에 명시). **충족(범위 밖 항목 정상 분리)**.

# 테스트 결과

## 문제 1 — 테스트 7 flaky (직접 재검증)

- `node --test development/university-news/collectors/html-list-collector.test.js`를
  20회 이상 반복 실행해 재현: 대략 8~20회 중 1회꼴로
  `jsDetailLinkRule.enabled: false ...` 테스트(7번)가
  `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal`로
  실패함을 직접 확인. `npm test` 전체 스위트로도 동일하게 1회는 실패,
  다른 1회는 165/165 통과를 직접 확인(비결정적임을 재현).
- 실패 로그를 직접 확인한 결과, 실패 지점은 `collectedAt` 필드 단 하나뿐이며
  나머지 모든 필드(특히 `sourceUrl`, `urlHash`, `contentHash` 등 로직 관련
  필드)는 완전히 동일함. 즉 **`resolveJsDetailLink`/opt-in 분기 로직 자체는
  두 호출에서 완전히 동일한 결과를 냄** — 실패 원인은 테스트 7이
  `htmlListCollector({...})`를 두 번 호출하면서 `collectedAt`을 명시적으로
  넘기지 않아, 각 호출이 함수 기본값 `collectedAt = new Date().toISOString()`을
  별도 시점에 평가하기 때문(밀리초 경계를 넘으면 값이 달라짐).
- **판정: 프로덕션 로직(`resolveJsDetailLink`/`sameHost`/opt-in 분기)의
  결함이 아니라, 테스트 7 자체의 설계 결함**(Tester의 결론과 일치). 다만
  이 결함으로 인해 "단위테스트 14개 전부 통과"·"`npm test` 전체 통과"라는
  완료 기준을 **결정적으로(항상) 충족한다고 보고할 수 없음** — 이는 실제
  CI/로컬 재실행 시 원인 불명의 간헐적 빨간불을 유발할 수 있는 실질적
  결함이며, Reviewer 권한상 직접 수정하지 않고 사실만 기록한다.

## 문제 2 — `khu-official-news`의 `notes` 필드 추가 (독립 재검증)

메인 에이전트의 이의 제기 근거를 다음과 같이 직접 검증했다.

1. `changes.md`에 Coder가 "그 외 필드(… `notes` …)는 전혀 건드리지 않음"이라고
   명시적으로 자기 보고했음을 원문에서 직접 확인.
2. `git diff -- development/university-news/data/university-news-sources.final.json`로
   `khu-official-news` 블록을 직접 대조한 결과, `jsDetailLinkRule` 객체는
   정확히 spec.md가 지시한 위치(`"selectors": {}` 와 `"verified": false`
   사이)에만 삽입되어 있고, `notes` 필드는 그 삽입 범위 밖(`healthStatus`
   뒤, 블록 맨 끝)에 위치함 — 즉 diff 구조상 "jsDetailLinkRule 삽입"과
   "notes 라인 추가"는 서로 다른 위치에서 발생한 두 개의 독립적 변경으로
   보이며, Coder가 주장하는 삽입 범위와 정확히 일치한다.
3. `notes` 내용을 직접 읽은 결과, "html-list-collector.js의
   detailLinkFromValue가 … onclick 인자 기반 URL 조립을 지원하지 않으므로
   현재 JSON 선택자만으로는 수집 불가 … 수집기 코드 확장 없이는 활성화
   보류"라는 문구는 논리적으로 **이번 라운드가 만든 `jsDetailLinkRule` 기능이
   존재하기 이전 시점**의 조사 결과를 서술한 것이다. 이번 Coder가 방금
   `jsDetailLinkRule`을 구현하면서 동시에 "코드 확장 없이는 보류"라는 문구를
   새로 썼다면 자기모순이며, 이는 이 `notes`가 **별도의 이전 조사 세션에서
   이미 작성돼 있던 내용**이라는 정황과 부합한다.
4. 독립 증거: 이번 대화 시작 시점에 시스템이 제공한 `git status` 스니펫에
   `development/university-news/data/university-news-sources.final.json`이
   이미 `M`(수정됨) 상태로 표시되어 있었다 — 이는 어느 에이전트의 자기
   보고도 아닌, 이번 Planner→Coder→Tester 파이프라인이 시작되기 **이전에**
   이미 이 파일에 미커밋 변경이 존재했음을 나타내는 시스템 레벨 증거다.
   `AGENTS.md` 4항("최소한의 안전한 변경만 하고, 무관한 기존 변경을
   대체하지 않는다")도 이런 상황(파일에 이미 다른 미커밋 변경이 섞여
   있음)을 전제로 한 규칙이며, spec.md 자체도 "이 파일에는 다른 미커밋
   변경분이 섞여 있을 수 있다"고 명시했다.
5. 반면 Tester가 근거로 든 `git log -S`(커밋 히스토리 부재)와 파일 mtime은,
   메인 에이전트가 지적한 대로 "최근 커밋 이후 어느 시점에 생겼다"만
   증명할 뿐 "이번 특정 Coder 실행이 만들었다"는 것을 증명하지 못하는
   약한 증거임을 확인했다(같은 파일을 저장하면 다른 줄을 건드리지 않아도
   전체 mtime이 갱신됨).

**판정**: 위 4가지 정황(자기 보고 + 논리적 시점 모순 + diff 위치 분리 +
세션 시작 전 이미 M 상태였다는 시스템 레벨 증거)을 종합하면, `notes`
필드는 **이번 Coder 실행이 새로 추가한 것이 아니라 이전 별도 조사
세션에서 이미 존재하던 내용을 그대로 둔 것일 가능성이 매우 높다**.
따라서 Tester의 문제 2는 **오판(false positive)**으로 판단한다. 다만
100% 물리적으로 확정할 수 있는 스냅샷(이번 Coder 실행 직전 시점의 diff)이
남아있지 않으므로, 이는 "합리적 의심을 넘는 확신"이지 "수학적 증명"은
아니라는 한계도 함께 기록한다.

## 사용자 지정 6개 검토 항목 재확인 결과

1. eval/new Function/vm 부재 — 직접 grep 재확인, **통과**.
2. `enabled=true`만 새 경로(opt-in 게이트) — 코드 확인 + `node -e` 직접
   호출로 **통과**. (단, 이를 증명하는 자동회귀 테스트 7 자체는 위 문제
   1과 같이 flaky함)
3. 호스트 검증 + 64자 길이 상한 — `node -e`로 63/64/65자 경계값,
   www/서브도메인/lookalike 도메인 케이스 모두 직접 재현, **통과**.
4. 기존 정적 href 소스 동작 불변 — `git diff` 상 `detailLinkFromValue`
   본문 무변경(순수 추가) 확인, **통과**. (전체 `npm test` "항상 165/165"는
   문제 1로 인해 결정적으로 보장되지 않음)
5. 경희대 외 전북대/경상국립대/단국대 JSON 미변경 — `grep -c
   jsDetailLinkRule` = 1(경희대 블록 397번째 줄에만 존재)을 직접 재확인,
   **통과**.
6. store/preview/enabled/배포/git 변경 없음 — `git log`에 신규 커밋 없음,
   `khu-official-news`의 `verified`/`enabled`가 `false` 그대로 유지됨을
   diff로 직접 확인, **통과**. (store/preview 파일들의 기존 미커밋 diff는
   이번 세션 이전부터 존재하던 무관한 변경이며 이번 라운드 산출물이 아님을
   `collector.js`/`run-single-school-trial.js`의 무관 diff와 동일한 논리로
   확인)

# 문제점

1. **(핵심) `html-list-collector.test.js` 테스트 7이 비결정적(flaky)이다.**
   여러 차례 직접 재현 확인. 원인은 `collectedAt`을 명시적으로 넘기지
   않고 두 번 `htmlListCollector()`를 호출하는 테스트 설계 결함이며,
   프로덕션 로직(`resolveJsDetailLink`/opt-in 분기)의 결함은 아니다. 다만
   이 상태로는 "단위 테스트 14개 이상 전부 통과", "`npm test` 전체 통과"라는
   완료 기준을 결정적으로 만족한다고 보장할 수 없다. 향후 CI/로컬 실행에서
   원인 불명의 간헐적 실패를 유발할 위험이 실질적으로 존재한다.
2. `khu-official-news` JSON 블록의 `notes` 필드는 재검증 결과 이번 Coder
   라운드의 산출물이 아닐 가능성이 높다고 판단했으나(위 근거), 완전한
   물리적 증명은 불가능하다는 한계가 있다. 만약 향후 이 판단이 틀린 것으로
   드러나면 changes.md의 자기 보고("전혀 건드리지 않음")가 부정확했다는
   뜻이 되므로, 이 점은 참고용으로 기록해 둔다(이번 판정에는 반영하지 않음).
3. `run-single-school-trial.js --diagnose`는 이번 라운드에서 조기에
   `"No verified official RSS/HTML source..."` 메시지로 즉시 중단되었음
   (경희대 `verified: false`이기 때문). 이는 spec.md가 사전에 명시한 정상
   범위(선택자 미정 상태) 밖의 결과지만, spec.md/changes.md 모두 이를
   "이번 기능의 결함이 아니며 후속 라운드 과제"로 정확히 구분해 보고했고,
   Reviewer 검증 결과도 이 해석에 동의한다. 문제로 집계하지 않는다.

# 최종 판정 (보완 반영 후 갱신)
승인

# 갱신 사유

이 판정을 막았던 유일한 사유(테스트 7의 `collectedAt` 타이밍 경쟁조건)를
메인 에이전트가 `FIXED_COLLECTED_AT`을 두 `htmlListCollector()` 호출에
동일하게 전달하는 방식으로 수정했다. 수정은 `html-list-collector.test.js`
한 파일에만 국한되고(`git diff --stat`으로 확인), 프로덕션 코드
(`resolveJsDetailLink`/`sameHost`/`safe-onclick-call.js`)와 JSON은 전혀
건드리지 않았다. 수정 후 대상 테스트 10회 연속 `14/14`, `npm test` 전체
3회 연속 `165/165`로 결정적 통과를 재확인했다(test-results.md "추가 검증"
참고). 이 항목을 제외한 나머지 모든 요구사항·안전 검증은 이전 재검토에서
이미 통과로 확인됨. 승인 범위는 이전과 동일하게 `jsDetailLinkRule` 엔진에
한정되며, 경희대 선택자 반영·diagnose·활성화·저장은 포함하지 않는다.

# 판정 이유 (최초 판정 근거, 아래 참고용으로 유지)

`jsDetailLinkRule` 엔진 자체(안전 정규식 매칭, opt-in 2중 게이트, 호스트
검증, 64자 길이 상한, 기존 정적 href 무회귀, JSON 최소 diff)는 코드 리뷰와
직접 실행(`node -e`, 반복 `node --test`)으로 재검증한 결과 spec.md의 안전
요구사항을 모두 충족하며 프로덕션 위험 요소는 없다. `notes` 필드 관련
Tester의 문제 2는 독립 증거(세션 시작 전 이미 `M` 상태였다는 시스템 레벨
git status, 논리적 시점 모순, diff 위치 분리)를 근거로 재검증한 결과
오판(false positive)에 가깝다고 판단해 승인을 막을 사유로 보지 않는다.

그러나 문제 1(테스트 7 flaky)은 이번 검토에서 직접 여러 차례 재현에
성공한 실재하는 결함이다. 원인이 프로덕션 로직이 아니라 테스트 설계에
있다는 점에서 안전상 "차단"까지 갈 사안은 아니지만("완전 opt-in"이며
`enabled: false`로 유지되어 있어 이 상태로 두어도 실제 서비스에 영향은
없음), "단위 테스트 전부 통과"·"`npm test` 전체 통과"라는 spec.md의
명시적 완료 기준을 이번 산출물 그대로는 결정적으로 충족하지 못한다.
따라서 코드/JSON 자체는 승인 가능한 수준이지만, 테스트 7의 `collectedAt`
타이밍 경쟁조건을 수정(예: 두 `htmlListCollector()` 호출 모두에 동일한
고정 `collectedAt` 값을 명시적으로 전달)한 뒤 `npm test`가 결정적으로
165/165 통과함을 재확인하는 보완이 필요하다는 의미에서 "보완 필요"로
판정한다.
