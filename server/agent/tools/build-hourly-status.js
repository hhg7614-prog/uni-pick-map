"use strict";

// Read-only status builder. It never starts collection, deployment, or diagnostics.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../..");
const DATA = path.join(ROOT, "server", "agent", "data");
const OUT = path.join(DATA, "uni-pick-system-status.json");
const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return fallback; } };
const count = (value) => Array.isArray(value) ? value.length : 0;
function atomic(value) { const temp = `${OUT}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, OUT); }
const first = read("source-247-state.json", {});
const retry = read("source-247-retry-state.json", {});
const agent = read("agent-status.json", {});
const active = retry.status === "running" ? retry : first.status === "running" ? first : null;
const source = active || first;
const phase = retry.status === "running" ? "source_retry" : first.status === "running" ? "source_validation" : "idle";
const status = {
  updatedAt: new Date().toISOString(), systemStatus: "healthy", phase,
  phaseLabel: phase === "source_retry" ? "오류 대학 재검토" : phase === "source_validation" ? "대학 공식 출처 검증" : "다음 예약 작업 대기",
  sourceValidation: { total: Number(source.total || 247), completed: count(source.processedUniversityIds), currentUniversityId: source.lastUniversityId || "", currentUniversityName: "", autoApproved: count(first.successIds), review: count(first.reviewIds), error: count(first.errorIds), retryTotal: Number(retry.total || 0), retryCompleted: count(retry.processedUniversityIds) },
  newsCollection: { targetCount: Number(agent.targetCount || 0), completedCount: Number(agent.completedCount || 0), newCount: Number(agent.newCount || 0), errorCount: Number(agent.errorCount || 0) },
  deployment: { status: agent.deploymentStatus || "idle", lastCommit: agent.lastCommit || "", lastPushAt: agent.lastPushAt || "" },
  schedule: { morning: "09:30", afternoon: "16:30", timezone: "Asia/Seoul" }
};
atomic(status); console.log(JSON.stringify(status, null, 2));
