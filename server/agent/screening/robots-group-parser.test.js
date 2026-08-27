"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseRobotsGroups } = require("./robots-group-parser");

// Real robots.txt body observed at www.knue.ac.kr (Korea National
// University of Education). ClaudeBot is one of ten consecutive
// User-agent lines that share a single `Disallow: /` directive.
const KNUE_ROBOTS_TXT = [
  "User-agent: GPTBot",
  "User-agent: OAI-SearchBot",
  "User-agent: ChatGPT-User",
  "User-agent: ClaudeBot",
  "User-agent: CCBot",
  "User-agent: PerplexityBot",
  "User-agent: Google-Extended",
  "User-agent: Applebot-Extended",
  "User-agent: Bytespider",
  "User-agent: Meta-ExternalAgent",
  "Disallow: /",
].join("\n");

// A parser that only remembers the *last* User-agent line seen before a
// directive (the bug that shipped before this module existed). Kept here
// purely to demonstrate, with an assertion, that the bug is fixed: this
// legacy behavior and the real parser disagree on the KNUE fixture.
function legacySingleUaParser(text) {
  const lines = String(text || "").split(/\r?\n/);
  const groups = [];
  let lastUa = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const uaMatch = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (uaMatch) {
      lastUa = uaMatch[1].trim();
      continue;
    }
    const disallowMatch = line.match(/^disallow\s*:\s*(.*)$/i);
    if (disallowMatch && lastUa) {
      groups.push({ uas: [lastUa], disallows: [disallowMatch[1].trim()] });
    }
  }
  return groups;
}

test("KNUE fixture: all 10 consecutive User-agent lines form a single group with Disallow: /", () => {
  const groups = parseRobotsGroups(KNUE_ROBOTS_TXT);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].uas, [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "CCBot",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "Bytespider",
    "Meta-ExternalAgent",
  ]);
  assert.equal(groups[0].disallowsRoot, true);
  assert.ok(groups[0].uas.includes("ClaudeBot"));
});

test("regression: legacySingleUaParser loses ClaudeBot's Disallow: / on the KNUE fixture, the real parser does not", () => {
  const legacyGroups = legacySingleUaParser(KNUE_ROBOTS_TXT);
  const realGroups = parseRobotsGroups(KNUE_ROBOTS_TXT);

  // The legacy parser only ever attaches a directive to the single most
  // recent User-agent line (Meta-ExternalAgent here), so it never produces
  // a group containing ClaudeBot at all.
  const legacyHasClaudeBotGroup = legacyGroups.some((group) => group.uas.includes("ClaudeBot"));
  const realHasClaudeBotGroup = realGroups.some((group) => group.uas.includes("ClaudeBot") && group.disallowsRoot);

  assert.equal(legacyHasClaudeBotGroup, false, "legacy parser incorrectly drops ClaudeBot from any Disallow: / group");
  assert.equal(realHasClaudeBotGroup, true, "real parser correctly keeps ClaudeBot in the Disallow: / group");
});

test("a single User-agent group with Disallow: / is parsed correctly", () => {
  const groups = parseRobotsGroups("User-agent: *\nDisallow: /\n");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].uas, ["*"]);
  assert.equal(groups[0].disallowsRoot, true);
});

test("a directive closes the current group so a later User-agent line starts a new group", () => {
  const text = ["User-agent: GPTBot", "Disallow: /private/", "User-agent: ClaudeBot", "Disallow: /"].join("\n");
  const groups = parseRobotsGroups(text);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].uas, ["GPTBot"]);
  assert.equal(groups[0].disallowsRoot, false);
  assert.deepEqual(groups[1].uas, ["ClaudeBot"]);
  assert.equal(groups[1].disallowsRoot, true);
});

test("comments and blank lines are ignored and do not break a consecutive User-agent run", () => {
  const text = ["# comment above", "User-agent: GPTBot", "", "# another comment", "User-agent: ClaudeBot", "Disallow: / # block everything"].join("\n");
  const groups = parseRobotsGroups(text);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].uas, ["GPTBot", "ClaudeBot"]);
  assert.equal(groups[0].disallowsRoot, true);
});

test("Allow-only groups do not set disallowsRoot", () => {
  const groups = parseRobotsGroups("User-agent: Googlebot\nAllow: /\n");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].disallowsRoot, false);
  assert.deepEqual(groups[0].allows, ["/"]);
});

test("an empty or whitespace-only robots.txt body yields no groups", () => {
  assert.deepEqual(parseRobotsGroups(""), []);
  assert.deepEqual(parseRobotsGroups("   \n\n  "), []);
  assert.deepEqual(parseRobotsGroups(undefined), []);
});
