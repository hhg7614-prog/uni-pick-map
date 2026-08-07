"use strict";

const fs = require("fs");
const path = require("path");
const { buildCollectionReport, writePublicCollectionReport } = require("../collection-report");

const ROOT = path.resolve(__dirname, "../../..");
const LOG_DIRECTORY = path.join(ROOT, "server", "agent", "logs", "scheduled");

function latestResult() {
  const files = fs.readdirSync(LOG_DIRECTORY)
    .filter((file) => /^six-university-\d+\.json$/.test(file))
    .map((file) => path.join(LOG_DIRECTORY, file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (files.length === 0) throw new Error("No scheduled result JSON was found.");
  return { data: JSON.parse(fs.readFileSync(files[0], "utf8")), filePath: files[0] };
}

function latestMetricsByUniversity(ids, resultFileName) {
  const logs = fs.readdirSync(LOG_DIRECTORY)
    .filter((file) => /^six-university-\d{8}-?\d{6}\.log$/.test(file))
    .map((file) => path.join(LOG_DIRECTORY, file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  const log = logs.find((file) => fs.readFileSync(file, "utf8").replace(/\u0000/g, "").includes(resultFileName)) || logs[0];
  if (!log) return {};
  const text = fs.readFileSync(log, "utf8").replace(/\u0000/g, "");
  const rows = [];
  for (const id of ids) {
    // Each ID occurs first in targetSources and again in perUniversity.
    // The latter carries the observed counts, so use its final occurrence.
    const start = text.lastIndexOf(`"universityId": "${id}"`);
    const end = start >= 0 ? text.indexOf("\n    }", start) : -1;
    const block = start >= 0 ? text.slice(start, end >= 0 ? end : undefined) : "";
    const field = (name) => Number((new RegExp(`"${name}"\\s*:\\s*(\\d+)`).exec(block) || [])[1] || 0);
    if (block) rows.push({ universityId: id, found: field("found"), accepted: field("accepted"), excluded: field("excluded"), newCount: field("newCount"), duplicateCount: field("duplicateCount") });
  }
  return {
    perUniversity: rows,
    foundTotal: rows.reduce((sum, row) => sum + row.found, 0),
    acceptedTotal: rows.reduce((sum, row) => sum + row.accepted, 0),
    newTotal: rows.reduce((sum, row) => sum + row.newCount, 0),
    duplicateTotal: rows.reduce((sum, row) => sum + row.duplicateCount, 0),
    excludedTotal: rows.reduce((sum, row) => sum + row.excluded, 0),
  };
}

const latest = latestResult();
const result = latest.data;
const trial = latestMetricsByUniversity(result.targetUniversityIds || [], path.basename(latest.filePath));
const report = buildCollectionReport({
  status: result.status,
  startedAt: result.startedAt,
  completedAt: result.completedAt,
  targetUniversityIds: result.targetUniversityIds,
  trial: { ...trial, newTotal: result.newTotal },
  previewCount: result.previewCount,
  deployment: { commitCreated: Boolean(result.commit), commitHash: result.commit, pushed: result.pushed, renderStatus: result.renderStatus },
});
const reportPath = writePublicCollectionReport(report);
console.log(`Public collection report generated: ${reportPath}`);
