"use strict";

/**
 * UNI PICK
 * 援?┰紐⑺룷??숆탳 Flexible / Deep Source Discovery
 *
 * 紐⑹쟻
 * ------------------------------------------------------------
 * 湲곗〈 discovery媛 NO_CANDIDATE???援?┰紐⑺룷??숆탳?먯꽌
 * 怨듭?/?숈궗/?낇븰/?됱궗/梨꾩슜/??숈냼?????볦? 踰붿＜??
 * 怨듭떇 寃뚯떆??source ?꾨낫瑜??ㅼ떆 ?먯깋?쒕떎.
 *
 * ?뺤콉
 * ------------------------------------------------------------
 * - 怨듭??ы빆/?댁뒪湲곗궗/?됱궗?뚯떇怨??뺥솗???숈씪?섏? ?딆븘???덉슜
 * - ?쇰컲怨듭?, ?숈궗怨듭?, ?낇븰怨듭?, 痍⑥뾽怨듭?, 梨꾩슜, 遊됱궗,
 *   ??숈냼?? ?꾨줈洹몃옩 ?덈궡 ??GENERAL_UNIVERSITY_UPDATES ?덉슜
 *
 * transport
 * ------------------------------------------------------------
 * - curl.exe ?ъ슜
 * - TLS verification ?좎?
 * - -k / --insecure 湲덉?
 *
 * safety
 * ------------------------------------------------------------
 * - read only
 * - catalog ?섏젙 ?놁쓬
 * - store ?섏젙 ?놁쓬
 * - preview ?섏젙 ?놁쓬
 * - queue ?섏젙 ?놁쓬
 * - git/deploy ?놁쓬
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const OUTPUT_FILE = path.join(
  DATA,
  "mokpo-national-flexible-discovery.json"
);

const UNIVERSITY_ID =
  "mokpo-national-university-蹂멸탳";

const UNIVERSITY_NAME =
  "援?┰紐⑺룷??숆탳";

const BASE_ORIGIN =
  "http://www.mnu.ac.kr";

const START_URLS = [
  "http://www.mnu.ac.kr/",
  "http://www.mnu.ac.kr/www/index.do",

  // ?꾩옱 ?뺤씤?????怨듭떇 寃뚯떆??
  "http://www.mnu.ac.kr/www/308/subview.do",
  "http://www.mnu.ac.kr/www/309/subview.do",

  // ?낇븰
  "http://www.mnu.ac.kr/sites/ipsi/index.do"
];

const MAX_DISCOVERED_CANDIDATES = 40;
const MAX_TESTS = 20;
const DETAIL_SAMPLE_LIMIT = 5;

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


/* ============================================================
 * Utility
 * ============================================================ */

function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const temp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(temp, "utf8")
  );

  fs.renameSync(temp, file);
}


function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}


function plain(value) {
  return decodeHtml(
    String(value || "")
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
  )
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  const text =
    decodeHtml(value).trim();

  if (
    /^javascript:/i.test(text)
  ) {
    return null;
  }

  if (
    /^mailto:/i.test(text)
    ||
    /^tel:/i.test(text)
  ) {
    return null;
  }

  try {
    const url =
      new URL(
        text,
        base
      );

    if (
      !/^https?:$/.test(
        url.protocol
      )
    ) {
      return null;
    }

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
        .replace(/^www\./, "");

    return (
      host === "mnu.ac.kr"
      ||
      host.endsWith(".mnu.ac.kr")
    );

  } catch {
    return false;
  }
}


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


/* ============================================================
 * curl transport
 * ============================================================ */

function curlPage(url) {
  const result =
    spawnSync(
      "curl.exe",
      [
        "-L",
        "--max-redirs", "10",

        "--connect-timeout", "20",
        "--max-time", "30",

        "--silent",
        "--show-error",
        "--compressed",

        "-A",
        "Mozilla/5.0 compatible UNI-PICK Mokpo National Discovery",

        "-H",
        "Accept: text/html,application/xhtml+xml",

        "-H",
        "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",

        "-w",
        "\n__META__%{http_code}|%{url_effective}",

        url
      ],
      {
        encoding: "utf8",
        timeout: 35000,
        windowsHide: true,
        maxBuffer:
          30 * 1024 * 1024
      }
    );

  if (result.error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      bytes: 0,
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
      ok: false,
      status: null,
      finalUrl: null,
      html: stdout,
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

  const [
    rawStatus,
    finalUrl
  ] =
    stdout
      .slice(
        index + marker.length
      )
      .trim()
      .split("|");

  const status =
    Number(rawStatus);

  return {
    ok:
      result.status === 0
      &&
      status >= 200
      &&
      status < 400,

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
        : String(
            result.stderr || ""
          ).trim()
  };
}


/* ============================================================
 * Anchor extraction
 * ============================================================ */

function extractAnchors(
  html,
  baseUrl
) {
  const output = [];

  for (
    const match
    of String(html || "").matchAll(
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

    const label =
      plain(
        match[2]
      );

    output.push({
      label,
      url
    });
  }

  return output;
}


/* ============================================================
 * Date detection
 * ============================================================ */

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

  const month =
    Number(
      match[2]
    );

  const day =
    Number(
      match[3]
    );

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

  return (
    `${match[1]}-`
    +
    `${String(month).padStart(2, "0")}-`
    +
    String(day).padStart(2, "0")
  );
}


function countDates(html) {
  const text =
    plain(html);

  const matches =
    text.match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    )
    || [];

  return [
    ...new Set(
      matches
        .map(normalizeDate)
        .filter(Boolean)
    )
  ];
}


/* ============================================================
 * Candidate scoring
 * ============================================================ */

const STRONG_TERMS = [
  "?쇰컲怨듭?",
  "?숈궗怨듭?",
  "怨듭??ы빆",
  "??숈냼??,
  "?숆탳?뚯떇",
  "?낇븰怨듭?",
  "痍⑥뾽怨듭?",
  "援먮궡梨꾩슜",
  "梨꾩슜怨듦퀬"
];

const MEDIUM_TERMS = [
  "怨듭?",
  "?뚯떇",
  "?숈궗",
  "?낇븰",
  "?됱궗",
  "?꾨줈洹몃옩",
  "?덈궡",
  "梨꾩슜",
  "痍⑥뾽",
  "遊됱궗",
  "?ν븰",
  "紐⑥쭛",
  "援먯쑁",
  "而ㅻ??덊떚"
];

const NEGATIVE_TERMS = [
  "濡쒓렇??,
  "?ъ씠?몃㏊",
  "?ㅼ떆?붽만",
  "?꾪솕踰덊샇",
  "媛쒖씤?뺣낫",
  "?대찓?쇰Т?⑥닔吏?,
  "議곗쭅??,
  "珥앹옣",
  "??궗",
  "鍮꾩쟾",
  "?숆낵?뚭컻",
  "援먯닔?뚭컻"
];


function scoreLink(
  label,
  url
) {
  const text =
    `${label || ""} ${url || ""}`
      .toLowerCase();

  let score = 0;

  const reasons = [];

  for (
    const term
    of STRONG_TERMS
  ) {
    if (
      text.includes(
        term.toLowerCase()
      )
    ) {
      score += 45;

      reasons.push(
        `STRONG:${term}`
      );
    }
  }

  for (
    const term
    of MEDIUM_TERMS
  ) {
    if (
      text.includes(
        term.toLowerCase()
      )
    ) {
      score += 12;

      reasons.push(
        `MEDIUM:${term}`
      );
    }
  }

  for (
    const term
    of NEGATIVE_TERMS
  ) {
    if (
      text.includes(
        term.toLowerCase()
      )
    ) {
      score -= 20;

      reasons.push(
        `NEGATIVE:${term}`
      );
    }
  }

  if (
    /\/bbs\//i.test(url)
  ) {
    score += 25;

    reasons.push(
      "BOARD_PATH"
    );
  }

  if (
    /subview\.do/i.test(url)
  ) {
    score += 15;

    reasons.push(
      "SUBVIEW"
    );
  }

  if (
    /articleNo=|artclNo=|artclSeq=|bbsNo=/i.test(
      url
    )
  ) {
    score += 10;

    reasons.push(
      "ARTICLE_HINT"
    );
  }

  if (
    officialDomain(url)
  ) {
    score += 20;

    reasons.push(
      "OFFICIAL_DOMAIN"
    );
  }

  return {
    score,
    reasons
  };
}


/* ============================================================
 * Detail-link analysis
 * ============================================================ */

function isLikelyDetailUrl(url) {
  if (!url) {
    return false;
  }

  if (
    !officialDomain(url)
  ) {
    return false;
  }

  return (
    /artclView\.do/i.test(url)
    ||
    /articleNo=\d+/i.test(url)
    ||
    /artclNo=\d+/i.test(url)
    ||
    /mode=view/i.test(url)
  );
}


function extractLikelyDetailLinks(
  html,
  baseUrl
) {
  const anchors =
    extractAnchors(
      html,
      baseUrl
    );

  const filtered =
    anchors
      .filter(
        item =>
          item.label
          &&
          item.label.length >= 4
          &&
          isLikelyDetailUrl(
            item.url
          )
      );

  return [
    ...new Map(
      filtered.map(
        item => [
          item.url,
          item
        ]
      )
    ).values()
  ];
}


/* ============================================================
 * Structure scoring
 * ============================================================ */

function detectStructure(html) {
  const tr =
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || [];

  const li =
    html.match(
      /<li\b[^>]*>[\s\S]*?<\/li>/gi
    )
    || [];

  const dl =
    html.match(
      /<dl\b[^>]*>[\s\S]*?<\/dl>/gi
    )
    || [];

  const candidates = [
    {
      type: "TR",
      count: tr.length
    },
    {
      type: "LI",
      count: li.length
    },
    {
      type: "DL",
      count: dl.length
    }
  ]
    .sort(
      (a, b) =>
        b.count
        -
        a.count
    );

  return candidates[0];
}


/* ============================================================
 * Candidate validation
 * ============================================================ */

function evaluateCandidate(
  candidate
) {
  const page =
    curlPage(
      candidate.url
    );

  if (
    !page.ok
    ||
    page.status !== 200
  ) {
    return {
      ...candidate,

      status:
        page.status,

      finalUrl:
        page.finalUrl,

      bytes:
        page.bytes,

      dates:
        0,

      detailLinks:
        0,

      distinctTitles:
        0,

      structure:
        null,

      finalScore:
        candidate.initialScore
        -
        50,

      pass:
        false,

      error:
        page.error
    };
  }

  const dates =
    countDates(
      page.html
    );

  const detailLinks =
    extractLikelyDetailLinks(
      page.html,
      page.finalUrl
    );

  const distinctTitles =
    new Set(
      detailLinks.map(
        item =>
          item.label
      )
    ).size;

  const structure =
    detectStructure(
      page.html
    );

  let finalScore =
    candidate.initialScore;

  const reasons =
    [
      ...candidate.reasons
    ];

  finalScore += 20;

  reasons.push(
    "HTTP_200"
  );

  if (
    officialDomain(
      page.finalUrl
    )
  ) {
    finalScore += 20;

    reasons.push(
      "FINAL_OFFICIAL_DOMAIN"
    );
  }

  if (
    dates.length >= 3
  ) {
    finalScore += 15;

    reasons.push(
      "DATES_3_PLUS"
    );
  }

  if (
    dates.length >= 10
  ) {
    finalScore += 10;

    reasons.push(
      "DATES_10_PLUS"
    );
  }

  if (
    detailLinks.length >= 3
  ) {
    finalScore += 25;

    reasons.push(
      "DETAIL_LINKS_3_PLUS"
    );
  }

  if (
    detailLinks.length >= 10
  ) {
    finalScore += 15;

    reasons.push(
      "DETAIL_LINKS_10_PLUS"
    );
  }

  if (
    distinctTitles >= 5
  ) {
    finalScore += 15;

    reasons.push(
      "TITLE_VARIETY"
    );
  }

  if (
    structure
    &&
    structure.count >= 5
  ) {
    finalScore += 10;

    reasons.push(
      `STRUCTURE:${structure.type}`
    );
  }

  const pass =
    Boolean(
      finalScore >= 90
      &&
      officialDomain(
        page.finalUrl
      )
      &&
      (
        detailLinks.length >= 3
        ||
        dates.length >= 5
      )
    );

  return {
    ...candidate,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    dates:
      dates.length,

    detailLinks:
      detailLinks.length,

    distinctTitles,

    structure,

    finalScore,

    pass,

    reasons,

    sampleDetailLinks:
      detailLinks
        .slice(0, 5),

    error:
      null
  };
}


/* ============================================================
 * Main
 * ============================================================ */

function main() {
  const beforeHashes =
    operationalHashes();

  let requests = 0;

  const startResults = [];

  const discovered = [];

  /*
   * 1. Seed URLs 吏곸젒 ?뺤씤
   */

  for (
    const url
    of START_URLS
  ) {
    requests += 1;

    const page =
      curlPage(url);

    startResults.push({
      url,
      status:
        page.status,
      finalUrl:
        page.finalUrl,
      bytes:
        page.bytes,
      ok:
        page.ok
    });

    if (
      !page.ok
      ||
      page.status !== 200
      ||
      !officialDomain(
        page.finalUrl
      )
    ) {
      continue;
    }

    const anchors =
      extractAnchors(
        page.html,
        page.finalUrl
      );

    for (
      const anchor
      of anchors
    ) {
      if (
        !officialDomain(
          anchor.url
        )
      ) {
        continue;
      }

      const scored =
        scoreLink(
          anchor.label,
          anchor.url
        );

      if (
        scored.score < 20
      ) {
        continue;
      }

      discovered.push({
        label:
          anchor.label,

        url:
          anchor.url,

        initialScore:
          scored.score,

        reasons:
          scored.reasons
      });
    }
  }


  /*
   * 2. 媛뺤젣 canonical ?꾨낫??異붽?
   */

  const forced = [
    {
      label:
        "?쇰컲怨듭?",

      url:
        "http://www.mnu.ac.kr/www/308/subview.do"
    },
    {
      label:
        "?숈궗怨듭?",

      url:
        "http://www.mnu.ac.kr/www/309/subview.do"
    },
    {
      label:
        "?낇븰怨듭?",

      url:
        "http://www.mnu.ac.kr/sites/ipsi/index.do"
    }
  ];

  for (
    const item
    of forced
  ) {
    const scored =
      scoreLink(
        item.label,
        item.url
      );

    discovered.push({
      ...item,

      initialScore:
        scored.score + 30,

      reasons: [
        ...scored.reasons,
        "FORCED_OFFICIAL_SEED"
      ]
    });
  }


  /*
   * 3. URL ?⑥쐞 以묐났 ?쒓굅
   */

  const uniqueCandidates =
    [
      ...new Map(
        discovered.map(
          item => [
            item.url,
            item
          ]
        )
      ).values()
    ]
      .sort(
        (a, b) =>
          b.initialScore
          -
          a.initialScore
      )
      .slice(
        0,
        MAX_DISCOVERED_CANDIDATES
      );


  /*
   * 4. ?곸쐞 ?꾨낫 ?ㅼ젣 寃利?
   */

  const tested = [];

  for (
    const candidate
    of uniqueCandidates.slice(
      0,
      MAX_TESTS
    )
  ) {
    requests += 1;

    tested.push(
      evaluateCandidate(
        candidate
      )
    );
  }


  tested.sort(
    (a, b) =>
      b.finalScore
      -
      a.finalScore
  );


  const best =
    tested[0]
    || null;


  /*
   * 5. source ?쒖븞
   */

  let proposedSource =
    null;

  let decision =
    "NO_FLEXIBLE_SOURCE";

  let nextAction =
    "REVIEW_MOKPO_DISCOVERY_FAILURE";


  if (
    best
    &&
    best.pass
  ) {
    decision =
      "FLEXIBLE_SOURCE_DISCOVERED";

    nextAction =
      "VALIDATE_MOKPO_FLEXIBLE_SOURCE";

    const label =
      best.label
      || "怨듭떇 ?뚯떇";

    proposedSource = {
      id:
        "mokpo-national-general-feed",

      name:
        `援?┰紐⑺룷??숆탳 ${label}`,

      category:
        "school_news",

      sourceType:
        "official",

      collectionType:
        "html_or_custom",

      listUrl:
        best.finalUrl,

      campusScope:
        "CAMPUS_SPECIFIC",

      contentScope:
        "GENERAL_UNIVERSITY_UPDATES",

      matchedLabel:
        label,

      preferredStructure:
        best.structure?.type
        || null,

      verified:
        false,

      enabled:
        false,

      status:
        "candidate_pending_validation",

      healthStatus:
        "unknown",

      autoActivate:
        false
    };
  }
  else if (
    best
    &&
    best.status === 200
  ) {
    decision =
      "REVIEW_CANDIDATE";

    nextAction =
      "INSPECT_MOKPO_CANDIDATE_STRUCTURE";
  }


  /*
   * 6. read-only hash ?뺤씤
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

    transport: {
      type:
        "curl.exe",

      tlsVerificationDisabled:
        false
    },

    startResults,

    discovered:
      uniqueCandidates.length,

    tested:
      tested.length,

    best,

    top5:
      tested.slice(
        0,
        5
      ),

    proposedSource,

    decision,

    nextAction,

    requests,

    hashSafe,

    safety: {
      readOnly:
        true,

      networkRequests:
        requests,

      tlsBypass:
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

        transport:
          report.transport,

        startResults:
          report.startResults,

        discovered:
          report.discovered,

        tested:
          report.tested,

        best:
          report.best,

        top5:
          report.top5,

        proposedSource:
          report.proposedSource,

        nextAction:
          report.nextAction,

        requests:
          report.requests,

        hashSafe:
          report.hashSafe
      },
      null,
      2
    )
  );
}


if (
  require.main === module
) {
  main();
}
