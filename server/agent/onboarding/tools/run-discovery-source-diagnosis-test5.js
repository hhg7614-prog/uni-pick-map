"use strict";

// Read-only raw HTML diagnosis for five previously unresolved homepages.
const fs = require("fs");
const path = require("path");
const { getOfficialHomepage } = require("./get-official-homepage");
const ROOT = path.resolve(__dirname, "../../../..");
const OUT = path.join(ROOT, "server/agent/onboarding/reports/university-feed-agent-v1/discovery-source-diagnosis-test5.json");
const TARGETS = [
  ["incheon-national-university-\u1107\u1169\u11ab\u1100\u116d", "인천대학교"], ["the-university-of-suwon-\u1107\u1169\u11ab\u1100\u116d", "수원대학교"], ["soonchunhyang-university-\u1107\u1169\u11ab\u1100\u116d", "순천향대학교"], ["silla-university-\u1107\u1169\u11ab\u1100\u116d", "신라대학교"], ["jeonju-national-university-of-education-\u1107\u1169\u11ab\u1100\u116d", "전주교육대학교"]
];
const KEYWORDS = ["공지", "공지사항", "대학공지", "일반공지", "학사공지", "학생공지", "새소식", "대학소식", "학교소식", "뉴스", "행사", "알림", "커뮤니티"];
const BOARD = /board|bbs|notice|news|community|artcl|CMS|Board\.do|list\.do|ntt|article/i;
const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&amp;/gi, " ").replace(/\s+/g, " ").trim();
const attrs = raw => Object.fromEntries([...String(raw).matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
const sameDomain = (url, base) => { try { const a = new URL(url).hostname.replace(/^www\./i, ""), b = new URL(base).hostname.replace(/^www\./i, ""); return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`); } catch { return false; } };
const count = (s, word) => (String(s).match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
function links(html, base) { return [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => { const a = attrs(m[1]), href = a.href || ""; let resolved = null; try { resolved = href ? new URL(href, base).href : null; } catch {} return { text: clean(`${m[2]} ${a.title || ""} ${a["aria-label"] || ""}`), href, resolved, raw: m[0], offset: m.index }; }); }
function context(html, offset) { const before = String(html).slice(Math.max(0, offset - 700), offset), open = [...before.matchAll(/<([\w-]+)\b([^>]*)>/g)].pop(); return open ? { parentElement: open[1].toLowerCase(), parentClass: attrs(open[2]).class || "", nearbyText: clean(before.slice(-400)) } : null; }
function dynamicEvidence(html) { const value = String(html); return { react: /react(?:\.production|root|dom)/i.test(value), vue: /__vue__|vue(?:\.runtime|\.js)/i.test(value), next: /__NEXT_DATA__|_next\//i.test(value), nuxt: /__NUXT__|_nuxt\//i.test(value), ajaxOrFetch: /fetch\(|axios|\$\.ajax|XMLHttpRequest/i.test(value), hydration: /hydration|initialState|__INITIAL_STATE__/i.test(value), scriptGeneratedNavigation: /document\.write|appendChild|innerHTML|menu.*(?:json|api)/i.test(value) };
}
async function diagnose([universityId, universityName]) {
  const home = getOfficialHomepage(universityId); if (!home) return { universityId, universityName, primaryReason: "UNKNOWN", secondaryEvidence: ["HOMEPAGE_MISSING"], networkRequests: 0 };
  try {
    const response = await fetch(home.url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 compatible UNI-PICK University Feed Agent v1", Accept: "text/html,application/xhtml+xml" } });
    const html = await response.text(), finalUrl = response.url, all = links(html, finalUrl), contentType = response.headers.get("content-type") || "", bodyText = clean(html), internal = all.filter(x => x.resolved && sameDomain(x.resolved, finalUrl)), external = all.filter(x => x.resolved && !sameDomain(x.resolved, finalUrl)), fragments = all.filter(x => /^#/.test(x.href)), javascript = all.filter(x => /^javascript:/i.test(x.href));
    const keywordResults = Object.fromEntries(KEYWORDS.map(word => [word, { textOccurrences: count(bodyText, word), anchorOccurrences: all.filter(x => x.text.includes(word)).length, matchingHref: [...new Set(all.filter(x => x.text.includes(word)).map(x => x.resolved).filter(Boolean))].slice(0, 5) }]));
    const boardLinks = all.filter(x => BOARD.test(`${x.href} ${x.resolved || ""}`)).map(x => ({ text: x.text, href: x.resolved || x.href, context: context(html, x.offset) })).slice(0, 30);
    const scriptBoardUrls = [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+|\/[\w./?&=%-]*(?:board|bbs|notice|news|community|artcl|CMS|ntt|article)[\w./?&=%-]*/gi)].map(x => x[0]).filter(value => BOARD.test(value)).slice(0, 30);
    const iframes = [...html.matchAll(/<iframe\b([^>]*)>/gi)].map(m => attrs(m[1]).src).filter(Boolean).map(src => { try { return new URL(src, finalUrl).href; } catch { return src; } });
    const dynamic = dynamicEvidence(html), login = /로그인|login|sign in/i.test(bodyText) && /password|비밀번호/i.test(bodyText), bot = /captcha|access denied|forbidden|bot detection/i.test(bodyText), htmlOk = response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType);
    const parserMisses = boardLinks.filter(x => x.text && KEYWORDS.some(k => x.text.includes(k)) && !/^#|^javascript:/i.test(x.href));
    const redirectVariant = new URL(home.url).href !== finalUrl;
    let primaryReason = "UNKNOWN";
    if (!htmlOk) primaryReason = bot ? "BOT_BLOCK" : login ? "LOGIN_REQUIRED" : "NETWORK_BLOCK";
    else if (parserMisses.length) primaryReason = "PARSER_MISS";
    else if (Object.values(dynamic).filter(Boolean).length >= 2 && internal.length < 8) primaryReason = "DYNAMIC_NAVIGATION";
    else if (redirectVariant && all.length < 5) primaryReason = "REDIRECT_VARIANT";
    else if (!all.length || !boardLinks.length) primaryReason = "STATIC_HTML_NO_FEED_LINK";
    return { universityId, universityName, requestedUrl: home.url, httpStatus: response.status, finalUrl, redirected: redirectVariant, contentType, htmlBytes: Buffer.byteLength(html), htmlTitle: clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]), totalAnchors: all.length, internalAnchors: internal.length, externalAnchors: external.length, fragmentAnchors: fragments.length, javascriptAnchors: javascript.length, keywordResults, boardLikeUrlCount: boardLinks.length, boardLikeLinks: boardLinks, scriptBoardUrlCount: scriptBoardUrls.length, scriptBoardUrls, iframeSources: iframes, dynamicEvidence: dynamic, parserMiss: parserMisses.length > 0, parserMissAnchors: parserMisses, primaryReason, secondaryEvidence: [redirectVariant && "REDIRECT_VARIANT", iframes.length && "IFRAME_PRESENT", dynamic.next && "NEXT", dynamic.nuxt && "NUXT", dynamic.ajaxOrFetch && "SCRIPT_REQUEST_CODE", bot && "BOT_BLOCK", login && "LOGIN_REQUIRED"].filter(Boolean), networkRequests: 1 };
  } catch (error) { return { universityId, universityName, requestedUrl: home.url, primaryReason: "NETWORK_BLOCK", secondaryEvidence: [error.name, error.message], networkRequests: 1 }; }
}
function write(value) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); const temp = `${OUT}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); JSON.parse(fs.readFileSync(temp, "utf8")); fs.renameSync(temp, OUT); }
(async () => { const items = []; for (const target of TARGETS) items.push(await diagnose(target)); const report = { phase: "discovery_source_diagnosis_test5", processed: items.length, networkRequests: items.reduce((s, x) => s + x.networkRequests, 0), mutation: { queue: false, retryQueue: false, source: false, store: false, preview: false, verified: false, git: false, render: false }, items }; write(report); console.log(JSON.stringify(report, null, 2)); })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
