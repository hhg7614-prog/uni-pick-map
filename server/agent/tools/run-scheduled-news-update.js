"use strict";

// Runs only from the dedicated clean scheduler worktree. Source activation is intentionally absent.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { getTargetUniversities } = require("../targets");
const { runOnce } = require("../runner");
const { STORE_PATH, PREVIEW_PATH, getAllItems } = require("../store");
const { acquireRuntimeLock, releaseRuntimeLock } = require("../runtime-lock");
const { writeHtmlReport } = require("../report-html");

const ROOT = path.resolve(__dirname, "../../..");
const REPORT_PATH = path.join(ROOT, "server/agent/news/reports/ui/latest-news-update-report.html");
const RESULT_PATH = path.join(ROOT, "server/agent/runtime/news-update-result.json");
const GENERATED = ["server/agent/data/agent-news-store.json", "data/university-news-preview.json"];
function git(args, allowFailure = false) { try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio:["ignore","pipe","pipe"] }).trim(); } catch (e) { if (allowFailure) return ""; throw new Error((e.stderr || e.message).trim()); } }
function countPreview() { try { return (JSON.parse(fs.readFileSync(PREVIEW_PATH,"utf8")).items || []).length; } catch { return 0; } }
function cleanAndCurrent() {
  if (git(["status","--porcelain"])) throw new Error("SCHEDULER_WORKSPACE_DIRTY");
  git(["fetch","origin","main"]);
  if (git(["rev-parse","HEAD"]) !== git(["rev-parse","origin/main"])) throw new Error("SCHEDULER_WORKSPACE_BEHIND_OR_AHEAD");
}
function validateGenerated() {
  for (const file of GENERATED) JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const invalid = getAllItems().filter(item => !item.publishedAt);
  if (invalid.length) throw new Error(`PUBLISHED_AT_NULL:${invalid.length}`);
}
function runTests() { execFileSync("npm", ["test"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" }); }
function writeResult(payload) { fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true }); const temporary = `${RESULT_PATH}.tmp`; fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(temporary, "utf8")); fs.renameSync(temporary, RESULT_PATH); }
function main() {
  const startedAt = new Date().toISOString();
  const lock = acquireRuntimeLock("news-update-agent");
  if (!lock.acquired) throw new Error("NEWS_AGENT_ALREADY_RUNNING");
  const before = { store: getAllItems().length, preview: countPreview(), activeSources: getTargetUniversities().reduce((n, u) => n + u.sources.length, 0) };
  let result;
  try {
    cleanAndCurrent();
    result = runOnce({ trigger: "windows-task-scheduler" });
    if (result && typeof result.then === "function") throw new Error("SCHEDULER_ASYNC_RUNNER_UNSUPPORTED");
  } finally { releaseRuntimeLock(lock); }
  // runOnce is async; retained only to make misuse explicit.
  return { startedAt, before, result };
}

async function asyncMain() {
  const startedAt = new Date().toISOString(); const lock = acquireRuntimeLock("news-update-agent");
  if (!lock.acquired) throw new Error("NEWS_AGENT_ALREADY_RUNNING");
  const before = { store: getAllItems().length, preview: countPreview(), activeSources: getTargetUniversities().reduce((n,u)=>n+u.sources.length,0) };
  let status = "FAILED", run, changed = [];
  try {
    cleanAndCurrent();
    run = await runOnce({ trigger: "windows-task-scheduler" });
    validateGenerated();
    runTests();
    changed = git(["diff","--name-only","HEAD","--",...GENERATED]).split("\n").filter(Boolean);
    if (changed.length === 0) status = "NO_CHANGES";
    else {
      git(["add","--",...changed]);
      const staged = git(["diff","--cached","--name-only"]).split("\n").filter(Boolean);
      if (staged.some(file => !GENERATED.includes(file))) throw new Error("UNEXPECTED_STAGED_FILE");
      git(["commit","-m","chore(news): update university news feed"]);
      git(["push","origin","HEAD:main"]);
      status = "DEPLOY_TRIGGERED";
    }
    const completedAt = new Date().toISOString();
    const payload = { agent:"news-update", runId:`news-${startedAt.replace(/[-:.TZ]/g,"")}`, status: status === "DEPLOY_TRIGGERED" ? "SUCCESS" : "NO_CHANGES", startedAt, finishedAt:completedAt, processed:(run.universityResults||[]).length, success:(run.universityResults||[]).filter(x=>!x.error && !(x.errors||[]).length).length, failed:(run.universityResults||[]).filter(x=>x.error || (x.errors||[]).length).length, activeSources: before.activeSources, successfulSources: (run.universityResults||[]).filter(x=>!x.error && !(x.errors||[]).length).length, failedSources: (run.universityResults||[]).filter(x=>x.error || (x.errors||[]).length).length, newItems: run.newCount||0, duplicates: run.duplicateCount||0, publishedAtNull: 0, storeBefore: before.store, storeAfter: getAllItems().length, previewBefore: before.preview, previewAfter: countPreview(), commitHash: status === "DEPLOY_TRIGGERED" ? git(["rev-parse","HEAD"]) : null, pushStatus: status === "DEPLOY_TRIGGERED" ? "배포 요청 완료" : "실행하지 않음", renderStatus: status === "DEPLOY_TRIGGERED" ? "deploy_triggered" : "not_required", nextRun: "09:30 / 16:30", messageKo: status === "DEPLOY_TRIGGERED" ? "뉴스 업데이트와 배포 요청이 완료되었습니다." : "새로운 뉴스가 없습니다.", reportOpen: "REPORT_OPEN_SKIPPED" };
    writeResult(payload);
    writeHtmlReport(REPORT_PATH, "UNI PICK News Update Report", payload); console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    const warning = /^PUBLISHED_AT_NULL:/.test(error.message);
    const payload = { agent:"news-update", runId:`news-${startedAt.replace(/[-:.TZ]/g,"")}`, status: warning ? "WARNING" : "FAILED", startedAt, finishedAt:new Date().toISOString(), processed:0, success:0, failed:1, newItems:0, duplicates:0, error:error.message, messageKo: warning ? "수집은 완료되었지만 게시일이 없는 항목이 있어 자동 배포를 중단했습니다." : "뉴스 자동 업데이트 중 오류가 발생했습니다.", pushStatus:"실행하지 않음", renderStatus:"not_required", reportOpen:"REPORT_OPEN_SKIPPED" };
    writeResult(payload);
    writeHtmlReport(REPORT_PATH, "UNI PICK News Update Report", payload); console.error(JSON.stringify(payload,null,2)); process.exitCode=1;
  } finally { releaseRuntimeLock(lock); }
}
asyncMain();
