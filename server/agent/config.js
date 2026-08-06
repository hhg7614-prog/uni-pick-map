"use strict";

/**
 * 뉴스 에이전트 설정
 *
 * 환경 변수(NEWS_AGENT_*)를 읽어서 에이전트 동작 방식을 결정합니다.
 * NEWS_AGENT_ENABLED=false 이면 자동 스케줄이 실행되지 않습니다.
 */

function getAgentConfig() {
  return {
    // 자동 스케줄 실행 여부 (기본값: 꺼짐)
    enabled: process.env.NEWS_AGENT_ENABLED === "true",

    // 크론 표현식: 오전 09:30 과 오후 17:30
    cronExpression: process.env.NEWS_AGENT_CRON || "30 9,17 * * *",

    // 시간대
    timezone: process.env.NEWS_AGENT_TIMEZONE || "Asia/Seoul",

    // 서버 시작 시 즉시 1회 실행 여부 (기본값: 꺼짐)
    runOnStartup: process.env.NEWS_AGENT_RUN_ON_STARTUP === "true",

    // 놓친 실행을 재시작 시 몰아서 하지 않음 (항상 false)
    catchUpMissedRuns: process.env.NEWS_AGENT_CATCH_UP_MISSED_RUNS === "true",

    // 이전 실행이 끝나지 않으면 다음 실행을 건너뜀
    preventOverlap: process.env.NEWS_AGENT_PREVENT_OVERLAP !== "false",

    // AI 처리 여부 (기본값: 꺼짐)
    aiEnabled: process.env.NEWS_AI_ENABLED === "true",

    // AI 제공자 (disabled 이면 AI 사용 안 함)
    aiProvider: process.env.NEWS_AI_PROVIDER || "disabled",

    // 1개 소스당 최대 수집 건수
    limitPerSource: Number(process.env.NEWS_AGENT_LIMIT_PER_SOURCE) || 5,

    // 전체 실행당 최대 수집 건수
    limitTotal: Number(process.env.NEWS_AGENT_LIMIT_TOTAL) || 100,
  };
}

/**
 * 크론 표현식(분 시 일 월 요일)에서 오늘의 다음 실행 시각을 계산합니다.
 * 외부 패키지 없이 "30 9,17 * * *" 형식만 지원합니다.
 */
function nextScheduledAt(now, cronExpression, timezone) {
  // 분과 시간 부분만 파싱 (일/월/요일은 매일로 가정)
  const parts = String(cronExpression || "30 9,17 * * *").split(/\s+/);
  const minute = parseInt(parts[0], 10);
  const hours = String(parts[1])
    .split(",")
    .map((h) => parseInt(h, 10))
    .sort((a, b) => a - b);

  // 현재 시각을 Asia/Seoul 기준으로 변환
  const localNow = new Date(
    now.toLocaleString("en-US", { timeZone: timezone || "Asia/Seoul" })
  );
  const currentHour = localNow.getHours();
  const currentMinute = localNow.getMinutes();

  // 오늘 중 아직 지나지 않은 실행 시각 찾기
  for (const hour of hours) {
    if (hour > currentHour || (hour === currentHour && minute > currentMinute)) {
      const next = new Date(now);
      const offsetMs = now.getTime() - localNow.getTime();
      next.setTime(
        new Date(localNow).setHours(hour, minute, 0, 0) + offsetMs
      );
      return next.toISOString();
    }
  }

  // 오늘 모든 시각이 지났으면 내일 첫 번째 시각으로
  const next = new Date(now);
  const offsetMs = now.getTime() - localNow.getTime();
  const tomorrow = new Date(localNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hours[0], minute, 0, 0);
  next.setTime(tomorrow.getTime() + offsetMs);
  return next.toISOString();
}

module.exports = { getAgentConfig, nextScheduledAt };
