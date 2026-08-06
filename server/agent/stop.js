"use strict";

/**
 * 안전 중지 명령 (news:agent:stop)
 *
 * STOP 파일을 생성하여 스케줄러가 다음 주기에 안전하게 종료되도록 합니다.
 * 현재 실행 중인 수집 작업이 있으면 그 작업이 끝난 뒤 종료됩니다.
 */

const { requestStop } = require("./lock");
const fs = require("fs");
const path = require("path");

const LOCK_FILE = path.resolve(__dirname, "data/agent.lock");

console.log("\n=== UNI PICK 뉴스 에이전트 중지 요청 ===\n");

if (fs.existsSync(LOCK_FILE)) {
  console.log("⚠️  현재 수집이 진행 중입니다.");
  console.log("   수집이 완료된 뒤 자동으로 스케줄러가 종료됩니다.");
} else {
  console.log("대기 상태입니다. 스케줄러가 다음 실행 전에 종료됩니다.");
}

requestStop();

console.log("✅ 중지 요청이 등록되었습니다.");
console.log("   스케줄러 프로세스가 안전하게 종료될 때까지 잠시 기다려 주세요.\n");
