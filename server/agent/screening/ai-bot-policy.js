"use strict";

// Pure policy layer on top of robots-group-parser.js output. No network/
// filesystem access. Separates AI crawlers whose presence in a
// `Disallow: /` group should trigger a BLOCKED verdict from bots that are
// merely informational (recorded for context but do not affect the verdict).

// Bots whose inclusion in a full-site `Disallow: /` group means BLOCKED --
// these are the bots directly tied to our own AI collection policy
// (Anthropic's and OpenAI's own crawlers). `*` (all bots) is also a hard
// trigger: a full-site disallow for every bot obviously includes ours too.
const AI_CRAWLER_TRIGGER_BOTS = ["*", "ClaudeBot", "Claude-Web", "anthropic-ai", "GPTBot", "ChatGPT-User", "OAI-SearchBot"];

// Bots that are AI/training-adjacent crawlers but are not ours -- their
// presence in a full-site `Disallow: /` group (without any hard-trigger bot
// also present) downgrades the verdict to HOLD (a soft, informational
// warning) instead of BLOCKED. A site blocking Applebot-Extended or
// Bytespider is not necessarily telling us to stay away.
const SOFT_AI_CRAWLER_BOTS = ["CCBot", "Google-Extended", "Bytespider", "PerplexityBot", "Applebot-Extended", "Diffbot", "cohere-ai", "Omgilibot"];

// Bots that are recorded for context only. Their presence in a
// `Disallow: /` group never affects the READY/HOLD/BLOCKED verdict on its
// own.
const INFORMATIONAL_ONLY_BOTS = [
  "Meta-ExternalAgent",
  "Amazonbot",
  "Googlebot",
  "Bingbot",
  "AhrefsBot",
  "SemrushBot",
];

function normalizeBotName(value) {
  return String(value || "").trim().toLowerCase();
}

const TRIGGER_SET = new Set(AI_CRAWLER_TRIGGER_BOTS.map(normalizeBotName));
const SOFT_TRIGGER_SET = new Set(SOFT_AI_CRAWLER_BOTS.map(normalizeBotName));
const INFORMATIONAL_SET = new Set(INFORMATIONAL_ONLY_BOTS.map(normalizeBotName));

/**
 * Evaluate parsed robots.txt groups against the AI-crawler trigger policy.
 *
 * @param {{ uas: string[], disallows: string[], disallowsRoot: boolean }[]} groups
 * @returns {{
 *   blocked: boolean, blockedGroups: { uas: string[], matchedTriggerBots: string[] }[],
 *   softBlocked: boolean, softBlockedGroups: { uas: string[], matchedSoftTriggerBots: string[] }[],
 *   informationalOnlyGroups: { uas: string[], matchedInformationalBots: string[] }[]
 * }}
 */
function evaluateRobotsPolicy(groups) {
  const blockedGroups = [];
  const softBlockedGroups = [];
  const informationalOnlyGroups = [];

  for (const group of groups || []) {
    if (!group || !group.disallowsRoot) continue;
    const matchedTriggerBots = group.uas.filter((ua) => TRIGGER_SET.has(normalizeBotName(ua)));
    if (matchedTriggerBots.length) {
      blockedGroups.push({ uas: [...group.uas], matchedTriggerBots });
      continue;
    }
    const matchedSoftTriggerBots = group.uas.filter((ua) => SOFT_TRIGGER_SET.has(normalizeBotName(ua)));
    if (matchedSoftTriggerBots.length) {
      softBlockedGroups.push({ uas: [...group.uas], matchedSoftTriggerBots });
      continue;
    }
    const matchedInformationalBots = group.uas.filter((ua) => INFORMATIONAL_SET.has(normalizeBotName(ua)));
    if (matchedInformationalBots.length) {
      informationalOnlyGroups.push({ uas: [...group.uas], matchedInformationalBots });
    }
  }

  return {
    blocked: blockedGroups.length > 0,
    blockedGroups,
    softBlocked: softBlockedGroups.length > 0,
    softBlockedGroups,
    informationalOnlyGroups,
  };
}

module.exports = { AI_CRAWLER_TRIGGER_BOTS, SOFT_AI_CRAWLER_BOTS, INFORMATIONAL_ONLY_BOTS, evaluateRobotsPolicy };
