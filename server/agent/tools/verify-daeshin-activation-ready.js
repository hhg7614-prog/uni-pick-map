"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ============================================================
// 1. 기본 설정
// ============================================================

const ROOT = path.resolve(__dirname, "..", "..", "..");

const DATA_DIR = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "daeshin-activation-ready.json"
);

const UNIVERSITY_ID = "daeshin-university-본교";
const UNIVERSITY_NAME = "대신대학교";

const SOURCE_ID = "daeshin-general-feed";
const SOURCE_NAME = "대신대학교 대신뉴스";

const LIST_URL =
  "https://www.daeshin.ac.kr/html/05_community/01_6.php";

const MAX_DETAIL_TESTS = 5;

// ============================================================
// 2. 기본 유틸리티
// ============================================================

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .trim();
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(String(value).trim());

    url.hash = "";

    return url.href.replace(/\/+$/g, "");
  } catch {
    return String(value)
      .trim()
      .replace(/\/+$/g, "");
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
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

function normalizeDate(value) {
  const match = String(value || "").match(
    /\b(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/
  );

  if (!match) {
    return null;
  }

  return (
    match[1] +
    "-" +
    String(match[2]).padStart(2, "0") +
    "-" +
    String(match[3]).padStart(2, "0")
  );
}

function extractBId(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).searchParams.get("b_id") || null;
  } catch {
    const match = String(url).match(
      /[?&]b_id=([^&#]+)/i
    );

    return match
      ? decodeURIComponent(match[1])
      : null;
  }
}

// ============================================================
// 3. JSON 읽기 / 저장
// ============================================================

function readJson(file) {
  const raw = fs.readFileSync(file, "utf8");

  return JSON.parse(
    raw.replace(/^\uFEFF/, "")
  );
}

function writeJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const tempFile =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  // 실제 저장 전 JSON 유효성 재검증
  JSON.parse(
    fs.readFileSync(tempFile, "utf8")
  );

  fs.renameSync(
    tempFile,
    file
  );
}

// ============================================================
// 4. Catalog 구조 탐색
// ============================================================

function collectUniversityEntries(
  node,
  results = []
) {
  if (
    !node ||
    typeof node !== "object"
  ) {
    return results;
  }

  if (
    !Array.isArray(node) &&
    normalizeText(
      node.universityId || node.id
    ) === normalizeText(UNIVERSITY_ID)
  ) {
    results.push(node);
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      collectUniversityEntries(
        child,
        results
      );
    }

    return results;
  }

  for (const value of Object.values(node)) {
    if (
      value &&
      typeof value === "object"
    ) {
      collectUniversityEntries(
        value,
        results
      );
    }
  }

  return results;
}

function extractSourcesFromUniversity(
  university
) {
  if (!university) {
    return [];
  }

  const candidates = [
    university.sources,
    university.newsSources,
    university.collectors,
    university.feeds
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function collectAllSources(
  node,
  results = []
) {
  if (
    !node ||
    typeof node !== "object"
  ) {
    return results;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      collectAllSources(
        child,
        results
      );
    }

    return results;
  }

  if (
    typeof node.id === "string" &&
    (
      node.listUrl ||
      node.url ||
      node.collectionType
    )
  ) {
    results.push(node);
  }

  for (const value of Object.values(node)) {
    if (
      value &&
      typeof value === "object"
    ) {
      collectAllSources(
        value,
        results
      );
    }
  }

  return results;
}

// ============================================================
// 5. 네트워크
// Node fetch 우선 -> Windows curl.exe fallback
// TLS 검증 우회 옵션은 사용하지 않음
// ============================================================

async function nodeFetchText(url) {
  try {
    const response = await fetch(
      url,
      {
        redirect: "follow",

        headers: {
          "user-agent":
            "Mozilla/5.0 UNI-PICK Daeshin Activation Validator",

          accept:
            "text/html,application/xhtml+xml",

          "accept-language":
            "ko-KR,ko;q=0.9,en;q=0.8"
        }
      }
    );

    const body =
      await response.text();

    return {
      ok:
        response.ok &&
        body.length > 0,

      status:
        response.status,

      finalUrl:
        response.url || url,

      body,

      transport:
        "node-fetch",

      error:
        null
    };
  } catch (error) {
    return {
      ok: false,

      status: 0,

      finalUrl: null,

      body: "",

      transport:
        "node-fetch",

      error:
        error?.message ||
        String(error),

      causeCode:
        error?.cause?.code ||
        null
    };
  }
}

function curlFetchText(url) {
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
        "40",

        "--silent",

        "--show-error",

        "--compressed",

        "--user-agent",
        "Mozilla/5.0 UNI-PICK Daeshin Activation Validator",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "--write-out",
        "\n__UNI_PICK_STATUS__:%{http_code}\n__UNI_PICK_URL__:%{url_effective}",

        url
      ],
      {
        encoding: "utf8",

        windowsHide: true,

        maxBuffer:
          25 * 1024 * 1024
      }
    );

    const statusMatch = output.match(
      /\n__UNI_PICK_STATUS__:(\d{3})/
    );

    const urlMatch = output.match(
      /\n__UNI_PICK_URL__:(.+)$/
    );

    const body = output.replace(
      /\n__UNI_PICK_STATUS__:\d{3}\n__UNI_PICK_URL__:.+$/s,
      ""
    );

    const status = statusMatch
      ? Number(statusMatch[1])
      : 0;

    return {
      ok:
        status >= 200 &&
        status < 400 &&
        body.length > 0,

      status,

      finalUrl:
        urlMatch
          ? urlMatch[1].trim()
          : url,

      body,

      transport:
        "curl.exe",

      error:
        null
    };
  } catch (error) {
    return {
      ok: false,

      status: 0,

      finalUrl: null,

      body: "",

      transport:
        "curl.exe",

      error:
        error?.stderr
          ? String(error.stderr)
          : (
              error?.message ||
              String(error)
            )
    };
  }
}

async function fetchText(url) {
  const first =
    await nodeFetchText(url);

  if (
    first.ok &&
    first.body.length > 500
  ) {
    return first;
  }

  const fallback =
    curlFetchText(url);

  if (fallback.ok) {
    return fallback;
  }

  return {
    ...fallback,

    nodeError:
      first.error,

    nodeCauseCode:
      first.causeCode || null
  };
}

// ============================================================
// 6. 대신대학교 목록 파서
// ============================================================

function extractRows(html) {
  const rows = [];

  const rowRegex =
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while (
    (
      rowMatch =
        rowRegex.exec(html)
    )
  ) {
    const rowHtml =
      rowMatch[0];

    const titleCell = rowHtml.match(
      /<td\b[^>]*class=["'][^"']*\bTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );

    const dateCell = rowHtml.match(
      /<td\b[^>]*class=["'][^"']*\bDate\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );

    if (
      !titleCell ||
      !dateCell
    ) {
      continue;
    }

    const anchor = titleCell[1].match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );

    if (!anchor) {
      continue;
    }

    const href =
      decodeHtml(anchor[1]);

    if (
      !/[?&]AT=V(?:&|$)/i.test(href) ||
      !/[?&]b_id=/i.test(href)
    ) {
      continue;
    }

    const title =
      stripTags(anchor[2]);

    const publishedAt =
      normalizeDate(
        stripTags(dateCell[1])
      );

    let detailUrl;

    try {
      detailUrl =
        new URL(
          href,
          LIST_URL
        ).href;
    } catch {
      continue;
    }

    const bId =
      extractBId(detailUrl);

    if (
      !title ||
      !publishedAt ||
      !bId
    ) {
      continue;
    }

    rows.push({
      bId,

      title,

      publishedAt,

      detailUrl,

      detailKey:
        `B_ID:${bId}`
    });
  }

  return rows;
}

// ============================================================
// 7. 상세 페이지 검증
// ============================================================

function detailContainsTitle(
  html,
  title
) {
  const pageText =
    stripTags(html);

  const expected =
    normalizeText(
      decodeHtml(title)
    );

  if (
    expected &&
    pageText.includes(expected)
  ) {
    return true;
  }

  const compactExpected =
    expected.replace(/\s+/g, "");

  const compactPage =
    pageText.replace(/\s+/g, "");

  return Boolean(
    compactExpected.length >= 8 &&
    compactPage.includes(
      compactExpected
    )
  );
}

function detailContainsDate(
  html,
  date
) {
  const pageText =
    stripTags(html);

  const [
    year,
    month,
    day
  ] = date.split("-");

  const numericMonth =
    String(Number(month));

  const numericDay =
    String(Number(day));

  const patterns = [
    date,

    `${year}.${month}.${day}`,

    `${year}/${month}/${day}`,

    `${year}-${numericMonth}-${numericDay}`,

    `${year}.${numericMonth}.${numericDay}`,

    `${year}/${numericMonth}/${numericDay}`
  ];

  return patterns.some(
    pattern =>
      pageText.includes(pattern)
  );
}

function isOfficialDaeshinUrl(value) {
  try {
    const host = new URL(value)
      .hostname
      .toLowerCase();

    return (
      host === "daeshin.ac.kr" ||
      host.endsWith(".daeshin.ac.kr")
    );
  } catch {
    return false;
  }
}

// ============================================================
// 8. Collector dry-run 검증
// ============================================================

async function validateCollector() {
  const list =
    await fetchText(LIST_URL);

  if (!list.ok) {
    return {
      success: false,

      status:
        list.status,

      finalUrl:
        list.finalUrl,

      error:
        list.error,

      transport:
        list.transport,

      rawRows: 0,

      extracted: 0,

      unique: 0,

      duplicateKeys: 0,

      distinctTitles: 0,

      distinctDates: 0,

      detailValidation: {
        tested: 0,

        pass: 0,

        titlePass: 0,

        datePass: 0,

        validUrls: 0
      },

      detailSamples: []
    };
  }

  const rawRows = (
    list.body.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    ) || []
  ).length;

  const extracted =
    extractRows(list.body);

  const map =
    new Map();

  let duplicateKeys = 0;

  for (const item of extracted) {
    if (
      map.has(item.detailKey)
    ) {
      duplicateKeys += 1;
      continue;
    }

    map.set(
      item.detailKey,
      item
    );
  }

  const uniqueItems =
    [...map.values()];

  const detailSamples = [];

  for (
    const item
    of uniqueItems.slice(
      0,
      MAX_DETAIL_TESTS
    )
  ) {
    const detail =
      await fetchText(
        item.detailUrl
      );

    const validUrl =
      detail.status >= 200 &&
      detail.status < 400 &&
      isOfficialDaeshinUrl(
        detail.finalUrl ||
        item.detailUrl
      );

    const titleMatch =
      detail.ok &&
      detailContainsTitle(
        detail.body,
        item.title
      );

    const dateMatch =
      detail.ok &&
      detailContainsDate(
        detail.body,
        item.publishedAt
      );

    detailSamples.push({
      bId:
        item.bId,

      title:
        item.title,

      publishedAt:
        item.publishedAt,

      url:
        item.detailUrl,

      status:
        detail.status,

      finalUrl:
        detail.finalUrl,

      transport:
        detail.transport,

      validUrl,

      titleMatch,

      dateMatch,

      pass:
        validUrl &&
        titleMatch &&
        dateMatch,

      error:
        detail.error || null
    });
  }

  const detailValidation = {
    tested:
      detailSamples.length,

    pass:
      detailSamples.filter(
        row => row.pass
      ).length,

    titlePass:
      detailSamples.filter(
        row => row.titleMatch
      ).length,

    datePass:
      detailSamples.filter(
        row => row.dateMatch
      ).length,

    validUrls:
      detailSamples.filter(
        row => row.validUrl
      ).length
  };

  const distinctTitles =
    new Set(
      uniqueItems.map(
        item =>
          normalizeText(
            item.title
          )
      )
    ).size;

  const distinctDates =
    new Set(
      uniqueItems.map(
        item =>
          item.publishedAt
      )
    ).size;

  const success = Boolean(
    list.status === 200 &&
    isOfficialDaeshinUrl(
      list.finalUrl ||
      LIST_URL
    ) &&
    rawRows >= 15 &&
    extracted.length >= 15 &&
    uniqueItems.length >= 10 &&
    duplicateKeys === 0 &&
    distinctTitles >= 10 &&
    distinctDates >= 5 &&
    detailValidation.tested === 5 &&
    detailValidation.pass === 5 &&
    detailValidation.titlePass === 5 &&
    detailValidation.datePass === 5 &&
    detailValidation.validUrls === 5
  );

  return {
    success,

    status:
      list.status,

    finalUrl:
      list.finalUrl,

    transport:
      list.transport,

    rawRows,

    extracted:
      extracted.length,

    unique:
      uniqueItems.length,

    duplicateKeys,

    distinctTitles,

    distinctDates,

    detailValidation,

    detailSamples
  };
}

// ============================================================
// 9. Activation Ready 판정
// ============================================================

async function main() {
  if (
    !fs.existsSync(
      CATALOG_FILE
    )
  ) {
    throw new Error(
      `Catalog file not found: ${CATALOG_FILE}`
    );
  }

  const catalog =
    readJson(CATALOG_FILE);

  const universityMatches =
    collectUniversityEntries(
      catalog
    );

  const university =
    universityMatches[0] ||
    null;

  const universitySources =
    university
      ? extractSourcesFromUniversity(
          university
        )
      : [];

  const allSources =
    collectAllSources(
      catalog
    );

  const normalizedListUrl =
    normalizeUrl(LIST_URL);

  const duplicateSourceId =
    allSources.some(
      source =>
        normalizeText(source.id) ===
        normalizeText(SOURCE_ID)
    );

  const duplicateListUrl =
    allSources.some(
      source =>
        normalizeUrl(
          source.listUrl ||
          source.url
        ) === normalizedListUrl
    );

  const duplicateVerifiedEnabledListUrl =
    allSources.some(
      source =>
        normalizeUrl(
          source.listUrl ||
          source.url
        ) === normalizedListUrl &&
        source.verified === true &&
        source.enabled === true
    );

  const dryRun =
    await validateCollector();

  const reasons = [];

  if (!university) {
    reasons.push(
      "CATALOG_UNIVERSITY_NOT_FOUND"
    );
  }

  if (!dryRun.success) {
    reasons.push(
      "COLLECTOR_DRY_RUN_FAILED"
    );
  }

  if (duplicateSourceId) {
    reasons.push(
      "DUPLICATE_SOURCE_ID"
    );
  }

  if (duplicateListUrl) {
    reasons.push(
      "DUPLICATE_LIST_URL"
    );
  }

  if (
    duplicateVerifiedEnabledListUrl
  ) {
    reasons.push(
      "DUPLICATE_VERIFIED_ENABLED_LIST_URL"
    );
  }

  const activationReady =
    reasons.length === 0;

  const result = {
    decision:
      activationReady
        ? "ACTIVATION_READY"
        : "ACTIVATION_REVIEW_REQUIRED",

    activationReady,

    reasons,

    collector: {
      decision:
        dryRun.success
          ? "COLLECTOR_READY"
          : "COLLECTOR_REVIEW_REQUIRED",

      status:
        dryRun.status,

      rawRows:
        dryRun.rawRows,

      extracted:
        dryRun.extracted,

      unique:
        dryRun.unique,

      duplicateKeys:
        dryRun.duplicateKeys,

      distinctTitles:
        dryRun.distinctTitles,

      distinctDates:
        dryRun.distinctDates
    },

    detailValidation:
      dryRun.detailValidation,

    catalog: {
      found:
        Boolean(university),

      sourceCount:
        universitySources.length,

      duplicateSourceId,

      duplicateListUrl,

      duplicateVerifiedEnabledListUrl
    },

    proposedActivation:
      activationReady
        ? {
            universityId:
              UNIVERSITY_ID,

            universityName:
              UNIVERSITY_NAME,

            source: {
              id:
                SOURCE_ID,

              name:
                SOURCE_NAME,

              category:
                "school_news",

              sourceType:
                "official",

              collectionType:
                "custom_html",

              listUrl:
                LIST_URL,

              campusScope:
                "CAMPUS_SPECIFIC",

              contentScope:
                "GENERAL_UNIVERSITY_UPDATES",

              parser: {
                itemStrategy:
                  "TR_WITH_TITLE_AND_DATE",

                itemSelector:
                  "tr",

                titleStrategy:
                  "TD_TITLE_ANCHOR",

                titleSelector:
                  "td.Title a",

                dateStrategy:
                  "TD_DATE",

                dateSelector:
                  "td.Date",

                detailStrategy:
                  "AT_V_B_ID",

                detailIdParameter:
                  "b_id",

                dedupeKey:
                  "B_ID"
              },

              verified:
                true,

              enabled:
                true,

              status:
                "awaiting_activation",

              healthStatus:
                "validated"
            }
          }
        : null,

    nextAction:
      activationReady
        ? "ACTIVATE_DAESHIN_SOURCE_LOCAL"
        : "REVIEW_DAESHIN_ACTIVATION_BLOCKERS",

    hashSafe:
      true,

    safety: {
      readOnly:
        true,

      automaticActivation:
        false,

      automaticSourceMutation:
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

  // 중요:
  // 다음 activate-daeshin-source.js가 읽을 파일을 실제 생성한다.
  writeJson(
    OUTPUT_FILE,
    result
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (!activationReady) {
    process.exitCode = 2;
  }
}

main().catch(
  error => {
    const result = {
      decision:
        "ACTIVATION_CHECK_ERROR",

      universityId:
        UNIVERSITY_ID,

      universityName:
        UNIVERSITY_NAME,

      error:
        error?.message ||
        String(error),

      stack:
        error?.stack ||
        null,

      hashSafe:
        true
    };

    try {
      writeJson(
        OUTPUT_FILE,
        result
      );
    } catch {
      // 원래 오류를 보존하기 위해
      // 여기서는 추가 예외를 발생시키지 않는다.
    }

    console.error(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    process.exitCode = 1;
  }
);