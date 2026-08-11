"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {pendingPlan}=require("./run-university-feed-agent-v1-queue");
const items=(n)=>Array.from({length:n},(_,i)=>({universityId:`u-${i}`,status:"PENDING",initialAttemptCompleted:false,retryRequired:false}));
test("final pending batch accepts all nine without retry fill",()=>{const p=pendingPlan({items:items(9)},20);assert.deepEqual({remaining:p.remainingPendingCount,expected:p.expectedBatchSize,selected:p.selected.length,complete:p.initialSweepComplete},{remaining:9,expected:9,selected:9,complete:false})});
test("normal pending batch remains twenty",()=>{const p=pendingPlan({items:items(25)},20);assert.equal(p.expectedBatchSize,20);assert.equal(p.selected.length,20)});
test("zero pending completes the initial sweep without selection",()=>{const p=pendingPlan({items:[]},20);assert.deepEqual({expected:p.expectedBatchSize,selected:p.selected.length,complete:p.initialSweepComplete},{expected:0,selected:0,complete:true})});
