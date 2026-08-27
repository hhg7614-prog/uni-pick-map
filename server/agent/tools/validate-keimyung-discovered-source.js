"use strict";

/**
 * UNI PICK - Keimyung University Source Validator
 *
 * 대상:
 * 계명대학교 학사공지
 *
 * 목적:
 * 1. 공식 목록 페이지 접근 확인
 * 2. 실제 상세 게시물 URL 탐색
 * 3. 첨부파일/외부 링크 제외
 * 4. 목록 제목 ↔ 상세 제목 검증
 * 5. 실제 게시일 검증
 * 6. 상세 URL 구조 안정성 확인
 * 7. selector 후보 생성
 *
 * 안전 정책:
 * - 실제 source 설정 변경 없음
 * - store 변경 없음
 * - preview 변경 없음
 * - queue 변경 없음
 * - deployment 없음
 * - git 작업 없음
 *
 * 실행 권장:
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\validate-keimyung-discovered-source.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");

const DATA_DIR = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "keimyung-source-validation.json"
);

const UNIVERSITY = {
  universityId: "keimyung-university-본교",
  universityName: "계명대학교",

  officialHomepage:
    "https://www.kmu.ac.kr/",

  listUrl:
    "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=144",

  category:
    "school_notice",

  sourceLabel:
    "계명대학교 학사공지"
};

const MAX_DETAIL_TESTS = 5;

const REQUEST_TIMEOUT_MS = 20000;

const SOCIAL_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|twitter\.com|x\.com)$/i;


/* =========================================================
 * 기본 문자열 처리
 * ========================================================= */

function plain(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function titleKey(value) {
  return plain(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function titlesMatch(a, b) {
  const left = titleKey(a);
  const right = titleKey(b);

  if (!left || !right) {
    return false;
  }

  return (
    left === right ||
    left.includes(right) ||
    right.includes(left)
  );
}


/* =========================================================
 * URL 처리
 * ========================================================= */

function toUrl(href, base) {
  try {
    const value = decodeBasicEntities(href).trim();

    if (!value) {
      return null;
    }

    if (
      value.startsWith("#") ||
      /^javascript:/i.test(value) ||
      /^mailto:/i.test(value) ||
      /^tel:/i.test(value)
    ) {
      return null;
    }

    const url = new URL(value, base);

    if (!/^https?:$/.test(url.protocol)) {
      return null;
    }

    url.hash = "";

    return url.href;
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);

    url.hash = "";

    return url.href;
  } catch {
    return String(value || "").trim();
  }
}

function officialDomain(url) {
  try {
    const host = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return (
      host === "kmu.ac.kr" ||
      host.endsWith(".kmu.ac.kr")
    );
  } catch {
    return false;
  }
}

function isAttachment(url) {
  try {
    const parsed = new URL(url);

    const joined =
      `${parsed.pathname}${parsed.search}`
        .toLowerCase();

    return (
      /download|attach|filedown|filedownload/.test(joined) ||
      /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx|zip|jpg|jpeg|png)(?:$|\?)/i.test(
        joined
      )
    );
  } catch {
    return true;
  }
}

function isSocial(url) {
  try {
    return SOCIAL_HOSTS.test(
      new URL(url).hostname
    );
  } catch {
    return false;
  }
}


/* =========================================================
 * 계명대학교 상세 URL 판정
 * ========================================================= */

function isKeimyungDetailUrl(url) {
  try {
    const parsed = new URL(url);

    if (!officialDomain(parsed.href)) {
      return false;
    }

    if (isAttachment(parsed.href)) {
      return false;
    }

    if (isSocial(parsed.href)) {
      return false;
    }

    const params = parsed.searchParams;

    /*
     * 실제 계명대 게시판 구조:
     *
     * cmd=2
     * parm_bod_uid=<게시물 번호>
     * mnu_uid=144
     */

    const command = params.get("cmd");

    const articleId =
      params.get("parm_bod_uid");

    const menuId =
      params.get("mnu_uid");

    return (
      parsed.pathname.includes(
        "/uni/main/page.jsp"
      ) &&
      command === "2" &&
      Boolean(articleId) &&
      menuId === "144"
    );
  } catch {
    return false;
  }
}


/* =========================================================
 * 날짜 처리
 * ========================================================= */

function parseDate(value) {
  const text = String(value || "");

  const match = text.match(
    /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
  );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return [
    String(year),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function findPublishedDate(html) {
  const patterns = [
    {
      method: "article_published_time",
      regex:
        /<meta\b[^>]*(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)["']/i
    },

    {
      method: "datePublished",
      regex:
        /"datePublished"\s*:\s*"([^"]+)"/i
    },

    {
      method: "date_meta",
      regex:
        /<meta\b[^>]*(?:name|property)=["'](?:date|publishdate|published)["'][^>]*content=["']([^"']+)["']/i
    },

    {
      method: "visible_date",
      regex:
        /(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/
    }
  ];

  for (const item of patterns) {
    const match = html.match(item.regex);

    if (!match) {
      continue;
    }

    const publishedAt =
      parseDate(match[1]);

    if (publishedAt) {
      return {
        raw: plain(match[1]),
        publishedAt,
        method: item.method
      };
    }
  }

  return {
    raw: null,
    publishedAt: null,
    method: null
  };
}


/* =========================================================
 * HTML anchor 추출
 * ========================================================= */

function anchors(html, base) {
  const results = [];

  const matcher =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = matcher.exec(html))
  ) {
    const attributes =
      match[1] || "";

    const hrefMatch =
      attributes.match(
        /\bhref\s*=\s*(["'])(.*?)\1/i
      );

    if (!hrefMatch) {
      continue;
    }

    const href =
      hrefMatch[2];

    const url =
      toUrl(
        href,
        base
      );

    if (!url) {
      continue;
    }

    const label =
      plain(match[2]);

    if (!label) {
      continue;
    }

    results.push({
      url,
      label,
      rawHref: href
    });
  }

  return results;
}


/* =========================================================
 * 상세 제목 추출
 * ========================================================= */

function titleCandidates(html) {
  const results = [];

  const patterns = [
    {
      method: "og_title",
      regex:
        /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i
    },

    {
      method: "h1",
      regex:
        /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
    },

    {
      method: "h2",
      regex:
        /<h2\b[^>]*>([\s\S]*?)<\/h2>/i
    },

    {
      method: "h3",
      regex:
        /<h3\b[^>]*>([\s\S]*?)<\/h3>/i
    },

    {
      method: "strong",
      regex:
        /<strong\b[^>]*>([\s\S]*?)<\/strong>/i
    },

    {
      method: "title_tag",
      regex:
        /<title\b[^>]*>([\s\S]*?)<\/title>/i
    }
  ];

  for (const item of patterns) {
    const match =
      html.match(item.regex);

    if (!match) {
      continue;
    }

    const title =
      plain(match[1]);

    if (
      title &&
      title.length >= 2
    ) {
      results.push({
        title,
        method:
          item.method
      });
    }
  }

  return results;
}

function bestDetailTitle(
  html,
  expectedTitle
) {
  const candidates =
    titleCandidates(html);

  const exact =
    candidates.find(
      candidate =>
        titlesMatch(
          expectedTitle,
          candidate.title
        )
    );

  if (exact) {
    return {
      title:
        exact.title,

      method:
        exact.method,

      matched:
        true,

      candidates
    };
  }

  /*
   * 일반 h1/h2가 사이트명인 경우가 있으므로
   * 전체 HTML에서 목록 제목 문자열도 확인한다.
   */

  const expectedKey =
    titleKey(expectedTitle);

  const bodyKey =
    titleKey(
      plain(html)
    );

  if (
    expectedKey &&
    bodyKey.includes(expectedKey)
  ) {
    return {
      title:
        expectedTitle,

      method:
        "visible_body_title_match",

      matched:
        true,

      candidates
    };
  }

  return {
    title:
      candidates[0]
        ? candidates[0].title
        : null,

    method:
      candidates[0]
        ? candidates[0].method
        : null,

    matched:
      false,

    candidates
  };
}


/* =========================================================
 * HTTP
 * ========================================================= */

async function request(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
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
              "Mozilla/5.0 compatible UNI-PICK source validator",

            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "ko-KR,ko;q=0.9,en;q=0.8",

            "Cache-Control":
              "no-cache"
          }
        }
      );

    const body =
      await response.text();

    return {
      requestedUrl:
        url,

      finalUrl:
        response.url,

      status:
        response.status,

      statusText:
        response.statusText,

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

      bytes:
        body.length,

      body
    };
  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
 * atomic JSON write
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

  /*
   * JSON 유효성 검증 후 rename
   */

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


/* =========================================================
 * selector 후보
 * ========================================================= */

function buildSelectorProposal(
  successfulSamples
) {
  const stable =
    successfulSamples.length >= 2;

  return {
    item:
      stable
        ? "a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']"
        : null,

    title:
      stable
        ? "a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']"
        : null,

    link:
      stable
        ? "a[href*='cmd=2'][href*='parm_bod_uid='][href*='mnu_uid=144']"
        : null,

    linkAttribute:
      stable
        ? "href"
        : null,

    date:
      null,

    selectorStable:
      stable
  };
}


/* =========================================================
 * 메인 검증
 * ========================================================= */

async function main() {
  let requests = 0;

  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date().toISOString(),

    universityId:
      UNIVERSITY.universityId,

    universityName:
      UNIVERSITY.universityName,

    category:
      UNIVERSITY.category,

    listUrl:
      UNIVERSITY.listUrl,

    listStatus:
      null,

    listFinalUrl:
      null,

    listBytes:
      0,

    officialDomain:
      false,

    totalAnchors:
      0,

    detailCandidateCount:
      0,

    uniqueDetailUrls:
      0,

    tested:
      0,

    pass:
      0,

    warn:
      0,

    fail:
      0,

    samples:
      [],

    selectors:
      null,

    selectorStable:
      false,

    score:
      0,

    grade:
      "D",

    decision:
      "ERROR",

    proposedSource:
      null,

    requests:
      0,

    errors:
      [],

    safety: {
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
        false
    }
  };

  try {
    /*
     * STEP 1
     * 목록 페이지
     */

    requests += 1;

    const list =
      await request(
        UNIVERSITY.listUrl
      );

    report.listStatus =
      list.status;

    report.listFinalUrl =
      list.finalUrl;

    report.listBytes =
      list.bytes;

    report.officialDomain =
      officialDomain(
        list.finalUrl
      );

    if (
      list.status !== 200
    ) {
      throw new Error(
        `LIST_HTTP_${list.status}`
      );
    }

    if (
      !report.officialDomain
    ) {
      throw new Error(
        "LIST_NOT_OFFICIAL_DOMAIN"
      );
    }

    /*
     * STEP 2
     * 상세 링크 탐색
     */

    const allAnchors =
      anchors(
        list.body,
        list.finalUrl
      );

    report.totalAnchors =
      allAnchors.length;

    const detailCandidates =
      allAnchors.filter(
        link =>
          isKeimyungDetailUrl(
            link.url
          )
      );

    report.detailCandidateCount =
      detailCandidates.length;

    /*
     * URL 기준 중복 제거
     */

    const uniqueMap =
      new Map();

    for (
      const link
      of detailCandidates
    ) {
      const normalized =
        normalizeUrl(
          link.url
        );

      if (
        !uniqueMap.has(
          normalized
        )
      ) {
        uniqueMap.set(
          normalized,
          link
        );
      }
    }

    const uniqueDetails =
      [...uniqueMap.values()];

    report.uniqueDetailUrls =
      uniqueDetails.length;

    /*
     * STEP 3
     * 최대 5개 상세 검증
     */

    const samples =
      uniqueDetails.slice(
        0,
        MAX_DETAIL_TESTS
      );

    for (
      const sample
      of samples
    ) {
      const result = {
        listTitle:
          sample.label,

        detailUrl:
          sample.url,

        finalUrl:
          null,

        status:
          null,

        officialDomain:
          false,

        detailTitle:
          null,

        titleMethod:
          null,

        titleMatch:
          false,

        publishedAt:
          null,

        dateRaw:
          null,

        dateMethod:
          null,

        articleTextLength:
          0,

        decision:
          "FAIL",

        reasons:
          []
      };

      try {
        requests += 1;

        const detail =
          await request(
            sample.url
          );

        result.status =
          detail.status;

        result.finalUrl =
          detail.finalUrl;

        result.officialDomain =
          officialDomain(
            detail.finalUrl
          );

        if (
          detail.status !== 200
        ) {
          result.reasons.push(
            `HTTP_${detail.status}`
          );
        }

        if (
          !result.officialDomain
        ) {
          result.reasons.push(
            "NOT_OFFICIAL_DOMAIN"
          );
        }

        if (
          !isKeimyungDetailUrl(
            detail.finalUrl
          )
        ) {
          result.reasons.push(
            "NOT_VALID_DETAIL_URL"
          );
        }

        const title =
          bestDetailTitle(
            detail.body,
            sample.label
          );

        result.detailTitle =
          title.title;

        result.titleMethod =
          title.method;

        result.titleMatch =
          title.matched;

        if (
          !result.titleMatch
        ) {
          result.reasons.push(
            "TITLE_MISMATCH"
          );
        }

        const date =
          findPublishedDate(
            detail.body
          );

        result.publishedAt =
          date.publishedAt;

        result.dateRaw =
          date.raw;

        result.dateMethod =
          date.method;

        if (
          !result.publishedAt
        ) {
          result.reasons.push(
            "MISSING_ACTUAL_DATE"
          );
        }

        result.articleTextLength =
          plain(
            detail.body
          ).length;

        if (
          result.articleTextLength <
          100
        ) {
          result.reasons.push(
            "MISSING_ARTICLE_BODY"
          );
        }

        /*
         * 판정
         */

        if (
          result.reasons.length === 0
        ) {
          result.decision =
            "PASS";
        } else if (
          result.status === 200 &&
          result.officialDomain &&
          result.detailTitle
        ) {
          result.decision =
            "WARN";
        } else {
          result.decision =
            "FAIL";
        }
      } catch (error) {
        result.reasons.push(
          error.message
        );

        result.decision =
          "FAIL";
      }

      report.samples.push(
        result
      );
    }

    /*
     * STEP 4
     * 집계
     */

    report.tested =
      report.samples.length;

    report.pass =
      report.samples.filter(
        item =>
          item.decision === "PASS"
      ).length;

    report.warn =
      report.samples.filter(
        item =>
          item.decision === "WARN"
      ).length;

    report.fail =
      report.samples.filter(
        item =>
          item.decision === "FAIL"
      ).length;

    /*
     * PASS 기준 selector 안정성
     */

    const successfulSamples =
      report.samples.filter(
        item =>
          item.decision === "PASS"
      );

    report.selectors =
      buildSelectorProposal(
        successfulSamples
      );

    report.selectorStable =
      report.selectors
        .selectorStable;

    /*
     * STEP 5
     * 점수
     */

    let score = 0;

    if (
      report.officialDomain
    ) {
      score += 20;
    }

    if (
      report.listStatus === 200
    ) {
      score += 10;
    }

    if (
      report.uniqueDetailUrls >= 2
    ) {
      score += 15;
    }

    if (
      report.uniqueDetailUrls >= 10
    ) {
      score += 5;
    }

    score +=
      Math.min(
        25,
        report.pass * 5
      );

    if (
      report.pass >= 2
    ) {
      score += 10;
    }

    if (
      report.selectorStable
    ) {
      score += 10;
    }

    if (
      report.fail === 0 &&
      report.tested >= 3
    ) {
      score += 5;
    }

    report.score =
      Math.min(
        100,
        score
      );

    report.grade =
      report.score >= 90
        ? "A"
        : report.score >= 75
          ? "B"
          : report.score >= 60
            ? "C"
            : "D";

    /*
     * STEP 6
     * 최종 판정
     */

    const success =
      report.listStatus === 200 &&
      report.officialDomain &&
      report.uniqueDetailUrls >= 2 &&
      report.pass >= 2 &&
      report.selectorStable &&
      report.score >= 75;

    if (success) {
      report.decision =
        "SUCCESS";

      report.proposedSource = {
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
          UNIVERSITY.listUrl,

        selectors:
          report.selectors,

        verified:
          false,

        enabled:
          false,

        status:
          "pending_review",

        healthStatus:
          "unknown",

        autoActivate:
          false
      };
    } else if (
      report.listStatus === 200 &&
      report.uniqueDetailUrls > 0
    ) {
      report.decision =
        "REVIEW_REQUIRED";
    } else {
      report.decision =
        "NO_VALID_SOURCE";
    }
  } catch (error) {
    report.errors.push(
      error.message
    );

    report.decision =
      "ERROR";
  }

  report.requests =
    requests;

  /*
   * 결과 파일만 기록
   */

  atomic(
    OUTPUT_FILE,
    report
  );

  /*
   * 콘솔에는 핵심 결과만 출력
   */

  console.log(
    JSON.stringify(
      {
        universityId:
          report.universityId,

        universityName:
          report.universityName,

        decision:
          report.decision,

        status:
          report.listStatus,

        anchors:
          report.totalAnchors,

        detailCandidates:
          report.detailCandidateCount,

        uniqueDetails:
          report.uniqueDetailUrls,

        tested:
          report.tested,

        pass:
          report.pass,

        warn:
          report.warn,

        fail:
          report.fail,

        score:
          report.score,

        grade:
          report.grade,

        stable:
          report.selectorStable,

        source:
          report.proposedSource,

        requests:
          report.requests,

        errors:
          report.errors
      },
      null,
      2
    )
  );
}


/* =========================================================
 * 실행
 * ========================================================= */

if (
  require.main === module
) {
  main().catch(
    error => {
      console.error(
        error
      );

      process.exitCode = 1;
    }
  );
}

module.exports = {
  plain,
  titleKey,
  titlesMatch,
  parseDate,
  findPublishedDate,
  anchors,
  isKeimyungDetailUrl,
  bestDetailTitle
};