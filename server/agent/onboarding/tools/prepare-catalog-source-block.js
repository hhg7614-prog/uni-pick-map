"use strict";

/**
 * B1 -- 온보딩 검증을 통과한 후보(collector-config-candidates.json 의
 * finalDecision === "COLLECTOR_CONFIG_READY" 항목)의 완성된 소스 블록을
 * 카탈로그(university-news-sources.final.json)에 **비활성** 상태로 삽입합니다.
 *
 * 확정된 설계 결정(.pipeline/spec.md, 2026-08-28 사용자 승인):
 *  - 삽입 값: verified:false, status:"selector_required", enabled:false (A안)
 *  - 대학 블록이 카탈로그에 없으면 throw. 대학 블록을 생성하지 않습니다.
 *  - 같은 sourceId 가 이미 있으면 throw(append-only, 중복 삽입 금지).
 *  - 카탈로그 쓰기는 gate 의 원자적 쓰기 패턴(사전 백업 -> tmp -> JSON.parse
 *    검증 -> rename)만 사용합니다.
 *
 * 이 도구는 store/preview/네트워크/git 을 건드리지 않습니다.
 */

const fs = require("fs");
const path = require("path");
const { sha256Hex } = require("../../gate/checksum-utils");

const ROOT = path.resolve(__dirname, "../../../..");
const DEFAULT_SOURCE_CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);
const DEFAULT_CANDIDATE_FILE = path.join(__dirname, "..", "data", "collector-config-candidates.json");
const DEFAULT_PREPARE_LOG_FILE = path.join(__dirname, "..", "data", "catalog-prepare-log.json");

const READY_DECISION = "COLLECTOR_CONFIG_READY";

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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 후보의 source 블록을 카탈로그 관례에 맞게 정규화합니다(순수 함수).
 * 확정 결정 A안: verified:false, status:"selector_required", enabled:false.
 */
function normalizeCandidateSourceBlock(candidate) {
  const src = (candidate && candidate.source) || {};
  if (!src.id) throw new Error("normalizeCandidateSourceBlock: candidate.source.id is required.");
  return {
    ...deepClone(src),
    verified: false,
    enabled: false,
    status: "selector_required",
    healthStatus: "unknown",
  };
}

/**
 * 카탈로그 객체에 소스 블록을 삽입합니다(부수효과 없음, 새 객체 반환).
 *  - 대학 블록이 없으면 throw (대학 블록 자동 생성 안 함)
 *  - 같은 sourceId 가 이미 있으면 throw (append-only)
 *  - university.sources 배열에만 push, 그 외 필드/다른 대학 불변
 */
function insertSourceBlock(catalog, { universityId, sourceId }, sourceBlock) {
  const next = deepClone(catalog);
  const university = (next.universities || []).find((entry) => entry.universityId === universityId);
  if (!university) {
    throw new Error(
      `insertSourceBlock: university block not found in catalog for universityId "${universityId}". ` +
        "B1 does not create university blocks (minimal-diff, 확정 결정 2)."
    );
  }
  if (!Array.isArray(university.sources)) university.sources = [];
  const existing = university.sources.find((entry) => entry.id === sourceId);
  if (existing) {
    if (existing.enabled === true) {
      throw new Error(
        `insertSourceBlock: source "${sourceId}" already exists AND is enabled:true for university "${universityId}". ` +
          "Nothing to prepare."
      );
    }
    throw new Error(
      `insertSourceBlock: source "${sourceId}" already exists for university "${universityId}" ` +
        "(append-only -- refusing a duplicate insert)."
    );
  }
  university.sources.push(deepClone(sourceBlock));
  return next;
}

function appendPrepareLog(prepareLogFile, entry, { readFileImpl, writeFileImpl, existsImpl, mkdirImpl }) {
  let log = { entries: [] };
  if (existsImpl(prepareLogFile)) {
    try {
      const parsed = JSON.parse(readFileImpl(prepareLogFile, "utf8"));
      if (parsed && Array.isArray(parsed.entries)) log = parsed;
    } catch {
      log = { entries: [] };
    }
  }
  log.entries.push(entry);
  mkdirImpl(path.dirname(prepareLogFile), { recursive: true });
  writeFileImpl(prepareLogFile, `${JSON.stringify(log, null, 2)}\n`, "utf8");
}

/**
 * 후보 -> 카탈로그 삽입 전체 절차(부수효과: 백업 -> 원자적 쓰기 -> 감사 로그).
 */
function prepareCatalogSourceBlock({
  universityId,
  sourceId,
  candidateFile = DEFAULT_CANDIDATE_FILE,
  catalogFile = DEFAULT_SOURCE_CATALOG_FILE,
  prepareLogFile = DEFAULT_PREPARE_LOG_FILE,
  dryRun = false,
  now = () => new Date(),
  readFileImpl = fs.readFileSync,
  writeFileImpl = fs.writeFileSync,
  renameImpl = fs.renameSync,
  copyFileImpl = fs.copyFileSync,
  existsImpl = fs.existsSync,
  mkdirImpl = fs.mkdirSync,
} = {}) {
  if (!universityId) throw new Error("prepareCatalogSourceBlock: universityId is required.");
  if (!sourceId) throw new Error("prepareCatalogSourceBlock: sourceId is required.");

  const candidates = JSON.parse(readFileImpl(candidateFile, "utf8"));
  const candidate = (candidates.items || []).find(
    (entry) => entry.universityId === universityId && entry.source && entry.source.id === sourceId
  );
  if (!candidate) {
    throw new Error(
      `prepareCatalogSourceBlock: no candidate found for universityId="${universityId}" sourceId="${sourceId}" in ${candidateFile}.`
    );
  }
  if (candidate.finalDecision !== READY_DECISION) {
    throw new Error(
      `prepareCatalogSourceBlock: candidate.finalDecision is "${candidate.finalDecision}", expected "${READY_DECISION}".`
    );
  }

  const sourceBlock = normalizeCandidateSourceBlock(candidate);
  const currentCatalogText = readFileImpl(catalogFile, "utf8");
  const catalog = JSON.parse(currentCatalogText);
  const nextCatalog = insertSourceBlock(catalog, { universityId, sourceId }, sourceBlock);

  const serialized = `${JSON.stringify(nextCatalog, null, 2)}\n`;
  const checksumBefore = sha256Hex(currentCatalogText);
  const checksumAfter = sha256Hex(serialized);
  const mutation = { enabled: false, verified: false, status: false, store: false, preview: false, git: false, deploy: false };

  if (dryRun) {
    return {
      status: "DRY_RUN",
      universityId,
      sourceId,
      catalogBackupPath: null,
      checksumBefore,
      checksumAfter,
      sourceBlock,
      mutation,
    };
  }

  const stamp = formatCompactTimestamp(now());
  const catalogBackupPath = `${catalogFile}.prepare-backup.${stamp}`;
  copyFileImpl(catalogFile, catalogBackupPath);
  JSON.parse(readFileImpl(catalogBackupPath, "utf8")); // 백업 유효성 검증

  const tmp = `${catalogFile}.tmp`;
  writeFileImpl(tmp, serialized, "utf8");
  JSON.parse(readFileImpl(tmp, "utf8")); // 쓴 파일 유효성 검증
  renameImpl(tmp, catalogFile);

  appendPrepareLog(
    prepareLogFile,
    {
      preparedAt: now().toISOString(),
      universityId,
      sourceId,
      catalogBackupPath,
      checksumBefore,
      checksumAfter,
    },
    { readFileImpl, writeFileImpl, existsImpl, mkdirImpl }
  );

  return {
    status: "PREPARED",
    universityId,
    sourceId,
    catalogBackupPath,
    checksumBefore,
    checksumAfter,
    sourceBlock,
    mutation,
  };
}

function parseCliArgs(argv) {
  const read = (name) => {
    const hit = argv.find((value) => value === name || value.startsWith(`${name}=`));
    if (!hit) return undefined;
    return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1).trim() : "";
  };
  const universityId = read("--university-id");
  const sourceId = read("--source-id");
  if (!universityId) throw new Error("--university-id=<id> is required.");
  if (!sourceId) throw new Error("--source-id=<id> is required.");
  const candidateFile = read("--candidate-file");
  return {
    universityId,
    sourceId,
    candidateFile: candidateFile || undefined,
    dryRun: argv.includes("--dry-run"),
  };
}

function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", code: "INVALID_ARGS", reasons: [error.message] }));
    process.exitCode = 1;
    return;
  }
  try {
    const result = prepareCatalogSourceBlock(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", code: "PREPARE_FAILED", reasons: [error.message] }));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_SOURCE_CATALOG_FILE,
  DEFAULT_CANDIDATE_FILE,
  DEFAULT_PREPARE_LOG_FILE,
  READY_DECISION,
  formatCompactTimestamp,
  normalizeCandidateSourceBlock,
  insertSourceBlock,
  prepareCatalogSourceBlock,
  parseCliArgs,
};
