# 테스트 요약

Nara Info CMS RSS `<link>` 정규화(`normalizeDetailLink`) 구현 검증.
전체 결과: **통과**. 완료 기준 9개 항목 전부 통과, 회귀 0, 라이브 스모크 성공.

실행 환경: Windows 11, `node --test`, repo root `D:\hhg(code)`, branch `main`.

---

# 실행한 명령과 결과

## 1. node --check (변경 파일 2개)

```
node --check "development/university-news/collectors/rss-collector.js"      -> JS OK
node --check "development/university-news/collectors/rss-collector.test.js" -> TEST OK
```

두 파일 모두 구문 오류 없음.

## 2. 타깃 테스트

```
node --test development/university-news/collectors/rss-collector.test.js
```

출력 요약:
```
✔ (a) CDATA-wrapped title and link (uos form) ...
✔ (b) bare text title and link (gnu form) ...
✔ (c) Atom <link href> attribute form ...
✔ (d) description CDATA with <p>/<a> HTML ...
✔ rssCollector() return shape is unchanged
✔ (nara-1) bare-text <link> Nara artclView is normalized to /artclView.do
✔ (nara-2) Atom <link href> Nara artclView is normalized to /artclView.do
✔ (nara-3) link already ending in .do is left unchanged
✔ (nara-4) unrelated absolute URL is left unchanged
ℹ tests 9  ℹ pass 9  ℹ fail 0
```
기대치(9 pass / 0 fail) 일치.

## 3. 전체 스위트 npm test (2회, 결정성 확인)

```
npm test   (= node --test)
```

- 1회차: `tests 309  pass 309  fail 0  cancelled 0  skipped 0  todo 0`  duration ~878ms
- 2회차: `tests 309  pass 309  fail 0  cancelled 0  skipped 0  todo 0`  duration ~910ms

작업 지시 기대치(309 pass, 0 fail, 0 regression) 일치. 이전 baseline 305 + 신규 4 = 309 확인.
2회 실행 결과 동일 -> 결정적.

## 4. 라이브 스모크 (네트워크 사용 가능)

```
node -e "rssCollector({... rssUrl:'https://www.inu.ac.kr/bbs/inu/2594/rssList.do' ..., limit:5})"
```

출력:
```
success 5 [
  'https://www.inu.ac.kr/bbs/inu/2594/429421/artclView.do',
  'https://www.inu.ac.kr/bbs/inu/2594/429340/artclView.do',
  'https://www.inu.ac.kr/bbs/inu/2594/429339/artclView.do',
  'https://www.inu.ac.kr/bbs/inu/2594/429337/artclView.do',
  'https://www.inu.ac.kr/bbs/inu/2594/429336/artclView.do'
]
```
`items.length` = 5 (> 0), 모든 `sourceUrl`이 `/artclView.do`로 끝남, 쿼리스트링(`?`) 없음.
실제 Nara RSS가 `.do` 없는 링크를 내보내는 상황이 정규화로 교정됨을 실서버로 확인.

## 5. 변경 범위 확인 (git status / git diff --stat)

```
modified:   .pipeline/changes.md        (파이프라인 기록, 정상)
modified:   .pipeline/spec.md           (파이프라인 기록, 정상)
modified:   development/university-news/collectors/rss-collector.js
modified:   development/university-news/collectors/rss-collector.test.js
```

`rss-collector.js` diff (전체):
- `normalizeDetailLink(value)` 함수 신규 추가 (주석 2줄 + 본문 1줄)
- `linkValue` 반환문 1줄을 `normalizeDetailLink(...)`로 감쌈
- 그 외 라인 무변경, `module.exports = { rssCollector };` 무변경

제품 파일 변경은 `rss-collector.js` 1개로 한정. `normalize-collected-item.js`, `resolve-url.js`,
`decodeXml`/`tagValue`/`extractEntries`/`rssCollector` 본문 무변경 확인.

---

# 완료 기준

- 기준 1 (변경이 rss-collector.js 1개 제품 파일로 한정, 신규 함수 + 1줄 배선, 그 외 무변경): **통과**
- 기준 2 (normalizeDetailLink 순수 함수, 확정 정규식 `/(\/artcl[Vv]iew)(\?[^#]*)?$/` 사용): **통과** — 코드 26행에서 정규식 문자 그대로 일치
- 기준 3 (linkValue의 두 경로 모두 normalizeDetailLink 통과): **통과** — 단일 지점 wrap, nara-1(폴백)·nara-2(속성) 테스트로 검증
- 기준 4 (rssCollector 반환 계약 `{ status, items, warnings, finalUrl }` 불변, module.exports `{ rssCollector }` 불변): **통과** — "return shape is unchanged" 테스트 + 코드 확인
- 기준 5 (신규 테스트 nara-1..nara-4 추가, 모두 통과): **통과** — 4개 전부 pass
- 기준 6 (기존 5개 테스트 전부 통과, 회귀 없음): **통과** — (a)(b)(c)(d) + return shape 테스트 pass
- 기준 7 (검증 결과 모두 green):
  - node --check rss-collector.js -> OK: **통과**
  - node --check rss-collector.test.js -> OK: **통과**
  - node --test 타깃 -> 9 pass 0 fail: **통과**
  - npm test 전체 -> 309 pass 0 fail, 회귀 0: **통과**
  - 라이브 스모크 -> items > 0, 모든 sourceUrl `/artclView.do`로 끝남: **통과** (네트워크 사용 가능, 픽스처 대체 불필요)
- 기준 8 (.env/토큰/자격증명이 코드·로그·기록에 미포함): **통과** — 변경 파일·본 기록에 비밀정보 없음
- 기준 9 (git push/deploy/production 데이터 변경 없음): **통과** — 커밋·푸시·배포 미수행, 워킹트리 변경만 존재

## AGENTS.md 5절 검증 규칙 대조

- JS 변경에 `node --check` + 타깃 테스트 실행: 완료
- collector 변경이므로 `npm test` 실행: 완료 (309 pass)
- 실패를 숨기지 않음: 실패 없음
- 데이터/소스 변경 아님 -> 소스/프리뷰 검증 대상 아님
- 배포 변경 아님 -> 배포 후 확인 대상 아님

---

# 실패한 테스트

없음. 타깃 9/9, 전체 309/309 통과.

---

# 재현 방법

```powershell
cd "D:\hhg(code)"
node --check "development\university-news\collectors\rss-collector.js"
node --check "development\university-news\collectors\rss-collector.test.js"
node --test development\university-news\collectors\rss-collector.test.js
npm test
node -e "const{rssCollector}=require('./development/university-news/collectors/rss-collector');rssCollector({university:{universityId:'inu',universityGroupId:'inu',universityName:'인천대학교'},source:{collectionType:'rss',id:'inu-test',name:'공지',category:'school_notice',categoryLabel:'학교 공지사항',rssUrl:'https://www.inu.ac.kr/bbs/inu/2594/rssList.do',baseUrl:'https://www.inu.ac.kr',datePolicy:{}},limit:5}).then(r=>console.log(r.status,r.items.length,r.items.map(i=>i.sourceUrl))).catch(e=>console.log('NET-SKIP',e.message))"
git diff --stat
```

---

# 위험 요소

- **spec 수용된 한계 (문제 아님, 인지용)**: 프래그먼트 포함 링크(`/artclView?x=1#frag`)는
  `$` 앵커로 매칭되지 않아 정규화 안 됨. spec에서 명시적으로 범위 제외.
- **소문자 `/artclview`**: `[Vv]iew`로 매칭되어 `/artclview.do`로 재작성됨(대소문자 보존).
  전용 테스트는 없으나 spec이 수용한 동작. Nara 서버가 대소문자 무시 라우팅이므로 무해.
  회귀 위험은 낮으나 향후 소문자 케이스 픽스처 추가를 권장.
- **`.pipeline/spec.md`, `.pipeline/changes.md`도 워킹트리에서 수정됨**: 파이프라인 기록으로
  정상이나, 커밋 시 제품 파일과 분리하거나 함께 커밋할지 Reviewer 판단 필요.
- **baseline 숫자**: 작업 지시의 "이전 305"는 이번 실행에서 직접 재현 불가(이미 신규
  테스트 포함 상태). 305 + 4 = 309 로 산술 일치하며 fail 0 이므로 회귀 없음으로 판단.
- **normalizeDetailLink 미export**: spec 결정사항(export shape 불변 우선). 단위 검증은
  `rssCollector` 경유 간접 수행. 향후 독립 단위테스트가 필요하면 spec 재논의 대상.

---

# 최종 테스트 상태

**통과**
