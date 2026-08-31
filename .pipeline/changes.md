# 변경된 파일

- `D:\hhg(code)\development\university-news\collectors\rss-collector.js`
- `D:\hhg(code)\development\university-news\collectors\rss-collector.test.js`

# 변경 내용

## rss-collector.js

`linkValue` 위에 순수 함수 `normalizeDetailLink(value)` 신규 추가, `linkValue`의 `return` 문 1줄만 수정.

Before:
```js
function linkValue(xml) {
  const attributeLink = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return attributeLink ? attributeLink[1] : tagValue(xml, ["link"]);
}
```

After:
```js
// Nara Info CMS RSS <link> 보정: `.do` 접미사가 빠지고 가짜 쿼리스트링이 붙은
// `.../artclView` 링크를 정상 `.../artclView.do`로 재작성한다(대소문자 보존).
function normalizeDetailLink(value) {
  return String(value || "").replace(/(\/artcl[Vv]iew)(\?[^#]*)?$/, "$1.do");
}

function linkValue(xml) {
  const attributeLink = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return normalizeDetailLink(attributeLink ? attributeLink[1] : tagValue(xml, ["link"]));
}
```

`decodeXml`, `tagValue`, `extractEntries`, `rssCollector`, `module.exports`(그대로 `{ rssCollector }`)는 무변경. `normalizeDetailLink`는 export 하지 않음.

## rss-collector.test.js

기존 5개 테스트 무변경. 파일 하단에 신규 테스트 4개 추가:

- `(nara-1)` bare-text `<link>` Nara `artclView?layout=unknown` → `sourceUrl`이 `https://www.inu.ac.kr/bbs/inu/2594/429421/artclView.do`, `/artclView.do`로 끝나고 `?` 없음.
- `(nara-2)` Atom `<link href="...artclView?layout=unknown" />` → `sourceUrl`이 `/artclView.do`로 끝나고 `?` 없음(속성 경로도 감싸졌음 확인).
- `(nara-3)` 이미 `.do`로 끝나는 `selectNttInfo.do?nttSn=1` → 쿼리스트링 포함 그대로 유지.
- `(nara-4)` 무관한 절대 URL `https://news.example.ac.kr/atom/entry/1` → 불변.

기존 `fetchStub` / `makeSource` / `UNIVERSITY` / `FIXED_COLLECTED_AT` 헬퍼 재사용.

# 변경 이유

Nara Info CMS 계열 한국 대학 게시판 RSS의 `<link>`가 `.do` 접미사 없이 가짜 쿼리스트링이 붙은 잘못된 상세 URL(`.../artclView?layout=unknown`)을 내보내, 온보딩 상세 검증(`run-single-school-trial.js --diagnose`)이 실패한다. 수집 단계(`resolveUrl` 이전, 원본 링크 문자열)에서 정규식으로 정상 `.../artclView.do`로 바로잡는다. `linkValue`의 두 경로(`<link href>` 속성, `tagValue` 폴백)를 단일 지점에서 감싸 둘 다 정규화되게 했다.

# 미구현 항목

- 없음. spec.md 필수 요구사항 1~6 전부 구현.
- 라이브 스모크(`https://www.inu.ac.kr/bbs/inu/2594/rssList.do` 실제 호출)는 Coder 범위에서 실행하지 않음. spec 완료기준 7에 따라 픽스처(nara-1/nara-2)로 대체함. 네트워크 가능 시 Tester가 확인.

# 참고사항

- `node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.js"` → OK (`JS OK` 출력).
- `node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js"` → OK (`TEST OK` 출력).
- `node --test development/university-news/collectors/rss-collector.test.js` → `tests 9, pass 9, fail 0` (기존 5 + 신규 4 전부 통과).
- `npm test`(전체 스위트)는 Coder가 실행하지 않음. Tester가 실행. 신규 파일 없이 테스트 수만 4개 증가하므로 이전 기준 대비 +4 pass 예상.
- 알려진 한계(spec 수용): 프래그먼트(`#frag`) 포함 링크는 `$` 앵커 때문에 정규화되지 않음. 실제 Nara RSS `<link>`에는 프래그먼트 없음.
- 소문자 `/artclview`도 매칭되어 `.do`가 붙되 원본 대소문자 보존(`/artclview.do`).
- 커밋/푸시/배포 없음. 다른 파일 무변경.
