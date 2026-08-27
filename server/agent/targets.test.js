"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { isSourceCollectible, getTargetUniversities } = require("./targets");

test("isSourceCollectible requires verified=true and enabled=true for an html source", () => {
  const base = {
    collectionType: "html",
    listUrl: "https://example.ac.kr/news",
    selectors: { item: "li", title: "a", link: "a" },
  };
  assert.equal(isSourceCollectible({ ...base, verified: true, enabled: false }), false);
  assert.equal(isSourceCollectible({ ...base, verified: true, enabled: true }), true);
  assert.equal(isSourceCollectible({ ...base, verified: false, enabled: true }), false);
});

test("isSourceCollectible still requires all html selectors even when verified+enabled", () => {
  const partial = {
    collectionType: "html",
    verified: true,
    enabled: true,
    listUrl: "https://example.ac.kr/news",
    selectors: { item: "li", title: "a" }, // link 누락
  };
  assert.equal(isSourceCollectible(partial), false);
});

test("isSourceCollectible requires verified=true and enabled=true for an rss source", () => {
  const base = { collectionType: "rss", rssUrl: "https://example.ac.kr/feed.xml" };
  assert.equal(isSourceCollectible({ ...base, verified: true, enabled: false }), false);
  assert.equal(isSourceCollectible({ ...base, verified: true, enabled: true }), true);
  assert.equal(isSourceCollectible({ ...base, verified: false, enabled: true }), false);
});

test("isSourceCollectible rejects an rss source without rssUrl even when verified+enabled", () => {
  assert.equal(isSourceCollectible({ collectionType: "rss", verified: true, enabled: true, rssUrl: "" }), false);
});

test("isSourceCollectible rejects an unknown collectionType even when verified+enabled", () => {
  assert.equal(isSourceCollectible({ collectionType: "custom_html", verified: true, enabled: true }), false);
});

test("getTargetUniversities only returns sources that are both verified and enabled", () => {
  const targets = getTargetUniversities();
  assert.ok(targets.length > 0, "expected at least one target university from the real sources file");
  for (const university of targets) {
    for (const source of university.sources) {
      assert.equal(source.verified, true, `${university.universityId}/${source.id} must be verified`);
      assert.equal(source.enabled, true, `${university.universityId}/${source.id} must be enabled`);
    }
  }
});

test("getTargetUniversities includes KAIST now that its source is enabled=true", () => {
  const targets = getTargetUniversities();
  const kaist = targets.find((university) => university.universityId === "kaist-daejeon");
  assert.ok(kaist, "kaist-daejeon must appear in collection targets once its source is enabled=true");
  assert.equal(kaist.sources.length, 1);
  assert.equal(kaist.sources[0].id, "kaist-official-news");
  assert.equal(kaist.sources[0].enabled, true);
});
