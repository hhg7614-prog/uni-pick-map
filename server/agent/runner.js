"use strict";

/**
 * 단발 실행기 (Runner)
 *
 * 뉴스 수집 전체 파이프라인을 1회 실행합니다.
 * 스케줄러(scheduler.js)와 수동 실행(news:agent:once)에서 사용합니다.
 *
 * 실행 순서:
 * 1. 잠금 획득
 * 2. 대상 대학 목록 확인
 * 3. 보고서 초안 생성
 * 4. 각 대학/소스별 수집
 * 5. 중복 필터
 * 6. 저장소 + preview 원자적 저장
 * 7. 보고서 확정 저장
 * 8. 잠금 해제
 *
 * 에이전트 오류는 모두 catch 하므로 지도·검색 기능은 영향 없음.
 */

const { getAgentConfig } = require("./config");
const { getTargetUniversities } = require("./targets");
const { collectForUniversity } = require("./collector");
const { filterNewItems } = require("./dedup");
const { getAllItems, saveNewItems } = require("./store");
const { acquireLock, releaseLock } = require("./lock");
const { acquireRuntimeLock, releaseRuntimeLock } = require("./runtime-lock");
const { saveReport, pruneOldReports } = require("./report");

function log(message) {
  console.log(`[agent/runner] ${message}`);
}

/**
 * 뉴스 수집 파이프라인을 1회 실행합니다.
 * @param {{ trigger?: string }} options
 * @returns {Promise<object>} - 실행 결과 요약
 */
async function runOnce({ trigger = "manual" } = {}) {
  const startedAt = new Date().toISOString();
  const runId = `run-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 15)}`;

  log(`실행 시작 (runId: ${runId}, trigger: ${trigger})`);

  // 잠금 획득 (이미 실행 중이면 종료)
  const lock = acquireLock();
  if (!lock.acquired) {
    log("이전 실행이 진행 중이어서 건너뜁니다.");
    return { skipped: true, reason: "overlap", runId };
  }

  const config = getAgentConfig();
  let universityResults = [];
  let totalCollected = 0;
  let totalNew = 0;
  let totalDuplicate = 0;
  let totalErrors = 0;
  let allNewItems = [];
  const imageStats = { itemsProcessed: 0, withImage: 0, withoutImage: 0, newImages: 0, backfilledImages: 0, imageErrors: 0 };

  try {
    // 대상 대학 목록
    const targets = getTargetUniversities();
    log(`대상 대학: ${targets.length}개`);

    if (targets.length === 0) {
      log("수집 가능한 대학이 없습니다. (verified 소스 없음)");
    } else {
      // 기존 저장 항목 (중복 체크용)
      const existingItems = getAllItems();

      // 대학별 수집
      for (const university of targets) {
        log(`수집 중: ${university.universityName}`);
        let uResult;
        try {
          uResult = await collectForUniversity(university, config.limitPerSource);
        } catch (error) {
          log(`오류 - ${university.universityName}: ${error.message}`);
          totalErrors++;
          universityResults.push({
            universityId: university.universityId,
            universityName: university.universityName,
            collectedCount: 0,
            newCount: 0,
            duplicateCount: 0,
            error: error.message,
          });
          continue;
        }

        // 중복 필터 (기존 + 이번 실행에서 이미 추가된 항목 포함)
        const { newItems, duplicateCount } = filterNewItems(
          uResult.items,
          [...existingItems, ...allNewItems]
        );

        totalCollected += uResult.items.length;
        for (const item of uResult.items) { imageStats.itemsProcessed += 1; if (item.imageUrl) imageStats.withImage += 1; else imageStats.withoutImage += 1; if (item.imageError) imageStats.imageErrors += 1; }
        totalNew += newItems.length;
        imageStats.newImages += newItems.filter(item => item.imageUrl).length;
        totalDuplicate += duplicateCount;
        allNewItems.push(...newItems);

        universityResults.push({
          universityId: university.universityId,
          universityName: university.universityName,
          collectedCount: uResult.items.length,
          newCount: newItems.length,
          duplicateCount,
          errors: uResult.sourceResults
            .filter((s) => s.error)
            .map((s) => `${s.sourceName}: ${s.error}`),
        });
      }

      // 신규 항목 저장 (저장소 + preview 원자적)
      if (allNewItems.length > 0) {
        const writeLock = acquireRuntimeLock("production-news-write");
        if (!writeLock.acquired) throw new Error("PRODUCTION_NEWS_WRITE_ALREADY_RUNNING");
        let saveResult;
        try {
          saveResult = saveNewItems(allNewItems);
        } finally {
          releaseRuntimeLock(writeLock);
        }
        log(`저장 완료: ${saveResult.savedCount}건 (누적: ${saveResult.totalCount}건)`);
      } else {
        log("신규 게시물이 없습니다.");
      }
    }
  } catch (error) {
    log(`파이프라인 오류: ${error.message}`);
    totalErrors++;
  } finally {
    releaseLock();
  }

  const finishedAt = new Date().toISOString();

  // 보고서 저장
  const report = saveReport({
    runId,
    trigger,
    startedAt,
    finishedAt,
    targetCount: universityResults.length,
    collectedTotal: totalCollected,
    newCount: totalNew,
    duplicateCount: totalDuplicate,
    errorCount: totalErrors,
    totalStoredItems: getAllItems().length,
    universityResults,
    imageStats,
  });

  pruneOldReports(30);

  log(
    `완료 (신규: ${totalNew}건, 중복: ${totalDuplicate}건, 오류: ${totalErrors}건)`
  );

  return report;
}

module.exports = { runOnce };
