"use strict";

/**
 * UNI PICK - Changshin Selector Refiner v1
 *
 * 목적
 * ---------------------------------------------------------
 * 창신대학교 /board/bulletin 후보는 상세 URL과 제목은 검증됐지만
 * 날짜가 3개 모두 같은 2026-06-17로 잡혔다.
 *
 * 따라서 이번 단계에서는:
 *
 * 1. 실제 TR마다 td class / index / text를 전부 분석
 * 2. /post/<id> 상세 링크가 있는 행만 추림
 * 3. 각 td 안의 날짜 후보 비교
 * 4. 모든 게시물에 안정적으로 적용되는 실제 date cell 찾기
 * 5. 상세 페이지 날짜와 목록 날짜 비교
 * 6. title/link/date selector 최종 확정
 *
 * 성공 기준
 * ---------------------------------------------------------
 * - 게시물 >= 3
 * - 고유 URL >= 3
 * - 목록 날짜 >= 3
 * - 상세 날짜 검증 >= 3
 * - 목록 날짜 == 상세 날짜 >= 3
 * - 동일한 td index 또는 class에서 날짜 반복 추출
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

const PREVIOUS_FILE = path.join(
  DATA,
  "changshin-source-revalidation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "changshin-selector-refinement.json"
);

const LIST_URL =
  "https://www.cs.ac.kr/board/bulletin";

const UNIVERSITY_ID =
  "changshin-university-본교";

const UNIVERSITY_NAME =
  "창신대학교";

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

  const text =
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
              "Mozilla/5.0 compatible UNI-PICK Changshin Selector Refiner",

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
      ok: true,

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
      ok: false,

      status: null,

      finalUrl: null,

      bytes: 0,

      html: "",

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
    return validDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );
  }


  match =
    text.match(
      /(?:^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\D|$)/
    );

  if (match) {
    return validDate(
      2000 + Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );
  }


  return null;
}


function validDate(
  year,
  month,
  day
) {
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
 * TR / TD
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


function extractCells(raw) {
  const cells = [];

  for (
    const match
    of raw.matchAll(
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const html =
      match[2] || "";

    const className =
      (
        attrs.match(
          /\bclass\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const id =
      (
        attrs.match(
          /\bid\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const text =
      plain(
        html
      );

    cells.push({
      index:
        cells.length,

      className,

      id,

      text,

      date:
        parseDate(
          text
        ),

      html
    });
  }

  return cells;
}


/* =========================================================
 * 게시물 링크 / 제목
 * ========================================================= */

function extractPostAnchor(
  raw,
  baseUrl
) {
  const candidates = [];

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
      )[1];

    if (!href) {
      continue;
    }

    const url =
      normalizeUrl(
        href,
        baseUrl
      );

    if (
      !url
      ||
      !officialDomain(
        url
      )
    ) {
      continue;
    }

    try {
      const pathname =
        new URL(
          url
        ).pathname;

      if (
        !/^\/post\/\d+\/?$/.test(
          pathname
        )
      ) {
        continue;
      }

    } catch {
      continue;
    }


    const titleAttribute =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1];

    const label =
      plain(
        match[2]
      );

    const title =
      plain(
        titleAttribute
        ||
        label
      );

    if (
      !title
      ||
      title.length < 4
    ) {
      continue;
    }

    candidates.push({
      title,

      url,

      href
    });
  }


  return candidates
    .sort(
      (a, b) =>
        b.title.length
        -
        a.title.length
    )[0]
    || null;
}


/* =========================================================
 * Row 분석
 * ========================================================= */

function analyzeRow(
  raw,
  baseUrl
) {
  const post =
    extractPostAnchor(
      raw,
      baseUrl
    );

  if (!post) {
    return null;
  }


  const cells =
    extractCells(
      raw
    );


  const dateCells =
    cells.filter(
      cell =>
        Boolean(
          cell.date
        )
    );


  return {
    title:
      post.title,

    sourceUrl:
      post.url,

    detailKey:
      `URL:${post.url}`,

    cells:
      cells.map(
        cell => ({
          index:
            cell.index,

          className:
            cell.className,

          id:
            cell.id,

          text:
            cell.text,

          date:
            cell.date
        })
      ),

    dateCells:
      dateCells.map(
        cell => ({
          index:
            cell.index,

          className:
            cell.className,

          id:
            cell.id,

          raw:
            cell.text,

          publishedAt:
            cell.date
        })
      )
  };
}


/* =========================================================
 * 날짜 cell 패턴
 * ========================================================= */

function analyzeDateCellPattern(
  rows
) {
  const byIndex = {};
  const byClass = {};


  for (
    const row
    of rows
  ) {
    for (
      const cell
      of row.dateCells
    ) {
      byIndex[
        cell.index
      ] =
        (
          byIndex[
            cell.index
          ]
          || 0
        )
        + 1;

      if (
        cell.className
      ) {
        byClass[
          cell.className
        ] =
          (
            byClass[
              cell.className
            ]
            || 0
          )
          + 1;
      }
    }
  }


  const indexWinner =
    Object.entries(
      byIndex
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]
      || null;


  const classWinner =
    Object.entries(
      byClass
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]
      || null;


  return {
    byIndex,

    byClass,

    bestIndex:
      indexWinner
      ? {
          index:
            Number(
              indexWinner[0]
            ),

          count:
            indexWinner[1]
        }
      : null,

    bestClass:
      classWinner
      ? {
          className:
            classWinner[0],

          count:
            classWinner[1]
        }
      : null
  };
}


/* =========================================================
 * 목록 날짜 선택
 * ========================================================= */

function chooseListDate(
  row,
  pattern
) {
  if (
    pattern.bestClass
  ) {
    const match =
      row.dateCells.find(
        cell =>
          cell.className
          ===
          pattern.bestClass.className
      );

    if (match) {
      return {
        publishedAt:
          match.publishedAt,

        raw:
          match.raw,

        method:
          `TD_CLASS:${match.className}`,

        index:
          match.index
      };
    }
  }


  if (
    pattern.bestIndex
  ) {
    const match =
      row.dateCells.find(
        cell =>
          cell.index
          ===
          pattern.bestIndex.index
      );

    if (match) {
      return {
        publishedAt:
          match.publishedAt,

        raw:
          match.raw,

        method:
          `TD_INDEX:${match.index}`,

        index:
          match.index
      };
    }
  }


  return null;
}


/* =========================================================
 * Detail date
 * ========================================================= */

function extractDetailDate(html) {
  const sources = [
    /(?:작성일|등록일|게시일|작성일자|등록일자|게시일자)\s*[:：]?\s*(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/i,

    /(?:작성일|등록일|게시일|작성일자|등록일자|게시일자)[\s\S]{0,120}?(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/i
  ];


  const text =
    plain(
      html
    );


  for (
    const pattern
    of sources
  ) {
    const match =
      text.match(
        pattern
      );

    if (
      match
      &&
      parseDate(
        match[1]
      )
    ) {
      return {
        raw:
          match[1],

        publishedAt:
          parseDate(
            match[1]
          ),

        method:
          "LABELED_DETAIL_DATE"
      };
    }
  }


  /*
   * fallback:
   * 상세 페이지 전체에서 모든 YYYY-MM-DD 찾기
   *
   * 단 첫 날짜를 정답으로 확정하지 않고,
   * 목록 날짜와 일치하는 날짜가 있는지 확인하는 용도로만 사용한다.
   */

  const dates = [];

  for (
    const match
    of text.matchAll(
      /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
    )
  ) {
    const parsed =
      parseDate(
        match[0]
      );

    if (
      parsed
      &&
      !dates.includes(
        parsed
      )
    ) {
      dates.push(
        parsed
      );
    }
  }


  return {
    raw: null,
    publishedAt: null,
    method: "UNLABELED_DATES",
    candidates:
      dates.slice(
        0,
        30
      )
  };
}


/* =========================================================
 * Detail title
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

  const htmlKey =
    titleKey(
      html
    );

  return Boolean(
    expectedKey
    &&
    htmlKey.includes(
      expectedKey
    )
  );
}


/* =========================================================
 * Detail validation
 * ========================================================= */

async function validateDetail(
  item
) {
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

      titleMatch:
        false,

      detailDate:
        null,

      dateMatch:
        false,

      pass:
        false,

      reason:
        "DETAIL_UNREACHABLE"
    };
  }


  const titleMatch =
    titleMatches(
      item.title,
      page.html
    );


  const detailDate =
    extractDetailDate(
      page.html
    );


  let dateMatch = false;


  if (
    detailDate.publishedAt
  ) {
    dateMatch =
      detailDate.publishedAt
      === item.publishedAt;
  }

  else if (
    Array.isArray(
      detailDate.candidates
    )
  ) {
    dateMatch =
      detailDate.candidates.includes(
        item.publishedAt
      );
  }


  const bodyLength =
    plain(
      page.html
    ).length;


  const pass =
    Boolean(
      officialDomain(
        page.finalUrl
      )
      &&
      titleMatch
      &&
      dateMatch
      &&
      bodyLength >= 100
    );


  return {
    ...item,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    titleMatch,

    detailDate,

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
 * Selector
 * ========================================================= */

function buildSelectors(
  pattern
) {
  let dateSelector =
    null;


  if (
    pattern.bestClass
  ) {
    const firstClass =
      String(
        pattern.bestClass.className
      )
        .trim()
        .split(/\s+/)[0];

    if (firstClass) {
      dateSelector =
        `td.${firstClass}`;
    }
  }


  if (
    !dateSelector
    &&
    pattern.bestIndex
  ) {
    dateSelector =
      `td:nth-child(${pattern.bestIndex.index + 1})`;
  }


  return {
    item:
      "tbody tr",

    title:
      "a[href^='/post/'], a[href*='/post/']",

    link:
      "a[href^='/post/'], a[href*='/post/']",

    linkAttribute:
      "href",

    date:
      dateSelector,

    selectorStable:
      Boolean(
        dateSelector
      )
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const previous =
    read(
      PREVIOUS_FILE,
      {}
    );


  if (
    previous.decision
      !== "FLEXIBLE_SOURCE_VALIDATED"
  ) {
    throw new Error(
      "CHANGSHIN_PREVIOUS_STAGE_NOT_READY"
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
      "CHANGSHIN_LIST_UNREACHABLE"
    );
  }


  const rawRows =
    extractRows(
      list.html
    );


  const rows =
    rawRows
      .map(
        raw =>
          analyzeRow(
            raw,
            list.finalUrl
          )
      )
      .filter(Boolean);


  const uniqueRows =
    [
      ...new Map(
        rows.map(
          row => [
            row.detailKey,
            row
          ]
        )
      ).values()
    ];


  const pattern =
    analyzeDateCellPattern(
      uniqueRows
    );


  const prepared =
    uniqueRows
      .map(
        row => {
          const selectedDate =
            chooseListDate(
              row,
              pattern
            );

          if (!selectedDate) {
            return null;
          }

          return {
            title:
              row.title,

            sourceUrl:
              row.sourceUrl,

            detailKey:
              row.detailKey,

            publishedAt:
              selectedDate.publishedAt,

            rawDate:
              selectedDate.raw,

            dateMethod:
              selectedDate.method,

            dateCellIndex:
              selectedDate.index
          };
        }
      )
      .filter(Boolean);


  const detailChecks = [];


  for (
    const item
    of prepared.slice(
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


  const distinctTitles =
    new Set(
      prepared.map(
        item =>
          item.title
      )
    ).size;


  const distinctDates =
    new Set(
      prepared.map(
        item =>
          item.publishedAt
      )
    ).size;


  const duplicateUrls =
    prepared.length
    -
    new Set(
      prepared.map(
        item =>
          item.sourceUrl
      )
    ).size;


  const selectors =
    buildSelectors(
      pattern
    );


  const collectorReady =
    Boolean(
      prepared.length >= 3
      &&
      distinctTitles >= 3
      &&
      duplicateUrls === 0
      &&
      selectors.selectorStable
      &&
      detailChecks.length >= 3
      &&
      detailPass === detailChecks.length
      &&
      titlePass === detailChecks.length
      &&
      datePass === detailChecks.length
    );


  const decision =
    collectorReady
      ? "COLLECTOR_READY"
      : "DATE_SELECTOR_REVIEW_REQUIRED";


  const proposedSource =
    collectorReady
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
            "collector_ready_pending_activation",

          healthStatus:
            "validated",

          autoActivate:
            false
        }
      : null;


  const nextAction =
    collectorReady
      ? "VERIFY_CHANGSHIN_ACTIVATION_READY"
      : "INSPECT_CHANGSHIN_ROW_CELLS";


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
      new Date().toISOString(),

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

      rawRows:
        rawRows.length,

      postRows:
        uniqueRows.length
    },

    dateCellPattern:
      pattern,

    rowDiagnostics:
      uniqueRows.slice(
        0,
        20
      ),

    prepared:
      prepared.slice(
        0,
        20
      ),

    extracted:
      prepared.length,

    distinctTitles,

    distinctDates,

    duplicateUrls,

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

    nextAction,

    requests,

    operationalHashUnchanged:
      hashSafe,

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

        rawRows:
          report.list.rawRows,

        postRows:
          report.list.postRows,

        extracted:
          report.extracted,

        distinctTitles:
          report.distinctTitles,

        distinctDates:
          report.distinctDates,

        duplicateUrls:
          report.duplicateUrls,

        dateCellPattern:
          report.dateCellPattern,

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

              listDate:
                item.publishedAt,

              rawDate:
                item.rawDate,

              dateMethod:
                item.dateMethod,

              detailDate:
                item.detailDate,

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
  validDate,
  extractRows,
  extractCells,
  extractPostAnchor,
  analyzeRow,
  analyzeDateCellPattern,
  chooseListDate,
  extractDetailDate,
  titleKey,
  titleMatches,
  validateDetail,
  buildSelectors
};