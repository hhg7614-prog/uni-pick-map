"use strict";

/**
 * UNI PICK
 * Kyungdong University Candidate Collector Verifier
 *
 * 대상
 * ------------------------------------------------------------
 * universityId:
 *   kyungdong-university-본교
 *
 * candidate:
 *   https://www.kduniv.ac.kr/kor/CMS/Board/Board.do?mCode=MN245
 *
 * 목적
 * ------------------------------------------------------------
 * 1. 경동대학교 일반공지 게시판을 실제로 다시 요청한다.
 * 2. 목록 반복 구조를 확인한다.
 * 3. 제목 / 날짜 / 상세 URL / 식별키를 추출한다.
 * 4. 중복 여부를 확인한다.
 * 5. 상세 페이지 최대 5건에서 제목/날짜를 재검증한다.
 * 6. collector가 안정적이면 COLLECTOR_READY로 판정한다.
 *
 * 안전
 * ------------------------------------------------------------
 * - catalog 수정 없음
 * - source 활성화 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 */

const fs = require("fs");
const path = require("path");
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

const EVALUATION_FILE = path.join(
  DATA,
  "uni-pick-next-batch-candidate-evaluation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "kyungdong-candidate-collector-verification.json"
);

const UNIVERSITY_ID =
  "kyungdong-university-본교";

const UNIVERSITY_NAME =
  "경동대학교";

const SOURCE_ID =
  "kyungdong-general-notice";

const SOURCE_NAME =
  "경동대학교 일반공지";

const LIST_URL =
  "https://www.kduniv.ac.kr/kor/CMS/Board/Board.do?mCode=MN245";

const DETAIL_TEST_LIMIT =
  5;

/* ============================================================
 * JSON
 * ============================================================ */

function readJson(
  file,
  fallback = null
) {
  try {
    return JSON.parse(
      fs
        .readFileSync(
          file,
          "utf8"
        )
        .replace(
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

/* ============================================================
 * Normalize
 * ============================================================ */

function normalizeId(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .trim();
}

function decodeHtml(value) {
  return String(
    value || ""
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
      /&#34;/gi,
      "\""
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&apos;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&nbsp;/gi,
      " "
    );
}

function plain(value) {
  return decodeHtml(
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
        /<[^>]+>/g,
        " "
      )
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeUrl(
  value,
  baseUrl = null
) {
  if (!value) {
    return null;
  }

  try {
    const url =
      baseUrl
        ? new URL(
            decodeHtml(value),
            baseUrl
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
  a,
  b
) {
  const hostA =
    hostname(a);

  const hostB =
    hostname(b);

  if (
    !hostA
    ||
    !hostB
  ) {
    return false;
  }

  return (
    hostA === hostB
    ||
    hostA.endsWith(
      `.${hostB}`
    )
    ||
    hostB.endsWith(
      `.${hostA}`
    )
  );
}

function normalizeDate(value) {
  const text =
    plain(value);

  const match =
    text.match(
      /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/
    );

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

/* ============================================================
 * Network
 * ============================================================ */

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
        "35",

        "--silent",

        "--show-error",

        "--compressed",

        "-A",
        "Mozilla/5.0 compatible UNI-PICK Kyungdong Collector Verifier",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__META__%{http_code}|%{url_effective}",

        url
      ],
      {
        encoding:
          "utf8",

        timeout:
          40000,

        windowsHide:
          true,

        maxBuffer:
          25 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok:
        false,

      status:
        null,

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
    "\n__META__";

  const index =
    stdout.lastIndexOf(
      marker
    );

  if (index < 0) {
    return {
      ok:
        false,

      status:
        null,

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
      index
    );

  const meta =
    stdout
      .slice(
        index +
        marker.length
      )
      .trim();

  const [
    rawStatus,
    finalUrl
  ] =
    meta.split("|");

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

/* ============================================================
 * HTML helpers
 * ============================================================ */

function extractAnchors(
  html,
  baseUrl
) {
  const anchors = [];

  for (
    const match
    of html.matchAll(
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

    anchors.push({
      href:
        decodeHtml(
          href
        ),

      url,

      text:
        plain(
          match[2]
        )
    });
  }

  return anchors;
}

/* ============================================================
 * Board row detection
 *
 * 경동대 CMS Board는 설치 환경마다 class가 조금씩 다를 수 있으므로
 * 특정 selector 하나에 고정하지 않고 반복 구조를 안전하게 찾는다.
 * ============================================================ */

function extractCandidateContainers(
  html
) {
  const patterns = [
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
        "DIV",

      regex:
        /<div\b[^>]*class\s*=\s*["'][^"']*(?:board|bbs|list|item)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi
    }
  ];

  const result = [];

  for (
    const pattern
    of patterns
  ) {
    const matches =
      html.match(
        pattern.regex
      )
      || [];

    for (
      const raw
      of matches
    ) {
      const lower =
        raw.toLowerCase();

      if (
        !lower.includes(
          "<a"
        )
      ) {
        continue;
      }

      if (
        !/20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/
          .test(
            plain(raw)
          )
      ) {
        continue;
      }

      if (
        !/board|bbs|mode=view|board_seq|boardseq|mgr_seq|seq=/i
          .test(
            raw
          )
      ) {
        continue;
      }

      result.push({
        type:
          pattern.type,

        raw
      });
    }
  }

  return result;
}

/* ============================================================
 * Detail identity
 * ============================================================ */

function extractDetailIdentity(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed =
      new URL(
        url
      );

    const candidateParams = [
      "board_seq",
      "boardSeq",
      "seq",
      "idx",
      "no",
      "articleNo"
    ];

    for (
      const key
      of candidateParams
    ) {
      const value =
        parsed.searchParams.get(
          key
        );

      if (
        value
        &&
        /^[A-Za-z0-9_-]+$/
          .test(
            value
          )
      ) {
        return {
          parameter:
            key,

          value,

          detailKey:
            `${key.toUpperCase()}:${value}`
        };
      }
    }

    /*
     * CMS Board 계열은 간혹 BoardView.do/path 형태를 사용한다.
     */

    const pathMatch =
      parsed.pathname.match(
        /(?:BoardView|View|board)[^/]*\/?([0-9]{2,})/i
      );

    if (pathMatch) {
      return {
        parameter:
          "PATH_ID",

        value:
          pathMatch[1],

        detailKey:
          `PATH_ID:${pathMatch[1]}`
      };
    }

    /*
     * query 전체를 fallback key로 사용할 수는 있지만
     * 활성화 전 검증에서는 안정적 ID가 없는 경우 거부한다.
     */

    return null;
  } catch {
    return null;
  }
}

/* ============================================================
 * Row analysis
 * ============================================================ */

function analyzeContainer(
  container,
  baseUrl
) {
  const anchors =
    extractAnchors(
      container.raw,
      baseUrl
    );

  const detailAnchors =
    anchors
      .map(
        anchor => ({
          ...anchor,

          identity:
            extractDetailIdentity(
              anchor.url
            )
        })
      )
      .filter(
        anchor =>
          anchor.identity
      );

  if (
    detailAnchors.length === 0
  ) {
    return null;
  }

  /*
   * 제목은 너무 짧은 메뉴 텍스트보다
   * 실제 게시글 링크에서 가장 긴 텍스트를 우선한다.
   */

  const titleAnchor =
    detailAnchors
      .filter(
        anchor =>
          anchor.text
          &&
          anchor.text.length >= 3
      )
      .sort(
        (a, b) =>
          b.text.length
          -
          a.text.length
      )[0]
      || null;

  if (!titleAnchor) {
    return null;
  }

  const text =
    plain(
      container.raw
    );

  const dateMatches =
    text.match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
    || [];

  const dates =
    [
      ...new Set(
        dateMatches
          .map(
            normalizeDate
          )
          .filter(
            Boolean
          )
      )
    ];

  /*
   * 하나의 row에서 날짜가 너무 여러 개 발견되면
   * row selector가 너무 넓다고 판단한다.
   */

  if (
    dates.length !== 1
  ) {
    return null;
  }

  return {
    containerType:
      container.type,

    title:
      titleAnchor.text,

    publishedAt:
      dates[0],

    detailUrl:
      titleAnchor.url,

    detailIdParameter:
      titleAnchor.identity.parameter,

    detailId:
      titleAnchor.identity.value,

    detailKey:
      titleAnchor.identity.detailKey
  };
}

/* ============================================================
 * Detail validation
 * ============================================================ */

function titleKey(value) {
  return plain(
    value
  )
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}

function detailContainsTitle(
  expected,
  html
) {
  const expectedKey =
    titleKey(
      expected
    );

  const pageKey =
    titleKey(
      html
    );

  if (
    !expectedKey
  ) {
    return false;
  }

  if (
    pageKey.includes(
      expectedKey
    )
  ) {
    return true;
  }

  /*
   * 매우 긴 제목은 앞부분 70% 이상이 일치해도 허용
   */

  if (
    expectedKey.length >= 20
  ) {
    const partial =
      expectedKey.slice(
        0,
        Math.max(
          12,
          Math.floor(
            expectedKey.length *
            0.7
          )
        )
      );

    return pageKey.includes(
      partial
    );
  }

  return false;
}

function detailContainsDate(
  expected,
  html
) {
  const [
    year,
    month,
    day
  ] =
    expected
      .split("-")
      .map(
        Number
      );

  const text =
    plain(
      html
    );

  const patterns = [
    `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`,
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
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
    curlPage(
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
      sameRootDomain(
        page.finalUrl,
        LIST_URL
      )
    );

  const titleMatch =
    validUrl
    &&
    detailContainsTitle(
      item.title,
      page.html
    );

  const dateMatch =
    validUrl
    &&
    detailContainsDate(
      item.publishedAt,
      page.html
    );

  return {
    detailKey:
      item.detailKey,

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
  };
}

/* ============================================================
 * Evaluation source guard
 * ============================================================ */

function validateUpstreamEvaluation() {
  const evaluation =
    readJson(
      EVALUATION_FILE
    );

  if (
    !evaluation
    ||
    !Array.isArray(
      evaluation.evaluatedItems
    )
  ) {
    return {
      found:
        false,

      valid:
        false,

      row:
        null
    };
  }

  const row =
    evaluation.evaluatedItems.find(
      item =>
        normalizeId(
          item.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    )
    || null;

  if (!row) {
    return {
      found:
        false,

      valid:
        false,

      row:
        null
    };
  }

  const valid =
    row.state
    ===
    "VALIDATE_ACTIVATION_CANDIDATE"
    &&
    row.action
    ===
    "VERIFY_CANDIDATE_COLLECTOR";

  return {
    found:
      true,

    valid,

    row
  };
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  const upstream =
    validateUpstreamEvaluation();

  if (
    !upstream.found
  ) {
    throw new Error(
      "KYUNGDONG_EVALUATION_ROW_NOT_FOUND"
    );
  }

  if (
    !upstream.valid
  ) {
    throw new Error(
      "KYUNGDONG_NOT_READY_FOR_COLLECTOR_VERIFICATION"
    );
  }

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
      "KYUNGDONG_LIST_FETCH_FAILED"
    );
  }

  if (
    !sameRootDomain(
      list.finalUrl,
      LIST_URL
    )
  ) {
    throw new Error(
      "KYUNGDONG_LIST_LEFT_OFFICIAL_DOMAIN"
    );
  }

  const containers =
    extractCandidateContainers(
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
      .filter(
        Boolean
      );

  const uniqueMap =
    new Map();

  for (
    const item
    of extracted
  ) {
    if (
      !uniqueMap.has(
        item.detailKey
      )
    ) {
      uniqueMap.set(
        item.detailKey,
        item
      );
    }
  }

  const unique =
    [
      ...uniqueMap.values()
    ];

  const duplicateKeys =
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

  const containerTypeCounts =
    {};

  for (
    const item
    of unique
  ) {
    containerTypeCounts[
      item.containerType
    ] =
      (
        containerTypeCounts[
          item.containerType
        ]
        || 0
      )
      + 1;
  }

  const identityParameterCounts =
    {};

  for (
    const item
    of unique
  ) {
    identityParameterCounts[
      item.detailIdParameter
    ] =
      (
        identityParameterCounts[
          item.detailIdParameter
        ]
        || 0
      )
      + 1;
  }

  const details = [];

  for (
    const item
    of unique.slice(
      0,
      DETAIL_TEST_LIMIT
    )
  ) {
    details.push(
      validateDetail(
        item
      )
    );
  }

  const detailPass =
    details.filter(
      item =>
        item.pass
    ).length;

  const titlePass =
    details.filter(
      item =>
        item.titleMatch
    ).length;

  const datePass =
    details.filter(
      item =>
        item.dateMatch
    ).length;

  const validUrls =
    details.filter(
      item =>
        item.validUrl
    ).length;

  /*
   * 최소 기준
   *
   * 경동대 페이지 자체에서는 날짜 11건이 확인됐으므로
   * 추출 8개 이상이면 충분히 보수적이다.
   */

  const collectorReady =
    Boolean(
      containers.length >= 8
      &&
      extracted.length >= 8
      &&
      unique.length >= 8
      &&
      distinctTitles >= 8
      &&
      distinctDates >= 3
      &&
      details.length === DETAIL_TEST_LIMIT
      &&
      detailPass === DETAIL_TEST_LIMIT
      &&
      titlePass === DETAIL_TEST_LIMIT
      &&
      datePass === DETAIL_TEST_LIMIT
      &&
      validUrls === DETAIL_TEST_LIMIT
    );

  /*
   * 가장 많이 사용된 구조를 실제 parser 후보로 선정
   */

  const dominantContainerType =
    Object.entries(
      containerTypeCounts
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]?.[0]
    || null;

  const dominantIdentityParameter =
    Object.entries(
      identityParameterCounts
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]?.[0]
    || null;

  const proposedCollector =
    collectorReady
      ? {
          id:
            SOURCE_ID,

          name:
            SOURCE_NAME,

          category:
            "school_notice",

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

          parser: {
            itemStrategy:
              dominantContainerType
              === "TR"
                ? "CMS_BOARD_TR_WITH_DATE_AND_DETAIL"
                : "CMS_BOARD_REPEATED_CONTAINER_WITH_DATE_AND_DETAIL",

            itemSelector:
              dominantContainerType
              === "TR"
                ? "tr"
                : dominantContainerType
                  ? dominantContainerType.toLowerCase()
                  : null,

            titleStrategy:
              "DETAIL_ANCHOR_TITLE",

            dateStrategy:
              "ROW_SINGLE_DATE",

            detailStrategy:
              "CMS_BOARD_DETAIL_ID",

            detailIdParameter:
              dominantIdentityParameter,

            dedupeKey:
              dominantIdentityParameter
              ? dominantIdentityParameter.toUpperCase()
              : "DETAIL_ID"
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
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    decision:
      collectorReady
        ? "COLLECTOR_READY"
        : "COLLECTOR_REVIEW_REQUIRED",

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    sourceCandidate: {
      sourceId:
        SOURCE_ID,

      listUrl:
        LIST_URL
    },

    upstream: {
      state:
        upstream.row.state,

      action:
        upstream.row.action,

      validationScore:
        upstream.row.bestCandidate
          ?.validationScore
        ?? null
    },

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      bytes:
        list.bytes,

      officialDomain:
        sameRootDomain(
          list.finalUrl,
          LIST_URL
        )
    },

    collector: {
      containers:
        containers.length,

      extracted:
        extracted.length,

      unique:
        unique.length,

      duplicateKeys,

      distinctTitles,

      distinctDates,

      containerTypeCounts,

      detailIdParameterCounts:
        identityParameterCounts
    },

    samples:
      unique.slice(
        0,
        5
      ),

    detailValidation: {
      tested:
        details.length,

      pass:
        detailPass,

      titlePass,

      datePass,

      validUrls
    },

    detailSamples:
      details,

    proposedCollector,

    nextAction:
      collectorReady
        ? "VERIFY_KYUNGDONG_ACTIVATION_READY"
        : "INSPECT_KYUNGDONG_BOARD_STRUCTURE",

    requests:
      1
      +
      details.length,

    hashSafe:
      true,

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
      {
        decision:
          report.decision,

        universityId:
          report.universityId,

        universityName:
          report.universityName,

        list:
          report.list,

        collector:
          report.collector,

        detailValidation:
          report.detailValidation,

        proposedCollector:
          report.proposedCollector,

        nextAction:
          report.nextAction,

        requests:
          report.requests,

        outputFile:
          OUTPUT_FILE,

        safety:
          report.safety
      },
      null,
      2
    )
  );
}

/* ============================================================
 * Execute
 * ============================================================ */

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
              error.name,

            message:
              error.message
          },

          safety: {
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