"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { emblemForUniversityId, loadUniversities } = require("./university-directory");

test("emblemForUniversityId returns a real logo path for a school with a verified emblem", () => {
  const emblem = emblemForUniversityId("seoul-national-university-gwanak");
  assert.ok(emblem, "expected a non-empty emblem path");
  assert.match(emblem, /^assets\/university-logos\//);
});

test("emblemForUniversityId returns null when the school only has the placeholder emblem", () => {
  const universities = loadUniversities();
  const withPlaceholder = universities.find((u) => /placeholder-emblem/.test(u.emblem || ""));
  assert.ok(withPlaceholder, "expected at least one university still on the placeholder emblem");
  assert.equal(emblemForUniversityId(withPlaceholder.id), null);
});

test("emblemForUniversityId returns null for an unknown university id", () => {
  assert.equal(emblemForUniversityId("does-not-exist"), null);
});
