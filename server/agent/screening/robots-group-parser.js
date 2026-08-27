"use strict";

// Pure robots.txt parser. No network/filesystem access.
//
// Correctly groups *consecutive* `User-agent:` lines into a single group
// (the standard robots.txt semantics: a run of User-agent lines shares the
// directives that follow, until the next User-agent run starts a new group).
// This fixes a real bug found at Korea National University of Education
// (www.knue.ac.kr), where a naive "remember only the previous single
// User-agent" parser would lose the `Disallow: /` that applies to
// ClaudeBot because ClaudeBot was not the *last* User-agent line before the
// directive.

// Matches a line like `User-agent: ClaudeBot` (case-insensitive, tolerates
// surrounding whitespace and an inline `#` comment).
const USER_AGENT_LINE = /^user-agent\s*:\s*(.+)$/i;
const DISALLOW_LINE = /^disallow\s*:\s*(.*)$/i;
const ALLOW_LINE = /^allow\s*:\s*(.*)$/i;

function stripComment(line) {
  const hashIndex = line.indexOf("#");
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
}

/**
 * Parse robots.txt text into an array of groups.
 *
 * @param {string} text raw robots.txt body
 * @returns {{ uas: string[], disallows: string[], allows: string[], disallowsRoot: boolean, hasDirective: boolean }[]}
 */
function parseRobotsGroups(text) {
  const lines = String(text || "").split(/\r?\n/);
  const groups = [];
  let currentGroup = null;
  // Tracks whether the group currently being built is still accepting new
  // `User-agent:` lines (true right after a User-agent line or at the very
  // start of a group), or whether a directive has already been seen, which
  // means the next `User-agent:` line must start a *new* group.
  let acceptingUserAgents = true;

  for (const rawLine of lines) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const uaMatch = line.match(USER_AGENT_LINE);
    if (uaMatch) {
      const ua = uaMatch[1].trim();
      if (!ua) continue;
      if (!currentGroup || !acceptingUserAgents) {
        currentGroup = { uas: [], disallows: [], allows: [], hasDirective: false };
        groups.push(currentGroup);
        acceptingUserAgents = true;
      }
      currentGroup.uas.push(ua);
      continue;
    }

    const disallowMatch = line.match(DISALLOW_LINE);
    if (disallowMatch) {
      if (!currentGroup) continue; // Disallow without a preceding User-agent is not a valid group.
      currentGroup.disallows.push(disallowMatch[1].trim());
      currentGroup.hasDirective = true;
      acceptingUserAgents = false;
      continue;
    }

    const allowMatch = line.match(ALLOW_LINE);
    if (allowMatch) {
      if (!currentGroup) continue;
      currentGroup.allows.push(allowMatch[1].trim());
      currentGroup.hasDirective = true;
      acceptingUserAgents = false;
      continue;
    }

    // Any other directive (Crawl-delay, Sitemap, etc.) also closes the
    // User-agent-collecting window for the current group, but does not
    // itself count as a Disallow/Allow directive.
    acceptingUserAgents = false;
  }

  return groups.map((group) => ({
    uas: group.uas,
    disallows: group.disallows,
    allows: group.allows,
    disallowsRoot: group.disallows.some((value) => value === "/"),
    hasDirective: group.hasDirective,
  }));
}

module.exports = { parseRobotsGroups };
