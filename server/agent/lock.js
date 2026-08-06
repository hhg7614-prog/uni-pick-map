"use strict";

/**
 * 실행 잠금 (Lock)
 *
 * 파일 기반 잠금으로 이전 실행이 끝나지 않으면 다음 실행을 건너뜁니다.
 * LOCK 파일: server/agent/data/agent.lock
 * STOP 파일: server/agent/data/agent.stop  ← 존재 시 스케줄러 종료
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "data");
const LOCK_FILE = path.join(DATA_DIR, "agent.lock");
const STOP_FILE = path.join(DATA_DIR, "agent.stop");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 잠금을 획득합니다. 이미 잠금 파일이 있으면 false 를 반환합니다.
 * @returns {{ acquired: boolean, lockId: string|null }}
 */
function acquireLock() {
  ensureDir();
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const info = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      console.log(
        `[agent/lock] 이미 실행 중입니다 (lockId: ${info.lockId}, 시작: ${info.startedAt})`
      );
    } catch {
      console.log("[agent/lock] 잠금 파일이 존재합니다. 실행을 건너뜁니다.");
    }
    return { acquired: false, lockId: null };
  }

  const lockId = `lock-${Date.now()}`;
  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify({ lockId, startedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return { acquired: true, lockId };
}

/**
 * 잠금을 해제합니다.
 */
function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

/**
 * STOP 신호가 있는지 확인합니다.
 * stop 명령(news:agent:stop)이 실행되면 이 파일이 생성됩니다.
 */
function shouldStop() {
  return fs.existsSync(STOP_FILE);
}

/**
 * STOP 신호를 생성합니다. (news:agent:stop 에서 호출)
 */
function requestStop() {
  ensureDir();
  fs.writeFileSync(
    STOP_FILE,
    JSON.stringify({ requestedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  console.log("[agent/lock] 중지 요청 파일이 생성되었습니다:", STOP_FILE);
}

/**
 * STOP 신호를 제거합니다. (스케줄러가 종료 후 정리)
 */
function clearStop() {
  if (fs.existsSync(STOP_FILE)) {
    fs.unlinkSync(STOP_FILE);
  }
}

module.exports = { acquireLock, releaseLock, shouldStop, requestStop, clearStop, LOCK_FILE, STOP_FILE };
