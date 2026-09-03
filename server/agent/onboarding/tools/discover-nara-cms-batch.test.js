"use strict";

// discover-nara-cms-batch.js 단위 테스트. 전부 오프라인:
//  - fetch 는 Map<url, {status, text}> 기반 스텁
//  - 시간/난수/sleep 은 고정 주입
//  - B1/B2 는 스텁 함수로 주입(실제 카탈로그/서브프로세스 미사용)
// 픽스처 HTML 은 인천대 Nara Info CMS 구조를 축약한 것이다.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseCliArgs,
  matchesCandidateFilter,
  isVariantCampus,
  universityHasCatalogSource,
  selectCandidates,
  extractClientRedirect,
  extractRobotsSitemapUrls,
  robotsSignalIndicatesNara,
  sitemapSignalIndicatesNara,
  detectNaraCms,
  extractNavBoardLinks,
  classifyBoardCategory,
  extractSitemapMenuEntries,
  prioritizeBoardCandidates,
  pickBestBoard,
  extractSiteAndBoardId,
  selectValidatedBoard,
  buildCandidateSource,
  deriveShortName,
  verifyRssFeed,
  checkRobotsPathDisallow,
  evaluateRobots,
  runPreflight,
  resolveDateSelector,
  appendCandidateAtomic,
  aggregateSummary,
  buildReport,
  loadState,
  mergeState,
  writeStateAtomic,
  createFetchGate,
  isGateBudgetError,
  runBatch,
} = require("./discover-nara-cms-batch");
const { parseRobotsGroups } = require("../../screening/robots-group-parser");

// -- fixtures ---------------------------------------------------------------

const HOST = "www.inu.ac.kr";
const ORIGIN = `https://${HOST}`;

// 홈 네비: "인천대소식"(school_news, /bbs 직접), "공지사항"(school_notice,
// /bbs 직접), "입학안내"(키워드 아님) + subview.do 패턴(Nara 탐지용).
const HOME_HTML = `<!doctype html><html><head><title>인천대학교</title></head><body>
<nav>
  <a href="${ORIGIN}/bbs/inu/2594/artclList.do">인천대소식</a>
  <a href="${ORIGIN}/bbs/inu/2595/artclList.do">공지사항</a>
  <a href="/inu/13600/subview.do">입학안내</a>
</nav>
<div><a href="/inu/13580/subview.do">대학소개</a></div>
</body></html>`;

const WORDPRESS_HOME_HTML = `<!doctype html><html><head><link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>
<body class="home wordpress"><a href="/category/news/">뉴스</a><a href="/2026/08/hello-world/">글</a></body></html>`;

const NAV_ONLY_HTML = `<ul>
<a href="${ORIGIN}/bbs/inu/2594/artclList.do">보도자료</a>
<a href="/inu/1/subview.do">공지사항</a>
<a href="/inu/2/subview.do">입학안내</a>
</ul>`;

// §테스트 계획 "신규 픽스처" -- robots.txt 의 Sitemap 라인.
const ROBOTS_WITH_SITEMAP =
  "User-agent: *\nDisallow: /admin/\nSitemap: https://www.inu.ac.kr/xmlSite/siteMap.do\n";

// §테스트 계획 "신규 픽스처" -- `{origin}/xmlSite/siteMap.do` 응답 본문.
// "입학안내"는 라벨 미매칭(classifyBoardCategory -> null) -> 필터링 확인용.
const SITEMAP_HTML =
  `<a href="/inu/13580/subview.do">인천대소식</a>` +
  `<a href="/inu/13600/subview.do">공지사항</a>` +
  `<a href="/inu/1/subview.do">입학안내</a>`;

// §테스트 계획 "신규 픽스처" -- items.length===0 RSS(빈 게시판 재현, 공주대
// 2134 유사).
const EMPTY_BOARD_RSS_XML =
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>공지사항</title></channel></rss>`;

function rssXml(titles) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>보도자료</title>` +
    titles
      .map(
        (title, i) =>
          `<item><title><![CDATA[${title}]]></title>` +
          `<link>${ORIGIN}/bbs/inu/2594/10000${i + 1}/artclView.do</link>` +
          `<pubDate>2026-08-1${i + 1}</pubDate><description>본문 ${i + 1}</description></item>`
      )
      .join("") +
    `</channel></rss>`
  );
}

function detailHtml(title, { date = "dl.write", value = "2026.08.20" } = {}) {
  const dateBlock =
    date === "dl.write"
      ? `<dl class="write"><dt>작성일</dt><dd>${value}</dd></dl>`
      : `<div class="artclInfo"><span class="date">${value}</span></div>`;
  return `<html><body><h2 class="view-title">${title}</h2>${dateBlock}
<div class="writer">인천대학교 홍보실</div><p>본문 내용</p></body></html>`;
}

const UNIVERSITY = {
  universityId: "incheon-national-university-본교",
  universityGroupId: "incheon-national-university-본교",
  universityName: "인천대학교",
  campusName: "본교",
};

const FIXED_NOW = () => new Date(2026, 7, 31, 10, 0, 0);
const NOOP_SLEEP = async () => {};

function stubFetch(map) {
  return async (url) => {
    const key = String(url);
    if (!map.has(key)) return { ok: false, status: 404, url: key, text: async () => "not found" };
    const entry = map.get(key);
    const status = entry.status || 200;
    return { ok: status >= 200 && status < 300, status, url: entry.finalUrl || key, text: async () => entry.text };
  };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// -- 1. matchesCandidateFilter --------------------------------------------

test("1. matchesCandidateFilter: homeStatus/robots/cat 조합", () => {
  const row = (homeStatus, robots, cat) => ({ homeStatus, robots, cat });
  assert.equal(matchesCandidateFilter(row("200", "ok", "NO_SOURCE")), true);
  assert.equal(matchesCandidateFilter(row("201", "ok", "NO_SOURCE")), true);
  assert.equal(matchesCandidateFilter(row("204", "none(404)", "SOURCE_UNVERIFIED")), true);
  assert.equal(matchesCandidateFilter(row("302", "ok", "NO_SOURCE")), false);
  assert.equal(matchesCandidateFilter(row("404", "ok", "NO_SOURCE")), false);
  assert.equal(matchesCandidateFilter(row("ERR:ECONNRESET", "ok", "NO_SOURCE")), false);
  assert.equal(matchesCandidateFilter(row("000", "ok", "NO_SOURCE")), false);
  assert.equal(matchesCandidateFilter(row("200", "AI_BLOCKED", "NO_SOURCE")), false);
  assert.equal(matchesCandidateFilter(row("200", "not-robots(html)", "NO_SOURCE")), false);
  assert.equal(matchesCandidateFilter(row("200", "ok", "ACTIVE")), false);
  assert.equal(matchesCandidateFilter(row("200", "ok", "SOURCE_DISABLED")), false);
  assert.equal(matchesCandidateFilter(row("200", "ok", "SOURCE_UNVERIFIED")), true);
});

// -- 2. isVariantCampus ---------------------------------------------------

test("2. isVariantCampus: 본교가 소스 보유 시에만 변형 캠퍼스 제외", () => {
  const catalog = {
    universities: [
      { universityId: "gyeongdong-university-본교", sources: [{ id: "x" }] },
      { universityId: "gyeongdong-university-제3캠퍼", sources: [] },
    ],
  };
  const variant = { id: "gyeongdong-university-제3캠퍼", name: "경동대학교 제3캠퍼" };
  const main = { id: "gyeongdong-university-본교", name: "경동대학교" };
  assert.equal(isVariantCampus(variant, catalog), true);
  assert.equal(isVariantCampus(main, catalog), false);

  const catalogNoMainSource = {
    universities: [
      { universityId: "gyeongdong-university-본교", sources: [] },
      { universityId: "gyeongdong-university-제3캠퍼", sources: [] },
    ],
  };
  assert.equal(isVariantCampus(variant, catalogNoMainSource), false);
});

// -- 3. selectCandidates ------------------------------------------------------

test("3. selectCandidates: limit / resume / university-id", () => {
  const rows = [
    { id: "u1", name: "u1", homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
    { id: "u2", name: "u2", homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
    { id: "u3", name: "u3", homeStatus: "200", robots: "none(404)", cat: "NO_SOURCE" },
    { id: "u4", name: "u4", homeStatus: "200", robots: "ok", cat: "SOURCE_UNVERIFIED" },
    { id: "u5", name: "u5", homeStatus: "404", robots: "ok", cat: "NO_SOURCE" },
    { id: "u6", name: "u6", homeStatus: "200", robots: "AI_BLOCKED", cat: "NO_SOURCE" },
  ];
  const catalog = { universities: [] };

  assert.equal(selectCandidates(rows, catalog, { processed: [] }, { limit: 3 }).selected.length, 3);

  const state = {
    processed: [
      { universityId: "u1", finalDecision: "PACKET_CREATED" },
      { universityId: "u2", finalDecision: "NOT_NARA_CMS" },
      { universityId: "u3", finalDecision: "ERROR" },
    ],
  };
  const resumed = selectCandidates(rows, catalog, state, { limit: 10, resume: true }).selected.map((r) => r.id);
  assert.deepEqual(resumed, ["u3", "u4"]); // u1,u2 종결 제외; u3(ERROR) 재포함

  const single = selectCandidates(rows, catalog, { processed: [] }, { universityId: "u2" });
  assert.equal(single.selected.length, 1);
  assert.equal(single.selected[0].id, "u2");

  const filteredSingle = selectCandidates(rows, catalog, { processed: [] }, { universityId: "u5" });
  assert.equal(filteredSingle.selected.length, 0);
  assert.equal(filteredSingle.preSkipped[0].finalDecision, "FILTERED_OUT");
});

// -- 4. detectNaraCms -------------------------------------------------------

test("4. detectNaraCms: subview.do / same-host /bbs/ 는 Nara, 워드프레스·cross-host 는 아님", () => {
  const a = detectNaraCms('<a href="/inu/13580/subview.do">소개</a>', { host: HOST });
  const b = detectNaraCms(`<a href="${ORIGIN}/bbs/inu/2594/">소식</a>`, { host: HOST });
  const c = detectNaraCms(WORDPRESS_HOME_HTML, { host: HOST });
  assert.equal(a.isNara, true);
  assert.equal(b.isNara, true);
  assert.equal(c.isNara, false);
  assert.ok(a.evidence.length > 0);
  assert.ok(b.evidence.length > 0);

  // F2: 형제 서브도메인(도서관 등)의 /bbs/ 링크는 증거로 인정하지 않는다.
  const crossHost = detectNaraCms(
    '<a href="https://lib.daegu.ac.kr/bbs/content/1_57524">도서관</a><a href="/article/DG56/detail/1">기사</a>',
    { host: "www.daegu.ac.kr" }
  );
  assert.equal(crossHost.isNara, false);

  const sameHost = detectNaraCms('<a href="https://www.daegu.ac.kr/bbs/daegu/123/artclList.do">뉴스</a>', {
    host: "www.daegu.ac.kr",
  });
  assert.equal(sameHost.isNara, true);

  // 상대 경로 href 는 같은 host 로 간주.
  const relative = detectNaraCms('<a href="/bbs/daegu/123/artclList.do">뉴스</a>', { host: "www.daegu.ac.kr" });
  assert.equal(relative.isNara, true);
});

// -- 4b. extractClientRedirect --------------------------------------------

test("4b. extractClientRedirect: meta-refresh / JS location / 실제 콘텐츠는 null", () => {
  const base = `${ORIGIN}/`;

  // meta-refresh: url= 포함, 절대 URL (포트 443 정규화)
  assert.equal(
    extractClientRedirect(`<meta http-equiv="refresh" content="0;url=${ORIGIN}:443/inu/index.do">`, base),
    `${ORIGIN}/inu/index.do`
  );
  // meta-refresh: 따옴표 없는 속성 + 상대 경로 + 공백
  assert.equal(
    extractClientRedirect("<meta http-equiv=refresh content=\"0; url=/KNU/index.do\">", base),
    `${ORIGIN}/KNU/index.do`
  );
  // meta-refresh: url= 없이 세미콜론 뒤 경로만
  assert.equal(
    extractClientRedirect('<meta http-equiv="refresh" content="0; /main/index.do">', base),
    `${ORIGIN}/main/index.do`
  );
  // JS location.href (얇은 스텁)
  assert.equal(extractClientRedirect('<script>location.href="/KNU/index.do"</script>', base), `${ORIGIN}/KNU/index.do`);
  // JS location.replace (얇은 스텁, 타 도메인)
  assert.equal(
    extractClientRedirect('<script>location.replace("https://www.gknu.ac.kr/main/index.do")</script>', base),
    "https://www.gknu.ac.kr/main/index.do"
  );
  // 순수 지연(숫자만) -> 리다이렉트 아님
  assert.equal(extractClientRedirect('<meta http-equiv="refresh" content="5">', base), null);
  // 실제 콘텐츠 페이지(링크 다수 + 본문) -> null (meta 있어도 무시)
  const realContent =
    `<meta http-equiv="refresh" content="600">` +
    "<nav>" +
    ["a", "b", "c", "d", "e", "f"].map((s) => `<a href="/${s}">${s}</a>`).join("") +
    "</nav>" +
    `<main>${"실제 본문 내용 ".repeat(80)}</main>`;
  assert.equal(extractClientRedirect(realContent, base), null);
  // 본문이 두꺼운 페이지의 JS location -> 스텁 아님 -> null
  assert.equal(extractClientRedirect(`<body>${"y".repeat(500)}<script>location.href="/z"</script></body>`, base), null);
});

// -- 5. extractNavBoardLinks + classifyBoardCategory -----------------------

test("5. extractNavBoardLinks + classifyBoardCategory", () => {
  const links = extractNavBoardLinks(HOME_HTML);
  assert.equal(links.length, 2); // 입학안내(키워드 아님) 제외
  assert.deepEqual(
    links.map((l) => l.text),
    ["인천대소식", "공지사항"]
  );
  assert.equal(classifyBoardCategory("보도자료"), "school_news");
  assert.equal(classifyBoardCategory("공지사항"), "school_notice");
  assert.equal(classifyBoardCategory("입학안내"), null);
});

// -- 6. pickBestBoard -----------------------------------------------------

test("6. pickBestBoard: school_news 우선, 없으면 notice, 둘 다 없으면 null", () => {
  const notice = { site: "inu", boardId: "2595", category: "school_notice" };
  const news = { site: "inu", boardId: "2594", category: "school_news" };
  assert.equal(pickBestBoard([notice, news]).boardId, "2594");
  assert.equal(pickBestBoard([notice]).boardId, "2595");
  assert.equal(pickBestBoard([notice]).category, "school_notice");
  assert.equal(pickBestBoard([{ site: "inu", boardId: "1", category: null }]), null);
  assert.equal(pickBestBoard([]), null);
});

// -- 7. extractSiteAndBoardId --------------------------------------------

test("7. extractSiteAndBoardId", () => {
  assert.deepEqual(
    extractSiteAndBoardId(`<a href="${ORIGIN}/bbs/inu/2594/12345/artclView.do">x</a>`),
    { site: "inu", boardId: "2594" }
  );
  assert.deepEqual(extractSiteAndBoardId("https://x/bbs/kongju/778/rssList.do"), {
    site: "kongju",
    boardId: "778",
  });
  assert.equal(extractSiteAndBoardId("<p>no board here</p>"), null);
});

// -- 8. buildCandidateSource --------------------------------------------

test("8. buildCandidateSource: 확정 Nara 레시피", () => {
  const source = buildCandidateSource({
    host: HOST,
    site: "inu",
    boardId: "2594",
    category: "school_news",
    shortName: "inu",
    subviewUrl: `${ORIGIN}/inu/13580/subview.do`,
    universityName: "인천대학교",
  });
  assert.equal(source.id, "inu-press-release");
  assert.equal(source.rssUrl, "https://www.inu.ac.kr/bbs/inu/2594/rssList.do");
  assert.equal(source.baseUrl, ORIGIN);
  assert.equal(source.listUrl, `${ORIGIN}/inu/13580/subview.do`);
  assert.equal(source.detailSelectors.title, "h2.view-title");
  assert.equal(source.detailSelectors.date, "dl.write dd");
  assert.equal(source.datePolicy.prefer, "list");
  assert.equal(source.verified, false);
  assert.equal(source.enabled, false);
  assert.equal(source.category, "school_news");

  const notice = buildCandidateSource({ host: HOST, site: "inu", boardId: "2595", category: "school_notice", shortName: "inu" });
  assert.equal(notice.id, "inu-notice");
  assert.equal(notice.category, "school_notice");
});

// -- 9. verifyRssFeed ---------------------------------------------------

test("9. verifyRssFeed", () => {
  const item = (over = {}) => ({ title: "t", sourceUrl: "u", publishedAt: "2026-08-20", ...over });
  const full = verifyRssFeed({ items: [item(), item(), item()] });
  assert.equal(full.ok, true);
  assert.equal(full.itemCount, 3);

  const one = verifyRssFeed({ items: [item()] });
  assert.equal(one.ok, false);

  const noDate = verifyRssFeed({ items: [item(), item({ publishedAt: null })] });
  assert.equal(noDate.ok, false);
  assert.ok(noDate.reasons.some((r) => /pubDate/i.test(r)));
});

// -- 10. checkRobotsPathDisallow --------------------------------------

test("10. checkRobotsPathDisallow", () => {
  const paths = ["/bbs/", "/bbs/inu/", "/bbs/inu/2594/", "/bbs/inu/2594/{n}/artclView.do"];
  const groupsBbs = parseRobotsGroups("User-agent: *\nDisallow: /bbs/");
  const groupsAdmin = parseRobotsGroups("User-agent: *\nDisallow: /admin/");
  const groupsNone = parseRobotsGroups("User-agent: *\nAllow: /");
  assert.equal(checkRobotsPathDisallow(groupsBbs, paths).disallowed, true);
  assert.equal(checkRobotsPathDisallow(groupsBbs, paths).matchedRule, "/bbs/");
  assert.equal(checkRobotsPathDisallow(groupsAdmin, paths).disallowed, false);
  assert.equal(checkRobotsPathDisallow(groupsNone, paths).disallowed, false);
});

// -- 11. evaluateRobots ------------------------------------------------

test("11. evaluateRobots: policy blocked / path disallow / 404 / unavailable", () => {
  const paths = ["/bbs/", "/bbs/inu/", "/bbs/inu/2594/", "/bbs/inu/2594/{n}/artclView.do"];
  const { classifyRobotsFetchResult } = require("../../tools/screen-selector-required-sources");

  const aiBody = "User-agent: ClaudeBot\nUser-agent: GPTBot\nDisallow: /";
  const aiEvidence = classifyRobotsFetchResult({ status: 200, finalUrl: `${ORIGIN}/robots.txt`, error: null, body: aiBody });
  assert.equal(evaluateRobots({ ...aiEvidence, groups: parseRobotsGroups(aiBody) }, { paths }).verdict, "ROBOTS_BLOCKED");

  const pathBody = "User-agent: *\nDisallow: /bbs/";
  const pathEvidence = classifyRobotsFetchResult({ status: 200, finalUrl: `${ORIGIN}/robots.txt`, error: null, body: pathBody });
  assert.equal(evaluateRobots({ ...pathEvidence, groups: parseRobotsGroups(pathBody) }, { paths }).verdict, "ROBOTS_BLOCKED");

  const notFound = classifyRobotsFetchResult({ status: 404, finalUrl: `${ORIGIN}/robots.txt`, error: null, body: "" });
  assert.equal(evaluateRobots({ ...notFound, groups: [] }, { paths }).verdict, "OK");

  const unavailable = classifyRobotsFetchResult({ status: 500, finalUrl: `${ORIGIN}/robots.txt`, error: null, body: "" });
  const verdict = evaluateRobots({ ...unavailable, groups: [] }, { paths });
  assert.equal(verdict.verdict, "ROBOTS_BLOCKED");
  assert.equal(verdict.reason, "ROBOTS_UNAVAILABLE");
});

// -- 12. resolveDateSelector -----------------------------------------

test("12. resolveDateSelector: 폴백 셀렉터 채택 / 전부 실패 시 null", () => {
  const base = { detailSelectors: { title: "h2.view-title", date: "dl.write dd" }, datePolicy: { prefer: "list" } };
  const htmls = [
    detailHtml("제목 1", { date: "artclInfo", value: "2026.08.20" }),
    detailHtml("제목 2", { date: "artclInfo", value: "2026.08.21" }),
  ];
  const resolved = resolveDateSelector(htmls, [null, null], base);
  assert.equal(resolved.selector, ".artclInfo .date");
  assert.ok(resolved.publishedAtByIndex.filter(Boolean).length >= 2);

  const none = resolveDateSelector(["<p>no date anywhere</p>", "<p>still nothing</p>"], [null, null], base);
  assert.equal(none, null);
});

// -- 13. runPreflight -----------------------------------------------------

test("13. runPreflight: happy path / 제목 불일치 / storable 부족", async () => {
  const titles = ["인천대 소식 1", "인천대 소식 2", "인천대 소식 3"];
  const source = buildCandidateSource({
    host: HOST,
    site: "inu",
    boardId: "2594",
    category: "school_news",
    shortName: "inu",
    universityName: "인천대학교",
  });

  const okMap = new Map();
  okMap.set(source.rssUrl, { text: rssXml(titles) });
  titles.forEach((t, i) => okMap.set(`${ORIGIN}/bbs/inu/2594/10000${i + 1}/artclView.do`, { text: detailHtml(t) }));
  const gateOk = createFetchGate({ fetchImpl: stubFetch(okMap), now: () => 0, sleepImpl: NOOP_SLEEP, maxRequests: 20 });
  const happy = await runPreflight({ university: UNIVERSITY, source, limit: 3, fetchGate: gateOk });
  assert.equal(happy.ok, true);
  assert.equal(happy.acceptedCount, 3);

  const mismatchMap = new Map(okMap);
  titles.forEach((t, i) =>
    mismatchMap.set(`${ORIGIN}/bbs/inu/2594/10000${i + 1}/artclView.do`, { text: detailHtml("전혀 다른 상세 제목") })
  );
  const gateMismatch = createFetchGate({ fetchImpl: stubFetch(mismatchMap), now: () => 0, sleepImpl: NOOP_SLEEP, maxRequests: 20 });
  const mismatch = await runPreflight({ university: UNIVERSITY, source, limit: 3, fetchGate: gateMismatch });
  assert.equal(mismatch.ok, false);
  assert.ok(/mismatch/.test(mismatch.reason));

  const oneGoodMap = new Map();
  oneGoodMap.set(source.rssUrl, { text: rssXml(titles) });
  oneGoodMap.set(`${ORIGIN}/bbs/inu/2594/100001/artclView.do`, { text: detailHtml(titles[0]) });
  oneGoodMap.set(`${ORIGIN}/bbs/inu/2594/100002/artclView.do`, { text: detailHtml("다른 제목 2") });
  oneGoodMap.set(`${ORIGIN}/bbs/inu/2594/100003/artclView.do`, { text: detailHtml("다른 제목 3") });
  const gateOne = createFetchGate({ fetchImpl: stubFetch(oneGoodMap), now: () => 0, sleepImpl: NOOP_SLEEP, maxRequests: 20 });
  const one = await runPreflight({ university: UNIVERSITY, source, limit: 3, fetchGate: gateOne });
  assert.equal(one.ok, false);
  assert.ok(one.acceptedCount < 2);
});

// -- 14. createFetchGate ------------------------------------------------

test("14. createFetchGate: crawl-delay / 요청 예산 / 타임아웃 abort", async () => {
  const sleeps = [];
  const okFetch = async () => ({ ok: true, status: 200, url: "x", text: async () => "ok" });
  const gate = createFetchGate({
    fetchImpl: okFetch,
    maxRequests: 8, // maxRequests 기본값이 8->18 로 바뀌었으므로 소규모 시나리오를 오버라이드(N10 이 새 기본값 자체를 커버)
    now: () => 0,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  await gate.fetch("https://a/1");
  await gate.fetch("https://a/2");
  assert.equal(sleeps[0], 500); // 경과 0 -> 500ms 대기
  assert.equal(gate.count, 2);

  for (let i = 3; i <= 8; i += 1) await gate.fetch(`https://a/${i}`);
  await assert.rejects(() => gate.fetch("https://a/9"), /request_budget_exceeded/);

  const abortGate = createFetchGate({
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    timeoutMs: 1,
    now: () => 0,
    sleepImpl: NOOP_SLEEP,
  });
  await assert.rejects(() => abortGate.fetch("https://slow/1"), /aborted/);
});

// -- 15. appendCandidateAtomic ----------------------------------------

test("15. appendCandidateAtomic: append / 중복 no-op / 백업", () => {
  const dir = tempDir("nara-cand-");
  const file = path.join(dir, "collector-config-candidates.json");
  fs.writeFileSync(file, `${JSON.stringify({ generatedAt: null, items: [] }, null, 2)}\n`, "utf8");

  const entry = {
    universityId: "incheon-national-university-본교",
    universityName: "인천대학교",
    finalDecision: "COLLECTOR_CONFIG_READY",
    source: { id: "inu-press-release" },
  };
  assert.equal(appendCandidateAtomic(file, entry).appended, true);
  let data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.items.length, 1);

  const second = appendCandidateAtomic(file, entry);
  assert.equal(second.appended, false);
  data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.items.length, 1);

  const backups = fs.readdirSync(path.join(dir, "..", "backups")).filter((n) => n.includes("collector-config-candidates.json"));
  assert.ok(backups.length >= 1);
});

// -- 16. aggregateSummary --------------------------------------------

test("16. aggregateSummary: finalDecision 분포 집계", () => {
  const results = [
    { finalDecision: "PACKET_CREATED" },
    { finalDecision: "PACKET_CREATED" },
    { finalDecision: "NOT_NARA_CMS" },
    { finalDecision: "ROBOTS_BLOCKED" },
    { finalDecision: "DIAGNOSE_FAILED" },
    { finalDecision: "DIAGNOSE_FAILED_POST_B1" },
    { finalDecision: "BLOCK_MISSING" },
    { finalDecision: "SOURCE_ALREADY_EXISTS" },
    { finalDecision: "SKIPPED_VARIANT_CAMPUS" },
    { finalDecision: "ERROR" },
  ];
  const summary = aggregateSummary(results);
  assert.equal(summary.processed, 10);
  assert.equal(summary.packetsCreated, 2);
  assert.equal(summary.notNaraCms, 1);
  assert.equal(summary.robotsBlocked, 1);
  assert.equal(summary.diagnoseFailed, 2); // DIAGNOSE_FAILED + DIAGNOSE_FAILED_POST_B1
  assert.equal(summary.blockMissing, 1);
  assert.equal(summary.sourceAlreadyExists, 1);
  assert.equal(summary.variantCampus, 1);
  assert.equal(summary.error, 1);
});

// -- 17. loadState / mergeState / writeStateAtomic -------------------

test("17. state: 기본 / upsert / 원자적 쓰기", () => {
  const dir = tempDir("nara-state-");
  const file = path.join(dir, "nara-cms-batch-state.json");

  const empty = loadState(file);
  assert.deepEqual(empty, { version: 1, updatedAt: null, processed: [] });

  const merged = mergeState(empty, [{ universityId: "u1", finalDecision: "NOT_NARA_CMS", runId: "r1" }], FIXED_NOW);
  assert.equal(merged.processed.length, 1);

  const merged2 = mergeState(
    merged,
    [{ universityId: "u1", finalDecision: "PACKET_CREATED", runId: "r2", reviewId: "rvw_x" }],
    FIXED_NOW
  );
  assert.equal(merged2.processed.length, 1);
  assert.equal(merged2.processed[0].finalDecision, "PACKET_CREATED");
  assert.equal(merged2.processed[0].reviewId, "rvw_x");

  writeStateAtomic(file, merged2);
  const roundTrip = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(roundTrip.processed[0].universityId, "u1");
  assert.equal(loadState(file).processed.length, 1);
});

// -- 18. runBatch (통합, 오프라인) -----------------------------------

function integrationFixtureDir() {
  const dir = tempDir("nara-batch-");
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });

  const auditFile = path.join(dir, "audit.json");
  const catalogFile = path.join(dir, "catalog.json");
  const candidatesFile = path.join(dir, "data", "collector-config-candidates.json");
  const stateFile = path.join(dir, "data", "nara-cms-batch-state.json");
  const reportDir = path.join(dir, "reports", "nara-cms-batch");

  fs.writeFileSync(
    auditFile,
    JSON.stringify([
      { id: UNIVERSITY.universityId, name: "인천대학교", site: ORIGIN, origin: ORIGIN, homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
    ]),
    "utf8"
  );
  fs.writeFileSync(
    catalogFile,
    JSON.stringify({
      universities: [
        {
          universityId: UNIVERSITY.universityId,
          universityGroupId: UNIVERSITY.universityGroupId,
          universityName: "인천대학교",
          campusName: "본교",
          sources: [],
        },
      ],
    }),
    "utf8"
  );
  fs.writeFileSync(candidatesFile, `${JSON.stringify({ generatedAt: null, items: [] }, null, 2)}\n`, "utf8");

  const titles = ["인천대 소식 1", "인천대 소식 2", "인천대 소식 3"];
  const map = new Map();
  map.set(ORIGIN, { text: HOME_HTML });
  map.set(`${ORIGIN}/robots.txt`, { text: "User-agent: *\nDisallow: /admin/\n" });
  map.set(`${ORIGIN}/bbs/inu/2594/rssList.do`, { text: rssXml(titles) });
  titles.forEach((t, i) => map.set(`${ORIGIN}/bbs/inu/2594/10000${i + 1}/artclView.do`, { text: detailHtml(t) }));

  return { dir, auditFile, catalogFile, candidatesFile, stateFile, reportDir, map, titles };
}

test("18. runBatch: Nara 대학 -> B1/B2 1회, PACKET_CREATED, 리포트/상태 기록", async () => {
  const fx = integrationFixtureDir();
  const calls = { b1: [], b2: [] };
  const regressionEvidence = { npmTestCommand: "npm test", npmTestSummary: "tests 999, pass 999, fail 0", ranAt: "2026-08-31T00:00:00.000Z" };

  const result = await runBatch({
    limit: 10,
    runId: "20260831T100000",
    auditFile: fx.auditFile,
    catalogFile: fx.catalogFile,
    candidatesFile: fx.candidatesFile,
    stateFile: fx.stateFile,
    reportDir: fx.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fx.map),
    regressionEvidence,
    b1Impl: (args) => {
      calls.b1.push(args);
      return { status: "PREPARED" };
    },
    b2Impl: (args) => {
      calls.b2.push(args);
      return { status: "PACKET_CREATED", reviewId: "rvw_test123", writtenPath: "/tmp/rvw_test123.json" };
    },
  });

  assert.equal(calls.b1.length, 1);
  assert.equal(calls.b1[0].sourceId, "inu-press-release");
  assert.equal(calls.b2.length, 1);
  assert.equal(calls.b2[0].skipNpmTest, true);
  assert.equal(calls.b2[0].regressionEvidence, regressionEvidence);
  assert.equal(result.summary.packetsCreated, 1);
  assert.equal(result.report.results[0].finalDecision, "PACKET_CREATED");
  assert.equal(result.report.results[0].reviewId, "rvw_test123");
  assert.equal(result.report.mutation.enabled, false);

  assert.ok(fs.existsSync(path.join(fx.reportDir, "20260831T100000.json")));
  const state = JSON.parse(fs.readFileSync(fx.stateFile, "utf8"));
  assert.equal(state.processed[0].universityId, UNIVERSITY.universityId);
  assert.equal(state.processed[0].finalDecision, "PACKET_CREATED");

  const candidates = JSON.parse(fs.readFileSync(fx.candidatesFile, "utf8"));
  assert.equal(candidates.items.length, 1);
  assert.equal(candidates.items[0].source.id, "inu-press-release");
});

test("18b. runBatch --dry-run: B1/B2/append 0회, 리포트/상태만", async () => {
  const fx = integrationFixtureDir();
  const calls = { b1: [], b2: [] };

  const result = await runBatch({
    limit: 10,
    dryRun: true,
    runId: "20260831T110000",
    auditFile: fx.auditFile,
    catalogFile: fx.catalogFile,
    candidatesFile: fx.candidatesFile,
    stateFile: fx.stateFile,
    reportDir: fx.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fx.map),
    b1Impl: (args) => {
      calls.b1.push(args);
      return { status: "PREPARED" };
    },
    b2Impl: (args) => {
      calls.b2.push(args);
      return { status: "PACKET_CREATED", reviewId: "x" };
    },
  });

  assert.equal(calls.b1.length, 0);
  assert.equal(calls.b2.length, 0);
  assert.equal(result.report.results[0].finalDecision, "PACKET_CREATED_DRYRUN");
  assert.ok(fs.existsSync(path.join(fx.reportDir, "20260831T110000.json")));
  assert.ok(fs.existsSync(fx.stateFile));
  const candidates = JSON.parse(fs.readFileSync(fx.candidatesFile, "utf8"));
  assert.equal(candidates.items.length, 0);
});

test("18c. runBatch: 홈이 리다이렉트 스텁이면 1회 따라가서 PACKET_CREATED 도달", async () => {
  const fx = integrationFixtureDir();
  const realHomeUrl = `${ORIGIN}/inu/index.do`;
  // 루트 URL 은 meta-refresh + JS 스텁만 반환, 실제 홈은 따라간 URL 에 있다.
  fx.map.set(ORIGIN, {
    text:
      `<!doctype html><html><head>` +
      `<meta http-equiv="refresh" content="0;url=${realHomeUrl}"></head>` +
      `<body><script>location.replace("${realHomeUrl}");</script></body></html>`,
  });
  fx.map.set(realHomeUrl, { text: HOME_HTML });

  const calls = { b1: [], b2: [] };
  const regressionEvidence = { npmTestCommand: "npm test", npmTestSummary: "pass 999, fail 0", ranAt: "2026-08-31T00:00:00.000Z" };

  const result = await runBatch({
    limit: 10,
    runId: "20260831T120000",
    auditFile: fx.auditFile,
    catalogFile: fx.catalogFile,
    candidatesFile: fx.candidatesFile,
    stateFile: fx.stateFile,
    reportDir: fx.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fx.map),
    regressionEvidence,
    b1Impl: (args) => {
      calls.b1.push(args);
      return { status: "PREPARED" };
    },
    b2Impl: (args) => {
      calls.b2.push(args);
      return { status: "PACKET_CREATED", reviewId: "rvw_redir", writtenPath: "/tmp/rvw_redir.json" };
    },
  });

  const row = result.report.results[0];
  assert.equal(row.finalDecision, "PACKET_CREATED");
  assert.equal(row.homeResolvedUrl, realHomeUrl);
  assert.equal(calls.b1.length, 1);
  assert.equal(calls.b2.length, 1);
  assert.ok(row.requestCount <= 18, `requestCount ${row.requestCount} must stay within the per-university budget`);
});

test("18d. runBatch: 4-hop 을 다 따라가도 여전히 스텁이면 redirect_loop_or_double_stub", async () => {
  const fx = integrationFixtureDir();
  // 홈 리다이렉트를 4회까지 추종하므로, 진짜 redirect_loop 를 재현하려면
  // hop1~hop4 전부 스텁이어야 한다(N15 와 동일 취지).
  const hop1 = `${ORIGIN}/inu/hop1.do`;
  const hop2 = `${ORIGIN}/inu/hop2.do`;
  const hop3 = `${ORIGIN}/inu/hop3.do`;
  const hop4 = `${ORIGIN}/inu/hop4.do`;
  fx.map.set(ORIGIN, { text: `<script>location.href="${hop1}"</script>` });
  fx.map.set(hop1, { text: `<script>location.href="${hop2}"</script>` });
  fx.map.set(hop2, { text: `<script>location.href="${hop3}"</script>` });
  fx.map.set(hop3, { text: `<script>location.href="${hop4}"</script>` });
  fx.map.set(hop4, { text: `<meta http-equiv="refresh" content="0;url=${ORIGIN}/inu/deeper.do">` });

  const result = await runBatch({
    limit: 10,
    runId: "20260831T121500",
    auditFile: fx.auditFile,
    catalogFile: fx.catalogFile,
    candidatesFile: fx.candidatesFile,
    stateFile: fx.stateFile,
    reportDir: fx.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fx.map),
    regressionEvidence: { npmTestCommand: "npm test", npmTestSummary: "fail 0", ranAt: "x" },
    b1Impl: () => ({ status: "PREPARED" }),
    b2Impl: () => ({ status: "PACKET_CREATED", reviewId: "x" }),
  });

  const row = result.report.results[0];
  assert.equal(row.finalDecision, "NOT_NARA_CMS");
  assert.equal(row.reason, "redirect_loop_or_double_stub");
  assert.equal(row.homeResolvedUrl, hop4);
});

// -- 19. parseCliArgs ---------------------------------------------------

test("19. parseCliArgs", () => {
  assert.equal(parseCliArgs([]).limit, 10);
  assert.equal(parseCliArgs([]).minAccepted, 2);
  assert.throws(() => parseCliArgs(["--limit=abc"]), /--limit must be a positive integer/);
  assert.throws(() => parseCliArgs(["--limit=0"]), /--limit must be a positive integer/);
  const parsed = parseCliArgs(["--university-id=x", "--resume", "--dry-run", "--limit=5"]);
  assert.equal(parsed.universityId, "x");
  assert.equal(parsed.resume, true);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.limit, 5);
});

// -- 20. deriveShortName ---------------------------------------------

test("20. deriveShortName: host 첫 라벨 + 충돌 접미사", () => {
  assert.equal(deriveShortName("incheon-national-university-본교", "www.inu.ac.kr", []), "inu");
  assert.equal(deriveShortName("incheon-national-university-본교", "www.inu.ac.kr", ["inu"]), "inu-2");
  assert.equal(deriveShortName("x", "www.inu.ac.kr", ["inu", "inu-2"]), "inu-3");
});

// -- 보조: buildReport / universityHasCatalogSource ------------------

test("21. buildReport: 스키마 + mutation 플래그", () => {
  const report = buildReport({
    runId: "r1",
    startedAt: "2026-08-31T00:00:00.000Z",
    finishedAt: "2026-08-31T00:01:00.000Z",
    options: { limit: 10, universityId: null, resume: false, dryRun: false },
    results: [],
    summary: aggregateSummary([]),
    regressionEvidence: null,
  });
  assert.equal(report.tool, "discover-nara-cms-batch");
  assert.deepEqual(report.mutation, {
    enabled: false,
    verified: false,
    status: false,
    store: false,
    preview: false,
    git: false,
    deploy: false,
  });
  assert.equal(universityHasCatalogSource({ universities: [{ universityId: "u", sources: [{ id: "s" }] }] }, "u"), true);
  assert.equal(universityHasCatalogSource({ universities: [{ universityId: "u", sources: [] }] }, "u"), false);
});

// -- N1. extractRobotsSitemapUrls --------------------------------------------

test("N1. extractRobotsSitemapUrls: Sitemap 라인 추출(대소문자 무관)", () => {
  assert.deepEqual(extractRobotsSitemapUrls(ROBOTS_WITH_SITEMAP), ["https://www.inu.ac.kr/xmlSite/siteMap.do"]);
  assert.deepEqual(extractRobotsSitemapUrls("User-agent: *\nDisallow: /admin/\n"), []);
  assert.deepEqual(extractRobotsSitemapUrls("User-agent: *\nSITEMAP: https://x/sitemap.xml\n"), [
    "https://x/sitemap.xml",
  ]);
  assert.deepEqual(extractRobotsSitemapUrls(""), []);
});

// -- N2. robotsSignalIndicatesNara -------------------------------------------

test("N2. robotsSignalIndicatesNara", () => {
  assert.equal(robotsSignalIndicatesNara(["https://x/xmlSite/siteMap.do"]).matched, true);
  assert.equal(robotsSignalIndicatesNara(["https://x/sitemap.xml"]).matched, false);
  assert.equal(robotsSignalIndicatesNara(["https://x/bbs/foo/sitemap.xml"]).matched, true);
  assert.equal(robotsSignalIndicatesNara([]).matched, false);
});

// -- N3. sitemapSignalIndicatesNara ------------------------------------------

test("N3. sitemapSignalIndicatesNara", () => {
  const multi = sitemapSignalIndicatesNara(SITEMAP_HTML);
  assert.equal(multi.matched, true);
  assert.equal(multi.subviewLinkCount, 3);
  const single = sitemapSignalIndicatesNara(`<a href="/inu/13580/subview.do">인천대소식</a>`);
  assert.equal(single.matched, false);
  assert.equal(sitemapSignalIndicatesNara("").matched, false);
});

// -- N4. detectNaraCms 다중 시그널(하위호환 포함) ----------------------------

test("N4. detectNaraCms: 다중 시그널(하위호환 포함)", () => {
  // (a) 옵션 없이 기존 호출 -- 기존 테스트 #4 와 동일하게 동작해야 한다.
  const a = detectNaraCms('<a href="/inu/13580/subview.do">소개</a>', { host: HOST });
  assert.equal(a.isNara, true);
  assert.deepEqual(a.signals, { A: false, B: false, C: true });

  // (b) robotsSitemapUrls 만 매칭.
  const b = detectNaraCms(WORDPRESS_HOME_HTML, {
    host: HOST,
    robotsSitemapUrls: ["https://www.inu.ac.kr/xmlSite/siteMap.do"],
  });
  assert.equal(b.isNara, true);
  assert.equal(b.signals.A, true);
  assert.ok(b.evidence.some((e) => e.startsWith("[A]")));

  // (c) sitemapHtml 만 매칭.
  const c = detectNaraCms(WORDPRESS_HOME_HTML, { host: HOST, sitemapHtml: SITEMAP_HTML });
  assert.equal(c.isNara, true);
  assert.equal(c.signals.B, true);
  assert.ok(c.evidence.some((e) => e.startsWith("[B]")));

  // (d) 셋 다 미매칭인 워드프레스 HTML.
  const d = detectNaraCms(WORDPRESS_HOME_HTML, { host: HOST });
  assert.equal(d.isNara, false);
});

// -- N5. extractSitemapMenuEntries -------------------------------------------

test("N5. extractSitemapMenuEntries", () => {
  const entries = extractSitemapMenuEntries(SITEMAP_HTML);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { href: "/inu/13580/subview.do", site: "inu", menuId: "13580", text: "인천대소식" });
  const withCategory = entries
    .map((e) => ({ ...e, category: classifyBoardCategory(e.text) }))
    .filter((e) => e.category);
  assert.equal(withCategory.length, 2); // "입학안내"는 classifyBoardCategory 필터링에서 제외
});

// -- N6. prioritizeBoardCandidates -------------------------------------------

test("N6. prioritizeBoardCandidates: school_news 전체가 school_notice 전체보다 앞, 그룹 내 순서 유지", () => {
  const list = [
    { key: "notice1", category: "school_notice" },
    { key: "news1", category: "school_news" },
    { key: "notice2", category: "school_notice" },
    { key: "news2", category: "school_news" },
  ];
  assert.deepEqual(
    prioritizeBoardCandidates(list).map((c) => c.key),
    ["news1", "news2", "notice1", "notice2"]
  );
});

// -- N7. selectValidatedBoard -------------------------------------------------

test("N7. selectValidatedBoard: 첫 통과 후보 채택 / items=0 이면 다음 후보 / 전부 실패", async () => {
  const titles = ["소식 1", "소식 2", "소식 3"];
  const map = new Map();
  map.set(`${ORIGIN}/bbs/inu/2594/rssList.do`, { text: rssXml(titles) });
  map.set(`${ORIGIN}/bbs/inu/2595/rssList.do`, { text: EMPTY_BOARD_RSS_XML });
  const gate = createFetchGate({ fetchImpl: stubFetch(map), now: () => 0, sleepImpl: NOOP_SLEEP, maxRequests: 20 });

  // (a) 첫 후보가 바로 통과.
  const candA = [{ site: "inu", directBoardId: "2594", category: "school_news", subviewUrl: `${ORIGIN}/a` }];
  const a = await selectValidatedBoard({ candidates: candA, university: UNIVERSITY, host: HOST, origin: ORIGIN, gate });
  assert.ok(a.board);
  assert.equal(a.board.boardId, "2594");
  assert.equal(a.failures.length, 0);

  // (b) 첫 후보 items=0(EMPTY_BOARD_RSS_XML), 두 번째 후보가 통과.
  const candB = [
    { site: "inu", directBoardId: "2595", category: "school_notice", subviewUrl: `${ORIGIN}/b1` },
    { site: "inu", directBoardId: "2594", category: "school_news", subviewUrl: `${ORIGIN}/b2` },
  ];
  const b = await selectValidatedBoard({ candidates: candB, university: UNIVERSITY, host: HOST, origin: ORIGIN, gate });
  assert.ok(b.board);
  assert.equal(b.board.boardId, "2594");
  assert.equal(b.failures.length, 1);
  assert.match(b.failures[0].reason, /rss_invalid/);

  // (c) 전부 실패(둘 다 무효/미매핑).
  const candC = [
    { site: "inu", directBoardId: "2595", category: "school_notice", subviewUrl: `${ORIGIN}/c1` },
    { site: "inu", directBoardId: "9999", category: "school_notice", subviewUrl: `${ORIGIN}/c2` },
  ];
  const c = await selectValidatedBoard({ candidates: candC, university: UNIVERSITY, host: HOST, origin: ORIGIN, gate });
  assert.equal(c.board, null);
  assert.equal(c.failures.length, candC.length);
});

// -- N8. runPreflight with prefetchedRssResult -------------------------------

test("N8. runPreflight: prefetchedRssResult 를 넘기면 rssList.do 를 다시 fetch 하지 않는다", async () => {
  const titles = ["인천대 소식 1", "인천대 소식 2", "인천대 소식 3"];
  const source = buildCandidateSource({
    host: HOST,
    site: "inu",
    boardId: "2594",
    category: "school_news",
    shortName: "inu",
    universityName: "인천대학교",
  });
  const prefetchedRssResult = {
    status: "success",
    items: titles.map((t, i) => ({
      title: t,
      sourceUrl: `${ORIGIN}/bbs/inu/2594/10000${i + 1}/artclView.do`,
      publishedAt: `2026-08-1${i + 1}`,
    })),
  };
  const detailMap = new Map();
  titles.forEach((t, i) => detailMap.set(`${ORIGIN}/bbs/inu/2594/10000${i + 1}/artclView.do`, { text: detailHtml(t) }));
  // source.rssUrl 매핑을 일부러 넣지 않는다 -- 재조회 시도 시 실패하도록.
  const gate = createFetchGate({ fetchImpl: stubFetch(detailMap), now: () => 0, sleepImpl: NOOP_SLEEP, maxRequests: 20 });

  const result = await runPreflight({
    university: UNIVERSITY,
    source,
    limit: 3,
    fetchGate: gate,
    prefetchedRssResult,
  });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedCount, 3);
});

// -- N9. createFetchGate: maxElapsedMs / UNIVERSITY_TIMEOUT_EXCEEDED --------

test("N9. createFetchGate: 대학당 90s 벽시계 예산 초과 시 university_timeout_exceeded", async () => {
  const seq = [0, 50, 100, 90200];
  let i = 0;
  const now = () => seq[Math.min(i++, seq.length - 1)];
  const gate = createFetchGate({
    fetchImpl: async () => ({ ok: true, status: 200, url: "x", text: async () => "ok" }),
    now,
    sleepImpl: NOOP_SLEEP,
  });
  await gate.fetch("https://a/1");
  await assert.rejects(() => gate.fetch("https://a/2"), /university_timeout_exceeded/);
});

// -- N10. createFetchGate: 기본 maxRequests=18 --------------------------------

test("N10. createFetchGate: 기본 maxRequests=18", async () => {
  const gate = createFetchGate({
    fetchImpl: async () => ({ ok: true, status: 200, url: "x", text: async () => "ok" }),
    now: () => 0,
    sleepImpl: NOOP_SLEEP,
  });
  for (let n = 0; n < 18; n += 1) await gate.fetch(`https://a/${n}`);
  assert.equal(gate.count, 18);
  await assert.rejects(() => gate.fetch("https://a/19"), /request_budget_exceeded/);
});

// -- N11. isGateBudgetError ---------------------------------------------------

test("N11. isGateBudgetError", () => {
  const budget = new Error("x");
  budget.code = "REQUEST_BUDGET_EXCEEDED";
  const timeout = new Error("y");
  timeout.code = "UNIVERSITY_TIMEOUT_EXCEEDED";
  const other = new Error("z");
  other.code = "SOMETHING_ELSE";
  assert.equal(isGateBudgetError(budget), true);
  assert.equal(isGateBudgetError(timeout), true);
  assert.equal(isGateBudgetError(other), false);
  assert.equal(isGateBudgetError(undefined), false);
});

// -- N12. parseCliArgs --retry-decisions -------------------------------------

test("N12. parseCliArgs: --retry-decisions", () => {
  const parsed = parseCliArgs(["--retry-decisions=NOT_NARA_CMS,DIAGNOSE_FAILED"]);
  assert.deepEqual(parsed.retryDecisions, ["NOT_NARA_CMS", "DIAGNOSE_FAILED"]);
  assert.throws(() => parseCliArgs(["--retry-decisions="]), /--retry-decisions requires/);
  assert.equal(parseCliArgs([]).retryDecisions, null);
});

// -- N13. selectCandidates --retry-decisions 필터 ----------------------------

test("N13. selectCandidates: --retry-decisions 필터(--resume 동시 지정 시 무시)", () => {
  const rows = [
    { id: "u1", name: "u1", homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
    { id: "u2", name: "u2", homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
    { id: "u3", name: "u3", homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
    { id: "u4", name: "u4", homeStatus: "200", robots: "ok", cat: "NO_SOURCE" },
  ];
  const catalog = { universities: [] };
  const state = {
    processed: [
      { universityId: "u1", finalDecision: "NOT_NARA_CMS" },
      { universityId: "u2", finalDecision: "DIAGNOSE_FAILED" },
      { universityId: "u3", finalDecision: "PACKET_CREATED" },
      // u4: 상태 없음(한 번도 처리 안 됨) -- 자동으로 제외되어야 한다.
    ],
  };
  const result = selectCandidates(rows, catalog, state, {
    limit: 10,
    retryDecisions: ["NOT_NARA_CMS", "DIAGNOSE_FAILED"],
    resume: true, // 동시 지정 -- retryDecisions 우선(§G), resume 은 무시된다.
  });
  assert.deepEqual(
    result.selected.map((r) => r.id),
    ["u1", "u2"]
  );
});

// -- N14. processUniversity(runBatch): 4-hop 리다이렉트 끝에 실콘텐츠 도달 ----

test("N14. runBatch: 4-hop 리다이렉트를 전부 따라간 뒤 실콘텐츠 도달 시 정상 진행", async () => {
  const fx = integrationFixtureDir();
  const hop1 = `${ORIGIN}/inu/hop1.do`;
  const hop2 = `${ORIGIN}/inu/hop2.do`;
  const hop3 = `${ORIGIN}/inu/hop3.do`;
  fx.map.set(ORIGIN, { text: `<script>location.href="${hop1}"</script>` });
  fx.map.set(hop1, { text: `<script>location.href="${hop2}"</script>` });
  fx.map.set(hop2, { text: `<script>location.href="${hop3}"</script>` });
  fx.map.set(hop3, { text: HOME_HTML }); // 4번째(마지막) hop 에서 실콘텐츠 도달

  const result = await runBatch({
    limit: 10,
    dryRun: true,
    runId: "N14",
    auditFile: fx.auditFile,
    catalogFile: fx.catalogFile,
    candidatesFile: fx.candidatesFile,
    stateFile: fx.stateFile,
    reportDir: fx.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fx.map),
  });

  const row = result.report.results[0];
  assert.notEqual(row.finalDecision, "NOT_NARA_CMS");
  assert.equal(row.finalDecision, "PACKET_CREATED_DRYRUN");
  assert.equal(row.homeResolvedUrl, hop3);
});

// -- N15. processUniversity(runBatch): 4-hop 넘어도 계속 스텁 ----------------

test("N15. runBatch: 4-hop 을 넘어도 계속 스텁이면 redirect_loop_or_double_stub", async () => {
  const fx = integrationFixtureDir();
  const hop1 = `${ORIGIN}/inu/r1.do`;
  const hop2 = `${ORIGIN}/inu/r2.do`;
  const hop3 = `${ORIGIN}/inu/r3.do`;
  const hop4 = `${ORIGIN}/inu/r4.do`;
  fx.map.set(ORIGIN, { text: `<meta http-equiv="refresh" content="0;url=${hop1}">` });
  fx.map.set(hop1, { text: `<meta http-equiv="refresh" content="0;url=${hop2}">` });
  fx.map.set(hop2, { text: `<meta http-equiv="refresh" content="0;url=${hop3}">` });
  fx.map.set(hop3, { text: `<meta http-equiv="refresh" content="0;url=${hop4}">` });
  fx.map.set(hop4, { text: `<script>location.href="${ORIGIN}/inu/r5.do"</script>` });

  const result = await runBatch({
    limit: 10,
    runId: "N15",
    auditFile: fx.auditFile,
    catalogFile: fx.catalogFile,
    candidatesFile: fx.candidatesFile,
    stateFile: fx.stateFile,
    reportDir: fx.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fx.map),
    regressionEvidence: { npmTestCommand: "npm test", npmTestSummary: "fail 0", ranAt: "x" },
    b1Impl: () => ({ status: "PREPARED" }),
    b2Impl: () => ({ status: "PACKET_CREATED", reviewId: "x" }),
  });

  const row = result.report.results[0];
  assert.equal(row.finalDecision, "NOT_NARA_CMS");
  assert.equal(row.reason, "redirect_loop_or_double_stub");
  assert.equal(row.homeResolvedUrl, hop4);
});

// -- N16. 게시판 후보 소스 -- sitemap 우선 + nav 폴백 ------------------------

test("N16. runBatch: sitemap 200+유효 메뉴 -> sitemap 기반 / sitemap 404 -> nav 폴백", async () => {
  // (a) sitemap 200 + 유효 메뉴.
  const fxA = integrationFixtureDir();
  fxA.map.set(`${ORIGIN}/xmlSite/siteMap.do`, { text: SITEMAP_HTML });
  fxA.map.set(`${ORIGIN}/inu/13580/subview.do`, {
    text: `<html><body><a href="${ORIGIN}/bbs/inu/2594/artclList.do">인천대소식</a></body></html>`,
  });
  fxA.map.set(`${ORIGIN}/inu/13600/subview.do`, {
    text: `<html><body><a href="${ORIGIN}/bbs/inu/2595/artclList.do">공지사항</a></body></html>`,
  });

  const resultA = await runBatch({
    limit: 10,
    dryRun: true,
    runId: "N16a",
    auditFile: fxA.auditFile,
    catalogFile: fxA.catalogFile,
    candidatesFile: fxA.candidatesFile,
    stateFile: fxA.stateFile,
    reportDir: fxA.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fxA.map),
  });
  const rowA = resultA.report.results[0];
  assert.equal(rowA.finalDecision, "PACKET_CREATED_DRYRUN");
  assert.equal(rowA.boardSource, "sitemap");
  assert.equal(rowA.site, "inu");
  assert.equal(rowA.boardId, "2594");

  // (b) sitemap 404(xmlSite/siteMap.do 매핑 없음) -- nav 기반으로도 기존과 동일하게 성공.
  const fxB = integrationFixtureDir();
  const resultB = await runBatch({
    limit: 10,
    dryRun: true,
    runId: "N16b",
    auditFile: fxB.auditFile,
    catalogFile: fxB.catalogFile,
    candidatesFile: fxB.candidatesFile,
    stateFile: fxB.stateFile,
    reportDir: fxB.reportDir,
    now: FIXED_NOW,
    sleepImpl: NOOP_SLEEP,
    fetchImpl: stubFetch(fxB.map),
  });
  const rowB = resultB.report.results[0];
  assert.equal(rowB.finalDecision, "PACKET_CREATED_DRYRUN");
  assert.equal(rowB.boardSource, "nav");
});
