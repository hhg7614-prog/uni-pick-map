"use strict";

// Read-only regression runner: this script writes only its diagnostic report.
const fs = require("fs");
const path = require("path");
const { getOfficialHomepage } = require("./get-official-homepage");
const ROOT = path.resolve(__dirname, "../../../..");
const QUEUE = path.join(ROOT, "server/agent/onboarding/data/university-feed-agent-v1-retry-queue.json");
const OUTPUT = path.join(ROOT, "server/agent/onboarding/reports/university-feed-agent-v1/container-precision-v21-test10.json");
const USER_AGENT = "Mozilla/5.0 compatible UNI-PICK content-container-validator";
const FEED_WORDS = /\uacf5\uc9c0|\uc18c\uc2dd|\ub274\uc2a4|\ub300\ud559\uc18c\uc2dd|\ud559\uad50\uc18c\uc2dd|\ud589\uc0ac|\ud504\ub85c\uadf8\ub7a8|\uc54c\ub9bc|\ud559\uc0ac|\uc7a5\ud559|\uc5f0\uad6c|campus/i;
const MORE_WORDS = /\ub354\ubcf4\uae30|\uc804\uccb4\ubcf4\uae30|\bmore\b|\ball\b/i;
const BAD_TEXT = /\ub85c\uadf8\uc778|\uac80\uc0c9|portal|lms|\uc885\ud569\uc815\ubcf4|\uc218\uac15\uc2e0\uccad|\uc785\ud559|\uc785\uc2dc|admission|\ub300\ud559\uc18c\uac1c|\ud559\uacfc\uc18c\uac1c|\uad50\uc218\uc18c\uac1c|\uc870\uc9c1\ub3c4|\uc624\uc2dc\ub294\uae38|\uc0ac\uc774\ud2b8\ub9f5|privacy/i;
const FAMILY = /\/bbs\/|\/board\/|\/article\/|\/notice\/|\/news\/|artcl(?:View|List)|selectNttList|CMS\/Board|\b(?:mode|seq|nttId|articleNo|board_seq)=/i;
const DATE = /20\d{2}[^\d]{0,4}\d{1,2}[^\d]{0,4}\d{1,2}/;
const DETAIL = /(?:mode=view|board_seq=|nttId=|articleNo=|article\.no=|[?&](?:seq|idx)=|\/view(?:\.do|\/)|\/article\/\d+)/i;
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const text = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
const attrs = value => Object.fromEntries([...String(value || "").matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
const isHtml = response => /text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "");
const meaningfulTitle = value => { const candidate = text(value); return candidate.length >= 8 && /[\p{L}\p{N}]/u.test(candidate) && !/^\d+(?:\.|\)|$)/.test(candidate) && !/^(?:\ub354\ubcf4\uae30|\uc804\uccb4\ubcf4\uae30|\ucde8\uc5c5\uc815\ubcf4|\uac80\uc0c9)$/i.test(candidate); };
function domainAllowed(url, home) { const a = new URL(url).hostname.replace(/^www\./, "").toLowerCase(), b = new URL(home).hostname.replace(/^www\./, "").toLowerCase(); return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`); }
function sectionLinks(html, homepage) {
  const found = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attribute = attrs(match[1]), label = text(`${match[2]} ${attribute.title || ""} ${attribute["aria-label"] || ""}`), href = attribute.href || "";
    if (!MORE_WORDS.test(label) || !href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let url; try { url = new URL(href, homepage).href; } catch { continue; }
    if (!domainAllowed(url, homepage) || BAD_TEXT.test(label)) continue;
    const nearby = html.slice(Math.max(0, match.index - 1800), match.index + match[0].length);
    const headings = [...nearby.matchAll(/<(?:h[1-6]|strong|b|dt|p)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b|dt|p)>/gi)].map(value => text(value[1])).filter(Boolean);
    const sectionHeading = [...headings].reverse().find(value => FEED_WORDS.test(value)) || "", context = text(nearby);
    const sectionScore = (sectionHeading ? 30 : 0) + 25 + 20 + (FAMILY.test(url) ? 15 : 0) + (DATE.test(context) ? 10 : 0) - (BAD_TEXT.test(context) ? 40 : 0);
    if (sectionScore >= 40) found.push({ sectionHeading, moreText: label, moreUrl: url, sectionScore });
  }
  return [...new Map(found.map(item => [item.moreUrl, item])).values()].slice(0, 10);
}
function inspectList(html, listUrl) {
  const candidates = [];
  for (const match of html.matchAll(/<(tr|li|article|div)\b([^>]*)>([\s\S]{0,9000}?)<\/\1>/gi)) {
    const raw = match[0], links = []; let fragmentExcluded = 0, javascriptExcluded = 0, menuStaticExcluded = 0, utilityExcluded = 0, externalExcluded = 0;
    for (const anchor of raw.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attribute = attrs(anchor[1]), title = text(anchor[2]), href = attribute.href || "";
      if (!href || /^#/.test(href)) { fragmentExcluded++; continue; }
      if (/^javascript:|^void\(/i.test(href)) { javascriptExcluded++; continue; }
      if (!meaningfulTitle(title) || BAD_TEXT.test(title)) { BAD_TEXT.test(title) ? utilityExcluded++ : menuStaticExcluded++; continue; }
      let url; try { url = new URL(href, listUrl).href; } catch { menuStaticExcluded++; continue; }
      if (!domainAllowed(url, listUrl)) { externalExcluded++; continue; }
      if (!FAMILY.test(url) || !DETAIL.test(url)) { menuStaticExcluded++; continue; }
      links.push({ title, url });
    }
    const unique = [...new Map(links.map(item => [item.url, item])).values()]; if (!unique.length) continue;
    const all = unique.length + fragmentExcluded + javascriptExcluded + menuStaticExcluded + utilityExcluded + externalExcluded;
    const navigationLinkRatio = (fragmentExcluded + javascriptExcluded + menuStaticExcluded) / Math.max(1, all), utilityLinkRatio = utilityExcluded / Math.max(1, all), externalLinkRatio = externalExcluded / Math.max(1, all), dateEvidenceCount = (raw.match(new RegExp(DATE.source, "g")) || []).length;
    const familyKeys = new Set(unique.map(item => item.url.replace(/[?&](?:nttId|seq|idx|articleNo|board_seq)=[^&]+/gi, "?item="))), detailUrlFamilyEvidence = familyKeys.size === 1 || unique.length >= 3, paginationEvidence = /pagination|paging|page-link|\ud398\uc774\uc9c0/i.test(html), tableHeaderEvidence = /\ubc88\ud638|\uc81c\ubaa9|\uc791\uc131\uc77c|\ub4f1\ub85d\uc77c|\uc870\ud68c\uc218/i.test(html), titleDiversity = new Set(unique.map(item => item.title)).size;
    const contentContainerScore = (unique.length >= 3 ? 25 : 0) + (titleDiversity >= 3 ? 15 : 0) + (dateEvidenceCount >= 2 ? 15 : 0) + (detailUrlFamilyEvidence ? 15 : 0) + (paginationEvidence ? 10 : 0) + (tableHeaderEvidence ? 10 : 0) - (navigationLinkRatio >= .4 ? 60 : 0) - (utilityLinkRatio >= .3 ? 45 : 0) - (externalLinkRatio >= .3 ? 35 : 0);
    candidates.push({ selectedContainer: `${match[1].toLowerCase()}${/class=/i.test(match[2]) ? "[class]" : ""}`, contentContainerScore, validItems: unique.length, uniqueDetailUrls: unique.length, dateEvidenceCount, paginationEvidence, tableHeaderEvidence, detailUrlFamilyEvidence, navigationLinkRatio, utilityLinkRatio, externalLinkRatio, fragmentExcluded, javascriptExcluded, menuStaticExcluded, utilityExcluded, externalExcluded, samples: unique.slice(0, 3) });
  }
  return candidates.sort((a, b) => b.contentContainerScore - a.contentContainerScore)[0] || null;
}
async function fetchHtml(url) { const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml" }, redirect: "follow" }); if (!response.ok || !isHtml(response)) return null; return { url: response.url, html: await response.text() }; }
async function processTarget(target) {
  const homepage = getOfficialHomepage(target.universityId); if (!homepage) return { ...target, decision: "NO_CANDIDATE", networkRequests: 0, sections: [] }; let networkRequests = 0;
  try { const home = await fetchHtml(homepage.url); networkRequests++; if (!home) return { ...target, homepage: homepage.url, decision: "NO_CANDIDATE", networkRequests, sections: [] }; const sections = sectionLinks(home.html, home.url); let rejected = false;
    for (const section of sections.slice(0, 5)) { const page = await fetchHtml(section.moreUrl); networkRequests++; if (!page) { rejected = true; continue; } const result = inspectList(page.html, page.url); if (!result) { rejected = true; continue; } const valid = result.contentContainerScore >= 60 && result.validItems >= 3 && result.uniqueDetailUrls >= 3 && result.dateEvidenceCount >= 2 && result.navigationLinkRatio < .4 && result.utilityLinkRatio < .3; if (valid) return { ...target, homepage: homepage.url, decision: "TITLE_UNSTABLE", sections, ...section, listUrl: page.url, ...result, networkRequests }; rejected = true; }
    return { ...target, homepage: homepage.url, decision: sections.length || rejected ? "CONTENT_CONTAINER_REJECTED" : "NO_CANDIDATE", sections, networkRequests };
  } catch (error) { return { ...target, homepage: homepage.url, decision: "NO_CANDIDATE", error: error.name, networkRequests, sections: [] }; }
}
(async () => { const targets = readJson(QUEUE).items.filter(item => item.reason === "TITLE_UNSTABLE").slice(0, 10), items = []; for (const target of targets) items.push(await processTarget(target)); const count = decision => items.filter(item => item.decision === decision).length; const report = { processed: items.length, feedSectionLinkUniversities: items.filter(item => item.sections?.length).length, sectionCandidates: items.reduce((sum, item) => sum + (item.sections?.length || 0), 0), sectionScorePassed: items.reduce((sum, item) => sum + (item.sections?.length || 0), 0), sectionFetches: items.reduce((sum, item) => sum + Math.max(0, item.networkRequests - 1), 0), listPages: count("TITLE_UNSTABLE"), validFeeds: count("TITLE_UNSTABLE"), contentContainerRejected: count("CONTENT_CONTAINER_REJECTED"), noCandidate: count("NO_CANDIDATE"), titleUnstable: count("TITLE_UNSTABLE"), networkRequests: items.reduce((sum, item) => sum + item.networkRequests, 0), mutation: { queue: false, retry: false, source: false, store: false, preview: false, verified: false }, items }; writeJson(OUTPUT, report); console.log(JSON.stringify(report, null, 2)); })().catch(error => { console.error(error); process.exitCode = 1; });
