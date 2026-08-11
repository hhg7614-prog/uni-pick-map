"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = path.join(__dirname, "runtime");

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireRuntimeLock(name) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const filePath = path.join(RUNTIME_DIR, `${name}.lock`);
  const payload = { pid: process.pid, startedAt: new Date().toISOString(), name };
  try {
    const fd = fs.openSync(filePath, "wx");
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2) + "\n", "utf8");
    fs.closeSync(fd);
    return { acquired: true, filePath, staleLockRemoved: false };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
  if (pidIsAlive(previous.pid)) return { acquired: false, reason: "ALREADY_RUNNING", filePath, previous };
  // A lock whose recorded process no longer exists is safe to replace.
  try { fs.unlinkSync(filePath); } catch {}
  try {
    const fd = fs.openSync(filePath, "wx");
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2) + "\n", "utf8");
    fs.closeSync(fd);
    return { acquired: true, filePath, staleLockRemoved: true, previous };
  } catch (error) {
    if (error.code === "EEXIST") return { acquired: false, reason: "ALREADY_RUNNING", filePath };
    throw error;
  }
}

function releaseRuntimeLock(lock) {
  if (lock?.acquired && lock.filePath) {
    try { fs.unlinkSync(lock.filePath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

module.exports = { RUNTIME_DIR, acquireRuntimeLock, releaseRuntimeLock, pidIsAlive };
