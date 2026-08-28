"use strict";

/**
 * B4 -- verdict === "APPROVE" 이고 아직 적용되지 않은(<reviewId>.applied.json
 * 없음) reviewId 를 순회하며 apply-source-activation.js 의 runAllGuards +
 * performActivationAndSave 를 실행합니다.
 *
 * 확정된 설계 결정(.pipeline/spec.md, 2026-08-28):
 *  - 기본은 검증만(--apply 없이 runAllGuards). --apply 시에만 실제 적용.
 *  - --stop-on-first-applied: 첫 성공 후 중단(STALE 연쇄 회피 재작업 단위 = 1건).
 *  - STALE / 서명 실패 등 runAllGuards 실패는 skipped[] 에 기록만(예외 없음).
 *  - 롤백 실패(ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED) 시에만 즉시 중단.
 *  - 스케줄러의 acquireRuntimeLock/releaseRuntimeLock 을 재사용(주입 가능).
 *  - apply-batch-reports/<runId>.json 리포트. getTargetUniversities().length
 *    before/after 기록.
 *  - 소스별(universityId+sourceId) 최신 패킷 1개만 취급.
 *
 * review-decision-writer.js 를 require 하지 않습니다.
 */

const fs = require("fs");
const path = require("path");

const {
  DEFAULT_DATA_DIR,
  DEFAULT_SOURCE_CATALOG_FILE,
  runAllGuards,
  performActivationAndSave,
  writeJsonOnce,
} = require("./apply-source-activation");
const { STORE_PATH, PREVIEW_PATH } = require("../store");
const { getTargetUniversities, isSourceCollectible } = require("../targets");
const { acquireRuntimeLock, releaseRuntimeLock } = require("../runtime-lock");

const RUNTIME_LOCK_NAME = "news-update-agent";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatCompactTimestamp(date) {
  return (
    String(date.getFullYear()) +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate()) +
    pad2(date.getHours()) +
    pad2(date.getMinutes()) +
    pad2(date.getSeconds())
  );
}

/**
 * fixture 카탈로그 파일 기준으로 targets.js 와 동일한 규칙(수집 가능 소스를
 * 1개 이상 가진 대학)으로 대상 대학 수를 셉니다. 테스트에서 countTargetsImpl
 * 로 주입해 실제 프로덕션 카탈로그를 건드리지 않고 before/after 를 검증합니다.
 */
function countTargetUniversitiesInCatalogFile(catalogFile, readFileImpl = fs.readFileSync) {
  const catalog = JSON.parse(readFileImpl(catalogFile, "utf8"));
  return (catalog.universities || []).filter((u) => (u.sources || []).some(isSourceCollectible)).length;
}

/**
 * review-decisions/ 스캔 -> verdict=APPROVE & 미적용 reviewId 목록.
 * 확정 결정 6: 소스별 최신 패킷 1개만.
 */
function listApprovedUnapplied({
  dataDir = DEFAULT_DATA_DIR,
  readFileImpl = fs.readFileSync,
  existsImpl = fs.existsSync,
  readdirImpl = fs.readdirSync,
} = {}) {
  const decisionsDir = path.join(dataDir, "review-decisions");
  const packetsDir = path.join(dataDir, "review-packets");
  let files = [];
  try {
    files = readdirImpl(decisionsDir).filter((name) => name.endsWith(".json") && !name.endsWith(".applied.json"));
  } catch {
    return [];
  }

  const candidates = [];
  for (const file of files) {
    let decision;
    try {
      decision = JSON.parse(readFileImpl(path.join(decisionsDir, file), "utf8"));
    } catch {
      continue;
    }
    if (!decision || decision.verdict !== "APPROVE" || !decision.reviewId) continue;
    if (existsImpl(path.join(decisionsDir, `${decision.reviewId}.applied.json`))) continue;

    let scope = null;
    let createdAt = decision.reviewedAt;
    try {
      const packet = JSON.parse(readFileImpl(path.join(packetsDir, `${decision.reviewId}.json`), "utf8"));
      scope = packet.scope || null;
      createdAt = packet.createdAt || createdAt;
    } catch {
      // 패킷이 없으면 runAllGuards 가 REVIEW_PACKET_NOT_FOUND 로 skip 처리.
    }
    candidates.push({
      reviewId: decision.reviewId,
      decisionPath: path.join(decisionsDir, file),
      scope,
      createdAt,
    });
  }

  const latestBySource = new Map();
  const noScope = [];
  for (const entry of candidates) {
    if (!entry.scope) {
      noScope.push(entry);
      continue;
    }
    const key = `${entry.scope.universityId}::${entry.scope.sourceId}`;
    const current = latestBySource.get(key);
    if (!current || String(entry.createdAt) > String(current.createdAt)) latestBySource.set(key, entry);
  }
  return [...latestBySource.values(), ...noScope].sort((a, b) => a.reviewId.localeCompare(b.reviewId));
}

function applyApprovedActivations({
  apply = false,
  stopOnFirstApplied = false,
  dataDir = DEFAULT_DATA_DIR,
  sourceCatalogFile = DEFAULT_SOURCE_CATALOG_FILE,
  storeFile = STORE_PATH,
  previewFile = PREVIEW_PATH,
  env = process.env,
  now = () => new Date(),
  runId,
  runAllGuardsImpl = runAllGuards,
  performActivationAndSaveImpl = performActivationAndSave,
  performActivationOptions = {},
  countTargetsImpl = () => getTargetUniversities().length,
  acquireLockImpl = acquireRuntimeLock,
  releaseLockImpl = releaseRuntimeLock,
  readFileImpl = fs.readFileSync,
  existsImpl = fs.existsSync,
  readdirImpl = fs.readdirSync,
  writeJsonOnceImpl = writeJsonOnce,
} = {}) {
  const startedAt = now().toISOString();
  const resolvedRunId = runId || `apply-${formatCompactTimestamp(now())}`;

  const lock = acquireLockImpl(RUNTIME_LOCK_NAME);
  if (!lock || !lock.acquired) {
    const error = new Error(
      "applyApprovedActivations: could not acquire the runtime lock -- the scheduler or another apply run is active. Nothing was applied."
    );
    error.code = "RUNTIME_LOCK_UNAVAILABLE";
    throw error;
  }

  const applied = [];
  const skipped = [];
  const failed = [];
  let targetUniversityCountBefore;
  let targetUniversityCountAfter;
  let manualInterventionRequired = false;

  try {
    targetUniversityCountBefore = countTargetsImpl();
    const candidates = listApprovedUnapplied({ dataDir, readFileImpl, existsImpl, readdirImpl });

    let stop = false;
    for (const { reviewId } of candidates) {
      if (stop) {
        skipped.push({ reviewId, code: "SKIPPED_AFTER_STOP", reasons: ["A previous item in this run stopped further processing."] });
        continue;
      }

      const guard = runAllGuardsImpl(reviewId, { dataDir, sourceCatalogFile, storeFile, previewFile, env });
      if (guard.failed) {
        skipped.push({ reviewId, code: guard.code, reasons: guard.reasons || [] });
        continue;
      }

      if (!apply) {
        skipped.push({ reviewId, code: "VALIDATED_NOT_APPLIED", reasons: [] });
        continue;
      }

      try {
        const result = performActivationAndSaveImpl(guard.packet, {
          reviewId,
          dataDir,
          sourceCatalogFile,
          storeFile,
          previewFile,
          ...performActivationOptions,
        });
        applied.push({ reviewId, saveResult: result.saveResult, backupDir: result.backupDir });
        if (stopOnFirstApplied) stop = true;
      } catch (error) {
        const entry = {
          reviewId,
          code: error.code || "APPLY_FAILED",
          rollback: error.rollback || null,
          backupDir: error.backupDir || null,
          reasons: error.reasons || [error.message],
        };
        failed.push(entry);
        if (error.code === "ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED") {
          manualInterventionRequired = true;
          stop = true;
        }
      }
    }

    targetUniversityCountAfter = countTargetsImpl();
  } finally {
    releaseLockImpl(lock);
  }

  const report = {
    runId: resolvedRunId,
    startedAt,
    finishedAt: now().toISOString(),
    apply,
    stopOnFirstApplied,
    manualInterventionRequired,
    applied,
    skipped,
    failed,
    targetUniversityCountBefore,
    targetUniversityCountAfter,
  };
  writeJsonOnceImpl(path.join(dataDir, "apply-batch-reports", `${resolvedRunId}.json`), report, {});
  return report;
}

function parseCliArgs(argv) {
  const read = (name) => {
    const hit = argv.find((value) => value.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1).trim() : undefined;
  };
  return {
    apply: argv.includes("--apply"),
    stopOnFirstApplied: argv.includes("--stop-on-first-applied"),
    runId: read("--run-id"),
  };
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  try {
    const report = applyApprovedActivations(options);
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length || report.manualInterventionRequired) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", code: error.code || "APPLY_BATCH_FAILED", reasons: [error.message] }));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  RUNTIME_LOCK_NAME,
  formatCompactTimestamp,
  countTargetUniversitiesInCatalogFile,
  listApprovedUnapplied,
  applyApprovedActivations,
  parseCliArgs,
};
