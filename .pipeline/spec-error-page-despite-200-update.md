# 목표

경상국립대 `gnu-official-press-releases` 사례(카탈로그 listUrl에 `bbsId` 누락 →
HTTP 200 + "유효하지 않은 요청입니다" 알림 페이지 반환 → 자동 선별 도구가
READY로 오분류)를 반영해, HTTP 200이지만 실제로는 오류 안내 페이지인 응답을
HOLD로 잡아내는 계획을 수립한다. 이번 세션은 **계획만** 작성한다 — 콜렉터,
소스 JSON, `enabled`, 수집·저장, 프리뷰, 배포, git 작업은 하지 않는다.

# 원인

`server/agent/screening/list-url-accessibility.js`의 `classifyAccessibility()`는
HTTP status가 200대이면 `looksLikeLoginRedirect()`만 검사하고 그 외에는 곧장
`OK_200`을 반환한다. 응답 본문이 실제 게시판 목록이 아니라 "유효하지 않은
요청입니다" 같은 짧은 오류 안내(alert+`history.back()` 후 이동)여도 구분하지
못한다. 그 결과 `link-risk-heuristics.js`의 JS-only-link/SPA 휴리스틱도 앵커가
거의 없는 이 오류 페이지에서는 아무 위험 신호를 못 찾아 그대로 통과, 최종적으로
[규칙 11](로직상 마지막 fallback)에 걸려 READY가 된다.

# 변경 범위 (Coder 단계, 이번엔 미수행)

## 1. `server/agent/screening/list-url-accessibility.js`
- 새 분류값 `"ERROR_PAGE_DESPITE_200"`을 반환 가능한 상태로 추가.
- `looksLikeErrorPageDespite200(bodySample)` 함수 추가. 두 가지 신호를 OR로
  결합(전역적으로 통용되는 최소 신호만 사용):
  1. **구조적 신호(우선, 오탐 위험 낮음)**: `alert('...')` 호출 직후
     `history.back()`가 이어지는 "즉시 알림 후 뒤로가기" 패턴
     (`/alert\(\s*['"][^'"]*['"]\s*\)[\s\S]{0,80}?history\.back\(\)/i`).
     정상 뉴스 본문이 이런 스크립트를 페이지 전체 내용으로 담는 경우는 사실상
     없어 안전한 신호다(경상국립대 실제 오류 HTML이 정확히 이 형태).
  2. **문구 신호(보조, 과탐지 방지 위해 길이 제한 병행)**: 응답 본문이
     짧을 때(예: 3,000자 이하)만 아래 세 문구 중 하나가 있으면 오류 페이지로
     간주 — `유효하지 않은 요청`, `잘못된 요청`, `페이지를 찾을 수 없습니다`.
     문구만으로는 우연히 같은 표현이 들어간 긴 뉴스 기사를 오판할 수 있어,
     반드시 "본문이 짧다"는 조건과 함께 사용한다(요구사항 "일반 뉴스 본문에
     우연히 같은 문구가 들어간 경우를 과도하게 차단하지 않기"의 핵심 방어선).
- `classifyAccessibility()`의 200번대 분기에서 `looksLikeLoginRedirect()` 다음
  순서로 `looksLikeErrorPageDespite200()`을 검사(로그인 리다이렉트가 더
  구체적인 신호이므로 우선순위 유지), 해당되면 `"ERROR_PAGE_DESPITE_200"` 반환.

## 2. `server/agent/screening/classify-selector-required-source.js`
- **기존 규칙 번호를 바꾸지 않는다.** 현재 [규칙 7]
  (`NOT_FOUND_404`/`OTHER_HTTP_ERROR` → HOLD)의 조건에
  `accessibility === "ERROR_PAGE_DESPITE_200"`을 추가하고, 사유 문구만 케이스별로
  분기한다(예: "HTTP 200이지만 응답 본문이 오류/잘못된 요청 안내 페이지로
  보입니다(listUrl 파라미터 누락 등 URL 자체 문제일 수 있음)"). 새 규칙 번호를
  따로 매기면 [규칙 8]~[규칙 11]을 전부 밀어야 하고 기존
  `classify-selector-required-source.test.js`의 "규칙 8"/"규칙 9"/"규칙
  10"/"규칙 11" 하드코딩 단언이 전부 깨지므로, 최소 변경 원칙에 따라 같은
  [규칙 7] 라벨을 공유하는 쪽을 선택한다.

# 회귀 테스트 계획

## `list-url-accessibility.test.js`
1. 경상국립대 실제 오류 HTML(조사 시 확보한 원문 그대로)을 `bodySample`로 주고
   `status: 200` → `classifyAccessibility()` 결과가 `"ERROR_PAGE_DESPITE_200"`인지
   검증.
2. **음성 테스트(과탐지 방지 확인)**: 정상 뉴스 기사 본문 안에 우연히 "페이지를
   찾을 수 없습니다"라는 문구가 포함되어 있지만 전체 본문이 김(3,000자 초과)
   fixture를 만들어 `"OK_200"`으로 남는지 검증.
3. 정상 목록 HTML(가천대 글로벌 패턴 등 기존 fixture 재사용) → 계속 `"OK_200"`.

## `classify-selector-required-source.test.js`
4. `accessibility: "ERROR_PAGE_DESPITE_200"` 증거를 넣었을 때 HOLD +
   reasons에 "규칙 7"이 포함되는지 검증(번호 유지 확인).
5. 기존 "규칙 7"(404/OTHER_HTTP_ERROR) 테스트가 그대로 통과하는지 재확인(회귀
   없음 확인).

## (선택) `screen-selector-required-sources.test.js`
6. 스텁 fetch로 `gnu-official-press-releases`의 실제 listUrl(`?mi=1070`, bbsId
   누락)과 실제 오류 HTML을 흉내 낸 스텁을 하나 추가해, 오케스트레이션 레벨에서
   HOLD로 떨어지는지 엔드투엔드로 확인(필수는 아니며, 위 4/5번으로 이미
   핵심 로직은 검증됨).

# 재스캔 확인 계획 (Tester 단계, 이번엔 미수행)

수정 반영 후 `npm run news:screen:selector-required`(쓰기 없음, 기본 모드)를
재실행해 `gyeongsang-national-university / gnu-official-press-releases`가
READY에서 HOLD로 바뀌는지, 그리고 이전에 정상 READY로 확인된 나머지 5건
(khu-official-news, pnu-main-notice, knu-general-notice, chosun-university-news,
konkuk-glocal-today-news)이 여전히 READY로 남아 있는지(회귀 없음) 읽기 전용으로
확인한다.

# 완료 기준

- [ ] `ERROR_PAGE_DESPITE_200` 판정이 (a) alert+history.back() 구조 신호,
      (b) "본문 짧음 + 3개 한정 문구" 신호 중 하나로만 트리거되고, 둘 다
      전역적으로 통용되는 신호이며 경상국립대 전용 하드코딩이 아니다.
- [ ] `classify-selector-required-source.js`의 규칙 번호가 기존과 동일하게
      유지된다(규칙 7 재사용, 재넘버링 없음).
- [ ] 경상국립대 실제 오류 HTML 회귀 테스트, 긴 뉴스 기사 속 우연한 문구
      음성 테스트가 추가된다.
- [ ] 기존 accessibility/rule 관련 테스트 전부(특히 규칙 7/8/9/10/11 하드코딩
      단언)가 그대로 통과한다.
- [ ] 재스캔에서 `gnu-official-press-releases`가 HOLD로 전환되고, 다른 5개
      기존 READY 소스는 그대로 READY로 남는지 확인하는 절차가 명시되어 있다.
- [ ] 이번 세션에서 `list-url-accessibility.js`,
      `classify-selector-required-source.js`, 콜렉터, 소스 JSON, `enabled`,
      수집·저장·프리뷰·배포·git 어느 것도 변경하지 않았다.

사용자가 이 계획을 승인해야 Coder 단계(실제 코드 수정 + 테스트 추가)가
시작된다.
