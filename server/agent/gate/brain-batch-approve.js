"use strict";

/**
 * B3 -- Brain 전용, 비배선(NOT WIRED).
 *
 * *** 중요 ***
 * 이 파일은 package.json 의 어떤 스크립트에서도, server/agent/onboarding/**,
 * server/agent/tools/**, server/agent/scheduler.js, runner.js 어디에서도
 * require/호출되지 않습니다. `node --test` 로만 실행되는 독립 도구이며,
 * Brain 이 서명 키(UNIPICK_GATE_SIGNING_KEY)를 보유한 자신의 로컬 실행
 * 컨텍스트에서만 직접 실행합니다.
 *
 * gate 모듈 중에서는 review-decision-writer.js 만 require 합니다(서명/판정
 * 파일 생성 책임을 한 곳에 유지). 서명 키 환경변수 이름은 signing-utils.js 를
 * require 하지 않기 위해 apply-source-activation.js 의 BLOCKED_REVIEWER_NAMES
 * 재정의 선례와 동일하게 이 파일에 독립적으로 다시 선언합니다.
 *
 * 사용법:
 *   node server/agent/gate/brain-batch-approve.js --list
 *   node server/agent/gate/brain-batch-approve.js --approve --review-ids=<id1,id2> --reviewed-by=<name> --reason="..."
 *   node server/agent/gate/brain-batch-approve.js --approve --all-pending --reviewed-by=<name> --reason="..."
 */

const fs = require("fs");
const path = require("path");

const { writeReviewDecision, DEFAULT_DATA_DIR } = require("./review-decision-writer");

// signing-utils.js 를 require 하지 않기 위한 독립 선언(값은 동일).
const SIGNING_KEY_ENV_VAR = "UNIPICK_GATE_SIGNING_KEY";

function loadSigningKey(env) {
  const value = env ? env[SIGNING_KEY_ENV_VAR] : undefined;
  return value && String(value).trim() ? String(value) : null;
}

const DEFAULT_CHECKED_ITEMS = { robotsPolicyViolation: false, jsRuleUnverified: false, diagnoseFailed: false };

function summarizePacket(packet) {
  const d = (packet && packet.diagnostics) || {};
  const robots = (packet && packet.robotsEvidence) || {};
  const regression = (packet && packet.regressionEvidence) || {};
  return {
    createdAt: packet && packet.createdAt,
    diagnostics: {
      foundCount: d.foundCount,
      acceptedCount: d.acceptedCount,
      newCount: d.newCount,
      duplicateCount: d.duplicateCount,
      excludedCount: d.excludedCount,
      acceptedNewItemsForSaveCount: Array.isArray(d.acceptedNewItemsForSave) ? d.acceptedNewItemsForSave.length : 0,
    },
    robotsEvidence: { checked: robots.checked, unavailable: robots.unavailable, blocked: robots.policy && robots.policy.blocked },
    regressionEvidence: { npmTestSummary: regression.npmTestSummary, ranAt: regression.ranAt },
  };
}

/**
 * 패킷은 있으나 판정 파일이 없는 reviewId 목록. 확정 결정 6에 따라
 * 소스별(universityId+sourceId) 최신 패킷 1개만 반환합니다.
 */
function listPendingReviews({
  dataDir = DEFAULT_DATA_DIR,
  readFileImpl = fs.readFileSync,
  existsImpl = fs.existsSync,
  readdirImpl = fs.readdirSync,
} = {}) {
  const packetsDir = path.join(dataDir, "review-packets");
  const decisionsDir = path.join(dataDir, "review-decisions");
  let files = [];
  try {
    files = readdirImpl(packetsDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const pending = [];
  for (const file of files) {
    let packet;
    try {
      packet = JSON.parse(readFileImpl(path.join(packetsDir, file), "utf8"));
    } catch {
      continue;
    }
    if (!packet || !packet.reviewId || !packet.scope) continue;
    if (existsImpl(path.join(decisionsDir, `${packet.reviewId}.json`))) continue;
    pending.push({
      reviewId: packet.reviewId,
      scope: packet.scope,
      createdAt: packet.createdAt,
      summary: summarizePacket(packet),
    });
  }

  const latestBySource = new Map();
  for (const entry of pending) {
    const key = `${entry.scope.universityId}::${entry.scope.sourceId}`;
    const current = latestBySource.get(key);
    if (!current || String(entry.createdAt) > String(current.createdAt)) latestBySource.set(key, entry);
  }
  return [...latestBySource.values()].sort((a, b) => a.reviewId.localeCompare(b.reviewId));
}

/**
 * 한 건 서명(writeReviewDecision 래퍼). 서명 키가 없으면 파일을 만들지 않고
 * SIGNING_KEY_UNAVAILABLE 로 throw 합니다.
 */
function approveOne(
  reviewId,
  {
    dataDir = DEFAULT_DATA_DIR,
    reviewedBy,
    reasons,
    verdict = "APPROVE",
    checkedItems = DEFAULT_CHECKED_ITEMS,
    signingKey,
    env = process.env,
    now = new Date(),
    writeReviewDecisionImpl = writeReviewDecision,
  } = {}
) {
  const key = signingKey || loadSigningKey(env);
  if (!key) {
    const error = new Error(
      `brain-batch-approve: signing key unavailable (env var ${SIGNING_KEY_ENV_VAR} not set). No review decision file was written.`
    );
    error.code = "SIGNING_KEY_UNAVAILABLE";
    throw error;
  }
  const { decision, writtenPath } = writeReviewDecisionImpl({
    reviewId,
    dataDir,
    verdict,
    reasons,
    checkedItems,
    reviewedBy,
    signingKey: key,
    now,
  });
  return { reviewId, verdict: decision.verdict, writtenPath };
}

/**
 * 여러 건 순회. 서명 키가 없으면 아무 파일도 만들지 않고 즉시 throw.
 * 이미 판정 파일이 있는 reviewId 는 건너뛰고 기록합니다(append-only).
 * 한 건이 실패해도 나머지는 계속 진행합니다.
 */
function batchApprove(
  reviewIds,
  {
    dataDir = DEFAULT_DATA_DIR,
    reviewedBy,
    reasons,
    verdict = "APPROVE",
    checkedItems = DEFAULT_CHECKED_ITEMS,
    signingKey,
    env = process.env,
    now = new Date(),
    existsImpl = fs.existsSync,
    writeReviewDecisionImpl = writeReviewDecision,
  } = {}
) {
  const key = signingKey || loadSigningKey(env);
  if (!key) {
    const error = new Error(
      `brain-batch-approve: signing key unavailable (env var ${SIGNING_KEY_ENV_VAR} not set). No review decision files were written.`
    );
    error.code = "SIGNING_KEY_UNAVAILABLE";
    throw error;
  }

  const approved = [];
  const failed = [];
  const skipped = [];
  for (const reviewId of reviewIds) {
    const decisionPath = path.join(dataDir, "review-decisions", `${reviewId}.json`);
    if (existsImpl(decisionPath)) {
      skipped.push({ reviewId, reason: "DECISION_ALREADY_EXISTS" });
      continue;
    }
    try {
      approved.push(
        approveOne(reviewId, {
          dataDir,
          reviewedBy,
          reasons,
          verdict,
          checkedItems,
          signingKey: key,
          now,
          writeReviewDecisionImpl,
        })
      );
    } catch (error) {
      failed.push({ reviewId, error: error.message });
    }
  }
  return { approved, failed, skipped };
}

function parseCliArgs(argv) {
  const read = (name) => {
    const hit = argv.find((value) => value === name || value.startsWith(`${name}=`));
    if (!hit) return undefined;
    return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1).trim() : "";
  };
  return {
    list: argv.includes("--list"),
    approve: argv.includes("--approve"),
    allPending: argv.includes("--all-pending"),
    reviewIds: (read("--review-ids") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    reviewedBy: read("--reviewed-by"),
    reason: read("--reason"),
    verdict: read("--verdict") || "APPROVE",
    checkedItemsFile: read("--checked-items-file"),
  };
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.list) {
    const pending = listPendingReviews({});
    console.log(JSON.stringify({ pendingCount: pending.length, pending }, null, 2));
    return;
  }

  if (!options.approve) {
    console.error(JSON.stringify({ status: "REJECTED", code: "INVALID_ARGS", reasons: ["Use --list or --approve."] }));
    process.exitCode = 1;
    return;
  }

  const key = loadSigningKey(process.env);
  if (!key) {
    console.error(
      JSON.stringify({ status: "REJECTED", code: "SIGNING_KEY_UNAVAILABLE", reasons: [`env var ${SIGNING_KEY_ENV_VAR} is not set`] })
    );
    process.exitCode = 1;
    return;
  }

  if (!options.reason) {
    console.error(JSON.stringify({ status: "REJECTED", code: "INVALID_ARGS", reasons: ["--reason is required."] }));
    process.exitCode = 1;
    return;
  }

  let checkedItems = DEFAULT_CHECKED_ITEMS;
  if (options.checkedItemsFile) {
    checkedItems = JSON.parse(fs.readFileSync(options.checkedItemsFile, "utf8"));
  }

  let reviewIds = options.reviewIds;
  if (options.allPending) {
    reviewIds = listPendingReviews({}).map((entry) => entry.reviewId);
  }
  if (!reviewIds.length) {
    console.error(JSON.stringify({ status: "REJECTED", code: "NO_REVIEW_IDS", reasons: ["No reviewIds to approve."] }));
    process.exitCode = 1;
    return;
  }

  try {
    const result = batchApprove(reviewIds, {
      reviewedBy: options.reviewedBy,
      reasons: [options.reason],
      verdict: options.verdict,
      checkedItems,
      signingKey: key,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", code: error.code || "BATCH_APPROVE_FAILED", reasons: [error.message] }));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  SIGNING_KEY_ENV_VAR,
  loadSigningKey,
  summarizePacket,
  listPendingReviews,
  approveOne,
  batchApprove,
  parseCliArgs,
};
