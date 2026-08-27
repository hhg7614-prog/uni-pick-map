"use strict";

/**
 * UNI PICK - HSMU Flexible Source Validator v1
 *
 * 목적
 * ---------------------------------------------------------
 * 앞 단계에서 발견한 화성의과학대학교 공식 유사 소식 source 후보를
 * 실제 게시물 단위로 검증한다.
 *
 * 정책
 * ---------------------------------------------------------
 * 반드시 "공지사항"일 필요는 없다.
 * 아래와 비슷한 공식 대학 소식 게시판이면 허용:
 * - 학사
 * - 모집
 * - 프로그램
 * - 행사
 * - 대학소식
 * - 일반 안내
 * - 학생지원
 * - 취업/채용
 * - 장학
 * - 이사회/학교 운영 공지 등
 *
 * 검증 핵심
 * ---------------------------------------------------------
 * 1. 공식 도메인
 * 2. HTTP 200
 * 3. 반복 게시물 >= 3
 * 4. 제목 >= 3
 * 5. 날짜 >= 3
 * 6. 제목+날짜가 같은 row/card 안에 존재
 * 7. 상세 URL 또는 상세 ID >= 3
 * 8. 중복 detail key = 0
 *
 * 실패 시
 * ---------------------------------------------------------
 * 현재 1위 후보만 고집하지 않고
 * 이전 단계의 후보 목록에서 다음 후보까지 자동 검증한다.
 *
 * 안전
 * ---------------------------------------------------------
 * - source catalog 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 *
 * 실행
 * ---------------------------------------------------------
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\validate-hwasung-flexible-source.js
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

const SELECTION_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-source-selection.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-flexible-source-validation.json"
);

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const REQUEST_TIMEOUT_MS = 20000;

const MAX_CANDIDATES_TO_VALIDATE = 8;
const MAX_DETAIL_TESTS = 5;


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


/* =========================================================
 * 기본 Utilities
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
      host === "hsmu.ac.kr"
      ||
      host.endsWith(
        ".hsmu.ac.kr"
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
              "Mozilla/5.0 compatible UNI-PICK HSMU Flexible Validator",

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

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

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

      contentType:
        "",

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
 * 날짜
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(
      value
    );

  let match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (match) {
    const year =
      Number(match[1]);

    const month =
      Number(match[2]);

    const day =
      Number(match[3]);

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
      2000
      +
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


function extractDates(value) {
  const text =
    plain(
      value
    );

  const candidates = [
    ...(
      text.match(
        /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
      )
      || []
    ),

    ...(
      text.match(
        /(?:^|\D)\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\D|$)/g
      )
      || []
    )
  ];


  const output = [];

  for (
    const raw
    of candidates
  ) {
    const date =
      parseDate(
        raw
      );

    if (
      date
      &&
      !output.some(
        item =>
          item.publishedAt
          === date
      )
    ) {
      output.push({
        raw:
          plain(
            raw
          ),

        publishedAt:
          date
      });
    }
  }

  return output;
}


/* =========================================================
 * Anchor / Click 정보
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
      match[1]
      || "";

    const body =
      match[2]
      || "";

    const href =
      (
        attrs.match(
          /\bhref\s*=\s*["']([^"']+)["']/i
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

    const titleAttribute =
      (
        attrs.match(
          /\btitle\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;


    output.push({
      label:
        plain(
          body
        ),

      titleAttribute,

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
 * 상세 ID 추출
 * ========================================================= */

function extractNumericIds(value) {
  const text =
    String(value || "");

  const ids = [];

  const patterns = [
    /\b(?:idx|seq|no|articleNo|article_no|boardNo|board_no|bbsNo|bbs_no|nttId|nttSeq|postNo|post_no)\b\s*[:=]\s*["']?(\d{2,})/gi,

    /\(\s*["']?(\d{2,})["']?\s*\)/g,

    /data-(?:id|idx|seq|no|article|board|bbs|ntt)[^=]*=\s*["'](\d{2,})["']/gi
  ];

  for (
    const pattern
    of patterns
  ) {
    let match;

    while (
      (
        match =
          pattern.exec(
            text
          )
      )
    ) {
      ids.push(
        match[1]
      );
    }
  }

  return [
    ...new Set(
      ids
    )
  ];
}


/* =========================================================
 * 반복 컨테이너
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
 * 실제 게시물 row/card 분석
 * ========================================================= */

function analyzeContainer(
  container,
  baseUrl
) {
  const anchors =
    extractAnchors(
      container.raw,
      baseUrl
    );

  const dates =
    extractDates(
      container.raw
    );


  const clickCandidates =
    anchors.filter(
      anchor =>
        anchor.url
        ||
        anchor.onclick
    );


  /*
   * 제목 후보:
   * 링크 text 중 가장 길면서,
   * 메뉴성 문구보다는 게시물 제목처럼 보이는 항목
   */

  const titleCandidates =
    clickCandidates
      .map(
        anchor => ({
          text:
            anchor.titleAttribute
            ||
            anchor.label,

          anchor
        })
      )
      .filter(
        item =>
          item.text
          &&
          item.text.length >= 4
      )
      .sort(
        (a, b) =>
          b.text.length
          -
          a.text.length
      );


  const bestTitle =
    titleCandidates[0]
    || null;


  /*
   * 상세 URL
   */

  let detailUrl = null;
  let detailMethod = null;


  const staticDetail =
    clickCandidates.find(
      item =>
        item.url
        &&
        officialDomain(
          item.url
        )
        &&
        normalizeUrl(
          item.url
        )
        !==
        normalizeUrl(
          baseUrl
        )
    );


  if (staticDetail) {
    detailUrl =
      staticDetail.url;

    detailMethod =
      "STATIC_URL";
  }


  /*
   * onclick ID
   */

  const ids =
    extractNumericIds(
      [
        container.raw,

        ...clickCandidates.map(
          item =>
            item.onclick || ""
        )
      ].join(" ")
    );


  let detailKey = null;


  if (detailUrl) {
    detailKey =
      `URL:${detailUrl}`;
  }

  else if (
    ids.length > 0
  ) {
    detailKey =
      `ID:${ids[0]}`;

    detailMethod =
      "ONCLICK_OR_DATA_ID";
  }


  return {
    structure:
      container.type,

    title:
      bestTitle
        ? bestTitle.text
        : null,

    date:
      dates[0]
      || null,

    dateCount:
      dates.length,

    detailUrl,

    detailMethod,

    detailKey,

    numericIds:
      ids,

    clickableCount:
      clickCandidates.length,

    sampleText:
      container.text.slice(
        0,
        800
      )
  };
}


/* =========================================================
 * 게시물 후보 판별
 * ========================================================= */

function isLikelyPost(item) {
  return Boolean(
    item.title
    &&
    item.title.length >= 4
    &&
    item.date
    &&
    item.detailKey
  );
}


/* =========================================================
 * 후보 페이지 검증
 * ========================================================= */

async function validateCandidate(candidate) {
  const page =
    await fetchPage(
      candidate.finalUrl
      ||
      candidate.url
    );


  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    return {
      label:
        candidate.label,

      url:
        candidate.url,

      status:
        page.status,

      finalUrl:
        page.finalUrl,

      decision:
        "FAIL",

      reason:
        "PAGE_UNREACHABLE",

      postCount:
        0,

      uniquePostCount:
        0,

      duplicateKeys:
        0,

      samples:
        [],

      error:
        page.error || null
    };
  }


  if (
    !officialDomain(
      page.finalUrl
    )
  ) {
    return {
      label:
        candidate.label,

      url:
        candidate.url,

      status:
        page.status,

      finalUrl:
        page.finalUrl,

      decision:
        "FAIL",

      reason:
        "NON_OFFICIAL_DOMAIN",

      postCount:
        0,

      uniquePostCount:
        0,

      duplicateKeys:
        0,

      samples:
        []
    };
  }


  const containers =
    extractContainers(
      page.html
    );


  const analyzed =
    containers
      .map(
        container =>
          analyzeContainer(
            container,
            page.finalUrl
          )
      );


  const likelyPosts =
    analyzed.filter(
      isLikelyPost
    );


  /*
   * detail key 기준 중복 제거
   */

  const unique =
    [
      ...new Map(
        likelyPosts.map(
          item => [
            item.detailKey,
            item
          ]
        )
      ).values()
    ];


  const duplicateKeys =
    likelyPosts.length
    -
    unique.length;


  /*
   * 가장 많이 성공한 structure 확인
   */

  const structureCounts = {};


  for (
    const item
    of unique
  ) {
    structureCounts[
      item.structure
    ] =
      (
        structureCounts[
          item.structure
        ]
        || 0
      )
      + 1;
  }


  const bestStructure =
    Object.entries(
      structureCounts
    )
      .sort(
        (a, b) =>
          b[1]
          -
          a[1]
      )[0]
      || null;


  const usable =
    unique.filter(
      item =>
        item.title
        &&
        item.date
        &&
        item.detailKey
    );


  /*
   * 날짜가 실제로 다양한지
   * 한 페이지 공통 footer 날짜 등을 잡은 것인지 방지
   */

  const distinctDates =
    new Set(
      usable.map(
        item =>
          item.date
            .publishedAt
      )
    );


  /*
   * 제목도 다양해야 한다.
   */

  const distinctTitles =
    new Set(
      usable.map(
        item =>
          plain(
            item.title
          )
      )
    );


  let score = 0;
  const reasons = [];


  score += 20;
  reasons.push(
    "HTTP_200"
  );


  score += 20;
  reasons.push(
    "OFFICIAL_DOMAIN"
  );


  if (
    usable.length >= 3
  ) {
    score += 30;
    reasons.push(
      "POSTS_3_PLUS"
    );
  }


  if (
    usable.length >= 5
  ) {
    score += 15;
    reasons.push(
      "POSTS_5_PLUS"
    );
  }


  if (
    distinctDates.size >= 2
  ) {
    score += 10;
    reasons.push(
      "DATE_VARIETY"
    );
  }


  if (
    distinctTitles.size >= 3
  ) {
    score += 10;
    reasons.push(
      "TITLE_VARIETY"
    );
  }


  if (
    bestStructure
    &&
    bestStructure[1] >= 3
  ) {
    score += 15;
    reasons.push(
      `STABLE_STRUCTURE:${bestStructure[0]}`
    );
  }


  if (
    duplicateKeys === 0
    &&
    usable.length >= 3
  ) {
    score += 10;
    reasons.push(
      "NO_DUPLICATE_KEYS"
    );
  }


  /*
   * 판정
   */

  let decision =
    "FAIL";


  if (
    usable.length >= 3
    &&
    distinctTitles.size >= 3
    &&
    distinctDates.size >= 2
    &&
    bestStructure
    &&
    bestStructure[1] >= 3
  ) {
    decision =
      "PASS";
  }

  else if (
    usable.length >= 2
  ) {
    decision =
      "REVIEW";
  }


  return {
    label:
      candidate.label,

    url:
      candidate.url,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    decision,

    score,

    reasons,

    totalContainers:
      containers.length,

    postCount:
      likelyPosts.length,

    uniquePostCount:
      unique.length,

    usablePostCount:
      usable.length,

    duplicateKeys,

    distinctDateCount:
      distinctDates.size,

    distinctTitleCount:
      distinctTitles.size,

    bestStructure:
      bestStructure
        ? {
            type:
              bestStructure[0],

            count:
              bestStructure[1]
          }
        : null,

    samples:
      usable.slice(
        0,
        10
      )
  };
}


/* =========================================================
 * 선택된 source 제안
 * ========================================================= */

function buildProposedSource(best) {
  if (
    !best
    ||
    best.decision !== "PASS"
  ) {
    return null;
  }


  const sample =
    best.samples[0]
    || null;


  const staticUrlRatio =
    best.samples.length
      ? (
          best.samples.filter(
            item =>
              item.detailMethod
              === "STATIC_URL"
          ).length
          /
          best.samples.length
        )
      : 0;


  return {
    id:
      "hwasung-medi-science-general-feed",

    name:
      `화성의과학대학교 ${best.label || "공식 소식"}`,

    category:
      "school_news",

    sourceType:
      "official",

    collectionType:
      staticUrlRatio >= 0.6
        ? "html"
        : "custom_html",

    listUrl:
      best.finalUrl,

    contentScope:
      "GENERAL_UNIVERSITY_UPDATES",

    matchedLabel:
      best.label,

    preferredStructure:
      best.bestStructure?.type
      || null,

    detailMethod:
      sample?.detailMethod
      || null,

    sampleDetailKey:
      sample?.detailKey
      || null,

    verified:
      false,

    enabled:
      false,

    status:
      "flexible_source_validated_pending_collector",

    autoActivate:
      false
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const selection =
    read(
      SELECTION_FILE,
      {}
    );


  if (
    selection.decision
      !== "FLEXIBLE_SOURCE_DISCOVERED"
    &&
    selection.decision
      !== "FLEXIBLE_SOURCE_REVIEW"
  ) {
    throw new Error(
      "HSMU_FLEXIBLE_SELECTION_NOT_READY"
    );
  }


  const beforeHashes =
    operationalHashes();


  const candidates =
    (
      selection.testedCandidates
      || []
    )
      .filter(
        item =>
          item.httpStatus === 200
          &&
          item.finalUrl
          &&
          officialDomain(
            item.finalUrl
          )
      )
      .sort(
        (a, b) =>
          Number(
            b.finalScore || 0
          )
          -
          Number(
            a.finalScore || 0
          )
      )
      .slice(
        0,
        MAX_CANDIDATES_TO_VALIDATE
      );


  let requests = 0;


  const validations = [];


  for (
    const candidate
    of candidates
  ) {
    requests += 1;

    const result =
      await validateCandidate(
        candidate
      );

    validations.push(
      result
    );


    /*
     * 확실한 PASS가 나오면
     * 굳이 모든 후보를 계속 요청하지 않는다.
     */

    if (
      result.decision === "PASS"
      &&
      result.usablePostCount >= 5
      &&
      result.score >= 100
    ) {
      break;
    }
  }


  validations.sort(
    (a, b) => {
      const decisionRank = {
        PASS: 0,
        REVIEW: 1,
        FAIL: 2
      };

      return (
        (
          decisionRank[
            a.decision
          ] ?? 9
        )
        -
        (
          decisionRank[
            b.decision
          ] ?? 9
        )
        ||
        Number(
          b.score || 0
        )
        -
        Number(
          a.score || 0
        )
      );
    }
  );


  const best =
    validations[0]
    || null;


  let decision =
    "NO_VALID_FLEXIBLE_SOURCE";


  if (
    best
    &&
    best.decision === "PASS"
  ) {
    decision =
      "FLEXIBLE_SOURCE_VALIDATED";
  }

  else if (
    best
    &&
    best.decision === "REVIEW"
  ) {
    decision =
      "FLEXIBLE_SOURCE_REVIEW_REQUIRED";
  }


  const proposedSource =
    buildProposedSource(
      best
    );


  let nextAction =
    "TRY_NEXT_OFFICIAL_SOURCE_GROUP";


  if (
    decision
    === "FLEXIBLE_SOURCE_VALIDATED"
  ) {
    nextAction =
      "BUILD_FLEXIBLE_COLLECTOR";
  }

  else if (
    decision
    === "FLEXIBLE_SOURCE_REVIEW_REQUIRED"
  ) {
    nextAction =
      "INSPECT_SELECTED_POST_STRUCTURE";
  }


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

    policy: {
      exactNoticeCategoryRequired:
        false,

      similarOfficialUniversityUpdateAllowed:
        true,

      minimumUsablePosts:
        3,

      titleDateSameContainerRequired:
        true,

      detailUrlOrIdRequired:
        true
    },

    candidateCount:
      candidates.length,

    testedCount:
      validations.length,

    validations,

    bestCandidate:
      best,

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

        candidates:
          report.candidateCount,

        tested:
          report.testedCount,

        best:
          report.bestCandidate
            ? {
                label:
                  report.bestCandidate.label,

                url:
                  report.bestCandidate.finalUrl,

                decision:
                  report.bestCandidate.decision,

                score:
                  report.bestCandidate.score,

                posts:
                  report.bestCandidate.postCount,

                unique:
                  report.bestCandidate.uniquePostCount,

                usable:
                  report.bestCandidate.usablePostCount,

                duplicateKeys:
                  report.bestCandidate.duplicateKeys,

                distinctDates:
                  report.bestCandidate.distinctDateCount,

                distinctTitles:
                  report.bestCandidate.distinctTitleCount,

                structure:
                  report.bestCandidate.bestStructure,

                samples:
                  report.bestCandidate.samples
                    .slice(
                      0,
                      5
                    )
                    .map(
                      item => ({
                        title:
                          item.title,

                        publishedAt:
                          item.date?.publishedAt
                          || null,

                        detailMethod:
                          item.detailMethod,

                        detailUrl:
                          item.detailUrl,

                        detailKey:
                          item.detailKey
                      })
                    )
              }
            : null,

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
 * 실행
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

      process.exitCode =
        1;
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
  extractDates,
  extractAnchors,
  extractNumericIds,
  extractContainers,
  analyzeContainer,
  isLikelyPost,
  validateCandidate,
  buildProposedSource
};