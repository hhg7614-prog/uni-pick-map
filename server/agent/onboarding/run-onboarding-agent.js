"use strict";

// Separate foundation for onboarding new university news sources.
// It intentionally does not import or execute the six-university collector.
const fs = require("fs");
const path = require("path");
const { diagnoseUniversitySource } = require("./tools/diagnose-source");

const ROOT = path.resolve(__dirname, "../../..");
const DATA_DIR = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORT_DIR = path.join(ROOT, "server", "agent", "onboarding", "reports");
const STATE_FILE = path.join(DATA_DIR, "onboarding-state.json");
const QUEUE_FILE = path.join(DATA_DIR, "onboarding-queue.json");
const UNIVERSITY_FILE = path.join(ROOT, "universities.js");
const SOURCE_FILE = path.join(ROOT, "development", "university-news", "data", "university-news-sources.final.json");
const QUEUES = ["onboarding-error-queue.json", "onboarding-review-queue.json", "onboarding-approval-queue.json"];

const initialState = () => ({ status: "idle", startedAt: null, updatedAt: null, total: 0, completed: 0, success: 0, review: 0, error: 0, currentUniversityId: null, currentUniversityName: null });
function atomicWrite(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, file); }
function ensureFiles() { fs.mkdirSync(REPORT_DIR, { recursive: true }); if (!fs.existsSync(STATE_FILE)) atomicWrite(STATE_FILE, initialState()); for (const name of QUEUES) { const file = path.join(DATA_DIR, name); if (!fs.existsSync(file)) atomicWrite(file, { items: [] }); } }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function status() { ensureFiles(); const state = read(STATE_FILE, initialState()); return { ...state, queues: Object.fromEntries(QUEUES.map(name => [name.replace("onboarding-", "").replace("-queue.json", ""), (read(path.join(DATA_DIR, name), { items: [] }).items || []).length])) }; }
function loadUniversities() { const vm = require("vm"); const code = fs.readFileSync(UNIVERSITY_FILE, "utf8").replace("const universities =", "const universities = globalThis.UNIS ="); const context = { globalThis: {}, console: { log() {} } }; context.window = context.globalThis; vm.createContext(context); vm.runInContext(code, context); return Array.isArray(context.globalThis.UNIS) ? context.globalThis.UNIS : []; }
function prepare() { ensureFiles(); const universities = loadUniversities(); const sourceData = read(SOURCE_FILE, { universities: [] }); const verified = new Set((sourceData.universities || []).filter(row => (row.sources || []).some(source => source.verified === true)).map(row => row.universityId)); const seen = new Set(), duplicates = [], excluded = [], items = [];
  universities.forEach((university, index) => { const universityId = String(university.id || "").trim(); if (!universityId) { duplicates.push({ index, reason: "empty_university_id" }); return; } if (seen.has(universityId)) { duplicates.push({ universityId, reason: "duplicate_university_id" }); return; } seen.add(universityId); if (verified.has(universityId)) { excluded.push({ universityId, reason: "existing_verified" }); return; } items.push({ order: items.length + 1, universityId, universityName: university.name || "", campusName: university.campusName || "", officialUrl: university.website || university.homepage || university.officialUrl || "", status: "pending", attemptCount: 0, lastAttemptAt: null, result: null }); });
  const queue = { generatedAt: new Date().toISOString(), totalUniversities: universities.length, existingVerifiedCount: excluded.length, pendingCount: items.length, duplicatesRemoved: duplicates, excluded, items }; atomicWrite(QUEUE_FILE, queue); const state = status(); Object.assign(state, { status: "ready", startedAt: null, updatedAt: new Date().toISOString(), total: items.length, completed: 0, success: 0, review: 0, error: 0, currentUniversityId: null, currentUniversityName: null, totalUniversities: universities.length, existingVerifiedCount: excluded.length }); atomicWrite(STATE_FILE, state); return queue; }
function printStatus() { const s = status(), q = read(QUEUE_FILE, { items: [], totalUniversities: 0, existingVerifiedCount: 0 }); const next = (q.items || []).find(item => item.status === "pending"); console.log(`UNI PICK University Source Onboarding Agent\n\n상태: ${s.status}\n\n전체 대학: ${q.totalUniversities || 0}\n기존 검증: ${q.existingVerifiedCount || 0}\n신규 검증 대상: ${(q.items || []).length}\n\n완료: ${s.completed}\n성공: ${s.success}\n검토 필요: ${s.review}\n오류: ${s.error}\n\n대기 중: ${(q.items || []).filter(item => item.status === "pending").length}\n\n다음 대학:\n${next ? `${next.universityName} (${next.universityId})` : "없음"}`); }

async function main() {
  const universityId = (process.argv.find(value => value.startsWith("--university-id=")) || "").slice(16);
  const action = process.argv.includes("--diagnose") ? "diagnose" : process.argv.includes("--prepare") ? "prepare" : process.argv.includes("--queue") ? "queue" : process.argv.includes("--resume") ? "resume" : process.argv.includes("--retry") ? "retry" : process.argv.includes("--status") ? "status" : "start";
  if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log("Usage: npm run news:onboard:diagnose -- --university-id=<ID> [--dry-run]"); return; }
  if (action === "diagnose") { const item = (read(QUEUE_FILE, { items: [] }).items || []).find(entry => entry.universityId === universityId); if (!universityId || !item) { console.error("A queued --university-id is required."); process.exitCode = 1; return; } if (process.argv.includes("--dry-run")) { console.log(JSON.stringify({ action, universityId, universityName: item.universityName, dryRun: true, externalRequests: 0 }, null, 2)); return; } const result = await diagnoseUniversitySource({ universityId: item.universityId, universityName: item.universityName, officialUrl: item.officialUrl }); console.log(JSON.stringify(result, null, 2)); return; }
  if (action === "prepare") { const q = prepare(); console.log(JSON.stringify({ action, totalUniversities: q.totalUniversities, existingVerifiedCount: q.existingVerifiedCount, pendingCount: q.pendingCount, duplicatesRemoved: q.duplicatesRemoved.length, externalRequests: 0 }, null, 2)); return; }
  if (action === "queue") { ensureFiles(); const q = read(QUEUE_FILE, { items: [] }); (q.items || []).slice(0, 10).forEach(item => console.log(`${item.order}. ${item.universityName} | ${item.universityId} | ${item.status}`)); return; }
  if (action === "status") { printStatus(); return; }
  console.log(JSON.stringify({ agent: "UNI PICK University Source Onboarding Agent", action, dryFoundationOnly: true, message: "기본 구조만 준비되었습니다. 실제 대학 탐색·검증·수집·배포는 실행하지 않습니다.", state: status() }, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
