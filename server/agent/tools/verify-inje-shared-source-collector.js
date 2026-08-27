"use strict";

const { execFileSync } = require("child_process");

// ============================================================
// 1. 기본 설정
// ============================================================

const LIST_URL =
  "https://scsc.inje.ac.kr/scsc/community/news.do?mode=list";

const UNIVERSITY_IDS = [
  "inje-university-본교",
  "inje-university-제2캠퍼"
];

const UNIVERSITY_NAMES = [
  "인제대학교",
  "인제대학교 제2캠퍼"
];

const CANONICAL_OWNER =
  "inje-university-본교";

const SOURCE_ID =
  "inje-shared-general-feed";

const SOURCE_NAME =
  "인제대학교 공통 소식";

const MAX_DETAIL_TESTS =
  5;

// ============================================================
// 2. 공통 유틸
// ============================================================

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
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

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value).trim()
      );

    url.hash = "";

    return url.href;
  } catch {
    return null;
  }
}

function extractArticleNo(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        value,
        LIST_URL
      );

    const articleNo =
      url.searchParams.get(
        "articleNo"
      );

    return /^\d+$/.test(
      articleNo || ""
    )
      ? articleNo
      : null;
  } catch {
    const match =
      String(value).match(
        /[?&]articleNo=(\d+)/i
      );

    return match
      ? match[1]
      : null;
  }
}

function officialDomain(url) {
  if (!url) {
    return false;
  }

  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase();

    return (
      host === "scsc.inje.ac.kr"
      ||
      host.endsWith(".inje.ac.kr")
      ||
      host === "inje.ac.kr"
    );
  } catch {
    return false;
  }
}

// ============================================================
// 3. HTTP 요청
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
          "Mozilla/5.0 UNI-PICK Inje Shared Collector Validator",

          "--header",
          "Accept: text/html,application/xhtml+xml",

          "--header",
          "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

          "--write-out",
          "\n__UNI_PICK_STATUS__:%{http_code}\n__UNI_PICK_URL__:%{url_effective}",

          url
        ],
        {
          encoding:
            "utf8",

          windowsHide:
            true,

          maxBuffer:
            20 * 1024 * 1024
        }
      );

    const statusMatch =
      output.match(
        /\n__UNI_PICK_STATUS__:(\d{3})/
      );

    const finalUrlMatch =
      output.match(
        /\n__UNI_PICK_URL__:(.+)$/s
      );

    const body =
      output.replace(
        /\n__UNI_PICK_STATUS__:\d{3}\n__UNI_PICK_URL__:.+$/s,
        ""
      );

    const status =
      statusMatch
        ? Number(
            statusMatch[1]
          )
        : 0;

    const finalUrl =
      finalUrlMatch
        ? finalUrlMatch[1].trim()
        : url;

    return {
      ok:
        status >= 200
        &&
        status < 400
        &&
        body.length > 0,

      status,

      finalUrl,

      bytes:
        Buffer.byteLength(
          body,
          "utf8"
        ),

      body,

      error:
        null
    };
  } catch (error) {
    return {
      ok:
        false,

      status:
        0,

      finalUrl:
        null,

      bytes:
        0,

      body:
        "",

      error:
        error?.stderr
          ? String(
              error.stderr
            )
          : (
              error?.message
              || String(error)
            )
    };
  }
}

// ============================================================
// 4. 목록 행 추출
// ============================================================

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}

function extractTitleAnchor(rowHtml) {
  const titleCell =
    rowHtml.match(
      /<td\b[^>]*class=["'][^"']*\bb-td-title\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );

  if (!titleCell) {
    return null;
  }

  const anchor =
    titleCell[1].match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );

  if (!anchor) {
    return null;
  }

  const href =
    decodeHtml(
      anchor[1]
    );

  const title =
    normalizeText(
      anchor[2]
    );

  let detailUrl =
    null;

  try {
    detailUrl =
      new URL(
        href,
        LIST_URL
      ).href;
  } catch {
    return null;
  }

  const articleNo =
    extractArticleNo(
      detailUrl
    );

  if (
    !articleNo
    ||
    !title
  ) {
    return null;
  }

  return {
    articleNo,
    title,
    detailUrl
  };
}

function extractRowDate(rowHtml) {
  const desktopCells =
    [
      ...rowHtml.matchAll(
        /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
      )
    ];

  for (
    const cell
    of desktopCells
  ) {
    const text =
      normalizeText(
        cell[2]
      );

    const date =
      normalizeDate(
        text
      );

    if (date) {
      return date;
    }
  }

  const mobileDate =
    rowHtml.match(
      /<span\b[^>]*class=["'][^"']*\bb-date\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );

  if (mobileDate) {
    return normalizeDate(
      normalizeText(
        mobileDate[1]
      )
    );
  }

  return null;
}

function parseRow(rowHtml) {
  const titleData =
    extractTitleAnchor(
      rowHtml
    );

  if (!titleData) {
    return null;
  }

  const publishedAt =
    extractRowDate(
      rowHtml
    );

  if (!publishedAt) {
    return null;
  }

  return {
    articleNo:
      titleData.articleNo,

    title:
      titleData.title,

    publishedAt,

    detailUrl:
      titleData.detailUrl,

    detailKey:
      `ARTICLE_NO:${titleData.articleNo}`
  };
}

// ============================================================
// 5. 상세페이지 검증
// ============================================================

function normalizeComparable(value) {
  return normalizeText(
    value
  )
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function detailContainsTitle(
  html,
  expectedTitle
) {
  const expected =
    normalizeComparable(
      expectedTitle
    );

  const documentText =
    normalizeComparable(
      html
    );

  if (
    !expected
    ||
    !documentText
  ) {
    return false;
  }

  if (
    documentText.includes(
      expected
    )
  ) {
    return true;
  }

  if (
    expected.length > 25
  ) {
    const shortened =
      expected.slice(
        0,
        Math.floor(
          expected.length * 0.7
        )
      );

    return documentText.includes(
      shortened
    );
  }

  return false;
}

function detailContainsDate(
  html,
  expectedDate
) {
  const [
    year,
    month,
    day
  ] =
    expectedDate
      .split("-")
      .map(Number);

  if (
    !year
    ||
    !month
    ||
    !day
  ) {
    return false;
  }

  const text =
    normalizeText(
      html
    );

  const patterns = [
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,

    `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`,

    `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,

    `${year}.${month}.${day}`,

    `${year}-${month}-${day}`,

    `${year}/${month}/${day}`
  ];

  return patterns.some(
    pattern =>
      text.includes(
        pattern
      )
  );
}

function validateDetail(item) {
  const page =
    fetchPage(
      item.detailUrl
    );

  const validUrl =
    Boolean(
      page.ok
      &&
      page.status >= 200
      &&
      page.status < 400
      &&
      officialDomain(
        page.finalUrl
      )
    );

  const titleMatch =
    Boolean(
      validUrl
      &&
      detailContainsTitle(
        page.body,
        item.title
      )
    );

  const dateMatch =
    Boolean(
      validUrl
      &&
      detailContainsDate(
        page.body,
        item.publishedAt
      )
    );

  return {
    articleNo:
      item.articleNo,

    title:
      item.title,

    publishedAt:
      item.publishedAt,

    url:
      item.detailUrl,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    validUrl,

    titleMatch,

    dateMatch,

    pass:
      Boolean(
        validUrl
        &&
        titleMatch
        &&
        dateMatch
      ),

    error:
      page.error
  };
}

// ============================================================
// 6. SHARED_SOURCE 범위 검증
// ============================================================

function inspectScope(html) {
  const text =
    normalizeText(
      html
    );

  const signals = {
    mentionsInjeUniversity:
      /인제대학교|인제대/.test(
        text
      ),

    mentionsMainCampus:
      /본교/.test(
        text
      ),

    mentionsSecondCampus:
      /제2캠퍼/.test(
        text
      ),

    mentionsKimhae:
      /김해/.test(
        text
      ),

    mentionsBusan:
      /부산/.test(
        text
      ),

    mentionsScsc:
      /SCSC|지속가능|sustainability/i.test(
        text
      )
  };

  const sharedEligible =
    Boolean(
      signals.mentionsInjeUniversity
      &&
      !signals.mentionsMainCampus
      &&
      !signals.mentionsSecondCampus
      &&
      signals.mentionsScsc
    );

  return {
    classification:
      sharedEligible
        ? "SHARED_SOURCE_ELIGIBLE"
        : "SHARED_SOURCE_REVIEW_REQUIRED",

    sharedEligible,

    signals,

    reason:
      sharedEligible
        ? "특정 캠퍼스 전용 표기 없이 인제대학교 전체 명칭과 SCSC 공통 소식 구조가 확인됩니다."
        : "캠퍼스 범위 또는 공통 source 성격을 추가 검토해야 합니다."
  };
}

// ============================================================
// 7. Collector 검증
// ============================================================

function validateCollector() {
  const page =
    fetchPage(
      LIST_URL
    );

  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    return {
      success:
        false,

      page,

      scope:
        null,

      rawRows:
        0,

      extracted:
        [],

      unique:
        [],

      duplicateKeys:
        0,

      detailSamples:
        []
    };
  }

  const rawRows =
    extractRows(
      page.body
    );

  const extracted =
    rawRows
      .map(
        row =>
          parseRow(
            row
          )
      )
      .filter(Boolean);

  const uniqueMap =
    new Map();

  let duplicateKeys =
    0;

  for (
    const item
    of extracted
  ) {
    if (
      uniqueMap.has(
        item.detailKey
      )
    ) {
      duplicateKeys +=
        1;

      continue;
    }

    uniqueMap.set(
      item.detailKey,
      item
    );
  }

  const unique =
    [
      ...uniqueMap.values()
    ];

  const detailSamples =
    unique
      .slice(
        0,
        MAX_DETAIL_TESTS
      )
      .map(
        validateDetail
      );

  const scope =
    inspectScope(
      page.body
    );

  const detailPass =
    detailSamples.filter(
      item =>
        item.pass
    ).length;

  const titlePass =
    detailSamples.filter(
      item =>
        item.titleMatch
    ).length;

  const datePass =
    detailSamples.filter(
      item =>
        item.dateMatch
    ).length;

  const validUrls =
    detailSamples.filter(
      item =>
        item.validUrl
    ).length;

  const distinctTitles =
    new Set(
      unique.map(
        item =>
          normalizeComparable(
            item.title
          )
      )
    ).size;

  const distinctDates =
    new Set(
      unique.map(
        item =>
          item.publishedAt
      )
    ).size;

  const success =
    Boolean(
      scope.sharedEligible
      &&
      rawRows.length >= 10
      &&
      extracted.length >= 10
      &&
      unique.length >= 10
      &&
      duplicateKeys === 0
      &&
      distinctTitles >= 10
      &&
      distinctDates >= 5
      &&
      detailSamples.length === 5
      &&
      detailPass === 5
      &&
      titlePass === 5
      &&
      datePass === 5
      &&
      validUrls === 5
    );

  return {
    success,

    page,

    scope,

    rawRows:
      rawRows.length,

    extracted,

    unique,

    duplicateKeys,

    distinctTitles,

    distinctDates,

    detailSamples,

    detailValidation: {
      tested:
        detailSamples.length,

      pass:
        detailPass,

      titlePass,

      datePass,

      validUrls
    }
  };
}

// ============================================================
// 8. 메인
// ============================================================

function main() {
  const validation =
    validateCollector();

  if (
    !validation.page
    ||
    !validation.page.ok
  ) {
    console.log(
      JSON.stringify(
        {
          decision:
            "COLLECTOR_REVIEW_REQUIRED",

          universityIds:
            UNIVERSITY_IDS,

          universityNames:
            UNIVERSITY_NAMES,

          canonicalOwner:
            CANONICAL_OWNER,

          sourcePolicy: {
            campusScope:
              "SHARED_SOURCE",

            duplicateStorage:
              false,

            collectOnce:
              true,

            visibleToCampuses:
              UNIVERSITY_IDS
          },

          list: {
            status:
              validation.page?.status
              || 0,

            finalUrl:
              validation.page?.finalUrl
              || null,

            bytes:
              validation.page?.bytes
              || 0
          },

          error:
            validation.page?.error
            || "LIST_FETCH_FAILED",

          proposedCollector:
            null,

          nextAction:
            "REVIEW_INJE_SHARED_SOURCE_COLLECTOR",

          hashSafe:
            true,

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
        },
        null,
        2
      )
    );

    process.exitCode =
      2;

    return;
  }

  const proposedCollector =
    validation.success
      ? {
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
            "SHARED_SOURCE",

          contentScope:
            "GENERAL_UNIVERSITY_UPDATES",

          canonicalOwner:
            CANONICAL_OWNER,

          visibleToCampuses:
            UNIVERSITY_IDS,

          duplicateStorage:
            false,

          collectOnce:
            true,

          parser: {
            itemStrategy:
              "BOARD_TABLE_TR_WITH_ARTICLE_NO",

            itemSelector:
              "table.board-table tbody tr",

            titleStrategy:
              "B_TD_TITLE_ANCHOR",

            titleSelector:
              "td.b-td-title a",

            dateStrategy:
              "ROW_DATE_CELL_WITH_MOBILE_FALLBACK",

            dateSelector:
              "td:nth-of-type(4)",

            mobileDateSelector:
              "span.b-date",

            detailStrategy:
              "MODE_VIEW_ARTICLE_NO",

            detailIdParameter:
              "articleNo",

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

  const result = {
    decision:
      validation.success
        ? "COLLECTOR_READY"
        : "COLLECTOR_REVIEW_REQUIRED",

    universityIds:
      UNIVERSITY_IDS,

    universityNames:
      UNIVERSITY_NAMES,

    canonicalOwner:
      CANONICAL_OWNER,

    sourcePolicy: {
      campusScope:
        "SHARED_SOURCE",

      duplicateStorage:
        false,

      collectOnce:
        true,

      visibleToCampuses:
        UNIVERSITY_IDS
    },

    list: {
      status:
        validation.page.status,

      finalUrl:
        validation.page.finalUrl,

      bytes:
        validation.page.bytes
    },

    scope:
      validation.scope,

    collector: {
      rawRows:
        validation.rawRows,

      extracted:
        validation.extracted.length,

      unique:
        validation.unique.length,

      duplicateKeys:
        validation.duplicateKeys,

      distinctTitles:
        validation.distinctTitles,

      distinctDates:
        validation.distinctDates
    },

    samples:
      validation.unique.slice(
        0,
        5
      ),

    detailValidation:
      validation.detailValidation,

    detailSamples:
      validation.detailSamples,

    proposedCollector,

    nextAction:
      validation.success
        ? "VERIFY_INJE_SHARED_SOURCE_ACTIVATION_READY"
        : "REVIEW_INJE_SHARED_SOURCE_COLLECTOR",

    requests:
      1
      +
      validation.detailSamples.length,

    hashSafe:
      true,

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

  if (
    !validation.success
  ) {
    process.exitCode =
      2;
  }
}

main();