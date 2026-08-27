"use strict";

/**
 * UNI PICK - Changshin University Source Revalidator v1
 *
 * 대상
 * ---------------------------------------------------------
 * 창신대학교
 * https://www.cs.ac.kr/board/bulletin
 *
 * 현재 상태
 * ---------------------------------------------------------
 * QUALITY_REVIEW
 * 기존 score: 55 / D
 *
 * 정책
 * ---------------------------------------------------------
 * 반드시 정확한 "공지사항/뉴스/행사"일 필요는 없다.
 *
 * 공식 대학 사이트 안에서 다음과 비슷한 소식이라면 허용:
 * - 일반공지
 * - 대학소식
 * - 학사
 * - 모집
 * - 장학
 * - 취업/채용
 * - 프로그램
 * - 행사
 * - 학생지원
 * - 일반안내
 *
 * 이번 단계 목표
 * ---------------------------------------------------------
 * 1. 목록 HTTP 200 확인
 * 2. 공식 cs.ac.kr 도메인 확인
 * 3. TR / LI / ARTICLE 반복 구조 분석
 * 4. 제목 + 날짜 + 상세 URL/ID가 같은 container에 있는지 확인
 * 5. 최소 5개 게시물 확보
 * 6. 상세 5건 요청
 * 7. 제목/날짜/공식도메인 검증
 * 8. selector 후보 생성
 *
 * 성공
 * ---------------------------------------------------------
 * FLEXIBLE_SOURCE_VALIDATED
 *   또는
 * COLLECTOR_READY
 *
 * 안전
 * ---------------------------------------------------------
 * - Catalog 수정 없음
 * - Store 수정 없음
 * - Preview 수정 없음
 * - Queue 수정 없음
 * - Git/Deploy 없음
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
  "changshin-source-revalidation.json"
);

const UNIVERSITY_ID =
  "changshin-university-본교";

const UNIVERSITY_NAME =
  "창신대학교";

const LIST_URL =
  "https://www.cs.ac.kr/board/bulletin";

const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_TEST_LIMIT = 5;


/* =========================================================
 * 운영 파일
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
      host === "cs.ac.kr"
      ||
      host.endsWith(
        ".cs.ac.kr"
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
              "Mozilla/5.0 compatible UNI-PICK Changshin Source Revalidator",

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

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

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

      contentType:
        "",

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
          error?.cause?.code || null,

        causeMessage:
          error?.cause?.message || null
      }
    };

  } finally {
    clearTimeout(
      timer
    );
  }
}


/* =========================================================
 * Date
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);

  let match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (match) {
    const year =
      Number(
        match[1]
      );

    const month =
      Number(
        match[2]
      );

    const day =
      Number(
        match[3]
      );

    if (
      month >= 1
      &&
      month <= 12
      &&
      day >= 1
      &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }


  match =
    text.match(
      /(?:^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\D|$)/
    );

  if (match) {
    const year =
      2000 +
      Number(
        match[1]
      );

    const month =
      Number(
        match[2]
      );

    const day =
      Number(
        match[3]
      );

    if (
      month >= 1
      &&
      month <= 12
      &&
      day >= 1
      &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }


  return null;
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

    const titleAttribute =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
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

    output.push({
      label:
        plain(
          body
        ),

      titleAttribute:
        titleAttribute
        ? plain(
            titleAttribute
          )
        : null,

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
 * Detail URL 판단
 * ========================================================= */

function looksLikeDetailUrl(
  url,
  listUrl
) {
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
    const value =
      new URL(
        url
      );

    const list =
      new URL(
        listUrl
      );

    if (
      value.href
      === list.href
    ) {
      return false;
    }

    const joined =
      `${value.pathname}${value.search}`
        .toLowerCase();

    if (
      /download|attach|file/.test(
        joined
      )
    ) {
      return false;
    }

    /*
     * 창신대 URL 구조를 너무 좁게 잡지 않는다.
     */

    return Boolean(
      /view|detail|read|bulletin\/\d+|board\/\d+/.test(
        joined
      )
      ||
      /(?:idx|seq|no|id|article|board|bbs)[^=]*=\d+/.test(
        joined
      )
      ||
      value.pathname
        .split("/")
        .filter(Boolean)
        .some(
          part =>
            /^\d{2,}$/.test(
              part
            )
        )
    );

  } catch {
    return false;
  }
}


/* =========================================================
 * Container
 * ========================================================= */

function extractContainers(html) {
  const output = [];

  const definitions = [
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
    const definition
    of definitions
  ) {
    const rows =
      html.match(
        definition.regex
      )
      || [];

    for (
      const raw
      of rows
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

      output.push({
        type:
          definition.type,

        raw,

        text
      });
    }
  }


  return output;
}


/* =========================================================
 * 게시물 분석
 * ========================================================= */

function analyzeContainer(
  container,
  baseUrl
) {
  const date =
    parseDate(
      container.raw
    );

  if (!date) {
    return null;
  }


  const anchors =
    extractAnchors(
      container.raw,
      baseUrl
    );


  const detailAnchors =
    anchors.filter(
      anchor =>
        anchor.url
        &&
        looksLikeDetailUrl(
          anchor.url,
          baseUrl
        )
    );


  if (
    detailAnchors.length === 0
  ) {
    return null;
  }


  /*
   * 제목 후보는 상세 링크 text/title 중 가장 긴 것
   */

  const titleCandidates =
    detailAnchors
      .map(
        anchor => ({
          title:
            anchor.titleAttribute
            ||
            anchor.label,

          anchor
        })
      )
      .filter(
        item =>
          item.title
          &&
          item.title.length >= 4
      )
      .sort(
        (a, b) =>
          b.title.length
          -
          a.title.length
      );


  const selected =
    titleCandidates[0]
    || null;


  if (!selected) {
    return null;
  }


  return {
    structure:
      container.type,

    title:
      selected.title,

    publishedAt:
      date,

    sourceUrl:
      selected.anchor.url,

    detailKey:
      `URL:${selected.anchor.url}`,

    href:
      selected.anchor.href,

    sampleText:
      container.text.slice(
        0,
        1000
      )
  };
}


/* =========================================================
 * Detail page
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
    titleKey(
      expected
    );

  const documentKey =
    titleKey(
      html
    );

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
    plain(
      html
    );

  const full =
    new RegExp(
      `${year}\\s*[.\\-/년]\\s*0?${month}\\s*[.\\-/월]\\s*0?${day}`
    );

  const short =
    new RegExp(
      `${String(year).slice(2)}\\s*[.\\-/]\\s*0?${month}\\s*[.\\-/]\\s*0?${day}`
    );

  return (
    full.test(
      text
    )
    ||
    short.test(
      text
    )
  );
}


async function validateDetail(item) {
  const page =
    await fetchPage(
      item.sourceUrl
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

      bodyLength:
        0,

      pass:
        false,

      reason:
        "UNREACHABLE",

      error:
        page.error || null
    };
  }


  const isOfficial =
    officialDomain(
      page.finalUrl
    );


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


  const bodyLength =
    plain(
      page.html
    ).length;


  const pass =
    Boolean(
      isOfficial
      &&
      titleMatch
      &&
      bodyLength >= 100
    );


  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    officialDomain:
      isOfficial,

    titleMatch,

    dateMatch,

    bodyLength,

    pass,

    reason:
      pass
      ? null
      : "DETAIL_VALIDATION_FAILED"
  };
}


/* =========================================================
 * Structure 안정성
 * ========================================================= */

function analyzeStructure(items) {
  const counts = {};

  for (
    const item
    of items
  ) {
    counts[
      item.structure
    ] =
      (
        counts[
          item.structure
        ]
        || 0
      )
      + 1;
  }


  const top =
    Object.entries(
      counts
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]
      || null;


  return {
    stable:
      Boolean(
        top
        &&
        top[1] >= 5
      ),

    type:
      top
      ? top[0]
      : null,

    count:
      top
      ? top[1]
      : 0,

    counts
  };
}


/* =========================================================
 * Selector inference
 * ========================================================= */

function inferSelectors(
  structure
) {
  if (
    structure === "TR"
  ) {
    return {
      item:
        "tbody tr",

      title:
        "a",

      link:
        "a",

      linkAttribute:
        "href",

      date:
        "td",

      selectorStable:
        true
    };
  }


  if (
    structure === "LI"
  ) {
    return {
      item:
        "li",

      title:
        "a",

      link:
        "a",

      linkAttribute:
        "href",

      date:
        null,

      selectorStable:
        true
    };
  }


  if (
    structure === "ARTICLE"
  ) {
    return {
      item:
        "article",

      title:
        "a",

      link:
        "a",

      linkAttribute:
        "href",

      date:
        null,

      selectorStable:
        true
    };
  }


  return null;
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const beforeHashes =
    operationalHashes();


  let requests = 0;


  /*
   * 목록
   */

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
      "CHANGSHIN_LIST_UNREACHABLE"
    );
  }


  if (
    !officialDomain(
      list.finalUrl
    )
  ) {
    throw new Error(
      "CHANGSHIN_NON_OFFICIAL_DOMAIN"
    );
  }


  /*
   * 게시물 탐색
   */

  const containers =
    extractContainers(
      list.html
    );


  const extracted =
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
        extracted.map(
          item => [
            item.detailKey,
            item
          ]
        )
      ).values()
    ];


  const duplicateUrls =
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


  const structure =
    analyzeStructure(
      unique
    );


  /*
   * 상세 5건
   */

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
      await validateDetail(
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
   * 점수
   */

  let score = 0;

  const scoreReasons = [];


  score += 20;
  scoreReasons.push(
    "HTTP_200"
  );


  score += 20;
  scoreReasons.push(
    "OFFICIAL_DOMAIN"
  );


  if (
    unique.length >= 3
  ) {
    score += 15;
    scoreReasons.push(
      "UNIQUE_3_PLUS"
    );
  }


  if (
    unique.length >= 5
  ) {
    score += 15;
    scoreReasons.push(
      "UNIQUE_5_PLUS"
    );
  }


  if (
    distinctTitles >= 5
  ) {
    score += 10;
    scoreReasons.push(
      "TITLE_VARIETY"
    );
  }


  if (
    distinctDates >= 3
  ) {
    score += 10;
    scoreReasons.push(
      "DATE_VARIETY"
    );
  }


  if (
    structure.stable
  ) {
    score += 10;
    scoreReasons.push(
      `STABLE_STRUCTURE:${structure.type}`
    );
  }


  if (
    detailPass >= 3
  ) {
    score += 15;
    scoreReasons.push(
      "DETAIL_PASS_3_PLUS"
    );
  }


  if (
    detailPass === 5
  ) {
    score += 15;
    scoreReasons.push(
      "DETAIL_PASS_5"
    );
  }


  if (
    duplicateUrls === 0
    &&
    unique.length >= 3
  ) {
    score += 10;
    scoreReasons.push(
      "NO_DUPLICATE_URLS"
    );
  }


  /*
   * 판정
   */

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
      structure.stable
      &&
      detailChecks.length === 5
      &&
      detailPass === 5
      &&
      titlePass === 5
      &&
      validUrls === 5
    );


  const flexibleValidated =
    Boolean(
      unique.length >= 3
      &&
      distinctTitles >= 3
      &&
      structure.count >= 3
      &&
      detailPass >= 3
    );


  let decision =
    "QUALITY_REVIEW_REQUIRED";


  if (
    collectorReady
  ) {
    decision =
      "COLLECTOR_READY";
  }

  else if (
    flexibleValidated
  ) {
    decision =
      "FLEXIBLE_SOURCE_VALIDATED";
  }


  const selectors =
    inferSelectors(
      structure.type
    );


  const proposedSource =
    (
      decision
      === "COLLECTOR_READY"
      ||
      decision
      === "FLEXIBLE_SOURCE_VALIDATED"
    )
    ? {
        id:
          "changshin-general-feed",

        name:
          "창신대학교 공식 소식",

        category:
          "school_news",

        sourceType:
          "official",

        collectionType:
          "html",

        listUrl:
          list.finalUrl,

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
          decision
          === "COLLECTOR_READY"
            ? "collector_ready_pending_activation"
            : "validated_pending_collector_refinement",

        healthStatus:
          "validated",

        autoActivate:
          false
      }
    : null;


  let nextAction =
    "DEEP_DISCOVERY_ALTERNATIVE_SOURCE";


  if (
    decision
    === "COLLECTOR_READY"
  ) {
    nextAction =
      "VERIFY_CHANGSHIN_ACTIVATION_READY";
  }

  else if (
    decision
    === "FLEXIBLE_SOURCE_VALIDATED"
  ) {
    nextAction =
      "REFINE_CHANGSHIN_SELECTORS";
  }


  /*
   * hash
   */

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

    policy: {
      exactNoticeRequired:
        false,

      similarOfficialUniversityUpdatesAllowed:
        true
    },

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      bytes:
        list.bytes,

      containerCount:
        containers.length
    },

    extracted:
      extracted.length,

    unique:
      unique.length,

    duplicateUrls,

    distinctTitles,

    distinctDates,

    structure,

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

    score,

    grade:
      score >= 100
      ? "A"
      : score >= 80
      ? "B"
      : score >= 60
      ? "C"
      : "D",

    scoreReasons,

    selectors,

    decision,

    proposedSource,

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

        containers:
          report.list.containerCount,

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

        structure:
          report.structure,

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

        samples:
          report.detailValidation.checks
            .slice(
              0,
              5
            )
            .map(
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

        score:
          report.score,

        grade:
          report.grade,

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


/* =========================================================
 * Execute
 * ========================================================= */

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


/* =========================================================
 * Export
 * ========================================================= */

module.exports = {
  plain,
  normalizeUrl,
  officialDomain,
  parseDate,
  extractAnchors,
  looksLikeDetailUrl,
  extractContainers,
  analyzeContainer,
  titleKey,
  titleMatches,
  dateMatches,
  validateDetail,
  analyzeStructure,
  inferSelectors
};