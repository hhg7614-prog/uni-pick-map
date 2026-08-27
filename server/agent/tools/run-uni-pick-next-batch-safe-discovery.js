"use strict";

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

const BATCH_FILE = path.join(
  DATA,
  "uni-pick-next-university-batch.json"
);

const HINT_FILE = path.join(
  DATA,
  "uni-pick-next-batch-hints.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-next-batch-safe-discovery.json"
);

const MAX_CANDIDATES_PER_UNIVERSITY = 20;
const MAX_SECONDARY_REQUESTS_PER_UNIVERSITY = 8;

/*
 * 이번 배치의 시작 URL.
 *
 * 주의:
 * - Markdown 링크 형식 금지
 * - 순수 URL 문자열만 사용
 * - 실제 응답/리다이렉트 후 대학명 검증을 반드시 통과해야 함
 */
const OFFICIAL_START_URLS = {
  "kyungdong-university-본교":
    "https://www.kduniv.ac.kr/",

  "kaya-university-본교":
    "https://www.kaya.ac.kr/",

  "catholic-kwandong-university-본교":
    "https://www.cku.ac.kr/cku_kr/index.do",

  "the-catholic-university-of-korea-본교":
    "https://www.catholic.ac.kr/ko/main.do",

  "kangnam-university-본교":
    "https://www.kangnam.ac.kr/",

  "gangseo-university-본교":
    "https://www.gangseo.ac.kr/",

  "konyang-university-본교":
    "https://www.konyang.ac.kr/kor.do",

  "kyungsung-university-본교":
    "https://www.ks.ac.kr/kor/Main.do",

  "gyeongin-national-university-of-education-본교":
    "https://www.ginue.ac.kr/kor/Main.do",

  "kyungil-university-본교":
    "https://www.kiu.ac.kr/"
};

const UNIVERSITY_NAME_SIGNALS = {
  "kyungdong-university-본교": [
    "경동대학교",
    "Kyungdong University"
  ],

  "kaya-university-본교": [
    "가야대학교",
    "Kaya University"
  ],

  "catholic-kwandong-university-본교": [
    "가톨릭관동대학교",
    "Catholic Kwandong University"
  ],

  "the-catholic-university-of-korea-본교": [
    "가톨릭대학교",
    "The Catholic University of Korea"
  ],

  "kangnam-university-본교": [
    "강남대학교",
    "Kangnam University"
  ],

  "gangseo-university-본교": [
    "강서대학교",
    "Gangseo University"
  ],

  "konyang-university-본교": [
    "건양대학교",
    "Konyang University"
  ],

  "kyungsung-university-본교": [
    "경성대학교",
    "Kyungsung University"
  ],

  "gyeongin-national-university-of-education-본교": [
    "경인교육대학교",
    "Gyeongin National University of Education"
  ],

  "kyungil-university-본교": [
    "경일대학교",
    "Kyungil University"
  ]
};

/*
 * 일반공지 / 대학소식 우선.
 *
 * 장학, 채용처럼 범위가 너무 좁은 게시판도 후보에는 잡힐 수 있지만
 * 후속 evaluator에서 GENERAL_UNIVERSITY_UPDATES 여부를 다시 확인한다.
 */
const CONTENT_KEYWORDS = [
  "공지",
  "공지사항",
  "일반공지",
  "학사공지",
  "학생공지",
  "대학공지",
  "대학소식",
  "학교소식",
  "대학뉴스",
  "학교뉴스",
  "뉴스",
  "소식",
  "보도자료",
  "언론보도",
  "행사",
  "장학공지",
  "채용",
  "notice",
  "news",
  "board",
  "community",
  "press",
  "bulletin"
];

const PREFERRED_GENERAL_KEYWORDS = [
  "일반공지",
  "공지사항",
  "대학소식",
  "학교소식",
  "대학뉴스",
  "학교뉴스",
  "뉴스",
  "소식",
  "보도자료",
  "언론보도"
];

const NARROW_SCOPE_KEYWORDS = [
  "채용",
  "장학",
  "입학",
  "신입생",
  "편입생",
  "학번찾기",
  "교외근로",
  "취업",
  "웹메일"
];

const EXCLUDED_LINK_SIGNALS = [
  "login",
  "logout",
  "member",
  "privacy",
  "policy",
  "sitemap",
  "facebook",
  "instagram",
  "youtube",
  "twitter",
  "javascript:",
  "mailto:",
  "tel:",
  ".pdf",
  ".hwp",
  ".hwpx",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg"
];

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

  const json =
    JSON.stringify(
      value,
      null,
      2
    ) + "\n";

  fs.writeFileSync(
    temp,
    json,
    "utf8"
  );

  /*
   * 저장 직후 실제 JSON parse가 되는지 확인.
   * 이 단계에서 실패하면 기존 output은 건드리지 않는다.
   */
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
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#34;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ");
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
        /<noscript\b[\s\S]*?<\/noscript>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdownUrl(value) {
  const text =
    String(
      value || ""
    ).trim();

  /*
   * 과거 파일에
   * [https://example.com](https://example.com)
   * 형태가 들어왔을 경우 방어적으로 실제 URL만 추출.
   */
  const markdownMatch =
    text.match(
      /^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/
    );

  if (markdownMatch) {
    return markdownMatch[1];
  }

  return text;
}

function normalizeUrl(
  value,
  baseUrl = null
) {
  if (!value) {
    return null;
  }

  const cleaned =
    stripMarkdownUrl(
      decodeHtml(
        value
      )
    );

  try {
    const url =
      baseUrl
        ? new URL(
            cleaned,
            baseUrl
          )
        : new URL(
            cleaned
          );

    url.hash = "";

    if (
      url.protocol !== "http:"
      &&
      url.protocol !== "https:"
    ) {
      return null;
    }

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

function rootDomain(value) {
  const host =
    hostname(value);

  if (!host) {
    return null;
  }

  const parts =
    host.split(".");

  /*
   * 한국 대학 도메인은 보통 xxx.ac.kr 이므로
   * ac.kr 포함 시 마지막 3단계를 root로 취급.
   */
  if (
    parts.length >= 3
    &&
    parts.slice(-2).join(".")
      === "ac.kr"
  ) {
    return parts
      .slice(-3)
      .join(".");
  }

  if (parts.length >= 2) {
    return parts
      .slice(-2)
      .join(".");
  }

  return host;
}

function sameRootDomain(
  a,
  b
) {
  const rootA =
    rootDomain(a);

  const rootB =
    rootDomain(b);

  if (
    !rootA
    ||
    !rootB
  ) {
    return false;
  }

  return rootA === rootB;
}

/* ============================================================
 * Network
 * ============================================================ */

function curlPage(url) {
  const normalized =
    normalizeUrl(url);

  if (!normalized) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      bytes: 0,
      error: "INVALID_URL"
    };
  }

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
        "Mozilla/5.0 compatible UNI-PICK Safe Discovery",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__META__%{http_code}|%{url_effective}",

        normalized
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

  const separator =
    meta.indexOf("|");

  const rawStatus =
    separator >= 0
      ? meta.slice(
          0,
          separator
        )
      : meta;

  const rawFinalUrl =
    separator >= 0
      ? meta.slice(
          separator + 1
        )
      : normalized;

  const status =
    Number(
      rawStatus
    );

  const finalUrl =
    normalizeUrl(
      rawFinalUrl
    )
    ||
    normalized;

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

    finalUrl,

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
 * Homepage verification
 * ============================================================ */

function verifyUniversityIdentity(
  universityId,
  html
) {
  const text =
    plain(
      html
    );

  const normalizedText =
    text
      .normalize("NFC")
      .toLowerCase();

  const signals =
    UNIVERSITY_NAME_SIGNALS[
      universityId
    ]
    || [];

  const matched =
    signals.filter(
      signal =>
        normalizedText.includes(
          String(signal)
            .normalize("NFC")
            .toLowerCase()
        )
    );

  return {
    signals,
    matched,

    pass:
      matched.length > 0
  };
}

/* ============================================================
 * Anchor parsing
 * ============================================================ */

function extractAnchors(
  html,
  baseUrl
) {
  const anchors = [];

  for (
    const match
    of String(
      html || ""
    ).matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    )
  ) {
    const attrs =
      match[1]
      || "";

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

    const text =
      plain(
        match[2]
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
      text,

      href:
        decodeHtml(
          href
        ),

      url
    });
  }

  return anchors;
}

function excludedLink(
  anchor
) {
  const joined =
    `${
      anchor.text || ""
    } ${
      anchor.href || ""
    } ${
      anchor.url || ""
    }`
      .toLowerCase();

  return EXCLUDED_LINK_SIGNALS.some(
    signal =>
      joined.includes(
        signal
      )
  );
}

function containsKeyword(
  text,
  keyword
) {
  return String(
    text || ""
  )
    .normalize("NFC")
    .toLowerCase()
    .includes(
      String(keyword)
        .normalize("NFC")
        .toLowerCase()
    );
}

function candidateScore(
  anchor,
  homepageUrl
) {
  if (
    excludedLink(
      anchor
    )
  ) {
    return {
      score:
        -1000,

      reasons: [
        "EXCLUDED_LINK"
      ]
    };
  }

  const text =
    String(
      anchor.text || ""
    ).trim();

  const url =
    String(
      anchor.url || ""
    );

  const combined =
    `${text} ${url}`;

  let score = 0;

  const reasons = [];

  if (
    sameRootDomain(
      url,
      homepageUrl
    )
  ) {
    score += 25;

    reasons.push(
      "OFFICIAL_DOMAIN"
    );
  } else {
    score -= 100;

    reasons.push(
      "EXTERNAL_DOMAIN"
    );
  }

  for (
    const keyword
    of CONTENT_KEYWORDS
  ) {
    if (
      containsKeyword(
        combined,
        keyword
      )
    ) {
      score += 18;

      reasons.push(
        `KEYWORD:${keyword}`
      );
    }
  }

  /*
   * 일반 대학 공지/소식 게시판을 우선한다.
   */
  for (
    const keyword
    of PREFERRED_GENERAL_KEYWORDS
  ) {
    if (
      containsKeyword(
        text,
        keyword
      )
    ) {
      score += 18;

      reasons.push(
        `GENERAL_SCOPE:${keyword}`
      );
    }
  }

  /*
   * 채용/장학/입학 등 좁은 범위 게시판은
   * 완전히 제외하지는 않되 우선순위를 낮춘다.
   */
  for (
    const keyword
    of NARROW_SCOPE_KEYWORDS
  ) {
    if (
      containsKeyword(
        text,
        keyword
      )
    ) {
      score -= 12;

      reasons.push(
        `NARROW_SCOPE:${keyword}`
      );
    }
  }

  if (
    text.length >= 2
  ) {
    score += 3;
  }

  if (
    text.length >= 5
  ) {
    score += 5;
  }

  if (
    /board|bbs|notice|news|community|press|article|list|bulletin/i
      .test(
        url
      )
  ) {
    score += 20;

    reasons.push(
      "BOARDISH_URL"
    );
  }

  if (
    /mode=list|pageIndex|boardNo|boardSeq|mCode|menuNo|bbsId|article|BBSMSTR/i
      .test(
        url
      )
  ) {
    score += 10;

    reasons.push(
      "BOARD_QUERY_OR_PATH"
    );
  }

  /*
   * detail 페이지보다 list 페이지 우선.
   */
  if (
    /mode=view|artclView|board_seq=\d+/i
      .test(
        url
      )
  ) {
    score -= 25;

    reasons.push(
      "DETAIL_PAGE_PENALTY"
    );
  }

  return {
    score,

    reasons:
      [
        ...new Set(
          reasons
        )
      ]
  };
}

/* ============================================================
 * Candidate discovery
 * ============================================================ */

function discoverCandidates(
  html,
  homepageUrl
) {
  const anchors =
    extractAnchors(
      html,
      homepageUrl
    );

  const scored =
    anchors
      .map(
        anchor => {
          const scoreResult =
            candidateScore(
              anchor,
              homepageUrl
            );

          return {
            ...anchor,
            ...scoreResult
          };
        }
      )
      .filter(
        item =>
          item.score > 20
      );

  const dedupe =
    new Map();

  for (
    const item
    of scored
  ) {
    const existing =
      dedupe.get(
        item.url
      );

    if (
      !existing
      ||
      item.score >
      existing.score
    ) {
      dedupe.set(
        item.url,
        item
      );
    }
  }

  return [
    ...dedupe.values()
  ]
    .sort(
      (a, b) =>
        b.score - a.score
        ||
        b.text.length - a.text.length
    )
    .slice(
      0,
      MAX_CANDIDATES_PER_UNIVERSITY
    );
}

/* ============================================================
 * Secondary validation
 * ============================================================ */

function inspectCandidate(
  candidate,
  homepageUrl
) {
  const page =
    curlPage(
      candidate.url
    );

  if (!page.ok) {
    return {
      ...candidate,

      requestStatus:
        page.status,

      finalUrl:
        page.finalUrl,

      bytes:
        page.bytes,

      reachable:
        false,

      officialDomain:
        false,

      dateCount:
        0,

      uniqueDateCount:
        0,

      titleLikeAnchorCount:
        0,

      contentSignalCount:
        0,

      generalSignalCount:
        0,

      narrowSignalCount:
        0,

      validationScore:
        candidate.score,

      error:
        page.error
    };
  }

  const text =
    plain(
      page.html
    );

  const dates =
    text.match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
    || [];

  const pageAnchors =
    extractAnchors(
      page.html,
      page.finalUrl
    );

  const titleLike =
    pageAnchors.filter(
      anchor =>
        anchor.text.length >= 5
        &&
        anchor.text.length <= 150
    );

  let contentSignalCount = 0;
  let generalSignalCount = 0;
  let narrowSignalCount = 0;

  for (
    const keyword
    of CONTENT_KEYWORDS
  ) {
    if (
      containsKeyword(
        text,
        keyword
      )
    ) {
      contentSignalCount += 1;
    }
  }

  for (
    const keyword
    of PREFERRED_GENERAL_KEYWORDS
  ) {
    if (
      containsKeyword(
        text,
        keyword
      )
    ) {
      generalSignalCount += 1;
    }
  }

  for (
    const keyword
    of NARROW_SCOPE_KEYWORDS
  ) {
    if (
      containsKeyword(
        text,
        keyword
      )
    ) {
      narrowSignalCount += 1;
    }
  }

  const official =
    sameRootDomain(
      page.finalUrl,
      homepageUrl
    );

  let validationScore =
    candidate.score;

  if (official) {
    validationScore += 25;
  } else {
    validationScore -= 100;
  }

  if (
    dates.length >= 3
  ) {
    validationScore += 15;
  }

  if (
    dates.length >= 5
  ) {
    validationScore += 10;
  }

  if (
    titleLike.length >= 5
  ) {
    validationScore += 10;
  }

  if (
    contentSignalCount >= 2
  ) {
    validationScore += 10;
  }

  if (
    generalSignalCount >= 1
  ) {
    validationScore += 10;
  }

  if (
    narrowSignalCount > 0
    &&
    generalSignalCount === 0
  ) {
    validationScore -= 15;
  }

  return {
    ...candidate,

    requestStatus:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    reachable:
      true,

    officialDomain:
      official,

    dateCount:
      dates.length,

    uniqueDateCount:
      new Set(
        dates
      ).size,

    titleLikeAnchorCount:
      titleLike.length,

    contentSignalCount,

    generalSignalCount,

    narrowSignalCount,

    validationScore,

    error:
      null
  };
}

/* ============================================================
 * University discovery
 * ============================================================ */

function discoverUniversity(
  item,
  hintEntry = null
) {
  const universityId =
    normalizeId(
      item.universityId
    );

  const configuredStart =
    normalizeUrl(
      OFFICIAL_START_URLS[
        universityId
      ]
      || null
    );

  const hintStart =
    normalizeUrl(
      hintEntry
        ?.bestDomainCandidate
        ?.sampleUrls
        ?.[0]
      || null
    );

  const startUrl =
    configuredStart
    ||
    hintStart;

  if (!startUrl) {
    return {
      order:
        item.order,

      universityId,

      universityName:
        item.universityName,

      status:
        "NO_START_URL",

      homepage:
        null,

      homepageStatus:
        null,

      identityVerified:
        false,

      candidates:
        [],

      bestCandidate:
        null,

      requestCount:
        0
    };
  }

  const homepage =
    curlPage(
      startUrl
    );

  if (!homepage.ok) {
    return {
      order:
        item.order,

      universityId,

      universityName:
        item.universityName,

      status:
        "HOMEPAGE_FETCH_FAILED",

      homepage: {
        requestedUrl:
          startUrl,

        status:
          homepage.status,

        finalUrl:
          homepage.finalUrl,

        bytes:
          homepage.bytes,

        error:
          homepage.error
      },

      identityVerified:
        false,

      identity:
        null,

      candidates:
        [],

      bestCandidate:
        null,

      requestCount:
        1
    };
  }

  const identity =
    verifyUniversityIdentity(
      universityId,
      homepage.html
    );

  if (!identity.pass) {
    return {
      order:
        item.order,

      universityId,

      universityName:
        item.universityName,

      status:
        "HOMEPAGE_IDENTITY_REVIEW",

      homepage: {
        requestedUrl:
          startUrl,

        status:
          homepage.status,

        finalUrl:
          homepage.finalUrl,

        bytes:
          homepage.bytes,

        error:
          null
      },

      identityVerified:
        false,

      identity,

      candidates:
        [],

      bestCandidate:
        null,

      requestCount:
        1
    };
  }

  const candidates =
    discoverCandidates(
      homepage.html,
      homepage.finalUrl
    );

  const inspected = [];

  for (
    const candidate
    of candidates.slice(
      0,
      MAX_SECONDARY_REQUESTS_PER_UNIVERSITY
    )
  ) {
    inspected.push(
      inspectCandidate(
        candidate,
        homepage.finalUrl
      )
    );
  }

  inspected.sort(
    (a, b) =>
      b.validationScore -
      a.validationScore
      ||
      b.score -
      a.score
  );

  const bestCandidate =
    inspected[0]
    || null;

  let status =
    "NO_CANDIDATE";

  if (
    bestCandidate
    &&
    bestCandidate.reachable
    &&
    bestCandidate.officialDomain
    &&
    bestCandidate.validationScore >= 85
  ) {
    status =
      "CANDIDATE_DISCOVERED";
  } else if (
    bestCandidate
    &&
    bestCandidate.reachable
    &&
    bestCandidate.officialDomain
    &&
    bestCandidate.validationScore >= 55
  ) {
    status =
      "REVIEW_CANDIDATE";
  }

  return {
    order:
      item.order,

    universityId,

    universityName:
      item.universityName,

    status,

    homepage: {
      requestedUrl:
        startUrl,

      status:
        homepage.status,

      finalUrl:
        homepage.finalUrl,

      bytes:
        homepage.bytes,

      error:
        null
    },

    identityVerified:
      true,

    identity,

    candidateCount:
      candidates.length,

    candidates:
      inspected,

    bestCandidate,

    requestCount:
      1 + inspected.length
  };
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      BATCH_FILE
    )
  ) {
    throw new Error(
      "NEXT_BATCH_FILE_NOT_FOUND"
    );
  }

  const batch =
    readJson(
      BATCH_FILE,
      {
        batch: []
      }
    );

  if (
    !batch
    ||
    !Array.isArray(
      batch.batch
    )
  ) {
    throw new Error(
      "NEXT_BATCH_JSON_INVALID"
    );
  }

  const hints =
    readJson(
      HINT_FILE,
      {
        results: [],
        universities: []
      }
    );

  const hintRows =
    Array.isArray(
      hints?.results
    )
      ? hints.results
      : (
          Array.isArray(
            hints?.universities
          )
            ? hints.universities
            : []
        );

  const hintMap =
    new Map();

  for (
    const item
    of hintRows
  ) {
    hintMap.set(
      normalizeId(
        item.universityId
      ),
      item
    );
  }

  const results = [];

  let totalRequests = 0;

  for (
    const item
    of batch.batch
  ) {
    const result =
      discoverUniversity(
        item,
        hintMap.get(
          normalizeId(
            item.universityId
          )
        )
        || null
      );

    totalRequests +=
      result.requestCount
      || 0;

    results.push(
      result
    );
  }

  const counts = {};

  for (
    const result
    of results
  ) {
    counts[
      result.status
    ] =
      (
        counts[
          result.status
        ]
        || 0
      ) + 1;
  }

  const actionable =
    results.filter(
      result =>
        result.status
        === "CANDIDATE_DISCOVERED"
        ||
        result.status
        === "REVIEW_CANDIDATE"
    );

  const report = {
    schemaVersion:
      "1.1",

    generatedAt:
      new Date()
        .toISOString(),

    decision:
      actionable.length > 0
        ? "NEXT_BATCH_DISCOVERY_COMPLETE"
        : "NEXT_BATCH_DISCOVERY_REVIEW",

    sourceBatch:
      path.basename(
        BATCH_FILE
      ),

    sourceHints:
      path.basename(
        HINT_FILE
      ),

    processed:
      results.length,

    counts,

    totalRequests,

    results,

    nextAction:
      actionable.length > 0
        ? "EVALUATE_NEXT_BATCH_CANDIDATES"
        : "REVIEW_NEXT_BATCH_DISCOVERY_FAILURES",

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

        processed:
          report.processed,

        counts:
          report.counts,

        totalRequests:
          report.totalRequests,

        universities:
          report.results.map(
            result => ({
              order:
                result.order,

              universityId:
                result.universityId,

              universityName:
                result.universityName,

              status:
                result.status,

              homepageStatus:
                result.homepage
                  ?.status
                ?? null,

              finalHomepage:
                result.homepage
                  ?.finalUrl
                || null,

              identityVerified:
                result.identityVerified,

              candidateCount:
                result.candidateCount
                || 0,

              bestCandidate:
                result.bestCandidate
                  ? {
                      text:
                        result.bestCandidate.text,

                      url:
                        result.bestCandidate.url,

                      finalUrl:
                        result.bestCandidate.finalUrl,

                      score:
                        result.bestCandidate.score,

                      validationScore:
                        result.bestCandidate.validationScore,

                      dateCount:
                        result.bestCandidate.dateCount,

                      officialDomain:
                        result.bestCandidate.officialDomain,

                      generalSignalCount:
                        result.bestCandidate.generalSignalCount,

                      narrowSignalCount:
                        result.bestCandidate.narrowSignalCount
                    }
                  : null
            })
          ),

        nextAction:
          report.nextAction,

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

          error: {
            name:
              error.name,

            message:
              error.message
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