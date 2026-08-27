# 목표

전북대학교(`chonbuk-national-university`), 경상국립대학교
(`gyeongsang-national-university`), 단국대학교 죽전캠퍼스
(`dankook-university-jukjeon`) 3개 대학, 6개 소스(각 대학 `school_news`
+ `school_notice`)를 실제로 수집 가능한 상태로 만들기 위해, 이미
승인·구현된 `jsDetailLinkRule`(onclick 함수 호출/`data-*` 속성에서
안전하게 상세 URL을 조립하는 opt-in 엔진 — `development/university-news
/collectors/html-list-collector.js` + `development/university-news
/utils/safe-onclick-call.js`, 이번에 수정하지 않음)과 조합해 쓸
`selectors`(목록 item/title/date/link/linkAttribute, 상세
title/date)와 `jsDetailLinkRule`(pattern/functionName 또는
dataAttribute/argCount/fixedParams/urlTemplate) 값을 실제 사이트를
읽기 전용 GET으로 재조사해 확정하고, 그 결과를 `.pipeline/spec.md`(이
문서)에 "조사 계획"으로 남긴다.

이번은 **Planner 단계만** 수행한다. 실제 사이트 GET 조사(코드/JSON
수정 없음)는 이 계획 승인 후 메인 에이전트가 직접 수행하며, 이번
세션에서는 파일 수정/`enabled` 전환/수집·저장/preview 생성/배포/git
작업을 하지 않는다.

# 요구사항

1. 사용자가 "전북대·경상국립대·단국대"만 지목했으므로 6개 소스
   (school_news + school_notice 각각)를 모두 조사 대상에 포함하되,
   시간/우선순위상 **school_news 소스 3개
   (`jbnu-official-news`/`gnu-official-press-releases`/
   `dankook-university-news`)를 먼저 조사**하고, **school_notice 소스
   3개(`jbnu-campus-notice`/`gnu-official-notices`/
   `dankook-university-general-notice`)는 여유가 되면 이어서 조사**하는
   순서로 진행한다. 시간이 부족하면 school_notice 3개는 별도 세션으로
   미룰 수 있음을 사용자에게 명시한다.
2. 6개 소스 각각에 대해 다음을 실제 사이트에서 읽기 전용 GET으로
   재확인한다(추측 금지 — 스크리닝 단계 정적 휴리스틱은 출발점일 뿐,
   실제 마크업/URL은 이번에 직접 재검증):
   - robots.txt 정책 (해당 사이트가 목록/상세 경로를 차단하지 않는지)
   - 목록 페이지의 실제 item/title/date/link 마크업 — 링크 트리거가
     정말 `href="javascript:fn(args);"`인지, 별도 `onclick` 속성인지,
     `data-*` 속성인지(경희대 조사에서 얻은 교훈: `onclick` 속성이
     별도로 있을 거라 가정하지 말고 `href` 자체를 먼저 확인)
   - 함수명/인자 개수/인자 값 형태(숫자/따옴표 문자열/불리언)를 실제로
     확인
   - 그 함수 호출 또는 `data-*` 값이 실제로 어떤 URL로 귀결되는지(폼
     `action`+hidden input, 또는 JS 라우팅 로직)를 코드로 역산하고,
     **curl로 GET 요청을 실제로 보내 HTTP 200 + 실제 기사 본문이
     렌더링되는지 직접 확인**(POST 전용이라 GET이 안 되면 그 사실을
     그대로 보고하고 HOLD로 남김 — POST 시뮬레이션/추측 금지. 경희대
     조사에서 같은 사이트라도 게시판마다 GET 동치성이 다르게 나온
     선례가 있으므로 6개 소스 각각 개별 검증)
   - 상세 페이지 title/date 선택자 후보
   - 목록·상세 최소 3건 교차검증(제목 일치/날짜 일치/대학명 언급)
   - `officialNames` 필요 여부 — 상세 본문에 `universityName` 값이
     정확히 등장하는지로 판단(전북대 "전북대학교", 경상국립대
     "경상국립대학교", 단국대 "단국대학교 죽전캠퍼스" — 특히 단국대는
     "죽전캠퍼스"가 본문에 안 나올 가능성이 높으므로 경희대와 유사하게
     주의 깊게 확인하고, 안 나오면 `officialNames: ["단국대학교"]` 등
     대안을 결론으로 남김)
   - `baseUrl` 필요/일치 여부(`resolveJsDetailLink`의 `sameHost()`가
     `source.baseUrl || source.listUrl || source.rssUrl` 순으로 참조 —
     6개 소스는 이미 `baseUrl`이 채워져 있으므로 이번엔 값이 실제
     listUrl 호스트와 일치하는지만 재확인)
   - `jsDetailLinkRule`의 `pattern`("functionCall" 또는
     "dataAttribute")/`functionName` 또는 `dataAttribute`/`argCount`/
     `fixedParams`/`urlTemplate` 확정
   - 메뉴/배너/공지 고정/중복 마크업 위험(같은 클래스를 쓰는 비-뉴스
     요소, 상단 고정 공지 행 등)
   - 목록 페이지 하나에 여러 카테고리/탭이 섞여 있는지, 섞여 있다면
     탭별 상세 페이지 템플릿(제목/날짜 선택자)이 다른지(경희대 교훈)
3. 6개 소스 중 하나라도 GET이 안 되거나(POST 전용, 세션/쿠키/referer
   필요) 마크업이 예상과 다르면 그 소스는 **HOLD**로 명시하고, 다른
   5개 소스 조사를 막지 않는다(소스 단위 격리 원칙).
4. 이번 조사는 읽기 전용 GET(및 robots.txt 확인)만 사용한다. 파일
   수정, `enabled` 변경, 수집·저장, preview 생성, 배포, git 작업은
   이번에 하지 않는다.

# 파일

## 이번 Planner 단계에서 이미 확인한 파일(읽기 전용, 수정 없음)

- `D:\hhg(code)\development\university-news\data\university-news-sources.final.json`
  - `chonbuk-national-university`(654~711번째 줄) — `jbnu-campus-notice`
    (663~679번째 줄, `listUrl: ".../web/news/notice/sub01.do"`),
    `jbnu-official-news`(680~697번째 줄, `listUrl: ".../web/news/plaza
    /sub01.do"`). 둘 다 `baseUrl: "https://www.jbnu.ac.kr"`,
    `selectors: {}`, `verified: true`, `enabled: false`,
    `status: "selector_required"`, `jsDetailLinkRule` 필드 없음을 확인.
  - `gyeongsang-national-university`(1026~1083번째 줄) —
    `gnu-official-notices`(1034~1050번째 줄, `listUrl: ".../selectNttList
    .do?bbsId=1028&mi=1126"`), `gnu-official-press-releases`
    (1052~1069번째 줄, `listUrl: ".../selectNttList.do?mi=1070"`). 둘 다
    `baseUrl: "https://www.gnu.ac.kr"`, `selectors: {}`, 나머지 위와
    동일함을 확인.
  - `dankook-university-jukjeon`(1929~1986번째 줄) —
    `dankook-university-news`(1938~1954번째 줄, `listUrl: ".../web/kor
    /-550"`), `dankook-university-general-notice`(1955~1972번째 줄,
    `listUrl: ".../web/kor/-390"`). 둘 다 `baseUrl:
    "https://www.dankook.ac.kr"`, `selectors: {}`, 나머지 위와 동일함을
    확인.
- `D:\hhg(code)\development\university-news\utils\safe-onclick-call.js`
  — `parseSimpleFunctionCall`(58~71번째 줄, `javascript:` 접두사 자동
  제거 `JAVASCRIPT_HREF_PREFIX` 정규식 24번째 줄, 인자는 숫자/따옴표+
  `[\w-]{0,64}`/`true|false`만 허용 `SIMPLE_CALL_ARG` 32번째 줄),
  `isSafeRawAttrValue`(82~84번째 줄, `RAW_ATTR_VALUE` `[\w-]{1,64}`),
  `ALLOWED_DATA_ATTR_NAMES`(35~43번째 줄, data-id/data-url/data-param/
  data-nm/data-no/data-seq/data-idx)를 확인.
- `D:\hhg(code)\development\university-news\collectors\html-list-collector.js`
  — `resolveJsDetailLink`(126~144번째 줄, `pattern` 분기와
  `argCount`/`fixedParams`/`urlTemplate` 처리), `sameHost`(91~102번째
  줄, `source.baseUrl || source.listUrl || source.rssUrl` 순서로
  호스트 판정), `interpolateTemplate`(108~118번째 줄, `{key}` 미충족 시
  전체 실패)을 확인.
- `D:\hhg(code)\development\university-news\collectors\html-list-collector.test.js`
  — 테스트 3번(79~90번째 줄, JBNU `pf_DetailMove('216600')` 1-인자
  functionCall), 테스트 4번(92~102번째 줄, GNU `data-id` dataAttribute),
  테스트 5번(104~115번째 줄, 단국대 `_dku_bbs_web_BbsPortlet_
  viewMessage(181003, true, false)` 3-인자, arg0만 사용)이 이미 엔진
  자체의 순수 함수 단위로 이 3가지 패턴을 지원함을 확인. 즉 엔진은
  준비되어 있고, 이번 작업은 코드가 아니라 실제 함수명/인자/URL 구조를
  정확히 알아내 JSON 값을 채우는 것이 핵심.
- `D:\hhg(code)\server\agent\screening\link-risk-heuristics.js` —
  `detectJsOnlyLinkRisk`(126번째 줄~)가 온보딩 스크리닝 단계에서
  전북대(`pf_DetailMove`)/단국대(`_dku_bbs_web_BbsPortlet_viewMessage`)
  패턴을 이미 참조 예시로 주석에 담고 있음(13번째 줄,
  `DATA_ID_ATTR_NAMES` 28번째 줄 — GNU류 `data-*` 속성 패턴). 이는
  정적 휴리스틱 추정치이며 이번에 실측으로 재확인해야 함.
- `D:\hhg(code)\server\agent\tools\run-single-school-trial.js` —
  `universityNameMatches()`(94~96번째 줄)가 `source.officialNames`를
  우선 사용하고 없으면 `university.universityName`을 사용함을 확인,
  `--diagnose --limit=N` 옵션이 read-only trial임을 확인(26번째 줄,
  164~169번째 줄 `assertSourceEnabledForSave`가 diagnose 시 저장을
  건너뜀).

## 이후 메인 에이전트가 읽기 전용 GET으로 조사할 대상(이번 세션에서 접속하지 않음)

우선순위 1 (school_news):
- `https://www.jbnu.ac.kr/web/news/plaza/sub01.do` (`jbnu-official-news`)
- `https://www.gnu.ac.kr/main/na/ntt/selectNttList.do?mi=1070`
  (`gnu-official-press-releases`)
- `https://www.dankook.ac.kr/web/kor/-550` (`dankook-university-news`)

우선순위 2 (school_notice, 여유가 되면):
- `https://www.jbnu.ac.kr/web/news/notice/sub01.do` (`jbnu-campus-notice`)
- `https://www.gnu.ac.kr/main/na/ntt/selectNttList.do?bbsId=1028&mi=1126`
  (`gnu-official-notices`)
- `https://www.dankook.ac.kr/web/kor/-390`
  (`dankook-university-general-notice`)

각 목록 URL에서 확인되는 상세 항목 3건 이상, 그리고 각 사이트의
`robots.txt`(`https://www.jbnu.ac.kr/robots.txt`,
`https://www.gnu.ac.kr/robots.txt`,
`https://www.dankook.ac.kr/robots.txt`).

## 이번 조사 결과 반영이 예상되는 파일(이번엔 수정하지 않음, 조사 후 별도 승인 필요)

- `D:\hhg(code)\development\university-news\data\university-news-sources.final.json`
  의 6개 소스 블록(`jbnu-campus-notice`/`jbnu-official-news`/
  `gnu-official-notices`/`gnu-official-press-releases`/
  `dankook-university-news`/`dankook-university-general-notice`) —
  확정된 소스에 한해 `selectors`(item/title/date/link/linkAttribute),
  `jsDetailLinkRule`(pattern/functionName 또는 dataAttribute/argCount/
  fixedParams/urlTemplate/enabled), 필요시 `officialNames`,
  `detailSelectors` 추가. **이번 Planner 산출물에는 확정된 소스마다
  최소 diff 형태의 "수정안(초안)"까지만 제시**하고, 실제 파일 수정은
  하지 않는다. HOLD된 소스는 수정안 없이 관찰 사실/보류 사유만 기록.

# 구현 계획 (조사 절차 — 이번 세션은 계획만, 실행은 승인 후 메인 에이전트)

아래 절차를 6개 소스 각각에 대해 독립적으로 적용한다(하나가 성공/실패
했다고 다른 소스의 결과를 가정하지 않는다). 순서는 우선순위 1
(school_news 3개: JBNU → GNU → 단국대 순, 사용자가 나열한 순서를
따름)을 먼저 마치고, 시간이 남으면 우선순위 2(school_notice 3개, 같은
순서)로 이어간다.

1. **robots.txt 확인**
   해당 대학 도메인의 `robots.txt`를 GET해 목록/상세 경로가 차단되어
   있지 않은지 확인한다. 차단되어 있으면 그 사실을 그대로 보고하고
   해당 소스를 HOLD로 남긴다.
2. **목록 페이지 실측**
   2-1. 목록 URL을 GET하고(302 리다이렉트가 있으면 최종 URL도 기록),
   항목 반복 구조(예: `ul li`, `table tbody tr`, `div.board-list li`
   등)를 식별해 `selectors.item` 후보를 정한다.
   2-2. 항목 내 제목 요소(`selectors.title`)와 날짜 요소
   (`selectors.date`, 필요시 `selectors.dateIndex`)를 `findBySelector`
   문법(`태그.클래스` 토큰, `@속성명`)에 맞춰 정한다.
   2-3. 링크 트리거 요소의 실제 마크업을 확인한다 — `href` 자체가
   `javascript:fn(args);`인지, 별도 `onclick` 속성이 있는지(전북대
   추정: `onclick="pf_DetailMove('216600')"`, `href="#"` 등 비-내비게이션
   href 동반), `data-*` 속성인지(경상국립대 추정: `javascript:` href +
   `data-id` 등 + POST 폼), `href="#none"` + `onclick="_dku_bbs_web_
   BbsPortlet_viewMessage(id, true, false)"`인지(단국대 추정). 이 추정은
   스크리닝 휴리스틱의 정적 추정치일 뿐이므로 실제 마크업을 그대로
   기록한다. `selectors.link`/`selectors.linkAttribute`(기본값은
   `href`이므로 별도 속성일 때만 명시)를 확정한다.
   2-4. 목록 페이지 하나에 카테고리/탭이 섞여 있는지 확인하고, 섞여
   있다면 각 카테고리가 실제로 어떤 상세 페이지 템플릿을 쓰는지 표시해
   둔다(다음 단계에서 검증).
3. **함수 호출/데이터 속성 → 실제 상세 URL 역산 및 GET 검증**
   3-1. 함수 호출 패턴이면: 함수명, 인자 개수, 각 인자의 값 형태(숫자/
   문자열/불리언)를 목록 페이지에서 최소 3개 이상의 서로 다른 항목으로
   확인한다.
   3-2. 그 함수가 어떤 URL로 귀결되는지 페이지 내 JS(인라인 `<script>`
   또는 외부 JS 파일)를 읽어 폼 `action`+hidden input 조합 또는 직접
   URL 조립 로직을 역산한다.
   3-3. 역산한 URL 패턴으로 **curl GET 요청을 실제로 보내** HTTP 200과
   함께 실제 기사 제목/본문이 렌더링되는지 직접 확인한다. 렌더링되지
   않으면(빈 본문, 로그인 요구, referer 체크, POST 전용 추정 등) 그
   사실을 그대로 기록하고 이 소스는 HOLD로 남긴다(POST 시뮬레이션/추측
   금지).
   3-4. `data-*` 속성 패턴이면(경상국립대 추정): `ALLOWED_DATA_ATTR_NAMES`
   (data-id/data-url/data-param/data-nm/data-no/data-seq/data-idx) 중
   실제로 쓰이는 속성명을 확인하고, 동일하게 역산한 URL로 curl GET을
   검증한다.
   3-5. 인자가 1개면 `argCount: 1` + 필요시 `fixedParams`(게시판 ID/
   메뉴 번호 등 목록 페이지에 고정된 값)로, 다인자면 `argCount: N` +
   실제 URL에 쓰이는 인자 인덱스만 `urlTemplate`에서 참조하는 구조로
   `jsDetailLinkRule`을 확정한다.
4. **상세 페이지 selectors 도출 및 교차검증**
   4-1. 3번에서 확정한 URL로 실제 상세 페이지 최소 3건을 GET한다.
   4-2. 상세 페이지의 제목/날짜 요소 클래스/구조를 확인해
   `detailSelectors.title`/`detailSelectors.date` 후보를 정한다(목록
   페이지에 여러 탭이 섞여 있었다면 탭별로 별도 확인).
   4-3. 3건 각각에 대해 (목록에서 본 제목 == 상세 제목), (목록에서 본
   날짜 == 상세 날짜 또는 합리적 오차), (본문에 대학 공식 명칭 언급
   존재)를 교차검증한다.
5. **`officialNames` 결론**
   해당 대학의 `universityName`(전북대 "전북대학교", 경상국립대
   "경상국립대학교", 단국대 "단국대학교 죽전캠퍼스")이 4-3의 상세 본문
   3건에 실제로 등장하는지 확인한다. 등장하지 않으면(단국대는
   "죽전캠퍼스" 없이 "단국대학교"만 나올 가능성이 높음)
   `officialNames`에 실제로 등장하는 명칭을 추가하는 것을 최종 결론으로
   남긴다(코드 근거: `universityNameMatches()`가 이 필드를 우선 사용,
   run-single-school-trial.js 94~96번째 줄).
6. **`baseUrl` 확인**
   6개 소스 모두 이미 `baseUrl`이 채워져 있으므로, 이 값이 실제
   `listUrl`/상세 URL의 호스트(`www.jbnu.ac.kr`/`www.gnu.ac.kr`/
   `www.dankook.ac.kr`)와 정확히 일치하는지만 재확인한다(불일치 시
   `sameHost()`가 항상 실패해 모든 항목이 걸러지므로 중요).
7. **위험 요소 점검**
   메뉴/배너/공지 고정 항목이 `selectors.item`에 함께 걸리지 않는지,
   같은 클래스명을 쓰는 비-뉴스 요소(광고 배너, 팝업, 인기글 위젯 등)가
   없는지 확인한다.
8. **소스별 결론 및 최소 JSON 수정안(초안) 작성**
   확정된 소스는 해당 블록 전체를 "수정안"으로 제시한다(이번 세션에서
   실제 파일에 쓰지 않음). `enabled`(source 최상위)는 계속 `false`로
   유지하고, `status`는 selectors가 채워지면 `selector_required`에서
   벗어날 수 있음을 명시하되 실제 값 변경은 승인 후 별도 Coder 단계에서
   수행한다. HOLD된 소스는 관찰 사실과 보류 사유만 기록하고 수정안은
   제시하지 않는다.
9. **승인 대기**
   조사 결과와 수정안(및 HOLD 목록)을 사용자에게 보고하고, 실제 JSON
   반영 및 diagnose 실행(`run-single-school-trial.js --diagnose
   --limit=3`)은 승인 후 별도 단계로 진행한다.

# 예외 상황

- **GET만으로 상세 페이지가 정상 렌더링되지 않는 경우**(세션/쿠키/
  referer 요구, POST 전용 추정, 빈 본문): 그 소스를 HOLD로 명시하고
  다른 5개 소스 조사를 계속 진행한다. POST 시뮬레이션이나 "될 것"이라는
  추측으로 대체하지 않는다.
- **한 대학 내에서도 소스마다 GET 동치성이 다를 수 있음**(경희대
  선례): 같은 대학의 두 소스(school_news/school_notice) 중 하나가
  GET으로 되고 다른 하나가 안 되더라도, 서로의 결과를 근거로 추정하지
  않고 각각 독립적으로 curl 검증한다.
- **실제 마크업이 스크리닝 휴리스틱 추정과 다른 경우**(예: 전북대가
  `onclick` 속성이 아니라 `href="javascript:pf_DetailMove(...)"` 형태로
  판명, 또는 경상국립대가 예상과 다른 `data-*` 속성명을 쓰는 경우):
  실제 관찰을 그대로 기록하고 스크리닝 추정치를 폐기한다(추측 금지).
- **목록 페이지에 여러 카테고리/탭이 섞여 있고 탭별 상세 템플릿이 다른
  경우**: 대표 카테고리 하나를 임의로 고르지 않고, 관찰 사실을 그대로
  보고한 뒤 사용자에게 어떤 카테고리를 대표로 쓸지 확인을 요청한다.
- **목록 항목 수가 3건 미만이거나 전부 비-뉴스성 콘텐츠(광고/팝업
  안내)인 경우**: 대표성 미달로 판단하고 사실을 보고한 뒤 사용자 판단을
  요청한다.
- **선택자가 메뉴/배너와 겹치는 경우**: `selectors.item` 후보를 좁혀
  재시도하고, 그래도 분리가 안 되면 위험 요소로 명시해 보고한다.
- **`officialNames` 실측 결과가 스크리닝 시점 추정과 다르게 나오는
  경우**: 이번 실측 결과를 우선한다.
- **`baseUrl`과 실제 호스트가 불일치하는 경우**: 그 사실을 그대로
  기록하고, `baseUrl` 수정이 필요함을 수정안에 포함한다(단, 실제 수정은
  이번 세션에서 하지 않음).
- **robots.txt가 해당 경로를 차단하는 경우**: 그 소스를 HOLD로 명시하고
  이유를 기록한다.
- **네트워크 실패/타임아웃**: 재시도 후에도 실패하면 그 사실을 그대로
  보고하고 해당 소스를 HOLD로 남긴다.
- **시간 부족으로 school_notice 3개를 이번 세션에 조사하지 못하는
  경우**: school_news 3개(우선순위 1) 결과만으로 먼저 보고하고,
  school_notice 3개는 별도 세션에서 이어서 진행할 수 있음을 명시한다
  (사용자 요청에 이미 반영된 우선순위이므로 별도 승인 불필요, 단
  진행하지 못했다는 사실 자체는 보고에 포함).

# 완료 기준

- [ ] 6개 소스(`jbnu-campus-notice`/`jbnu-official-news`/
      `gnu-official-notices`/`gnu-official-press-releases`/
      `dankook-university-news`/`dankook-university-general-notice`)
      각각에 대해 확정(CONFIRMED) 또는 보류(HOLD) 여부와 그 근거(GET
      검증 결과, 실제 마크업 관찰)가 기록된다.
- [ ] school_news 3개(`jbnu-official-news`/`gnu-official-press-releases`
      /`dankook-university-news`)는 반드시 이번 세션에서 조사가
      완료된다(우선순위 1). school_notice 3개는 여유가 되면 이어서
      조사하되, 못하면 그 사실과 사유를 보고에 명시한다.
- [ ] CONFIRMED로 판정된 소스마다 `selectors`(item/title/date/link/
      linkAttribute)와 `jsDetailLinkRule`(pattern/functionName 또는
      dataAttribute/argCount/fixedParams/urlTemplate) 후보가 확정되고,
      필요시 `officialNames`/`baseUrl` 조정 여부도 결론난다.
- [ ] CONFIRMED 소스마다 목록·상세 최소 3건 교차검증(제목 일치/날짜
      일치/대학명 언급) 결과가 기록된다.
- [ ] HOLD로 판정된 소스마다 왜 HOLD인지(robots.txt 차단, GET 비동치,
      마크업 불일치, 시간 부족 등)가 구체적으로 기록되고, HOLD가 다른
      소스 조사를 막지 않았음이 확인된다.
- [ ] CONFIRMED 소스마다 해당 블록 전체에 대한 최소 diff 수정안(초안)이
      제시된다(이번 세션에서 실제 파일 미수정).
- [ ] 메뉴/배너/공지/중복 마크업 위험 요소 식별 결과가 소스별로
      기록된다.
- [ ] 이번 조사 전 과정이 읽기 전용 GET(및 robots.txt 확인)만
      사용했고, 파일 수정/`enabled` 변경/수집·저장/preview/배포/git
      작업이 전혀 없었음이 확인된다.
- [ ] 위 결과 전체(6개 소스 각각의 CONFIRMED/HOLD, 수정안, 근거)를
      사용자에게 보고하고 승인 대기 상태로 남긴다(실제 JSON 반영과
      diagnose 실행은 승인 후 별도 단계).

# 질문사항

1. school_notice 3개(`jbnu-campus-notice`/`gnu-official-notices`/
   `dankook-university-general-notice`)를 이번 세션에서 시간이 부족해
   조사하지 못할 경우, school_news 3개 결과만으로 먼저 보고하고
   school_notice는 별도 세션으로 미뤄도 되는지 확인 부탁드립니다.
   별다른 지시가 없으면 이 우선순위(요구사항 1번)대로 진행하겠습니다.
2. 한 대학에서 school_news는 CONFIRMED, school_notice는 HOLD로(또는
   그 반대로) 결과가 갈리는 경우, CONFIRMED된 쪽만 우선 JSON 반영
   승인을 받고 HOLD된 쪽은 별도로 재조사할지, 아니면 같은 대학의 두
   소스를 항상 함께 승인받을지 확인 부탁드립니다. 별다른 지시가 없으면
   소스 단위로 독립적으로 보고하고 CONFIRMED된 것부터 개별 승인받는
   방식으로 진행하겠습니다.
