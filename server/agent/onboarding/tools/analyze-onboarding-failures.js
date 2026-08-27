"use strict";

// Read-only analysis of completed onboarding reports. It never fetches a site,
// changes a source configuration, or writes store/preview files.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../../..");
const DATA = path.join(ROOT, "server", "agent", "onboarding", "data");
const REPORTS = path.join(ROOT, "server", "agent", "onboarding", "reports");
const QUEUE = path.join(DATA, "onboarding-queue.json");
const STATE = path.join(DATA, "onboarding-batch-state.json");
const FINAL = path.join(REPORTS, "final", "final-summary.json");
const OUT = path.join(REPORTS, "failure-analysis");
const SMART = path.join(DATA, "onboarding-smart-retry-queue.json");

function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function classify(row, summary) {
  const errors = (summary.errors || []).join(" ").toLowerCase(); const candidate = summary.recommendedCandidate || {}; const selectors = summary.selectors || candidate.selectors || {};
  const secondary = [];
  if (/fetch failed|network/.test(errors) || row.result?.errorType === "NETWORK_ERROR") return ["NETWORK_ERROR", secondary];
  if (/dns/.test(errors)) return ["DNS_ERROR", secondary]; if (/ssl/.test(errors)) return ["SSL_ERROR", secondary]; if (/timeout|abort/.test(errors)) return ["TIMEOUT", secondary];
  if (/403/.test(errors)) return ["HTTP_403", secondary]; if (/429/.test(errors)) return ["HTTP_429", secondary]; if (/404/.test(errors)) return ["HTTP_404", secondary]; if (/\b5\d\d\b/.test(errors)) return ["HTTP_5XX", secondary];
  if (summary.homepageRequest?.error) secondary.push("HOMEPAGE_FETCH_FAILED");
  if (!summary.discoveredCandidateCount) return [secondary[0] || "NO_CANDIDATE", secondary];
  if (!candidate || candidate.listConfidence === "LOW") return ["NO_VALID_LIST", secondary];
  if ((summary.uniqueDetailUrls || 0) === 0) return ["NO_DETAIL_LINKS", secondary];
  if ((summary.uniqueDetailUrls || 0) === 1) return ["ONLY_ONE_DETAIL_LINK", secondary];
  if ((summary.passCount || 0) < 2 && !selectors.detailDate) return ["DATE_NOT_STABLE", secondary];
  if (!summary.selectorStable || !selectors.listItem) return ["SELECTOR_UNSTABLE", secondary];
  if ((summary.warnCount || 0) > 0) return ["TITLE_MISMATCH", secondary];
  return [row.status === "final_review_required" ? "MULTIPLE_CANDIDATES_AMBIGUOUS" : "UNKNOWN", secondary];
}
function plan(reason) {
  const map = {
    NETWORK_ERROR: ["retry_with_browser_headers", "retry_www_and_non_www", "timeout_20_seconds"], DNS_ERROR: ["retry_www_and_non_www", "confirm_official_domain"], SSL_ERROR: ["confirm_https_official_endpoint"], TIMEOUT: ["timeout_20_seconds", "one_retry_only"],
    NO_CANDIDATE: ["scan_homepage_internal_links", "check_news_notice_press_keywords", "check_english_site"], NO_VALID_LIST: ["compare_table_list_card_patterns", "check_pagination"], NO_DETAIL_LINKS: ["inspect_list_link_pattern"], ONLY_ONE_DETAIL_LINK: ["inspect_more_recent_articles"],
    DATE_NOT_STABLE: ["check_time_jsonld_article_published_time_meta", "allow_verified_list_date_fallback"], SELECTOR_UNSTABLE: ["compare_three_articles", "prefer_simple_attribute_selectors"], TITLE_MISMATCH: ["check_detail_title_selector"],
    HTTP_403: ["do_not_bypass", "check_official_rss_or_public_api"], HTTP_429: ["do_not_bypass", "defer_and_check_official_rss"], HOMEPAGE_FETCH_FAILED: ["check_existing_unverified_candidate", "test_non_homepage_official_list"]
  }; return map[reason] || ["manual_official_source_review"];
}
function score(reason, summary) { let value = 20; if (summary.officialDomains?.length) value += 30; if (summary.discoveredCandidateCount) value += 20; if (summary.uniqueDetailUrls) value += 15; if ((summary.passCount || 0) > 0) value += 10; if (/DATE|SELECTOR/.test(reason)) value += 10; if (/NETWORK|TIMEOUT/.test(reason)) value -= 15; if (/403|429/.test(reason)) value -= 30; return Math.max(0, Math.min(100, value)); }
function likelihood(reason, scoreValue) { if (/DATE|SELECTOR|ONLY_ONE/.test(reason) && scoreValue >= 55) return "HIGH"; if (scoreValue >= 40) return "MEDIUM"; return "LOW"; }
function analyze() {
  const queue = read(QUEUE, { items: [] }); const failures = (queue.items || []).filter(row => row.status === "final_review_required" || row.status === "final_error");
  const items = failures.map(row => { const summary = read(path.join(REPORTS, row.universityId, "summary.json"), {}); const [primaryReason, secondaryReasons] = classify(row, summary); const priorityScore = score(primaryReason, summary); return { universityId: row.universityId, universityName: row.universityName, finalStatus: row.status, primaryReason, secondaryReasons, evidence: [...(summary.errors || []).slice(0, 3), `candidates=${summary.discoveredCandidateCount || 0}`, `detailUrls=${summary.uniqueDetailUrls || 0}`, `passCount=${summary.passCount || 0}`, `selectorStable=${Boolean(summary.selectorStable)}`], priorityScore, recoveryLikelihood: likelihood(primaryReason, priorityScore), strategy: plan(primaryReason), status: "pending" }; }).sort((a, b) => b.priorityScore - a.priorityScore || a.universityName.localeCompare(b.universityName, "ko"));
  const byReason = {}; const byLikelihood = { HIGH: 0, MEDIUM: 0, LOW: 0 }; for (const item of items) { byReason[item.primaryReason] = (byReason[item.primaryReason] || 0) + 1; byLikelihood[item.recoveryLikelihood] += 1; write(path.join(OUT, "universities", `${item.universityId}.json`), item); }
  const output = { generatedAt: new Date().toISOString(), input: { queue: QUEUE, state: STATE, final: FINAL }, totalFailures: items.length, byReason, byLikelihood, items };
  write(path.join(OUT, "failure-analysis.json"), output); fs.writeFileSync(path.join(OUT, "failure-analysis.md"), `# UNI PICK Failure Analysis\n\n- Total: ${items.length}\n- HIGH: ${byLikelihood.HIGH}\n- MEDIUM: ${byLikelihood.MEDIUM}\n- LOW: ${byLikelihood.LOW}\n\n## Reasons\n${Object.entries(byReason).sort((a,b)=>b[1]-a[1]).map(([key,count])=>`- ${key}: ${count}`).join("\n")}\n`, "utf8");
  write(SMART, { generatedAt: output.generatedAt, total: items.length, items }); return output;
}
if (process.argv.includes("--status")) { const q = read(SMART, { items: [] }); console.log(JSON.stringify({ total: q.total || 0, pending: (q.items || []).filter(x => x.status === "pending").length, top: (q.items || []).slice(0, 10).map(x => ({ universityName: x.universityName, primaryReason: x.primaryReason, priorityScore: x.priorityScore, recoveryLikelihood: x.recoveryLikelihood })) }, null, 2)); }
else console.log(JSON.stringify(analyze(), null, 2));
