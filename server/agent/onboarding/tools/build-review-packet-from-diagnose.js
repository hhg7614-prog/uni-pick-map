"use strict";

/**
 * B2 -- B1 이 카탈로그에 삽입한(또는 이미 존재하는 미활성) 소스에 대해
 * `run-single-school-trial.js --diagnose --allow-unverified-diagnose` 를 실행하고,
 * **통과한 경우에만** gate 의 createAndWriteReviewPacket() 을 호출해
 * review-packets/<reviewId>.json 을 생성합니다. 통과하지 못한 후보는 패킷을
 * 만들지 않습니다(패킷 파일 0개 + exit 1).
 *
 * 확정된 설계 결정(.pipeline/spec.md, 2026-08-28):
 *  - 통과 기준: foundCount>0 && acceptedCount>=minAccepted(기본 2) &&
 *    published_at_not_found 없음 && detail_title_or_university_mismatch 없음 &&
 *    robots checked/not-unavailable/not-blocked && (jsDetailLinkRule.enabled!==true)
 *  - acceptedNewItemsForSave 는 diagnose 결과의 diagnostics[] 중 storable===true
 *    항목에서 재구성합니다(run-single-school-trial.js 는 이 목적으로 수정하지 않음).
 *  - --limit 기본 3.
 *
 * 이 도구는 review-decision-writer.js 를 require 하지 않습니다.
 */

const fs = require("fs");
const path = require("path");

const { createAndWriteReviewPacket, DEFAULT_DATA_DIR } = require("../../gate/review-packet");
const { findSourceInCatalog, DEFAULT_SOURCE_CATALOG_FILE } = require("../../gate/apply-source-activation");
const { classifyRobotsFetchResult } = require("../../tools/screen-selector-required-sources");
const { STORE_PATH, PREVIEW_PATH } = require("../../store");

const TRIAL_SCRIPT = path.join(__dirname, "..", "..", "tools", "run-single-school-trial.js");
const ROBOTS_USER_AGENT = "UNI-PICK-Onboarding-ReviewPacket/0.1 (read-only)";
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 문자열에서 최상위 JSON 객체들을 순서대로 뽑아냅니다(문자열/이스케이프
 * 상태를 추적하는 중괄호 깊이 스캐너). run-single-school-trial.js 는 stdout 에
 * JSON.stringify(obj, null, 2) 결과 2개를 이어서 출력합니다.
 */
function parseJsonObjectsFromStdout(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(JSON.parse(text.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  return objects;
}

function defaultDiagnoseRunner({ universityId, sourceId, limit }) {
  const { execFileSync } = require("child_process");
  const args = [
    TRIAL_SCRIPT,
    `--university-id=${universityId}`,
    `--source-id=${sourceId}`,
    `--limit=${limit}`,
    "--diagnose",
    "--allow-unverified-diagnose",
  ];
  const stdout = execFileSync(process.execPath, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { command: `node ${args.join(" ")}`, stdout };
}

async function runDiagnose({ universityId, sourceId, limit, runnerImpl }) {
  const runner = runnerImpl || defaultDiagnoseRunner;
  const out = await runner({ universityId, sourceId, limit });
  const stdout = typeof out === "string" ? out : out && out.stdout;
  if (typeof stdout !== "string" || !stdout.trim()) {
    throw new Error("runDiagnose: diagnose runner produced no stdout to parse.");
  }
  const command =
    (out && out.command) ||
    `node run-single-school-trial.js --university-id=${universityId} --source-id=${sourceId} --limit=${limit} --diagnose --allow-unverified-diagnose`;
  const objects = parseJsonObjectsFromStdout(stdout);
  if (!objects.length) throw new Error("runDiagnose: could not parse any JSON object from diagnose stdout.");
  return { command, header: objects[0], result: objects[objects.length - 1], rawStdout: stdout };
}

async function collectRobotsEvidence(source, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = source.baseUrl || source.listUrl || source.rssUrl || "";
  let robotsUrl;
  try {
    robotsUrl = new URL("/robots.txt", base).toString();
  } catch {
    return { checked: false, unavailable: true, reasonCode: "ROBOTS_UNAVAILABLE", policy: { blocked: false }, robotsUrl: null };
  }

  let result;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(robotsUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": ROBOTS_USER_AGENT, Accept: "text/plain,*/*" },
    });
    const body = await response.text();
    result = { status: response.status, finalUrl: response.url || robotsUrl, body, error: null };
  } catch (error) {
    result = { status: null, finalUrl: robotsUrl, body: "", error };
  } finally {
    clearTimeout(timer);
  }

  return { ...classifyRobotsFetchResult(result), robotsUrl };
}

/**
 * diagnose 결과 + 소스 + robots 근거 -> 통과 판정(순수 함수).
 */
function evaluateDiagnose(diagnoseResult, source, robotsEvidence, { minAccepted = 2 } = {}) {
  const diagnostics = Array.isArray(diagnoseResult && diagnoseResult.diagnostics) ? diagnoseResult.diagnostics : [];
  const checks = {
    itemsCollected: Number(diagnoseResult && diagnoseResult.foundCount) > 0,
    accepted: Number(diagnoseResult && diagnoseResult.acceptedCount) >= minAccepted,
    allPublishedAt: !diagnostics.some((d) => d && d.reason === "published_at_not_found"),
    noSelectorMismatch: !diagnostics.some((d) => d && d.reason === "detail_title_or_university_mismatch"),
    robotsOk:
      Boolean(robotsEvidence) &&
      robotsEvidence.checked === true &&
      !robotsEvidence.unavailable &&
      !(robotsEvidence.policy && robotsEvidence.policy.blocked === true),
    jsRuleOk: !(source && source.jsDetailLinkRule && source.jsDetailLinkRule.enabled === true),
  };

  const reasons = [];
  if (!checks.itemsCollected) reasons.push("foundCount is 0 -- no items collected from the list page.");
  if (!checks.accepted) {
    reasons.push(
      `acceptedCount ${Number(diagnoseResult && diagnoseResult.acceptedCount) || 0} is below the required minimum ${minAccepted}.`
    );
  }
  if (!checks.allPublishedAt) reasons.push("at least one item has reason=published_at_not_found.");
  if (!checks.noSelectorMismatch) reasons.push("at least one item has reason=detail_title_or_university_mismatch.");
  if (!checks.robotsOk) reasons.push("robots.txt could not be confirmed as checked/available/not-blocked.");
  if (!checks.jsRuleOk) {
    reasons.push("source.jsDetailLinkRule.enabled is true -- this tool does not gather JS-rule evidence, refusing.");
  }

  return { passed: Object.values(checks).every(Boolean), checks, reasons, minAccepted };
}

function extractNpmTestSummary(raw) {
  const text = String(raw || "");
  const failMatch = /(?:^|\n)[#\sℹ]*fail\s+(\d+)/i.exec(text);
  const testsMatch = /(?:^|\n)[#\sℹ]*tests\s+(\d+)/i.exec(text);
  const passMatch = /(?:^|\n)[#\sℹ]*pass\s+(\d+)/i.exec(text);
  if (failMatch) {
    const parts = [];
    if (testsMatch) parts.push(`tests ${testsMatch[1]}`);
    if (passMatch) parts.push(`pass ${passMatch[1]}`);
    parts.push(`fail ${failMatch[1]}`);
    return parts.join(", ");
  }
  return text.trim().slice(-500);
}

function collectRegressionEvidence({ npmTestImpl, now = () => new Date() } = {}) {
  const run =
    npmTestImpl ||
    (() => {
      const { execSync } = require("child_process");
      return execSync("npm test", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    });
  const raw = String(run());
  return { npmTestCommand: "npm test", npmTestSummary: extractNpmTestSummary(raw), ranAt: now().toISOString() };
}

/**
 * diagnose 결과의 storable===true 항목에서 saveNewItems 입력 형태를 재구성합니다
 * (확정 결정 3 -- run-single-school-trial.js 를 수정하지 않고 B2 가 재구성).
 */
function reconstructAcceptedNewItems(diagnoseResult, { university, source }) {
  const diagnostics = Array.isArray(diagnoseResult && diagnoseResult.diagnostics) ? diagnoseResult.diagnostics : [];
  return diagnostics
    .filter((d) => d && d.storable === true)
    .map((d) => ({
      title: d.title,
      sourceUrl: d.sourceUrl,
      publishedAt: d.publishedAt,
      universityId: university.universityId,
      universityGroupId: university.universityGroupId || university.universityId,
      category: source.category,
      sourceId: source.id,
    }));
}

async function buildReviewPacketFromDiagnose({
  universityId,
  sourceId,
  limit = 3,
  minAccepted = 2,
  skipNpmTest = false,
  regressionEvidence: regressionEvidenceInput,
  catalogFile = DEFAULT_SOURCE_CATALOG_FILE,
  storeFile = STORE_PATH,
  previewFile = PREVIEW_PATH,
  dataDir = DEFAULT_DATA_DIR,
  runnerImpl,
  fetchImpl,
  npmTestImpl,
  now = () => new Date(),
  randomBytesImpl,
  readFileImpl = fs.readFileSync,
} = {}) {
  if (!universityId) throw new Error("buildReviewPacketFromDiagnose: universityId is required.");
  if (!sourceId) throw new Error("buildReviewPacketFromDiagnose: sourceId is required.");

  const catalog = JSON.parse(readFileImpl(catalogFile, "utf8"));
  const { university, source } = findSourceInCatalog(catalog, { universityId, sourceId });

  const { command, result: diagnoseResult, rawStdout } = await runDiagnose({ universityId, sourceId, limit, runnerImpl });
  const robotsEvidence = await collectRobotsEvidence(source, { fetchImpl });
  const evaluation = evaluateDiagnose(diagnoseResult, source, robotsEvidence, { minAccepted });

  if (!evaluation.passed) {
    return { status: "DIAGNOSE_FAILED", evaluation, robotsEvidence, diagnoseResult, rawStdout };
  }

  let regressionEvidence = regressionEvidenceInput;
  if (!regressionEvidence) {
    if (skipNpmTest) {
      throw new Error(
        "buildReviewPacketFromDiagnose: --skip-npm-test requires an explicit regressionEvidence ({ npmTestCommand, npmTestSummary, ranAt }) to be provided."
      );
    }
    regressionEvidence = collectRegressionEvidence({ npmTestImpl, now });
  }

  const acceptedNewItemsForSave = reconstructAcceptedNewItems(diagnoseResult, { university, source });

  const { packet, writtenPath } = createAndWriteReviewPacket(
    {
      universityId,
      universityGroupId: university.universityGroupId || university.universityId,
      sourceId,
      sourceSnapshot: source,
      diagnostics: {
        command,
        rawOutput: diagnoseResult,
        foundCount: diagnoseResult.foundCount,
        acceptedCount: diagnoseResult.acceptedCount,
        newCount: diagnoseResult.newCount,
        duplicateCount: diagnoseResult.duplicateCount,
        excludedCount: diagnoseResult.excludedCount,
        acceptedNewItemsForSave,
      },
      robotsEvidence,
      regressionEvidence,
      paths: { sourceCatalogFile: catalogFile, storeFile, previewFile },
      now: now(),
      randomBytesImpl,
    },
    { dataDir }
  );

  return { status: "PACKET_CREATED", reviewId: packet.reviewId, writtenPath, evaluation, packet };
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
  const limitRaw = read("--limit");
  const minAcceptedRaw = read("--min-accepted");
  return {
    universityId,
    sourceId,
    limit: limitRaw ? Number(limitRaw) : 3,
    minAccepted: minAcceptedRaw ? Number(minAcceptedRaw) : 2,
    skipNpmTest: argv.includes("--skip-npm-test"),
  };
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", code: "INVALID_ARGS", reasons: [error.message] }));
    process.exitCode = 1;
    return;
  }
  try {
    const result = await buildReviewPacketFromDiagnose(options);
    if (result.status !== "PACKET_CREATED") {
      console.error(JSON.stringify({ status: result.status, evaluation: result.evaluation }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ status: result.status, reviewId: result.reviewId, writtenPath: result.writtenPath }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "ERROR", reasons: [error.message] }));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseJsonObjectsFromStdout,
  runDiagnose,
  collectRobotsEvidence,
  evaluateDiagnose,
  extractNpmTestSummary,
  collectRegressionEvidence,
  reconstructAcceptedNewItems,
  buildReviewPacketFromDiagnose,
  parseCliArgs,
};
