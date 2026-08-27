"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ============================================================
// 1. 기본 설정
// ============================================================

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

const INPUT_FILE = path.join(
  DATA,
  "uni-pick-next-batch-candidate-evaluation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "catholic-kwandong-candidate-collector-verification.json"
);

const UNIVERSITY_ID =
  "catholic-kwandong-university-본교";

const UNIVERSITY_NAME =
  "가톨릭관동대학교";

const OFFICIAL_ROOT =
  "https://www.cku.ac.kr/";

const DETAIL_CANDIDATE_URL =
  "https://www.cku.ac.kr/bbs/cku_kr/1202/366455/artclView.do?layout=unknown";

const BOARD_ID =
  "1202";

const MAX_DETAIL_TESTS =
  5;

// ============================================================
// 2. JSON
// ============================================================

function readJson(
  file,
  fallback = null
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      ).replace(
        /^\uFEFF/,
        ""
      )
    );
  } catch {
    return fallback;
  }
}

function atomicWrite(
  file,
  value
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  const temp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      temp,
      "utf8"
    )
  );

  fs.renameSync(
    temp,
    file
  );
}

// ============================================================
// 3. 문자열 / URL
// ============================================================

function normalizeText(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(
    value || ""
  )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#34;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(
          Number(code)
        );
      } catch {
        return _;
      }
    });
}

function stripTags(value) {
  return normalizeText(
    decodeHtml(
      String(
        value || ""
      )
        .replace(
          /<script\b[\s\S]*?<\/script>/gi,
          " "
        )
        .replace(
          /<style\b[\s\S]*?<\/style>/gi,
          " "
        )
        .replace(
          /<br\s*\/?>/gi,
          " "
        )
        .replace(
          /<[^>]+>/g,
          " "
        )
    )
  );
}

function normalizeUrl(
  value,
  base = null
) {
  if (!value) {
    return null;
  }

  try {
    const url =
      base
        ? new URL(
            decodeHtml(value),
            base
          )
        : new URL(
            decodeHtml(value)
          );

    url.hash = "";

    return url.href;
  } catch {
    return null;
  }
}

function hostname(value) {
  try {
    return new URL(
      value
    )
      .hostname
      .toLowerCase()
      .replace(
        /^www\./,
        ""
      );
  } catch {
    return null;
  }
}

function sameRootDomain(
  first,
  second
) {
  const a =
    hostname(first);

  const b =
    hostname(second);

  if (
    !a
    || !b
  ) {
    return false;
  }

  return (
    a === b
    ||
    a.endsWith(
      `.${b}`
    )
    ||
    b.endsWith(
      `.${a}`
    )
  );
}

function normalizeDate(value) {
  const match =
    String(
      value || ""
    ).match(
      /\b(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/
    );

  if (!match) {
    return null;
  }

  return [
    match[1],
    String(
      match[2]
    ).padStart(
      2,
      "0"
    ),
    String(
      match[3]
    ).padStart(
      2,
      "0"
    )
  ].join("-");
}

// ============================================================
// 4. 네트워크
// ============================================================

function curlPage(url) {
  const result =
    spawnSync(
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

        "-A",
        "Mozilla/5.0 compatible UNI-PICK CKU Collector Validator",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__UNI_PICK_META__%{http_code}|%{url_effective}",

        url
      ],
      {
        encoding:
          "utf8",

        timeout:
          45000,

        windowsHide:
          true,

        maxBuffer:
          30 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok:
        false,

      status:
        0,

      finalUrl:
        null,

      html:
        "",

      bytes:
        0,

      error:
        result.error.message
    };
  }

  const stdout =
    String(
      result.stdout || ""
    );

  const marker =
    "\n__UNI_PICK_META__";

  const markerIndex =
    stdout.lastIndexOf(
      marker
    );

  if (markerIndex < 0) {
    return {
      ok:
        false,

      status:
        0,

      finalUrl:
        null,

      html:
        stdout,

      bytes:
        Buffer.byteLength(
          stdout,
          "utf8"
        ),

      error:
        "META_MARKER_MISSING"
    };
  }

  const html =
    stdout.slice(
      0,
      markerIndex
    );

  const meta =
    stdout
      .slice(
        markerIndex
        +
        marker.length
      )
      .trim();

  const separatorIndex =
    meta.indexOf("|");

  const rawStatus =
    separatorIndex >= 0
      ? meta.slice(
          0,
          separatorIndex
        )
      : meta;

  const finalUrl =
    separatorIndex >= 0
      ? meta.slice(
          separatorIndex + 1
        )
      : url;

  const status =
    Number(
      rawStatus
    );

  return {
    ok:
      result.status === 0
      &&
      status >= 200
      &&
      status < 400
      &&
      html.length > 0,

    status,

    finalUrl:
      finalUrl || url,

    html,

    bytes:
      Buffer.byteLength(
        html,
        "utf8"
      ),

    error:
      result.status === 0
        ? null
        : (
            String(
              result.stderr || ""
            ).trim()
            ||
            `CURL_EXIT_${result.status}`
          )
  };
}

// ============================================================
// 5. Anchor 파싱
// ============================================================

function extractAnchors(
  html,
  baseUrl
) {
  const anchors =
    [];

  const anchorRegex =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (
      match =
        anchorRegex.exec(
          html
        )
    )
  ) {
    const attrs =
      match[1]
      || "";

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
      normalizeUrl(
        href,
        baseUrl
      );

    if (!url) {
      continue;
    }

    anchors.push({
      text:
        stripTags(
          match[2]
        ),

      href,

      url
    });
  }

  return anchors;
}

// ============================================================
// 6. 게시판 목록 URL 후보 생성
// ============================================================

function buildListUrlCandidates(
  detailPage
) {
  const candidates =
    new Map();

  function add(
    url,
    reason
  ) {
    const normalized =
      normalizeUrl(
        url,
        detailPage.finalUrl
        || DETAIL_CANDIDATE_URL
      );

    if (!normalized) {
      return;
    }

    if (
      !sameRootDomain(
        normalized,
        OFFICIAL_ROOT
      )
    ) {
      return;
    }

    if (
      !candidates.has(
        normalized
      )
    ) {
      candidates.set(
        normalized,
        {
          url:
            normalized,

          reasons:
            []
        }
      );
    }

    candidates
      .get(
        normalized
      )
      .reasons
      .push(
        reason
      );
  }

  const anchors =
    extractAnchors(
      detailPage.html,
      detailPage.finalUrl
      || DETAIL_CANDIDATE_URL
    );

  for (
    const anchor
    of anchors
  ) {
    const combined =
      `${anchor.text} ${anchor.href} ${anchor.url}`
        .toLowerCase();

    if (
      anchor.url.includes(
        `/bbs/cku_kr/${BOARD_ID}/`
      )
      &&
      (
        combined.includes(
          "artcllist"
        )
        ||
        combined.includes(
          "subview"
        )
        ||
        combined.includes(
          "목록"
        )
        ||
        combined.includes(
          "list"
        )
      )
    ) {
      add(
        anchor.url,
        "DETAIL_PAGE_BOARD_LINK"
      );
    }

    if (
      anchor.url.includes(
        "5787/subview.do"
      )
    ) {
      add(
        anchor.url,
        "DETAIL_PAGE_SUBVIEW_LINK"
      );
    }
  }

  add(
    `https://www.cku.ac.kr/bbs/cku_kr/${BOARD_ID}/artclList.do`,
    "STANDARD_ARTCL_LIST"
  );

  add(
    `https://www.cku.ac.kr/cku_kr/5787/subview.do`,
    "KNOWN_CKU_SUBVIEW"
  );

  add(
    `https://www.cku.ac.kr/cku_kr/5787/subview.do?enc=`,
    "KNOWN_CKU_SUBVIEW_EMPTY_ENC"
  );

  return [
    ...candidates.values()
  ];
}

// ============================================================
// 7. 목록 페이지 구조 판정
// ============================================================

function countDateSignals(html) {
  const text =
    stripTags(
      html
    );

  const matches =
    text.match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
    || [];

  return {
    total:
      matches.length,

    unique:
      new Set(
        matches.map(
          normalizeDate
        ).filter(
          Boolean
        )
      ).size
  };
}

function inspectListCandidate(
  candidate
) {
  const page =
    curlPage(
      candidate.url
    );

  if (!page.ok) {
    return {
      ...candidate,

      reachable:
        false,

      status:
        page.status,

      finalUrl:
        page.finalUrl,

      bytes:
        page.bytes,

      officialDomain:
        false,

      articleViewCount:
        0,

      articleListCount:
        0,

      boardIdCount:
        0,

      dateCount:
        0,

      uniqueDateCount:
        0,

      rowCount:
        0,

      score:
        -1000,

      error:
        page.error
    };
  }

  const anchors =
    extractAnchors(
      page.html,
      page.finalUrl
    );

  const detailAnchors =
    anchors.filter(
      anchor =>
        (
          anchor.url.includes(
            `/bbs/cku_kr/${BOARD_ID}/`
          )
          &&
          /artclView\.do/i
            .test(
              anchor.url
            )
        )
        ||
        (
          anchor.url.includes(
            "articleNo="
          )
          &&
          /cku\.ac\.kr/i
            .test(
              anchor.url
            )
        )
    );

  const dateSignals =
    countDateSignals(
      page.html
    );

  const rowCount =
    (
      page.html.match(
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
      )
      || []
    ).length;

  const articleListCount =
    (
      page.html.match(
        /artclList\.do/gi
      )
      || []
    ).length;

  const boardIdCount =
    (
      page.html.match(
        new RegExp(
          `/bbs/cku_kr/${BOARD_ID}/`,
          "gi"
        )
      )
      || []
    ).length;

  let score =
    0;

  if (
    sameRootDomain(
      page.finalUrl,
      OFFICIAL_ROOT
    )
  ) {
    score +=
      30;
  }

  if (
    detailAnchors.length >= 3
  ) {
    score +=
      40;
  }

  if (
    detailAnchors.length >= 5
  ) {
    score +=
      20;
  }

  if (
    dateSignals.total >= 3
  ) {
    score +=
      20;
  }

  if (
    rowCount >= 5
  ) {
    score +=
      15;
  }

  if (
    boardIdCount >= 3
  ) {
    score +=
      20;
  }

  if (
    page.finalUrl.includes(
      "artclView.do"
    )
  ) {
    score -=
      100;
  }

  return {
    ...candidate,

    reachable:
      true,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    officialDomain:
      sameRootDomain(
        page.finalUrl,
        OFFICIAL_ROOT
      ),

    articleViewCount:
      detailAnchors.length,

    articleListCount,

    boardIdCount,

    dateCount:
      dateSignals.total,

    uniqueDateCount:
      dateSignals.unique,

    rowCount,

    score,

    error:
      null,

    html:
      page.html
  };
}

// ============================================================
// 8. 목록 아이템 추출
// ============================================================

function extractArticleId(url) {
  if (!url) {
    return null;
  }

  const pathMatch =
    String(
      url
    ).match(
      /\/bbs\/cku_kr\/\d+\/(\d+)\/artclView\.do/i
    );

  if (pathMatch) {
    return pathMatch[1];
  }

  try {
    const parsed =
      new URL(
        url
      );

    return (
      parsed.searchParams
        .get(
          "articleNo"
        )
      ||
      parsed.searchParams
        .get(
          "artclSeq"
        )
      ||
      null
    );
  } catch {
    return null;
  }
}

function extractRows(
  html,
  baseUrl
) {
  const items =
    [];

  const rows =
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || [];

  for (
    const rowHtml
    of rows
  ) {
    const anchors =
      extractAnchors(
        rowHtml,
        baseUrl
      );

    const detailAnchor =
      anchors.find(
        anchor =>
          (
            anchor.url.includes(
              `/bbs/cku_kr/${BOARD_ID}/`
            )
            &&
            /artclView\.do/i
              .test(
                anchor.url
              )
          )
          ||
          (
            anchor.url.includes(
              "articleNo="
            )
            &&
            sameRootDomain(
              anchor.url,
              OFFICIAL_ROOT
            )
          )
      );

    if (!detailAnchor) {
      continue;
    }

    const title =
      normalizeText(
        detailAnchor.text
      );

    if (
      !title
      ||
      title.length < 2
    ) {
      continue;
    }

    const rowText =
      stripTags(
        rowHtml
      );

    const publishedAt =
      normalizeDate(
        rowText
      );

    if (!publishedAt) {
      continue;
    }

    const articleId =
      extractArticleId(
        detailAnchor.url
      );

    if (!articleId) {
      continue;
    }

    items.push({
      articleId,

      title,

      publishedAt,

      detailUrl:
        detailAnchor.url,

      detailKey:
        `ARTICLE_ID:${articleId}`
    });
  }

  return {
    rawRows:
      rows.length,

    items
  };
}

// ============================================================
// 9. 상세 검증
// ============================================================

function normalizeComparableText(
  value
) {
  return normalizeText(
    value
  )
    .replace(
      /\[.*?\]/g,
      " "
    )
    .replace(
      /[“”‘’"'`]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function detailContainsTitle(
  html,
  expectedTitle
) {
  const pageText =
    normalizeComparableText(
      stripTags(
        html
      )
    );

  const title =
    normalizeComparableText(
      expectedTitle
    );

  if (
    title
    &&
    pageText.includes(
      title
    )
  ) {
    return true;
  }

  if (
    title.length >= 20
  ) {
    const shortened =
      title.slice(
        0,
        Math.min(
          title.length,
          30
        )
      );

    if (
      pageText.includes(
        shortened
      )
    ) {
      return true;
    }
  }

  return false;
}

function detailContainsDate(
  html,
  expectedDate
) {
  const text =
    stripTags(
      html
    );

  const variants = [
    expectedDate,
    expectedDate.replace(
      /-/g,
      "."
    ),
    expectedDate.replace(
      /-/g,
      "/"
    )
  ];

  return variants.some(
    value =>
      text.includes(
        value
      )
  );
}

function validateDetails(
  items
) {
  const samples =
    [];

  for (
    const item
    of items.slice(
      0,
      MAX_DETAIL_TESTS
    )
  ) {
    const page =
      curlPage(
        item.detailUrl
      );

    const validUrl =
      page.status >= 200
      &&
      page.status < 400
      &&
      sameRootDomain(
        page.finalUrl
        || item.detailUrl,
        OFFICIAL_ROOT
      );

    const titleMatch =
      page.ok
      &&
      detailContainsTitle(
        page.html,
        item.title
      );

    const dateMatch =
      page.ok
      &&
      detailContainsDate(
        page.html,
        item.publishedAt
      );

    samples.push({
      articleId:
        item.articleId,

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
        validUrl
        &&
        titleMatch
        &&
        dateMatch,

      error:
        page.error
    });
  }

  return {
    tested:
      samples.length,

    pass:
      samples.filter(
        item =>
          item.pass
      ).length,

    titlePass:
      samples.filter(
        item =>
          item.titleMatch
      ).length,

    datePass:
      samples.filter(
        item =>
          item.dateMatch
      ).length,

    validUrls:
      samples.filter(
        item =>
          item.validUrl
      ).length,

    samples
  };
}

// ============================================================
// 10. 입력 후보 확인
// ============================================================

function findEvaluationTarget() {
  const evaluation =
    readJson(
      INPUT_FILE,
      {
        evaluatedItems: []
      }
    );

  const rows =
    evaluation.evaluatedItems
    ||
    evaluation.results
    ||
    evaluation.items
    ||
    [];

  return rows.find(
    row =>
      normalizeText(
        row.universityId
      )
      === UNIVERSITY_ID
  )
  || null;
}

// ============================================================
// 11. Main
// ============================================================

function main() {
  const target =
    findEvaluationTarget();

  const detailPage =
    curlPage(
      DETAIL_CANDIDATE_URL
    );

  if (!detailPage.ok) {
    const failure = {
      decision:
        "COLLECTOR_REVIEW_REQUIRED",

      universityId:
        UNIVERSITY_ID,

      universityName:
        UNIVERSITY_NAME,

      reasons: [
        "DETAIL_CANDIDATE_FETCH_FAILED"
      ],

      candidate:
        target?.candidate
        || null,

      detailCandidate: {
        url:
          DETAIL_CANDIDATE_URL,

        status:
          detailPage.status,

        finalUrl:
          detailPage.finalUrl,

        bytes:
          detailPage.bytes,

        error:
          detailPage.error
      },

      proposedCollector:
        null,

      nextAction:
        "REVIEW_CATHOLIC_KWANDONG_DETAIL_CANDIDATE",

      requests:
        1,

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

    atomicWrite(
      OUTPUT_FILE,
      failure
    );

    console.log(
      JSON.stringify(
        failure,
        null,
        2
      )
    );

    return;
  }

  const listCandidates =
    buildListUrlCandidates(
      detailPage
    );

  const inspectedLists =
    listCandidates
      .map(
        inspectListCandidate
      )
      .sort(
        (a, b) =>
          b.score
          -
          a.score
      );

  const bestList =
    inspectedLists.find(
      item =>
        item.reachable
        &&
        item.officialDomain
        &&
        item.articleViewCount >= 3
        &&
        item.dateCount >= 3
        &&
        !String(
          item.finalUrl || ""
        ).includes(
          "artclView.do"
        )
    )
    || null;

  if (!bestList) {
    const failure = {
      decision:
        "COLLECTOR_REVIEW_REQUIRED",

      universityId:
        UNIVERSITY_ID,

      universityName:
        UNIVERSITY_NAME,

      reasons: [
        "LIST_PAGE_NOT_CONFIRMED"
      ],

      candidate:
        target?.candidate
        || null,

      detailCandidate: {
        url:
          DETAIL_CANDIDATE_URL,

        status:
          detailPage.status,

        finalUrl:
          detailPage.finalUrl,

        bytes:
          detailPage.bytes
      },

      listCandidates:
        inspectedLists.map(
          item => ({
            url:
              item.url,

            reasons:
              item.reasons,

            reachable:
              item.reachable,

            status:
              item.status,

            finalUrl:
              item.finalUrl,

            bytes:
              item.bytes,

            officialDomain:
              item.officialDomain,

            articleViewCount:
              item.articleViewCount,

            articleListCount:
              item.articleListCount,

            boardIdCount:
              item.boardIdCount,

            dateCount:
              item.dateCount,

            uniqueDateCount:
              item.uniqueDateCount,

            rowCount:
              item.rowCount,

            score:
              item.score,

            error:
              item.error
          })
        ),

      proposedCollector:
        null,

      nextAction:
        "INSPECT_CATHOLIC_KWANDONG_BOARD_STRUCTURE",

      requests:
        1
        +
        inspectedLists.length,

      outputFile:
        OUTPUT_FILE,

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

    atomicWrite(
      OUTPUT_FILE,
      failure
    );

    console.log(
      JSON.stringify(
        failure,
        null,
        2
      )
    );

    return;
  }

  const extracted =
    extractRows(
      bestList.html,
      bestList.finalUrl
    );

  const uniqueMap =
    new Map();

  let duplicateKeys =
    0;

  for (
    const item
    of extracted.items
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

  const uniqueItems =
    [
      ...uniqueMap.values()
    ];

  const detailValidation =
    validateDetails(
      uniqueItems
    );

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

  const collectorReady =
    uniqueItems.length >= 5
    &&
    duplicateKeys === 0
    &&
    detailValidation.tested > 0
    &&
    detailValidation.pass
      ===
      detailValidation.tested;

  const proposedCollector =
    collectorReady
      ? {
          id:
            "catholic-kwandong-general-feed",

          name:
            "가톨릭관동대학교 공지사항",

          category:
            "school_notice",

          sourceType:
            "official",

          collectionType:
            "custom_html",

          listUrl:
            bestList.finalUrl,

          campusScope:
            "CAMPUS_SPECIFIC",

          contentScope:
            "GENERAL_UNIVERSITY_UPDATES",

          parser: {
            itemStrategy:
              "CKU_BOARD_TR_WITH_ARTICLE_DETAIL",

            itemSelector:
              "tr",

            titleStrategy:
              "ARTCL_VIEW_ANCHOR",

            dateStrategy:
              "ROW_DATE",

            detailStrategy:
              "CKU_ARTCL_VIEW",

            detailIdParameter:
              "ARTICLE_ID",

            dedupeKey:
              "ARTICLE_ID"
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

  const report = {
    decision:
      collectorReady
        ? "COLLECTOR_READY"
        : "COLLECTOR_REVIEW_REQUIRED",

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    inputCandidate: {
      url:
        DETAIL_CANDIDATE_URL,

      evaluationCandidate:
        target?.candidate
        || null
    },

    detailCandidate: {
      status:
        detailPage.status,

      finalUrl:
        detailPage.finalUrl,

      bytes:
        detailPage.bytes,

      officialDomain:
        sameRootDomain(
          detailPage.finalUrl
          || DETAIL_CANDIDATE_URL,
          OFFICIAL_ROOT
        )
    },

    selectedList: {
      url:
        bestList.url,

      finalUrl:
        bestList.finalUrl,

      status:
        bestList.status,

      bytes:
        bestList.bytes,

      score:
        bestList.score,

      articleViewCount:
        bestList.articleViewCount,

      dateCount:
        bestList.dateCount,

      uniqueDateCount:
        bestList.uniqueDateCount,

      rowCount:
        bestList.rowCount,

      officialDomain:
        bestList.officialDomain
    },

    collector: {
      rawRows:
        extracted.rawRows,

      extracted:
        extracted.items.length,

      unique:
        uniqueItems.length,

      duplicateKeys,

      distinctTitles,

      distinctDates
    },

    samples:
      uniqueItems.slice(
        0,
        5
      ),

    detailValidation: {
      tested:
        detailValidation.tested,

      pass:
        detailValidation.pass,

      titlePass:
        detailValidation.titlePass,

      datePass:
        detailValidation.datePass,

      validUrls:
        detailValidation.validUrls
    },

    detailSamples:
      detailValidation.samples,

    listCandidates:
      inspectedLists.map(
        item => ({
          url:
            item.url,

          reasons:
            item.reasons,

          reachable:
            item.reachable,

          status:
            item.status,

          finalUrl:
            item.finalUrl,

          articleViewCount:
            item.articleViewCount,

          dateCount:
            item.dateCount,

          rowCount:
            item.rowCount,

          score:
            item.score,

          error:
            item.error
        })
      ),

    proposedCollector,

    nextAction:
      collectorReady
        ? "VERIFY_CATHOLIC_KWANDONG_ACTIVATION_READY"
        : "REVIEW_CATHOLIC_KWANDONG_COLLECTOR_STRUCTURE",

    requests:
      1
      +
      inspectedLists.length
      +
      detailValidation.tested,

    outputFile:
      OUTPUT_FILE,

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

  atomicWrite(
    OUTPUT_FILE,
    report
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );
}

// ============================================================
// 12. 실행
// ============================================================

if (
  require.main === module
) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status:
            "FATAL",

          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          error: {
            name:
              error?.name
              || "Error",

            message:
              error?.message
              || String(error),

            stack:
              error?.stack
              || null
          },

          safety: {
            readOnly:
              true,

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
      1;
  }
}