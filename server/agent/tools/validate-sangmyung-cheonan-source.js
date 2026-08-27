"use strict";

/**
 * UNI PICK - Sangmyung Cheonan Source Validator v1
 *
 * 목적:
 * - 상명대학교 제2캠퍼스(천안) 공식 공지 source 후보를 읽기 전용으로 검증
 * - Node 22 + --use-system-ca 환경에서 실행
 *
 * 검증 대상:
 * https://www.smu.ac.kr/smuchina/community/sm_notice.do?mode=list&srCampus=smuc
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

const ROOT = path.resolve(__dirname, "../../..");

const OUTPUT_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "data",
  "sangmyung-cheonan-source-validation.json"
);

const UNIVERSITY_ID = "sangmyung-university-제2캠퍼";
const UNIVERSITY_NAME = "상명대학교 제2캠퍼";

const LIST_URL =
  "https://www.smu.ac.kr/smuchina/community/sm_notice.do?mode=list&srCampus=smuc";


// =========================================================
// 1. Utilities
// =========================================================

function atomicWriteJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(tmp, "utf8")
  );

  fs.renameSync(tmp, file);
}


function clean(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}


function sameOfficialDomain(url) {
  try {
    const host = new URL(url).hostname
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


function normalizeTitle(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}


function titleMatch(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);

  if (!left || !right) {
    return false;
  }

  return (
    left === right
    ||
    left.includes(right)
    ||
    right.includes(left)
  );
}


function parseDate(value) {
  const text = clean(value);

  const match = text.match(
    /(20\d{2})\D{0,4}(\d{1,2})\D{0,4}(\d{1,2})/
  );

  if (!match) {
    return null;
  }

  const year = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    month < 1
    || month > 12
    || day < 1
    || day > 31
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


// =========================================================
// 2. HTTP
// =========================================================

async function fetchPage(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(
      url,
      {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 compatible UNI-PICK Sangmyung Cheonan validator",
          "Accept":
            "text/html,application/xhtml+xml",
          "Accept-Language":
            "ko-KR,ko;q=0.9,en;q=0.8"
        }
      }
    );

    const html = await response.text();

    return {
      ok: true,
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
      contentType:
        response.headers.get("content-type"),
      bytes:
        Buffer.byteLength(html, "utf8"),
      html
    };

  } catch (error) {
    return {
      ok: false,
      requestedUrl: url,
      finalUrl: null,
      status: null,
      contentType: null,
      bytes: 0,
      error: {
        name:
          error?.name || null,
        message:
          error?.message || null,
        code:
          error?.code || null,
        causeCode:
          error?.cause?.code || null,
        causeMessage:
          error?.cause?.message || null
      },
      html: ""
    };

  } finally {
    clearTimeout(timer);
  }
}


// =========================================================
// 3. Anchor parser
// =========================================================

function anchors(html, baseUrl) {
  const output = [];

  const matcher =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = matcher.exec(html))
  ) {
    const attrs =
      match[1] || "";

    const body =
      match[2] || "";

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
      clean(body);

    if (!title) {
      continue;
    }

    output.push({
      url,
      title
    });
  }

  return output;
}


// =========================================================
// 4. 상세 URL 판별
// =========================================================

function looksLikeDetailUrl(url) {
  if (!sameOfficialDomain(url)) {
    return false;
  }

  try {
    const parsed =
      new URL(url);

    const joined =
      `${parsed.pathname}${parsed.search}`;

    if (
      /mode=view/i.test(joined)
      &&
      /articleNo=/i.test(joined)
    ) {
      return true;
    }

    if (
      /articleNo=\d+/i.test(joined)
    ) {
      return true;
    }

    if (
      /\/view|\/detail|\/read/i.test(
        parsed.pathname
      )
    ) {
      return true;
    }

    return false;

  } catch {
    return false;
  }
}


// =========================================================
// 5. List page에서 상세 후보 추출
// =========================================================

function extractDetailCandidates(
  html,
  listUrl
) {
  const all =
    anchors(
      html,
      listUrl
    );

  const filtered =
    all.filter(
      item =>
        looksLikeDetailUrl(
          item.url
        )
    );

  const unique =
    [
      ...new Map(
        filtered.map(
          item => [
            item.url,
            item
          ]
        )
      ).values()
    ];

  return unique.slice(0, 5);
}


// =========================================================
// 6. 상세 제목 추출
// =========================================================

function extractDetailTitle(html) {
  const patterns = [
    /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,

    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,

    /<h2\b[^>]*>([\s\S]*?)<\/h2>/i,

    /<h3\b[^>]*>([\s\S]*?)<\/h3>/i,

    /<title\b[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      html.match(pattern);

    if (
      match
      &&
      clean(match[1])
    ) {
      return clean(
        match[1]
      );
    }
  }

  return null;
}


// =========================================================
// 7. 상세 날짜 추출
// =========================================================

function extractDetailDate(html) {
  const candidates = [
    [
      "time_datetime",
      /<time\b[^>]*datetime=["']([^"']+)["']/i
    ],

    [
      "article_published_time",
      /<meta\b[^>]*(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)["']/i
    ],

    [
      "json_ld",
      /"datePublished"\s*:\s*"([^"]+)"/i
    ],

    [
      "visible_date",
      /(20\d{2}\D{0,4}\d{1,2}\D{0,4}\d{1,2})/
    ]
  ];

  for (
    const [method, pattern]
    of candidates
  ) {
    const match =
      html.match(pattern);

    if (!match) {
      continue;
    }

    const parsed =
      parseDate(
        match[1]
      );

    if (parsed) {
      return {
        publishedAt:
          parsed,
        raw:
          clean(
            match[1]
          ),
        method
      };
    }
  }

  return {
    publishedAt: null,
    raw: null,
    method: null
  };
}


// =========================================================
// 8. Selector 후보
// =========================================================

function buildSelectorProposal(
  samples
) {
  const stableSamples =
    samples.filter(
      sample =>
        sample.titleMatch
        &&
        sample.publishedAt
    );

  const stable =
    stableSamples.length >= 2;

  return {
    selectorStable:
      stable,

    selectors:
      stable
        ? {
            item:
              "tbody tr",
            title:
              "td a",
            link:
              "td a",
            date:
              "td"
          }
        : {
            item: null,
            title: null,
            link: null,
            date: null
          },

    detailSelectors:
      stable
        ? {
            title:
              "article heading or board title",
            date:
              "detail metadata date"
          }
        : {
            title: null,
            date: null
          }
  };
}


// =========================================================
// 9. Main
// =========================================================

async function main() {
  const startedAt =
    new Date().toISOString();

  const listPage =
    await fetchPage(
      LIST_URL
    );

  if (
    !listPage.ok
    ||
    listPage.status !== 200
  ) {
    const failed = {
      schemaVersion:
        "1.0",

      universityId:
        UNIVERSITY_ID,

      universityName:
        UNIVERSITY_NAME,

      listUrl:
        LIST_URL,

      decision:
        "FAILED",

      reason:
        "LIST_PAGE_UNREACHABLE",

      listPage: {
        ok:
          listPage.ok,
        status:
          listPage.status,
        finalUrl:
          listPage.finalUrl,
        bytes:
          listPage.bytes,
        error:
          listPage.error || null
      },

      safety: {
        readOnly: true,
        sourceModified: false,
        storeModified: false,
        previewModified: false,
        queueModified: false,
        gitTriggered: false,
        deploymentTriggered: false
      }
    };

    atomicWriteJson(
      OUTPUT_FILE,
      failed
    );

    console.log(
      JSON.stringify(
        failed,
        null,
        2
      )
    );

    return;
  }


  const detailCandidates =
    extractDetailCandidates(
      listPage.html,
      listPage.finalUrl
    );


  const samples = [];


  for (
    const candidate
    of detailCandidates.slice(
      0,
      3
    )
  ) {
    const detailPage =
      await fetchPage(
        candidate.url
      );

    if (
      !detailPage.ok
      ||
      detailPage.status !== 200
    ) {
      samples.push({
        listTitle:
          candidate.title,

        detailUrl:
          candidate.url,

        status:
          detailPage.status,

        titleMatch:
          false,

        publishedAt:
          null,

        detailTitle:
          null,

        officialDomain:
          false,

        decision:
          "FAIL",

        reason:
          "DETAIL_PAGE_UNREACHABLE"
      });

      continue;
    }


    const detailTitle =
      extractDetailTitle(
        detailPage.html
      );

    const detailDate =
      extractDetailDate(
        detailPage.html
      );

    const matched =
      titleMatch(
        candidate.title,
        detailTitle
      );


    const officialDomain =
      sameOfficialDomain(
        detailPage.finalUrl
      );


    const reasons = [];

    if (!officialDomain) {
      reasons.push(
        "NON_OFFICIAL_DOMAIN"
      );
    }

    if (!matched) {
      reasons.push(
        "TITLE_MISMATCH"
      );
    }

    if (!detailDate.publishedAt) {
      reasons.push(
        "DATE_NOT_FOUND"
      );
    }


    samples.push({
      listTitle:
        candidate.title,

      detailUrl:
        detailPage.finalUrl,

      status:
        detailPage.status,

      detailTitle,

      titleMatch:
        matched,

      publishedAt:
        detailDate.publishedAt,

      dateMethod:
        detailDate.method,

      officialDomain,

      decision:
        reasons.length === 0
          ? "PASS"
          : (
              detailTitle
              &&
              officialDomain
                ? "WARN"
                : "FAIL"
            ),

      reasons
    });
  }


  const uniqueDetailUrls =
    new Set(
      samples
        .map(
          sample =>
            sample.detailUrl
        )
        .filter(Boolean)
    ).size;


  const passCount =
    samples.filter(
      sample =>
        sample.decision
          === "PASS"
    ).length;


  const warnCount =
    samples.filter(
      sample =>
        sample.decision
          === "WARN"
    ).length;


  const failCount =
    samples.filter(
      sample =>
        sample.decision
          === "FAIL"
    ).length;


  const selectorProposal =
    buildSelectorProposal(
      samples
    );


  const score =
    (
      listPage.status === 200
        ? 25
        : 0
    )
    +
    (
      sameOfficialDomain(
        listPage.finalUrl
      )
        ? 25
        : 0
    )
    +
    Math.min(
      20,
      uniqueDetailUrls * 5
    )
    +
    Math.min(
      15,
      passCount * 5
    )
    +
    (
      selectorProposal
        .selectorStable
        ? 15
        : 0
    );


  const grade =
    score >= 90
      ? "A"
      : score >= 75
        ? "B"
        : score >= 60
          ? "C"
          : "D";


  const success =
    listPage.status === 200
    &&
    sameOfficialDomain(
      listPage.finalUrl
    )
    &&
    uniqueDetailUrls >= 2
    &&
    passCount >= 2
    &&
    selectorProposal
      .selectorStable;


  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date().toISOString(),

    startedAt,

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    sourceScope:
      "CAMPUS_SPECIFIC",

    campusScope:
      "CHEONAN",

    listUrl:
      LIST_URL,

    listPage: {
      status:
        listPage.status,

      finalUrl:
        listPage.finalUrl,

      bytes:
        listPage.bytes,

      contentType:
        listPage.contentType,

      officialDomain:
        sameOfficialDomain(
          listPage.finalUrl
        )
    },

    candidateCount:
      detailCandidates.length,

    uniqueDetailUrls,

    passCount,

    warnCount,

    failCount,

    score,

    grade,

    selectorStable:
      selectorProposal
        .selectorStable,

    selectorProposal,

    samples,

    decision:
      success
        ? "VALIDATED_CANDIDATE"
        : "REVIEW_REQUIRED",

    recommendedAction:
      success
        ? "이 source를 아직 자동 활성화하지 말고 Catalog 적용 전 최종 source scope 검토를 수행합니다."
        : "목록 구조 또는 상세 제목/날짜 selector를 추가 검토합니다.",

    proposedSource:
      success
        ? {
            id:
              "sangmyung-cheonan-general-notice",

            name:
              "상명대학교 천안캠퍼스 공지사항",

            category:
              "school_notice",

            sourceType:
              "official",

            collectionType:
              "html",

            listUrl:
              LIST_URL,

            campusScope:
              "CAMPUS_SPECIFIC",

            verified:
              false,

            enabled:
              false,

            status:
              "validation_passed_pending_activation"
          }
        : null,

    safety: {
      readOnly:
        true,

      automaticActivation:
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
        false,

      tlsVerificationDisabled:
        false
    }
  };


  atomicWriteJson(
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
  clean,
  parseDate,
  titleMatch,
  looksLikeDetailUrl,
  extractDetailCandidates,
  extractDetailTitle,
  extractDetailDate,
  buildSelectorProposal
};