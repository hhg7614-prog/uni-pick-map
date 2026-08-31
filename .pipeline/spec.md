# 목표

Nara Info CMS 계열(수백 개 한국 대학) 게시판 RSS가 내보내는 잘못된 상세 링크
(`.do` 접미사 없음 + 가짜 쿼리스트링)를 수집 단계에서 정규화해서,
온보딩 상세 검증(`run-single-school-trial.js --diagnose`의 제목/대학명 매칭)이
통과할 수 있는 정상 URL(`.../artclView.do`)로 바로잡는다.

대상 파일은 `D:\hhg(code)\development\university-news\collectors\rss-collector.js`
단 하나이며, 변경은 최소로 한다.

# 요구사항

## 필수

1. `rss-collector.js`에 순수 함수 `normalizeDetailLink(value)`를 추가한다.
   - Nara CMS `artclView` 패턴에 매칭되면: 쿼리스트링을 제거하고 `.do`를 붙여
     `.../artclView.do` 형태로 재작성한다.
   - 매칭 패턴: 경로가 `/artclView` 또는 `/artclview`로 끝나고, 그 뒤에
     선택적으로 쿼리스트링(`?...`)만 오는 경우.
   - 확정 정규식: `/(\/artcl[Vv]iew)(\?[^#]*)?$/`
   - 확정 구현: `String(value || "").replace(/(\/artcl[Vv]iew)(\?[^#]*)?$/, "$1.do")`
   - 위 방식은 원본의 `View`/`view` 대소문자를 그대로 보존한다(캡처그룹 `$1` 재사용).
2. 다음 링크는 **절대 변형하지 않는다**(정규식이 매칭되지 않으므로 자동 충족):
   - 이미 `.do`로 끝나는 링크 (`.../selectNttInfo.do?nttSn=1`,
     `.../artclView.do`, `.../artclView.do?foo=1` 포함)
   - 다른 경로의 절대 URL (`https://news.example.ac.kr/atom/entry/1`)
   - `#`, `javascript:`, `mailto:`, `tel:` 등 비-http 값 (기존 `resolveUrl`가 처리)
   - 무관한 도메인 링크
3. `linkValue(xml)`의 반환값이 `normalizeDetailLink`를 거치도록 배선한다.
   - `<link href="...">` 속성 경로와 `tagValue(xml, ["link"])` 폴백 경로
     **둘 다** 정규화 대상이어야 한다. 즉 단일 지점에서 감싼다:
     `return normalizeDetailLink(attributeLink ? attributeLink[1] : tagValue(xml, ["link"]));`
4. `rssCollector`의 반환 계약은 정확히 `{ status, items, warnings, finalUrl }`
   (그리고 `skipped` 분기의 `{ status, items, warnings }`)로 **변경 없음**.
5. 모듈 export는 `module.exports = { rssCollector };` 그대로 **변경 없음**.
   - 결정: `normalizeDetailLink`는 **export 하지 않는다**. 단위 검증은
     `rssCollector`를 통해 간접적으로 수행한다(요구사항 5의 "export shape 불변"
     우선, 변경 최소화).
6. `decodeXml`, `tagValue`, `extractEntries`, `normalize-collected-item.js`,
   `resolve-url.js`, 그 외 제품 파일은 **건드리지 않는다**.

## 정규화 동작 상세(설계 확정 사항)

- 정규화는 `resolveUrl` 이전, 즉 원본 링크 문자열(상대경로 가능) 단계에서 일어난다.
  - 상대경로 예: `/bbs/inu/2594/429421/artclView?layout=unknown`
    → `normalizeDetailLink` → `/bbs/inu/2594/429421/artclView.do`
    → `resolveUrl(baseUrl)` → `https://www.inu.ac.kr/bbs/inu/2594/429421/artclView.do`
- 알려진 한계(수용): 링크가 `/artclView?x=1#frag`처럼 프래그먼트(`#`)까지
  포함하면 `$` 앵커 때문에 매칭되지 않아 정규화되지 않는다. 실제 Nara RSS
  `<link>`에는 프래그먼트가 없으므로 범위에서 제외한다.
- 빈 문자열/누락 입력: `String(value || "")` 가드로 `""` 반환(기존 동작과 동일,
  이후 `normalizeCollectedItem`이 "제목 또는 원문 링크가 없어 제외" 경고 처리).

# 파일

## 변경

- `D:\hhg(code)\development\university-news\collectors\rss-collector.js`
  - `normalizeDetailLink` 함수 신규 추가(예: `linkValue` 위 또는 아래).
  - `linkValue`의 `return` 문 1줄을 `normalizeDetailLink(...)`로 감싸도록 수정.
  - 그 외 라인 변경 없음. export 라인 변경 없음.

- `D:\hhg(code)\development\university-news\collectors\rss-collector.test.js`
  - 기존 5개 테스트 유지. 신규 테스트 4개 추가(아래 "구현 계획" 참고).
  - 기존 파일의 `node:test` + `fetchStub` + `makeSource` 패턴 재사용.

## 생성

- 없음.

## 파일 열람 명령(AGENTS.md 4절)

```powershell
Get-Content -Raw -LiteralPath "D:\hhg(code)\development\university-news\collectors\rss-collector.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js"
```

# 구현 계획

1. `rss-collector.js` 전체를 다시 읽는다(현재 58줄).
2. `normalizeDetailLink(value)` 함수를 추가한다.
   - 구현: `return String(value || "").replace(/(\/artcl[Vv]iew)(\?[^#]*)?$/, "$1.do");`
   - JSDoc 1줄 또는 짧은 한글 주석으로 "Nara Info CMS RSS `<link>` 보정" 명시.
3. `linkValue`의 반환문을 다음으로 교체한다:
   ```js
   function linkValue(xml) {
     const attributeLink = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
     return normalizeDetailLink(attributeLink ? attributeLink[1] : tagValue(xml, ["link"]));
   }
   ```
4. `node --check`로 구문 검증.
5. `rss-collector.test.js`에 신규 테스트 4개를 파일 하단에 추가한다.
   기존 테스트명이 `(a)~(d)`이므로 충돌을 피하려고 `nara-` 접두사를 쓴다.
   - **(nara-1) bare-text `<link>` Nara artclView 정규화**
     - `<item>` XML, `<link>https://www.inu.ac.kr/bbs/inu/2594/429421/artclView?layout=unknown</link>`
     - source: `rssUrl = https://www.inu.ac.kr/bbs/inu/2594/rssList.do`,
       `baseUrl = https://www.inu.ac.kr`
     - 기대: `result.items.length === 1`,
       `result.items[0].sourceUrl === "https://www.inu.ac.kr/bbs/inu/2594/429421/artclView.do"`,
       `result.items[0].sourceUrl.endsWith("/artclView.do") === true`,
       `result.items[0].sourceUrl.includes("?") === false`
   - **(nara-2) Atom `<link href>` 속성 경로도 정규화**
     - `<feed>`/`<entry>` XML, `<link href="https://www.inu.ac.kr/bbs/inu/2594/429999/artclView?layout=unknown" />`
     - 기대: `result.items[0].sourceUrl` 가 `/artclView.do`로 끝나고 `?` 없음.
     - 목적: 속성 경로와 폴백 경로 둘 다 감싸졌음을 보장.
   - **(nara-3) 이미 `.do`로 끝나는 링크는 불변**
     - `<link>https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=1</link>`
     - 기대: `result.items[0].sourceUrl === "https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=1"`
       (쿼리스트링 그대로 유지).
   - **(nara-4) 무관한 절대 URL은 불변**
     - Atom `<link href="https://news.example.ac.kr/atom/entry/1" />`
     - 기대: `result.items[0].sourceUrl === "https://news.example.ac.kr/atom/entry/1"`
6. 회귀 확인: 기존 uos(CDATA) 테스트와 gnu(bare-text) 테스트는 수정 없이 그대로
   통과해야 한다(요구사항 (d)). 별도 신규 테스트 불필요, 스위트 실행으로 확인.
7. `node --check` 두 파일 → 타깃 테스트 → 전체 `npm test` 순으로 검증.
8. `.pipeline/`에 Coder/Tester/Reviewer 기록 남김(ship 워크플로).

# 예외 상황

- **프래그먼트 포함 링크**: `/artclView?x=1#frag` 는 정규식 `$` 때문에 매칭 실패 →
  정규화되지 않음. 실제 Nara RSS에는 없음. 스펙상 수용.
- **대소문자 변형**: `/artclview`(소문자) 도 `[Vv]iew`로 매칭되어 `.do`가 붙되
  원본 대소문자는 보존된다(`/artclview.do`). 서버가 대소문자 무시 라우팅이므로 무해.
- **경로 중간에 `artclView`가 있고 끝이 아닌 경우**: `$` 앵커로 매칭 안 됨 → 불변.
- **빈 링크/링크 태그 없음**: `""` 반환 → 기존 로직대로 아이템 제외 + 경고.
- **네트워크 불가**: 라이브 스모크는 생략하고 픽스처로 대체한다(아래 검증 참고).
- **`node --test` 자동탐색 범위 변화 없음**: 새 파일을 만들지 않으므로 테스트 수만
  4개 증가.

# 완료 기준

1. 변경이 `rss-collector.js` 한 개 제품 파일로 한정된다:
   `normalizeDetailLink` 신규 함수 + `linkValue` 반환문 1줄 배선. 그 외 제품 파일
   (`normalize-collected-item.js`, `resolve-url.js`, `decodeXml`/`tagValue`/
   `extractEntries` 본문 등) 무변경.
2. `normalizeDetailLink`는 순수 함수이며 확정 정규식
   `/(\/artcl[Vv]iew)(\?[^#]*)?$/` 를 사용한다.
3. `linkValue`의 두 경로(`<link href>` 속성, `tagValue` 폴백) 모두 결과가
   `normalizeDetailLink`를 통과한다.
4. `rssCollector` 반환 계약이 `{ status, items, warnings, finalUrl }` 그대로이고,
   `module.exports`가 `{ rssCollector }` 그대로다.
5. `rss-collector.test.js`에 신규 테스트 4개(nara-1..nara-4)가 추가되어 모두 통과.
6. 기존 5개 테스트 전부 통과(회귀 없음).
7. 검증 결과가 모두 green:
   - `node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.js"` → OK
   - `node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js"` → OK
   - `node --test development/university-news/collectors/rss-collector.test.js` → 9 tests pass, 0 fail
   - `npm test` (`node --test`) → 이전 기준 305 pass에서 신규 4개 추가되어 전부 pass,
     실패/회귀 0
   - 라이브 스모크(네트워크 가능 시에만): `rssCollector`를
     `https://www.inu.ac.kr/bbs/inu/2594/rssList.do`로 실행 →
     `items.length > 0` 이고 각 `sourceUrl`이 `/artclView.do`로 끝남.
     네트워크 불가 시 픽스처(nara-1)로 대체하고 그 사실을 결과 기록에 명시.
8. `.env`/토큰/자격증명이 코드·로그·기록에 포함되지 않는다.
9. git push/deploy/production 데이터 변경 없음. 커밋은 (추후 사용자가 요청하면)
   현재 `main` 브랜치에서 수행.

## 범위 밖(명시)

- Nara CMS 소스 자동 탐지/일괄 온보딩 배치 — 별도 후속 작업.
- robots / gate / activation / 카탈로그 소스 활성화 변경 없음.
- `resolve-url.js`나 `normalize-collected-item.js`의 동작 확장 없음.
- 다른 collector(`html-list-collector` 등) 변경 없음.
- git push, 배포, 프로덕션 데이터 갱신 없음.

# 질문사항

- 없음. 요청 내용과 필드 검증 결과, 기존 코드로 구현 방식이 충분히 확정됨.
  (정규식·export 여부·정규화 위치는 본 스펙에서 확정함. Coder는 확정안을 따른다.)
