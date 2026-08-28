# 목표

`development/university-news/collectors/rss-collector.js` 의 `tagValue()` 가
`<![CDATA[...]]>` 로 감싼 `<title>` / `<link>` 를 빈 값으로 만들어 버리는 파싱
버그를 고친다. 한국 대학 CMS RSS(예: 서울시립대 `https://www.uos.ac.kr/rss/allBoard.do`,
24개 항목 → 현재 0개 수집)에서 정상적으로 제목·원문 링크를 추출하고, CDATA 를
쓰지 않는 기존 RSS 소스(경상국립대 2개)의 동작은 회귀 없이 유지한다.

도메인 순서: Development work (Code changes -> Tests).

# 요구사항

## 필수

1. `tagValue()` 에서 CDATA 를 **먼저** 벗기고, 그 다음에 잔여 HTML 태그 제거,
   마지막에 `decodeXml()` 로 엔티티 처리하도록 순서를 교체한다.
2. `<title>` / `<link>` 가 `<![CDATA[ ... ]]>` (내부에 `>` 문자 없음) 로 감싸인
   경우에도 값이 보존되어야 한다.
3. CDATA 없이 bare text 인 `<title>` / `<link>` 는 기존과 동일하게 동작해야 한다
   (경상국립대 회귀 대상).
4. Atom `<link href="...">` 속성 케이스는 `linkValue()` 에서 기존대로 우선
   처리되어야 한다 (순서 교체가 이 경로를 건드리지 않음).
5. `description` / `summary` 의 CDATA 안에 있는 실제 HTML(`<p>`, `<span>`, `<a>` 등)은
   새 순서에서도 그대로 제거되어 평문만 남아야 한다.
6. `rssCollector()` 의 export 시그니처와 반환 계약
   (`{ status, items, warnings, finalUrl }`)은 변경하지 않는다.
7. 신규 테스트 파일 `development/university-news/collectors/rss-collector.test.js`
   추가. 실제 네트워크 없이 `fetchImpl` 주입으로 4개 고정 픽스처를 검증한다.
8. `node --check` 통과, `npm test`(= `node --test`) 전체 통과.

## 하지 말 것

- robots 정책 / 승인 게이트 / 소스 활성화 관련 파일은 건드리지 않는다.
- `decodeXml()` 의 시그니처·동작을 바꾸지 않는다 (내부의 CDATA strip 은
  방어적 no-op 로 남겨 최소 변경 유지).
- `normalize-collected-item.js`, `collector.js`, `collector-factory.js`,
  `parse-date.js`, `resolve-url.js` 등 다른 제품 코드는 수정하지 않는다.
- git push / 배포 / 프로덕션 데이터(`data/`, `server/agent/data/`) 변경 금지.
- 요청 범위 밖 기능 추가 금지.

# 파일

## 수정

- `D:\hhg(code)\development\university-news\collectors\rss-collector.js`
  - `tagValue()` 함수 본문 1곳만 최소 수정.
  - 파일을 여는 명령 (AGENTS.md 4항):
    ```powershell
    Get-Content -Raw -LiteralPath "D:\hhg(code)\development\university-news\collectors\rss-collector.js"
    ```
  - 수정 후 검증:
    ```powershell
    node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.js"
    ```

## 생성

- `D:\hhg(code)\development\university-news\collectors\rss-collector.test.js`
  - 기존 `html-list-collector.test.js` 패턴을 따른다
    (`node:test` + `node:assert/strict`, `fetchImpl`/`fetchStub` 주입,
    `FIXED_COLLECTED_AT` 고정).
  - `.test.js` 접미사는 `node --test` 재귀 자동 탐색으로 수집됨
    (기존 `html-list-collector.test.js` 로 확인).
  - 검증:
    ```powershell
    node --check "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js"
    ```

# 구현 계획

## 1단계 — `tagValue()` 수정 (최소 diff)

현재 (rss-collector.js 9-15행):

```js
function tagValue(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return decodeXml(match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  }
  return "";
}
```

수정 후 (12행을 3줄로 교체):

```js
function tagValue(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (match) {
      // CDATA를 먼저 벗긴 뒤 잔여 HTML 태그를 제거해야 한다. 순서가 반대이면
      // `<![CDATA[ ... ]]>`(내부에 '>' 없음) 블록 전체가 하나의 태그로 잡혀
      // title/link가 통째로 사라진다(한글 대학 CMS RSS의 일반적 형태).
      const withoutCdata = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
      return decodeXml(withoutCdata.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
    }
  }
  return "";
}
```

- `decodeXml()` 는 그대로 둔다. 내부 `replace(/<!\[CDATA\[.../g, "$1")` 는 이미
  제거된 상태라 매칭 대상이 없어 no-op 이며, 엔티티 디코딩/`trim()` 만 수행한다.
  이중 처리·부작용 없음.
- `linkValue()` 는 `tagValue(xml, ["link"])` 폴백을 그대로 쓰므로 자동 반영.
  `<link href>` 속성 분기는 `tagValue()` 진입 전이라 영향 없음.

## 2단계 — `rss-collector.test.js` 작성

공용 픽스처:

```js
const UNIVERSITY = {
  universityId: "test-university",
  universityGroupId: "test-university-group",
  universityName: "테스트대학교",
  campusName: "",
};
const FIXED_COLLECTED_AT = "2026-01-01T00:00:00.000Z";

function fetchStub(xml, url) {
  return async () => ({ ok: true, url, text: async () => xml });
}
```

RSS 소스 스텁: `{ collectionType: "rss", rssUrl, baseUrl, category, categoryLabel,
name, id, datePolicy: {} }`.

### 픽스처 (a) — CDATA로 감싼 title + link (uos 형태)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[2026학년도 2학기 수강신청 안내]]></title>
    <link><![CDATA[https://www.uos.ac.kr/korNotice/view.do?seq=12345]]></link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description><![CDATA[<p>수강신청 <span>기간</span> 안내입니다.</p>]]></description>
  </item>
</channel></rss>
```

기대 결과: `status === "success"`, `items.length === 1`,
- `items[0].title === "2026학년도 2학기 수강신청 안내"`
- `items[0].sourceUrl === "https://www.uos.ac.kr/korNotice/view.do?seq=12345"`
- `items[0].summary === "수강신청 기간 안내입니다."`
- `warnings` 에 "제목 또는 원문 링크가 없어 제외" 문구 없음.
- (회귀 방어) 수정 전 코드였다면 title/link 가 비어 `items.length === 0` 이 됨을
  주석으로 명시.

### 픽스처 (b) — bare text title + link (gnu 형태, 회귀 대상)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>경상국립대학교 개교기념 학술대회 개최</title>
    <link>https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=98765&amp;bbsId=1028</link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description>학술대회 안내</description>
  </item>
</channel></rss>
```

기대 결과: `items.length === 1`,
- `items[0].title === "경상국립대학교 개교기념 학술대회 개최"`
- `items[0].sourceUrl === "https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=98765&bbsId=1028"`
  (`&amp;` → `&` 디코딩 유지)
- `items[0].summary === "학술대회 안내"`

### 픽스처 (c) — Atom `<link href>` 속성 형태

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom 방식 공지 제목</title>
    <link href="https://news.example.ac.kr/atom/entry/1" />
    <updated>2026-08-27T09:00:00+09:00</updated>
    <summary>아톰 요약문</summary>
  </entry>
</feed>
```

기대 결과 (`<item>` 없음 → `entry` 폴백):
- `items.length === 1`
- `items[0].title === "Atom 방식 공지 제목"`
- `items[0].sourceUrl === "https://news.example.ac.kr/atom/entry/1"`
- `items[0].summary === "아톰 요약문"`

### 픽스처 (d) — description CDATA 안 실제 HTML 태그 제거

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>본문 태그 제거 확인</title>
    <link>https://www.example.ac.kr/bbs/view.do?id=9</link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description><![CDATA[<p style="margin:0">본문 <a href="https://x.example">링크</a> 포함</p>]]></description>
  </item>
</channel></rss>
```

기대 결과:
- `items.length === 1`
- `items[0].summary === "본문 링크 포함"` (모든 태그 제거·공백 정규화)
- `items[0].title === "본문 태그 제거 확인"`
- `items[0].sourceUrl === "https://www.example.ac.kr/bbs/view.do?id=9"`

### 추가 단언 (경상국립대 실 RSS URL 회귀, 네트워크 없이)

픽스처 (b) 를 `rssUrl: "https://www.gnu.ac.kr/main/na/ntt/selectRssFeed.do?mi=1126&bbsId=1028"`,
`baseUrl: "https://www.gnu.ac.kr"` 로 구성해 실제 gnu 소스 형태(bare text)가
수정 후에도 항목을 추출함을 고정 픽스처로 증명한다.

## 3단계 — 검증

1. `node --check` : 수정 파일 + 신규 테스트 파일.
2. 타깃 테스트:
   ```powershell
   node --test "D:\hhg(code)\development\university-news\collectors\rss-collector.test.js"
   ```
3. 전체 회귀:
   ```powershell
   npm test
   ```
   (`html-list-collector.test.js` 등 기존 테스트 포함 전부 통과 확인)
4. (선택 · 네트워크 허용 시에만) 실측 스모크 — 프로덕션 데이터 변경 없음:
   ```powershell
   node -e "const{rssCollector}=require('./development/university-news/collectors/rss-collector');const u={universityId:'gnu',universityGroupId:'gnu',universityName:'경상국립대학교'};const s={collectionType:'rss',id:'gnu-official-notices',name:'공지',category:'school_notice',categoryLabel:'학교 공지사항',rssUrl:'https://www.gnu.ac.kr/main/na/ntt/selectRssFeed.do?mi=1126&bbsId=1028',listUrl:'https://www.gnu.ac.kr/main/na/ntt/selectNttList.do?bbsId=1028&mi=1126',baseUrl:'https://www.gnu.ac.kr',datePolicy:{}};rssCollector({university:u,source:s,limit:5}).then(r=>console.log(r.status,r.items.length,r.items[0]&&r.items[0].title)).catch(e=>console.log('NET-SKIP',e.message))"
   ```
   그리고 동일 방식으로 `https://www.uos.ac.kr/rss/allBoard.do` 가 0 → 24(또는 limit)
   으로 회복되는지 확인. 네트워크 차단 환경이면 이 단계는 생략하고 픽스처 결과로 대체.

# 예외 상황

- **CDATA 내부에 `>` 문자가 포함된 경우** (예: `<![CDATA[제목 <b>강조</b>]]>`):
  CDATA 를 먼저 벗기므로 내부 `<b>` 는 이후 태그 제거 단계에서 정상 삭제됨.
  단, CDATA 를 벗기기 전 정규식이 `]]>` 앞의 첫 `>` 에서 끊길 위험은 없음
  (`/<!\[CDATA\[([\s\S]*?)\]\]>/` 는 `]]>` 까지 non-greedy 매칭).
- **닫는 `]]>` 가 없는 깨진 CDATA**: 정규식 미매칭 → 기존처럼 `<[^>]*>` 제거 로직으로
  폴백. 값이 비면 `normalize-collected-item.js` 가 해당 항목만 제외(소스 전체 실패 아님).
- **`<link>` 가 없고 `<link href>` 도 없는 항목**: `linkValue()` 가 `""` 반환 →
  `resolveUrl` null → 항목만 제외. 기존 동작 유지.
- **URL 에 `&amp;` 외 raw `&` 포함**: `decodeXml` 은 `&amp;`, `&lt;`, `&gt;`,
  `&quot;` 만 처리. raw `&` 는 그대로 두므로 URL 파손 없음.
- **pubDate 가 CDATA 인 소스**: 이번 수정으로 CDATA 도 벗겨져 오히려 더 견고해짐
  (기존엔 `decodeXml` 이 벗겨서 통과, 회귀 아님).
- **테스트의 `collectedAt` 미고정 시 flakiness**: `html-list-collector.test.js`
  주석과 동일하게 `FIXED_COLLECTED_AT` 를 명시 주입.
- **`fetchStub` 반환 객체에 `headers` 누락**: `rssCollector` 는 RSS 경로에서
  `response.headers` 를 읽지 않으므로 `{ ok, url, text }` 만으로 충분
  (`html-list-collector` 와 달리 content-type 체크 없음, XML 프리앰블 정규식만 사용) —
  따라서 픽스처 XML 은 반드시 `<?xml` 또는 `<rss`/`<feed` 로 시작해야 함.
- **`npm test` 가 저장소 전역을 재귀 탐색**: 무관한 기존 테스트 실패가 이번 변경과
  섞이지 않도록, 먼저 타깃 테스트만 실행해 격리 확인 후 전체 실행.

# 완료 기준

1. `rss-collector.js` 변경이 `tagValue()` 내부 1곳으로 한정되고 diff 가 최소이며
   `node --check` 통과.
2. `rss-collector.test.js` 신규 파일에 (a)(b)(c)(d) 4개 픽스처 테스트가 존재하고
   각 기대 결과 단언이 위 명세와 일치.
3. `node --test rss-collector.test.js` 전부 green.
4. `npm test` 전체 green (기존 테스트 회귀 없음).
5. 픽스처 (a) 가 "수정 전이면 0개, 수정 후 1개" 를 증명 (회귀 방지 주석 또는
   별도 단언 포함).
6. 픽스처 (b)/gnu 형태가 수정 후에도 정상 추출됨을 증명.
7. (네트워크 허용 시) uos RSS 실측이 0 → 정상 수집으로 회복, gnu RSS 2개 실측이
   여전히 정상. 네트워크 차단 시 이 항목은 "픽스처로 대체, 실측 미실행" 으로 명시.
8. `rssCollector()` 반환 형태·export 불변, `collector.js` / `collector-factory.js`
   무수정.
9. 프로덕션 데이터·게이트·robots 파일 무변경. git push/배포 미실행.

# 커밋 계획

- 대상 브랜치: 사용자 지정 `feat/onboarding-gate-bridges` 위 1커밋
  (단, 현재 워킹트리 브랜치는 `main` — 아래 질문사항 참고).
- 스테이징: `development/university-news/collectors/rss-collector.js`,
  `development/university-news/collectors/rss-collector.test.js`,
  `.pipeline/spec.md` (+ 파이프라인 산출물). `.pipeline/merge-analysis.md` 는
  이번 작업과 무관하므로 커밋에 포함하지 않음.
- 커밋 메시지(안):
  ```
  fix(university-news): rss-collector tagValue가 CDATA title/link를 삼키는 버그 수정

  - tagValue()에서 CDATA를 먼저 벗기고 잔여 태그 제거 후 decodeXml 적용하도록 순서 교체
  - 한글 대학 CMS RSS(uos 등) title/link가 빈 값이 되어 전량 탈락하던 문제 해결
  - CDATA 없는 bare text 소스(gnu 2개) 및 Atom <link href> 회귀 없음
  - rss-collector.test.js 추가: CDATA/bare/href-attr/description-HTML 4개 고정 픽스처
  ```
- push/배포 없음. 커밋 여부는 Tester/Reviewer 통과 후 사용자 명시 지시로만 진행.

# 질문사항

1. **브랜치 불일치**: 요청서는 "`feat/onboarding-gate-bridges` 위에 커밋" 이라고
   하지만 현재 저장소 브랜치는 `main` 이고 `feat/onboarding-gate-bridges` 는 로컬에
   보이지 않는다. (a) `main` 에서 새로 `feat/onboarding-gate-bridges` 를 만들까,
   (b) 원격 브랜치를 체크아웃할까, (c) `main` 에 그대로 커밋할까? 확정 필요.
2. **CDATA `<title>` 안에 개행/HTML 이 섞인 실제 uos 항목 형태**를 픽스처에 얼마나
   충실히 반영할지 — 현재는 대표형(순수 텍스트 CDATA)만 사용. 실제 응답 샘플을
   제공해 주면 픽스처를 더 정확히 맞출 수 있음. (없으면 대표형으로 진행)
3. **네트워크 사용 가능 여부**: 실측(gnu/uos RSS fetch) 을 완료 기준에 포함해도
   되는지, 아니면 픽스처 검증만으로 sign-off 하는지.
4. `decodeXml()` 내부의 이제 불필요해진 CDATA strip 을 **남길지 제거할지** —
   기본은 "남김(최소 변경, 방어적)" 으로 계획. 제거를 원하면 알려줄 것.
