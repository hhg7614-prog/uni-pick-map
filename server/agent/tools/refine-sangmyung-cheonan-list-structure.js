"use strict";

/**
 * UNI PICK
 * Sangmyung University Cheonan List Structure Refiner v1
 *
 * 목적:
 * ---------------------------------------------------------
 * 상명대학교 천안캠퍼스 상명공지 목록에서
 * 각 articleNo가 속한 실제 게시물 container와
 * 해당 게시일을 정확히 추출한다.
 *
 * 이전 문제:
 * ---------------------------------------------------------
 * 목록 18건 / 제목 17종 / 상세 URL 5/5 / 제목 5/5는 정상.
 * 그러나 날짜가 대부분 2026-08-19로 반복되어
 * findContainingBlock()이 너무 큰 범위를 잡은 것으로 판단.
 *
 * 이번 방식:
 * ---------------------------------------------------------
 * 1. 목록 HTML의 TR / LI 후보를 직접 순회
 * 2. mode=view + articleNo 링크가 있는 container만 게시물로 인정
 * 3. container 내부 날짜만 추출
 * 4. articleNo 기준 중복 제거
 * 5. 상세 5건에서 제목+날짜 재검증
 *
 * 안전:
 * read-only
 * curl TLS 우회 없음
 * catalog/store/preview/queue 수정 없음
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
  "sangmyung-cheonan-list-refinement.json"
);

const LIST_URL =
  "https://www.smu.ac.kr/smuchina/community/sm_notice.do?mode=list&srCampus=smuc";

const UNIVERSITY_ID =
  "sangmyung-university-제2캠퍼";

const UNIVERSITY_NAME =
  "상명대학교 제2캠퍼";

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
      host === "smu.ac.kr"
      ||
      host.endsWith(".smu.ac.kr")
    );
  } catch {
    return false;
  }
}

function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value)
          .replace(/&amp;/gi, "&")
          .trim(),
        base
      );

    url.hash = "";

    return url.href;
  } catch {
    return null;
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
        "Mozilla/5.0 compatible UNI-PICK Sangmyung Refiner",

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
      )
  };
}

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

  return (
    `${match[1]}-`
    +
    `${String(match[2]).padStart(2, "0")}-`
    +
    String(match[3]).padStart(2, "0")
  );
}

function extractContainers(html) {
  const results = [];

  const definitions = [
    {
      type: "TR",
      regex:
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    },
    {
      type: "LI",
      regex:
        /<li\b[^>]*>[\s\S]*?<\/li>/gi
    }
  ];

  for (
    const definition
    of definitions
  ) {
    const blocks =
      html.match(
        definition.regex
      )
      || [];

    for (
      const raw
      of blocks
    ) {
      results.push({
        type:
          definition.type,
        raw
      });
    }
  }

  return results;
}

function extractDetailAnchor(
  raw,
  baseUrl
) {
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

    const url =
      normalizeUrl(
        href,
        baseUrl
      );

    if (!url) {
      continue;
    }

    try {
      const parsed =
        new URL(url);

      if (
        parsed.searchParams.get("mode")
          !== "view"
      ) {
        continue;
      }

      const articleNo =
        parsed.searchParams.get(
          "articleNo"
        );

      if (
        !articleNo
        ||
        !/^\d+$/.test(articleNo)
      ) {
        continue;
      }

      const title =
        plain(
          match[2]
        );

      if (
        !title
        ||
        title.length < 4
      ) {
        continue;
      }

      return {
        articleNo,
        title,
        detailUrl:
          url
      };

    } catch {
      continue;
    }
  }

  return null;
}

function extractDatesFromContainer(raw) {
  const text =
    plain(raw);

  const matches =
    text.match(
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

function analyzeContainer(
  container,
  baseUrl
) {
  const detail =
    extractDetailAnchor(
      container.raw,
      baseUrl
    );

  if (!detail) {
    return null;
  }

  const dates =
    extractDatesFromContainer(
      container.raw
    );

  return {
    structure:
      container.type,

    articleNo:
      detail.articleNo,

    title:
      detail.title,

    detailUrl:
      detail.detailUrl,

    publishedAt:
      dates.length === 1
        ? dates[0]
        : null,

    dateCandidates:
      dates,

    detailKey:
      `ARTICLE:${detail.articleNo}`,

    text:
      plain(
        container.raw
      ).slice(0, 800)
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
      "SANGMYUNG_LIST_UNREACHABLE"
    );
  }

  const containers =
    extractContainers(
      list.html
    );

  const analyzed =
    containers
      .map(
        container =>
          analyzeContainer(
            container,
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

  const structureCounts =
    unique.reduce(
      (acc, item) => {
        acc[item.structure] =
          (
            acc[item.structure]
            || 0
          ) + 1;

        return acc;
      },
      {}
    );

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
              "TR_OR_LI_WITH_ARTICLE_VIEW_LINK",

            titleStrategy:
              "DETAIL_ANCHOR_TEXT",

            dateStrategy:
              "UNIQUE_VISIBLE_DATE_IN_ITEM",

            detailStrategy:
              "ARTICLE_NO_QUERY",

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

    containers:
      containers.length,

    analyzed:
      analyzed.length,

    unique:
      unique.length,

    structureCounts,

    withDates:
      withDates.length,

    distinctTitles,

    distinctDates,

    samples:
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
        : "LIST_STRUCTURE_REVIEW_REQUIRED",

    proposedCollector,

    nextAction:
      collectorReady
        ? "VERIFY_SANGMYUNG_CHEONAN_ACTIVATION_READY"
        : "INSPECT_SANGMYUNG_DATE_CELL",

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

        containers:
          report.containers,

        analyzed:
          report.analyzed,

        unique:
          report.unique,

        structureCounts:
          report.structureCounts,

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