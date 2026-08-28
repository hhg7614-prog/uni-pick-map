# 테스트 요약

전체 결과: 합격 (PASS)

`rss-collector.js` 의 `tagValue()` CDATA 파싱 버그 수정과 신규 테스트 5개를
검증했다. 코드 변경은 `tagValue()` 내부 `if (match)` 분기 1곳으로 한정되며
(`decodeXml`/`linkValue`/`extractEntries`/`rssCollector` 불변), 버그 재현/수정
확인, 회귀(bare text · description HTML), 반환 계약 불변, 범위 밖 파일 무변경,
`npm test` 3회 연속 305/305/0 을 모두 확인했다.

검증 환경: 네트워크 실측(uos/gnu RSS fetch)은 미실행 — spec 확정사항 3 및
완료 기준 7에 따라 4개 고정 픽스처로 대체.

- 브랜치: `feat/onboarding-gate-bridges` (HEAD `a2d3cf1`). 세션 시작 스냅샷의
  `main` 표기와 불일치하나 Tester 는 checkout/reset 미실행, 조사 중 상태 불변.

---

# 완료 기준

- 조건 1 (`rss-collector.js` 변경이 `tagValue()` 1곳 한정, diff 최소, `node --check` 통과): 통과
  - `git diff` : `@@ ... function tagValue` 블록만 변경 (1줄 → 7줄). `decodeXml`(6행),
    `linkValue`(23-26행), `extractEntries`(28-31행), `rssCollector`(33-55행), `module.exports` 무변경.
  - `node --check "development/university-news/collectors/rss-collector.js"` → OK (무출력).

- 조건 2 (신규 테스트 파일에 (a)(b)(c)(d) 4픽스처 + 기대 단언이 spec 과 일치): 통과
  - 파일 존재: `development/university-news/collectors/rss-collector.test.js` (신규, 213줄).
  - (a) `title === "2026학년도 2학기 수강신청 안내"`, `sourceUrl === "https://www.uos.ac.kr/korNotice/view.do?seq=12345"`,
    `summary === "수강신청 기간 안내입니다."`, "제목 또는 원문 링크가 없어 제외" 경고 없음 단언 — spec 130-150 일치.
  - (b) `title === "경상국립대학교 개교기념 학술대회 개최"`, `sourceUrl === "...nttSn=98765&bbsId=1028"`(`&amp;`→`&`),
    `summary === "학술대회 안내"`, gnu 실제 rssUrl/baseUrl 스텁 — spec 152-170 및 214-216 일치.
  - (c) Atom `entry` 폴백, `title === "Atom 방식 공지 제목"`, `sourceUrl === "https://news.example.ac.kr/atom/entry/1"`,
    `summary === "아톰 요약문"` — spec 172-190 일치.
  - (d) `summary === "본문 링크 포함"`, `title === "본문 태그 제거 확인"`, `sourceUrl === "https://www.example.ac.kr/bbs/view.do?id=9"` — spec 192-210 일치.
  - 추가: 반환 키 정확히 `["finalUrl","items","status","warnings"]`, `finalUrl === response.url` 단언.
  - `node --check` 신규 테스트 파일 → OK.

- 조건 3 (`node --test rss-collector.test.js` 전부 green): 통과
  - `node --test "development/university-news/collectors/rss-collector.test.js"` → tests 5 / pass 5 / fail 0.

- 조건 4 (`npm test` 전체 green, 회귀 없음): 통과
  - 3회 연속 실행 전부 `tests 305 / pass 305 / fail 0`, exit 0 (원본 출력 아래).
  - 신규 테스트 파일 제외 시 `tests 300 / pass 300 / fail 0` → baseline 300, 정확히 +5.

- 조건 5 (픽스처 (a) 가 "수정 전 0개 / 수정 후 1개" 증명): 통과 (경미한 지적 있음)
  - 테스트 (a) 소스 42-46행에 회귀 방지 주석 명시. spec 은 "주석 또는 별도 단언" 을 허용.
  - Tester 독립 재현: 수정 전 `tagValue` 로직으로 (a) 픽스처 파싱 시 `title=[]`, `link=[]`
    (빈 값) → `normalizeCollectedItem` 의 `!title || !sourceUrl` 로 항목 탈락 (0개).
    수정 후: `title="2026학년도 2학기 수강신청 안내"`, `sourceUrl` truthy → 1개 수집.
  - 경미: 테스트 자체는 수정 후 동작만 단언하고, 수정 전 실패를 강제하는 단언(예:
    구 로직 복제 비교)은 없음. 수정을 되돌리면 (a) 테스트가 실패하므로 회귀 가드로는 유효.

- 조건 6 (픽스처 (b)/gnu 형태가 수정 후에도 정상 추출): 통과
  - 테스트 (b) green. bare text `<title>`/`<link>` 는 CDATA 언랩 정규식 미매칭 → 기존 경로와 동일.
  - description CDATA + 내부 `<p style>`/`<a href>` → 태그 제거·공백 정규화된 평문 ((d) green).

- 조건 7 (네트워크 실측 회복 확인, 차단 시 명시): 통과 (실측 미실행, 명시됨)
  - 네트워크 실측 미수행. spec 확정사항 3 및 changes.md "미구현 항목" 에 "픽스처로 대체,
    실측 미실행" 으로 명시됨. 픽스처 (a) 가 uos 형태(CDATA), (b) 가 gnu 형태(bare text) 회복을 대리 증명.

- 조건 8 (`rssCollector()` 반환 형태·export 불변, `collector.js`/`collector-factory.js` 무수정): 통과
  - 반환: `{ status, items, warnings, finalUrl }` 유지 — 테스트 "return shape" green.
  - `module.exports = { rssCollector }` 불변.
  - `git status` : `server/agent/collector.js` 무변경. 호출부 `server/agent/collector.js:112`
    `await rssCollector({ university, source, limit, collectedAt })` 그대로.
  - 참고: `server/agent/collector-factory.js` 는 저장소에 존재하지 않는 파일 (spec 의 명칭 오류).
    실제 유일한 호출부는 `server/agent/collector.js` 이며 무변경.

- 조건 9 (프로덕션 데이터·게이트·robots 파일 무변경, git push/배포 미실행): 통과
  - `git status --porcelain` : `M .pipeline/changes.md`, `M .pipeline/spec.md`,
    `M development/university-news/collectors/rss-collector.js`,
    `?? .pipeline/merge-analysis.md`, `?? development/university-news/collectors/rss-collector.test.js`.
  - `data/`, `server/agent/data/`, robots/게이트/activate 스크립트, `normalize-collected-item.js`,
    `parse-date.js`, `resolve-url.js` 무변경. 커밋/푸시 미실행.

---

# 실패한 테스트

없음. (자동 테스트 305개 전부 통과, 타깃 5개 전부 통과)

---

# 재현 방법

## 자동 테스트

```
cd "D:/hhg(code)"
node --check "development/university-news/collectors/rss-collector.js"
node --check "development/university-news/collectors/rss-collector.test.js"
node --test  "development/university-news/collectors/rss-collector.test.js"
npm test
```

## 버그 재현 (수정 전 → 후)

수정 전 `tagValue()` 로직을 복제해 픽스처 (a) 를 파싱:

```
node -e '
function decodeXml(v){return String(v||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/gi,"&").trim();}
function oldTagValue(xml,names){for(const n of names){const m=xml.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`,"i"));if(m)return decodeXml(m[1].replace(/<[^>]*>/g," ").replace(/\s+/g," "));}return "";}
const e=`<item><title><![CDATA[2026학년도 2학기 수강신청 안내]]></title><link><![CDATA[https://www.uos.ac.kr/korNotice/view.do?seq=12345]]></link></item>`;
console.log("OLD title=["+oldTagValue(e,["title"])+"] link=["+oldTagValue(e,["link"])+"]");
'
```

결과: `OLD title=[] link=[]` → 수정 전에는 빈 값 → `normalizeCollectedItem` 의
`!title || !sourceUrl` 조건으로 항목 탈락 (uos RSS 24건 → 0건).

수정 후: `node --test rss-collector.test.js` 의 (a) 테스트가 `title`/`sourceUrl` truthy,
`items.length === 1` 을 통과.

## baseline 대비 (+5)

```
mv development/university-news/collectors/rss-collector.test.js /tmp/bak
npm test        # -> tests 300 / pass 300 / fail 0
mv /tmp/bak development/university-news/collectors/rss-collector.test.js
npm test        # -> tests 305 / pass 305 / fail 0
```

## 예외 상황 확인 (spec "예외 상황" 절)

`node -e` 로 `rssCollector` 직접 호출해 확인한 결과:

- CDATA 내부에 `>` 포함 (`<![CDATA[제목 <b>강조</b> 끝]]>`) → title `"제목 강조 끝"` (내부 태그 정상 제거).
- 닫는 `]]>` 없는 깨진 CDATA → 소스 전체 실패 아님, 해당 항목만 폴백 처리 (값이 비지 않으면 유지).
- `<link>` 없는 항목 → `items` 제외 + `"제목 또는 원문 링크가 없어 제외했습니다."` 경고. 기존 동작 유지.

---

# npm test 원본 출력 (3회 연속)

```
===== RUN 1 =====
✔ buildReviewPacket rejects when regressionEvidence is not fail 0 (4.3092ms)
ℹ tests 305
ℹ pass 305
ℹ fail 0
exit: 0
===== RUN 2 =====
✔ buildReviewPacket rejects when regressionEvidence is not fail 0 (4.3609ms)
ℹ tests 305
ℹ pass 305
ℹ fail 0
exit: 0
===== RUN 3 =====
✔ buildReviewPacket rejects when regressionEvidence is not fail 0 (3.1406ms)
ℹ tests 305
ℹ pass 305
ℹ fail 0
exit: 0
```

전체 요약 (RUN 1 tail):

```
ℹ tests 305
ℹ suites 0
ℹ pass 305
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 813.6952
```

타깃 테스트:

```
✔ (a) CDATA-wrapped title and link (uos form) are extracted, title/sourceUrl truthy (4.2462ms)
✔ (b) bare text title and link (gnu form) still extract, &amp; decoded (0.7123ms)
✔ (c) Atom <link href> attribute form yields sourceUrl (entry fallback) (0.5739ms)
✔ (d) description CDATA with <p>/<a> HTML is reduced to stripped plain text (0.2102ms)
✔ rssCollector() return shape is unchanged (1.3026ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

---

# 위험 요소

1. (경미) 테스트 (a) 는 수정 전 실패를 강제하는 단언이 없고 주석에만 의존. spec 완료 기준 5
   문구("주석 또는 별도 단언")는 충족하나, 구 로직 복제 비교 단언을 추가하면 회귀 가드가 더 견고.
2. 네트워크 실측 미실행 — uos `https://www.uos.ac.kr/rss/allBoard.do` 0→정상 회복,
   gnu RSS 2개 정상 유지의 실 fetch 검증은 미수행. 네트워크 가능 환경에서 spec 3단계 4번
   스모크 명령으로 배포 전 1회 확인 권장.
3. (경미) spec 이 `server/agent/collector-factory.js` 를 범위 밖 불변 대상으로 명시하나
   해당 파일은 저장소에 존재하지 않음. 실제 호출부는 `server/agent/collector.js` 뿐이며 무변경.
4. 브랜치 상태: 현재 `feat/onboarding-gate-bridges` (HEAD `a2d3cf1`). 세션 시작 스냅샷
   (`main` / `1d46917`)과 불일치. Reviewer 는 커밋 대상 브랜치를 사용자와 재확인 필요
   (spec 질문사항 1 미해결).
5. `.pipeline/spec.md` / `.pipeline/changes.md` 가 대폭 재작성됨 (spec 606줄 변경).
   제품 코드와 무관하나 커밋 스테이징 시 파이프라인 문서 포함 여부 확인 필요.
6. 실제 uos RSS 의 CDATA `<title>` 에 개행·HTML 이 섞인 형태는 픽스처가 대표형(순수
   텍스트 CDATA)만 커버. 다만 CDATA-내부-`>` 예외 케이스를 Tester 가 수동 확인해 통과.
7. `decodeXml()` 내부의 CDATA strip 은 (spec 확정대로) 유지 — 언랩 후 no-op. 이중 처리
   부작용 없음을 (a)/(d) 테스트로 확인.

---

# 최종 테스트 상태

통과 (PASS / 합격)

모든 완료 기준 통과. 발견된 항목은 전부 경미(테스트 강화 여지, 네트워크 실측 보류,
spec 문서상 존재하지 않는 파일명, 브랜치 확인)하며 구현 결함은 없음. 네트워크 실측
스모크와 커밋 대상 브랜치 확인은 Reviewer/사용자 판단으로 남긴다.
