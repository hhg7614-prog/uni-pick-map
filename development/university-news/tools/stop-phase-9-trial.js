"use strict";
const {load,finish}=require("../scheduler/trial-state");
const status=load(); if(!status){console.log("진행 중인 9단계 시험이 없습니다.");process.exit(0);} finish(status,"stopped");console.log("시험 상태를 stopped로 변경했습니다. 현재 실행 중인 프로세스는 다음 예약 실행 전에 종료해야 합니다.");
