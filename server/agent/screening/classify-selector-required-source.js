"use strict";

// Pure decision function. Combines the evidence produced by
// robots-group-parser.js + ai-bot-policy.js + list-url-accessibility.js +
// link-risk-heuristics.js into a single READY / HOLD / BLOCKED verdict with
// human-readable justification strings. No network/filesystem access, and
// it never mutates the evidence object it is given.

const VERDICTS = Object.freeze({ READY: "READY", HOLD: "HOLD", BLOCKED: "BLOCKED" });

function robotsStatusReason(robots) {
  if (!robots || robots.checked === false) {
    if (robots && robots.unavailable) {
      return (
        robots.unavailableReason ||
        `robots.txt 정책을 확인할 수 없습니다(${robots.reasonCode || "ROBOTS_UNAVAILABLE"}) — "제한 없음"으로 단정하지 않습니다.`
      );
    }
    return "robots.txt를 가져오지 못했습니다(예: 404) — 차단 규칙 없음으로 간주합니다(robotsChecked=false).";
  }
  const policy = robots.policy || { blocked: false, blockedGroups: [], softBlocked: false, softBlockedGroups: [], informationalOnlyGroups: [] };
  if (policy.blocked) {
    const group = policy.blockedGroups[0] || { uas: [], matchedTriggerBots: [] };
    return `robots.txt 그룹(User-agent: ${group.uas.join(", ")})이 "Disallow: /"로 전체 차단되어 있고, 우리 AI 수집 정책의 트리거 봇(${group.matchedTriggerBots.join(", ")})이 포함되어 있습니다.`;
  }
  if (policy.softBlocked) {
    const group = policy.softBlockedGroups[0] || { uas: [], matchedSoftTriggerBots: [] };
    return `robots.txt 그룹(User-agent: ${group.uas.join(", ")})이 "Disallow: /"로 전체 차단되어 있으나, 우리 AI 수집 정책의 트리거 봇이 아닌 다른 AI/크롤러 봇(${group.matchedSoftTriggerBots.join(", ")})만 해당합니다.`;
  }
  if (policy.informationalOnlyGroups && policy.informationalOnlyGroups.length) {
    const group = policy.informationalOnlyGroups[0];
    return `robots.txt에 정보성 전용 봇(${group.matchedInformationalBots.join(", ")})만 언급된 전체 차단 그룹이 있어 판정에는 영향을 주지 않았습니다.`;
  }
  return "robots.txt에 AI 크롤러를 막는 전체 차단(Disallow: /) 그룹이 없습니다.";
}

/**
 * @param {object} evidence
 * @param {{ checked: boolean, unavailable?: boolean, reasonCode?: string, unavailableReason?: string, policy: { blocked: boolean, blockedGroups: object[], softBlocked: boolean, softBlockedGroups: object[], informationalOnlyGroups: object[] } }} evidence.robots
 *   `checked: false` with `unavailable: false` means robots.txt was not found (404) and is treated as "no restriction".
 *   `checked: false` with `unavailable: true` means robots.txt could not be verified (403/429/5xx/network error/timeout/empty response) and must not be treated as "no restriction".
 * @param {"OK_200"|"NOT_FOUND_404"|"LOGIN_REDIRECT"|"ERROR_PAGE_DESPITE_200"|"TLS_ERROR"|"TIMEOUT"|"OTHER_HTTP_ERROR"|"NETWORK_ERROR"} evidence.accessibility
 * @param {{ detected: boolean }} [evidence.jsOnlyLinkRisk]
 * @param {{ detected: boolean }} [evidence.spaRisk]
 * @param {{ detected: boolean, reason?: string }} [evidence.nonKoreanBoard]
 * @param {string[]} [evidence.notes] extra reference-only notes appended to the output (do not affect the verdict)
 * @returns {{ verdict: "READY"|"HOLD"|"BLOCKED", reasons: string[], flags: { robotsChecked: boolean, robotsUnavailable: boolean, aiBotSoftBlocked: boolean, nonKoreanBoard: boolean } }}
 */
function classifySource(evidence = {}) {
  const robots = evidence.robots || { checked: false, policy: { blocked: false, blockedGroups: [], informationalOnlyGroups: [] } };
  const accessibility = evidence.accessibility;
  const jsOnlyLinkRisk = evidence.jsOnlyLinkRisk || { detected: false };
  const spaRisk = evidence.spaRisk || { detected: false };
  const nonKoreanBoard = evidence.nonKoreanBoard || { detected: false };
  const notes = Array.isArray(evidence.notes) ? evidence.notes : [];

  const reasons = [robotsStatusReason(robots)];
  const flags = {
    robotsChecked: robots.checked !== false,
    robotsUnavailable: Boolean(robots.unavailable),
    aiBotSoftBlocked: false,
    nonKoreanBoard: false,
  };

  const policy = robots.policy || { blocked: false, softBlocked: false };
  if (policy.blocked) {
    reasons.push("[규칙 1] robots.txt가 우리 AI 수집 정책의 트리거 봇을 포함해 사이트 전체를 차단하고 있어 BLOCKED로 판정합니다. User-Agent를 바꿔 우회하지 않습니다.");
    return { verdict: VERDICTS.BLOCKED, reasons: [...reasons, ...notes], flags };
  }

  if (robots.checked === false && robots.unavailable) {
    reasons.push(
      `[규칙 2] robots.txt 정책을 확인할 수 없습니다(${robots.reasonCode || "ROBOTS_UNAVAILABLE"}: 403/429/5xx/네트워크 오류/빈 응답 등). "제한 없음"으로 단정하지 않고 안전하게 HOLD로 분류합니다. robots.txt를 다시 확인한 뒤 재판정이 필요합니다.`
    );
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (policy.softBlocked) {
    flags.aiBotSoftBlocked = true;
    reasons.push(
      "[규칙 3] robots.txt가 사이트 전체를 차단하고 있으나, 우리 AI 수집 정책의 트리거 봇(ClaudeBot/GPTBot/ChatGPT-User 등)은 아닌 다른 AI/크롤러 봇만 해당합니다. BLOCKED 대신 정보성 경고로 HOLD 처리합니다(aiBotSoftBlocked=true)."
    );
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (accessibility === "TLS_ERROR") {
    reasons.push(
      "[규칙 4] listUrl 접근 시 TLS_ERROR가 발생했습니다. 이 실행 환경의 인증서 신뢰 체인 문제일 수 있어 다른 환경에서 재확인이 필요합니다(사이트 자체 문제로 단정하지 않습니다)."
    );
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (accessibility === "TIMEOUT" || accessibility === "NETWORK_ERROR") {
    reasons.push(`[규칙 5] listUrl 접근 시 ${accessibility}가 발생했습니다. 일시적 네트워크 문제일 수 있으니 재시도 후 재확인이 필요합니다.`);
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (accessibility === "LOGIN_REDIRECT") {
    reasons.push("[규칙 6] listUrl이 로그인 페이지로 리다이렉트됩니다. 로그인 필요 여부를 재확인해야 합니다.");
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (accessibility === "NOT_FOUND_404" || accessibility === "OTHER_HTTP_ERROR" || accessibility === "ERROR_PAGE_DESPITE_200") {
    const detail =
      accessibility === "ERROR_PAGE_DESPITE_200"
        ? "HTTP 200이지만 응답 본문이 오류/잘못된 요청 안내 페이지로 보입니다(listUrl 파라미터 누락 등 URL 자체 문제일 수 있음)"
        : `listUrl 접근 결과가 ${accessibility}입니다`;
    reasons.push(`[규칙 7] ${detail}. URL 재확인 또는 접근 제한 재확인이 필요합니다.`);
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (jsOnlyLinkRisk.detected) {
    reasons.push(
      "[규칙 8] 목록의 링크가 정적 href 없이 href=\"javascript:...\" + data-url/data-param 패턴에 의존하는 것으로 보입니다(서울교대·경상국립대 패턴). selector 작업 난이도가 높을 수 있습니다."
    );
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (spaRisk.detected) {
    reasons.push("[규칙 9] SPA(단일 페이지 애플리케이션) 가능성이 높습니다. 서버 렌더 목록 신호가 거의 없고 스크립트 번들 의존도가 높아, 정적 HTML 파서로는 목록을 못 뽑을 가능성이 있습니다.");
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  if (nonKoreanBoard.detected) {
    flags.nonKoreanBoard = true;
    reasons.push(
      `[규칙 10] 목록 URL/내용이 비한글(영문 등) 게시판으로 보입니다(${nonKoreanBoard.reason || "근거 없음"}). 기술적 차단은 아니며 경고성 HOLD입니다(nonKoreanBoard=true).`
    );
    return { verdict: VERDICTS.HOLD, reasons: [...reasons, ...notes], flags };
  }

  reasons.push("[규칙 11] robots 차단 트리거 없음, listUrl 정상 접근(200), JS-only-link/SPA 위험 없음, 한글 콘텐츠로 보여 READY로 판정합니다. 이 도구는 자동 활성화가 아니라 선별 보조이므로 사람이 최종 확인해야 합니다.");
  return { verdict: VERDICTS.READY, reasons: [...reasons, ...notes], flags };
}

module.exports = { classifySource, VERDICTS };
