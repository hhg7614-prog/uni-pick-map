"use strict";

/**
 * UNI PICK
 * Sangmyung University Cheonan Collector Finalizer v1
 *
 * 핵심 구조:
 *
 * <dl class="board-thumb-content-wrap ...">
 *   <dt class="board-thumb-content-title ...">
 *      ... category anchor ...
 *      ... 실제 제목 anchor ...
 *   </dt>
 *
 *   <dd class="board-thumb-content-info">
 *      ...
 *   </dd>
 * </dl>
 *
 * 기존 문제:
 * 외부 LI 안에 내부 LI가 중첩되어 있어
 * /<li>...<\/li>/ 방식으로는 outer item이 조기에 잘림.
 *
 * 해결:
 * 게시물 단위를 DL로 직접 추출한다.
 *
 * 제목:
 * 동일 articleNo를 가진 view anchor들 중
 * category label이 아닌 가장 긴 anchor text.
 *
 * 날짜:
 * 동일 DL 전체에서 실제 날짜 후보를 추출.
 *
 * 상세:
 * mode=view&articleNo={id}
 *
 * 안전:
 * read-only
 * catalog/store/preview/queue 수정 없음
 * git/deploy 없음
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

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
  "sangmyung-cheonan-collector-final.json"
);

const UNIVERSITY_ID =
  "sangmyung-university-제2캠퍼";

const UNIVERSITY_NAME =
  "상명대학교 제2캠퍼";

const LIST_URL =
  "https://www.smu.ac.kr/smuchina/community/sm_notice.do?mode=list&srCampus=smuc";

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


/* =========================================================
 * Utilities
 * ========================================================= */

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


function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}


function plain(value) {
  return decodeHtml(
    String(value || "")
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
  )
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        decodeHtml(value).trim(),
        base
      );

    url.hash = "";

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
        .replace(/^www\./, "");

    return (
      host === "smu.ac.kr"
      ||
      host.endsWith(".smu.ac.kr")
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * Hash protection
 * ========================================================= */

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


/* =========================================================
 * curl
 * ========================================================= */

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
        "Mozilla/5.0 compatible UNI-PICK Sangmyung Collector Finalizer",

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
        maxBuffer:
          25 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      error:
        result.error.message
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
      error:
        "META_MARKER_MISSING"
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
      status >= 200
      &&
      status < 400,

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
        : String(
            result.stderr || ""
          ).trim()
  };
}


/* =========================================================
 * Date
 * ========================================================= */

function normalizeDate(value) {
  const text =
    plain(value);

  let match =
    text.match(
      /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/
    );

  if (!match) {
    match =
      text.match(
        /(?:^|\D)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D|$)/
      );

    if (match) {
      match = [
        match[0],
        String(
          2000 + Number(match[1])
        ),
        match[2],
        match[3]
      ];
    }
  }

  if (!match) {
    return null;
  }

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
    `${match[1]}-`
    +
    `${String(month).padStart(2, "0")}-`
    +
    String(day).padStart(2, "0")
  );
}


/* =========================================================
 * DL item extraction
 * ========================================================= */

function extractBoardItems(html) {
  return (
    html.match(
      /<dl\b[^>]*class\s*=\s*["'][^"']*\bboard-thumb-content-wrap\b[^"']*["'][^>]*>[\s\S]*?<\/dl>/gi
    )
    || []
  );
}


/* =========================================================
 * Anchor extraction
 * ========================================================= */

function extractAnchors(
  raw,
  baseUrl
) {
  const anchors = [];

  for (
    const match
    of raw.matchAll(
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

    if (!href) {
      continue;
    }

    anchors.push({
      text:
        plain(match[2]),

      href:
        decodeHtml(href),

      url:
        normalizeUrl(
          href,
          baseUrl
        )
    });
  }

  return anchors;
}


function parseArticleNo(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed =
      new URL(url);

    if (
      parsed.searchParams.get("mode")
      !== "view"
    ) {
      return null;
    }

    const articleNo =
      parsed.searchParams.get(
        "articleNo"
      );

    return /^\d+$/.test(
      articleNo || ""
    )
      ? articleNo
      : null;

  } catch {
    return null;
  }
}


/* =========================================================
 * Title selection
 * ========================================================= */

function isCategoryLabel(text) {
  const value =
    plain(text);

  return (
    /^상명\s*\[[^\]]+\]$/.test(value)
    ||
    (
      value.length < 20
      &&
      /^상명/.test(value)
      &&
      /\[[^\]]+\]/.test(value)
    )
  );
}


function chooseTitleAnchor(
  anchors
) {
  const candidates =
    anchors
      .map(
        anchor => ({
          ...anchor,
          articleNo:
            parseArticleNo(
              anchor.url
            )
        })
      )
      .filter(
        anchor =>
          anchor.articleNo
          &&
          anchor.text
          &&
          !isCategoryLabel(
            anchor.text
          )
      )
      .sort(
        (a, b) =>
          b.text.length
          -
          a.text.length
      );

  return candidates[0]
    || null;
}


/* =========================================================
 * Date candidates
 * ========================================================= */

function extractDateCandidates(raw) {
  const text =
    plain(raw);

  const values = [];

  for (
    const match
    of text.matchAll(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
  ) {
    const date =
      normalizeDate(
        match[0]
      );

    if (date) {
      values.push(date);
    }
  }

  for (
    const match
    of text.matchAll(
      /(?:^|\D)(\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})(?=\D|$)/g
    )
  ) {
    const date =
      normalizeDate(
        match[1]
      );

    if (date) {
      values.push(date);
    }
  }

  return [
    ...new Set(values)
  ];
}


/* =========================================================
 * Analyze item
 * ========================================================= */

function analyzeItem(
  raw,
  baseUrl
) {
  const anchors =
    extractAnchors(
      raw,
      baseUrl
    );

  const titleAnchor =
    chooseTitleAnchor(
      anchors
    );

  if (!titleAnchor) {
    return null;
  }

  const dates =
    extractDateCandidates(
      raw
    );

  /*
   * 일반적으로 게시물 DL 안에는 게시일 1개가 존재해야 함.
   * 여러 날짜가 있으면 안전하게 null 처리하여 검토 대상으로 둠.
   */

  const publishedAt =
    dates.length === 1
      ? dates[0]
      : null;

  return {
    articleNo:
      titleAnchor.articleNo,

    title:
      titleAnchor.text,

    publishedAt,

    dateCandidates:
      dates,

    detailUrl:
      titleAnchor.url,

    detailKey:
      `ARTICLE:${titleAnchor.articleNo}`,

    text:
      plain(raw)
        .slice(0, 1200)
  };
}


/* =========================================================
 * Detail validation
 * ========================================================= */

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

  return Boolean(
    expectedKey
    &&
    documentKey.includes(
      expectedKey
    )
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

  return new RegExp(
    `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
  ).test(text);
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
    item.publishedAt
      ? dateMatches(
          item.publishedAt,
          page.html
        )
      : null;

  /*
   * 제목과 공식 URL은 필수.
   * 날짜가 목록에서 확실히 추출된 경우에만 날짜 일치 필수.
   */

  const pass =
    Boolean(
      officialDomain(
        page.finalUrl
      )
      &&
      titleMatch
      &&
      (
        item.publishedAt
          ? dateMatch === true
          : true
      )
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


/* =========================================================
 * Main
 * ========================================================= */

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
      "SANGMYUNG_CHEONAN_LIST_UNREACHABLE"
    );
  }

  if (
    !officialDomain(
      list.finalUrl
    )
  ) {
    throw new Error(
      "SANGMYUNG_CANONICAL_DOMAIN_INVALID"
    );
  }

  const rawItems =
    extractBoardItems(
      list.html
    );

  const extracted =
    rawItems
      .map(
        raw =>
          analyzeItem(
            raw,
            list.finalUrl
          )
      )
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

  const withDates =
    unique.filter(
      item =>
        Boolean(
          item.publishedAt
        )
    );

  const distinctTitles =
    new Set(
      unique.map(
        item =>
          item.title
      )
    ).size;

  const distinctDates =
    new Set(
      withDates.map(
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

  const dateTested =
    detailChecks.filter(
      item =>
        Boolean(
          item.publishedAt
        )
    ).length;

  const datePass =
    detailChecks.filter(
      item =>
        item.publishedAt
        &&
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

  const collectorReady =
    Boolean(
      unique.length >= 10
      &&
      distinctTitles >= 10
      &&
      detailChecks.length === 5
      &&
      detailPass === 5
      &&
      titlePass === 5
      &&
      validUrls === 5
      &&
      (
        dateTested === 0
        ||
        datePass === dateTested
      )
    );

  const proposedCollector =
    collectorReady
      ? {
          id:
            "sangmyung-cheonan-general-feed",

          name:
            "상명대학교 천안캠퍼스 공식 소식",

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

          campusFilter: {
            parameter:
              "srCampus",

            value:
              "smuc"
          },

          parser: {
            itemStrategy:
              "DL_BOARD_THUMB_CONTENT_WRAP",

            itemSelector:
              "dl.board-thumb-content-wrap",

            titleStrategy:
              "LONGEST_NON_CATEGORY_VIEW_ANCHOR",

            detailStrategy:
              "MODE_VIEW_ARTICLE_NO",

            dateStrategy:
              "UNIQUE_VISIBLE_DATE_IN_DL",

            dedupeKey:
              "ARTICLE_NO"
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
      "1.0",

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

    rawItems:
      rawItems.length,

    extracted:
      extracted.length,

    unique:
      unique.length,

    duplicateKeys,

    withDates:
      withDates.length,

    distinctTitles,

    distinctDates,

    itemSamples:
      unique.slice(
        0,
        8
      ),

    detailValidation: {
      tested:
        detailChecks.length,

      pass:
        detailPass,

      titlePass,

      dateTested,

      datePass,

      validUrls,

      checks:
        detailChecks
    },

    decision:
      collectorReady
        ? "COLLECTOR_READY"
        : "COLLECTOR_REVIEW_REQUIRED",

    proposedCollector,

    nextAction:
      collectorReady
        ? "VERIFY_SANGMYUNG_CHEONAN_ACTIVATION_READY"
        : "INSPECT_SANGMYUNG_DL_DATE_STRUCTURE",

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

        rawItems:
          report.rawItems,

        extracted:
          report.extracted,

        unique:
          report.unique,

        duplicateKeys:
          report.duplicateKeys,

        withDates:
          report.withDates,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

        itemSamples:
          report.itemSamples.slice(
            0,
            5
          ),

        detailValidation: {
          tested:
            report.detailValidation.tested,

          pass:
            report.detailValidation.pass,

          titlePass:
            report.detailValidation.titlePass,

          dateTested:
            report.detailValidation.dateTested,

          datePass:
            report.detailValidation.datePass,

          validUrls:
            report.detailValidation.validUrls
        },

        detailSamples:
          report.detailValidation.checks
            .map(
              item => ({
                articleNo:
                  item.articleNo,

                title:
                  item.title,

                publishedAt:
                  item.publishedAt,

                dateCandidates:
                  item.dateCandidates,

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