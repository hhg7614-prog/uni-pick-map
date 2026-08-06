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
  // Calculate the next 00:00, 03:00, … slot in Korea time rather than simply
  // adding three hours to process start time.
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(from).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const year=Number(parts.year), month=Number(parts.month), day=Number(parts.day), hour=Number(parts.hour);
  let nextHour=(Math.floor(hour / 3) + 1) * 3, extraDay=0;
  if(nextHour>=24){nextHour=0;extraDay=1;}
  // Asia/Seoul has no daylight-saving offset. Intl is still used above so the
  // displayed date always follows the configured timezone.
  return new Date(Date.UTC(year,month-1,day+extraDay,nextHour)-9*60*60*1000).toISOString();
}

module.exports = { getSchedulerConfig, nextScheduledAt };
