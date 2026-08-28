"use strict";

/**
 * 검토 패킷(ReviewPacket) 빌더 -- Code Agent 세션이 호출합니다.
 *
 * .pipeline/spec.md "설계안 > 1) 검토 패킷 스키마 및 저장 경로" 를 그대로
 * 구현합니다. 이 모듈은 "패킷 생성" 액션까지만 수행하며, 판정 파일
 * (ReviewDecision) 쓰기 기능은 전혀 포함하지 않습니다(그 기능은
 * server/agent/gate/review-decision-writer.js 에 별도로 분리돼 있고,
 * 그 파일은 Brain 전용입니다 -- 설계안 7-1-1).
 *
 * (결정됨, spec.md 질문사항 2) 이 빌더는 robotsPolicyViolation /
 * jsRuleUnverified / diagnoseFailed 같은 "위반 여부" 필드를 스스로 계산하지
 * 않습니다. robotsEvidence / jsRuleEvidence / diagnostics.rawOutput 은
 * 원본 근거만 담고, 위반 여부의 최종 판정은 전부 Brain 이
 * ReviewDecision.checkedItems 에 직접 기록합니다.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { canonicalStringify, sha256Hex, computeAllChecksums } = require("./checksum-utils");

const SCHEMA_VERSION = "1.0";
const DEFAULT_DATA_DIR = path.join(__dirname, "data");

function pad2(value) {
  return String(value).padStart(2, "0");
}

// yyyyMMddHHmmss (구분자 없음). reviewId 에만 쓰이는 압축 타임스탬프이고,
// packet.createdAt 은 별도로 완전한 ISO8601 문자열을 그대로 사용합니다.
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
 * reviewId = `rp-${universityId}-${sourceId}-${yyyyMMddHHmmss}-${6자리랜덤hex}`
 * (설계안 1번, 예: rp-jbnu-official-news-20260827143000-a1b2c3)
 */
function generateReviewId({ universityId, sourceId, now = new Date(), randomBytesImpl = crypto.randomBytes }) {
  if (!universityId) throw new Error("generateReviewId: universityId is required.");
  if (!sourceId) throw new Error("generateReviewId: sourceId is required.");
  const stamp = formatCompactTimestamp(now);
  const randomHex = randomBytesImpl(3).toString("hex");
  return `rp-${universityId}-${sourceId}-${stamp}-${randomHex}`;
}

/**
 * packetSha256 = sha256(canonicalStringify(packet minus packetSha256))
 * (설계안 1번 "packetSha256 계산" 의사코드 그대로)
 */
function computePacketSha256(packet) {
  const { packetSha256, ...rest } = packet;
  return sha256Hex(canonicalStringify(rest));
}

// npm test 요약 문자열("tests N, pass N, fail 0" 형식 전제)에서 fail 수를
// 뽑아냅니다. fail 이 0이 아니거나 형식을 해석할 수 없으면 패킷 생성 자체를
// 거부합니다(설계안 8번 "회귀 방지 전략" / "예외 상황" 섹션).
function assertRegressionEvidencePassed(regressionEvidence) {
  const summary = regressionEvidence && regressionEvidence.npmTestSummary;
  const match = /fail\s+(\d+)/i.exec(String(summary || ""));
  if (!match) {
    throw new Error(
      `buildReviewPacket: regressionEvidence.npmTestSummary must report a "fail N" count (got: ${JSON.stringify(summary)}). ` +
      "Refusing to build a review packet without a verifiable regression result."
    );
  }
  if (Number(match[1]) !== 0) {
    throw new Error(
      `buildReviewPacket: regressionEvidence.npmTestSummary reports ${match[1]} failing test(s). ` +
      "Refusing to build a review packet while npm test is not fail 0 (spec.md §8 / 예외 상황)."
    );
  }
}

function defaultProposedChange(sourceSnapshot) {
  return {
    enabled: { from: sourceSnapshot.enabled === true, to: true },
    verified: { from: sourceSnapshot.verified === true, to: true },
    status: { from: sourceSnapshot.status, to: "verified" },
  };
}

function requireField(container, key, label) {
  const value = container ? container[key] : undefined;
  if (value === undefined || value === null) {
    throw new Error(`buildReviewPacket: "${label}" is required to build a review packet.`);
  }
  return value;
}

/**
 * ReviewPacket 객체를 만듭니다(디스크에 쓰지 않는 순수 함수 -- 쓰기는
 * writeReviewPacketOnce()/createAndWriteReviewPacket() 이 담당합니다).
 *
 * 필수 입력:
 *  - universityId, sourceId, sourceSnapshot
 *  - diagnostics: { command, rawOutput, foundCount, acceptedCount, newCount,
 *      duplicateCount, excludedCount, acceptedNewItemsForSave }
 *  - robotsEvidence: screen-selector-required-sources.js 의
 *      classifyRobotsFetchResult() 결과(또는 동등한 재확인 결과)를 그대로
 *  - regressionEvidence: { npmTestCommand, npmTestSummary, ranAt } (fail 0 필수)
 *  - paths: { sourceCatalogFile, storeFile, previewFile } (체크섬 계산용)
 *
 * 선택 입력:
 *  - universityGroupId, proposedChange(기본값은 sourceSnapshot 에서 계산),
 *    jsRuleEvidence(source.jsDetailLinkRule?.enabled===true 인 경우 필수)
 */
function buildReviewPacket(input = {}) {
  const {
    universityId,
    universityGroupId,
    sourceId,
    sourceSnapshot,
    diagnostics,
    robotsEvidence,
    jsRuleEvidence,
    regressionEvidence,
    proposedChange,
    paths,
    readFileImpl = fs.readFileSync,
    now = new Date(),
    randomBytesImpl = crypto.randomBytes,
    createdBy = "code-agent",
  } = input;

  requireField(input, "universityId", "universityId");
  requireField(input, "sourceId", "sourceId");
  requireField(input, "sourceSnapshot", "sourceSnapshot");
  requireField(input, "diagnostics", "diagnostics");
  requireField(input, "robotsEvidence", "robotsEvidence");
  requireField(input, "regressionEvidence", "regressionEvidence");
  requireField(input, "paths", "paths");

  for (const key of ["command", "rawOutput", "foundCount", "acceptedCount", "newCount", "duplicateCount", "excludedCount", "acceptedNewItemsForSave"]) {
    requireField(diagnostics, key, `diagnostics.${key}`);
  }
  for (const key of ["npmTestCommand", "npmTestSummary", "ranAt"]) {
    requireField(regressionEvidence, key, `regressionEvidence.${key}`);
  }
  for (const key of ["sourceCatalogFile", "storeFile", "previewFile"]) {
    requireField(paths, key, `paths.${key}`);
  }

  assertRegressionEvidencePassed(regressionEvidence);

  // jsDetailLinkRule.enabled===true 인 소스는 jsRuleEvidence 가 필수(원본
  // 근거만 -- 위반 판정은 하지 않음, 설계안 8번/예외 상황). 그 외(정적 href
  // 소스)는 항상 null 로 명시해 Brain 이 "JS 규칙 미검증" HOLD 조건과
  // 혼동하지 않도록 합니다.
  const jsRuleRequired = sourceSnapshot?.jsDetailLinkRule?.enabled === true;
  let resolvedJsRuleEvidence;
  if (jsRuleRequired) {
    if (jsRuleEvidence === undefined || jsRuleEvidence === null) {
      throw new Error(
        "buildReviewPacket: source.jsDetailLinkRule.enabled is true but jsRuleEvidence is missing. " +
        "Provide { engineUnitTestsPassed, manualGetVerification } (an empty manualGetVerification array " +
        "is allowed, but the field itself may not be omitted -- spec.md 예외 상황)."
      );
    }
    resolvedJsRuleEvidence = jsRuleEvidence;
  } else {
    resolvedJsRuleEvidence = null;
  }

  const reviewId = generateReviewId({ universityId, sourceId, now, randomBytesImpl });
  const checksums = computeAllChecksums({
    sourceCatalogFile: paths.sourceCatalogFile,
    storeFile: paths.storeFile,
    previewFile: paths.previewFile,
    sourceSnapshot,
    readFileImpl,
  });

  const packetWithoutHash = {
    schemaVersion: SCHEMA_VERSION,
    reviewId,
    createdAt: now.toISOString(),
    createdBy, // 고정 문자열 관례: "code-agent" -- Brain/사용자가 아님을 명시
    scope: {
      universityId,
      universityGroupId: universityGroupId ?? null,
      sourceId,
      action: "ACTIVATE_AND_SAVE_INITIAL_ITEMS",
    },
    sourceSnapshot,
    proposedChange: proposedChange || defaultProposedChange(sourceSnapshot),
    diagnostics: {
      command: diagnostics.command,
      rawOutput: diagnostics.rawOutput,
      foundCount: diagnostics.foundCount,
      acceptedCount: diagnostics.acceptedCount,
      newCount: diagnostics.newCount,
      duplicateCount: diagnostics.duplicateCount,
      excludedCount: diagnostics.excludedCount,
      acceptedNewItemsForSave: diagnostics.acceptedNewItemsForSave,
    },
    robotsEvidence,
    jsRuleEvidence: resolvedJsRuleEvidence,
    regressionEvidence: {
      npmTestCommand: regressionEvidence.npmTestCommand,
      npmTestSummary: regressionEvidence.npmTestSummary,
      ranAt: regressionEvidence.ranAt,
    },
    checksums,
    // 패킷 생성 자체는 아무것도 바꾸지 않았다는 선언
    // (screen-selector-required-sources.js runScreening() 의 mutation 필드 관례 재사용)
    mutation: { enabled: false, verified: false, status: false, store: false, preview: false, git: false, deploy: false },
  };

  const packetSha256 = computePacketSha256(packetWithoutHash);
  return { ...packetWithoutHash, packetSha256 };
}

function reviewPacketPath(reviewId, dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, "review-packets", `${reviewId}.json`);
}

/**
 * 패킷을 append-only 로 디스크에 씁니다. 같은 reviewId 파일이 이미 있으면
 * 무조건 에러(덮어쓰기 금지 -- 재검토는 새 reviewId 로만 가능).
 */
function writeReviewPacketOnce(packet, options = {}) {
  const {
    dataDir = DEFAULT_DATA_DIR,
    existsImpl = fs.existsSync,
    mkdirImpl = fs.mkdirSync,
    writeFileImpl = fs.writeFileSync,
  } = options;
  const targetPath = reviewPacketPath(packet.reviewId, dataDir);
  if (existsImpl(targetPath)) {
    throw new Error(`Refusing to overwrite an existing review packet: ${targetPath} (append-only -- build a new reviewId instead).`);
  }
  mkdirImpl(path.dirname(targetPath), { recursive: true });
  writeFileImpl(targetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return targetPath;
}

/**
 * buildReviewPacket() + writeReviewPacketOnce() 를 순서대로 수행합니다
 * (설계안 3번 pseudocode 의 buildReviewPacket() 부수효과와 동일한 흐름을
 * 하나로 묶은 편의 함수 -- 구현 세부사항이며 spec.md 는 함수명을 문자
 * 그대로 지정하지 않았으므로, 순수 계산(buildReviewPacket)과 디스크 쓰기
 * (writeReviewPacketOnce)를 분리해 단위 테스트하기 쉽도록 설계했습니다).
 */
function createAndWriteReviewPacket(input, writeOptions) {
  const packet = buildReviewPacket(input);
  const writtenPath = writeReviewPacketOnce(packet, writeOptions);
  return { packet, writtenPath };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_DATA_DIR,
  generateReviewId,
  computePacketSha256,
  buildReviewPacket,
  reviewPacketPath,
  writeReviewPacketOnce,
  createAndWriteReviewPacket,
};
