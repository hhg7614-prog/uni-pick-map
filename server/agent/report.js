"use strict";

/**
 * 실행별 보고서 생성
 *
 * 수집 실행이 끝날 때마다 보고서 파일을 만들어 둡니다.
 * 위치: server/agent/data/reports/
 * 최신 실행 요약: server/agent/data/agent-status.json
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const STATUS_FILE = path.join(DATA_DIR, "agent-status.json");

function ensureDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15);
}

/**
 * 실행 보고서를 저장하고 최신 상태 파일도 업데이트합니다.
 *
 * @param {object} report - 보고서 데이터
 * @param {string} report.runId       - 실행 고유 ID
 * @param {string} report.trigger     - "scheduled" | "manual"
 * @param {string} report.startedAt   - 시작 시각
 * @param {string} report.finishedAt  - 종료 시각
 * @param {number} report.targetCount - 대상 대학 수
 * @param {number} report.collectedTotal - 수집된 전체 건수
 * @param {number} report.newCount    - 신규 저장된 건수
 * @param {number} report.duplicateCount - 중복으로 제외된 건수
 * @param {number} report.errorCount  - 오류 발생 건수
 * @param {Array}  report.universityResults - 대학별 수집 결과
 */
function saveReport(report) {
  ensureDirs();

  const id = report.runId || `run-${timestampId()}`;
  const filePath = path.join(REPORTS_DIR, `${id}.json`);

  const fullReport = {
    ...report,
    runId: id,
    savedAt: new Date().toISOString(),
  };

  // 보고서 저장
  fs.writeFileSync(filePath, JSON.stringify(fullReport, null, 2) + "\n", "utf8");

  // 최신 상태 파일 업데이트 (status 명령에서 읽음)
  const status = {
    lastRunId: id,
    lastRunAt: report.finishedAt || new Date().toISOString(),
    lastTrigger: report.trigger || "unknown",
    lastNewCount: report.newCount || 0,
    lastErrorCount: report.errorCount || 0,
    totalStoredItems: report.totalStoredItems || 0,
    agentEnabled: false, // 항상 false (수동으로만 켬)
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + "\n", "utf8");

  console.log(`[agent/report] 보고서 저장: ${filePath}`);
  return fullReport;
}

/**
 * 최신 에이전트 상태를 읽어옵니다.
 */
function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    return { message: "아직 실행 기록이 없습니다.", agentEnabled: false };
  }
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return { message: "상태 파일을 읽을 수 없습니다.", agentEnabled: false };
  }
}

/**
 * 오래된 보고서를 정리합니다. (최대 30개 유지)
 */
function pruneOldReports(maxCount = 30) {
  if (!fs.existsSync(REPORTS_DIR)) return;
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  while (files.length > maxCount) {
    fs.unlinkSync(path.join(REPORTS_DIR, files.shift()));
  }
}

module.exports = { saveReport, loadStatus, pruneOldReports, STATUS_FILE };
