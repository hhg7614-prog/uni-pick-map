"use strict";

/**
 * UNI PICK 뉴스 수집 → 검증 → Git commit → GitHub push → Render 자동 재배포
 *
 * 사용 방법:
 *   node server/agent/tools/run-news-agent-and-deploy.js
 *   (또는 나중에 npm run news:deploy 로 사용)
 *
 * 동작 순서:
 *   STEP 1:  Git 상태 확인
 *   STEP 2:  에이전트 잠금 확인
 *   STEP 3:  뉴스 에이전트 1회 실행
 *   STEP 4:  실행 결과 확인
 *   STEP 5:  preview JSON 존재 확인
 *   STEP 6:  preview JSON 문법 검사
 *   STEP 7:  필수 필드 검사
 *   STEP 8:  sourceUrl 상세 링크 검증
 *   STEP 9:  이전 preview와 변경 비교
 *   STEP 10: 실제 변경이 없으면 종료
 *   STEP 11: 뉴스 관련 파일만 Git stage
 *   STEP 12: stage 목록 확인
 *   STEP 13: 자동 commit
 *   STEP 14: GitHub push
 *   STEP 15: 결과 기록
 */

const fs   = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

// ─── 경로 설정 ────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "../../../");

// 사이트가 직접 읽는 뉴스 미리보기 파일 (Git에 commit)
const PREVIEW_FILE = path.join(ROOT, "data/university-news-preview.json");

// 에이전트 상태 파일 (선택적 commit)
const AGENT_STATUS_FILE = path.join(ROOT, "server/agent/data/agent-status.json");

// 배포 실행 결과 로그 (commit 제외, 로컬에만 보관)
const DEPLOY_LOG_FILE  = path.join(ROOT, "server/agent/data/deploy-log.json");

// commit 대상 파일 목록 (이 파일들만 git add)
const COMMIT_TARGETS = [
  "data/university-news-preview.json",
  // 아래는 실제로 파일이 존재할 때만 추가됨
  // "data/university-news-source-health.json",
];

// 최소 preview 항목 수 (이보다 적으면 비정상으로 판단)
const MIN_PREVIEW_ITEMS = 1;
// 항목 수가 기존 대비 이 비율 이상 줄면 비정상 판단 (80%)
const MAX_DROP_RATIO   = 0.80;

// ─── 유틸 함수 ────────────────────────────────────────────────────────────
const log  = (msg) => console.log(`[deploy] ${msg}`);
const warn = (msg) => console.warn(`[deploy] ⚠️  ${msg}`);
const fail = (msg) => { console.error(`[deploy] ❌ ${msg}`); return false; };

/** Git 명령어를 안전하게 실행합니다. 실패 시 null 반환. */
function git(args, { cwd = ROOT, throwOnFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err) {
    const msg = (err.stderr || err.message || "").trim();
    if (throwOnFail) throw new Error(`git ${args[0]} 실패: ${msg}`);
    return null;
  }
}

/** JSON 파일을 안전하게 읽어옵니다. */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** 결과를 로컬 로그 파일에 기록합니다 (Git 제외). */
function writeDeployLog(entry) {
  let history = [];
  if (fs.existsSync(DEPLOY_LOG_FILE)) {
    history = readJson(DEPLOY_LOG_FILE) || [];
  }
  history.unshift({ ...entry, recordedAt: new Date().toISOString() });
  // 최대 50건 유지
  history = history.slice(0, 50);
  try {
    fs.mkdirSync(path.dirname(DEPLOY_LOG_FILE), { recursive: true });
    fs.writeFileSync(DEPLOY_LOG_FILE, JSON.stringify(history, null, 2) + "\n", "utf8");
  } catch { /* 로그 실패는 무시 */ }
}

// ─── STEP별 검사 함수 ─────────────────────────────────────────────────────

/** STEP 1: Git 저장소 상태와 브랜치, 원격 저장소를 확인합니다. */
function checkGitState() {
  log("STEP 1: Git 상태 확인 중...");

  const branch = git(["branch", "--show-current"]);
  if (!branch) return fail("Git 저장소를 찾을 수 없거나 브랜치 확인에 실패했습니다.");
  log(`  현재 브랜치: ${branch}`);

  const remote = git(["remote", "get-url", "origin"]);
  if (!remote) return fail("GitHub 원격 저장소(origin)가 연결되어 있지 않습니다.");
  log(`  원격 저장소: ${remote}`);

  // Git 충돌 상태 확인
  const status = git(["status", "--porcelain"]) || "";
  const conflicted = status.split("\n").filter((l) => l.startsWith("UU") || l.startsWith("AA"));
  if (conflicted.length > 0) return fail("Git 충돌(conflict)이 있습니다. 수동으로 해결 후 다시 실행하세요.");

  return { branch, remote };
}

/** STEP 2: 에이전트가 이미 실행 중인지 확인합니다. */
function checkAgentLock() {
  log("STEP 2: 에이전트 잠금 확인 중...");
  const lockFile = path.join(ROOT, "server/agent/data/agent.lock");
  if (fs.existsSync(lockFile)) {
    return fail("에이전트가 이미 실행 중입니다. (agent.lock 파일 존재)\n  잠금이 해제될 때까지 기다리거나 npm run news:agent:stop 을 실행하세요.");
  }
  log("  잠금 없음. 실행 가능 상태입니다.");
  return true;
}

/** STEP 3: 뉴스 에이전트를 1회 실행합니다. */
async function runAgent() {
  log("STEP 3: 뉴스 에이전트 실행 중... (수 분이 걸릴 수 있습니다)");
  const { runOnce } = require("../runner");
  const result = await runOnce({ trigger: "deploy" });
  return result;
}

/** STEP 4: 에이전트 실행 결과를 확인합니다. */
function checkAgentResult(result) {
  log("STEP 4: 에이전트 실행 결과 확인...");
  if (!result) return fail("에이전트가 결과를 반환하지 않았습니다.");
  if (result.skipped) {
    log("  이전 실행이 진행 중이어서 건너뜁니다.");
    return { skipped: true };
  }
  log(`  신규 게시물: ${result.newCount ?? 0}건`);
  log(`  중복 제외: ${result.duplicateCount ?? 0}건`);
  log(`  오류 건수: ${result.errorCount ?? 0}건`);
  return result;
}

/** STEP 5~8: preview JSON 검증 */
function validatePreview(previewPath) {
  log("STEP 5: preview JSON 파일 존재 확인...");
  if (!fs.existsSync(previewPath)) return fail("data/university-news-preview.json 파일이 없습니다.");
  log("  ✅ 파일 존재 확인");

  log("STEP 6: preview JSON 문법 검사...");
  const data = readJson(previewPath);
  if (!data) return fail("data/university-news-preview.json 을 JSON으로 읽을 수 없습니다. (문법 오류)");
  log("  ✅ JSON 문법 정상");

  const items = Array.isArray(data.items) ? data.items : [];
  log(`STEP 7: 항목 필수 필드 검사... (총 ${items.length}건)`);

  if (items.length < MIN_PREVIEW_ITEMS) {
    warn(`preview 항목이 ${items.length}건입니다. 최소 ${MIN_PREVIEW_ITEMS}건 이상이어야 합니다.`);
    // 0건이어도 기존 데이터 유지 목적으로 push 중단
    if (items.length === 0) return fail("preview 항목이 0건입니다. push를 중단합니다.");
  }

  const badItems = [];
  for (const [i, item] of items.entries()) {
    const missing = [];
    if (!item.universityId && !item.universityGroupId) missing.push("universityId");
    if (!item.universityName) missing.push("universityName");
    if (!item.category)       missing.push("category");
    if (!item.title)          missing.push("title");
    if (!item.sourceName)     missing.push("sourceName");
    if (!item.publishedAt && !item.collectedAt) missing.push("publishedAt/collectedAt");
    if (missing.length > 0) badItems.push(`항목 ${i}: 누락 필드 [${missing.join(", ")}]`);
  }
  if (badItems.length > 0) {
    warn("필수 필드 누락 항목이 있습니다:\n  " + badItems.slice(0, 5).join("\n  "));
  } else {
    log("  ✅ 필수 필드 정상");
  }

  log("STEP 8: sourceUrl 상세 링크 검증...");
  const badUrls = [];
  for (const item of items) {
    const url = String(item.sourceUrl || "").trim();
    if (!url) { badUrls.push(`"${item.title?.slice(0, 30)}" sourceUrl 없음`); continue; }
    if (!/^https?:\/\//i.test(url)) {
      badUrls.push(`비정상 URL: ${url.slice(0, 80)}`); continue;
    }
    // 홈페이지 루트(경로가 / 또는 없는 경우)는 목록 링크로 판단
    try {
      const parsed = new URL(url);
      if (parsed.pathname === "/" || parsed.pathname === "") {
        badUrls.push(`홈페이지 루트 URL 감지: ${url.slice(0, 80)}`);
      }
    } catch { /* URL 파싱 오류 무시 */ }
  }
  if (badUrls.length > 0) {
    warn(`비정상 sourceUrl ${badUrls.length}건:\n  ` + badUrls.slice(0, 3).join("\n  "));
  } else {
    log("  ✅ sourceUrl 정상");
  }

  return { data, items };
}

/** STEP 9~10: 이전 파일과 비교해서 실제 변경이 있는지 확인합니다. */
function hasRealChange(previewPath, newItemCount) {
  log("STEP 9: 이전 preview와 변경 비교...");

  // Git 기준으로 파일이 변경됐는지 확인
  const diffOutput = git(["diff", "--name-only", "HEAD", "--", "data/university-news-preview.json"]);
  const isTrackedChanged = Boolean(diffOutput && diffOutput.includes("university-news-preview.json"));

  // 새로 추가된 항목 수 기준으로도 확인
  const hasNewItems = (newItemCount ?? 0) > 0;

  log(`  Git diff 변경: ${isTrackedChanged ? "있음" : "없음"}`);
  log(`  신규 게시물: ${newItemCount ?? 0}건`);

  // 둘 다 없으면 변경 없음
  if (!isTrackedChanged && !hasNewItems) {
    log("STEP 10: 변경사항 없음 → commit/push 건너뜁니다.");
    return false;
  }

  log("STEP 10: ✅ 변경사항 확인 → commit 진행합니다.");
  return true;
}

/** STEP 11~12: 뉴스 관련 파일만 선택적으로 Git stage합니다. */
function stageNewsFiles() {
  log("STEP 11: 뉴스 관련 파일만 Git stage...");

  const staged = [];
  for (const relPath of COMMIT_TARGETS) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      log(`  건너뜀 (파일 없음): ${relPath}`);
      continue;
    }
    // git add <파일> (git add . 사용 안 함)
    const result = git(["add", relPath]);
    if (result === null) {
      warn(`  stage 실패: ${relPath}`);
    } else {
      staged.push(relPath);
      log(`  ✅ stage: ${relPath}`);
    }
  }

  // agent-status.json 도 있으면 포함
  if (fs.existsSync(AGENT_STATUS_FILE)) {
    const relStatus = path.relative(ROOT, AGENT_STATUS_FILE).replace(/\\/g, "/");
    git(["add", relStatus]);
    staged.push(relStatus);
    log(`  ✅ stage: ${relStatus}`);
  }

  log("STEP 12: stage된 파일 목록 확인...");
  const stagedList = git(["diff", "--cached", "--name-only"]) || "";
  const files = stagedList.split("\n").filter(Boolean);

  if (files.length === 0) {
    return fail("stage된 파일이 없습니다. commit할 내용이 없습니다.");
  }

  // 비밀정보 파일이 섞였는지 검사
  const forbidden = files.filter((f) =>
    /\.(env|lock|log|tmp)$/.test(f) ||
    /\.env/.test(f) ||
    /agent-news-store\.json$/.test(f)
  );
  if (forbidden.length > 0) {
    git(["reset", "HEAD", "--", ...files]); // stage 취소
    return fail(`비허용 파일이 stage에 포함됐습니다: ${forbidden.join(", ")}\nstage를 취소했습니다.`);
  }

  log(`  stage 파일: ${files.join(", ")}`);
  return { staged, files };
}

/** STEP 13: commit 메시지를 생성하고 commit합니다. */
function createCommit(newCount) {
  log("STEP 13: 자동 commit 생성...");

  // KST 시각 포맷
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 16).replace("T", " ") + " KST";

  const message =
    newCount > 0
      ? `chore(news): add ${newCount} university news items (${dateStr})`
      : `chore(news): update university news preview (${dateStr})`;

  try {
    git(["commit", "-m", message], { throwOnFail: true });
    log(`  ✅ commit 완료: ${message}`);
    return message;
  } catch (err) {
    return fail(`commit 실패: ${err.message}`);
  }
}

/** STEP 14: GitHub에 push합니다. (force push 절대 사용 안 함) */
function pushToGitHub(branch) {
  log(`STEP 14: GitHub push 시작... (브랜치: ${branch})`);

  // push 전 원격과의 diverge 확인
  git(["fetch", "origin"]);
  const aheadBehind = git(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`]) || "0\t0";
  const [behind] = aheadBehind.split("\t").map(Number);

  if (behind > 0) {
    // 원격이 앞서 있는 경우 → 자동 병합하지 않음
    return fail(
      `원격 브랜치(origin/${branch})가 로컬보다 ${behind}개 커밋 앞서 있습니다.\n` +
      "  자동 병합을 하지 않습니다. 수동으로 git pull 후 다시 실행하세요."
    );
  }

  // 일반 push (force 없음)
  try {
    const pushResult = git(["push", "origin", branch], { throwOnFail: true });
    log(`  ✅ push 성공`);
    return true;
  } catch (err) {
    // 1회 재시도
    log("  push 실패. 1회 재시도합니다...");
    try {
      git(["push", "origin", branch], { throwOnFail: true });
      log("  ✅ push 재시도 성공");
      return true;
    } catch (err2) {
      return fail(`push 실패: ${err2.message}\n  GitHub 인증 상태나 네트워크를 확인하세요.`);
    }
  }
}

/** STEP 15~17: 결과를 기록합니다. */
function recordResult({ branch, commitMessage, newCount, success, reason }) {
  log("STEP 15: 결과 기록 중...");

  const commitHash = git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const pushedAt   = new Date().toISOString();

  const entry = {
    success,
    reason: reason || null,
    commitHash,
    commitMessage: commitMessage || null,
    branch,
    newCount: newCount ?? 0,
    pushedAt,
    deployTarget: "https://uni-pick-map.onrender.com",
    renderBranch: branch,
    estimatedDeployMinutes: 2,
    note: success
      ? "GitHub push 성공. Render가 자동으로 재배포를 시작합니다. 약 1~2분 후 반영됩니다."
      : "push 없음. Render 재배포가 발생하지 않습니다.",
  };

  writeDeployLog(entry);

  if (success) {
    log(`\n✅ 배포 완료`);
    log(`  commit: ${commitHash}`);
    log(`  push 시각: ${pushedAt}`);
    log(`  Render 배포 대상: ${entry.deployTarget}`);
    log(`  예상 반영 시간: 약 ${entry.estimatedDeployMinutes}분 후`);
    log("  (Render 대시보드에서 배포 진행 상태를 확인할 수 있습니다)");
  } else {
    log(`\n⛔ 배포 미실행: ${reason || "알 수 없는 이유"}`);
  }
}

// ─── 메인 실행 ────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== UNI PICK 뉴스 수집 → 검증 → 자동 배포 시작 ===\n");

  // STEP 1: Git 상태 확인
  const gitState = checkGitState();
  if (!gitState) {
    recordResult({ branch: "unknown", success: false, reason: "Git 상태 확인 실패" });
    process.exitCode = 1; return;
  }

  const { branch } = gitState;

  // STEP 2: 에이전트 잠금 확인
  if (!checkAgentLock()) {
    recordResult({ branch, success: false, reason: "에이전트 잠금 충돌" });
    process.exitCode = 1; return;
  }

  // STEP 3~4: 에이전트 실행
  let agentResult;
  try {
    agentResult = await runAgent();
  } catch (err) {
    fail(`에이전트 실행 중 예상치 못한 오류: ${err.message}`);
    recordResult({ branch, success: false, reason: `에이전트 오류: ${err.message}` });
    process.exitCode = 1; return;
  }

  const checked = checkAgentResult(agentResult);
  if (!checked) {
    recordResult({ branch, success: false, reason: "에이전트 결과 없음" });
    process.exitCode = 1; return;
  }
  if (checked.skipped) {
    recordResult({ branch, success: false, reason: "에이전트 중복 실행으로 건너뜀" });
    return;
  }

  const newCount = checked.newCount ?? 0;

  // STEP 5~8: preview 검증
  const validated = validatePreview(PREVIEW_FILE);
  if (!validated) {
    recordResult({ branch, newCount, success: false, reason: "preview 검증 실패" });
    process.exitCode = 1; return;
  }

  const { items } = validated;

  // STEP 9~10: 변경 확인
  if (!hasRealChange(PREVIEW_FILE, newCount)) {
    log("\n✅ 수집 성공, 신규 게시물 없음 → commit/push 없음 (Render 재배포 없음)");
    recordResult({ branch, newCount: 0, success: false, reason: "변경사항 없음 (정상)" });
    return;
  }

  // 항목 수가 기존 대비 80% 이상 줄었는지 검사
  const prevData = readJson(path.join(ROOT, "data/university-news-preview.json"));
  if (prevData) {
    const prevCount = Array.isArray(prevData.items) ? prevData.items.length : 0;
    if (prevCount > 0 && items.length < prevCount * (1 - MAX_DROP_RATIO)) {
      fail(`preview 항목이 기존(${prevCount}건)보다 80% 이상 줄었습니다. (현재: ${items.length}건)\n  비정상 데이터로 판단하여 push를 중단합니다.`);
      recordResult({ branch, newCount, success: false, reason: "preview 항목 80% 이상 감소" });
      process.exitCode = 1; return;
    }
  }

  // STEP 11~12: Git stage
  const stageResult = stageNewsFiles();
  if (!stageResult) {
    recordResult({ branch, newCount, success: false, reason: "Git stage 실패" });
    process.exitCode = 1; return;
  }

  // STEP 13: commit
  const commitMessage = createCommit(newCount);
  if (!commitMessage) {
    recordResult({ branch, newCount, success: false, reason: "commit 실패" });
    process.exitCode = 1; return;
  }

  // STEP 14: push
  const pushed = pushToGitHub(branch);
  if (!pushed) {
    recordResult({ branch, newCount, commitMessage, success: false, reason: "push 실패" });
    process.exitCode = 1; return;
  }

  // STEP 15~17: 결과 기록
  recordResult({ branch, newCount, commitMessage, success: true });
}

main().catch((err) => {
  console.error("[deploy] 예상치 못한 오류:", err.message);
  process.exitCode = 1;
});
