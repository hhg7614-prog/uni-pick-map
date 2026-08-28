# 변경된 파일

- `D:\hhg(code)\development\university-news\collectors\rss-collector.js` (수정)
- `D:\hhg(code)\development\university-news\collectors\rss-collector.test.js` (신규)

# 변경 내용

## rss-collector.js — `tagValue()` 내부 1곳

수정 전 (12행):

```js
if (match) return decodeXml(match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
```

수정 후:

```js
if (match) {
  // CDATA를 먼저 벗긴 뒤 잔여 HTML 태그를 제거해야 한다. 순서가 반대이면
  // `<![CDATA[ ... ]]>`(내부에 '>' 없음) 블록 전체가 하나의 태그로 잡혀
  // title/link가 통째로 사라진다(한글 대학 CMS RSS의 일반적 형태).
  const withoutCdata = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeXml(withoutCdata.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}
```

- `decodeXml()`, `linkValue()`, `extractEntries()`, `rssCollector()` 는 무수정.
- `git diff` 상 변경은 `tagValue()` 한 곳(1줄 → 7줄)으로 국한됨.

## rss-collector.test.js — 신규 (node:test + node:assert/strict)

`html-list-collector.test.js` 패턴을 따름: `UNIVERSITY` 상수, `FIXED_COLLECTED_AT`
고정 주입, `fetchStub(xml, url)` 로 네트워크 없이 `fetchImpl` 주입.

테스트 5개:

- **(a)** CDATA 로 감싼 title+link (uos 형태, `>` 없는 CDATA) → `status === "success"`,
  `items.length === 1`, `title`/`sourceUrl` truthy, `title === "2026학년도 2학기 수강신청 안내"`,
  `sourceUrl === "https://www.uos.ac.kr/korNotice/view.do?seq=12345"`,
  `summary === "수강신청 기간 안내입니다."`, "제목 또는 원문 링크가 없어 제외" 경고 없음.
  (수정 전 코드였다면 title/link 가 비어 `items.length === 0` 이 됨을 주석으로 명시)
- **(b)** bare text title+link (gnu 형태) → 회귀: `items.length === 1`,
  `title === "경상국립대학교 개교기념 학술대회 개최"`,
  `sourceUrl === "https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=98765&bbsId=1028"`
  (`&amp;` → `&` 디코딩 유지), `summary === "학술대회 안내"`.
  소스 스텁을 실제 gnu RSS/baseUrl 형태로 구성.
- **(c)** Atom `<link href="...">` 속성 형태 (`<item>` 없음 → `entry` 폴백) →
  `items.length === 1`, `title === "Atom 방식 공지 제목"`,
  `sourceUrl === "https://news.example.ac.kr/atom/entry/1"`, `summary === "아톰 요약문"`.
- **(d)** description CDATA 내부 `<p style>`/`<a href>` HTML → `summary === "본문 링크 포함"`
  (모든 태그 제거·공백 정규화), title/sourceUrl 정상.
- **(추가)** `rssCollector()` 반환 키가 정확히 `{status, items, warnings, finalUrl}` 이고
  `finalUrl` 이 응답 URL 을 반영함을 단언 (반환 계약 불변 확인).

# 변경 이유

`tagValue()` 가 `match[1]` 에 대해 `replace(/<[^>]*>/g, " ")` (잔여 태그 제거) 를 먼저
수행한 뒤 `decodeXml()` 을 호출했다. `<![CDATA[ ... ]]>` 는 내부에 `>` 문자가 없으면
정규식 `/<[^>]*>/` 에 **블록 전체가 하나의 태그**로 매칭되어 통째로 제거된다.
그 결과 한국 대학 CMS RSS(서울시립대 `https://www.uos.ac.kr/rss/allBoard.do` 등)의
`<title>` / `<link>` 가 빈 문자열이 되고, `normalizeCollectedItem()` 에서 title/sourceUrl
누락으로 모든 항목이 탈락 → 24개 항목이 0개 수집되는 버그가 발생했다.

수정은 CDATA 를 먼저 `$1` 로 언랩(`/<!\[CDATA\[([\s\S]*?)\]\]>/g`)한 뒤 잔여 HTML 태그
제거 → `decodeXml()` 순으로 순서를 교체한다. CDATA 를 쓰지 않는 bare text 소스
(경상국립대 2개)는 언랩 정규식이 미매칭이라 기존과 동일하게 동작한다.
`decodeXml()` 내부의 CDATA strip 은 (spec 확정사항 4번대로) 유지했다 — 언랩 후라
매칭 대상이 없어 no-op 이며 부작용 없음.

# before / after `tagValue()` 동작 대비

입력: `<title><![CDATA[2026학년도 2학기 수강신청 안내]]></title>` 중 `match[1]` =
`<![CDATA[2026학년도 2학기 수강신청 안내]]>`

- **before**: `replace(/<[^>]*>/g, " ")` 가 `<![CDATA[...]]>` 전체를 태그로 보고 제거 →
  `" "` → `decodeXml` → `""`. → 항목 탈락, uos RSS 0건.
- **after**: CDATA 언랩 → `2026학년도 2학기 수강신청 안내` → 잔여 태그 없음 →
  `decodeXml` → `"2026학년도 2학기 수강신청 안내"`. → 항목 정상 추출.

bare text (`<title>경상국립대학교...</title>`, `match[1]` = `경상국립대학교...`):
before/after 모두 CDATA 정규식 미매칭 → 동일 결과. 회귀 없음.

# 여는 명령 (AGENTS.md 4항)

```powershell
Get-Content -Raw -LiteralPath "D:\hhg(code)\development\university-news\collectors\rss-collector.js"
Get-Content -Raw -LiteralPath "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js"
```

# 검증 결과

## node --check

```
node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.js"      -> OK (무출력)
node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js" -> OK (무출력)
```

## node --test (타깃)

```
node --test "development/university-news/collectors/rss-collector.test.js"
✔ (a) CDATA-wrapped title and link (uos form) are extracted, title/sourceUrl truthy
✔ (b) bare text title and link (gnu form) still extract, &amp; decoded
✔ (c) Atom <link href> attribute form yields sourceUrl (entry fallback)
✔ (d) description CDATA with <p>/<a> HTML is reduced to stripped plain text
✔ rssCollector() return shape is unchanged
tests 5 / pass 5 / fail 0
```

## npm test (전체, 3회 연속)

| 실행 | tests | pass | fail |
|------|-------|------|------|
| 1    | 305   | 305  | 0    |
| 2    | 305   | 305  | 0    |
| 3    | 305   | 305  | 0    |

- baseline(직전) 300 → 305. 증가분 +5 = 신규 `rss-collector.test.js` 5개.
- 회귀 0. 3회 모두 결정적 통과 (duration ~0.88s).

## git diff 범위 확인

`git diff -- development/university-news/collectors/rss-collector.js` 결과 변경이
`tagValue()` 내부 1곳(`if (match)` 분기)으로 국한됨을 확인. 다른 함수 무변경.

# 미구현 항목 / 보류

- **네트워크 실측 미실행** (spec 확정사항 3번대로 완료 기준에서 제외).
  uos RSS(`https://www.uos.ac.kr/rss/allBoard.do`) 0 → 24 회복,
  gnu RSS 2개 정상 유지의 실 fetch 확인은 수행하지 않음. 4개 고정 픽스처로 대체.
  네트워크 가능 환경에서 spec 3단계 4번의 스모크 명령으로 수동 확인 권장.
- **커밋 미실행**. spec 커밋 계획(`fix(university-news): ...`, `feat/onboarding-gate-bridges`
  위 1커밋)은 Tester/Reviewer 통과 및 사용자 명시 지시 후 진행.
  현재 브랜치는 이미 `feat/onboarding-gate-bridges` 이므로 브랜치 생성 불필요.
  스테이징 대상: `rss-collector.js`, `rss-collector.test.js`, `.pipeline/` 산출물.
  `.pipeline/merge-analysis.md` 는 이번 작업과 무관하므로 커밋 제외.

# 참고사항 (Tester)

- 테스트 실행: `node --test "development/university-news/collectors/rss-collector.test.js"`
  또는 저장소 루트에서 `npm test` (재귀 자동 탐색).
- 픽스처 XML 은 모두 `<?xml` 로 시작 — `rssCollector()` 의 `/^\s*<\?xml|<rss\b|<feed\b/i`
  프리앰블 검사를 통과하기 위함. `fetchStub` 은 `{ ok, url, text }` 만 반환 (RSS 경로는
  `response.headers` / content-type 를 읽지 않음).
- `FIXED_COLLECTED_AT = "2026-01-01T00:00:00.000Z"` 를 모든 호출에 주입해 시간 비결정성 제거.
  난수 사용 경로 없음.
- (a) 픽스처가 "수정 전 0건 / 수정 후 1건" 회귀 방지 지점. 수정을 되돌리면 (a) 가 실패해야 정상.
- 신규 npm 의존성 없음. 프로덕션 데이터(`data/`, `server/agent/data/`)·게이트·robots 파일 무변경.

# 사용자 확인 필요 사항

1. 커밋 진행 여부 및 시점 (Reviewer 통과 후). 커밋 시 spec 의 메시지 안 사용, 저장소 관례대로
   `Co-Authored-By` 트레일러 포함.
2. (선택) 네트워크 가능 환경에서 uos/gnu RSS 실측 스모크를 원하는지.
