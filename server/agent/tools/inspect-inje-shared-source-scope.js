"use strict";

const { execFileSync } = require("child_process");

const TARGET_URL =
  "https://scsc.inje.ac.kr/scsc/community/news.do?mode=view&articleNo=75530";

const LIST_URL_CANDIDATES = [
  "https://scsc.inje.ac.kr/scsc/community/news.do?mode=list",
  "https://scsc.inje.ac.kr/scsc/community/news.do"
];

const KEYWORDS = [
  "김해",
  "부산",
  "본교",
  "제2캠퍼스",
  "캠퍼스",
  "인제대학교",
  "의과대학",
  "해운대",
  "백병원",
  "SCSC"
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function plain(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function fetchPage(url) {
  try {
    const output = execFileSync(
      "curl.exe",
      [
        "-L",
        "--max-redirs",
        "10",
        "--connect-timeout",
        "20",
        "--max-time",
        "40",
        "--silent",
        "--show-error",
        "--compressed",
        "--user-agent",
        "Mozilla/5.0 UNI-PICK Inje Shared Source Inspector",
        "--write-out",
        "\n__STATUS__:%{http_code}\n__URL__:%{url_effective}",
        url
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      }
    );

    const statusMatch =
      output.match(/\n__STATUS__:(\d{3})/);

    const urlMatch =
      output.match(/\n__URL__:(.+)$/);

    const body =
      output.replace(
        /\n__STATUS__:\d{3}\n__URL__:.+$/s,
        ""
      );

    return {
      ok:
        Boolean(statusMatch)
        &&
        Number(statusMatch[1]) >= 200
        &&
        Number(statusMatch[1]) < 400
        &&
        body.length > 0,

      status:
        statusMatch
          ? Number(statusMatch[1])
          : 0,

      finalUrl:
        urlMatch
          ? urlMatch[1].trim()
          : url,

      bytes:
        Buffer.byteLength(
          body,
          "utf8"
        ),

      body,

      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: null,
      bytes: 0,
      body: "",
      error:
        error?.stderr
          ? String(error.stderr)
          : (
              error?.message
              || String(error)
            )
    };
  }
}

function keywordEvidence(html) {
  const text = plain(html);

  return KEYWORDS.map(
    keyword => ({
      keyword,
      found:
        text.includes(keyword),
      count:
        text.split(keyword).length - 1
    })
  ).filter(
    item =>
      item.found
  );
}

function extractAnchors(html, baseUrl) {
  const results = [];

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

    let url;

    try {
      url =
        new URL(
          decodeHtml(href),
          baseUrl
        ).href;
    } catch {
      continue;
    }

    const text =
      plain(
        match[2]
      );

    if (
      !text
      &&
      !url.includes("inje.ac.kr")
    ) {
      continue;
    }

    results.push({
      text,
      url
    });
  }

  return results;
}

function extractCampusSignals(html) {
  const text =
    plain(html);

  const signals = {
    mentionsKimhae:
      /김해/.test(text),

    mentionsBusan:
      /부산/.test(text),

    mentionsMainCampus:
      /본교/.test(text),

    mentionsSecondCampus:
      /제2캠퍼스/.test(text),

    mentionsCampus:
      /캠퍼스/.test(text),

    mentionsInjeUniversity:
      /인제대학교/.test(text),

    mentionsMedical:
      /의과대학|의대/.test(text),

    mentionsSCSC:
      /SCSC|소프트웨어중심대학/i.test(text)
  };

  return signals;
}

function inspectPage(url) {
  const page =
    fetchPage(url);

  if (!page.ok) {
    return {
      url,
      status:
        page.status,
      finalUrl:
        page.finalUrl,
      bytes:
        page.bytes,
      ok:
        false,
      error:
        page.error
    };
  }

  const anchors =
    extractAnchors(
      page.body,
      page.finalUrl
    );

  const internal =
    anchors.filter(
      item =>
        item.url.includes(
          "inje.ac.kr"
        )
    );

  const campusLinks =
    internal.filter(
      item =>
        /김해|부산|캠퍼스|본교|제2캠퍼스|인제대학교|의과대학/i.test(
          item.text
        )
    );

  return {
    url,
    status:
      page.status,

    finalUrl:
      page.finalUrl,

    bytes:
      page.bytes,

    ok:
      true,

    campusSignals:
      extractCampusSignals(
        page.body
      ),

    keywordEvidence:
      keywordEvidence(
        page.body
      ),

    anchorCount:
      anchors.length,

    internalAnchorCount:
      internal.length,

    campusLinkSamples:
      campusLinks.slice(
        0,
        30
      ),

    title:
      (
        page.body.match(
          /<title[^>]*>([\s\S]*?)<\/title>/i
        )
        || []
      )[1]
        ? plain(
            (
              page.body.match(
                /<title[^>]*>([\s\S]*?)<\/title>/i
              )
              || []
            )[1]
          )
        : null
  };
}

function determineScope(detail, listPages) {
  const combined =
    [
      detail,
      ...listPages
    ].filter(
      item =>
        item
        &&
        item.ok
    );

  const signals = {
    kimhae:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsKimhae
      ),

    busan:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsBusan
      ),

    mainCampus:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsMainCampus
      ),

    secondCampus:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsSecondCampus
      ),

    genericCampus:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsCampus
      ),

    injeUniversity:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsInjeUniversity
      ),

    scsc:
      combined.some(
        item =>
          item.campusSignals
          ?.mentionsSCSC
      )
  };

  let classification =
    "SHARED_SOURCE_REVIEW_REQUIRED";

  let reason =
    "페이지에서 캠퍼스 범위를 자동 확정할 근거가 충분하지 않습니다.";

  if (
    signals.kimhae
    &&
    signals.busan
  ) {
    classification =
      "LIKELY_SHARED_SOURCE";

    reason =
      "동일 source에서 김해와 부산 관련 단서가 모두 확인되어 인제대학교 공통 source 가능성이 높습니다.";
  } else if (
    signals.secondCampus
    &&
    !signals.mainCampus
  ) {
    classification =
      "LIKELY_SECOND_CAMPUS_SPECIFIC";

    reason =
      "제2캠퍼스 단서가 명시적으로 확인되고 본교 단서는 확인되지 않았습니다.";
  } else if (
    signals.mainCampus
    &&
    !signals.secondCampus
  ) {
    classification =
      "LIKELY_MAIN_CAMPUS_SPECIFIC";

    reason =
      "본교 단서가 명시적으로 확인되고 제2캠퍼스 단서는 확인되지 않았습니다.";
  } else if (
    signals.injeUniversity
    &&
    signals.scsc
    &&
    !signals.mainCampus
    &&
    !signals.secondCampus
  ) {
    classification =
      "LIKELY_SHARED_SOURCE";

    reason =
      "특정 캠퍼스 표기 없이 인제대학교 전체 명칭과 SCSC 조직 단서가 확인되어 공통 source 가능성이 높습니다.";
  }

  return {
    classification,
    reason,
    signals
  };
}

function main() {
  const detail =
    inspectPage(
      TARGET_URL
    );

  const listPages =
    LIST_URL_CANDIDATES.map(
      inspectPage
    );

  const scope =
    determineScope(
      detail,
      listPages
    );

  const result = {
    decision:
      "INJE_SHARED_SOURCE_SCOPE_INSPECTED",

    targetUrl:
      TARGET_URL,

    detail,

    listPages,

    scope,

    proposedPolicy:
      scope.classification
      === "LIKELY_SHARED_SOURCE"
        ? {
            campusScope:
              "SHARED_SOURCE",

            duplicateStorage:
              false,

            canonicalOwner:
              "inje-university-본교",

            visibleToCampuses: [
              "inje-university-본교",
              "inje-university-제2캠퍼"
            ],

            nextAction:
              "VERIFY_INJE_SHARED_SOURCE_COLLECTOR"
          }
        : null,

    safety: {
      readOnly:
        true,

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

      queueModified:
        false,

      gitTriggered:
        false,

      deploymentTriggered:
        false
    }
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

main();