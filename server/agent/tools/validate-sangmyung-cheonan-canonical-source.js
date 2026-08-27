"use strict";

/**
 * UNI PICK
 * Sangmyung University Cheonan Canonical Source Validator v1
 *
 * 대상:
 * 상명대학교 제2캠퍼스(천안)
 *
 * 핵심 정책:
 * ---------------------------------------------------------
 * 기존 officialUrl = https://www.smuc.ac.kr
 * 는 TLS_HOSTNAME_MISMATCH 이력이 있으므로 사용하지 않는다.
 *
 * canonical source 후보:
 * https://www.smu.ac.kr/smuchina/community/sm_notice.do
 * ?mode=list&srCampus=smuc
 *
 * 검증:
 * - 공식 smu.ac.kr 도메인
 * - 목록 HTTP 200
 * - mode=view + articleNo 상세 링크
 * - 제목 다양성
 * - 날짜 다양성
 * - 상세 5건 HTTP 200
 * - 목록 제목이 상세 HTML 안에 실제 존재
 * - 목록 날짜가 상세 HTML 안에 존재
 *
 * 중요:
 * 기존 실패 원인:
 * detail <title> = "중국어권 지역학전공"
 * 이므로 document title을 게시물 제목으로 사용하지 않는다.
 *
 * Transport:
 * curl.exe
 * TLS 검증 유지
 * -k / --insecure 금지
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
  "sangmyung-cheonan-canonical-validation.json"
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

function plain(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  const text =
    String(value)
      .replace(/&amp;/gi, "&")
      .trim();

  if (
    /^javascript:/i.test(text)
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

    return /^https?:$/.test(
      url.protocol
    )
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
      host === "smu.ac.kr"
      ||
      host.endsWith(".smu.ac.kr")
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
        "Mozilla/5.0 compatible UNI-PICK Sangmyung Cheonan Validator",

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
    stdout.slice(
      0,
      index
    );

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
    return null;
  }

  return (
    `${match[1]}-`
    +
    `${String(match[2]).padStart(2, "0")}-`
    +
    String(match[3]).padStart(2, "0")
  );
}


/* =========================================================
 * 게시물 링크
 * ========================================================= */

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

    if (!href) {
      continue;
    }

    const url =
      normalizeUrl(
        href,
        baseUrl
      );

    const title =
      plain(
        match[2]
      );

    output.push({
      title,
      href,
      url
    });
  }

  return output;
}

function isArticleDetail(url) {
  if (
    !url
    ||
    !officialDomain(url)
  ) {
    return false;
  }

  try {
    const parsed =
      new URL(url);

    return (
      parsed.searchParams.get("mode")
        === "view"
      &&
      /^\d+$/.test(
        parsed.searchParams.get(
          "articleNo"
        )
        || ""
      )
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * 목록 item 주변 날짜 찾기
 * ========================================================= */

function findContainingBlock(
  html,
  href
) {
  const escaped =
    href.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const patterns = [
    new RegExp(
      `<tr\\b[^>]*>[\\s\\S]*?href=["'][^"']*${escaped}[^"']*["'][\\s\\S]*?<\\/tr>`,
      "i"
    ),

    new RegExp(
      `<li\\b[^>]*>[\\s\\S]*?href=["'][^"']*${escaped}[^"']*["'][\\s\\S]*?<\\/li>`,
      "i"
    )
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      html.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return null;
}

function extractListItems(
  html,
  baseUrl
) {
  const anchors =
    extractAnchors(
      html,
      baseUrl
    )
      .filter(
        item =>
          item.title
          &&
          item.title.length >= 4
          &&
          isArticleDetail(
            item.url
          )
      );

  const items = [];

  for (
    const anchor
    of anchors
  ) {
    const parsed =
      new URL(
        anchor.url
      );

    const articleNo =
      parsed.searchParams.get(
        "articleNo"
      );

    const block =
      findContainingBlock(
        html,
        anchor.href
      );

    const publishedAt =
      block
        ? normalizeDate(block)
        : null;

    items.push({
      articleNo,
      title:
        anchor.title,
      publishedAt,
      detailUrl:
        anchor.url,
      detailKey:
        `ARTICLE:${articleNo}`
    });
  }

  return [
    ...new Map(
      items.map(
        item => [
          item.detailKey,
          item
        ]
      )
    ).values()
  ];
}


/* =========================================================
 * Detail validation
 * ========================================================= */

function key(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function titleMatches(
  title,
  html
) {
  const expected =
    key(title);

  const page =
    key(html);

  return Boolean(
    expected
    &&
    page.includes(expected)
  );
}

function dateMatches(
  publishedAt,
  html
) {
  if (!publishedAt) {
    return false;
  }

  const [
    year,
    month,
    day
  ] =
    publishedAt
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
      officialDomain:
        false,
      titleMatch:
        false,
      dateMatch:
        false,
      pass:
        false
    };
  }

  const official =
    officialDomain(
      page.finalUrl
    );

  const titleMatch =
    titleMatches(
      item.title,
      page.html
    );

  /*
   * 목록 날짜가 정상 추출된 경우에만
   * detail date match를 필수로 한다.
   */
  const dateMatch =
    item.publishedAt
      ? dateMatches(
          item.publishedAt,
          page.html
        )
      : null;

  const pass =
    Boolean(
      official
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
    officialDomain:
      official,
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

  const items =
    extractListItems(
      list.html,
      list.finalUrl
    );

  const withDates =
    items.filter(
      item =>
        Boolean(
          item.publishedAt
        )
    );

  const distinctTitles =
    new Set(
      items.map(
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
    of items.slice(
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

  const canonicalReady =
    Boolean(
      items.length >= 5
      &&
      distinctTitles >= 5
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

  const proposedSource =
    canonicalReady
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
              "ARTICLE_VIEW_LINK_CONTAINER",

            titleStrategy:
              "VIEW_ANCHOR_TEXT",

            detailStrategy:
              "MODE_VIEW_ARTICLE_NO",

            detailUrlPattern:
              "mode=view&articleNo={articleNo}",

            dedupeKey:
              "ARTICLE_NO",

            dateStrategy:
              "VISIBLE_DATE_NEAR_DETAIL_LINK"
          },

          verified:
            false,

          enabled:
            false,

          status:
            "canonical_validated_pending_activation_check",

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

    oldOfficialUrl:
      "https://www.smuc.ac.kr/",

    canonicalListUrl:
      LIST_URL,

    status:
      list.status,

    finalUrl:
      list.finalUrl,

    bytes:
      list.bytes,

    extracted:
      items.length,

    withDates:
      withDates.length,

    distinctTitles,

    distinctDates,

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
      canonicalReady
        ? "CANONICAL_SOURCE_VALIDATED"
        : "CANONICAL_SOURCE_REVIEW_REQUIRED",

    proposedSource,

    nextAction:
      canonicalReady
        ? "VERIFY_SANGMYUNG_CHEONAN_ACTIVATION_READY"
        : "INSPECT_SANGMYUNG_LIST_STRUCTURE",

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

        finalUrl:
          report.finalUrl,

        bytes:
          report.bytes,

        extracted:
          report.extracted,

        withDates:
          report.withDates,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

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

        samples:
          report.detailValidation.checks
            .map(
              item => ({
                articleNo:
                  item.articleNo,
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