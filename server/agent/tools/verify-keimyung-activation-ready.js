"use strict";

/**
 * UNI PICK - Keimyung Activation Ready Verifier v1
 *
 * 단계:
 * COLLECTOR_READY
 *   ->
 * 실제 collector 형태 dry-run
 *   ->
 * ACTIVATION_READY 판정
 *
 * 절대 하지 않는 것:
 * - source catalog 수정
 * - verified=true 변경
 * - enabled=true 변경
 * - store 저장
 * - preview 저장
 * - queue 변경
 * - git
 * - deploy
 *
 * 권장 실행:
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\verify-keimyung-activation-ready.js
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

const FINALIZATION_FILE = path.join(
  DATA,
  "keimyung-source-finalization.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "keimyung-activation-ready.json"
);

const LIST_URL =
  "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=144";

const UNIVERSITY_ID =
  "keimyung-university-본교";

const UNIVERSITY_NAME =
  "계명대학교";

const LIMIT = 5;

const REQUEST_TIMEOUT_MS = 20000;


/* =========================================================
 * 운영 보호 파일
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
 * Date
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);


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
        .replace(
          /&amp;/gi,
          "&"
        )
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
      parsed.searchParams.get(
        "cmd"
      ) === "2"
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
              "Mozilla/5.0 compatible UNI-PICK Keimyung Activation Verifier",

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
 * HTML Parsing
 * ========================================================= */

function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


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


function extractAnchors(
  html,
  baseUrl
) {
  const results = [];

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
        baseUrl
      );


    if (!url) {
      continue;
    }


    const title =
      plain(
        match[2]
      );


    if (!title) {
      continue;
    }


    results.push({
      url,
      title
    });
  }


  return results;
}


/* =========================================================
 * Collector-shaped row parsing
 * ========================================================= */

function parseCollectorRow(
  raw,
  baseUrl
) {
  const subject =
    extractTdByClass(
      raw,
      "subject"
    );


  const date =
    extractTdByClass(
      raw,
      "date"
    );


  if (
    !subject
    ||
    !date
  ) {
    return null;
  }


  const links =
    extractAnchors(
      subject.html,
      baseUrl
    );


  const detail =
    links.find(
      item =>
        isDetailUrl(
          item.url
        )
    );


  if (!detail) {
    return null;
  }


  const publishedAt =
    parseDate(
      date.text
    );


  return {
    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    category:
      "school_notice",

    title:
      detail.title,

    sourceUrl:
      detail.url,

    publishedAt,

    rawDate:
      date.text,

    sourceName:
      "계명대학교 학사공지",

    sourceId:
      "keimyung-academic-notice",

    sourceType:
      "official",

    status:
      "dry_run"
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


function detailContainsTitle(
  html,
  title
) {
  const expected =
    titleKey(
      title
    );

  const content =
    titleKey(
      html
    );


  return Boolean(
    expected
    &&
    content.includes(
      expected
    )
  );
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const finalized =
    read(
      FINALIZATION_FILE,
      {}
    );


  if (
    finalized.decision
      !== "COLLECTOR_READY"
  ) {
    throw new Error(
      "KEIMYUNG_NOT_COLLECTOR_READY"
    );
  }


  if (
    !finalized.proposedSource
  ) {
    throw new Error(
      "KEIMYUNG_PROPOSED_SOURCE_MISSING"
    );
  }


  const beforeHashes =
    operationalHashes();


  let requestCount = 0;


  requestCount += 1;


  const list =
    await fetchPage(
      LIST_URL
    );


  if (
    !list.ok
    ||
    list.status
      !== 200
  ) {
    throw new Error(
      "KEIMYUNG_LIST_UNREACHABLE"
    );
  }


  if (
    !officialDomain(
      list.finalUrl
    )
  ) {
    throw new Error(
      "KEIMYUNG_LIST_NON_OFFICIAL_DOMAIN"
    );
  }


  const rows =
    extractRows(
      list.html
    );


  const collected =
    rows
      .map(
        row =>
          parseCollectorRow(
            row,
            list.finalUrl
          )
      )
      .filter(Boolean);


  /*
   * URL 기준 중복 제거
   */

  const uniqueItems =
    [
      ...new Map(
        collected.map(
          item => [
            item.sourceUrl,
            item
          ]
        )
      ).values()
    ];


  const samples =
    uniqueItems.slice(
      0,
      LIMIT
    );


  const detailChecks = [];


  for (
    const item
    of samples
  ) {
    requestCount += 1;


    const detail =
      await fetchPage(
        item.sourceUrl
      );


    const titleMatch =
      detail.ok
      &&
      detail.status === 200
      &&
      detailContainsTitle(
        detail.html,
        item.title
      );


    detailChecks.push({
      title:
        item.title,

      sourceUrl:
        item.sourceUrl,

      publishedAt:
        item.publishedAt,

      detailStatus:
        detail.status,

      officialDomain:
        detail.finalUrl
          ? officialDomain(
              detail.finalUrl
            )
          : false,

      titleMatch,

      pass:
        Boolean(
          detail.ok
          &&
          detail.status === 200
          &&
          detail.finalUrl
          &&
          officialDomain(
            detail.finalUrl
          )
          &&
          item.publishedAt
          &&
          titleMatch
        )
    });
  }


  const publishedAtNull =
    samples.filter(
      item =>
        !item.publishedAt
    ).length;


  const duplicateUrls =
    collected.length
    -
    uniqueItems.length;


  const detailPass =
    detailChecks.filter(
      item =>
        item.pass
    ).length;


  const validUrlCount =
    samples.filter(
      item =>
        /^https:\/\//i.test(
          item.sourceUrl
        )
        &&
        officialDomain(
          item.sourceUrl
        )
    ).length;


  const titleNonEmpty =
    samples.filter(
      item =>
        Boolean(
          item.title
        )
    ).length;


  /*
   * ACTIVATION READY 기준
   */

  const activationReady =
    list.status === 200
    &&
    uniqueItems.length >= 3
    &&
    samples.length >= 3
    &&
    publishedAtNull === 0
    &&
    duplicateUrls === 0
    &&
    validUrlCount === samples.length
    &&
    titleNonEmpty === samples.length
    &&
    detailPass >= 3;


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

    phase:
      "ACTIVATION_READY_VERIFICATION",

    source:
      finalized.proposedSource,

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      bytes:
        list.bytes,

      totalRows:
        rows.length
    },

    collectorDryRun: {
      totalCollected:
        collected.length,

      uniqueItems:
        uniqueItems.length,

      sampleCount:
        samples.length,

      publishedAtNull,

      duplicateUrls,

      validUrlCount,

      titleNonEmpty
    },

    detailValidation: {
      checked:
        detailChecks.length,

      pass:
        detailPass
    },

    samples,

    detailChecks,

    decision:
      activationReady
        ? "ACTIVATION_READY"
        : "REVIEW_REQUIRED",

    activationPolicy: {
      autoActivate:
        false,

      requiresExplicitActivationStep:
        true,

      requiresVerifiedTrueMutation:
        true,

      requiresEnabledTrueMutation:
        true
    },

    proposedActivation:
      activationReady
        ? {
            universityId:
              UNIVERSITY_ID,

            sourceId:
              finalized
                .proposedSource
                .id,

            listUrl:
              finalized
                .proposedSource
                .listUrl,

            selectors:
              finalized
                .proposedSource
                .selectors,

            desiredVerified:
              true,

            desiredEnabled:
              true,

            status:
              "awaiting_activation"
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

      verifiedModified:
        false,

      enabledModified:
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

        collected:
          report.collectorDryRun
            .totalCollected,

        unique:
          report.collectorDryRun
            .uniqueItems,

        samples:
          report.collectorDryRun
            .sampleCount,

        publishedAtNull:
          report.collectorDryRun
            .publishedAtNull,

        duplicateUrls:
          report.collectorDryRun
            .duplicateUrls,

        validUrls:
          report.collectorDryRun
            .validUrlCount,

        titles:
          report.collectorDryRun
            .titleNonEmpty,

        detailPass:
          report.detailValidation
            .pass,

        activation:
          report.proposedActivation,

        requests:
          report.requestCount,

        hashSafe:
          report
            .operationalHashUnchanged
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
  parseDate,
  normalizeUrl,
  officialDomain,
  isDetailUrl,
  extractRows,
  extractTdByClass,
  extractAnchors,
  parseCollectorRow,
  detailContainsTitle
};