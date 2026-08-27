"use strict";

const { execFileSync } = require("child_process");

// ============================================================
// 1. 기본 설정
// ============================================================

const LIST_URL =
  "https://scsc.inje.ac.kr/scsc/community/news.do?mode=list";

const MAX_ITEMS =
  20;

// ============================================================
// 2. 공통 유틸
// ============================================================

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return stripTags(value)
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const match =
    String(value || "").match(
      /\b(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/
    );

  if (!match) {
    return null;
  }

  return (
    match[1]
    + "-"
    + String(match[2]).padStart(2, "0")
    + "-"
    + String(match[3]).padStart(2, "0")
  );
}

function extractDates(value) {
  const matches =
    normalizeText(value).match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
    || [];

  return [
    ...new Set(
      matches
        .map(normalizeDate)
        .filter(Boolean)
    )
  ];
}

function extractArticleNo(value) {
  const match =
    String(value || "").match(
      /[?&]articleNo=(\d+)/i
    );

  return match
    ? match[1]
    : null;
}

function buildUrl(href, baseUrl) {
  try {
    return new URL(
      decodeHtml(href),
      baseUrl
    ).href;
  } catch {
    return null;
  }
}

// ============================================================
// 3. 페이지 요청
// ============================================================

function fetchPage(url) {
  try {
    const output =
      execFileSync(
        "curl.exe",
        [
          "-L",
          "--max-redirs",
          "10",
          "--connect-timeout",
          "20",
          "--max-time",
          "40",
          "--silent",
          "--show-error",
          "--compressed",

          "--user-agent",
          "Mozilla/5.0 UNI-PICK Inje Structure Inspector",

          "--header",
          "Accept: text/html,application/xhtml+xml",

          "--header",
          "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

          "--write-out",
          "\n__UNI_STATUS__:%{http_code}\n__UNI_URL__:%{url_effective}",

          url
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 20 * 1024 * 1024
        }
      );

    const statusMatch =
      output.match(
        /\n__UNI_STATUS__:(\d{3})/
      );

    const urlMatch =
      output.match(
        /\n__UNI_URL__:(.+)$/s
      );

    const body =
      output.replace(
        /\n__UNI_STATUS__:\d{3}\n__UNI_URL__:.+$/s,
        ""
      );

    return {
      ok: true,

      status:
        statusMatch
          ? Number(statusMatch[1])
          : 0,

      finalUrl:
        urlMatch
          ? urlMatch[1].trim()
          : url,

      bytes:
        Buffer.byteLength(
          body,
          "utf8"
        ),

      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: null,
      bytes: 0,
      body: "",
      error:
        error?.stderr
          ? String(error.stderr)
          : (
              error?.message
              || String(error)
            )
    };
  }
}

// ============================================================
// 4. Anchor 추출
// ============================================================

function extractAnchors(raw, baseUrl) {
  const anchors = [];

  for (
    const match
    of raw.matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const hrefMatch =
      attrs.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );

    if (!hrefMatch) {
      continue;
    }

    const href =
      decodeHtml(
        hrefMatch[1]
      );

    const url =
      buildUrl(
        href,
        baseUrl
      );

    if (!url) {
      continue;
    }

    const articleNo =
      extractArticleNo(
        url
      );

    anchors.push({
      text:
        normalizeText(
          match[2]
        ),

      href,

      url,

      articleNo
    });
  }

  return anchors;
}

// ============================================================
// 5. 후보 컨테이너 분석
// ============================================================

function analyzeContainer(
  type,
  index,
  raw,
  baseUrl
) {
  const anchors =
    extractAnchors(
      raw,
      baseUrl
    );

  const articleAnchors =
    anchors.filter(
      anchor =>
        anchor.articleNo
    );

  const articleNos =
    [
      ...new Set(
        articleAnchors
          .map(
            anchor =>
              anchor.articleNo
          )
      )
    ];

  if (
    articleNos.length === 0
  ) {
    return null;
  }

  const dates =
    extractDates(
      raw
    );

  return {
    structure:
      type,

    index,

    articleNos,

    text:
      normalizeText(
        raw
      ),

    dates,

    anchors:
      articleAnchors,

    rawSnippet:
      raw
        .replace(/\s+/g, " ")
        .slice(0, 2500)
  };
}

// ============================================================
// 6. 특정 HTML 구조별 검사
// ============================================================

function inspectPattern(
  html,
  baseUrl,
  type,
  regex
) {
  const matches =
    html.match(regex)
    || [];

  const results = [];

  matches.forEach(
    (raw, index) => {
      const analyzed =
        analyzeContainer(
          type,
          index,
          raw,
          baseUrl
        );

      if (analyzed) {
        results.push(
          analyzed
        );
      }
    }
  );

  return {
    total:
      matches.length,

    withArticleNo:
      results.length,

    items:
      results.slice(
        0,
        MAX_ITEMS
      )
  };
}

// ============================================================
// 7. articleNo 주변 원문 추출
// ============================================================

function inspectArticleNoNeighborhood(
  html
) {
  const results = [];

  const regex =
    /articleNo=(\d+)/gi;

  let match;

  while (
    (
      match =
        regex.exec(html)
    )
    &&
    results.length < MAX_ITEMS
  ) {
    const start =
      Math.max(
        0,
        match.index - 900
      );

    const end =
      Math.min(
        html.length,
        match.index + 1800
      );

    const snippet =
      html
        .slice(
          start,
          end
        )
        .replace(/\s+/g, " ");

    results.push({
      articleNo:
        match[1],

      index:
        match.index,

      snippet
    });
  }

  return results;
}

// ============================================================
// 8. 클래스 이름 후보 확인
// ============================================================

function inspectClassNames(html) {
  const counts =
    new Map();

  for (
    const match
    of html.matchAll(
      /\bclass\s*=\s*["']([^"']+)["']/gi
    )
  ) {
    const classes =
      String(
        match[1] || ""
      )
        .split(/\s+/)
        .map(
          value =>
            value.trim()
        )
        .filter(Boolean);

    for (
      const className
      of classes
    ) {
      counts.set(
        className,
        (
          counts.get(
            className
          )
          || 0
        )
        + 1
      );
    }
  }

  return [
    ...counts.entries()
  ]
    .map(
      ([className, count]) => ({
        className,
        count
      })
    )
    .sort(
      (a, b) =>
        b.count
        -
        a.count
    )
    .slice(
      0,
      80
    );
}

// ============================================================
// 9. 메인
// ============================================================

function main() {
  const page =
    fetchPage(
      LIST_URL
    );

  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    console.log(
      JSON.stringify(
        {
          decision:
            "INJE_STRUCTURE_FETCH_FAILED",

          status:
            page.status,

          finalUrl:
            page.finalUrl,

          bytes:
            page.bytes,

          error:
            page.error
            || null
        },
        null,
        2
      )
    );

    process.exitCode =
      2;

    return;
  }

  const tr =
    inspectPattern(
      page.body,
      page.finalUrl,
      "TR",
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    );

  const li =
    inspectPattern(
      page.body,
      page.finalUrl,
      "LI",
      /<li\b[^>]*>[\s\S]*?<\/li>/gi
    );

  const dl =
    inspectPattern(
      page.body,
      page.finalUrl,
      "DL",
      /<dl\b[^>]*>[\s\S]*?<\/dl>/gi
    );

  const div =
    inspectPattern(
      page.body,
      page.finalUrl,
      "DIV",
      /<div\b[^>]*>[\s\S]*?<\/div>/gi
    );

  const article =
    inspectPattern(
      page.body,
      page.finalUrl,
      "ARTICLE",
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    );

  const tbody =
    inspectPattern(
      page.body,
      page.finalUrl,
      "TBODY",
      /<tbody\b[^>]*>[\s\S]*?<\/tbody>/gi
    );

  const table =
    inspectPattern(
      page.body,
      page.finalUrl,
      "TABLE",
      /<table\b[^>]*>[\s\S]*?<\/table>/gi
    );

  const section =
    inspectPattern(
      page.body,
      page.finalUrl,
      "SECTION",
      /<section\b[^>]*>[\s\S]*?<\/section>/gi
    );

  const articleNoMatches =
    [
      ...page.body.matchAll(
        /articleNo=(\d+)/gi
      )
    ];

  const articleNos =
    [
      ...new Set(
        articleNoMatches
          .map(
            match =>
              match[1]
          )
      )
    ];

  const result = {
    decision:
      "INJE_SHARED_SOURCE_STRUCTURE_INSPECTED",

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    articleNoOccurrences:
      articleNoMatches.length,

    uniqueArticleNos:
      articleNos.length,

    articleNoSamples:
      articleNos.slice(
        0,
        20
      ),

    structures: {
      TR: {
        total:
          tr.total,

        withArticleNo:
          tr.withArticleNo
      },

      LI: {
        total:
          li.total,

        withArticleNo:
          li.withArticleNo
      },

      DL: {
        total:
          dl.total,

        withArticleNo:
          dl.withArticleNo
      },

      DIV: {
        total:
          div.total,

        withArticleNo:
          div.withArticleNo
      },

      ARTICLE: {
        total:
          article.total,

        withArticleNo:
          article.withArticleNo
      },

      TBODY: {
        total:
          tbody.total,

        withArticleNo:
          tbody.withArticleNo
      },

      TABLE: {
        total:
          table.total,

        withArticleNo:
          table.withArticleNo
      },

      SECTION: {
        total:
          section.total,

        withArticleNo:
          section.withArticleNo
      }
    },

    samples: {
      TR:
        tr.items.slice(
          0,
          5
        ),

      LI:
        li.items.slice(
          0,
          5
        ),

      DL:
        dl.items.slice(
          0,
          5
        ),

      DIV:
        div.items.slice(
          0,
          5
        ),

      TBODY:
        tbody.items.slice(
          0,
          3
        ),

      TABLE:
        table.items.slice(
          0,
          3
        )
    },

    articleNoNeighborhood:
      inspectArticleNoNeighborhood(
        page.body
      ).slice(
        0,
        10
      ),

    topClasses:
      inspectClassNames(
        page.body
      ),

    nextAction:
      "REFINE_INJE_SHARED_SOURCE_ITEM_SELECTOR",

    safety: {
      readOnly:
        true,

      automaticActivation:
        false,

      sourceModified:
        false,

      catalogModified:
        false,

      storeModified:
        false,

      previewModified:
        false,

      queueModified:
        false,

      gitTriggered:
        false,

      deploymentTriggered:
        false
    }
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

main();