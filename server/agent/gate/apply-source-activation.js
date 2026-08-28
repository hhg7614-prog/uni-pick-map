"use strict";

/**
 * `--apply` CLI -- Brain 의 APPROVE + 서명 검증 + 체크섬 검증을 전부 통과한
 * 뒤에만 실제로 소스를 활성화(enabled=true)하고 신규 항목을 저장합니다.
 *
 * 사용법(.pipeline/spec.md 설계안 4번):
 *   node server/agent/gate/apply-source-activation.js --review-id=<reviewId>            // 기본: 검증만, 쓰기 없음
 *   node server/agent/gate/apply-source-activation.js --review-id=<reviewId> --apply    // 검증 통과 시에만 실제 쓰기
 *
 * 이 파일은 review-decision-writer.js 를 require() 하지 않습니다(의도적 --
 * "판정 파일을 쓰는 코드"와 "판정 파일을 검증/소비하는 코드"를 어떤 경로로도
 * 연결하지 않기 위해, 블록리스트 등 겉보기에 공용처럼 보이는 상수도 이
 * 파일에 독립적으로 다시 정의합니다).
 */

const fs = require("fs");
const path = require("path");

const { computeAllChecksums } = require("./checksum-utils");
const { computePacketSha256 } = require("./review-packet");
const { verifyDecisionSignature, loadSigningKeyFromEnv } = require("./signing-utils");
const { STORE_PATH, PREVIEW_PATH, saveNewItems } = require("../store");
const { backupBeforeSave } = require("../tools/run-single-school-trial");

const ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const DEFAULT_SOURCE_CATALOG_FILE = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");

// review-decision-writer.js 의 BLOCKED_REVIEWER_NAMES 와 값은 같지만
// 의도적으로 독립 정의합니다(파일 간 require 연결을 만들지 않기 위해 --
// 위 파일 상단 주석 참고).
const BLOCKED_REVIEWER_NAMES = ["code-agent", "planner", "coder", "tester", "reviewer"];

function normalizeReviewerName(value) {
  return String(value || "").trim().toLowerCase();
}

class GateApplyFailure extends Error {
  constructor({ code, reviewId, reasons = [], backupDir, rollback, originalError } = {}) {
    super(`Gate apply failed: ${code}`);
    this.name = "GateApplyFailure";
    this.code = code;
    this.reviewId = reviewId;
    this.reasons = reasons;
    this.backupDir = backupDir;
    this.rollback = rollback;
    this.originalError = originalError;
  }
}

function parseArgs(argv) {
  const reviewIdArg = argv.find((value) => value.startsWith("--review-id="));
  const reviewId = reviewIdArg ? reviewIdArg.slice("--review-id=".length).trim() : "";
  if (!reviewId) throw new Error("--review-id=<reviewId> is required.");
  const apply = argv.includes("--apply");
  return { reviewId, apply };
}

function fail(code, reasons) {
  return { failed: true, code, reasons };
}

function findSourceInCatalog(catalog, scope) {
  const university = (catalog.universities || []).find((entry) => entry.universityId === scope.universityId);
  if (!university) throw new Error(`findSourceInCatalog: university not found in catalog: ${scope.universityId}`);
  const source = (university.sources || []).find((entry) => entry.id === scope.sourceId);
  if (!source) throw new Error(`findSourceInCatalog: source not found in catalog: ${scope.sourceId} (university: ${scope.universityId})`);
  return { university, source };
}

// enabled/verified/status 3개 필드만 변경한다(최소 diff 원칙, 설계안 6번).
// 다른 필드/다른 대학/다른 소스는 절대 건드리지 않는다.
function applyMinimalDiff(catalog, scope, proposedChange) {
  const { source } = findSourceInCatalog(catalog, scope);
  for (const field of ["enabled", "verified", "status"]) {
    if (proposedChange && proposedChange[field]) source[field] = proposedChange[field].to;
  }
  return catalog;
}

// store.js writeAtomic() 과 동일한 패턴(tmp 파일 -> 파싱 검증 -> rename).
function writeJsonAtomic(filePath, data, { writeFileImpl = fs.writeFileSync, readFileImpl = fs.readFileSync, renameImpl = fs.renameSync } = {}) {
  const tmp = `${filePath}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  writeFileImpl(tmp, content, "utf8");
  JSON.parse(readFileImpl(tmp, "utf8")); // 검증: 쓴 파일이 유효한 JSON인지 확인
  renameImpl(tmp, filePath);
}

function writeJsonOnce(filePath, data, { existsImpl = fs.existsSync, mkdirImpl = fs.mkdirSync, writeFileImpl = fs.writeFileSync } = {}) {
  if (existsImpl(filePath)) throw new Error(`Refusing to overwrite an existing file: ${filePath} (append-only).`);
  mkdirImpl(path.dirname(filePath), { recursive: true });
  writeFileImpl(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function restoreFromBackup(targetPath, backupPath, { existsImpl = fs.existsSync, copyFileImpl = fs.copyFileSync } = {}) {
  if (existsImpl(backupPath)) copyFileImpl(backupPath, targetPath);
}

function isValidJsonFile(filePath, readFileImpl = fs.readFileSync) {
  try {
    JSON.parse(readFileImpl(filePath, "utf8"));
    return true;
  } catch {
    return false;
  }
}

/**
 * 승인/서명/체크섬 검증 체인 전체(설계안 3번 applySourceActivation()
 * pseudocode + 4번 CLI 설계의 runAllGuards()).
 *
 * 실패 시 { failed: true, code, reasons } 를 반환하고(예외를 던지지 않음),
 * 통과 시 { failed: false, packet, decision, reviewId } 를 반환합니다.
 * 이 함수는 apply === true 여부와 무관하게 항상 같은 검증을 수행하며,
 * 어떤 경우에도 파일에 쓰지 않습니다(읽기 전용).
 */
function runAllGuards(reviewId, options = {}) {
  const {
    dataDir = DEFAULT_DATA_DIR,
    readFileImpl = fs.readFileSync,
    existsImpl = fs.existsSync,
    sourceCatalogFile = DEFAULT_SOURCE_CATALOG_FILE,
    storeFile = STORE_PATH,
    previewFile = PREVIEW_PATH,
    env = process.env,
    blockedReviewerNames = BLOCKED_REVIEWER_NAMES,
  } = options;

  const packetPath = path.join(dataDir, "review-packets", `${reviewId}.json`);
  const decisionPath = path.join(dataDir, "review-decisions", `${reviewId}.json`);

  if (!existsImpl(packetPath)) {
    return fail("REVIEW_PACKET_NOT_FOUND", [`No review packet found for reviewId "${reviewId}" at ${packetPath}.`]);
  }
  const packet = JSON.parse(readFileImpl(packetPath, "utf8"));

  // 판정 파일이 아직 없음 -- Brain 이 아직 검토하지 않았다.
  if (!existsImpl(decisionPath)) {
    return fail("NO_DECISION_YET", [`No review decision has been recorded yet for reviewId "${reviewId}" at ${decisionPath}.`]);
  }
  const decision = JSON.parse(readFileImpl(decisionPath, "utf8"));

  // 3중 일치: packet.reviewId === decision.reviewId === reviewId
  if (packet.reviewId !== reviewId || decision.reviewId !== reviewId) {
    return fail("REVIEW_ID_MISMATCH", [
      `reviewId mismatch: requested="${reviewId}" packet.reviewId="${packet.reviewId}" decision.reviewId="${decision.reviewId}".`,
    ]);
  }

  // 서명 검증(체크섬/verdict 검증보다 먼저 수행 -- 설계안 3번).
  const signingKey = loadSigningKeyFromEnv(env);
  if (!signingKey) {
    return fail("SIGNING_KEY_UNAVAILABLE", ["Signing key could not be loaded in this execution context (env var not set)."]);
  }
  if (!decision.signature || !decision.signature.value) {
    return fail("SIGNATURE_MISSING", ["decision.signature is missing -- refusing to trust an unsigned review decision."]);
  }
  const signedFields = {
    reviewId: decision.reviewId,
    packetSha256Recomputed: decision.packetSha256Recomputed,
    verdict: decision.verdict,
    reasons: decision.reasons,
    checkedItems: decision.checkedItems,
  };
  if (!verifyDecisionSignature(signingKey, signedFields, decision.signature.value)) {
    return fail("SIGNATURE_INVALID", ["decision.signature.value does not match the recomputed signature for the signed fields."]);
  }

  // checkedItems 의 내부 일관성 재확인(--apply 쪽에서도 다시 검증 -- 설계안
  // 2번 "패킷 빌더/--apply 양쪽에서 공통 검증"). 위반 플래그가 하나라도
  // true 인데 verdict==="APPROVE" 이면 구조적으로 무효한 판정 파일이다.
  const violation = Boolean(
    decision.checkedItems && (decision.checkedItems.robotsPolicyViolation || decision.checkedItems.jsRuleUnverified || decision.checkedItems.diagnoseFailed)
  );
  if (violation && decision.verdict === "APPROVE") {
    return fail("INVALID_DECISION_APPROVE_WITH_VIOLATION", [
      "decision.checkedItems reports a violation flag but verdict is APPROVE -- structurally invalid, refusing to proceed.",
    ]);
  }

  // 패킷 파일 자체가 판정 이후 변조되지 않았는지 재확인.
  const recomputedPacketSha256 = computePacketSha256(packet);
  if (decision.packetSha256Recomputed !== recomputedPacketSha256) {
    return fail("STALE_REVIEW_PACKET_INVALIDATED", [
      "decision.packetSha256Recomputed no longer matches the packet file's recomputed hash -- " +
        "the packet may have been tampered with or corrupted since the decision was recorded.",
    ]);
  }

  if (decision.verdict !== "APPROVE") {
    return fail("VERDICT_NOT_APPROVED", [`decision.verdict is "${decision.verdict}", not APPROVE.`, ...(decision.reasons || [])]);
  }

  if (blockedReviewerNames.includes(normalizeReviewerName(decision.reviewedBy))) {
    return fail("REVIEWER_BLOCKED", [`decision.reviewedBy ("${decision.reviewedBy}") is in the blocked reviewer list.`]);
  }

  // 자동 무효화(stateless 재검증, 설계안 5번): "지금 이 순간"의 카탈로그/
  // 소스블록/store/preview 를 다시 계산해 패킷 생성 시점 값과 비교한다.
  // sourceBlockCanonical 은 패킷의 sourceSnapshot 이 아니라, 지금 카탈로그에
  // 실제로 들어 있는 "살아있는" 소스 블록을 다시 읽어 계산한다.
  let currentSource;
  try {
    const currentCatalog = JSON.parse(readFileImpl(sourceCatalogFile, "utf8"));
    ({ source: currentSource } = findSourceInCatalog(currentCatalog, packet.scope));
  } catch (error) {
    return fail("STALE_REVIEW_PACKET_INVALIDATED", [`Could not re-read the current source block for comparison: ${error.message}`]);
  }
  const currentChecksums = computeAllChecksums({ sourceCatalogFile, storeFile, previewFile, sourceSnapshot: currentSource, readFileImpl });
  const mismatches = ["sourceCatalogFile", "sourceBlockCanonical", "storeFile", "previewFile"].filter(
    (key) => currentChecksums[key].sha256 !== packet.checksums[key].sha256
  );
  if (mismatches.length) {
    return fail("STALE_REVIEW_PACKET_INVALIDATED", [`The following checksums no longer match the review packet: ${mismatches.join(", ")}.`]);
  }

  return { failed: false, packet, decision, reviewId };
}

/**
 * 실제 활성화 + 저장(설계안 6번 performActivationAndSave() pseudocode).
 * 사전 조건: runAllGuards() 가 전부 통과한 뒤에만 호출됨.
 */
function performActivationAndSave(packet, options = {}) {
  const {
    reviewId = packet.reviewId,
    dataDir = DEFAULT_DATA_DIR,
    sourceCatalogFile = DEFAULT_SOURCE_CATALOG_FILE,
    storeFile = STORE_PATH,
    previewFile = PREVIEW_PATH,
    backupBeforeSaveImpl = backupBeforeSave,
    saveNewItemsImpl = saveNewItems,
    readFileImpl = fs.readFileSync,
    writeFileImpl = fs.writeFileSync,
    copyFileImpl = fs.copyFileSync,
    renameImpl = fs.renameSync,
    existsImpl = fs.existsSync,
    mkdirImpl = fs.mkdirSync,
    nowImpl = () => new Date().toISOString(),
  } = options;

  const backupDir = backupBeforeSaveImpl();

  // backupBeforeSave() 는 store/preview 를 복사만 하고 검증하지 않는다 --
  // 게이트는 복사 후 JSON 파싱 검증을 추가로 요구한다(설계안 6번).
  for (const filename of ["agent-news-store.json", "university-news-preview.json"]) {
    const backupPath = path.join(backupDir, filename);
    if (existsImpl(backupPath) && !isValidJsonFile(backupPath, readFileImpl)) {
      throw new GateApplyFailure({ code: "BACKUP_VALIDATION_FAILED", reviewId, backupDir, reasons: [`Backup file is not valid JSON: ${backupPath}`] });
    }
  }

  // 카탈로그는 backupBeforeSave() 가 백업하지 않으므로 게이트가 새로 백업한다.
  const catalogBackupPath = path.join(backupDir, path.basename(sourceCatalogFile));
  copyFileImpl(sourceCatalogFile, catalogBackupPath);
  if (!isValidJsonFile(catalogBackupPath, readFileImpl)) {
    throw new GateApplyFailure({ code: "BACKUP_VALIDATION_FAILED", reviewId, backupDir, reasons: [`Catalog backup is not valid JSON: ${catalogBackupPath}`] });
  }

  let saveResult;
  try {
    const catalog = JSON.parse(readFileImpl(sourceCatalogFile, "utf8"));
    applyMinimalDiff(catalog, packet.scope, packet.proposedChange);
    writeJsonAtomic(sourceCatalogFile, catalog, { writeFileImpl, readFileImpl, renameImpl });

    saveResult = saveNewItemsImpl(packet.diagnostics.acceptedNewItemsForSave || []);
  } catch (error) {
    // 카탈로그 쓰기 성공 후 saveNewItems 실패(또는 그 반대)까지 커버 --
    // 세 파일 모두 백업에서 롤백한다.
    restoreFromBackup(sourceCatalogFile, catalogBackupPath, { existsImpl, copyFileImpl });
    restoreFromBackup(storeFile, path.join(backupDir, "agent-news-store.json"), { existsImpl, copyFileImpl });
    restoreFromBackup(previewFile, path.join(backupDir, "university-news-preview.json"), { existsImpl, copyFileImpl });

    const restoredOk = [sourceCatalogFile, storeFile, previewFile].every((file) => !existsImpl(file) || isValidJsonFile(file, readFileImpl));
    if (!restoredOk) {
      throw new GateApplyFailure({
        code: "ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED",
        reviewId,
        backupDir,
        rollback: "failed",
        originalError: error.message,
        reasons: ["Rollback restore produced an invalid JSON file -- manual intervention required."],
      });
    }

    let restoredEnabledOk = true;
    try {
      const restoredCatalog = JSON.parse(readFileImpl(sourceCatalogFile, "utf8"));
      const { source: restoredSource } = findSourceInCatalog(restoredCatalog, packet.scope);
      restoredEnabledOk = restoredSource.enabled === packet.sourceSnapshot.enabled;
    } catch {
      restoredEnabledOk = false;
    }
    if (!restoredEnabledOk) {
      throw new GateApplyFailure({
        code: "ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED",
        reviewId,
        backupDir,
        rollback: "failed",
        originalError: error.message,
        reasons: ["Rollback restored the catalog but source.enabled did not return to its original value -- manual intervention required."],
      });
    }

    throw new GateApplyFailure({
      code: "SAVE_FAILED_ROLLBACK_SUCCESS",
      reviewId,
      backupDir,
      rollback: "success",
      originalError: error.message,
      reasons: [`saveNewItems (or the catalog write) failed: ${error.message}. All three files were restored from backup.`],
    });
  }

  writeJsonOnce(
    path.join(dataDir, "review-decisions", `${reviewId}.applied.json`),
    {
      reviewId,
      appliedAt: nowImpl(),
      backupDir,
      saveResult,
      catalogChecksumAfter: computeAllChecksums({
        sourceCatalogFile,
        storeFile,
        previewFile,
        sourceSnapshot: findSourceInCatalog(JSON.parse(readFileImpl(sourceCatalogFile, "utf8")), packet.scope).source,
        readFileImpl,
      }).sourceCatalogFile,
    },
    { existsImpl, mkdirImpl, writeFileImpl }
  );

  return { status: "APPLIED", reviewId, backupDir, saveResult };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", code: "INVALID_ARGS", reasons: [error.message] }));
    process.exitCode = 1;
    return;
  }

  let validation;
  try {
    validation = runAllGuards(options.reviewId);
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", reviewId: options.reviewId, code: "GUARD_EXECUTION_FAILED", reasons: [error.message] }));
    process.exitCode = 1;
    return;
  }

  if (validation.failed) {
    console.error(JSON.stringify({ status: "REJECTED", reviewId: options.reviewId, code: validation.code, reasons: validation.reasons }));
    process.exitCode = 1;
    return;
  }

  if (!options.apply) {
    console.log(JSON.stringify({ status: "VALIDATED_READY_FOR_APPLY", reviewId: options.reviewId }));
    return;
  }

  try {
    const result = performActivationAndSave(validation.packet, { reviewId: options.reviewId });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "APPLY_FAILED",
        reviewId: options.reviewId,
        code: error.code || "APPLY_FAILED",
        reasons: error.reasons || [error.message],
        backupDir: error.backupDir || null,
        rollback: error.rollback || null,
      })
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_DATA_DIR,
  DEFAULT_SOURCE_CATALOG_FILE,
  BLOCKED_REVIEWER_NAMES,
  normalizeReviewerName,
  GateApplyFailure,
  parseArgs,
  findSourceInCatalog,
  applyMinimalDiff,
  writeJsonAtomic,
  writeJsonOnce,
  restoreFromBackup,
  runAllGuards,
  performActivationAndSave,
};
