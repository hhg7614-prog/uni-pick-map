"use strict";

/**
 * 오전 09:30 / 오후 17:30 스케줄러
 *
 * NEWS_AGENT_ENABLED=true 일 때만 자동으로 실행됩니다.
 * 현재 기본값은 false 이므로 자동 실행되지 않습니다.
 *
 * 실행 방법:
 *   npm run news:agent          ← 스케줄러 시작 (enabled=true 여야 함)
 *   npm run news:agent:once     ← 지금 바로 1회 수집
 *   npm run news:agent:status   ← 마지막 실행 상태 확인
 *   npm run news:agent:stop     ← 스케줄러 안전 중지
 */

const { getAgentConfig, nextScheduledAt } = require("./config");
const { runOnce } = require("./runner");
const { shouldStop, clearStop } = require("./lock");

function log(message) {
  console.log(`[agent/scheduler] ${message}`);
}

function main() {
  const config = getAgentConfig();

  // 자동 실행이 꺼져 있으면 안내 후 종료
  if (!config.enabled) {
    log("뉴스 에이전트 자동 실행이 꺼져 있습니다. (NEWS_AGENT_ENABLED=false)");
    log("자동 실행을 켜려면 .env 또는 Render 환경변수에서 NEWS_AGENT_ENABLED=true 로 변경하세요.");
    log("지금 바로 1회 수집하려면: npm run news:agent:once");
    return;
  }

  log("뉴스 에이전트 스케줄러가 시작되었습니다.");
  log(`크론 설정: ${config.cronExpression} (${config.timezone})`);

  // 서버 시작 시 즉시 1회 실행 (설정에 따라)
  if (config.runOnStartup) {
    log("서버 시작 시 1회 즉시 실행합니다.");
    runOnce({ trigger: "startup" }).catch((err) => {
      log(`시작 시 실행 오류: ${err.message}`);
    });
  }

  scheduleNext();
}

let timer = null;

function scheduleNext() {
  // STOP 신호 확인
  if (shouldStop()) {
    log("중지 요청을 받았습니다. 스케줄러를 종료합니다.");
    clearStop();
    if (timer) clearTimeout(timer);
    process.exit(0);
    return;
  }

  const config = getAgentConfig();
  const nextAt = nextScheduledAt(new Date(), config.cronExpression, config.timezone);
  const delay = Math.max(0, new Date(nextAt).getTime() - Date.now());
  const delayMinutes = Math.round(delay / 60000);

  log(`다음 실행 예정: ${nextAt} (약 ${delayMinutes}분 후)`);

  timer = setTimeout(async () => {
    // 실행 직전 STOP 신호 재확인
    if (shouldStop()) {
      log("중지 요청을 받았습니다. 이번 실행을 건너뜁니다.");
      clearStop();
      process.exit(0);
      return;
    }

    try {
      await runOnce({ trigger: "scheduled" });
    } catch (error) {
      log(`실행 중 예상치 못한 오류: ${error.message}`);
    }

    // 다음 실행 예약 (재귀 호출)
    scheduleNext();
  }, delay);
}

// 프로세스 신호 처리 (Ctrl+C, 서버 종료)
process.on("SIGINT", () => {
  log("SIGINT 수신: 스케줄러를 안전하게 종료합니다.");
  if (timer) clearTimeout(timer);
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("SIGTERM 수신: 스케줄러를 안전하게 종료합니다.");
  if (timer) clearTimeout(timer);
  process.exit(0);
});

main();
