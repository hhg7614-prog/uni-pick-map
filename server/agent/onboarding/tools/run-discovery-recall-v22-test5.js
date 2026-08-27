"use strict";

// Read-only recall diagnostic. Navigation anchors are URL seeds only, never feed items.
const fs = require("fs");
const path = require("path");
const { getOfficialHomepage } = require("./get-official-homepage");
const { clean, inspectContainer } = require("../lib/feed-section-discovery");
const ROOT = path.resolve(__dirname, "../../../..");
const OUT = path.join(ROOT, "server/agent/onboarding/reports/university-feed-agent-v1/discovery-recall-v22-test5.json");
const IDS = ["incheon-national-university-\u1107\u1169\u11ab\u1100\u116d", "the-university-of-suwon-\u1107\u1169\u11ab\u1100\u116d", "soonchunhyang-university-\u1107\u1169\u11ab\u1100\u116d", "silla-university-\u1107\u1169\u11ab\u1100\u116d", "jeonju-national-university-of-education-\u1107\u1169\u11ab\u1100\u116d"];
const LIST_TEXT = /공지사항|공지|대학공지|일반공지|학사공지|학생공지|학교소식|대학소식|뉴스|언론보도|보도자료|커뮤니티|행사|프로그램|장학|학사|연구소식/i;
const BLOCKED = /대학소개|총장|연혁|조직|학과|교수|오시는 길|사이트맵|로그인|검색|portal|lms|종합정보|수강신청|입학|입시|admission|증명/i;
const BOARD = /\/bbs\/|\/board\/|\/notice\/|\/news\/|\/community\/|\/CMS\/Board\/|artclList|selectNttList|\/list\.do|[?&]mCode=/i;
const attr = raw => Object.fromEntries([...String(raw).matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
const official = (url, home) => { try { const a = new URL(url).hostname.replace(/^www\./i, ""), b = new URL(home).hostname.replace(/^www\./i, ""); return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`); } catch { return false; } };
const html = response => /text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "");
async function page(url) { const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 compatible UNI-PICK Discovery Recall v2.2", Accept: "text/html,application/xhtml+xml" } }); if (!response.ok || !html(response)) return null; return { url: response.url, html: await response.text() }; }
function navigationSeeds(markup, homepage) {
  const found = [];
  for (const match of String(markup).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attr(match[1]), anchorText = clean(`${match[2]} ${a.title || ""}`), href = a.href || "";
    if (!anchorText || !LIST_TEXT.test(anchorText) || BLOCKED.test(anchorText) || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let url; try { url = new URL(href, homepage).href; } catch { continue; }
    if (!official(url, homepage)) continue;
    const nearby = clean(String(markup).slice(Math.max(0, match.index - 1200), match.index + match[0].length));
    const heading = [...String(markup).slice(Math.max(0, match.index - 1800), match.index).matchAll(/<(?:h[1-6]|strong|dt|li|span)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|dt|li|span)>/gi)].map(x => clean(x[1])).filter(Boolean).slice(-1)[0] || null;
    const score = (LIST_TEXT.test(anchorText) ? 35 : 0) + (official(url, homepage) ? 25 : 0) + (BOARD.test(url) ? 20 : 0) + (/공지|소식|뉴스|커뮤니티|학사|학생/.test(nearby) ? 10 : 0) - (BLOCKED.test(nearby) ? 40 : 0);
    if (score >= 40) found.push({ parentMenu: heading, anchorText, href: url, listPageEvidence: BOARD.test(url), sectionScore: score });
  }
  return [...new Map(found.map(x => [x.href, x])).values()].sort((a, b) => b.sectionScore - a.sectionScore).slice(0, 10);
}
async function run(id) {
  const home = getOfficialHomepage(id); let requests = 0;
  if (!home) return { universityId: id, decision: "NO_CANDIDATE", networkRequests: 0, probes: [] };
  try {
    const start = await page(home.url); requests++; if (!start) return { universityId: id, homepage: home.url, decision: "NETWORK", networkRequests: requests, probes: [] };
    const probes = navigationSeeds(start.html, start.url); let rejected = false;
    for (const probe of probes.slice(0, 5)) {
      const list = await page(probe.href); requests++; if (!list || !official(list.url, start.url)) { rejected = true; continue; }
      const container = inspectContainer(list.html, list.url);
      const valid = container && container.contentContainerScore >= 60 && container.validItems >= 3 && container.uniqueDetailUrls >= 3 && container.dateEvidenceCount >= 2 && container.navigationLinkRatio < .4 && container.utilityLinkRatio < .3;
      if (valid) return { universityId: id, universityName: home.universityName || null, homepage: start.url, proposedResult: "DISCOVERY_RECOVERED", listUrl: list.url, selectedProbe: probe, probes, ...container, networkRequests: requests, falseNavigationCandidate: false };
      rejected = true;
    }
    return { universityId: id, universityName: home.universityName || null, homepage: start.url, proposedResult: probes.length || rejected ? "CONTENT_CONTAINER_REJECTED" : "NO_CANDIDATE", probes, networkRequests: requests, falseNavigationCandidate: false };
  } catch (error) { return { universityId: id, homepage: home.url, proposedResult: "NETWORK", errorName: error.name, networkRequests: requests, probes: [], falseNavigationCandidate: false }; }
}
function write(value) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); const tmp = `${OUT}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, OUT); }
(async () => { const items = []; for (const id of IDS) items.push(await run(id)); const n = value => items.filter(x => x.proposedResult === value).length; const report = { phase: "discovery_recall_v2_2_test5", processed: items.length, listPageLinkUniversities: items.filter(x => x.probes?.length).length, listPageLinkCandidates: items.reduce((s, x) => s + (x.probes?.length || 0), 0), actualFetches: items.reduce((s, x) => s + Math.max(0, x.networkRequests - 1), 0), listPageFound: n("DISCOVERY_RECOVERED"), validFeedFound: n("DISCOVERY_RECOVERED"), discoveryRecovered: n("DISCOVERY_RECOVERED"), contentContainerRejected: n("CONTENT_CONTAINER_REJECTED"), noCandidate: n("NO_CANDIDATE"), network: n("NETWORK"), networkRequests: items.reduce((s, x) => s + x.networkRequests, 0), mutation: { queue: false, retryQueue: false, source: false, store: false, preview: false, verified: false, git: false, render: false }, items }; write(report); console.log(JSON.stringify(report, null, 2)); })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
