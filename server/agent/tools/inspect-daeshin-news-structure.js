"use strict";

const { execFileSync } = require("child_process");
const { URL } = require("url");

const TARGET_URL =
  "https://www.daeshin.ac.kr/html/05_community/01_6.php";

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(base, href) {
  try {
    if (!href) return null;

    const raw = String(href).trim();

    if (
      !raw ||
      raw.startsWith("#") ||
      raw.startsWith("javascript:void") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("tel:")
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

    const parts = meta.split("|");

    const status = Number(parts[0] || 0);
    const finalUrl = parts.slice(1).join("|") || url;

    return {
      ok: status === 200,
      status,
      finalUrl,
      html
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      error: String(
        error.stderr ||
        error.message ||
        error
      )
    };
  }
}

function extractAttrs(tag) {
  const attrs = {};

  const regex =
    /([a-zA-Z0-9:_-]+)\s*=\s*(["'])(.*?)\2/g;

  let match;

  while ((match = regex.exec(tag))) {
    attrs[match[1].toLowerCase()] =
      match[3];
  }

  return attrs;
}

function extractAnchors(fragment, baseUrl) {
  const anchors = [];

  const regex =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(fragment))) {
    const attrs =
      extractAttrs(match[1]);

    const href =
      attrs.href || "";

    anchors.push({
      text: cleanText(match[2]),
      href,
      url: normalizeUrl(baseUrl, href),
      onclick: attrs.onclick || null,
      className: attrs.class || null,
      title: attrs.title || null,
      target: attrs.target || null
    });
  }

  return anchors;
}

function findDates(text) {
  const patterns = [
    /\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g,
    /\b20\d{2}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}\b/g
  ];

  const result = [];

  for (const pattern of patterns) {
    const matches =
      String(text || "").match(pattern) || [];

    for (const value of matches) {
      if (!result.includes(value)) {
        result.push(value);
      }
    }
  }

  return result;
}

function extractRows(html, baseUrl) {
  const rows = [];

  const rowRegex =
    /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;

  let rowMatch;
  let index = 0;

  while ((rowMatch = rowRegex.exec(html))) {
    const full =
      rowMatch[0];

    const attrs =
      extractAttrs(rowMatch[1]);

    const text =
      cleanText(rowMatch[2]);

    const anchors =
      extractAnchors(
        rowMatch[2],
        baseUrl
      );

    const dates =
      findDates(text);

    const cells = [];

    const tdRegex =
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;

    let tdMatch;
    let cellIndex = 0;

    while ((tdMatch = tdRegex.exec(rowMatch[2]))) {
      const tdAttrs =
        extractAttrs(tdMatch[1]);

      const tdText =
        cleanText(tdMatch[2]);

      cells.push({
        index: cellIndex,
        className:
          tdAttrs.class || null,
        text: tdText,
        dates:
          findDates(tdText),
        anchors:
          extractAnchors(
            tdMatch[2],
            baseUrl
          )
      });

      cellIndex++;
    }

    if (
      text ||
      anchors.length ||
      cells.length
    ) {
      rows.push({
        index,
        className:
          attrs.class || null,
        id:
          attrs.id || null,
        text,
        dates,
        anchors,
        cells,
        rawSnippet:
          full
            .replace(/\s+/g, " ")
            .slice(0, 1500)
      });

      index++;
    }
  }

  return rows;
}

function extractListItems(html, baseUrl) {
  const items = [];

  const regex =
    /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;

  let match;
  let index = 0;

  while ((match = regex.exec(html))) {
    const attrs =
      extractAttrs(match[1]);

    const text =
      cleanText(match[2]);

    const anchors =
      extractAnchors(
        match[2],
        baseUrl
      );

    const dates =
      findDates(text);

    if (
      text &&
      (
        anchors.length > 0 ||
        dates.length > 0
      )
    ) {
      items.push({
        index,
        className:
          attrs.class || null,
        text,
        dates,
        anchors,
        rawSnippet:
          match[0]
            .replace(/\s+/g, " ")
            .slice(0, 1200)
      });

      index++;
    }
  }

  return items;
}

function scoreAnchor(anchor) {
  let score = 0;
  const reasons = [];

  const text =
    String(anchor.text || "");

  const href =
    String(anchor.href || "");

  if (text.length >= 5) {
    score += 10;
    reasons.push("TEXT_5_PLUS");
  }

  if (text.length >= 15) {
    score += 20;
    reasons.push("TEXT_15_PLUS");
  }

  if (text.length >= 30) {
    score += 15;
    reasons.push("TEXT_30_PLUS");
  }

  if (
    /view|detail|board|bbs|idx|no=|id=|wr_id|seq/i.test(href)
  ) {
    score += 40;
    reasons.push("DETAILISH_HREF");
  }

  if (
    /javascript:/i.test(href)
  ) {
    score += 20;
    reasons.push("JAVASCRIPT_HREF");
  }

  if (
    /공지|뉴스|행사|안내|모집|교육|학사|장학|프로그램/.test(text)
  ) {
    score += 30;
    reasons.push("CONTENT_SIGNAL");
  }

  if (
    /로그인|회원가입|HOME|메뉴|검색|사이트맵/i.test(text)
  ) {
    score -= 60;
    reasons.push("NAVIGATION_PENALTY");
  }

  return {
    score,
    reasons
  };
}

function rankContainers(rows, listItems) {
  const candidates = [];

  for (const row of rows) {
    let bestAnchor = null;

    for (const anchor of row.anchors) {
      const scoring =
        scoreAnchor(anchor);

      const candidate = {
        structure: "TR",
        containerIndex:
          row.index,
        containerText:
          row.text,
        dates:
          row.dates,
        anchor: {
          ...anchor,
          score:
            scoring.score,
          reasons:
            scoring.reasons
        },
        cells:
          row.cells
      };

      if (
        !bestAnchor ||
        scoring.score >
          bestAnchor.anchor.score
      ) {
        bestAnchor =
          candidate;
      }
    }

    if (bestAnchor) {
      candidates.push(bestAnchor);
    }
  }

  for (const item of listItems) {
    let bestAnchor = null;

    for (const anchor of item.anchors) {
      const scoring =
        scoreAnchor(anchor);

      const candidate = {
        structure: "LI",
        containerIndex:
          item.index,
        containerText:
          item.text,
        dates:
          item.dates,
        anchor: {
          ...anchor,
          score:
            scoring.score,
          reasons:
            scoring.reasons
        }
      };

      if (
        !bestAnchor ||
        scoring.score >
          bestAnchor.anchor.score
      ) {
        bestAnchor =
          candidate;
      }
    }

    if (bestAnchor) {
      candidates.push(bestAnchor);
    }
  }

  return candidates.sort(
    (a, b) =>
      b.anchor.score -
      a.anchor.score
  );
}

function main() {
  const fetched =
    fetchCurl(TARGET_URL);

  if (!fetched.ok) {
    console.log(
      JSON.stringify(
        {
          decision:
            "DAESHIN_NEWS_FETCH_FAILED",
          status:
            fetched.status,
          finalUrl:
            fetched.finalUrl,
          error:
            fetched.error || null
        },
        null,
        2
      )
    );

    process.exitCode = 1;
    return;
  }

  const rows =
    extractRows(
      fetched.html,
      fetched.finalUrl
    );

  const listItems =
    extractListItems(
      fetched.html,
      fetched.finalUrl
    );

  const ranked =
    rankContainers(
      rows,
      listItems
    );

  const likelyRows =
    ranked.filter(item =>
      item.anchor.score >= 40
    );

  const rowDates =
    rows.flatMap(row => row.dates);

  const liDates =
    listItems.flatMap(
      item => item.dates
    );

  const allDates =
    [...new Set([
      ...rowDates,
      ...liDates
    ])];

  console.log(
    JSON.stringify(
      {
        decision:
          "DAESHIN_NEWS_STRUCTURE_INSPECTED",

        status:
          fetched.status,

        finalUrl:
          fetched.finalUrl,

        bytes:
          Buffer.byteLength(
            fetched.html,
            "utf8"
          ),

        structure: {
          rows:
            rows.length,

          listItems:
            listItems.length,

          uniqueDates:
            allDates.length,

          likelyContainers:
            likelyRows.length
        },

        topCandidates:
          likelyRows.slice(0, 20),

        rowSamples:
          rows
            .filter(row =>
              row.dates.length > 0
              || row.anchors.some(
                a =>
                  scoreAnchor(a).score >= 40
              )
            )
            .slice(0, 10),

        nextAction:
          "BUILD_DAESHIN_NEWS_COLLECTOR",

        safety: {
          readOnly: true,
          sourceModified: false,
          catalogModified: false,
          storeModified: false,
          previewModified: false,
          queueModified: false,
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