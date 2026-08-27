"use strict";

/**
 * UNI PICK
 * Sangmyung Cheonan Item Structure Inspector
 *
 * 목적:
 * 상명대 천안 상명공지 목록의 실제 LI 구조를 정확히 확인한다.
 *
 * 확인 항목:
 * - articleNo
 * - LI 전체 text
 * - LI 안 모든 anchor
 * - href / class / title
 * - span / div class와 text
 * - 날짜 후보
 *
 * read-only
 */

const { spawnSync } = require("child_process");

const LIST_URL =
  "https://www.smu.ac.kr/smuchina/community/sm_notice.do?mode=list&srCampus=smuc";

const TARGET_LIMIT = 5;


function plain(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}


function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}


function curlPage(url) {
  const result =
    spawnSync(
      "curl.exe",
      [
        "-L",
        "--max-redirs", "10",
        "--connect-timeout", "20",
        "--max-time", "30",
        "--silent",
        "--show-error",
        "--compressed",

        "-A",
        "Mozilla/5.0 compatible UNI-PICK Sangmyung Item Inspector",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__META__%{http_code}|%{url_effective}",

        url
      ],
      {
        encoding: "utf8",
        timeout: 35000,
        windowsHide: true,
        maxBuffer: 25 * 1024 * 1024
      }
    );

  if (result.error) {
    throw result.error;
  }

  const stdout =
    String(result.stdout || "");

  const marker =
    "\n__META__";

  const index =
    stdout.lastIndexOf(marker);

  if (index < 0) {
    throw new Error(
      "META_MARKER_MISSING"
    );
  }

  const html =
    stdout.slice(0, index);

  const [
    rawStatus,
    finalUrl
  ] =
    stdout
      .slice(index + marker.length)
      .trim()
      .split("|");

  return {
    status:
      Number(rawStatus),

    finalUrl,

    html
  };
}


function extractAttrs(value) {
  const output = {};

  for (
    const match
    of String(value || "").matchAll(
      /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g
    )
  ) {
    output[
      match[1].toLowerCase()
    ] =
      decodeHtml(
        match[3]
      );
  }

  return output;
}


function extractLis(html) {
  return (
    html.match(
      /<li\b[^>]*>[\s\S]*?<\/li>/gi
    )
    || []
  );
}


function extractArticleNos(raw) {
  return [
    ...new Set(
      [
        ...String(raw || "").matchAll(
          /articleNo=(\d+)/gi
        )
      ].map(
        match =>
          match[1]
      )
    )
  ];
}


function extractAnchors(raw) {
  const output = [];

  for (
    const match
    of String(raw || "").matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    )
  ) {
    const attrs =
      extractAttrs(
        match[1]
      );

    output.push({
      text:
        plain(
          match[2]
        ),

      href:
        attrs.href || null,

      className:
        attrs.class || null,

      title:
        attrs.title || null,

      target:
        attrs.target || null,

      attrs
    });
  }

  return output;
}


function extractElements(
  raw,
  tagName
) {
  const output = [];

  const regex =
    new RegExp(
      `<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`,
      "gi"
    );

  for (
    const match
    of String(raw || "").matchAll(
      regex
    )
  ) {
    const attrs =
      extractAttrs(
        match[1]
      );

    const text =
      plain(
        match[2]
      );

    if (!text) {
      continue;
    }

    output.push({
      className:
        attrs.class || null,

      id:
        attrs.id || null,

      text:
        text.slice(0, 500)
    });
  }

  return output;
}


function extractDateCandidates(raw) {
  const text =
    plain(raw);

  return [
    ...new Set(
      [
        ...(text.match(
          /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
        ) || []),

        ...(text.match(
          /(?:^|\D)\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}(?=\D|$)/g
        ) || [])
      ].map(
        value =>
          value.trim()
      )
    )
  ];
}


function scoreAnchor(anchor) {
  const text =
    String(anchor.text || "")
      .trim();

  let score = 0;

  const reasons = [];

  if (
    /articleNo=\d+/i.test(
      anchor.href || ""
    )
  ) {
    score += 20;
    reasons.push("ARTICLE_LINK");
  }

  if (
    text.length >= 15
  ) {
    score += 40;
    reasons.push("LONG_TEXT");
  }

  if (
    text.length >= 30
  ) {
    score += 20;
    reasons.push("VERY_LONG_TEXT");
  }

  if (
    /공지|모집|안내|프로그램|학사|행사|교육|신청|학위|교류|융합|지원/.test(
      text
    )
  ) {
    score += 20;
    reasons.push("CONTENT_WORD");
  }

  if (
    /^상명\s*\[.*\]$/.test(
      text
    )
  ) {
    score -= 100;
    reasons.push("CATEGORY_LABEL");
  }

  if (
    /글로벌|일반|비교과|학사/.test(text)
    &&
    text.length < 15
  ) {
    score -= 50;
    reasons.push("SHORT_CATEGORY");
  }

  return {
    score,
    reasons
  };
}


function inspectLi(raw, index) {
  const anchors =
    extractAnchors(raw)
      .map(
        anchor => ({
          ...anchor,
          scoring:
            scoreAnchor(anchor)
        })
      );

  const rankedAnchors =
    [...anchors]
      .sort(
        (a, b) =>
          b.scoring.score
          -
          a.scoring.score
      );

  return {
    index,

    articleNos:
      extractArticleNos(raw),

    text:
      plain(raw),

    dateCandidates:
      extractDateCandidates(raw),

    anchors,

    rankedAnchors:
      rankedAnchors.slice(0, 8),

    spans:
      extractElements(
        raw,
        "span"
      ),

    divs:
      extractElements(
        raw,
        "div"
      ),

    paragraphs:
      extractElements(
        raw,
        "p"
      ),

    rawSnippet:
      raw
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000)
  };
}


function main() {
  const page =
    curlPage(
      LIST_URL
    );

  if (
    page.status !== 200
  ) {
    throw new Error(
      `HTTP_${page.status}`
    );
  }

  const lis =
    extractLis(
      page.html
    );

  const targets =
    [];

  for (
    let index = 0;
    index < lis.length;
    index += 1
  ) {
    const articleNos =
      extractArticleNos(
        lis[index]
      );

    if (
      articleNos.length === 0
    ) {
      continue;
    }

    targets.push(
      inspectLi(
        lis[index],
        index
      )
    );

    if (
      targets.length
      >= TARGET_LIMIT
    ) {
      break;
    }
  }

  console.log(
    JSON.stringify(
      {
        status:
          page.status,

        finalUrl:
          page.finalUrl,

        totalLi:
          lis.length,

        inspected:
          targets.length,

        items:
          targets
      },
      null,
      2
    )
  );
}


if (
  require.main === module
) {
  main();
}