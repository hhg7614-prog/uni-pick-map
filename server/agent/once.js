"use strict";

/**
 * 단발 1회 수집 실행 진입점 (news:agent:once)
 *
 * 스케줄을 기다리지 않고 지금 바로 1회 수집을 실행합니다.
 * 자동 실행(NEWS_AGENT_ENABLED) 설정과 관계없이 동작합니다.
 */

const { runOnce } = require("./runner");

console.log("\n=== UNI PICK 뉴스 에이전트 수동 1회 실행 ===\n");

runOnce({ trigger: "manual" })
  .then((result) => {
    if (result.skipped) {
      console.log("⚠️  이전 실행이 아직 진행 중이어서 건너뜁니다.");
    } else {
      console.log(`\n✅ 수집 완료`);
      console.log(`   신규 저장: ${result.newCount ?? 0}건`);
      console.log(`   중복 제외: ${result.duplicateCount ?? 0}건`);
      console.log(`   오류 건수: ${result.errorCount ?? 0}건`);
    }
    console.log("");
  })
  .catch((error) => {
    console.error("❌ 실행 중 오류:", error.message);
    process.exitCode = 1;
  });
