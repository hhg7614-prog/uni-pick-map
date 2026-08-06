"use strict";

/**
 * 상태 확인 명령 (news:agent:status)
 *
 * 마지막 실행 결과와 에이전트 설정 상태를 화면에 출력합니다.
 */

const { loadStatus } = require("./report");
const { getAgentConfig } = require("./config");
const { LOCK_FILE, STOP_FILE } = require("./lock");
const fs = require("fs");

const config = getAgentConfig();
const status = loadStatus();

console.log("\n=== UNI PICK 뉴스 에이전트 상태 ===\n");

console.log("[설정]");
console.log(`  자동 실행: ${config.enabled ? "✅ 켜짐" : "⛔ 꺼짐 (NEWS_AGENT_ENABLED=false)"}`);
console.log(`  크론 설정: ${config.cronExpression}`);
console.log(`  시간대   : ${config.timezone}`);
console.log(`  AI 처리  : ${config.aiEnabled ? "켜짐" : "꺼짐"}`);

console.log("\n[실행 상태]");
if (status.message) {
  console.log(`  ${status.message}`);
} else {
  console.log(`  마지막 실행: ${status.lastRunAt || "없음"}`);
  console.log(`  실행 방식  : ${status.lastTrigger || "없음"}`);
  console.log(`  신규 저장  : ${status.lastNewCount ?? 0}건`);
  console.log(`  오류 건수  : ${status.lastErrorCount ?? 0}건`);
  console.log(`  누적 저장  : ${status.totalStoredItems ?? 0}건`);
}

console.log("\n[잠금 파일]");
if (fs.existsSync(LOCK_FILE)) {
  console.log("  ⚠️  현재 실행 중 (agent.lock 파일 존재)");
} else {
  console.log("  대기 중 (잠금 없음)");
}

if (fs.existsSync(STOP_FILE)) {
  console.log("  ⚠️  중지 요청 대기 중 (agent.stop 파일 존재)");
}

console.log("");
