# 검토 요약

Nara Info CMS 계열 대학 게시판 RSS가 내보내는 잘못된 상세 링크
(`.../artclView?layout=unknown` — `.do` 누락 + 가짜 쿼리스트링)를 수집 단계에서
`.../artclView.do`로 정규화하는 작업.

- 제품 파일 변경: `development/university-news/collectors/rss-collector.js` 1개 (+8 라인)
  - 순수 함수 `normalizeDetailLink(value)` 신규 (주석 2줄 + 본문 1줄)
  - `linkValue` 반환문 1줄을 `normalizeDetailLink(...)`로 감쌈
- 테스트: `rss-collector.test.js`에 신규 4개(nara-1..nara-4), 기존 5개 무변경
- 그 외 제품 파일 무변경, `module.exports = { rssCollector };` 무변경
- 파이프라인 기록(`.pipeline/spec.md`, `changes.md`, `test-results.md`)만 추가 수정

실제 diff와 spec 확정안이 문자 단위로 일치함을 확인했다.

# 요구사항 확인

## 사용자 최초 요구사항
- Nara CMS RSS의 잘못된 상세 링크를 수집 단계에서 정상 URL로 교정 → 충족.
  라이브 스모크(`inu.ac.kr/bbs/inu/2594/rssList.do`)에서 5개 아이템 전부
  `/artclView.do`로 끝나고 `?` 없음 확인.

## spec.md 필수 요구사항 1~6
1. `normalizeDetailLink(value)` 순수 함수 추가 — 충족 (rss-collector.js:25-27)
2. 변형 금지 대상(이미 `.do`, 다른 경로 절대 URL, 비-http, 무관 도메인) — 정규식
   `$` 앵커 + `.do` 뒤 문자 불일치로 자동 충족. nara-3/nara-4 테스트로 확인.
3. `linkValue` 두 경로(`<link href>` 속성 + `tagValue` 폴백) 모두 정규화 —
   단일 지점 wrap으로 충족. nara-2(속성) + nara-1(폴백) 테스트로 양쪽 경로 검증.
4. `rssCollector` 반환 계약 `{ status, items, warnings, finalUrl }` / `skipped` 분기
   `{ status, items, warnings }` — 무변경 (rss-collector.js:40, 60). "return shape" 테스트 통과.
5. `module.exports = { rssCollector };` 무변경, `normalizeDetailLink` 미export — 충족 (rss-collector.js:63)
6. `decodeXml`/`tagValue`/`extractEntries`/`normalize-collected-item.js`/`resolve-url.js`
   무변경 — git diff로 확인, `rss-collector.js` 외 제품 파일 변경 없음.

## 완료 기준(9개) 체크리스트
- [x] 1. 변경이 `rss-collector.js` 1개 제품 파일로 한정, 신규 함수 + 1줄 배선
- [x] 2. 순수 함수 + 확정 정규식 `/(\/artcl[Vv]iew)(\?[^#]*)?$/` 문자 그대로 사용
- [x] 3. `linkValue` 두 경로 모두 `normalizeDetailLink` 통과
- [x] 4. 반환 계약 불변, `module.exports` 불변
- [x] 5. 신규 테스트 nara-1..nara-4 추가, 4개 전부 통과
- [x] 6. 기존 5개 테스트 통과(회귀 0)
- [x] 7. `node --check` x2 OK / 타깃 9 pass 0 fail / `npm test` 309 pass 0 fail /
       라이브 스모크 성공(네트워크 가능, 픽스처 대체 불필요)
- [x] 8. `.env`/토큰/자격증명 미포함 (변경 파일·기록에 비밀정보 없음)
- [x] 9. push/deploy/production 데이터 변경 없음, 커밋은 추후 `main`에서

## AGENTS.md 4·5절
- 4절: 절대경로 명시, 전체 파일 열람, 최소 변경, `node --check` 검증, 핸드오프 기록 — 준수
- 5절: `node --check` + 타깃 테스트 + collector 변경이므로 `npm test` 실행 — 준수.
  실패 은폐 없음. 데이터/소스/배포 변경 아님.

# 테스트 결과

- `node --check` (rss-collector.js, rss-collector.test.js): 둘 다 OK
- `node --test rss-collector.test.js`: 9 pass / 0 fail (기존 5 + 신규 4)
- `npm test`: 309 pass / 0 fail / 0 skipped, 2회 실행 동일(결정적). baseline 305 + 4 = 309
- 라이브 스모크(inu.ac.kr): items 5개, 전부 `/artclView.do`로 끝남, `?` 없음

Tester 판정 PASS를 재확인함. 결과 신뢰 가능.

# 문제점

차단·보완이 필요한 문제 없음. 아래는 잔여 리스크(모두 spec에서 수용했거나 경미):

1. (수용됨) 프래그먼트 포함 링크 `/artclView?x=1#frag`는 `$` 앵커로 매칭 실패 →
   정규화 안 됨. 실제 Nara RSS `<link>`에 프래그먼트 없음. spec 명시 범위 제외.
2. (수용됨) 소문자 `/artclview`도 매칭되어 `/artclview.do`로 재작성(대소문자 보존).
   전용 테스트는 없음. Nara 서버가 대소문자 무시 라우팅이라 무해. 향후 픽스처 추가 권장.
3. (경미) 정규식은 경로 suffix `/artclView`만 보고 도메인을 구분하지 않는다. 즉
   무관 도메인이라도 경로가 `/artclView` 또는 `/artclView?...`로 끝나면 `.do`가 붙는다.
   nara-4 테스트는 `/atom/entry/1`(artclView 없음)이라 이 경계를 직접 커버하지 않는다.
   그러나 `/artclView` 경로 세그먼트는 Nara CMS 고유 패턴이고 spec이 이 정규식을
   확정했으므로 수용. 실무상 오탐 가능성 극히 낮음.
4. 정규식 안전성: `(\?[^#]*)?$` — 부정 문자클래스 단일 `*`, 중첩 수량자 없음,
   `$` 앵커. catastrophic backtracking 없음. `.do`로 끝나는 링크에 대한 오탐 없음
   (`artclView` 뒤에 `.do`가 오면 `?`도 `$`도 아니므로 불일치). 확인 완료.
5. (범위 외) 현재 `main`이 `origin/main`보다 1커밋 앞서 있음(b35ba69, 이번 작업과
   무관한 온보딩 문서 커밋). 이번 변경과 무관하나 push 시 함께 올라감을 인지할 것.
6. 요청하지 않은 변경 없음. 파이프라인 기록 3개 외 추가 수정 파일 없음.

# 최종 판정
승인

# 판정 이유

- spec.md 필수 요구사항 1~6과 완료 기준 9개 항목을 실제 코드/테스트/실행 로그로
  전부 확인했다. diff가 확정안과 문자 단위로 일치한다.
- 변경이 제품 파일 1개(`rss-collector.js`, +8라인)로 엄격히 한정되고, export
  shape와 반환 계약이 불변이다. 요청하지 않은 변경이 없다.
- 정규식은 정확하고 안전하다(오탐 없음, backtracking 없음). 잔여 한계는 모두
  spec이 명시적으로 수용한 항목이다.
- 신규 4개 테스트가 속성 경로와 폴백 경로, 그리고 pass-through 케이스를 모두
  실질적으로 검증한다. 전체 스위트 309 pass 2회 결정적, 라이브 스모크도 실서버로
  교정 동작을 확인했다.
- robots/gate/activation/카탈로그/프로덕션 데이터 변경 없음. 커밋·푸시·배포 없음.
- AGENTS.md 4·5·6절 프로토콜 준수.

배포(커밋) 가능한 상태다. 단, 커밋은 사용자가 명시적으로 요청할 때만 수행한다.

## 권장 커밋 (사용자 요청 시에만, 현재 `main`에서)

선례(`becfd2d docs(pipeline): ...`)에 따라 코드 커밋과 파이프라인 기록 커밋을
분리 권장.

### 커밋 1 — 코드 수정
`git add` 대상 (정확히 이 2개):
```
git add development/university-news/collectors/rss-collector.js
git add development/university-news/collectors/rss-collector.test.js
```
커밋 메시지:
```
fix(rss-collector): Nara CMS artclView 링크에 .do 접미사 보정

Nara Info CMS 계열 대학 게시판 RSS의 <link>가 .do 없이 가짜 쿼리스트링이
붙은 상세 URL(.../artclView?layout=unknown)을 내보내 온보딩 상세 검증이
실패하는 문제를 수집 단계(resolveUrl 이전)에서 교정한다.

- normalizeDetailLink(value) 순수 함수 추가: /(\/artcl[Vv]iew)(\?[^#]*)?$/ → $1.do
- linkValue의 두 경로(<link href> 속성, tagValue 폴백)를 단일 지점에서 wrap
- 반환 계약 { status, items, warnings, finalUrl } 및 module.exports 불변
- 신규 테스트 4개(nara-1..nara-4), 타깃 9 pass / 전체 309 pass, 회귀 0
- 라이브 스모크(inu.ac.kr): 5개 아이템 전부 /artclView.do로 정규화 확인

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018xL7sjPuyqD63j9fxyCvp2
```

### 커밋 2 — 파이프라인 기록
`git add` 대상:
```
git add .pipeline/spec.md .pipeline/changes.md .pipeline/test-results.md .pipeline/review.md
```
커밋 메시지:
```
docs(pipeline): rss-collector Nara artclView 링크 보정 라운드 기록 (spec/changes/test-results/review)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018xL7sjPuyqD63j9fxyCvp2
```

(두 커밋을 하나로 합쳐도 무방하나, 코드와 문서를 나누면 되돌리기가 쉽다.
어느 쪽이든 push/deploy는 사용자 명시 요청 시에만.)
