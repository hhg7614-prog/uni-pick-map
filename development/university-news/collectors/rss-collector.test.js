"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { rssCollector } = require("./rss-collector");

// -----------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------

const UNIVERSITY = {
  universityId: "test-university",
  universityGroupId: "test-university-group",
  universityName: "테스트대학교",
  campusName: "",
};

// rssCollector() defaults collectedAt to `new Date().toISOString()`, evaluated
// fresh on every call. Pin it so repeated runs stay deterministic, matching the
// html-list-collector.test.js convention.
const FIXED_COLLECTED_AT = "2026-01-01T00:00:00.000Z";

function fetchStub(xml, url) {
  return async () => ({ ok: true, url, text: async () => xml });
}

function makeSource(overrides = {}) {
  return {
    collectionType: "rss",
    id: "test-rss-source",
    name: "테스트 공지",
    category: "school_notice",
    categoryLabel: "학교 공지사항",
    rssUrl: "https://www.example.ac.kr/rss/allBoard.do",
    baseUrl: "https://www.example.ac.kr",
    datePolicy: {},
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// (a) CDATA-wrapped title + link (uos form): the regression this fix targets.
//     Before the fix, tagValue() matched the whole `<![CDATA[ ... ]]>` block as
//     a single tag and stripped it, leaving title/link empty -> items.length 0.
//     After the fix, CDATA is unwrapped first so the value survives.
// -----------------------------------------------------------------------

test("(a) CDATA-wrapped title and link (uos form) are extracted, title/sourceUrl truthy", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[2026학년도 2학기 수강신청 안내]]></title>
    <link><![CDATA[https://www.uos.ac.kr/korNotice/view.do?seq=12345]]></link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description><![CDATA[<p>수강신청 <span>기간</span> 안내입니다.</p>]]></description>
  </item>
</channel></rss>`;

  const source = makeSource({
    rssUrl: "https://www.uos.ac.kr/rss/allBoard.do",
    baseUrl: "https://www.uos.ac.kr",
  });
  const result = await rssCollector({
    university: UNIVERSITY,
    source,
    limit: 10,
    fetchImpl: fetchStub(xml, source.rssUrl),
    collectedAt: FIXED_COLLECTED_AT,
  });

  assert.equal(result.status, "success");
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].title);
  assert.ok(result.items[0].sourceUrl);
  assert.equal(result.items[0].title, "2026학년도 2학기 수강신청 안내");
  assert.equal(result.items[0].sourceUrl, "https://www.uos.ac.kr/korNotice/view.do?seq=12345");
  assert.equal(result.items[0].summary, "수강신청 기간 안내입니다.");
  assert.ok(!result.warnings.some((warning) => /제목 또는 원문 링크가 없어 제외/.test(warning)));
});

// -----------------------------------------------------------------------
// (b) bare text title + link (gnu form): regression guard, must still work.
// -----------------------------------------------------------------------

test("(b) bare text title and link (gnu form) still extract, &amp; decoded", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>경상국립대학교 개교기념 학술대회 개최</title>
    <link>https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=98765&amp;bbsId=1028</link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description>학술대회 안내</description>
  </item>
</channel></rss>`;

  const source = makeSource({
    id: "gnu-official-notices",
    rssUrl: "https://www.gnu.ac.kr/main/na/ntt/selectRssFeed.do?mi=1126&bbsId=1028",
    baseUrl: "https://www.gnu.ac.kr",
  });
  const result = await rssCollector({
    university: UNIVERSITY,
    source,
    limit: 10,
    fetchImpl: fetchStub(xml, source.rssUrl),
    collectedAt: FIXED_COLLECTED_AT,
  });

  assert.equal(result.status, "success");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "경상국립대학교 개교기념 학술대회 개최");
  assert.equal(
    result.items[0].sourceUrl,
    "https://www.gnu.ac.kr/main/na/ntt/selectNttInfo.do?nttSn=98765&bbsId=1028"
  );
  assert.equal(result.items[0].summary, "학술대회 안내");
});

// -----------------------------------------------------------------------
// (c) Atom <link href="..."> attribute form: handled by linkValue() before
//     tagValue() is reached, so the ordering swap must not disturb it.
// -----------------------------------------------------------------------

test("(c) Atom <link href> attribute form yields sourceUrl (entry fallback)", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom 방식 공지 제목</title>
    <link href="https://news.example.ac.kr/atom/entry/1" />
    <updated>2026-08-27T09:00:00+09:00</updated>
    <summary>아톰 요약문</summary>
  </entry>
</feed>`;

  const source = makeSource({
    rssUrl: "https://news.example.ac.kr/atom.xml",
    baseUrl: "https://news.example.ac.kr",
  });
  const result = await rssCollector({
    university: UNIVERSITY,
    source,
    limit: 10,
    fetchImpl: fetchStub(xml, source.rssUrl),
    collectedAt: FIXED_COLLECTED_AT,
  });

  assert.equal(result.status, "success");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Atom 방식 공지 제목");
  assert.equal(result.items[0].sourceUrl, "https://news.example.ac.kr/atom/entry/1");
  assert.equal(result.items[0].summary, "아톰 요약문");
});

// -----------------------------------------------------------------------
// (d) description CDATA containing real HTML: tags must still be stripped,
//     leaving whitespace-normalized plain text.
// -----------------------------------------------------------------------

test("(d) description CDATA with <p>/<a> HTML is reduced to stripped plain text", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>본문 태그 제거 확인</title>
    <link>https://www.example.ac.kr/bbs/view.do?id=9</link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description><![CDATA[<p style="margin:0">본문 <a href="https://x.example">링크</a> 포함</p>]]></description>
  </item>
</channel></rss>`;

  const source = makeSource();
  const result = await rssCollector({
    university: UNIVERSITY,
    source,
    limit: 10,
    fetchImpl: fetchStub(xml, source.rssUrl),
    collectedAt: FIXED_COLLECTED_AT,
  });

  assert.equal(result.status, "success");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "본문 태그 제거 확인");
  assert.equal(result.items[0].sourceUrl, "https://www.example.ac.kr/bbs/view.do?id=9");
  assert.equal(result.items[0].summary, "본문 링크 포함");
});

// -----------------------------------------------------------------------
// Return contract stays { status, items, warnings, finalUrl }.
// -----------------------------------------------------------------------

test("rssCollector() return shape is unchanged", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>계약 확인</title>
    <link>https://www.example.ac.kr/bbs/view.do?id=1</link>
    <pubDate>Wed, 27 Aug 2026 09:00:00 +0900</pubDate>
    <description>요약</description>
  </item>
</channel></rss>`;

  const source = makeSource();
  const result = await rssCollector({
    university: UNIVERSITY,
    source,
    limit: 10,
    fetchImpl: fetchStub(xml, "https://www.example.ac.kr/rss/final.do"),
    collectedAt: FIXED_COLLECTED_AT,
  });

  assert.deepEqual(Object.keys(result).sort(), ["finalUrl", "items", "status", "warnings"]);
  assert.equal(result.finalUrl, "https://www.example.ac.kr/rss/final.do");
});
