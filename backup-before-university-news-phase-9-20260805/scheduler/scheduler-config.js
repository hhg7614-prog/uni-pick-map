"use strict";

function readBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function getSchedulerConfig(env = process.env) {
  return {
    schedulerEnabled: readBoolean(env.NEWS_SCHEDULE_ENABLED, false),
    scheduleExpression: env.NEWS_SCHEDULE_CRON || "0 */3 * * *",
    timezone: env.NEWS_SCHEDULE_TIMEZONE || "Asia/Seoul",
    runOnStartup: readBoolean(env.NEWS_RUN_ON_STARTUP, false),
    preventOverlap: readBoolean(env.NEWS_PREVENT_OVERLAP, true),
    intervalMs: 3 * 60 * 60 * 1000,
    targetUniversities: ["서울대학교", "연세대학교", "한양대학교"],
    provider: env.NEWS_AI_PROVIDER || "disabled",
    collectionLimitPerSource: 5,
    collectionLimitPerUniversity: 10,
    totalCollectionLimit: 30,
    aiLimit: 15
  };
}

function nextScheduledAt(from = new Date(), timezone = "Asia/Seoul") {
  // The three-hour cadence is expressed in Korea time. The returned ISO value
  // is portable and can be displayed in the browser without exposing server state.
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" });
  const hour = Number(formatter.formatToParts(from).find((part) => part.type === "hour")?.value || 0);
  const minutesToNext = ((3 - (hour % 3)) % 3 || 3) * 60;
  return new Date(from.getTime() + minutesToNext * 60 * 1000).toISOString();
}

module.exports = { getSchedulerConfig, nextScheduledAt };
