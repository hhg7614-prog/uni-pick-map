"use strict";

// Read-only regression runner for the main Agent v1 pipeline contract.
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const testRunner = path.join(__dirname, "run-pipeline-integrity-test3.js");

function run() {
  execFileSync(process.execPath, [testRunner], { cwd: ROOT, stdio: "inherit" });
}

run();
