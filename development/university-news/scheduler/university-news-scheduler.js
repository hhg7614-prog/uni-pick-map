"use strict";
const path = require("path");
const { spawnSync } = require("child_process");
const { getSchedulerConfig, nextScheduledAt } = require("./scheduler-config");
const { acquireLock, releaseLock } = require("./scheduler-lock");
const trial = require("./trial-state");

const args=process.argv.slice(2), trialMode=args.includes("--trial"), runOnce=args.includes("--run-once"), dryRun=args.includes("--dry-run"), provider=args.find((arg)=>arg.startsWith("--provider="))||"--provider=disabled";
const config=getSchedulerConfig(); let stopping=false, timer=null;
function log(message){console.log(`[UNI PICK scheduler] ${message}`);}
function next(){return nextScheduledAt(new Date(),config.timezone);}
function currentTrial(){return trial.load();}
function shouldStop(status){return status && (!status.trialEnabled || status.trialStatus!=="running" || Date.now()>=Date.parse(status.endsAt));}
function finalizeIfNeeded(status){if(status&&Date.now()>=Date.parse(status.endsAt)&&status.trialStatus==="running"){trial.finish(status,"completed");log("24시간 시험 운영이 종료되어 자동 수집을 중지했습니다.");} }
function execute(){const status=trialMode?currentTrial():null;finalizeIfNeeded(status);if(trialMode&&shouldStop(currentTrial())){stopping=true;return;}const id=`scheduled-${Date.now()}`,lock=acquireLock(id);if(!lock.acquired){log("이전 실행이 아직 진행 중이어서 건너뜁니다 (skipped_overlap).");return;}try{const result=spawnSync(process.execPath,[path.resolve(__dirname,"..","tools","run-phase-8-reported-pipeline.js"),"--trigger=scheduled",provider],{cwd:process.cwd(),stdio:"inherit"});if(result.status)process.exitCode=result.status;if(trialMode){const latest=JSON.parse(require("fs").readFileSync(path.resolve(__dirname,"..","reports","latest-run.json"),"utf8"));const active=currentTrial();if(active)trial.updateFromRun(active,latest,next());trial.summarize(currentTrial());}}finally{releaseLock(id);}}
function schedule(){const status=trialMode?currentTrial():null;finalizeIfNeeded(status);if(trialMode&&shouldStop(currentTrial()))return log("시험 운영이 종료되었거나 중지되었습니다.");const at=next(),delay=Math.max(0,new Date(at).getTime()-Date.now());if(trialMode){const state=currentTrial();state.nextRunAt=at;trial.save(state);}log(`대기 중입니다. 다음 실행: ${at} (${config.timezone})`);timer=setTimeout(()=>{execute();if(!stopping)schedule();},delay);}
function shutdown(signal){stopping=true;if(timer)clearTimeout(timer);const status=trialMode?currentTrial():null;if(status&&status.trialStatus==="running"){status.nextRunAt=null;trial.save(status);}log(`${signal} 수신: 새 실행을 중단하고 잠금은 실행 종료 시 정리합니다.`);process.exit(0);}
process.on("SIGINT",()=>shutdown("SIGINT"));process.on("SIGTERM",()=>shutdown("SIGTERM"));
if(dryRun){log(JSON.stringify({trial:trialMode,enabled:trialMode||config.schedulerEnabled,timezone:config.timezone,expression:config.scheduleExpression,nextScheduledAt:next(),targets:["snu","yonsei","hanyang"],provider:provider.slice(11),maxCollection:30,maxAi:15},null,2));}
else if(runOnce)execute();
else if(trialMode){let status=currentTrial();if(!status||status.trialStatus!=="running"){status=trial.createTrial(next());trial.save(status);trial.summarize(status);log(`24시간 시험 운영을 시작했습니다. 종료 예정: ${status.endsAt}`);}schedule();}
else if(config.schedulerEnabled){schedule();if(config.runOnStartup)execute();}
else log("UNI PICK scheduler is disabled. Use --trial to start the 24-hour test or set NEWS_SCHEDULE_ENABLED=true.");
