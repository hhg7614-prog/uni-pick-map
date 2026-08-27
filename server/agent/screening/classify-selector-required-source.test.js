"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifySource, VERDICTS } = require("./classify-selector-required-source");

function noRisk() {
  return {
    jsOnlyLinkRisk: { detected: false },
    spaRisk: { detected: false },
    nonKoreanBoard: { detected: false },
  };
}

function noPolicy() {
  return { blocked: false, blockedGroups: [], softBlocked: false, softBlockedGroups: [], informationalOnlyGroups: [] };
}

function openRobots() {
  return { checked: true, policy: noPolicy() };
}

function uncheckedRobots() {
  return { checked: false, unavailable: false, reasonCode: "ROBOTS_NOT_FOUND", policy: noPolicy() };
}

function unavailableRobots(reasonCode = "ROBOTS_UNAVAILABLE", unavailableReason) {
  return {
    checked: false,
    unavailable: true,
    reasonCode,
    unavailableReason,
    policy: noPolicy(),
  };
}

function softBlockedRobots(matchedSoftTriggerBots = ["Applebot-Extended"]) {
  return {
    checked: true,
    policy: { ...noPolicy(), softBlocked: true, softBlockedGroups: [{ uas: matchedSoftTriggerBots, matchedSoftTriggerBots }] },
  };
}

// --- The 10-university evidence table from .pipeline/spec.md "조사 결과 요약 5" ---

test("Korea National University of Education (knue-student-support-notices): robots.txt Disallow: / with ClaudeBot -> BLOCKED", () => {
  const evidence = {
    robots: {
      checked: true,
      policy: {
        blocked: true,
        blockedGroups: [{ uas: ["GPTBot", "ChatGPT-User", "ClaudeBot", "CCBot"], matchedTriggerBots: ["GPTBot", "ChatGPT-User", "ClaudeBot", "CCBot"] }],
        informationalOnlyGroups: [],
      },
    },
    accessibility: "OK_200",
    ...noRisk(),
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.BLOCKED);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 1")));
  assert.ok(result.reasons.some((reason) => reason.includes("ClaudeBot")));
});

test("Seoul National University of Education (snue-official-news): javascript:+data-url list links -> HOLD (JS-only-link)", () => {
  const evidence = {
    robots: openRobots(),
    accessibility: "OK_200",
    jsOnlyLinkRisk: { detected: true },
    spaRisk: { detected: false },
    nonKoreanBoard: { detected: false },
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 8")));
  assert.equal(result.flags.nonKoreanBoard, false);
});

test("Jeju National University (jejunu-academic-notice): Node fetch UNABLE_TO_VERIFY_LEAF_SIGNATURE -> HOLD (TLS_ERROR)", () => {
  const evidence = {
    robots: uncheckedRobots(),
    accessibility: "TLS_ERROR",
    ...noRisk(),
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 4")));
  assert.ok(result.reasons.some((reason) => /인증서|TLS/.test(reason)));
});

test("Chungnam National University (cnu-official-news, site_dvs_cd=en): robots/structure normal but English board -> HOLD (nonKoreanBoard warning, not BLOCKED)", () => {
  const evidence = {
    robots: openRobots(),
    accessibility: "OK_200",
    jsOnlyLinkRisk: { detected: false },
    spaRisk: { detected: false },
    nonKoreanBoard: { detected: true, reason: "listUrl indicates a non-Korean board variant: site_dvs_cd=en" },
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.notEqual(result.verdict, VERDICTS.BLOCKED);
  assert.equal(result.flags.nonKoreanBoard, true);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 10")));
});

test("Gachon University Global Campus (gachon-global-campus-news): open robots, absolute hrefs, clean container -> READY", () => {
  const evidence = {
    robots: openRobots(),
    accessibility: "OK_200",
    ...noRisk(),
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.READY);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 11")));
});

test("Chungbuk National University (cbnu-official-news): robots.txt 404 (unchecked/no restriction), li.p-media container -> READY", () => {
  const evidence = {
    robots: uncheckedRobots(),
    accessibility: "OK_200",
    ...noRisk(),
    notes: ["참고: 상세 페이지에 날짜 필드가 없어 allowListDateFallback이 필요할 수 있음(별도 리스크, 판정에는 영향 없음)."],
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.READY);
  assert.equal(result.flags.robotsChecked, false);
  assert.ok(result.reasons.some((reason) => reason.includes("robotsChecked=false")));
  assert.ok(result.reasons.some((reason) => reason.includes("allowListDateFallback")));
});

for (const universityId of ["kyungpook-national-university", "chonbuk-national-university", "chonnam-national-university", "busan-national-university-of-education"]) {
  test(`${universityId}: robots normal (404 or no AI-bot mention), listUrl 200, no JS-only link risk -> READY`, () => {
    const evidence = {
      robots: openRobots(),
      accessibility: "OK_200",
      ...noRisk(),
    };
    const result = classifySource(evidence);
    assert.equal(result.verdict, VERDICTS.READY);
  });
}

// --- Additional coverage for the remaining rule-order steps (4, 5, 6, 7) ---

test("TIMEOUT accessibility -> HOLD (rule 5)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "TIMEOUT", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 5")));
});

test("NETWORK_ERROR accessibility -> HOLD (rule 5)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "NETWORK_ERROR", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 5")));
});

test("LOGIN_REDIRECT accessibility -> HOLD (rule 6)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "LOGIN_REDIRECT", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 6")));
});

test("NOT_FOUND_404 accessibility -> HOLD (rule 7)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "NOT_FOUND_404", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 7")));
});

test("OTHER_HTTP_ERROR accessibility -> HOLD (rule 7)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "OTHER_HTTP_ERROR", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 7")));
});

// --- Regression: Gyeongsang National University gnu-official-press-releases.
// HTTP 200 with a body that is actually an "invalid request" bounce page
// must be classified the same way as NOT_FOUND_404/OTHER_HTTP_ERROR (rule 7,
// same number -- no renumbering of the rules below it). ---

test("ERROR_PAGE_DESPITE_200 accessibility -> HOLD (rule 7, gnu-official-press-releases regression)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "ERROR_PAGE_DESPITE_200", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 7")));
  assert.ok(result.reasons.some((reason) => reason.includes("HTTP 200")));
});

test("SPA risk detected with an otherwise clean site -> HOLD (rule 9)", () => {
  const result = classifySource({ robots: openRobots(), accessibility: "OK_200", jsOnlyLinkRisk: { detected: false }, spaRisk: { detected: true }, nonKoreanBoard: { detected: false } });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 9")));
});

// --- robots.txt soft-block tier (rule 3): AI/training-adjacent bots that are
// not our own AI collection policy's trigger bots must downgrade to HOLD
// (informational warning), never BLOCKED. Regression cases from the real
// 47-candidate scan: korea-aerospace-university (Applebot-Extended only)
// and hongik-university-seoul (Bytespider only) were previously (wrongly)
// BLOCKED. ---

test("robots.txt soft block (Applebot-Extended only, korea-aerospace-university) -> HOLD, not BLOCKED (rule 3, aiBotSoftBlocked=true)", () => {
  const result = classifySource({ robots: softBlockedRobots(["Applebot-Extended"]), accessibility: "OK_200", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.notEqual(result.verdict, VERDICTS.BLOCKED);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 3")));
  assert.ok(result.reasons.some((reason) => reason.includes("Applebot-Extended")));
  assert.equal(result.flags.aiBotSoftBlocked, true);
});

test("robots.txt soft block (Bytespider only, hongik-university-seoul) -> HOLD, not BLOCKED (rule 3, aiBotSoftBlocked=true)", () => {
  const result = classifySource({ robots: softBlockedRobots(["Bytespider"]), accessibility: "OK_200", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.notEqual(result.verdict, VERDICTS.BLOCKED);
  assert.equal(result.flags.aiBotSoftBlocked, true);
});

test("rule priority: hard BLOCKED (rule 1) wins over an otherwise-soft-block-worthy robots policy", () => {
  const evidence = {
    robots: {
      checked: true,
      policy: { blocked: true, blockedGroups: [{ uas: ["ClaudeBot"], matchedTriggerBots: ["ClaudeBot"] }], softBlocked: true, softBlockedGroups: [{ uas: ["Bytespider"], matchedSoftTriggerBots: ["Bytespider"] }], informationalOnlyGroups: [] },
    },
    accessibility: "OK_200",
    ...noRisk(),
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.BLOCKED);
});

test("rule priority: robots-unavailable (rule 2) is still evaluated before soft block (rule 3)", () => {
  const result = classifySource({ robots: unavailableRobots(), accessibility: "OK_200", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 2")));
  assert.equal(result.flags.aiBotSoftBlocked, false);
});

test("robots.txt unavailable (403/429/5xx/network error/timeout/empty body) -> HOLD (rule 2, ROBOTS_UNAVAILABLE), never treated as 'no restriction'", () => {
  for (const unavailableReason of [
    "robots.txt 요청이 실패했습니다(OTHER_HTTP_ERROR).",
    "robots.txt 요청이 실패했습니다(NETWORK_ERROR).",
    "robots.txt 요청이 실패했습니다(TIMEOUT).",
    "robots.txt 응답 본문이 비어 있습니다.",
  ]) {
    const result = classifySource({ robots: unavailableRobots("ROBOTS_UNAVAILABLE", unavailableReason), accessibility: "OK_200", ...noRisk() });
    assert.equal(result.verdict, VERDICTS.HOLD, `expected HOLD for reason: ${unavailableReason}`);
    assert.ok(result.reasons.some((reason) => reason.includes("규칙 2")));
    assert.ok(result.reasons.some((reason) => reason.includes("ROBOTS_UNAVAILABLE")));
    assert.equal(result.flags.robotsUnavailable, true);
    assert.notEqual(result.verdict, VERDICTS.READY, "robots-unavailable must never fall through to READY");
  }
});

test("robots.txt 404 (not found, still unchecked but not 'unavailable') keeps the existing 'no restriction' behavior and can still reach READY", () => {
  const result = classifySource({ robots: uncheckedRobots(), accessibility: "OK_200", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.READY);
  assert.equal(result.flags.robotsChecked, false);
  assert.equal(result.flags.robotsUnavailable, false);
});

test("rule priority: robots-unavailable (rule 2) wins over an otherwise-HOLD-worthy TLS_ERROR (rule 4), so the reported reason is the robots issue", () => {
  const result = classifySource({ robots: unavailableRobots(), accessibility: "TLS_ERROR", ...noRisk() });
  assert.equal(result.verdict, VERDICTS.HOLD);
  assert.ok(result.reasons.some((reason) => reason.includes("규칙 2")));
  assert.ok(!result.reasons.some((reason) => reason.includes("규칙 4")));
});

test("rule priority: robots BLOCKED wins over an otherwise-HOLD-worthy TLS_ERROR", () => {
  const evidence = {
    robots: {
      checked: true,
      policy: { blocked: true, blockedGroups: [{ uas: ["*"], matchedTriggerBots: ["*"] }], informationalOnlyGroups: [] },
    },
    accessibility: "TLS_ERROR",
    ...noRisk(),
  };
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.BLOCKED);
});

test("classifySource does not mutate a frozen evidence object", () => {
  const evidence = Object.freeze({
    robots: Object.freeze(openRobots()),
    accessibility: "OK_200",
    jsOnlyLinkRisk: Object.freeze({ detected: false }),
    spaRisk: Object.freeze({ detected: false }),
    nonKoreanBoard: Object.freeze({ detected: false }),
  });
  assert.doesNotThrow(() => classifySource(evidence));
  const result = classifySource(evidence);
  assert.equal(result.verdict, VERDICTS.READY);
});
