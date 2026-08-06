"use strict";

/*
 * UNI PICK 뉴스 수집 2단계의 수동 검증 도구입니다.
 * 등록된 3개 대학의 목록 URL과 robots.txt만 확인합니다.
 * 게시물 상세 페이지, AI, DB, 스케줄러는 사용하지 않습니다.
 * 실행: node development/university-news/tools/validate-phase-2-sources.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "data", "university-news-sources.phase-2.json");
const REPORT_JSON = path.join(ROOT, "reports", "phase-2-source-validation.json");
const REPORT_MD = path.join(ROOT, "reports", "phase-2-source-validation.md");
const USER_AGENT = "UNI-PICK-University-News-Research/0.1";
const TIMEOUT_MS = 12000;
const REQUEST_DELAY_MS = 1100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isApprovedDomain(urlValue, approvedDomains) {
  if (!isHttpUrl(urlValue)) return false;
  const hostname = new URL(urlValue).hostname.toLowerCase();
  return approvedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function titleFromHtml(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function parseRobotsForAllUserAgents(body, pageUrl) {
  const pathName = new URL(pageUrl).pathname || "/";
  const lines = body.replace(/\r/g, "").split("\n");
  let appliesToAll = false;
  const disallows = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (key.toLowerCase() === "user-agent") appliesToAll = value === "*";
    if (appliesToAll && key.toLowerCase() === "disallow" && value) disallows.push(value);
  }
  return disallows.some((rule) => rule !== "/" && pathName.startsWith(rule)) || disallows.includes("/");
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      ...options
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function checkRobots(baseUrl, pageUrl) {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  try {
    const { response, text } = await fetchText(robotsUrl);
    return {
      robotsUrl,
      robotsStatus: response.status,
      robotsChecked: true,
      robotsNotes: response.ok
        ? (parseRobotsForAllUserAgents(text, pageUrl) ? "User-agent: * 규칙에서 이 경로의 접근 제한 가능성이 확인되었습니다." : "robots.txt를 확인했으며 자동 해석은 최소 범위로만 수행했습니다.")
        : "robots.txt 응답이 정상이 아니어서 수동 확인이 필요합니다."
    };
  } catch (error) {
    return { robotsUrl, robotsStatus: null, robotsChecked: false, robotsNotes: `robots.txt 확인 실패: ${error.name}` };
  }
}

async function validateSource(source, approvedDomains, robotsByHost) {
  const checkedAt = new Date().toISOString();
  const result = { id: source.id, name: source.name, category: source.category, listUrl: source.listUrl || "", status: "pending", checkedAt, notes: source.notes || "" };
  if (!source.listUrl) return result;
  if (!isHttpUrl(source.listUrl)) {
    source.status = "unsupported";
    source.verified = false;
    result.status = source.status;
    result.notes = "URL 형식이 올바르지 않습니다.";
    return result;
  }
  if (!isApprovedDomain(source.listUrl, approvedDomains)) {
    source.status = "unsupported";
    source.verified = false;
    result.status = source.status;
    result.notes = "등록된 공식 도메인 목록과 일치하지 않습니다.";
    return result;
  }

  const host = new URL(source.listUrl).host;
  if (!robotsByHost.has(host)) {
    robotsByHost.set(host, await checkRobots(source.baseUrl || source.listUrl, source.listUrl));
    await sleep(REQUEST_DELAY_MS);
  }
  const robots = robotsByHost.get(host);
  source.robotsUrl = robots.robotsUrl;
  source.robotsStatus = robots.robotsStatus;
  source.robotsChecked = robots.robotsChecked;
  source.robotsNotes = robots.robotsNotes;
  if (robots.robotsNotes.includes("접근 제한 가능성")) {
    source.status = "unsupported";
    source.verified = false;
    result.status = source.status;
    result.notes = `${robots.robotsNotes} 자동 수집은 진행하지 않습니다.`;
    return result;
  }

  try {
    const { response, text } = await fetchText(source.listUrl);
    const contentType = response.headers.get("content-type") || "";
    const title = titleFromHtml(text);
    source.lastCheckedAt = checkedAt;
    source.httpStatus = response.status;
    source.contentType = contentType;
    source.finalUrl = response.url;
    source.pageTitle = title;
    source.requiresJavascript = false;
    result.httpStatus = response.status;
    result.contentType = contentType;
    result.finalUrl = response.url;
    result.pageTitle = title;
    if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType) && title && !/access denied|접근이 거부/i.test(`${title} ${text.slice(0, 1200)}`)) {
      source.status = "verified";
      source.verified = true;
      result.status = "verified";
      result.notes = "공식 도메인의 HTML 목록 페이지 응답과 제목을 확인했습니다. selector 분석은 3단계에서 진행합니다.";
    } else if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
      source.status = "requires_playwright";
      source.verified = false;
      source.requiresJavascript = true;
      result.status = source.status;
      result.notes = "HTML 응답은 받았지만 목록 확인이 불충분합니다. JavaScript 렌더링 또는 수동 확인이 필요합니다.";
    } else {
      source.status = "unreachable";
      source.verified = false;
      result.status = source.status;
      result.notes = `목록 HTML을 확인하지 못했습니다. HTTP ${response.status}, Content-Type: ${contentType || "없음"}`;
    }
  } catch (error) {
    source.lastCheckedAt = checkedAt;
    source.httpStatus = null;
    source.contentType = null;
    source.finalUrl = "";
    source.status = "unreachable";
    source.verified = false;
    result.status = source.status;
    result.notes = `접속 실패: ${error.name}`;
  }
  return result;
}

function buildMarkdown(report) {
  const rows = report.universities.map((university) => {
    const sourceRows = university.sources.map((source) => `| ${source.category} | ${source.name} | ${source.status} | ${source.httpStatus ?? "-"} | ${source.listUrl || "URL 미등록"} |`).join("\n");
    return `## ${university.universityName} (${university.campusName})\n\n${university.robots.map((robot) => `- robots.txt: ${robot.robotsUrl} — ${robot.robotsStatus ?? "확인 실패"} (${robot.robotsNotes})`).join("\n")}\n\n| 유형 | 출처 | 상태 | HTTP | 목록 URL |\n| --- | --- | --- | --- | --- |\n${sourceRows}\n\n다음 단계: 검증된 목록 페이지의 구조를 수동으로 분석하고 selector를 별도로 검토합니다. 게시물 수집은 아직 하지 않습니다.`;
  }).join("\n\n");
  return `# UNI PICK 뉴스 시스템 2단계 출처 검증 보고서\n\n- 확인 시각: ${report.checkedAt}\n- 대상 대학: ${report.targetUniversities}개\n- 등록 출처: ${report.totalSources}개\n- 검증됨: ${report.verified}개\n- 보류: ${report.pending}개\n- 접근 실패: ${report.unreachable}개\n- JavaScript 확인 필요: ${report.requiresPlaywright}개\n- 지원하지 않음: ${report.unsupported}개\n\n이 보고서는 목록 페이지와 robots.txt만 확인한 결과입니다. 실제 게시물은 수집하지 않았고, 현재 UNI PICK 화면과 연결하지 않았습니다.\n\n${rows}\n`;
}

async function main() {
  const universities = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const robotsByHost = new Map();
  const reportUniversities = [];
  for (const university of universities) {
    const results = [];
    for (const source of university.sources) {
      results.push(await validateSource(source, university.approvedDomains || [], robotsByHost));
      if (source.listUrl) await sleep(REQUEST_DELAY_MS);
    }
    const universityHosts = new Set(university.sources.filter((source) => source.listUrl).map((source) => new URL(source.listUrl).host));
    const robots = [...robotsByHost.values()].filter((robot) => universityHosts.has(new URL(robot.robotsUrl).host));
    reportUniversities.push({ universityId: university.universityId, universityName: university.universityName, campusName: university.campusName, robots, sources: results });
  }
  const allSources = reportUniversities.flatMap((university) => university.sources);
  const count = (status) => allSources.filter((source) => source.status === status).length;
  const report = { phase: 2, checkedAt: new Date().toISOString(), targetUniversities: universities.length, totalSources: allSources.length, verified: count("verified"), pending: count("pending"), unreachable: count("unreachable"), requiresPlaywright: count("requires_playwright"), unsupported: count("unsupported"), universities: reportUniversities };
  fs.writeFileSync(SOURCE_FILE, `${JSON.stringify(universities, null, 2)}\n`, "utf8");
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(REPORT_MD, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({ phase: report.phase, totalSources: report.totalSources, verified: report.verified, pending: report.pending, unreachable: report.unreachable, requiresPlaywright: report.requiresPlaywright, unsupported: report.unsupported }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
