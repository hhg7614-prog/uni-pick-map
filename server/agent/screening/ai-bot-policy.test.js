"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseRobotsGroups } = require("./robots-group-parser");
const { AI_CRAWLER_TRIGGER_BOTS, SOFT_AI_CRAWLER_BOTS, INFORMATIONAL_ONLY_BOTS, evaluateRobotsPolicy } = require("./ai-bot-policy");

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

test("KNUE fixture: ClaudeBot triggers a blocked verdict", () => {
  const groups = parseRobotsGroups(KNUE_ROBOTS_TXT);
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, true);
  assert.equal(policy.blockedGroups.length, 1);
  assert.ok(policy.blockedGroups[0].matchedTriggerBots.includes("ClaudeBot"));
});

test("Meta-ExternalAgent alone in a Disallow: / group is informational only, not a trigger", () => {
  const groups = parseRobotsGroups("User-agent: Meta-ExternalAgent\nDisallow: /\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, false);
  assert.equal(policy.blockedGroups.length, 0);
  assert.equal(policy.informationalOnlyGroups.length, 1);
  assert.ok(policy.informationalOnlyGroups[0].matchedInformationalBots.includes("Meta-ExternalAgent"));
});

test("Amazonbot alone in a Disallow: / group is informational only, not a trigger", () => {
  const groups = parseRobotsGroups("User-agent: Amazonbot\nDisallow: /\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, false);
  assert.equal(policy.informationalOnlyGroups.length, 1);
});

test("a bare `User-agent: *` group with Disallow: / is treated as a trigger (blocks everyone, including AI crawlers)", () => {
  const groups = parseRobotsGroups("User-agent: *\nDisallow: /\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockedGroups[0].matchedTriggerBots.includes("*"));
});

test("a Disallow: /some-path/ (not full site) group never triggers blocked, even with an AI crawler UA", () => {
  const groups = parseRobotsGroups("User-agent: ClaudeBot\nDisallow: /some-path/\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, false);
  assert.equal(policy.blockedGroups.length, 0);
});

test("a group with no Disallow: / directive at all does not appear in blockedGroups or informationalOnlyGroups", () => {
  const groups = parseRobotsGroups("User-agent: ClaudeBot\nAllow: /\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, false);
  assert.equal(policy.blockedGroups.length, 0);
  assert.equal(policy.informationalOnlyGroups.length, 0);
});

test("trigger, soft-trigger, and informational bot lists are pairwise disjoint", () => {
  const triggerSet = new Set(AI_CRAWLER_TRIGGER_BOTS.map((value) => value.toLowerCase()));
  const softSet = new Set(SOFT_AI_CRAWLER_BOTS.map((value) => value.toLowerCase()));
  const informationalSet = new Set(INFORMATIONAL_ONLY_BOTS.map((value) => value.toLowerCase()));
  assert.deepEqual(SOFT_AI_CRAWLER_BOTS.filter((value) => triggerSet.has(value.toLowerCase())), []);
  assert.deepEqual(INFORMATIONAL_ONLY_BOTS.filter((value) => triggerSet.has(value.toLowerCase())), []);
  assert.deepEqual(INFORMATIONAL_ONLY_BOTS.filter((value) => softSet.has(value.toLowerCase())), []);
});

test("no groups at all (empty robots.txt) is never blocked", () => {
  const policy = evaluateRobotsPolicy([]);
  assert.equal(policy.blocked, false);
  assert.equal(policy.softBlocked, false);
  assert.deepEqual(policy.blockedGroups, []);
  assert.deepEqual(policy.softBlockedGroups, []);
  assert.deepEqual(policy.informationalOnlyGroups, []);
});

// --- Real-scan-driven regression: hard trigger (our own AI policy bots) vs
// soft trigger (AI/training-adjacent but not ours) must land on different
// verdict tiers. See .pipeline/spec.md follow-up: korea-aerospace-university
// (Applebot-Extended-only) and hongik-university-seoul (Bytespider-only)
// were wrongly BLOCKED before this split; ajou-university (ClaudeBot+GPTBot
// mixed with many other bots in the same group) must stay BLOCKED. ---

test("Applebot-Extended alone in a Disallow: / group is a soft trigger, not a hard block (korea-aerospace-university regression)", () => {
  const groups = parseRobotsGroups("User-agent: Applebot-Extended\nDisallow: /\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, false);
  assert.equal(policy.blockedGroups.length, 0);
  assert.equal(policy.softBlocked, true);
  assert.equal(policy.softBlockedGroups.length, 1);
  assert.ok(policy.softBlockedGroups[0].matchedSoftTriggerBots.includes("Applebot-Extended"));
});

test("Bytespider alone in a Disallow: / group is a soft trigger, not a hard block (hongik-university-seoul regression)", () => {
  const groups = parseRobotsGroups("User-agent: Bytespider\nDisallow: /\n");
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, false);
  assert.equal(policy.softBlocked, true);
  assert.ok(policy.softBlockedGroups[0].matchedSoftTriggerBots.includes("Bytespider"));
});

test("CCBot/Google-Extended/PerplexityBot/Diffbot/cohere-ai/Omgilibot are soft triggers, not hard triggers", () => {
  for (const bot of ["CCBot", "Google-Extended", "PerplexityBot", "Diffbot", "cohere-ai", "Omgilibot"]) {
    const groups = parseRobotsGroups(`User-agent: ${bot}\nDisallow: /\n`);
    const policy = evaluateRobotsPolicy(groups);
    assert.equal(policy.blocked, false, `${bot} must not be a hard trigger`);
    assert.equal(policy.softBlocked, true, `${bot} must be a soft trigger`);
  }
});

test("a group mixing a hard-trigger bot with soft-trigger bots is still a hard BLOCKED (ajou-university regression: ClaudeBot/GPTBot alongside Bytespider/Applebot/CCBot)", () => {
  const groups = parseRobotsGroups(
    ["User-agent: Bytespider", "User-agent: Applebot", "User-agent: GPTBot", "User-agent: CCBot", "User-agent: ClaudeBot", "Disallow: /"].join("\n")
  );
  const policy = evaluateRobotsPolicy(groups);
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockedGroups[0].matchedTriggerBots.includes("ClaudeBot"));
  assert.ok(policy.blockedGroups[0].matchedTriggerBots.includes("GPTBot"));
  assert.equal(policy.softBlocked, false, "a group already counted as hard-blocked must not also appear in softBlockedGroups");
});
