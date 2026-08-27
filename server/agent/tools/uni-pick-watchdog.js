"use strict";
// Watchdog intentionally resumes only an incomplete checkpoint; it never approves sources or deploys by itself.
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "../../..");
const data = path.join(ROOT, "server", "agent", "data");
const stateFile = path.join(data, "source-247-state.json");
const lock = path.join(data, "watchdog.lock");
if (fs.existsSync(lock)) { console.log("watchdog already running"); process.exit(0); }
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
try {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (state.status !== "completed" && state.processedUniversityIds.length < state.total) {
    const child = spawn(process.execPath, ["server/agent/tools/run-247-source-diagnostics.js", "--resume"], { cwd: ROOT, detached: true, stdio: "ignore" }); child.unref();
    console.log("source validation resumed");
  } else console.log("no source validation resume required");
} finally { fs.unlinkSync(lock); }
