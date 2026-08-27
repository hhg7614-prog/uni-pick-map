"use strict";

const { execFileSync } = require("child_process");
const { URL } = require("url");

const UNIVERSITY_ID = "daeshin-university-본교";
const UNIVERSITY_NAME = "대신대학교";

const START_URLS = [
  "https://www.daeshin.ac.kr/",
  "https://daeshin.ac.kr/"
];

const KEYWORDS = [
  "공지",
  "공지사항",
  "학사",
  "학사공지",
  "대학소식",
  "뉴스",
  "소식",
  "행사",
  "입학",
  "모집",
  "장학",
  "취업",
  "학생",
  "교육",
  "프로그램",
  "게시판"
];

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeUrl(base, href) {
  try {
    const raw = decodeHtml(href).trim();

    if (!raw) {
      return null;
    }

    if (
      raw.startsWith("javascript:")
      || raw.startsWith("#")
      || raw.startsWith("mailto:")
      || raw.startsWith("tel:")
    ) {
      return null;
    }

    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function isOfficialUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return (
      host === "daeshin.ac.kr"
      || host === "www.daeshin.ac.kr"
      || host.endsWith(".daeshin.ac.kr")
    );
  } catch {
    return false;
  }
}

function extractDates(text) {
  const values = [];
  const source = String(text || "");

  const regexes = [
    /\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/g,
    /\b(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일\b/g
  ];

  for (const regex of regexes) {
    let match;

    while ((match = regex.exec(source))) {
      const y = match[1];
      const m = String(match[2]).padStart(2, "0");
      const d = String(match[3]).padStart(2, "0");

      values.push(`${y}-${m}-${d}`);
    }
  }

  return [...new Set(values)];
}

function extractAnchors(html, baseUrl) {
  const anchors = [];

  const regex =
    /<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html))) {
    const href = match[2];
    const text = cleanText(match[4]);
    const url = normalizeUrl(baseUrl, href);

    if (!url) {
      continue;
    }

    anchors.push({
      text,
      href,
      url
    });
  }

  return anchors;
}

function scoreCandidate(candidate) {
  let score = 0;
  const reasons = [];

  const label =
    `${candidate.text || ""} ${candidate.url || ""}`.toLowerCase();

  for (const keyword of KEYWORDS) {
    if (label.includes(keyword.toLowerCase())) {
      let weight = 12;

      if (
        keyword === "공지"
        || keyword === "공지사항"
        || keyword === "학사공지"
      ) {
        weight = 35;
      } else if (
        keyword === "학사"
        || keyword === "대학소식"
        || keyword === "뉴스"
      ) {
        weight = 25;
      } else if (
        keyword === "입학"
        || keyword === "모집"
      ) {
        weight = 18;
      }

      score += weight;
      reasons.push(`${keyword}:${weight}`);
    }
  }

  if (isOfficialUrl(candidate.url)) {
    score += 20;
    reasons.push("OFFICIAL_DOMAIN");
  }

  if (
    /board|bbs|notice|news|community|subview|article|post|view/i
      .test(candidate.url)
  ) {
    score += 18;
    reasons.push("BOARD_URL");
  }

  if (
    candidate.text
    && candidate.text.length >= 4
  ) {
    score += 5;
  }

  return {
    score,
    reasons
  };
}

function fetchWithCurl(url) {
  try {
    const stdout = execFileSync(
      "curl.exe",
      [
        "-L",
        "--max-redirs",
        "10",
        "--connect-timeout",
        "20",
        "--max-time",
        "30",
        "--silent",
        "--show-error",
        "--write-out",
        "\n__UNI_PICK_META__%{http_code}|%{url_effective}",
        url
      ],
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      }
    );

    const marker = "\n__UNI_PICK_META__";
    const index = stdout.lastIndexOf(marker);

    if (index < 0) {
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        html: "",
        bytes: 0,
        error: "CURL_METADATA_NOT_FOUND"
      };
    }

    const html = stdout.slice(0, index);
    const meta = stdout.slice(index + marker.length).trim();

    const [statusRaw, finalUrlRaw] = meta.split("|");

    const status = Number(statusRaw || 0);
    const finalUrl = finalUrlRaw || url;

    return {
      ok: status >= 200 && status < 400,
      status,
      finalUrl,
      html,
      bytes: Buffer.byteLength(html, "utf8"),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      bytes: 0,
      error:
        String(
          error.stderr
          || error.message
          || error
        ).trim()
    };
  }
}

async function fetchWithNode(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 UNI-PICK source discovery"
      }
    });

    const html = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      html,
      bytes: Buffer.byteLength(html, "utf8"),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      bytes: 0,
      error: error?.message || String(error),
      causeCode:
        error?.cause?.code || null,
      causeMessage:
        error?.cause?.message || null
    };
  }
}

function analyzeStructure(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl);

  const dateCount =
    extractDates(cleanText(html)).length;

  const detailLinks =
    anchors.filter(
      item =>
        /view|detail|article|post|board|bbs/i.test(item.url)
    );

  const titleCandidates =
    anchors
      .map(item => item.text)
      .filter(text => text && text.length >= 6);

  const distinctTitles =
    new Set(titleCandidates).size;

  const rows =
    (html.match(/<tr\b/gi) || []).length;

  const listItems =
    (html.match(/<li\b/gi) || []).length;

  const divs =
    (html.match(/<div\b/gi) || []).length;

  let structureType = null;
  let structureCount = 0;

  if (rows >= listItems && rows >= 3) {
    structureType = "TR";
    structureCount = rows;
  } else if (listItems >= 3) {
    structureType = "LI";
    structureCount = listItems;
  } else if (divs >= 3) {
    structureType = "DIV";
    structureCount = divs;
  }

  return {
    anchors: anchors.length,
    dates: dateCount,
    detailLinks: detailLinks.length,
    distinctTitles,
    structure: structureType
      ? {
          type: structureType,
          count: structureCount
        }
      : null
  };
}

function scoreFetchedCandidate(candidate, fetched) {
  let score = candidate.initialScore;
  const reasons = [...candidate.reasons];

  if (fetched.status === 200) {
    score += 20;
    reasons.push("HTTP_200");
  }

  if (isOfficialUrl(fetched.finalUrl)) {
    score += 20;
    reasons.push("OFFICIAL_FINAL_URL");
  }

  const analysis =
    analyzeStructure(
      fetched.html,
      fetched.finalUrl
    );

  if (analysis.dates >= 3) {
    score += 15;
    reasons.push("DATES_3_PLUS");
  }

  if (analysis.dates >= 10) {
    score += 10;
    reasons.push("DATES_10_PLUS");
  }

  if (analysis.detailLinks >= 3) {
    score += 20;
    reasons.push("DETAIL_LINKS_3_PLUS");
  }

  if (analysis.distinctTitles >= 5) {
    score += 15;
    reasons.push("TITLE_VARIETY");
  }

  if (analysis.structure?.count >= 5) {
    score += 15;
    reasons.push("REPEATING_STRUCTURE");
  }

  if (fetched.bytes < 1000) {
    score -= 30;
    reasons.push("VERY_SMALL_RESPONSE");
  }

  const text = cleanText(fetched.html);

  if (
    /웹방화벽|차단되었습니다|접근이 차단|보안정책/i
      .test(text)
  ) {
    score -= 100;
    reasons.push("WAF_OR_BLOCK_PAGE");
  }

  return {
    ...candidate,
    status: fetched.status,
    finalUrl: fetched.finalUrl,
    bytes: fetched.bytes,
    error: fetched.error,
    analysis,
    finalScore: score,
    reasons
  };
}

async function main() {
  const startResults = [];

  let seedHtml = "";
  let seedUrl = null;

  for (const url of START_URLS) {
    const nodeResult =
      await fetchWithNode(url);

    let chosen = nodeResult;
    let transport = "node-fetch";

    if (!nodeResult.ok) {
      const curlResult =
        fetchWithCurl(url);

      if (
        curlResult.ok
        || curlResult.bytes > nodeResult.bytes
      ) {
        chosen = curlResult;
        transport = "curl.exe";
      }
    }

    startResults.push({
      url,
      transport,
      status: chosen.status,
      finalUrl: chosen.finalUrl,
      bytes: chosen.bytes,
      ok: chosen.ok,
      error: chosen.error || null,
      causeCode: nodeResult.causeCode || null
    });

    if (
      chosen.ok
      &&
      chosen.bytes > seedHtml.length
    ) {
      seedHtml = chosen.html;
      seedUrl = chosen.finalUrl;
    }
  }

  if (!seedHtml || !seedUrl) {
    console.log(
      JSON.stringify(
        {
          decision:
            "NO_FLEXIBLE_SOURCE",

          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          startResults,

          discovered: 0,
          tested: 0,
          best: null,
          top5: [],
          proposedSource: null,

          nextAction:
            "REVIEW_DAESHIN_DISCOVERY_FAILURE",

          hashSafe: true
        },
        null,
        2
      )
    );

    return;
  }

  const anchors =
    extractAnchors(
      seedHtml,
      seedUrl
    );

  const candidateMap =
    new Map();

  for (const anchor of anchors) {
    if (!isOfficialUrl(anchor.url)) {
      continue;
    }

    const scoring =
      scoreCandidate(anchor);

    if (scoring.score < 15) {
      continue;
    }

    if (
      !candidateMap.has(anchor.url)
      ||
      candidateMap.get(anchor.url).initialScore
        < scoring.score
    ) {
      candidateMap.set(
        anchor.url,
        {
          label:
            anchor.text || "(no label)",

          url:
            anchor.url,

          initialScore:
            scoring.score,

          reasons:
            scoring.reasons
        }
      );
    }
  }

  const candidates =
    [...candidateMap.values()]
      .sort(
        (a, b) =>
          b.initialScore - a.initialScore
      )
      .slice(0, 20);

  const tested = [];

  for (const candidate of candidates) {
    let fetched =
      await fetchWithNode(
        candidate.url
      );

    if (!fetched.ok) {
      const curlResult =
        fetchWithCurl(
          candidate.url
        );

      if (
        curlResult.ok
        || curlResult.bytes > fetched.bytes
      ) {
        fetched = curlResult;
      }
    }

    tested.push(
      scoreFetchedCandidate(
        candidate,
        fetched
      )
    );
  }

  tested.sort(
    (a, b) =>
      b.finalScore - a.finalScore
  );

  const best =
    tested[0] || null;

  let decision =
    "NO_FLEXIBLE_SOURCE";

  let proposedSource =
    null;

  let nextAction =
    "REVIEW_DAESHIN_DISCOVERY_FAILURE";

  if (
    best
    &&
    best.status === 200
    &&
    best.finalScore >= 120
    &&
    best.analysis.detailLinks >= 3
    &&
    best.analysis.distinctTitles >= 3
  ) {
    decision =
      "FLEXIBLE_SOURCE_DISCOVERED";

    proposedSource = {
      id:
        "daeshin-general-feed",

      name:
        `대신대학교 ${best.label || "공식 소식"}`,

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

      preferredStructure:
        best.analysis.structure?.type
        || null,

      verified:
        false,

      enabled:
        false,

      status:
        "candidate_pending_validation",

      autoActivate:
        false
    };

    nextAction =
      "VALIDATE_DAESHIN_FLEXIBLE_SOURCE";
  } else if (
    best
    &&
    best.status === 200
    &&
    best.finalScore >= 70
  ) {
    decision =
      "REVIEW_CANDIDATE";

    proposedSource = {
      id:
        "daeshin-general-feed",

      name:
        `대신대학교 ${best.label || "공식 소식"}`,

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

      preferredStructure:
        best.analysis.structure?.type
        || null,

      verified:
        false,

      enabled:
        false,

      status:
        "candidate_pending_validation",

      autoActivate:
        false
    };

    nextAction =
      "INSPECT_DAESHIN_CANDIDATE_STRUCTURE";
  }

  console.log(
    JSON.stringify(
      {
        decision,

        universityId:
          UNIVERSITY_ID,

        universityName:
          UNIVERSITY_NAME,

        transportPolicy: {
          nodeFetchFirst:
            true,

          windowsCurlFallback:
            true,

          tlsVerificationDisabled:
            false
        },

        startResults,

        homepageStatus:
          startResults.find(
            item => item.ok
          )?.status || null,

        homepageFinalUrl:
          seedUrl,

        homepageBytes:
          Buffer.byteLength(
            seedHtml,
            "utf8"
          ),

        homepageAnchors:
          anchors.length,

        discovered:
          candidates.length,

        tested:
          tested.length,

        best,

        top5:
          tested.slice(0, 5),

        proposedSource,

        nextAction,

        requests:
          START_URLS.length
          + tested.length,

        hashSafe:
          true
      },
      null,
      2
    )
  );
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          decision:
            "DISCOVERY_ERROR",

          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          error:
            error?.message
            || String(error),

          hashSafe:
            true
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
);