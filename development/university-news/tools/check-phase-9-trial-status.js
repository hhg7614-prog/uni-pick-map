"use strict";
const {load}=require("../scheduler/trial-state");
const status=load();
if(!status) console.log("[UNI PICK 자동 업데이트 시험 상태]\n시험 상태: 시작되지 않음");
else console.log(`[UNI PICK 자동 업데이트 시험 상태]\n시험 상태: ${status.trialStatus}\n시작 시각: ${status.startedAt}\n종료 예정: ${status.endsAt}\n완료 실행: ${status.completedRuns} / ${status.expectedRuns}\n성공: ${status.successfulRuns}\n일부 성공: ${status.partialSuccessRuns}\n실패: ${status.failedRuns}\n겹침 건너뜀: ${status.skippedOverlapRuns}\n마지막 실행: ${status.lastRunAt||"-"}\n다음 실행: ${status.nextRunAt||"-"}`);
