"use strict";

/**
 * UNI PICK - Keimyung Source Finalizer v2
 *
 * 핵심 수정:
 * - 계명대학교 실제 목록 구조 반영
 * - 제목: td.subject a
 * - 날짜: td.date
 * - 날짜 형식: YY-MM-DD → YYYY-MM-DD
 * - 상세 제목/날짜 검증
 *
 * 안전:
 * - Catalog 수정 없음
 * - Store 수정 없음
 * - Preview 수정 없음
 * - Queue 수정 없음
 * - Git/Deploy 없음
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../../..");

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const VALIDATION_FILE = path.join(
  DATA,
  "keimyung-source-validation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "keimyung-source-finalization.json"
);

const LIST_URL =
  "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=144";

const UNIVERSITY_ID =
  "keimyung-university-본교";

const UNIVERSITY_NAME =
  "계명대학교";

const MAX_SAMPLES = 5;

const REQUEST_TIMEOUT_MS = 20000;


/* =========================================================
 * 운영 파일 보호
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
 * 공통 유틸
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


/* =========================================================
 * 날짜
 *
 * 지원:
 * 2026-08-10
 * 2026.08.10
 * 2026/08/10
 * 26-08-10
 * 26.08.10
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);


  // YYYY-MM-DD
  let match =
    text.match(
      /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/
    );


  if (match) {
    const year =
      Number(match[1]);

    const month =
      Number(match[2]);

    const day =
      Number(match[3]);


    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }


  // YY-MM-DD
  match =
    text.match(
      /(?:^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\D|$)/
    );


  if (match) {
    const shortYear =
      Number(match[1]);

    const month =
      Number(match[2]);

    const day =
      Number(match[3]);


    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const year =
        2000 + shortYear;

      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }


  return null;
}


/* =========================================================
 * URL
 * ========================================================= */

function normalizeUrl(value, base) {
  try {
    const text =
      String(value || "")
        .replace(/&amp;/gi, "&")
        .trim();

    const url =
      new URL(
        text,
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
        .replace(
          /^www\./,
          ""
        );

    return (
      host === "kmu.ac.kr" ||
      host.endsWith(
        ".kmu.ac.kr"
      )
    );

  } catch {
    return false;
  }
}


function isDetailUrl(url) {
  try {
    const parsed =
      new URL(url);

    return (
      officialDomain(
        parsed.href
      )
      &&
      parsed.pathname.includes(
        "/uni/main/page.jsp"
      )
      &&
      parsed.searchParams.get("cmd")
        === "2"
      &&
      Boolean(
        parsed.searchParams.get(
          "parm_bod_uid"
        )
      )
      &&
      parsed.searchParams.get(
        "mnu_uid"
      ) === "144"
    );

  } catch {
    return false;
  }
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
              "Mozilla/5.0 compatible UNI-PICK Keimyung Finalizer v2",

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
    clearTimeout(timer);
  }
}


/* =========================================================
 * Anchor
 * ========================================================= */

function extractAnchors(
  html,
  base
) {
  const output = [];

  const matcher =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;


  while (
    (
      match =
        matcher.exec(html)
    )
  ) {
    const attrs =
      match[1] || "";

    const hrefMatch =
      attrs.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );


    if (!hrefMatch) {
      continue;
    }


    const url =
      normalizeUrl(
        hrefMatch[1],
        base
      );


    if (!url) {
      continue;
    }


    const label =
      plain(
        match[2]
      );


    if (!label) {
      continue;
    }


    output.push({
      url,
      label
    });
  }


  return output;
}


/* =========================================================
 * 목록 row 추출
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


/* =========================================================
 * TD 추출
 * ========================================================= */

function extractTdByClass(
  raw,
  className
) {
  const pattern =
    new RegExp(
      `<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
      "i"
    );


  const match =
    raw.match(
      pattern
    );


  if (!match) {
    return null;
  }


  return {
    html:
      match[1],

    text:
      plain(
        match[1]
      )
  };
}


/* =========================================================
 * Row 분석
 *
 * 실제 구조:
 *
 * td.num
 * td.subject
 * td.writer
 * td.date   ← YY-MM-DD
 * td.file
 * td.hit
 * ========================================================= */

function analyzeRow(
  raw,
  baseUrl
) {
  const subject =
    extractTdByClass(
      raw,
      "subject"
    );


  const dateCell =
    extractTdByClass(
      raw,
      "date"
    );


  if (!subject) {
    return null;
  }


  const anchors =
    extractAnchors(
      subject.html,
      baseUrl
    );


  const detail =
    anchors.find(
      item =>
        isDetailUrl(
          item.url
        )
    );


  if (!detail) {
    return null;
  }


  const dateRaw =
    dateCell?.text
    || null;


  const publishedAt =
    parseDate(
      dateRaw
    );


  return {
    title:
      detail.label,

    sourceUrl:
      detail.url,

    dateRaw,

    publishedAt,

    writer:
      extractTdByClass(
        raw,
        "writer"
      )?.text
      || null,

    rowText:
      plain(raw)
        .slice(
          0,
          500
        )
  };
}


/* =========================================================
 * 제목
 * ========================================================= */

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}


function titleExistsInDetail(
  html,
  expectedTitle
) {
  const target =
    titleKey(
      expectedTitle
    );


  if (!target) {
    return false;
  }


  const body =
    titleKey(
      html
    );


  return body.includes(
    target
  );
}


/* =========================================================
 * 상세 날짜 추출
 * ========================================================= */

function findDetailDates(html) {
  const visible =
    plain(html);


  const matches = [
    ...(
      visible.match(
        /20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}/g
      )
      || []
    ),

    ...(
      visible.match(
        /(?:^|\D)\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\D|$)/g
      )
      || []
    )
  ];


  const results = [];


  for (
    const raw
    of matches
  ) {
    const publishedAt =
      parseDate(raw);


    if (
      publishedAt
      &&
      !results.some(
        item =>
          item.publishedAt
          === publishedAt
      )
    ) {
      results.push({
        raw:
          plain(raw),

        publishedAt
      });
    }
  }


  return results;
}


/* =========================================================
 * Selector
 * ========================================================= */

function buildSelectors() {
  return {
    item:
      "tbody tr",

    title:
      "td.subject a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']",

    link:
      "td.subject a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']",

    linkAttribute:
      "href",

    date:
      "td.date"
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const previous =
    read(
      VALIDATION_FILE,
      {}
    );


  if (
    previous.decision
      !== "SUCCESS"
  ) {
    throw new Error(
      "PREVIOUS_KEIMYUNG_VALIDATION_NOT_SUCCESS"
    );
  }


  const beforeHashes =
    operationalHashes();


  let requestCount = 0;


  requestCount += 1;


  const listPage =
    await fetchPage(
      LIST_URL
    );


  if (
    !listPage.ok
    ||
    listPage.status !== 200
  ) {
    throw new Error(
      "KEIMYUNG_LIST_PAGE_UNREACHABLE"
    );
  }


  const rows =
    extractRows(
      listPage.html
    );


  const extracted =
    rows
      .map(
        raw =>
          analyzeRow(
            raw,
            listPage.finalUrl
          )
      )
      .filter(Boolean);


  const unique =
    [
      ...new Map(
        extracted.map(
          item => [
            item.sourceUrl,
            item
          ]
        )
      ).values()
    ];


  const samples =
    unique.slice(
      0,
      MAX_SAMPLES
    );


  const detailChecks = [];


  for (
    const sample
    of samples
  ) {
    requestCount += 1;


    const detail =
      await fetchPage(
        sample.sourceUrl
      );


    if (
      !detail.ok
      ||
      detail.status !== 200
    ) {
      detailChecks.push({
        ...sample,

        detailStatus:
          detail.status,

        detailTitleMatch:
          false,

        detailDateMatch:
          false,

        detailDates:
          [],

        decision:
          "FAIL",

        reason:
          "DETAIL_UNREACHABLE"
      });

      continue;
    }


    const detailTitleMatch =
      titleExistsInDetail(
        detail.html,
        sample.title
      );


    const detailDates =
      findDetailDates(
        detail.html
      );


    /*
     * 상세 페이지 날짜 후보 중
     * 목록 publishedAt과 같은 날짜가 존재하는지 확인
     */

    const detailDateMatch =
      Boolean(
        sample.publishedAt
        &&
        detailDates.some(
          item =>
            item.publishedAt
            === sample.publishedAt
        )
      );


    const reasons = [];


    if (
      !detailTitleMatch
    ) {
      reasons.push(
        "TITLE_MISMATCH"
      );
    }


    if (
      !sample.publishedAt
    ) {
      reasons.push(
        "LIST_DATE_MISSING"
      );
    }


    if (
      !detailDateMatch
    ) {
      reasons.push(
        "DETAIL_DATE_MISMATCH"
      );
    }


    detailChecks.push({
      ...sample,

      detailStatus:
        detail.status,

      detailFinalUrl:
        detail.finalUrl,

      detailTitleMatch,

      detailDates,

      detailDateMatch,

      decision:
        reasons.length === 0
          ? "PASS"
          : "REVIEW",

      reasons
    });
  }


  const listDatesFound =
    samples.filter(
      sample =>
        Boolean(
          sample.publishedAt
        )
    ).length;


  const publishedAtNull =
    samples.filter(
      sample =>
        !sample.publishedAt
    ).length;


  const detailPass =
    detailChecks.filter(
      item =>
        item.decision
        === "PASS"
    ).length;


  const titlePass =
    detailChecks.filter(
      item =>
        item.detailTitleMatch
    ).length;


  const detailDatePass =
    detailChecks.filter(
      item =>
        item.detailDateMatch
    ).length;


  /*
   * 날짜 selector는 실제 HTML 구조에서 확정됨.
   */

  const selectors =
    buildSelectors();


  const selectorStable =
    samples.length >= 3
    &&
    listDatesFound >= 3
    &&
    publishedAtNull === 0;


  /*
   * Collector Ready 기준
   *
   * 상세 페이지에 목록 날짜와 동일한 날짜가 반드시
   * 존재하지 않는 사이트도 있을 수 있으므로,
   * 핵심 기준은 목록 날짜 + 상세 제목 검증으로 한다.
   *
   * detailDatePass는 품질 지표로 따로 기록.
   */

  const collectorReady =
    listPage.status === 200
    &&
    officialDomain(
      listPage.finalUrl
    )
    &&
    unique.length >= 3
    &&
    samples.length >= 3
    &&
    listDatesFound >= 3
    &&
    publishedAtNull === 0
    &&
    titlePass >= 3
    &&
    selectorStable;


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
      "OPERATIONAL_FILES_CHANGED"
    );
  }


  const report = {
    schemaVersion:
      "2.0",

    generatedAt:
      new Date()
        .toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    listUrl:
      LIST_URL,

    previousValidation: {
      decision:
        previous.decision,

      score:
        previous.score,

      grade:
        previous.grade,

      pass:
        previous.pass,

      selectorStable:
        previous.selectorStable
    },

    list: {
      status:
        listPage.status,

      finalUrl:
        listPage.finalUrl,

      bytes:
        listPage.bytes,

      officialDomain:
        officialDomain(
          listPage.finalUrl
        ),

      totalRows:
        rows.length,

      extractedRows:
        extracted.length,

      uniqueArticles:
        unique.length
    },

    sampleCount:
      samples.length,

    listDatesFound,

    publishedAtNull,

    titlePass,

    detailDatePass,

    detailPass,

    selectorStable,

    rowStructure:
      "TABLE",

    selectors,

    samples,

    detailChecks,

    decision:
      collectorReady
        ? "COLLECTOR_READY"
        : "REVIEW_REQUIRED",

    proposedSource:
      collectorReady
        ? {
            id:
              "keimyung-academic-notice",

            name:
              "계명대학교 학사공지",

            category:
              "school_notice",

            sourceType:
              "official",

            collectionType:
              "html",

            listUrl:
              LIST_URL,

            selectors,

            verified:
              false,

            enabled:
              false,

            status:
              "collector_ready_pending_activation",

            healthStatus:
              "validated",

            campusScope:
              "CAMPUS_SPECIFIC",

            autoActivate:
              false
          }
        : null,

    requestCount,

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

      automaticActivation:
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

        rows:
          report.list.totalRows,

        extracted:
          report.list.extractedRows,

        unique:
          report.list.uniqueArticles,

        samples:
          report.sampleCount,

        listDates:
          report.listDatesFound,

        publishedAtNull:
          report.publishedAtNull,

        titlePass:
          report.titlePass,

        detailDatePass:
          report.detailDatePass,

        detailPass:
          report.detailPass,

        stable:
          report.selectorStable,

        selectors:
          report.selectors,

        sampleDates:
          report.samples.map(
            item => ({
              title:
                item.title,

              raw:
                item.dateRaw,

              publishedAt:
                item.publishedAt
            })
          ),

        source:
          report.proposedSource,

        requests:
          report.requestCount,

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
  parseDate,
  normalizeUrl,
  officialDomain,
  isDetailUrl,
  extractRows,
  extractTdByClass,
  extractAnchors,
  analyzeRow,
  titleExistsInDetail,
  findDetailDates,
  buildSelectors
};