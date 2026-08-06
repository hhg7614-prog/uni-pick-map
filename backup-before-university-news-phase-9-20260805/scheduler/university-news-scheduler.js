"use strict";
const path = require("path");
const { spawnSync } = require("child_process");
const { getSchedulerConfig, nextScheduledAt } = require("./scheduler-config");
const { acquireLock, releaseLock } = require("./scheduler-lock");
const args = process.argv.slice(2); const runOnce = args.includes("--run-once"); const provider = args.find((arg)=>arg.startsWith("--provider=")) || "--provider=disabled";
const config = getSchedulerConfig();
function execute() { const id=`scheduled-${Date.now()}`; const lock=acquireLock(id); if(!lock.acquired){console.log(JSON.stringify({status:"skipped_overlap",reason:"previous_run_still_active",nextScheduledAt:nextScheduledAt(new Date(),config.timezone)}));return;} try { const result=spawnSync(process.execPath,[path.resolve(__dirname,"..","tools","run-phase-8-reported-pipeline.js"),"--trigger=scheduled",provider],{cwd:process.cwd(),stdio:"inherit"}); if(result.status) process.exitCode=result.status; } finally { releaseLock(id); } }
if(runOnce) execute(); else if(config.schedulerEnabled){ const next=nextScheduledAt(new Date(),config.timezone),delay=Math.max(0,new Date(next).getTime()-Date.now()); console.log(`UNI PICK scheduler enabled (${config.scheduleExpression}, ${config.timezone}); next: ${next}`); setTimeout(()=>{execute();setInterval(execute,config.intervalMs);},delay); if(config.runOnStartup) execute(); } else console.log("UNI PICK scheduler is disabled. Set NEWS_SCHEDULE_ENABLED=true to enable it.");
