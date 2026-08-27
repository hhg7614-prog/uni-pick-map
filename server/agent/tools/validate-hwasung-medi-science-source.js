"use strict";

/**
 * UNI PICK - Hwasung Medi-Science University Deep Source Validator v1
 *
 * 대상:
 * 화성의과학대학교 공지사항
 *
 * 후보:
 * https://www.hsmu.ac.kr/web/contents/HSMU40101000.do
 *
 * 목적:
 * ---------------------------------------------------------
 * 일반 <a href> 탐색으로 상세 URL을 찾지 못한 페이지를
 * 더 깊게 분석한다.
 *
 * 분석 대상:
 * - 일반 anchor href
 * - onclick
 * - javascript: URL
 * - data-* 속성
 * - hidden input
 * - form action
 * - JavaScript 함수 호출
 * - AJAX / fetch / XMLHttpRequest 흔적
 * - 게시판 ID / article ID / seq / idx / no
 * - 반복되는 table/list/card 구조
 *
 * 이후 가능한 상세 URL 후보를 생성하고
 * 3~5건을 직접 검증한다.
 *
 * 안전:
 * ---------------------------------------------------------
 * - source catalog 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 *
 * 권장 실행:
 * ---------------------------------------------------------
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\validate-hwasung-medi-science-source.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(
  __dirname,
  "../../.."
);

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-source-validation.json"
);

const LIST_URL =
  "https://www.hsmu.ac.kr/web/contents/HSMU40101000.do";

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const MAX_DETAIL_TESTS = 5;

const REQUEST_TIMEOUT_MS = 20000;


/* =========================================================
 * 운영 파일 보호
 * ========================================================= */

const OPERATIONAL_FILES = [
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-sources.final.json"
  ),

  path.join(
    ROOT,
    "server",
    "agent",
    "data",
    "agent-news-store.json"
  ),

  path.join(
    ROOT,
    "data",
    "university-news-preview.json"
  )
];


/* =========================================================
 * Utilities
 * ========================================================= */

function read(file, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}


function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  const temporary =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      temporary,
      "utf8"
    )
  );

  fs.renameSync(
    temporary,
    file
  );
}


function plain(value) {
  return String(value || "")
    .replace(
      /<script\b[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /&nbsp;|&#160;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  let text =
    String(value)
      .trim()
      .replace(
        /&amp;/gi,
        "&"
      )
      .replace(
        /\\&/g,
        "&"
      );

  if (
    /^javascript:/i.test(
      text
    )
  ) {
    return null;
  }

  try {
    const url =
      new URL(
        text,
        base
      );

    url.hash = "";

    if (
      !/^https?:$/.test(
        url.protocol
      )
    ) {
      return null;
    }

    return url.href;

  } catch {
    return null;
  }
}


function officialDomain(url) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    return (
      host === "hsmu.ac.kr"
      ||
      host.endsWith(
        ".hsmu.ac.kr"
      )
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * Hash
 * ========================================================= */

function sha256(file) {
  if (
    !fs.existsSync(
      file
    )
  ) {
    return null;
  }

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(
        file
      )
    )
    .digest(
      "hex"
    );
}


function operationalHashes() {
  return Object.fromEntries(
    OPERATIONAL_FILES.map(
      file => [
        path.relative(
          ROOT,
          file
        ),
        sha256(file)
      ]
    )
  );
}


/* =========================================================
 * HTTP
 * ========================================================= */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK HSMU Deep Validator",

            "Accept":
              "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "ko-KR,ko;q=0.9,en;q=0.8"
          }
        }
      );

    const body =
      await response.text();

    return {
      ok:
        true,

      status:
        response.status,

      finalUrl:
        response.url,

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

      bytes:
        Buffer.byteLength(
          body,
          "utf8"
        ),

      body
    };

  } catch (error) {
    return {
      ok:
        false,

      status:
        null,

      finalUrl:
        null,

      contentType:
        "",

      bytes:
        0,

      body:
        "",

      error: {
        name:
          error?.name || null,

        message:
          error?.message || null,

        causeCode:
          error?.cause?.code || null,

        causeMessage:
          error?.cause?.message || null
      }
    };

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
 * 날짜
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(
      value
    );

  let match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (match) {
    const y =
      Number(match[1]);

    const m =
      Number(match[2]);

    const d =
      Number(match[3]);

    if (
      m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      d <= 31
    ) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  match =
    text.match(
      /(?:^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\D|$)/
    );

  if (match) {
    const y =
      2000
      +
      Number(match[1]);

    const m =
      Number(match[2]);

    const d =
      Number(match[3]);

    if (
      m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      d <= 31
    ) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return null;
}


/* =========================================================
 * Anchor 분석
 * ========================================================= */

function extractAnchors(
  html,
  baseUrl
) {
  const output = [];

  const matcher =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (
      match =
        matcher.exec(
          html
        )
    )
  ) {
    const attrs =
      match[1] || "";

    const body =
      match[2] || "";

    const hrefMatch =
      attrs.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );

    const onclickMatch =
      attrs.match(
        /\bonclick\s*=\s*["']([^"']+)["']/i
      );

    const url =
      hrefMatch
        ? normalizeUrl(
            hrefMatch[1],
            baseUrl
          )
        : null;

    output.push({
      label:
        plain(body),

      href:
        hrefMatch
          ? hrefMatch[1]
          : null,

      url,

      onclick:
        onclickMatch
          ? onclickMatch[1]
          : null,

      attrs
    });
  }

  return output;
}


/* =========================================================
 * onclick / JS 호출 분석
 * ========================================================= */

function extractJsCalls(html) {
  const calls = [];

  const patterns = [
    /onclick\s*=\s*["']([^"']+)["']/gi,
    /href\s*=\s*["']javascript:([^"']+)["']/gi
  ];

  for (
    const pattern
    of patterns
  ) {
    let match;

    while (
      (
        match =
          pattern.exec(
            html
          )
      )
    ) {
      calls.push(
        plain(
          match[1]
        )
      );
    }
  }

  return [
    ...new Set(
      calls
    )
  ];
}


/* =========================================================
 * data-* 속성 분석
 * ========================================================= */

function extractDataAttributes(html) {
  const rows = [];

  const matcher =
    /<([a-z0-9]+)\b([^>]*)>/gi;

  let match;

  while (
    (
      match =
        matcher.exec(
          html
        )
    )
  ) {
    const tag =
      match[1];

    const attrs =
      match[2] || "";

    const dataMatches =
      [
        ...attrs.matchAll(
          /\b(data-[a-z0-9_-]+)\s*=\s*["']([^"']*)["']/gi
        )
      ];

    if (
      dataMatches.length === 0
    ) {
      continue;
    }

    const data = {};

    for (
      const item
      of dataMatches
    ) {
      data[
        item[1]
      ] =
        item[2];
    }

    rows.push({
      tag,
      data,
      raw:
        attrs.slice(
          0,
          1000
        )
    });
  }

  return rows;
}


/* =========================================================
 * Hidden input / forms
 * ========================================================= */

function extractForms(html, baseUrl) {
  const forms = [];

  const matcher =
    /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;

  let match;

  while (
    (
      match =
        matcher.exec(
          html
        )
    )
  ) {
    const attrs =
      match[1] || "";

    const body =
      match[2] || "";

    const actionMatch =
      attrs.match(
        /\baction\s*=\s*["']([^"']+)["']/i
      );

    const methodMatch =
      attrs.match(
        /\bmethod\s*=\s*["']([^"']+)["']/i
      );

    const hidden = {};

    for (
      const input
      of body.matchAll(
        /<input\b([^>]*)>/gi
      )
    ) {
      const inputAttrs =
        input[1] || "";

      const type =
        (
          inputAttrs.match(
            /\btype\s*=\s*["']([^"']+)["']/i
          )
          || []
        )[1];

      if (
        String(type || "")
          .toLowerCase()
        !== "hidden"
      ) {
        continue;
      }

      const name =
        (
          inputAttrs.match(
            /\bname\s*=\s*["']([^"']+)["']/i
          )
          || []
        )[1];

      const value =
        (
          inputAttrs.match(
            /\bvalue\s*=\s*["']([^"']*)["']/i
          )
          || []
        )[1];

      if (name) {
        hidden[name] =
          value || "";
      }
    }

    forms.push({
      action:
        actionMatch
          ? normalizeUrl(
              actionMatch[1],
              baseUrl
            )
          : baseUrl,

      method:
        methodMatch
          ? methodMatch[1]
            .toUpperCase()
          : "GET",

      hidden
    });
  }

  return forms;
}


/* =========================================================
 * JS / AJAX endpoint 힌트
 * ========================================================= */

function extractEndpointHints(
  html,
  baseUrl
) {
  const hints = [];

  const patterns = [
    /fetch\s*\(\s*["']([^"']+)["']/gi,

    /\$\.ajax\s*\(\s*\{[\s\S]{0,500}?url\s*:\s*["']([^"']+)["']/gi,

    /\$\.get\s*\(\s*["']([^"']+)["']/gi,

    /\$\.post\s*\(\s*["']([^"']+)["']/gi,

    /XMLHttpRequest[\s\S]{0,1000}?open\s*\(\s*["'][A-Z]+["']\s*,\s*["']([^"']+)["']/gi,

    /url\s*:\s*["']([^"']+\.(?:do|json|ajax|jsp|php)[^"']*)["']/gi
  ];

  for (
    const pattern
    of patterns
  ) {
    let match;

    while (
      (
        match =
          pattern.exec(
            html
          )
      )
    ) {
      const normalized =
        normalizeUrl(
          match[1],
          baseUrl
        );

      if (
        normalized
        &&
        officialDomain(
          normalized
        )
      ) {
        hints.push(
          normalized
        );
      }
    }
  }

  return [
    ...new Set(
      hints
    )
  ];
}


/* =========================================================
 * 게시물 ID 후보 추출
 * ========================================================= */

function extractNumericCandidates(html) {
  const candidates = [];

  const patterns = [
    /\b(?:articleNo|article_no|boardNo|board_no|bbsNo|bbs_no|idx|seq|nttId|nttSeq|postNo|post_no|no)\b\s*[:=]\s*["']?(\d{2,})/gi,

    /\b(?:view|detail|read)\s*\(\s*["']?(\d{2,})["']?\s*\)/gi,

    /onclick\s*=\s*["'][^"']*?\(\s*["']?(\d{2,})["']?/gi,

    /data-(?:id|no|seq|idx|article|article-no|board-no)\s*=\s*["'](\d{2,})["']/gi
  ];

  for (
    const pattern
    of patterns
  ) {
    let match;

    while (
      (
        match =
          pattern.exec(
            html
          )
      )
    ) {
      candidates.push(
        match[1]
      );
    }
  }

  return [
    ...new Set(
      candidates
    )
  ].slice(
    0,
    100
  );
}


/* =========================================================
 * 반복 Row/Card 탐지
 * ========================================================= */

function extractContainers(html) {
  const output = [];

  const patterns = [
    {
      type:
        "TR",

      regex:
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    },

    {
      type:
        "LI",

      regex:
        /<li\b[^>]*>[\s\S]*?<\/li>/gi
    },

    {
      type:
        "ARTICLE",

      regex:
        /<article\b[^>]*>[\s\S]*?<\/article>/gi
    }
  ];

  for (
    const config
    of patterns
  ) {
    const matches =
      html.match(
        config.regex
      ) || [];

    for (
      const raw
      of matches
    ) {
      const text =
        plain(
          raw
        );

      if (
        text.length < 5
      ) {
        continue;
      }

      const date =
        parseDate(
          text
        );

      const anchors =
        extractAnchors(
          raw,
          LIST_URL
        );

      const jsCalls =
        extractJsCalls(
          raw
        );

      output.push({
        type:
          config.type,

        text:
          text.slice(
            0,
            1000
          ),

        date,

        anchors,

        jsCalls,

        raw:
          raw.slice(
            0,
            5000
          )
      });
    }
  }

  return output;
}


/* =========================================================
 * 정적 상세 URL 판정
 * ========================================================= */

function looksLikeDetailUrl(url) {
  if (
    !url
    ||
    !officialDomain(
      url
    )
  ) {
    return false;
  }

  try {
    const parsed =
      new URL(
        url
      );

    const joined =
      `${parsed.pathname}${parsed.search}`;

    if (
      /download|file|attach/i.test(
        joined
      )
    ) {
      return false;
    }

    return (
      /view|detail|read/i.test(
        joined
      )
      ||
      /(?:idx|seq|no|article|board|bbs|ntt)[^=]*=\d+/i.test(
        joined
      )
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * 상세 URL 후보 생성
 * ========================================================= */

function generateDetailCandidates({
  anchors,
  jsCalls,
  dataAttributes,
  numericIds,
  forms,
  endpointHints
}) {
  const candidates = [];

  /*
   * 1. 정적 anchor
   */

  for (
    const anchor
    of anchors
  ) {
    if (
      anchor.url
      &&
      looksLikeDetailUrl(
        anchor.url
      )
    ) {
      candidates.push({
        url:
          anchor.url,

        title:
          anchor.label || null,

        method:
          "STATIC_ANCHOR",

        confidence:
          90
      });
    }
  }


  /*
   * 2. onclick 안에 직접 URL이 있는 경우
   */

  for (
    const call
    of jsCalls
  ) {
    const directUrls =
      [
        ...call.matchAll(
          /["']([^"']+\.(?:do|jsp|php)(?:\?[^"']*)?)["']/gi
        )
      ];

    for (
      const match
      of directUrls
    ) {
      const url =
        normalizeUrl(
          match[1],
          LIST_URL
        );

      if (
        url
        &&
        officialDomain(
          url
        )
      ) {
        candidates.push({
          url,

          title:
            null,

          method:
            "JS_DIRECT_URL",

          confidence:
            80
        });
      }
    }
  }


  /*
   * 3. data-* 내부 URL
   */

  for (
    const entry
    of dataAttributes
  ) {
    for (
      const value
      of Object.values(
        entry.data
      )
    ) {
      if (
        !/\/|\.do|\.jsp|https?:/i.test(
          value
        )
      ) {
        continue;
      }

      const url =
        normalizeUrl(
          value,
          LIST_URL
        );

      if (
        url
        &&
        officialDomain(
          url
        )
      ) {
        candidates.push({
          url,

          title:
            null,

          method:
            "DATA_ATTRIBUTE_URL",

          confidence:
            75
        });
      }
    }
  }


  /*
   * 4. Endpoint hint 자체가 게시판 API/목록일 수 있음
   */

  for (
    const endpoint
    of endpointHints
  ) {
    candidates.push({
      url:
        endpoint,

      title:
        null,

      method:
        "ENDPOINT_HINT",

      confidence:
        45
    });
  }


  /*
   * 5. 숫자 ID + form/action 조합
   *
   * 확실한 parameter 이름을 모르면 자동 활성화는 금지하고
   * 진단용 후보만 생성한다.
   */

  const parameterNames = [
    "idx",
    "seq",
    "no",
    "boardNo",
    "bbsNo",
    "articleNo",
    "nttId"
  ];

  for (
    const form
    of forms
  ) {
    if (
      !form.action
      ||
      !officialDomain(
        form.action
      )
    ) {
      continue;
    }

    for (
      const id
      of numericIds.slice(
        0,
        10
      )
    ) {
      for (
        const parameter
        of parameterNames
      ) {
        try {
          const url =
            new URL(
              form.action
            );

          url.searchParams.set(
            parameter,
            id
          );

          candidates.push({
            url:
              url.href,

            title:
              null,

            method:
              `FORM_GUESS:${parameter}`,

            confidence:
              20
          });

        } catch {
          // ignore
        }
      }
    }
  }


  const bestByUrl =
    new Map();

  for (
    const candidate
    of candidates
  ) {
    const existing =
      bestByUrl.get(
        candidate.url
      );

    if (
      !existing
      ||
      candidate.confidence
      >
      existing.confidence
    ) {
      bestByUrl.set(
        candidate.url,
        candidate
      );
    }
  }

  return [
    ...bestByUrl.values()
  ]
    .sort(
      (a, b) =>
        b.confidence
        -
        a.confidence
    )
    .slice(
      0,
      30
    );
}


/* =========================================================
 * 상세 제목
 * ========================================================= */

function extractTitleCandidates(html) {
  const candidates = [];

  const patterns = [
    [
      "OG_TITLE",
      /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i
    ],

    [
      "H1",
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
    ],

    [
      "H2",
      /<h2\b[^>]*>([\s\S]*?)<\/h2>/i
    ],

    [
      "H3",
      /<h3\b[^>]*>([\s\S]*?)<\/h3>/i
    ],

    [
      "TITLE",
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    ]
  ];

  for (
    const [method, pattern]
    of patterns
  ) {
    const match =
      html.match(
        pattern
      );

    if (
      match
      &&
      plain(
        match[1]
      )
    ) {
      candidates.push({
        method,

        title:
          plain(
            match[1]
          )
      });
    }
  }

  return candidates;
}


/* =========================================================
 * 상세 날짜
 * ========================================================= */

function extractDates(html) {
  const visible =
    plain(
      html
    );

  const rawDates = [
    ...(
      visible.match(
        /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
      )
      || []
    ),

    ...(
      visible.match(
        /(?:^|\D)\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\D|$)/g
      )
      || []
    )
  ];

  const results = [];

  for (
    const raw
    of rawDates
  ) {
    const publishedAt =
      parseDate(
        raw
      );

    if (
      publishedAt
      &&
      !results.some(
        item =>
          item.publishedAt
          === publishedAt
      )
    ) {
      results.push({
        raw:
          plain(
            raw
          ),

        publishedAt
      });
    }
  }

  return results.slice(
    0,
    20
  );
}


/* =========================================================
 * 상세 후보 실제 검증
 * ========================================================= */

async function validateCandidate(candidate) {
  const page =
    await fetchPage(
      candidate.url
    );

  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    return {
      ...candidate,

      status:
        page.status,

      finalUrl:
        page.finalUrl,

      officialDomain:
        false,

      title:
        null,

      titleMethod:
        null,

      dates:
        [],

      bodyLength:
        0,

      decision:
        "FAIL",

      reasons: [
        "UNREACHABLE"
      ],

      error:
        page.error || null
    };
  }


  const reasons = [];

  const isOfficial =
    officialDomain(
      page.finalUrl
    );


  if (!isOfficial) {
    reasons.push(
      "NON_OFFICIAL_DOMAIN"
    );
  }


  const titles =
    extractTitleCandidates(
      page.body
    );


  const bestTitle =
    titles[0]
    || null;


  if (!bestTitle) {
    reasons.push(
      "TITLE_NOT_FOUND"
    );
  }


  const dates =
    extractDates(
      page.body
    );


  if (
    dates.length === 0
  ) {
    reasons.push(
      "DATE_NOT_FOUND"
    );
  }


  const bodyLength =
    plain(
      page.body
    ).length;


  if (
    bodyLength < 100
  ) {
    reasons.push(
      "BODY_TOO_SHORT"
    );
  }


  /*
   * 목록 페이지와 똑같은 페이지가 다시 열린 경우 방지
   */

  const sameAsList =
    normalizeUrl(
      page.finalUrl
    )
    ===
    normalizeUrl(
      LIST_URL
    );


  if (sameAsList) {
    reasons.push(
      "SAME_AS_LIST"
    );
  }


  let decision =
    "PASS";


  if (
    reasons.length > 0
  ) {
    decision =
      (
        isOfficial
        &&
        bestTitle
      )
        ? "WARN"
        : "FAIL";
  }


  return {
    ...candidate,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    contentType:
      page.contentType,

    bytes:
      page.bytes,

    officialDomain:
      isOfficial,

    title:
      bestTitle?.title
      || null,

    titleMethod:
      bestTitle?.method
      || null,

    dates,

    bodyLength,

    sameAsList,

    decision,

    reasons
  };
}


/* =========================================================
 * 안정성 판단
 * ========================================================= */

function analyzeStablePattern(validated) {
  const useful =
    validated.filter(
      item =>
        item.decision
        !== "FAIL"
        &&
        item.finalUrl
    );


  const methods = {};

  for (
    const item
    of useful
  ) {
    methods[
      item.method
    ] =
      (
        methods[
          item.method
        ]
        || 0
      )
      + 1;
  }


  const methodEntries =
    Object.entries(
      methods
    )
      .sort(
        (a, b) =>
          b[1]
          -
          a[1]
      );


  const stableMethod =
    methodEntries[0]
    || null;


  /*
   * URL path 형태 안정성
   */

  const pathPatterns = {};

  for (
    const item
    of useful
  ) {
    try {
      const parsed =
        new URL(
          item.finalUrl
        );

      const key =
        parsed.pathname;

      pathPatterns[key] =
        (
          pathPatterns[key]
          || 0
        )
        + 1;

    } catch {
      // ignore
    }
  }


  const stablePath =
    Object.entries(
      pathPatterns
    )
      .sort(
        (a, b) =>
          b[1]
          -
          a[1]
      )[0]
      || null;


  const stable =
    useful.length >= 3
    &&
    stableMethod
    &&
    stableMethod[1] >= 3;


  return {
    stable,

    usefulCount:
      useful.length,

    stableMethod:
      stableMethod
        ? {
            method:
              stableMethod[0],

            count:
              stableMethod[1]
          }
        : null,

    stablePath:
      stablePath
        ? {
            pathname:
              stablePath[0],

            count:
              stablePath[1]
          }
        : null,

    methodCounts:
      methods
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const beforeHashes =
    operationalHashes();


  let requestCount = 0;


  requestCount += 1;


  const list =
    await fetchPage(
      LIST_URL
    );


  if (
    !list.ok
    ||
    list.status !== 200
  ) {
    throw new Error(
      "HSMU_LIST_UNREACHABLE"
    );
  }


  if (
    !officialDomain(
      list.finalUrl
    )
  ) {
    throw new Error(
      "HSMU_LIST_NON_OFFICIAL_DOMAIN"
    );
  }


  /*
   * Deep analysis
   */

  const anchors =
    extractAnchors(
      list.body,
      list.finalUrl
    );


  const jsCalls =
    extractJsCalls(
      list.body
    );


  const dataAttributes =
    extractDataAttributes(
      list.body
    );


  const forms =
    extractForms(
      list.body,
      list.finalUrl
    );


  const endpointHints =
    extractEndpointHints(
      list.body,
      list.finalUrl
    );


  const numericIds =
    extractNumericCandidates(
      list.body
    );


  const containers =
    extractContainers(
      list.body
    );


  /*
   * 반복 컨테이너 안에서 날짜+JS 호출이 같이 있는 경우
   */

  const interestingContainers =
    containers
      .filter(
        item =>
          item.date
          ||
          item.jsCalls.length > 0
          ||
          item.anchors.some(
            anchor =>
              anchor.url
              &&
              looksLikeDetailUrl(
                anchor.url
              )
          )
      )
      .slice(
        0,
        30
      );


  const generatedCandidates =
    generateDetailCandidates({
      anchors,
      jsCalls,
      dataAttributes,
      numericIds,
      forms,
      endpointHints
    });


  /*
   * 확신도 높은 것부터 최대 5개 직접 요청
   */

  const toValidate =
    generatedCandidates
      .filter(
        item =>
          item.confidence >= 40
      )
      .slice(
        0,
        MAX_DETAIL_TESTS
      );


  const validated = [];


  for (
    const candidate
    of toValidate
  ) {
    requestCount += 1;

    validated.push(
      await validateCandidate(
        candidate
      )
    );
  }


  const pass =
    validated.filter(
      item =>
        item.decision
        === "PASS"
    ).length;


  const warn =
    validated.filter(
      item =>
        item.decision
        === "WARN"
    ).length;


  const fail =
    validated.filter(
      item =>
        item.decision
        === "FAIL"
    ).length;


  const stablePattern =
    analyzeStablePattern(
      validated
    );


  /*
   * 상태 판정
   */

  let decision =
    "DEEP_DISCOVERY_REQUIRED";


  if (
    pass >= 3
    &&
    stablePattern.stable
  ) {
    decision =
      "VALIDATED_CANDIDATE";
  }

  else if (
    pass + warn >= 2
  ) {
    decision =
      "REVIEW_REQUIRED";
  }

  else if (
    generatedCandidates.length === 0
  ) {
    decision =
      "JS_OR_API_DISCOVERY_REQUIRED";
  }


  /*
   * Source 제안
   *
   * 실제 selector/URL rule이 충분히 안정적일 때만 생성
   */

  const proposedSource =
    decision
      === "VALIDATED_CANDIDATE"
      ? {
          id:
            "hwasung-medi-science-general-notice",

          name:
            "화성의과학대학교 공지사항",

          category:
            "school_notice",

          sourceType:
            "official",

          collectionType:
            "custom_html_or_url_rule",

          listUrl:
            LIST_URL,

          detailDiscoveryMethod:
            stablePattern
              .stableMethod
              ?.method
              || null,

          detailPath:
            stablePattern
              .stablePath
              ?.pathname
              || null,

          verified:
            false,

          enabled:
            false,

          status:
            "validation_passed_pending_collector_config",

          autoActivate:
            false
        }
      : null;


  const afterHashes =
    operationalHashes();


  const hashSafe =
    JSON.stringify(
      beforeHashes
    )
    ===
    JSON.stringify(
      afterHashes
    );


  if (!hashSafe) {
    throw new Error(
      "OPERATIONAL_FILE_MUTATION_DETECTED"
    );
  }


  let nextAction =
    "ANALYZE_JS_API_STRUCTURE";


  if (
    decision
    === "VALIDATED_CANDIDATE"
  ) {
    nextAction =
      "BUILD_COLLECTOR_CONFIG";
  }

  else if (
    decision
    === "REVIEW_REQUIRED"
  ) {
    nextAction =
      "REFINE_DETAIL_URL_RULE";
  }

  else if (
    decision
    === "JS_OR_API_DISCOVERY_REQUIRED"
  ) {
    nextAction =
      "TRACE_BOARD_API_OR_JS_FUNCTION";
  }


  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    listUrl:
      LIST_URL,

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      bytes:
        list.bytes,

      contentType:
        list.contentType,

      officialDomain:
        true
    },

    deepAnalysis: {
      anchorCount:
        anchors.length,

      staticOfficialLinks:
        anchors.filter(
          item =>
            item.url
            &&
            officialDomain(
              item.url
            )
        ).length,

      jsCallCount:
        jsCalls.length,

      jsCallSamples:
        jsCalls.slice(
          0,
          30
        ),

      dataAttributeCount:
        dataAttributes.length,

      dataAttributeSamples:
        dataAttributes.slice(
          0,
          20
        ),

      formCount:
        forms.length,

      forms,

      endpointHintCount:
        endpointHints.length,

      endpointHints,

      numericIdCount:
        numericIds.length,

      numericIds:
        numericIds.slice(
          0,
          50
        ),

      containerCount:
        containers.length,

      interestingContainerCount:
        interestingContainers.length,

      interestingContainers
    },

    generatedDetailCandidateCount:
      generatedCandidates.length,

    generatedDetailCandidates:
      generatedCandidates,

    testedDetailCount:
      validated.length,

    pass,

    warn,

    fail,

    validatedDetails:
      validated,

    urlConstructionStable:
      stablePattern.stable,

    stablePattern,

    decision,

    proposedSource,

    nextAction,

    requestCount,

    operationalHashUnchanged:
      hashSafe,

    beforeHashes,

    afterHashes,

    safety: {
      readOnly:
        true,

      sourceModified:
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
        false,

      tlsVerificationDisabled:
        false
    }
  };


  atomic(
    OUTPUT_FILE,
    report
  );


  console.log(
    JSON.stringify(
      {
        decision:
          report.decision,

        status:
          report.list.status,

        anchors:
          report.deepAnalysis
            .anchorCount,

        jsCalls:
          report.deepAnalysis
            .jsCallCount,

        dataAttributes:
          report.deepAnalysis
            .dataAttributeCount,

        forms:
          report.deepAnalysis
            .formCount,

        endpointHints:
          report.deepAnalysis
            .endpointHintCount,

        numericIds:
          report.deepAnalysis
            .numericIdCount,

        interestingContainers:
          report.deepAnalysis
            .interestingContainerCount,

        generatedCandidates:
          report.generatedDetailCandidateCount,

        tested:
          report.testedDetailCount,

        pass:
          report.pass,

        warn:
          report.warn,

        fail:
          report.fail,

        urlConstructionStable:
          report.urlConstructionStable,

        stablePattern:
          report.stablePattern,

        proposedSource:
          report.proposedSource,

        nextAction:
          report.nextAction,

        requests:
          report.requestCount,

        hashSafe:
          report.operationalHashUnchanged
      },
      null,
      2
    )
  );
}


/* =========================================================
 * Execute
 * ========================================================= */

if (
  require.main
  === module
) {
  main().catch(
    error => {
      console.error(
        error.stack
        ||
        error.message
      );

      process.exitCode =
        1;
    }
  );
}


/* =========================================================
 * Export
 * ========================================================= */

module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  parseDate,
  extractAnchors,
  extractJsCalls,
  extractDataAttributes,
  extractForms,
  extractEndpointHints,
  extractNumericCandidates,
  extractContainers,
  looksLikeDetailUrl,
  generateDetailCandidates,
  extractTitleCandidates,
  extractDates,
  validateCandidate,
  analyzeStablePattern
};