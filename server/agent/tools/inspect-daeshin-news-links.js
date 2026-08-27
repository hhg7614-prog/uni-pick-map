"use strict";

const { execFileSync } = require("child_process");
const { URL } = require("url");

const START_URLS = [
  "https://www.daeshin.ac.kr/html/00_main/index.php?m2A=CL&m2M=A6",
  "https://www.daeshin.ac.kr/html/01_about/",
  "https://www.daeshin.ac.kr/html/intro/"
];

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(base, href) {
  try {
    if (!href) return null;

    const raw = String(href).trim();

    if (
      raw.startsWith("javascript:")
      || raw.startsWith("#")
      || raw.startsWith("mailto:")
      || raw.startsWith("tel:")
    ) {
      return null;
    }

    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function fetchCurl(url) {
  try {
    const output = execFileSync(
      "curl.exe",
      [
        "-L",
        "--max-redirs",
        "10",
        "--connect-timeout",
        "20",
        "--max-time",
        "30",
        "--silent",
        "--show-error",
        "--write-out",
        "\n__META__%{http_code}|%{url_effective}",
        url
      ],
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      }
    );

    const marker = "\n__META__";
    const idx = output.lastIndexOf(marker);

    if (idx < 0) {
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        html: ""
      };
    }

    const html = output.slice(0, idx);
    const meta = output.slice(idx + marker.length).trim();
    const [statusRaw, finalUrl] = meta.split("|");

    const status = Number(statusRaw || 0);

    return {
      ok: status === 200,
      status,
      finalUrl: finalUrl || url,
      html
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      error: String(error.stderr || error.message || error)
    };
  }
}

function extractAnchors(html, baseUrl) {
  const out = [];

  const regex =
    /<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html))) {
    const href = match[2];
    const text = cleanText(match[4]);
    const url = normalizeUrl(baseUrl, href);

    if (!url) continue;

    out.push({
      text,
      href,
      url
    });
  }

  return out;
}

function scoreAnchor(anchor) {
  let score = 0;
  const reasons = [];

  const url = anchor.url.toLowerCase();
  const text = anchor.text;

  if (
    /01_about/.test(url)
  ) {
    score += 10;
    reasons.push("ABOUT_SECTION");
  }

  if (
    /news|board|bbs|notice|community|sub|list|05_|06_|07_|08_|09_/i.test(url)
  ) {
    score += 40;
    reasons.push("BOARDISH_URL");
  }

  if (
    /news/i.test(url)
  ) {
    score += 80;
    reasons.push("NEWS_URL");
  }

  if (
    /board|bbs/i.test(url)
  ) {
    score += 70;
    reasons.push("BOARD_URL");
  }

  if (
    text.length >= 4
  ) {
    score += 5;
  }

  return {
    score,
    reasons
  };
}

function analyzePage(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl);

  const rows = (html.match(/<tr\b/gi) || []).length;
  const listItems = (html.match(/<li\b/gi) || []).length;

  const dates =
    cleanText(html).match(
      /\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g
    ) || [];

  const detailLinks =
    anchors.filter(a =>
      /view|detail|idx=|no=|board|bbs|article|wr_id/i.test(a.url)
    );

  return {
    anchors: anchors.length,
    rows,
    listItems,
    dates: [...new Set(dates)].length,
    detailLinks: detailLinks.length
  };
}

function main() {
  const collected = [];

  for (const startUrl of START_URLS) {
    const fetched = fetchCurl(startUrl);

    if (!fetched.ok) {
      collected.push({
        startUrl,
        status: fetched.status,
        error: fetched.error || null
      });

      continue;
    }

    const anchors =
      extractAnchors(
        fetched.html,
        fetched.finalUrl
      );

    const candidates = [];

    for (const anchor of anchors) {
      const scoring = scoreAnchor(anchor);

      if (scoring.score < 20) {
        continue;
      }

      candidates.push({
        text: anchor.text,
        href: anchor.href,
        url: anchor.url,
        score: scoring.score,
        reasons: scoring.reasons
      });
    }

    candidates.sort(
      (a, b) => b.score - a.score
    );

    collected.push({
      startUrl,
      status: fetched.status,
      finalUrl: fetched.finalUrl,
      bytes: Buffer.byteLength(fetched.html, "utf8"),
      pageAnalysis: analyzePage(
        fetched.html,
        fetched.finalUrl
      ),
      topCandidates: candidates.slice(0, 30)
    });
  }

  const uniqueCandidateMap = new Map();

  for (const result of collected) {
    for (const item of result.topCandidates || []) {
      const existing =
        uniqueCandidateMap.get(item.url);

      if (
        !existing
        || item.score > existing.score
      ) {
        uniqueCandidateMap.set(
          item.url,
          item
        );
      }
    }
  }

  const uniqueCandidates =
    [...uniqueCandidateMap.values()]
      .sort((a, b) => b.score - a.score);

  const tested = [];

  for (const candidate of uniqueCandidates.slice(0, 20)) {
    const fetched =
      fetchCurl(candidate.url);

    if (!fetched.ok) {
      tested.push({
        ...candidate,
        status: fetched.status,
        finalUrl: fetched.finalUrl,
        error: fetched.error || null
      });

      continue;
    }

    const analysis =
      analyzePage(
        fetched.html,
        fetched.finalUrl
      );

    tested.push({
      ...candidate,
      status: fetched.status,
      finalUrl: fetched.finalUrl,
      bytes: Buffer.byteLength(
        fetched.html,
        "utf8"
      ),
      analysis
    });
  }

  tested.sort((a, b) => {
    const aValue =
      (a.analysis?.dates || 0) * 20
      + (a.analysis?.detailLinks || 0) * 10
      + a.score;

    const bValue =
      (b.analysis?.dates || 0) * 20
      + (b.analysis?.detailLinks || 0) * 10
      + b.score;

    return bValue - aValue;
  });

  console.log(
    JSON.stringify(
      {
        decision:
          "DAESHIN_NEWS_LINK_INSPECTION",

        startPages:
          collected,

        uniqueCandidates:
          uniqueCandidates.length,

        tested:
          tested.length,

        best:
          tested[0] || null,

        top10:
          tested.slice(0, 10),

        nextAction:
          "SELECT_DAESHIN_REAL_BOARD",

        safety: {
          readOnly: true,
          sourceModified: false,
          catalogModified: false,
          storeModified: false,
          previewModified: false,
          gitTriggered: false,
          deploymentTriggered: false
        }
      },
      null,
      2
    )
  );
}

main();