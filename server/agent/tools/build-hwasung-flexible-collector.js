"use strict";

/**
 * UNI PICK - HSMU Flexible Collector Builder v1
 *
 * 목적
 * ---------------------------------------------------------
 * FLEXIBLE_SOURCE_VALIDATED 상태의
 * 화성의과학대학교 이사회 회의공지를
 * 실제 collector-ready 형태로 변환한다.
 *
 * 현재 확인된 구조
 * ---------------------------------------------------------
 * list:
 * https://www.hsmu.ac.kr/web/contents/HSMU10102000.do
 *
 * row:
 * TR
 *
 * detail:
 * onclick 또는 data 내부 숫자 ID
 *
 * 샘플:
 * ID:3441
 * ID:3181
 * ID:2853
 *
 * 목표
 * ---------------------------------------------------------
 * 1. TR 게시물 추출
 * 2. 제목 추출
 * 3. 날짜 추출
 * 4. 상세 ID 추출
 * 5. onclick 원문 분석
 * 6. 같은 함수/인자 규칙 안정성 검증
 * 7. 상세 URL 생성 규칙이 있으면 실제 3~5건 검증
 * 8. collector config 생성
 *
 * 안전
 * ---------------------------------------------------------
 * - catalog 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
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

const VALIDATION_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-source-validation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-collector.json"
);

const LIST_URL =
  "https://www.hsmu.ac.kr/web/contents/HSMU10102000.do";

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const SOURCE_ID =
  "hwasung-medi-science-general-feed";

const REQUEST_TIMEOUT_MS = 20000;

const MAX_DETAIL_TESTS = 5;


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

  const tmp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      tmp,
      "utf8"
    )
  );

  fs.renameSync(
    tmp,
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
  if (!fs.existsSync(file)) {
    return null;
  }

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(file)
    )
    .digest("hex");
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
              "Mozilla/5.0 compatible UNI-PICK HSMU Flexible Collector Builder",

            "Accept":
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "ko-KR,ko;q=0.9,en;q=0.8"
          }
        }
      );

    const html =
      await response.text();

    return {
      ok:
        true,

      status:
        response.status,

      finalUrl:
        response.url,

      bytes:
        Buffer.byteLength(
          html,
          "utf8"
        ),

      html
    };

  } catch (error) {
    return {
      ok:
        false,

      status:
        null,

      finalUrl:
        null,

      bytes:
        0,

      html:
        "",

      error: {
        name:
          error?.name || null,

        message:
          error?.message || null,

        causeCode:
          error?.cause?.code || null
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
    plain(value);

  const match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  if (
    month < 1
    ||
    month > 12
    ||
    day < 1
    ||
    day > 31
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


/* =========================================================
 * TR
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


/* =========================================================
 * Anchor
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

    const href =
      (
        attrs.match(
          /\bhref\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const onclick =
      (
        attrs.match(
          /\bonclick\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const title =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    output.push({
      label:
        plain(body),

      title,

      href,

      url:
        href
          ? normalizeUrl(
              href,
              baseUrl
            )
          : null,

      onclick
    });
  }

  return output;
}


/* =========================================================
 * ID
 * ========================================================= */

function extractNumericIds(value) {
  const text =
    String(value || "");

  const output = [];

  const patterns = [
    /\b(?:idx|seq|no|articleNo|boardNo|bbsNo|nttId|nttSeq)\b\s*[:=]\s*["']?(\d{2,})/gi,

    /\(\s*["']?(\d{2,})["']?\s*\)/g,

    /data-(?:id|idx|seq|no|article|board|bbs|ntt)[^=]*=\s*["'](\d{2,})["']/gi
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
            text
          )
      )
    ) {
      output.push(
        match[1]
      );
    }
  }

  return [
    ...new Set(
      output
    )
  ];
}


/* =========================================================
 * onclick 함수 분석
 * ========================================================= */

function parseOnclick(onclick) {
  if (!onclick) {
    return null;
  }

  const text =
    String(onclick)
      .trim();

  const match =
    text.match(
      /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*;?$/
    );

  if (!match) {
    return {
      raw:
        text,

      functionName:
        null,

      args:
        [],

      numericArgs:
        extractNumericIds(
          text
        )
    };
  }

  const args =
    splitArgs(
      match[2]
    );

  return {
    raw:
      text,

    functionName:
      match[1],

    args,

    numericArgs:
      args.filter(
        value =>
          /^\d+$/.test(
            String(value)
          )
      )
  };
}


function splitArgs(value) {
  const text =
    String(value || "");

  const output = [];

  let current = "";
  let quote = null;

  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {
    const char =
      text[i];

    if (quote) {
      if (
        char === quote
      ) {
        quote = null;
      }

      current += char;

      continue;
    }

    if (
      char === "'"
      ||
      char === "\""
    ) {
      quote = char;

      current += char;

      continue;
    }

    if (
      char === ","
    ) {
      output.push(
        cleanArg(
          current
        )
      );

      current = "";

      continue;
    }

    current += char;
  }

  if (
    current.trim()
  ) {
    output.push(
      cleanArg(
        current
      )
    );
  }

  return output;
}


function cleanArg(value) {
  let text =
    String(value || "")
      .trim();

  if (
    (
      text.startsWith("'")
      &&
      text.endsWith("'")
    )
    ||
    (
      text.startsWith("\"")
      &&
      text.endsWith("\"")
    )
  ) {
    text =
      text.slice(
        1,
        -1
      );
  }

  return text;
}


/* =========================================================
 * 게시물 row 분석
 * ========================================================= */

function analyzeRow(
  raw,
  baseUrl
) {
  const text =
    plain(raw);

  const date =
    parseDate(
      text
    );

  if (!date) {
    return null;
  }

  const anchors =
    extractAnchors(
      raw,
      baseUrl
    );

  const candidates =
    anchors
      .filter(
        item =>
          (
            item.title
            ||
            item.label
          )
          &&
          (
            item.onclick
            ||
            item.url
          )
      )
      .map(
        item => ({
          ...item,

          displayTitle:
            item.title
            ||
            item.label
        })
      )
      .sort(
        (a, b) =>
          b.displayTitle.length
          -
          a.displayTitle.length
      );

  const titleAnchor =
    candidates[0]
    || null;

  if (!titleAnchor) {
    return null;
  }

  const onclick =
    parseOnclick(
      titleAnchor.onclick
    );

  const ids =
    [
      ...new Set([
        ...extractNumericIds(
          raw
        ),

        ...(
          onclick?.numericArgs
          || []
        )
      ])
    ];

  if (
    ids.length === 0
    &&
    !titleAnchor.url
  ) {
    return null;
  }

  return {
    title:
      titleAnchor.displayTitle,

    publishedAt:
      date,

    href:
      titleAnchor.href,

    staticUrl:
      titleAnchor.url,

    onclick:
      titleAnchor.onclick,

    onclickParsed:
      onclick,

    numericIds:
      ids,

    detailId:
      ids[0]
      || null,

    detailKey:
      titleAnchor.url
        ? `URL:${titleAnchor.url}`
        : `ID:${ids[0]}`,

    rowText:
      text.slice(
        0,
        1000
      )
  };
}


/* =========================================================
 * 반복 함수 안정성
 * ========================================================= */

function analyzeFunctionPattern(items) {
  const functionCounts = {};

  for (
    const item
    of items
  ) {
    const fn =
      item.onclickParsed
        ?.functionName;

    if (!fn) {
      continue;
    }

    functionCounts[fn] =
      (
        functionCounts[fn]
        || 0
      )
      + 1;
  }

  const top =
    Object.entries(
      functionCounts
    )
      .sort(
        (a, b) =>
          b[1]
          -
          a[1]
      )[0]
      || null;

  return {
    stable:
      Boolean(
        top
        &&
        top[1] >= 3
      ),

    functionName:
      top
        ? top[0]
        : null,

    count:
      top
        ? top[1]
        : 0,

    functionCounts
  };
}


/* =========================================================
 * 상세 URL 후보 생성
 *
 * HSMU eGov 계열 게시판에서 흔히 쓰는 패턴을
 * 무작정 확정하지 않고 여러 후보를 생성한 뒤 검증한다.
 * ========================================================= */

function buildDetailUrlCandidates(
  listUrl,
  id
) {
  if (!id) {
    return [];
  }

  const candidates = [];

  const base =
    new URL(
      listUrl
    );

  /*
   * 같은 contents endpoint + query parameter
   */

  for (
    const parameter
    of [
      "idx",
      "seq",
      "no",
      "nttId",
      "boardNo",
      "bbsNo"
    ]
  ) {
    const url =
      new URL(
        base.href
      );

    url.searchParams.set(
      parameter,
      id
    );

    candidates.push({
      url:
        url.href,

      method:
        `SAME_PAGE:${parameter}`,

      confidence:
        30
    });
  }

  /*
   * view.do 계열
   */

  const pathname =
    base.pathname;

  const viewVariants = [
    pathname.replace(
      /\.do$/i,
      "View.do"
    ),

    pathname.replace(
      /\.do$/i,
      "_view.do"
    ),

    pathname.replace(
      /00\.do$/i,
      "01.do"
    )
  ];

  for (
    const pathnameCandidate
    of [
      ...new Set(
        viewVariants
      )
    ]
  ) {
    if (
      !pathnameCandidate
      ||
      pathnameCandidate
        === pathname
    ) {
      continue;
    }

    for (
      const parameter
      of [
        "idx",
        "seq",
        "no",
        "nttId"
      ]
    ) {
      const url =
        new URL(
          base.href
        );

      url.pathname =
        pathnameCandidate;

      url.search =
        "";

      url.searchParams.set(
        parameter,
        id
      );

      candidates.push({
        url:
          url.href,

        method:
          `VIEW_VARIANT:${parameter}`,

        confidence:
          20
      });
    }
  }

  return candidates;
}


/* =========================================================
 * 상세 페이지 판정
 * ========================================================= */

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}


function titleExists(
  html,
  title
) {
  const target =
    titleKey(
      title
    );

  if (!target) {
    return false;
  }

  return titleKey(
    html
  ).includes(
    target
  );
}


async function validateDetailCandidate(
  item,
  candidate
) {
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

      pass:
        false,

      reason:
        "UNREACHABLE"
    };
  }

  const official =
    officialDomain(
      page.finalUrl
    );

  const sameAsList =
    normalizeUrl(
      page.finalUrl
    )
    ===
    normalizeUrl(
      LIST_URL
    );

  const titleMatch =
    titleExists(
      page.html,
      item.title
    );

  const bodyLength =
    plain(
      page.html
    ).length;

  const pass =
    Boolean(
      official
      &&
      !sameAsList
      &&
      titleMatch
      &&
      bodyLength >= 100
    );

  return {
    ...candidate,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    officialDomain:
      official,

    sameAsList,

    titleMatch,

    bodyLength,

    pass,

    reason:
      pass
        ? null
        : "DETAIL_RULE_NOT_CONFIRMED"
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const validation =
    read(
      VALIDATION_FILE,
      {}
    );

  if (
    validation.decision
      !== "FLEXIBLE_SOURCE_VALIDATED"
  ) {
    throw new Error(
      "HSMU_FLEXIBLE_SOURCE_NOT_VALIDATED"
    );
  }

  const beforeHashes =
    operationalHashes();

  let requests = 0;

  requests += 1;

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
      "HSMU_FLEXIBLE_LIST_UNREACHABLE"
    );
  }

  const rows =
    extractRows(
      list.html
    );

  const analyzed =
    rows
      .map(
        raw =>
          analyzeRow(
            raw,
            list.finalUrl
          )
      )
      .filter(Boolean);

  const unique =
    [
      ...new Map(
        analyzed.map(
          item => [
            item.detailKey,
            item
          ]
        )
      ).values()
    ];

  const functionPattern =
    analyzeFunctionPattern(
      unique
    );

  /*
   * 상세 URL 규칙 탐색
   */

  const detailRuleTests = [];

  for (
    const item
    of unique.slice(
      0,
      MAX_DETAIL_TESTS
    )
  ) {
    /*
     * 이미 정적 URL이 있으면 최우선
     */

    let candidates = [];

    if (
      item.staticUrl
      &&
      officialDomain(
        item.staticUrl
      )
    ) {
      candidates.push({
        url:
          item.staticUrl,

        method:
          "STATIC_URL",

        confidence:
          100
      });
    }

    candidates.push(
      ...buildDetailUrlCandidates(
        list.finalUrl,
        item.detailId
      )
    );

    const tested = [];

    for (
      const candidate
      of candidates.slice(
        0,
        10
      )
    ) {
      requests += 1;

      const result =
        await validateDetailCandidate(
          item,
          candidate
        );

      tested.push(
        result
      );

      if (
        result.pass
      ) {
        break;
      }
    }

    detailRuleTests.push({
      title:
        item.title,

      publishedAt:
        item.publishedAt,

      detailId:
        item.detailId,

      onclick:
        item.onclick,

      tested,

      successfulRule:
        tested.find(
          result =>
            result.pass
        )
        || null
    });
  }

  /*
   * 규칙별 성공 횟수
   */

  const ruleCounts = {};

  for (
    const test
    of detailRuleTests
  ) {
    const rule =
      test.successfulRule
        ?.method;

    if (!rule) {
      continue;
    }

    ruleCounts[rule] =
      (
        ruleCounts[rule]
        || 0
      )
      + 1;
  }

  const topRule =
    Object.entries(
      ruleCounts
    )
      .sort(
        (a, b) =>
          b[1]
          -
          a[1]
      )[0]
      || null;

  const detailRuleStable =
    Boolean(
      topRule
      &&
      topRule[1] >= 3
    );

  /*
   * Collector readiness
   */

  const distinctTitles =
    new Set(
      unique.map(
        item =>
          item.title
      )
    ).size;

  const distinctDates =
    new Set(
      unique.map(
        item =>
          item.publishedAt
      )
    ).size;

  const collectorReady =
    unique.length >= 3
    &&
    distinctTitles >= 3
    &&
    distinctDates >= 3
    &&
    functionPattern.stable
    &&
    (
      detailRuleStable
      ||
      unique.every(
        item =>
          Boolean(
            item.detailId
          )
      )
    );

  /*
   * 중요한 점:
   * 상세 URL을 아직 확정하지 못해도
   * onclick ID가 모든 게시물에서 안정적으로 존재하면
   * custom collector 구성은 가능하므로 COLLECTOR_CONFIG_READY로 둔다.
   */

  let decision =
    "REVIEW_REQUIRED";

  if (
    collectorReady
    &&
    detailRuleStable
  ) {
    decision =
      "COLLECTOR_READY";
  }

  else if (
    collectorReady
  ) {
    decision =
      "CUSTOM_COLLECTOR_CONFIG_READY";
  }

  let proposedCollector =
    null;

  if (
    decision
    === "COLLECTOR_READY"
    ||
    decision
    === "CUSTOM_COLLECTOR_CONFIG_READY"
  ) {
    proposedCollector = {
      id:
        SOURCE_ID,

      name:
        "화성의과학대학교 이사회 회의공지",

      category:
        "school_news",

      sourceType:
        "official",

      collectionType:
        decision
        === "COLLECTOR_READY"
          ? "html"
          : "custom_html",

      listUrl:
        LIST_URL,

      campusScope:
        "CAMPUS_SPECIFIC",

      contentScope:
        "GENERAL_UNIVERSITY_UPDATES",

      parser: {
        item:
          "tbody tr",

        structure:
          "TR",

        titleStrategy:
          "LONGEST_CLICKABLE_TITLE",

        dateStrategy:
          "VISIBLE_DATE_IN_ROW",

        detailStrategy:
          detailRuleStable
            ? "URL_RULE"
            : "ONCLICK_NUMERIC_ID",

        onclickFunction:
          functionPattern.functionName,

        detailRule:
          topRule
            ? topRule[0]
            : null
      },

      verified:
        false,

      enabled:
        false,

      status:
        "collector_ready_pending_activation",

      autoActivate:
        false
    };
  }

  let nextAction =
    "INSPECT_ONCLICK_FUNCTION_BODY";

  if (
    decision
    === "COLLECTOR_READY"
  ) {
    nextAction =
      "VERIFY_HSMU_ACTIVATION_READY";
  }

  else if (
    decision
    === "CUSTOM_COLLECTOR_CONFIG_READY"
  ) {
    nextAction =
      "IMPLEMENT_ONCLICK_ID_COLLECTOR";
  }

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

      rows:
        rows.length
    },

    extracted:
      analyzed.length,

    unique:
      unique.length,

    distinctTitles,

    distinctDates,

    functionPattern,

    samples:
      unique.slice(
        0,
        10
      ),

    detailRuleTests,

    ruleCounts,

    topRule:
      topRule
        ? {
            method:
              topRule[0],

            count:
              topRule[1]
          }
        : null,

    detailRuleStable,

    decision,

    proposedCollector,

    nextAction,

    requests,

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

        rows:
          report.list.rows,

        extracted:
          report.extracted,

        unique:
          report.unique,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

        onclickFunction:
          report.functionPattern
            .functionName,

        onclickFunctionCount:
          report.functionPattern
            .count,

        detailRuleStable:
          report.detailRuleStable,

        topRule:
          report.topRule,

        detailTests:
          report.detailRuleTests.map(
            item => ({
              title:
                item.title,

              id:
                item.detailId,

              onclick:
                item.onclick,

              success:
                item.successfulRule
                ? {
                    method:
                      item.successfulRule.method,

                    url:
                      item.successfulRule.finalUrl
                  }
                : null
            })
          ),

        proposedCollector:
          report.proposedCollector,

        nextAction:
          report.nextAction,

        requests:
          report.requests,

        hashSafe:
          report.operationalHashUnchanged
      },
      null,
      2
    )
  );
}


if (
  require.main === module
) {
  main().catch(
    error => {
      console.error(
        error.stack
        ||
        error.message
      );

      process.exitCode = 1;
    }
  );
}


module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  parseDate,
  extractRows,
  extractAnchors,
  extractNumericIds,
  parseOnclick,
  splitArgs,
  analyzeRow,
  analyzeFunctionPattern,
  buildDetailUrlCandidates,
  titleExists,
  validateDetailCandidate
};