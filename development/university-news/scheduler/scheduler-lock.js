"use strict";
const fs = require("fs");
const path = require("path");
const LOCK = path.resolve(__dirname, "..", "temp", "scheduler.lock.json");

function readLock() { try { return JSON.parse(fs.readFileSync(LOCK, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } }
function acquireLock(runId) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const active = readLock();
  if (active) return { acquired: false, lock: active };
  const lock = { runId, startedAt: new Date().toISOString(), processId: process.pid };
  try {
    // wx makes the check-and-create operation atomic across two scheduler processes.
    fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { acquired: true, lock };
  } catch (error) {
    if (error.code === "EEXIST") return { acquired: false, lock: readLock() || { runId: "unknown" } };
    throw error;
  }
}
function releaseLock(runId) { const active = readLock(); if (active && active.runId === runId) fs.unlinkSync(LOCK); }
module.exports = { LOCK, readLock, acquireLock, releaseLock };
