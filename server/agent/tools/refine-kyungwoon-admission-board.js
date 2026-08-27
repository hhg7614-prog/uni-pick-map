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
  "kyungwoon-admission-board-refinement.json"
);

const LIST_URL =
  "https://www.ikw.ac.kr/ipsi/page/link.tc?mn=2415&pageSeq=1608";

const UNIVERSITY_ID =
  "kyungwoon-university-본교";

const UNIVERSITY_NAME =
  "경운대학교";

const REQUEST_TIMEOUT_MS = 30000;
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

  fs.renameSync(
    temp,
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
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  const text =
    String(value)
      .trim()
      .replace(/&amp;/gi, "&");

  if (/^javascript:/i.test(text)) {
    return null;
  }

  try {
    const url =
      new URL(text, base);

    url.hash = "";

    return /^https?:$/.test(url.protocol)
      ? url.href
      : null;

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
    .update(
      fs.readFileSync(file)
    )
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
        "Mozilla/5.0 compatible UNI-PICK Kyungwoon Board Refiner",
        "-H",
        "Accept: text/html,application/xhtml+xml",
        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",
        "-w",
        "\n__UNI_PICK_META__%{http_code}|%{url_effective}|%{content_type}",
        url
      ],
      {
        encoding: "utf8",
        timeout:
          REQUEST_TIMEOUT_MS + 5000,
        windowsHide: true,
        maxBuffer:
          20 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      error: {
        name:
          result.error.name,
        message:
          result.error.message
      }
    };
  }

  const stdout =
    String(result.stdout || "");

  const marker =
    "\n__UNI_PICK_META__";

  const index =
    stdout.lastIndexOf(marker);

  if (index < 0) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: stdout,
      error: {
        name:
          "CurlMetaError",
        message:
          "metadata marker missing"
      }
    };
  }

  const html =
    stdout.slice(0, index);

  const meta =
    stdout.slice(
      index + marker.length
    ).trim();

  const [
    rawStatus,
    finalUrl,
    contentType
  ] =
    meta.split("|");

  const status =
    Number(rawStatus);

  return {
    ok:
      result.status === 0
      &&
      status >= 200
      &&
      status < 400,

    status,
    finalUrl,
    contentType,
    html,
    bytes:
      Buffer.byteLength(
        html,
        "utf8"
      ),

    curlExitCode:
      result.status,

    error:
      result.status === 0
        ? null
        : {
            name:
              "CurlError",
            message:
              String(
                result.stderr || ""
              ).trim()
          }
  };
}

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

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}

function extractCells(raw) {
  const output = [];

  for (
    const match
    of raw.matchAll(
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const body =
      match[2] || "";

    const className =
      (
        attrs.match(
          /\bclass\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    output.push({
      index:
        output.length,
      className,
      html:
        body,
      text:
        plain(body),
      date:
        parseDate(body)
    });
  }

  return output;
}

function extractAnchors(
  html,
  baseUrl
) {
  const output = [];

  for (
    const match
    of html.matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const href =
      (
        attrs.match(
          /\bhref\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const titleAttribute =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const label =
      plain(match[2]);

    const url =
      href
        ? normalizeUrl(
            href,
            baseUrl
          )
        : null;

    output.push({
      label,
      titleAttribute:
        titleAttribute
        ? plain(titleAttribute)
        : null,
      href,
      url
    });
  }

  return output;
}

function isDownloadUrl(url) {
  if (!url) {
    return false;
  }

  const value =
    url.toLowerCase();

  return (
    value.includes(
      "/jfile/readfile.tc"
    )
    ||
    /fileid=/.test(value)
  );
}

function isDetailUrl(url) {
  if (
    !url
    ||
    !officialDomain(url)
    ||
    isDownloadUrl(url)
  ) {
    return false;
  }

  try {
    const parsed =
      new URL(url);

    const joined =
      `${parsed.pathname}${parsed.search}`
        .toLowerCase();

    return (
      joined.includes(
        "/ipsi/board/detail.tc"
      )
      &&
      /boardno=\d+/i.test(
        parsed.search
      )
    );

  } catch {
    return false;
  }
}

function analyzeRow(
  raw,
  baseUrl
) {
  const cells =
    extractCells(raw);

  const anchors =
    extractAnchors(
      raw,
      baseUrl
    );

  const detailLinks =
    anchors.filter(
      item =>
        isDetailUrl(
          item.url
        )
    );

  if (
    detailLinks.length === 0
  ) {
    return null;
  }

  const titleCandidates =
    detailLinks
      .map(
        item => ({
          title:
            item.titleAttribute
            ||
            item.label,
          url:
            item.url
        })
      )
      .filter(
        item =>
          item.title
          &&
          item.title.length >= 4
          &&
          item.title !== "새창열림"
      )
      .sort(
        (a, b) =>
          b.title.length
          -
          a.title.length
      );

  /*
   * 링크 text가 "새창열림"만 잡히는 경우,
   * TR 전체 텍스트에서 날짜/번호/조회수/기관명 제거 후
   * 가장 긴 중간 텍스트를 제목 후보로 사용한다.
   */

  let selected =
    titleCandidates[0]
    || null;

  const dates =
    cells
      .filter(
        cell =>
          Boolean(cell.date)
      );

  if (!selected) {
    const rawText =
      plain(raw);

    let cleaned =
      rawText
        .replace(
          /\b20\d{2}-\d{2}-\d{2}\b/g,
          " "
        )
        .replace(
          /\b조회수\s*\d+\b/g,
          " "
        )
        .replace(
          /\b\d+\b/g,
          " "
        )
        .replace(
          /파일 다운로드/g,
          " "
        )
        .replace(
          /새창열림/g,
          " "
        )
        .replace(
          /입학홍보처|경운대 입학/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      cleaned.length >= 4
    ) {
      selected = {
        title:
          cleaned,
        url:
          detailLinks[0].url
      };
    }
  }

  if (!selected) {
    return null;
  }

  const date =
    dates[0]?.date
    || null;

  if (!date) {
    return null;
  }

  return {
    title:
      selected.title,

    detailUrl:
      selected.url,

    detailKey:
      `URL:${selected.url}`,

    publishedAt:
      date,

    cells:
      cells.map(
        cell => ({
          index:
            cell.index,
          className:
            cell.className,
          text:
            cell.text,
          date:
            cell.date
        })
      )
  };
}

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function titleMatches(
  expected,
  html
) {
  const expectedKey =
    titleKey(expected);

  const documentKey =
    titleKey(html);

  if (!expectedKey) {
    return false;
  }

  return documentKey.includes(
    expectedKey
  );
}

function dateMatches(
  expected,
  html
) {
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
      `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
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

  const pass =
    Boolean(
      officialDomain(
        page.finalUrl
      )
      &&
      titleMatch
      &&
      dateMatch
    );

  return {
    ...item,
    status:
      page.status,
    finalUrl:
      page.finalUrl,
    titleMatch,
    dateMatch,
    pass
  };
}

function analyzeDateColumn(items) {
  const byIndex = {};

  for (
    const item
    of items
  ) {
    for (
      const cell
      of item.cells
    ) {
      if (!cell.date) {
        continue;
      }

      byIndex[cell.index] =
        (
          byIndex[cell.index]
          || 0
        ) + 1;
    }
  }

  const winner =
    Object.entries(
      byIndex
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]
      || null;

  return {
    byIndex,

    bestIndex:
      winner
        ? {
            index:
              Number(winner[0]),
            count:
              winner[1]
          }
        : null
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
      "KYUNGWOON_BOARD_UNREACHABLE"
    );
  }

  const rawRows =
    extractRows(
      list.html
    );

  const analyzed =
    rawRows
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

  const duplicateUrls =
    analyzed.length
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

  const dateColumn =
    analyzeDateColumn(
      unique
    );

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
      validateDetail(
        item
      )
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

  const collectorReady =
    Boolean(
      unique.length >= 5
      &&
      distinctTitles >= 5
      &&
      distinctDates >= 3
      &&
      duplicateUrls === 0
      &&
      detailChecks.length === 5
      &&
      detailPass === 5
      &&
      titlePass === 5
      &&
      datePass === 5
    );

  const selectors = {
    item:
      "tbody tr",

    title:
      "a[href*='/ipsi/board/detail.tc'][href*='boardNo=']",

    link:
      "a[href*='/ipsi/board/detail.tc'][href*='boardNo=']",

    linkAttribute:
      "href",

    date:
      dateColumn.bestIndex
        ? `td:nth-child(${dateColumn.bestIndex.index + 1})`
        : null
  };

  const decision =
    collectorReady
      ? "COLLECTOR_READY"
      : "SELECTOR_REVIEW_REQUIRED";

  const proposedSource =
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
            "html",

          listUrl:
            LIST_URL,

          campusScope:
            "CAMPUS_SPECIFIC",

          contentScope:
            "GENERAL_UNIVERSITY_UPDATES",

          selectors,

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

    status:
      list.status,

    rawRows:
      rawRows.length,

    extracted:
      analyzed.length,

    unique:
      unique.length,

    duplicateUrls,

    distinctTitles,

    distinctDates,

    dateColumn,

    detailValidation: {
      tested:
        detailChecks.length,

      pass:
        detailPass,

      titlePass,

      datePass,

      checks:
        detailChecks
    },

    selectors,

    decision,

    proposedSource,

    nextAction:
      collectorReady
        ? "VERIFY_KYUNGWOON_ACTIVATION_READY"
        : "INSPECT_KYUNGWOON_TITLE_CELL",

    requests,

    operationalHashUnchanged:
      hashSafe,

    safety: {
      readOnly: true,
      curlTlsBypass: false,
      sourceModified: false,
      storeModified: false,
      previewModified: false,
      queueModified: false,
      gitTriggered: false,
      deploymentTriggered: false
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

        duplicateUrls:
          report.duplicateUrls,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

        dateColumn:
          report.dateColumn,

        detailValidation: {
          tested:
            report.detailValidation.tested,

          pass:
            report.detailValidation.pass,

          titlePass:
            report.detailValidation.titlePass,

          datePass:
            report.detailValidation.datePass
        },

        samples:
          report.detailValidation.checks.map(
            item => ({
              title:
                item.title,

              publishedAt:
                item.publishedAt,

              url:
                item.finalUrl,

              status:
                item.status,

              titleMatch:
                item.titleMatch,

              dateMatch:
                item.dateMatch,

              pass:
                item.pass
            })
          ),

        selectors:
          report.selectors,

        proposedSource:
          report.proposedSource,

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

module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  curlPage,
  parseDate,
  extractRows,
  extractCells,
  extractAnchors,
  isDownloadUrl,
  isDetailUrl,
  analyzeRow,
  titleKey,
  titleMatches,
  dateMatches,
  validateDetail,
  analyzeDateColumn
};