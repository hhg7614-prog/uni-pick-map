# 목표

읽기 전용 자동 선별 도구(`server/agent/screening/link-risk-heuristics.js`의
`detectJsOnlyLinkRisk()`)가 단국대학교 죽전 `dankook-university-news`
패턴(`href="#none"` + `onclick="_dku_bbs_web_BbsPortlet_viewMessage(181003, true, false)"`)을
놓치고 READY로 잘못 분류한 문제를 보완하는 계획. 이번 세션은 **계획만** 작성한다
— 콜렉터, JSON 카탈로그, `enabled`, 수집·저장, 배포, git 작업은 하지 않는다.

# 원인 (코드 레벨)

`detectJsOnlyLinkRisk()`는 `JS_ONLY_HREF = /^\s*javascript\s*:/i`로 먼저
"js-only 후보"를 걸러낸 뒤에만 그 안에서 `data-url`/`data-param` 패턴이나
`onclick="functionName(id)"` 반복 패턴을 검사한다. 단국대 앵커는
`href="#none"`이라 이 첫 게이트(`JS_ONLY_HREF.test(anchor.href)`)를 통과하지
못해 `jsOnlyAnchors` 자체가 비어버리고, 이미 구현되어 있는 `onclick(id)-call
반복 검사` 로직까지 도달하지 못한 채 `detected: false`(READY)로 끝난다.
즉 **반복 감지 로직 자체는 이미 정확하고 안전(JBNU 사례로 검증됨)** —
문제는 진입 게이트가 `javascript:` 접두사만 인정한다는 점뿐이다.

# 변경 범위 (Coder 단계에서 수행할 것, 이번엔 미수행)

파일: `server/agent/screening/link-risk-heuristics.js` 단 하나.

1. `JS_ONLY_HREF` 판정을 감싸는 `isNonNavigatingHref(href)` 헬퍼를 추가해
   아래 둘 중 하나면 true를 반환하도록 게이트를 넓힌다.
   - 기존: `javascript:`로 시작
   - 추가: trim + 소문자 변환한 값이 **정확히** `"#"` 또는 `"#none"`인 경우
     (접두사/부분일치 아님 — `href="#section"`, `href="#top"` 같은 일반
     페이지 내 앵커는 그대로 통과시키지 않아야 하므로 반드시 완전 일치로
     제한한다).
2. `detectJsOnlyLinkRisk()` 내부의 `jsOnlyAnchors` 필터를 `JS_ONLY_HREF.test(...)`
   대신 `isNonNavigatingHref(anchor.href)`로 교체한다. 그 아래
   `jsOnlyWithDataAttrs`/`jsOnlyWithIdCallOnclick`/`dominant`/`dataAttrRepeated`/
   `onclickIdCallRepeated` 로직은 **변경 불필요** — 이미 "같은 함수명 + 서로
   다른 인자 조합이 2개 이상일 때만 반복 신호로 인정"하는 안전장치
   (`onclickIdCallRepeated`)와 "인자 없는 호출/동일 인자 반복은 무시"하는
   안전장치(`parseIdLikeOnclickCall`의 zero-arg 제외, `argsSet.size >= 2`
   조건)를 갖추고 있어 요구사항의 "같은 함수명에서 서로 다른 ID 인자가 2개
   이상 반복될 때만 HOLD 신호" 및 "단일 UI 버튼은 감지하지 않음"을 그대로
   만족한다. 게이트만 넓히면 단국대 패턴(같은 함수명, 목록당 10개의 서로
   다른 `messageId`)이 자동으로 `onclickIdCallRepeated: true`가 된다.
3. (선택, 부수 정합성 검토) `detectSpaRisk`/`scoreStaticHtmlLikelihood`의
   정적 앵커 카운트도 `href.trim() !== "#"`만 제외하고 `"#none"`은 아직
   제외하지 않는다. 이번 요구사항 범위(JS-only-link 휴리스틱)는 아니지만,
   Coder 단계에서 동일한 `isNonNavigatingHref()` 헬퍼로 통일할지 여부를
   확인하고 필요 시 별도로 처리한다(이번 계획의 필수 항목은 아님).

# 회귀 테스트 계획 (`server/agent/screening/link-risk-heuristics.test.js`)

1. **단국대 fixture(양성)**: 실제 조사에서 확보한 마크업 그대로
   `href="#none" onclick="_dku_bbs_web_BbsPortlet_viewMessage(181003, true, false)"`
   앵커를 서로 다른 `messageId`로 최소 3개 이상 반복 배치한 HTML을 넣고
   `detected === true`, `onclickIdCallRepeated === true`를 검증한다.
2. **일반 인앵커 음성 테스트**: `href="#section"`, `href="#top"` 같은 페이지 내
   앵커만 있는 HTML에서 `detected === false`임을 검증(요구사항 "일반적인
   페이지 내 앵커는 감지하지 않음").
3. **단일 UI 버튼 음성 테스트**: `href="#none"` + 동일 함수를 인자 없이 또는
   동일 인자로 1회만 호출하는 앵커(예: 로그인 버튼 1개)만 있을 때
   `detected === false`임을 검증(요구사항 "단일 UI 버튼은 감지하지 않음").
4. 기존 SNUE(`javascript:`+`data-url`)·JBNU(`javascript:`+`onclick(id)`)
   회귀 테스트는 그대로 유지해 게이트 확장이 기존 판정을 깨지 않는지 확인.

# 재스캔 확인 계획 (Tester 단계, 이번엔 미수행)

수정 반영 후 `node server/agent/tools/screen-selector-required-sources.js`를
**기본(쓰기 없는) 모드로** 재실행해, 아래 4개 `selector_required` 소스가
모두 HOLD(JS-only-link risk)로 재분류되는지 읽기 전용으로 확인한다. 넷 다
동일 CMS(`_dku_bbs_web_BbsPortlet`)를 쓰는 단국대 죽전/천안 소스라 같은
문제를 공유할 가능성이 높다.

- `dankook-university-jukjeon` / `dankook-university-news`
- `dankook-university-jukjeon` / `dankook-university-general-notice`
- `dankook-university-제2캠퍼` / `dankook-cheonan-university-news`
- `dankook-university-제2캠퍼` / `dankook-cheonan-general-notice`

# 완료 기준

- [ ] `isNonNavigatingHref()` 헬퍼가 `javascript:` 접두사와 `#`/`#none`
      완전 일치만 인정하고 `#section` 같은 부분 일치는 배제한다.
- [ ] 기존 반복 감지(`onclickIdCallRepeated`)/단일 버튼 배제 로직은 손대지
      않고 게이트만 넓힌다.
- [ ] 단국대 fixture 회귀 테스트, 일반 인앵커 음성 테스트, 단일 버튼 음성
      테스트가 모두 추가된다.
- [ ] 기존 SNUE/JBNU 회귀 테스트가 계속 통과한다.
- [ ] 재스캔에서 단국대 죽전/천안 4개 소스가 HOLD로 나오는지 읽기 전용으로
      확인하는 절차가 명시되어 있다.
- [ ] 이번 세션에서 `link-risk-heuristics.js`, JSON 카탈로그, `enabled`,
      수집·저장·배포·git 어느 것도 변경하지 않았다.

사용자가 이 계획을 승인해야 Coder 단계(`link-risk-heuristics.js` 실제 수정 +
테스트 추가)가 시작된다.
