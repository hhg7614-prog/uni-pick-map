"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungwoon-admission-collector-final.json"
);

const UNIVERSITY_ID =
  "kyungwoon-university-본교";

const UNIVERSITY_NAME =
  "경운대학교";

const LIST_URL =
  "https://www.ikw.ac.kr/ipsi/board/list.tc?mn=2415&mngNo=12&categoryNo=48&pageSeq=1608&protocol=http";

const DETAIL_TEMPLATE =
  "https://www.ikw.ac.kr/ipsi/board/detail.tc?mn=2415&mngNo=12&pageSeq=1608&boardNo={id}";

const DETAIL_TEST_LIMIT = 5;

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

function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const temp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(temp, "utf8")
  );

  fs.renameSync(temp, file);
}

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

function officialDomain(url) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(/^www\./, "");

    return (
      host === "ikw.ac.kr"
      ||
      host.endsWith(".ikw.ac.kr")
    );
  } catch {
    return false;
  }
}

function sha256(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function operationalHashes() {
  return Object.fromEntries(
    OPERATIONAL_FILES.map(
      file => [
        path.relative(ROOT, file),
        sha256(file)
      ]
    )
  );
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
        "Mozilla/5.0 compatible UNI-PICK Kyungwoon Exact Collector",

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
        maxBuffer: 20 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      error: result.error.message
    };
  }

  const stdout =
    String(result.stdout || "");

  const marker =
    "\n__META__";

  const index =
    stdout.lastIndexOf(marker);

  if (index < 0) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: stdout,
      error: "META_MARKER_MISSING"
    };
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

  const status =
    Number(rawStatus);

  return {
    ok:
      result.status === 0
      &&
      status === 200,

    status,

    finalUrl,

    html,

    bytes:
      Buffer.byteLength(
        html,
        "utf8"
      ),

    error:
      result.status === 0
        ? null
        : String(result.stderr || "").trim()
  };
}

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}

/*
 * 실제 확인된 구조:
 *
 * <a class="tit"
 *    href="javascript:selectBoardDetail('331907');">
 *   제목
 * </a>
 *
 * <div class="add">
 *   <span>2026-06-04</span>
 *   ...
 * </div>
 */

function analyzeRow(raw) {
  const titleMatch =
    raw.match(
      /<a\b[^>]*class\s*=\s*["'][^"']*\btit\b[^"']*["'][^>]*href\s*=\s*["']javascript:selectBoardDetail\(\s*['"](\d+)['"]\s*\);?["'][^>]*>([\s\S]*?)<\/a>/i
    )
    ||
    raw.match(
      /<a\b[^>]*href\s*=\s*["']javascript:selectBoardDetail\(\s*['"](\d+)['"]\s*\);?["'][^>]*class\s*=\s*["'][^"']*\btit\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );

  if (!titleMatch) {
    return null;
  }

  const boardNo =
    titleMatch[1];

  const title =
    plain(titleMatch[2]);

  if (
    !boardNo
    ||
    !title
  ) {
    return null;
  }

  /*
   * div.add의 첫 span만 사용.
   * 제목 속 날짜는 무시.
   */
  const dateMatch =
    raw.match(
      /<div\b[^>]*class\s*=\s*["'][^"']*\badd\b[^"']*["'][^>]*>\s*<span\b[^>]*>\s*(20\d{2}-\d{1,2}-\d{1,2})\s*<\/span>/i
    );

  if (!dateMatch) {
    return null;
  }

  const publishedAt =
    normalizeDate(
      dateMatch[1]
    );

  if (!publishedAt) {
    return null;
  }

  return {
    boardNo,
    title,
    publishedAt,

    detailUrl:
      DETAIL_TEMPLATE.replace(
        "{id}",
        boardNo
      ),

    detailKey:
      `BOARD:${boardNo}`
  };
}

function normalizeDate(value) {
  const match =
    String(value || "")
      .match(
        /^(20\d{2})-(\d{1,2})-(\d{1,2})$/
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

  return (
    `${year}-`
    +
    `${String(month).padStart(2, "0")}-`
    +
    String(day).padStart(2, "0")
  );
}

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function titleMatches(expected, html) {
  const expectedKey =
    titleKey(expected);

  const documentKey =
    titleKey(html);

  return Boolean(
    expectedKey
    &&
    documentKey.includes(expectedKey)
  );
}

function dateMatches(expected, html) {
  if (!expected) {
    return false;
  }

  const [
    year,
    month,
    day
  ] =
    expected
      .split("-")
      .map(Number);

  const text =
    plain(html);

  const pattern =
    new RegExp(
      `${year}\\s*[-./년]\\s*0?${month}\\s*[-./월]\\s*0?${day}`
    );

  return pattern.test(text);
}

function validateDetail(item) {
  const page =
    curlPage(
      item.detailUrl
    );

  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    return {
      ...item,
      status:
        page.status,
      finalUrl:
        page.finalUrl,
      titleMatch:
        false,
      dateMatch:
        false,
      pass:
        false
    };
  }

  const titleMatch =
    titleMatches(
      item.title,
      page.html
    );

  const dateMatch =
    dateMatches(
      item.publishedAt,
      page.html
    );

  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    titleMatch,

    dateMatch,

    pass:
      Boolean(
        officialDomain(
          page.finalUrl
        )
        &&
        titleMatch
        &&
        dateMatch
      )
  };
}

function main() {
  const beforeHashes =
    operationalHashes();

  let requests = 1;

  const list =
    curlPage(
      LIST_URL
    );

  if (
    !list.ok
    ||
    list.status !== 200
  ) {
    throw new Error(
      "KYUNGWOON_LIST_UNREACHABLE"
    );
  }

  const rows =
    extractRows(
      list.html
    );

  const extracted =
    rows
      .map(analyzeRow)
      .filter(Boolean);

  const unique =
    [
      ...new Map(
        extracted.map(
          item => [
            item.detailKey,
            item
          ]
        )
      ).values()
    ];

  const duplicateKeys =
    extracted.length
    -
    unique.length;

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

  const detailChecks = [];

  for (
    const item
    of unique.slice(
      0,
      DETAIL_TEST_LIMIT
    )
  ) {
    requests += 1;

    detailChecks.push(
      validateDetail(item)
    );
  }

  const detailPass =
    detailChecks.filter(
      item =>
        item.pass
    ).length;

  const titlePass =
    detailChecks.filter(
      item =>
        item.titleMatch
    ).length;

  const datePass =
    detailChecks.filter(
      item =>
        item.dateMatch
    ).length;

  const validUrls =
    detailChecks.filter(
      item =>
        item.finalUrl
        &&
        officialDomain(
          item.finalUrl
        )
    ).length;

  /*
   * 경운대 현재 페이지에는
   * 고정공지 3개 + 일반 목록 중복이 있으므로
   * extracted > unique 정상.
   */

  const collectorReady =
    Boolean(
      unique.length >= 10
      &&
      distinctTitles >= 10
      &&
      distinctDates >= 5
      &&
      detailChecks.length === 5
      &&
      detailPass === 5
      &&
      titlePass === 5
      &&
      datePass === 5
      &&
      validUrls === 5
    );

  const decision =
    collectorReady
      ? "COLLECTOR_READY"
      : "COLLECTOR_REVIEW_REQUIRED";

  const proposedCollector =
    collectorReady
      ? {
          id:
            "kyungwoon-admission-general-feed",

          name:
            "경운대학교 입학·모집 소식",

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
            item:
              "tbody tr",

            titleStrategy:
              "A_TIT_TEXT",

            titleSelector:
              "a.tit",

            dateStrategy:
              "DIV_ADD_FIRST_SPAN",

            detailStrategy:
              "SELECT_BOARD_DETAIL",

            detailIdRegex:
              "selectBoardDetail\\s*\\(\\s*['\"](\\d+)['\"]\\s*\\)",

            detailUrlTemplate:
              DETAIL_TEMPLATE,

            dedupeKey:
              "BOARD_NO"
          },

          verified:
            false,

          enabled:
            false,

          status:
            "collector_ready_pending_activation",

          healthStatus:
            "validated",

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

  const report = {
    schemaVersion:
      "3.0",

    generatedAt:
      new Date()
        .toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    status:
      list.status,

    finalUrl:
      list.finalUrl,

    rawRows:
      rows.length,

    extracted:
      extracted.length,

    unique:
      unique.length,

    duplicateKeys,

    distinctTitles,

    distinctDates,

    extractedSamples:
      unique.slice(0, 5),

    detailValidation: {
      tested:
        detailChecks.length,

      pass:
        detailPass,

      titlePass,

      datePass,

      validUrls,

      checks:
        detailChecks
    },

    decision,

    proposedCollector,

    nextAction:
      collectorReady
        ? "VERIFY_KYUNGWOON_ACTIVATION_READY"
        : "REVIEW_KYUNGWOON_DETAIL_VALIDATION",

    requests,

    operationalHashUnchanged:
      hashSafe,

    safety: {
      readOnly:
        true,

      curlTlsBypass:
        false,

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
          report.status,

        rawRows:
          report.rawRows,

        extracted:
          report.extracted,

        unique:
          report.unique,

        duplicateKeys:
          report.duplicateKeys,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

        extractedSamples:
          report.extractedSamples,

        detailValidation: {
          tested:
            report.detailValidation.tested,

          pass:
            report.detailValidation.pass,

          titlePass:
            report.detailValidation.titlePass,

          datePass:
            report.detailValidation.datePass,

          validUrls:
            report.detailValidation.validUrls
        },

        detailSamples:
          report.detailValidation.checks
            .map(
              item => ({
                boardNo:
                  item.boardNo,

                title:
                  item.title,

                publishedAt:
                  item.publishedAt,

                url:
                  item.finalUrl,

                titleMatch:
                  item.titleMatch,

                dateMatch:
                  item.dateMatch,

                pass:
                  item.pass
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
  main();
}