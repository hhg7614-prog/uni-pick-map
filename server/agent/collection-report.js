"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC_REPORT_PATH = path.join(ROOT, "data", "university-news-collection-report.json");
const SCHEDULE = { morning: "09:30", afternoon: "17:30", timezone: "Asia/Seoul" };
const UNIVERSITY_DETAILS = {
  "seoul-national-university-gwanak": { name: "서울대학교", groupId: "seoul-national-university-gwanak" },
  "yonsei-university-sinchon": { name: "연세대학교 신촌캠퍼스", groupId: "yonsei-university" },
  "korea-university-seoul": { name: "고려대학교 서울캠퍼스", groupId: "korea-university" },
  "hanyang-university-seoul": { name: "한양대학교 서울캠퍼스", groupId: "hanyang-university" },
  "ewha-womans-university": { name: "이화여자대학교", groupId: "ewha-womans-university" },
  "dongguk-university-seoul": { name: "동국대학교 서울캠퍼스", groupId: "dongguk-university-seoul" },
};

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function statusLabel(status) {
  if (status === "no_new_items") return "정상 완료 · 신규 뉴스 없음";
  if (status === "deployed") return "수집 및 공개 반영 완료";
  if (status === "push_failed") return "수집 완료 · GitHub 반영 실패";
  if (status === "collection_failed" || status === "validation_failed") return "수집 실패";
  return "확인 필요";
}

function toPublicUniversityRow(id, sourceRow = {}) {
  const detail = UNIVERSITY_DETAILS[id] || { name: id, groupId: id };
  const errorCount = sourceRow.error ? 1 : number(sourceRow.errorCount || sourceRow.errors);
  return {
    universityId: id,
    universityGroupId: sourceRow.universityGroupId || detail.groupId,
    universityName: detail.name,
    found: number(sourceRow.found),
    accepted: number(sourceRow.accepted),
    newCount: number(sourceRow.newCount),
    duplicateCount: number(sourceRow.duplicateCount),
    excludedCount: number(sourceRow.excluded),
    errorCount,
    status: errorCount > 0 ? "failed" : "success",
    // Legacy-compatible properties for the existing report dialog.
    checkedSources: 1,
    collectedItems: number(sourceRow.found),
    newItems: number(sourceRow.newCount),
    duplicates: number(sourceRow.duplicateCount),
    invalidItems: number(sourceRow.excluded),
    errors: errorCount,
  };
}

function buildCollectionReport({ status, startedAt, completedAt, targetUniversityIds, trial = {}, previewCount = 0, deployment = {}, triggerType = "scheduled" }) {
  const ids = Array.isArray(targetUniversityIds) ? targetUniversityIds : [];
  const rowsById = new Map((trial.perUniversity || []).map((row) => [row.universityId, row]));
  const targetUniversities = ids.map((id) => toPublicUniversityRow(id, rowsById.get(id)));
  const started = new Date(startedAt);
  const completed = new Date(completedAt);
  const durationSeconds = Number.isNaN(started.valueOf()) || Number.isNaN(completed.valueOf())
    ? null
    : Math.max(0, Math.round((completed - started) / 1000));
  const summary = {
    foundTotal: number(trial.foundTotal),
    acceptedTotal: number(trial.acceptedTotal),
    newTotal: number(trial.newTotal),
    duplicateTotal: number(trial.duplicateTotal),
    excludedTotal: number(trial.excludedTotal),
    errorTotal: targetUniversities.reduce((sum, row) => sum + row.errorCount, 0),
    previewCount: number(previewCount),
    // Legacy-compatible summary fields.
    targetUniversities: ids.length,
    checkedSources: ids.length,
    collectedItems: number(trial.foundTotal),
    newItems: number(trial.newTotal),
    duplicates: number(trial.duplicateTotal),
    errors: targetUniversities.reduce((sum, row) => sum + row.errorCount, 0),
    aiProcessedItems: 0,
    previewItemCount: number(previewCount),
  };
  return {
    reportAvailable: true,
    generatedAt: completedAt,
    status,
    statusLabel: statusLabel(status),
    triggerType,
    startedAt,
    completedAt,
    durationSeconds,
    targetUniversityCount: ids.length,
    targetUniversityIds: ids,
    targetUniversities,
    byUniversity: targetUniversities,
    summary,
    deployment: {
      commitCreated: Boolean(deployment.commitCreated),
      commitHash: deployment.commitHash || null,
      pushed: Boolean(deployment.pushed),
      renderStatus: deployment.renderStatus || "not_required",
    },
    nextScheduledRuns: SCHEDULE,
  };
}

function writePublicCollectionReport(report) {
  fs.mkdirSync(path.dirname(PUBLIC_REPORT_PATH), { recursive: true });
  const temporaryPath = `${PUBLIC_REPORT_PATH}.tmp`;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(temporaryPath, serialized, "utf8");
  JSON.parse(fs.readFileSync(temporaryPath, "utf8"));
  fs.renameSync(temporaryPath, PUBLIC_REPORT_PATH);
  return PUBLIC_REPORT_PATH;
}

module.exports = { PUBLIC_REPORT_PATH, UNIVERSITY_DETAILS, buildCollectionReport, writePublicCollectionReport };
