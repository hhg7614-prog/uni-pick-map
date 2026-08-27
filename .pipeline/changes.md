# 변경된 파일

1. (신규) `development/university-news/utils/safe-onclick-call.js`
2. `development/university-news/collectors/html-list-collector.js`
3. (신규) `development/university-news/collectors/html-list-collector.test.js`
4. `development/university-news/data/university-news-sources.final.json`
   (`khu-official-news` 소스 블록에만 `jsDetailLinkRule` 필드 추가)

# 변경 내용

## 1. `development/university-news/utils/safe-onclick-call.js` (신규)

- `parseSimpleFunctionCall(expression)`, `isSafeRawAttrValue(value)`,
  `ALLOWED_DATA_ATTR_NAMES`(Set)를 export.
- `server/agent/screening/link-risk-heuristics.js`의
  `SIMPLE_FN_CALL_ONCLICK`/`SIMPLE_ID_ARG`와 동일한 안전 기준(함수 호출
  형태만 매칭, 각 인자는 숫자/따옴표+영숫자-하이픈/`true`|`false`만 허용,
  중첩 괄호·복수 statement 거부)을 별도 모듈에 새로 작성(import 아님,
  spec.md "결정 사항 2" 근거).
- eval/new Function/vm 등 실행 코드는 전혀 없음 — 정규식 매칭·캡처만 수행.
- `isSafeRawAttrValue`는 `^[\w-]{1,64}$` (data-* 속성값용, 길이 상한 64자).
- **의도적 수정(스펙 의사코드 대비)**: 스펙 의사코드의
  `SIMPLE_CALL_ARG = /^(?:(\d+)|['"]([\w-]+)['"]|(true|false))$/`를 그대로
  쓰면, 스펙 자체가 명시한 실측 검증 사례
  `view('322857', '200265', '', 'BMSR00044')`의 3번째 인자(빈 문자열
  `''`, catId 미사용)가 매칭 실패해 전체 함수 호출 파싱이 깨집니다(따옴표
  안 문자가 1개 이상이어야 하는 `+` 때문). 이는 단위 테스트 계획 1번
  ("catId 미사용 확인")과 정면으로 충돌합니다. 따라서 따옴표 인자 캡처
  그룹을 `[\w-]+` → `[\w-]{0,64}`로 바꿔 **빈 문자열은 허용하되 길이는
  64자로 상한**을 두었습니다(빈 값은 내용이 없으므로 안전 기준을
  약화시키지 않으며, 오히려 함수 호출 인자에도 결정 사항 2의 길이 상한
  취지를 동일하게 적용해 강화한 것입니다). `RAW_ATTR_VALUE`(data-* 속성값
  용)는 스펙 그대로 `^[\w-]{1,64}$` 유지.

## 2. `development/university-news/collectors/html-list-collector.js`

- 최상단에 `safe-onclick-call.js`에서 `parseSimpleFunctionCall`,
  `isSafeRawAttrValue`, `ALLOWED_DATA_ATTR_NAMES`를 require하는 줄 추가.
- `detailLinkFromValue` 함수 뒤에 `sameHost(urlString, source)`,
  `interpolateTemplate(template, values)`, `resolveJsDetailLink(rawValue,
  rule, source)` 3개 함수를 spec.md "구현 계획 2번" 의사코드대로 추가
  (`resolveJsDetailLink`는 매칭/검증 실패 시 `null` 대신 항상 `""`을
  반환하도록 통일 — 호출부가 항상 `!link`로 실패를 판정하므로 동작은
  동일하고 리턴 타입만 단순화).
- `htmlListCollector()` 내부 링크 조립 라인을 다음과 같이 교체:
  - `rawLinkValue`를 먼저 계산(기존과 동일한 방식).
  - `source.jsDetailLinkRule?.enabled === true`이면
    `resolveJsDetailLink(rawLinkValue, source.jsDetailLinkRule, source)`
    경로. 실패(빈 문자열) 시 `link = ""`로 두고 `warnings`에
    `jsDetailLinkRule 매칭/검증 실패로 항목 제외: <rawLinkValue>`를 추가
    (해당 항목만 제외, 소스 전체 실패 아님 — `normalizeCollectedItem`이
    빈 링크를 받아 "제목 또는 원문 링크가 없어 제외했습니다" 경고와 함께
    자연스럽게 항목을 드롭).
  - 그 외에는 기존과 동일하게 `detailLinkFromValue(rawLinkValue)`.
- `module.exports`에 `resolveJsDetailLink`를 추가. 기존 export
  (`htmlListCollector, findBySelector, textOf, attribute, cleanTitle,
  detailLinkFromValue`)는 그대로 유지.

## 3. `development/university-news/collectors/html-list-collector.test.js` (신규)

- `node:assert/strict` + `node:test` 스타일(기존
  `run-single-school-trial.test.js`, `link-risk-heuristics.test.js`와 동일)로
  14개 테스트 작성, 전부 통과.
- Positive 5개: 경희대 4-인자(catId 미사용 확인)/1-인자+fixedParams,
  전북대 `pf_DetailMove`, 경상국립대 `data-id`, 단국대 3-인자 중 arg0만
  사용 — 모두 `resolveJsDetailLink`를 네트워크 없이 직접 호출.
- Negative 9개: (6) `jsDetailLinkRule` 없음 회귀 — `htmlListCollector`를
  `fetchImpl` 주입으로 실행해 정적 href / `location.href=` 두 케이스 모두
  확인, (7) `enabled: false`가 필드 부재와 완전히 동일한 출력을 내는지
  `htmlListCollector` 두 번 실행 결과를 `deepEqual`로 비교, (8) 함수명
  불일치, (9) 인자 개수 불일치(초과/부족), (10) 안전하지 않은 인자(문자열
  연결, 변수/속성 참조, 공백/한글 포함), (11) 120자 불투명 토큰이
  dataAttribute·functionCall 양쪽 경로 모두에서 길이 상한으로 거부되는지,
  (12) 호스트 불일치, (13) 채워지지 않은 플레이스홀더(`{arg5}`,
  `{missingFixedParam}`), (14) 허용되지 않은 `data-*` 속성명.

## 4. `development/university-news/data/university-news-sources.final.json`

- `kyunghee-university-seoul` → `khu-official-news` 소스 블록의
  `"selectors": {}` 와 `"verified": false` 사이에 spec.md "예시 1"의
  `jsDetailLinkRule` 객체(실측 검증된 값 그대로)를 추가.
- 그 외 필드(`selectors`, `verified`, `enabled`, `listUrl`, `notes`,
  `status`, `healthStatus` 등)와 `jbnu-*`/`gnu-*`/`dankook-*` 블록은 전혀
  건드리지 않음. `grep -c jsDetailLinkRule` 결과 파일 전체에서 1건만 존재함을
  확인.

# 변경 이유

- 사용자가 확정한 spec.md 그대로 구현: "JS 전용 목록 링크"를 onclick
  실행 없이, 사람이 사전에 GET 동치성을 검증한 `urlTemplate`로만 안전하게
  조립하는 opt-in 엔진 제공.
- 질문사항 1 답변(②)에 따라 이번 라운드는 `khu-official-news` 1건만 JSON에
  반영하고, 전북대/경상국립대/단국대는 엔진·테스트만 범용 지원하고 JSON은
  건드리지 않음(실측 GET 검증 미완료, 추측 금지 원칙).
- 질문사항 2 답변에 따라 이번 범위는 "link 조립 엔진"만으로 좁게 유지,
  `khu-official-news`의 `selectors.item`/`title` 선택자 분석은 하지 않음.

# 미구현 항목

- `khu-official-news`(및 전북대/경상국립대/단국대)의 `selectors.item`/
  `selectors.title` 등 선택자 분석 — spec.md에서 명시적으로 이번 범위 밖
  (별도 후속 라운드).
- 전북대/경상국립대/단국대 3개 소스의 `jsDetailLinkRule` JSON 반영 —
  실측 GET 검증이 완료되지 않아 이번 라운드에 보류(spec.md "결정 사항 5",
  질문사항 1 답변 ②).
- (권장, 선택 항목) `validate-news-source.js`에
  `jsDetailLinkRule.enabled === true`인데 `verification.notes`가 비어있으면
  오류를 내는 정적 검사 — spec.md에서 "이번 계획의 필수 항목은 아님"으로
  명시되어 시간 관계상 이번 라운드에서는 추가하지 않음.

# 참고사항

## `node --check`

```
node --check development/university-news/utils/safe-onclick-call.js   -> OK
node --check development/university-news/collectors/html-list-collector.js -> OK
node --check development/university-news/collectors/html-list-collector.test.js -> OK
```

## `node --test development/university-news/collectors/html-list-collector.test.js`

14/14 전부 통과 (`pass 14, fail 0`).

## `npm test` (전체 스위트)

`tests 165, pass 165, fail 0, cancelled 0`. 기존 테스트 전부 통과, 회귀
없음(신규 14개 포함 총 165개 = 기존 151개 + 신규 14개).

## JSON diff 확인

- `node -e "JSON.parse(...)"` 파싱 성공.
- `grep -c "jsDetailLinkRule" university-news-sources.final.json` → `1`
  (khu-official-news 블록에만 존재, jbnu/gnu/dankook 블록은 미변경 확인).
- `git diff`로 확인한 결과, 이 파일에는 이번 작업과 무관한 다른 대학
  블록들의 기존 미커밋 변경분(예: 부산대 `pnu-main-notice`의 `enabled`,
  `selectors`, `detailSelectors` 등)이 이미 섞여 있었음(작업 시작 전부터
  존재, 이번 세션에서 손대지 않음). `khu-official-news` 블록 안에서는
  `jsDetailLinkRule` 객체 추가 외에 다른 라인 변경이 없음을 직접
  `git diff`로 확인.
- `source.enabled`(최상위)는 여전히 `false`.

## `--diagnose --limit=3` 실행 결과 (있는 그대로)

```
node server/agent/tools/run-single-school-trial.js --university-id=kyunghee-university-seoul --source-id=khu-official-news --diagnose --limit=3
```

출력:
```
[single-school-trial] No verified official RSS/HTML source with id "khu-official-news" exists for kyunghee-university-seoul.
```

**해석**: spec.md가 사전에 예상한 실패 지점(`status: "selector_required"`)
보다도 더 이른 단계에서 막혔습니다. `run-single-school-trial.js`의
`selectSource()`가 `entry.verified === true`인 소스만 후보로 인정하는데,
`khu-official-news`는 `"verified": false`이기 때문입니다(spec.md "확인된
사실 1"에 이미 문서화된 상태 그대로 — 경희대는 `verified: false`,
전북대/경상국립대/단국대는 `verified: true`이지만 `selector_required`).
지시사항에 따라 `verified`/`enabled` 등 다른 필드는 건드리지 않았으므로
이 결과는 있는 그대로 보고합니다.

이 결과는 **`jsDetailLinkRule` 엔진 자체의 결함이 아닙니다.** 엔진의 정상
동작(4개 실사례 패턴 조립, 9가지 안전장치)은 위 14개 단위 테스트로 이미
증명되었습니다. "실사이트 diagnose 3/3 통과"는 (a) `khu-official-news`의
`verified: true` 전환 및 (b) `selectors.item`/`title` 선택자 분석이 모두
완료된 뒤의 별도 후속 라운드 완료 기준으로 남습니다(spec.md "예외 상황"/
"완료 기준" 참고).

## 코드 리뷰 확인

- `safe-onclick-call.js`, `html-list-collector.js` 어디에도 `eval(`,
  `new Function(`, `require("vm")`/`require('vm')` 등 onclick을 실행하는
  코드가 없음을 직접 확인(grep 결과 없음).
- `server/agent/screening/link-risk-heuristics.js`, `server/agent/collector.js`,
  `server/agent/tools/run-single-school-trial.js`,
  `development/university-news/utils/resolve-url.js`,
  `development/university-news/collectors/normalize-collected-item.js`는
  이번 세션에서 전혀 수정하지 않음(`git status`/`git diff` 대상에 없음).
- `jbnu-*`/`gnu-*`/`dankook-*` 소스 JSON 블록도 전혀 수정하지 않음.
- git add/commit/push, 배포, preview 생성 중 어느 것도 수행하지 않음.
