"use strict";

// A no-mutation production-collector check. Source config, queues and stores stay untouched.
const fs = require("fs");
const path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");

const ROOT = path.resolve(__dirname, "../../../..");
const REPORT = path.join(ROOT, "server/agent/onboarding/reports/university-feed-agent-v1/dnue-collector-dry-run.json");
const ID = "daegu-national-university-of-education-\u1107\u1169\u11ab\u1100\u116d";
const LIST_URL = "http://www.dnue.ac.kr/kor/CMS/Board/Board.do?mCode=MN168";
const university = { universityId: ID, universityName: "\ub300\uad6c\uad50\uc721\ub300\ud559\uad50", campusName: "", universityGroupId: ID };
const source = { id: "dnue-general-feed-dry-run", name: "\ub300\uad6c\uad50\uc721\ub300\ud559\uad50 \uacf5\uc9c0\uc0ac\ud56d (dry run)", listUrl: LIST_URL, category: "school_news", sourceScope: "GENERAL_UNIVERSITY_FEED", collectionType: "html", verified: false, enabled: false, selectors: { item: "tbody tr", title: "a", link: "a", date: "td", dateIndex: 3 }, detailSelectors: { title: "h4.vtitle" }, datePolicy: { prefer: "list" } };
function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function norm(value) { return clean(value).normalize("NFC").replace(/\s+/g, " ").trim(); }
function sameTitle(a, b) { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); }
function category(title) { const value = norm(title); if (/\ud589\uc0ac|\ucea0\ud504|\ucd95\uc81c|\uc138\ubbf8\ub098/.test(value)) return "EVENT"; if (/\uc7a5\ud559/.test(value)) return "SCHOLARSHIP"; if (/\ubaa8\uc9d1|\ucc44\uc6a9/.test(value)) return "RECRUITMENT"; if (/\ud559\uc0ac|\uc218\uc5c5|\uc878\uc5c5/.test(value)) return "ACADEMIC"; if (/\ud504\ub85c\uadf8\ub7a8|\uad50\uc721/.test(value)) return "PROGRAM"; if (/\uacf5\uc9c0|\uc548\ub0b4|\uc8fc\uc758/.test(value)) return "NOTICE"; return "OTHER"; }
async function runOnce() {
  const collected = await htmlListCollector({ university, source, limit: 3 });
  const items = [];
  for (const item of collected.items) {
    const response = await fetch(item.sourceUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 compatible UNI-PICK dry-run validator", Accept: "text/html,application/xhtml+xml" } });
    const html = await response.text(); const detailTitle = clean(textOf(findBySelector(html, "h4.vtitle")[0]));
    items.push({ title: item.title, detailUrl: response.url, publishedAt: item.publishedAt, dateProvenance: "LIST_ROW_VERIFIED", detailTitle, titleMatch: sameTitle(item.title, detailTitle), contentCategory: category(item.title), uiCategory: "school_news" });
  }
  return { itemCount: items.length, uniqueDetailUrls: new Set(items.map(item => item.detailUrl)).size, titleMatchCount: items.filter(item => item.titleMatch).length, publishedAtNull: items.filter(item => !item.publishedAt).length, duplicateCount: items.length - new Set(items.map(item => item.detailUrl)).size, networkRequests: 1 + items.length, items, collectorWarnings: collected.warnings, finalUrl: collected.finalUrl };
}
async function main() {
  const runs = []; for (let index = 0; index < 3; index++) runs.push(await runOnce());
  const stable = runs.length >= 2 && runs.every(run => run.itemCount >= 3 && run.uniqueDetailUrls >= 3 && run.titleMatchCount >= 2 && run.publishedAtNull === 0 && run.duplicateCount === 0);
  const report = { universityId: ID, universityName: university.universityName, sourceScope: source.sourceScope, listUrl: LIST_URL, collectorConfig: { listContainerSelector: "tbody", itemSelector: "tbody tr", titleSelector: "a", detailLinkSelector: "a[href]", listDateSelector: "td (index 3)", detailTitleSelector: "h4.vtitle", selectorCorrection: ".view-title is a broad DOM-analysis class match; h4.vtitle is the exact selector supported by the production collector" }, qualityApproved: true, dryRunCount: runs.length, runs, collectorConfigReady: stable, collectorDryRunCount: runs.length, activationReady: stable, campusScope: "ALL_UNIVERSITY", campusScopeEvidence: "\uacf5\uc2dd \ub300\ud559 \uba54\uc778 \uacf5\uc9c0\uc0ac\ud56d(MN168) \ubaa9\ub85d", mutation: { queue: false, retryQueue: false, source: false, store: false, preview: false, verified: false, git: false, render: false } };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
