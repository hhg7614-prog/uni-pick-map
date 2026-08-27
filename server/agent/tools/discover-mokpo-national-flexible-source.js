"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");

const OUTPUT_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "data",
  "mokpo-national-flexible-discovery.json"
);

const UNIVERSITY_ID = "mokpo-national-university-\uBCF8\uAD50";
const UNIVERSITY_NAME = "\uAD6D\uB9BD\uBAA9\uD3EC\uB300\uD559\uAD50";

const START_URLS = [
  "http://www.mnu.ac.kr/",
  "http://www.mnu.ac.kr/www/index.do",
  "http://www.mnu.ac.kr/www/308/subview.do",
  "http://www.mnu.ac.kr/www/309/subview.do",
  "http://www.mnu.ac.kr/sites/ipsi/index.do"
];

const FORCED = [
  {
    label: "\uC77C\uBC18\uACF5\uC9C0",
    url: "http://www.mnu.ac.kr/www/308/subview.do"
  },
  {
    label: "\uD559\uC0AC\uACF5\uC9C0",
    url: "http://www.mnu.ac.kr/www/309/subview.do"
  },
  {
    label: "\uC785\uD559\uACF5\uC9C0",
    url: "http://www.mnu.ac.kr/sites/ipsi/index.do"
  }
];

const STRONG_TERMS = [
  "\uC77C\uBC18\uACF5\uC9C0",
  "\uD559\uC0AC\uACF5\uC9C0",
  "\uACF5\uC9C0\uC0AC\uD56D",
  "\uB300\uD559\uC18C\uC2DD",
  "\uD559\uAD50\uC18C\uC2DD",
  "\uC785\uD559\uACF5\uC9C0",
  "\uCDE8\uC5C5\uACF5\uC9C0",
  "\uCC44\uC6A9\uACF5\uACE0"
];

const MEDIUM_TERMS = [
  "\uACF5\uC9C0",
  "\uC18C\uC2DD",
  "\uD559\uC0AC",
  "\uC785\uD559",
  "\uD589\uC0AC",
  "\uD504\uB85C\uADF8\uB7A8",
  "\uC548\uB0B4",
  "\uCC44\uC6A9",
  "\uCDE8\uC5C5",
  "\uBD09\uC0AC",
  "\uC7A5\uD559",
  "\uBAA8\uC9D1",
  "\uAD50\uC721"
];


function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&#039;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}


function plain(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeUrl(value, base) {
  try {
    const text = decodeHtml(value).trim();

    if (
      !text ||
      /^javascript:/i.test(text) ||
      /^mailto:/i.test(text) ||
      /^tel:/i.test(text)
    ) {
      return null;
    }

    const url = new URL(text, base);

    if (!/^https?:$/.test(url.protocol)) {
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
    const host = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return (
      host === "mnu.ac.kr" ||
      host.endsWith(".mnu.ac.kr")
    );
  } catch {
    return false;
  }
}


function curlPage(url) {
  const result = spawnSync(
    "curl.exe",
    [
      "-L",
      "--max-redirs", "10",
      "--connect-timeout", "20",
      "--max-time", "30",
      "--silent",
      "--show-error",
      "--compressed",
      "-A", "Mozilla/5.0 UNI-PICK Mokpo Discovery",
      "-H", "Accept: text/html,application/xhtml+xml",
      "-H", "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",
      "-w", "\n__META__%{http_code}|%{url_effective}",
      url
    ],
    {
      encoding: "utf8",
      timeout: 35000,
      windowsHide: true,
      maxBuffer: 30 * 1024 * 1024
    }
  );

  if (result.error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: "",
      bytes: 0,
      error: result.error.message
    };
  }

  const stdout = String(result.stdout || "");
  const marker = "\n__META__";
  const index = stdout.lastIndexOf(marker);

  if (index < 0) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      html: stdout,
      bytes: Buffer.byteLength(stdout, "utf8"),
      error: "META_MARKER_MISSING"
    };
  }

  const html = stdout.slice(0, index);
  const meta = stdout
    .slice(index + marker.length)
    .trim();

  const [statusRaw, finalUrl] = meta.split("|");
  const status = Number(statusRaw);

  return {
    ok:
      result.status === 0 &&
      status >= 200 &&
      status < 400,

    status,
    finalUrl,
    html,
    bytes: Buffer.byteLength(html, "utf8"),

    error:
      result.status === 0
        ? null
        : String(result.stderr || "").trim()
  };
}


function extractAnchors(html, baseUrl) {
  const items = [];

  for (
    const match
    of String(html || "").matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    )
  ) {
    const attrs = match[1] || "";

    const hrefMatch = attrs.match(
      /\bhref\s*=\s*["']([^"']+)["']/i
    );

    if (!hrefMatch) {
      continue;
    }

    const url = normalizeUrl(
      hrefMatch[1],
      baseUrl
    );

    if (!url) {
      continue;
    }

    items.push({
      label: plain(match[2]),
      url
    });
  }

  return items;
}


function normalizeDate(value) {
  const match = String(value || "").match(
    /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/
  );

  if (!match) {
    return null;
  }

  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return (
    match[1] +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}


function extractDates(html) {
  const matches =
    plain(html).match(
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g
    ) || [];

  return [
    ...new Set(
      matches
        .map(normalizeDate)
        .filter(Boolean)
    )
  ];
}


function isDetailUrl(url) {
  return (
    /mode=view/i.test(url) ||
    /articleNo=\d+/i.test(url) ||
    /artclNo=\d+/i.test(url) ||
    /artclView\.do/i.test(url)
  );
}


function extractDetailLinks(html, baseUrl) {
  return [
    ...new Map(
      extractAnchors(html, baseUrl)
        .filter(
          x =>
            officialDomain(x.url) &&
            x.label.length >= 4 &&
            isDetailUrl(x.url)
        )
        .map(
          x => [
            x.url,
            x
          ]
        )
    ).values()
  ];
}


function detectStructure(html) {
  const structures = [
    {
      type: "TR",
      count:
        (html.match(
          /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
        ) || []).length
    },
    {
      type: "LI",
      count:
        (html.match(
          /<li\b[^>]*>[\s\S]*?<\/li>/gi
        ) || []).length
    },
    {
      type: "DL",
      count:
        (html.match(
          /<dl\b[^>]*>[\s\S]*?<\/dl>/gi
        ) || []).length
    }
  ];

  return structures.sort(
    (a, b) =>
      b.count - a.count
  )[0];
}


function scoreLink(label, url) {
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

  if (
    /subview\.do/i.test(url)
  ) {
    score += 15;
    reasons.push("SUBVIEW");
  }

  if (
    isDetailUrl(url)
  ) {
    score += 10;
    reasons.push("DETAIL_HINT");
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


function evaluateCandidate(candidate) {
  const page =
    curlPage(candidate.url);

  if (
    !page.ok ||
    page.status !== 200
  ) {
    return {
      ...candidate,
      status: page.status,
      finalUrl: page.finalUrl,
      bytes: page.bytes,
      dates: 0,
      detailLinks: 0,
      distinctTitles: 0,
      structure: null,
      finalScore:
        candidate.initialScore - 50,
      pass: false,
      error: page.error
    };
  }

  const dates =
    extractDates(page.html);

  const details =
    extractDetailLinks(
      page.html,
      page.finalUrl
    );

  const distinctTitles =
    new Set(
      details.map(x => x.label)
    ).size;

  const structure =
    detectStructure(page.html);

  let score =
    candidate.initialScore;

  const reasons = [
    ...candidate.reasons,
    "HTTP_200"
  ];

  score += 20;

  if (
    officialDomain(page.finalUrl)
  ) {
    score += 20;
    reasons.push(
      "FINAL_OFFICIAL_DOMAIN"
    );
  }

  if (dates.length >= 3) {
    score += 15;
    reasons.push(
      "DATES_3_PLUS"
    );
  }

  if (dates.length >= 10) {
    score += 10;
    reasons.push(
      "DATES_10_PLUS"
    );
  }

  if (details.length >= 3) {
    score += 25;
    reasons.push(
      "DETAIL_LINKS_3_PLUS"
    );
  }

  if (details.length >= 10) {
    score += 15;
    reasons.push(
      "DETAIL_LINKS_10_PLUS"
    );
  }

  if (distinctTitles >= 5) {
    score += 15;
    reasons.push(
      "TITLE_VARIETY"
    );
  }

  if (
    structure &&
    structure.count >= 5
  ) {
    score += 10;
    reasons.push(
      `STRUCTURE:${structure.type}`
    );
  }

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
      details.length,

    distinctTitles,

    structure,

    finalScore:
      score,

    pass:
      Boolean(
        score >= 90 &&
        officialDomain(
          page.finalUrl
        ) &&
        (
          details.length >= 3 ||
          dates.length >= 5
        )
      ),

    reasons,

    sampleDetailLinks:
      details.slice(0, 5),

    error:
      null
  };
}


function main() {
  let requests = 0;

  const startResults = [];
  const candidates = [];

  for (
    const url
    of START_URLS
  ) {
    requests += 1;

    const page =
      curlPage(url);

    startResults.push({
      url,
      status: page.status,
      finalUrl: page.finalUrl,
      bytes: page.bytes,
      ok: page.ok,
      error: page.error
    });

    if (
      !page.ok ||
      page.status !== 200
    ) {
      continue;
    }

    for (
      const anchor
      of extractAnchors(
        page.html,
        page.finalUrl
      )
    ) {
      if (
        !officialDomain(anchor.url)
      ) {
        continue;
      }

      const scored =
        scoreLink(
          anchor.label,
          anchor.url
        );

      if (
        scored.score >= 20
      ) {
        candidates.push({
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
  }


  for (
    const item
    of FORCED
  ) {
    const scored =
      scoreLink(
        item.label,
        item.url
      );

    candidates.push({
      ...item,

      initialScore:
        scored.score + 30,

      reasons: [
        ...scored.reasons,
        "FORCED_OFFICIAL_SEED"
      ]
    });
  }


  const uniqueCandidates =
    [
      ...new Map(
        candidates.map(
          x => [
            x.url,
            x
          ]
        )
      ).values()
    ]
      .sort(
        (a, b) =>
          b.initialScore -
          a.initialScore
      )
      .slice(0, 30);


  const tested = [];

  for (
    const candidate
    of uniqueCandidates.slice(
      0,
      15
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
      b.finalScore -
      a.finalScore
  );


  const best =
    tested[0] || null;


  let decision =
    "NO_FLEXIBLE_SOURCE";

  let proposedSource =
    null;

  let nextAction =
    "REVIEW_MOKPO_DISCOVERY_FAILURE";


  if (
    best &&
    best.pass
  ) {
    decision =
      "FLEXIBLE_SOURCE_DISCOVERED";

    nextAction =
      "VALIDATE_MOKPO_FLEXIBLE_SOURCE";

    proposedSource = {
      id:
        "mokpo-national-general-feed",

      name:
        "\uAD6D\uB9BD\uBAA9\uD3EC\uB300\uD559\uAD50 \uACF5\uC2DD \uC18C\uC2DD",

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
        best.label,

      preferredStructure:
        best.structure?.type || null,

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
    best &&
    best.status === 200
  ) {
    decision =
      "REVIEW_CANDIDATE";

    nextAction =
      "INSPECT_MOKPO_CANDIDATE_STRUCTURE";
  }


  const report = {
    schemaVersion:
      "1.1",

    generatedAt:
      new Date().toISOString(),

    universityId:
      UNIVERSITY_ID,

    universityName:
      UNIVERSITY_NAME,

    transport: {
      type:
        "curl.exe",

      protocolPreference:
        "HTTP_CANONICAL_FOR_CURRENT_ENVIRONMENT",

      tlsVerificationDisabled:
        false,

      reason:
        "HTTPS www host fails Windows Schannel hostname validation; official HTTP www host returns 200."
    },

    startResults,

    discovered:
      uniqueCandidates.length,

    tested:
      tested.length,

    best,

    top5:
      tested.slice(0, 5),

    proposedSource,

    decision,

    nextAction,

    requests,

    safety: {
      readOnly: true,
      tlsBypass: false,
      sourceModified: false,
      storeModified: false,
      previewModified: false,
      queueModified: false,
      gitTriggered: false,
      deploymentTriggered: false
    }
  };


  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
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
          report.requests
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