"use strict";

const { NEWS_CATEGORY_LABELS } = require("../news/utils/categoryUtils");

module.exports = Object.freeze({
  collectionIntervalHours: Number(process.env.NEWS_COLLECTION_INTERVAL_HOURS) || 3,
  batchSize: Number(process.env.NEWS_BATCH_SIZE) || 50,
  maxConcurrency: Number(process.env.NEWS_MAX_CONCURRENCY) || 5,
  requestTimeoutMs: Number(process.env.NEWS_REQUEST_TIMEOUT_MS) || 15000,
  requestDelayMs: Number(process.env.NEWS_REQUEST_DELAY_MS) || 1500,
  retryCount: Number(process.env.NEWS_RETRY_COUNT) || 2,
  enabledCategories: Object.keys(NEWS_CATEGORY_LABELS),
  collectorEnabled: false, schedulerEnabled: false, aiEnabled: false,
});
