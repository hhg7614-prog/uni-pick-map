# 검토 요약

`development/university-news/collectors/rss-collector.js` 의 `tagValue()` 가
`<![CDATA[...]]>` 로 감싼 `<title>` / `<link>` 를 통째로 삼켜 한국 대학 CMS RSS(uos 등)
항목이 전량 탈락하던 버그 수정 건을 종합 검토했다.

- 코드 변경: `tagValue()` 내부 `if (match)` 분기 1곳 (1줄 → 7줄). CDATA 언랩 →
  잔여 태그 제거 → `decodeXml` 순으로 순서 교체.
- 신규 테스트: `rss-collector.test.js` 5개 (a/b/c/d 픽스처 + 반환 계약).
- `npm test` 3회 연속 305/305/0, baseline 300 대비 정확히 +5.
- 변경 범위: 대상 2개 파일 + 파이프라인 문서(`.pipeline/*.md`)만. 제품 코드 타 파일,
  게이트/robots/활성화/프로덕션 데이터 무변경. 커밋/푸시 미실행.
- 현재 브랜치 `feat/onboarding-gate-bridges` (HEAD `a2d3cf1`) — spec 지정 대상 브랜치와 일치.
  세션 시작 스냅샷의 `main` 표기는 낡은 정보이며 spec 질문사항 1은 사실상 해소됨.

# 요구사항 확인

## 최초 요구사항 (CDATA 파싱 버그 수정)
충족. `tagValue()` 가 CDATA 를 먼저 벗기므로 `>` 없는 CDATA 블록이 태그로 오인되어
삭제되던 문제가 해결된다. bare text 소스 회귀 없음.

## spec 필수 요구사항 1~8
- 1 (CDATA 먼저 → 잔여 태그 → decodeXml 순서 교체): 충족. 코드 12-18행.
- 2 (CDATA 감싼 title/link 값 보존): 충족. 테스트 (a) green, 직접 분석 확인.
- 3 (bare text 회귀 없음): 충족. 언랩 정규식 미매칭 → 기존 경로 동일. 테스트 (b) green.
- 4 (Atom `<link href>` 는 `linkValue()` 에서 선처리): 충족. `linkValue()` 무변경,
  속성 분기가 `tagValue()` 진입 전. 테스트 (c) green.
- 5 (description CDATA 내부 HTML 제거 유지): 충족. 언랩 후 `<[^>]*>` 제거가 그대로 동작.
  테스트 (a) summary, (d) green.
- 6 (`rssCollector()` export/반환 계약 불변): 충족. `module.exports` 무변경,
  반환 `{status, items, warnings, finalUrl}` 유지. 반환 계약 테스트 green.
- 7 (신규 테스트 파일, 네트워크 없이 fetchImpl 주입): 충족. spec 은 4개 픽스처를 요구했고
  구현은 5개(4 픽스처 + 반환 계약). 초과분은 계약 확인용으로 범위 내.
- 8 (`node --check` + `npm test` 통과): 충족. Coder/Tester 양측 확인.

## spec 하지 말 것
위반 없음. `decodeXml` 시그니처/동작 불변, 타 제품 코드 무수정, 배포/푸시 없음,
범위 밖 기능 추가 없음.

# 완료 기준

| # | 기준 | 판정 | 근거 |
|---|------|------|------|
| 1 | 변경이 `tagValue()` 1곳, diff 최소, `node --check` 통과 | 충족 | `git diff` 상 `tagValue()` 블록만 변경. 나머지 함수/exports 무변경 |
| 2 | (a)(b)(c)(d) 픽스처 + 기대 단언이 명세와 일치 | 충족 | 테스트 파일 48-184행, 각 단언이 spec 130-210 과 일치 |
| 3 | `node --test rss-collector.test.js` 전부 green | 충족 | 5/5 pass |
| 4 | `npm test` 전체 green, 회귀 없음 | 충족 | 3회 연속 305/305/0, baseline 300 → +5 |
| 5 | (a) 가 "수정 전 0 / 수정 후 1" 증명 | 충족(경미) | 42-45행 회귀 방지 주석 존재(spec 이 주석 허용). 수정 되돌리면 (a) 실패 → 회귀 가드 유효. 단 구 로직 대조 단언은 없음 |
| 6 | (b)/gnu 형태 수정 후 정상 추출 증명 | 충족 | 테스트 (b) green, gnu 실제 rssUrl/baseUrl 스텁 사용 |
| 7 | 네트워크 실측 회복 확인 (차단 시 명시) | 충족 | 실측 미실행, changes/test-results 에 "픽스처로 대체" 명시. spec 확정사항 3 및 완료 기준 7이 허용 |
| 8 | 반환 형태·export 불변, `collector.js`/`collector-factory.js` 무수정 | 충족 | `git status` 상 `server/agent/collector.js` 무변경. `collector-factory.js` 는 저장소에 부재(spec 명칭 오류) |
| 9 | 프로덕션 데이터·게이트·robots 무변경, push/배포 미실행 | 충족 | `git status` 로 확인. 변경은 대상 2파일 + `.pipeline/*.md` 뿐 |

# 테스트 결과

- 타깃: `node --test rss-collector.test.js` → 5 tests / 5 pass / 0 fail.
- 전체: `npm test` → 305 / 305 / 0, 3회 연속 결정적 통과. baseline 300 대비 신규 5개.
- `node --check` : 수정 파일 + 신규 테스트 파일 모두 OK.
- 수정의 정확성 (Reviewer 코드 재분석):
  - (a) CDATA title `<![CDATA[...]]>` → 언랩 → 잔여 태그 없음 → `decodeXml` trim → 값 보존. OK.
  - (a) CDATA link 절대 URL → `resolveUrl` 통과. OK.
  - (b) bare text + `&amp;` → 언랩 미매칭 → `decodeXml` 이 `&amp;`→`&`. 회귀 없음. OK.
  - (c) Atom `<link href>` → `linkValue()` 속성 정규식이 선처리, `tagValue()` 미도달. OK.
  - (d) description CDATA 내부 `<p style>`/`<a href>` → 언랩 후 `<[^>]*>` 제거 → 평문. OK.
  - 엣지: CDATA 내부 `>` 포함(`<b>강조</b>`) → non-greedy `[\s\S]*?` 가 `]]>` 까지 매칭 후
    내부 태그는 다음 단계에서 제거됨. 안전.
  - 엣지: 닫는 `]]>` 없는 깨진 CDATA → 언랩 정규식 미매칭 → 기존 `<[^>]*>` 폴백.
    해당 항목만 탈락, 소스 전체 실패 아님. 기존 동작과 동급.
  - 다중 CDATA: `/g` 플래그로 각각 처리. 중첩 CDATA 는 XML 상 불가.

# 문제점

경미 사항만 존재하며 배포 차단 요소는 없음.

1. (경미, 정보성) 테스트 (a) 는 수정 후 동작만 단언하고, 구 로직을 복제한 대조 단언은
   없다. spec 완료 기준 5의 문구("주석 또는 별도 단언")는 주석으로 충족하며, 수정을
   되돌리면 (a) 가 실패하므로 회귀 가드로서 유효하다. 보완 필요 수준 아님. 향후 강화 여지.
2. (경미) 네트워크 실측(uos `allBoard.do` 0→회복, gnu RSS 2개 정상 유지) 미실행.
   spec 확정사항 3 및 완료 기준 7이 명시적으로 허용한 결정이므로 sign-off 차단 아님.
   다만 이 소스들을 실제 수집 활성화하기 전 네트워크 가능 환경에서 spec 3단계 4번
   스모크 명령으로 1회 확인 권장.
3. (경미, 문서) spec 이 `server/agent/collector-factory.js` 를 불변 대상으로 명시하나
   해당 파일은 저장소에 없다. 실제 호출부는 `server/agent/collector.js` 뿐이며 무변경.
   제품에 영향 없음.
4. (경미, 문서) 실제 uos RSS 의 CDATA `<title>` 에 개행/HTML 이 섞인 변형은 픽스처가
   대표형(순수 텍스트 CDATA)만 커버. CDATA-내부-`>` 케이스는 Tester 수동 확인으로 통과.
5. (절차) `.pipeline/spec.md` / `changes.md` / `test-results.md` 가 함께 수정됨.
   제품 코드와 무관한 파이프라인 산출물이므로 커밋에 포함 가능. `.pipeline/merge-analysis.md`
   는 이번 작업과 무관하므로 스테이징에서 제외해야 함.

# 최종 판정
승인

# 판정 이유

수정의 방향과 구현이 정확하다. `tagValue()` 에서 CDATA 를 먼저 언랩한 뒤 잔여 태그를
제거하고 `decodeXml` 을 적용하는 순서 교체는 버그의 근본 원인(`>` 없는 CDATA 블록이
`/<[^>]*>/` 에 통째로 매칭)을 정확히 해소하며, 코드 재분석 결과 (a) CDATA title/link 보존,
(b) bare text 무회귀, (c) Atom `<link href>` 무영향, (d) description 내부 HTML 제거 유지가
모두 성립한다. non-greedy CDATA 언랩과 깨진 `]]>` 폴백 등 엣지 케이스도 안전하다.

변경 범위가 `tagValue()` 1곳으로 엄격히 한정되고 `decodeXml`/`linkValue`/`extractEntries`/
`rssCollector` 및 타 제품 코드가 불변이며, 반환 계약 `{status, items, warnings, finalUrl}`
과 export 시그니처가 유지된다. 게이트/robots/활성화/프로덕션 데이터 변경이 없고
push/배포도 실행되지 않았다.

`npm test` 305/305 가 3회 연속 결정적으로 통과하고 신규 5개 테스트가 명세 단언과
일치한다. 발견된 5건은 모두 경미(테스트 강화 여지, 네트워크 실측 보류, spec 문서상
파일명 오류, 픽스처 대표성, 커밋 스테이징 주의)하며 spec 이 명시적으로 허용했거나
구현 결함이 아니다. 완료 기준 9개 전부 충족.

## 커밋 권고

커밋해도 된다. 단 CLAUDE.md/AGENTS.md 원칙상 실제 커밋은 사용자의 명시적 지시가 있을
때만 진행한다.

- 대상 브랜치: 현재 체크아웃된 `feat/onboarding-gate-bridges` (spec 지정과 일치, 신규
  브랜치 생성 불필요).
- 커밋 수/타입: `fix` 타입 1커밋 적절.
- 스테이징: `development/university-news/collectors/rss-collector.js`,
  `development/university-news/collectors/rss-collector.test.js`,
  `.pipeline/spec.md`, `.pipeline/changes.md`, `.pipeline/test-results.md`, `.pipeline/review.md`.
  `.pipeline/merge-analysis.md` 는 제외.
- 커밋 메시지 초안(spec 안 그대로, 저장소 트레일러 포함):

  ```
  fix(university-news): rss-collector tagValue가 CDATA title/link를 삼키는 버그 수정

  - tagValue()에서 CDATA를 먼저 벗기고 잔여 태그 제거 후 decodeXml 적용하도록 순서 교체
  - 한글 대학 CMS RSS(uos 등) title/link가 빈 값이 되어 전량 탈락하던 문제 해결
  - CDATA 없는 bare text 소스(gnu 2개) 및 Atom <link href> 회귀 없음
  - rss-collector.test.js 추가: CDATA/bare/href-attr/description-HTML 4개 고정 픽스처

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```

- push/배포는 하지 않는다.
- 배포 후속: uos/gnu RSS 소스를 실제 수집 활성화하기 전 네트워크 스모크 1회 권장.
