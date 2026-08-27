"use strict";

const { execFileSync } = require("child_process");

const LIST_URL =
  "https://www.daeshin.ac.kr/html/05_community/01_6.php";

const UNIVERSITY_ID =
  "daeshin-university-본교";

const UNIVERSITY_NAME =
  "대신대학교";

const SOURCE_ID =
  "daeshin-general-feed";

const SOURCE_NAME =
  "대신대학교 대신뉴스";

const MAX_DETAIL_TESTS = 5;


// ============================================================
// 1. 기본 유틸
// ============================================================

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function decodeHtml(value) {
  return String(value || "")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}


function stripTags(value) {
  return normalizeWhitespace(
    decodeHtml(
      String(value || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}


function normalizeDate(value) {
  const text =
    normalizeWhitespace(value);

  const match =
    text.match(
      /\b(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\b/
    );

  if (!match) {
    return null;
  }

  const year =
    match[1];

  const month =
    String(match[2]).padStart(2, "0");

  const day =
    String(match[3]).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function absoluteUrl(href) {
  try {
    return new URL(
      href,
      LIST_URL
    ).href;
  } catch {
    return null;
  }
}


function extractBId(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed =
      new URL(url);

    return (
      parsed.searchParams.get("b_id")
      || parsed.searchParams.get("b_ID")
      || null
    );
  } catch {
    const match =
      String(url).match(
        /[?&]b_id=([^&#]+)/i
      );

    return match
      ? decodeURIComponent(match[1])
      : null;
  }
}


// ============================================================
// 2. 네트워크
//
// Node fetch가 인증서 체인 문제로 실패할 수 있으므로
// Node 우선 -> Windows curl fallback을 사용한다.
// TLS 검증은 끄지 않는다.
// ============================================================

async function nodeFetchText(url) {
  try {
    const response =
      await fetch(
        url,
        {
          redirect: "follow",
          headers: {
            "user-agent":
              "Mozilla/5.0 UNI-PICK Collector Validator",
            accept:
              "text/html,application/xhtml+xml"
          }
        }
      );

    const body =
      await response.text();

    return {
      ok:
        response.ok
        && body.length > 0,

      status:
        response.status,

      finalUrl:
        response.url || url,

      body,

      transport:
        "node-fetch",

      error:
        null
    };
  } catch (error) {
    return {
      ok:
        false,

      status:
        0,

      finalUrl:
        null,

      body:
        "",

      transport:
        "node-fetch",

      error:
        error?.message || String(error),

      causeCode:
        error?.cause?.code || null
    };
  }
}


function curlFetchText(url) {
  try {
    const output =
      execFileSync(
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
          "--user-agent",
          "Mozilla/5.0 UNI-PICK Collector Validator",
          "--write-out",
          "\n__UNI_PICK_STATUS__:%{http_code}\n__UNI_PICK_URL__:%{url_effective}",
          url
        ],
        {
          encoding:
            "utf8",

          windowsHide:
            true,

          maxBuffer:
            10 * 1024 * 1024
        }
      );

    const statusMatch =
      output.match(
        /\n__UNI_PICK_STATUS__:(\d{3})/
      );

    const urlMatch =
      output.match(
        /\n__UNI_PICK_URL__:(.+)$/
      );

    const body =
      output
        .replace(
          /\n__UNI_PICK_STATUS__:\d{3}\n__UNI_PICK_URL__:.+$/s,
          ""
        );

    const status =
      statusMatch
        ? Number(statusMatch[1])
        : 0;

    const finalUrl =
      urlMatch
        ? urlMatch[1].trim()
        : url;

    return {
      ok:
        status >= 200
        && status < 400
        && body.length > 0,

      status,

      finalUrl,

      body,

      transport:
        "curl.exe",

      error:
        null
    };
  } catch (error) {
    return {
      ok:
        false,

      status:
        0,

      finalUrl:
        null,

      body:
        "",

      transport:
        "curl.exe",

      error:
        error?.stderr
          ? String(error.stderr)
          : error?.message || String(error)
    };
  }
}


async function fetchText(url) {
  const first =
    await nodeFetchText(url);

  if (
    first.ok
    && first.body.length > 500
  ) {
    return first;
  }

  const fallback =
    curlFetchText(url);

  if (fallback.ok) {
    return fallback;
  }

  return {
    ...fallback,

    nodeError:
      first.error,

    nodeCauseCode:
      first.causeCode || null
  };
}


// ============================================================
// 3. 대신뉴스 목록 파싱
//
// 확인된 실제 구조:
//
// <tr>
//   <td class="No">977</td>
//   <td class="Title">
//     <a href="/html/05_community/01_6.php?AT=V&b_id=...">
//       제목
//     </a>
//   </td>
//   <td class="Name">학보사</td>
//   <td class="Date">2026.05.30</td>
//   <td class="Hits">155</td>
// </tr>
// ============================================================

function extractRows(html) {
  const rows =
    [];

  const rowRegex =
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while (
    (rowMatch =
      rowRegex.exec(html))
  ) {
    const rowHtml =
      rowMatch[0];

    const titleCellMatch =
      rowHtml.match(
        /<td\b[^>]*class=["'][^"']*\bTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
      );

    const dateCellMatch =
      rowHtml.match(
        /<td\b[^>]*class=["'][^"']*\bDate\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
      );

    if (
      !titleCellMatch
      || !dateCellMatch
    ) {
      continue;
    }

    const anchorMatch =
      titleCellMatch[1].match(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );

    if (!anchorMatch) {
      continue;
    }

    const href =
      decodeHtml(
        anchorMatch[1]
      );

    if (
      !/[?&]AT=V(?:&|$)/i.test(href)
      || !/[?&]b_id=/i.test(href)
    ) {
      continue;
    }

    const title =
      stripTags(
        anchorMatch[2]
      );

    const publishedAt =
      normalizeDate(
        stripTags(
          dateCellMatch[1]
        )
      );

    const detailUrl =
      absoluteUrl(href);

    const bId =
      extractBId(detailUrl);

    if (
      !title
      || !publishedAt
      || !detailUrl
      || !bId
    ) {
      continue;
    }

    rows.push({
      bId,
      title,
      publishedAt,
      detailUrl,
      detailKey:
        `B_ID:${bId}`
    });
  }

  return rows;
}


// ============================================================
// 4. 상세페이지 검증
// ============================================================

function detailContainsTitle(
  html,
  expectedTitle
) {
  const pageText =
    stripTags(html);

  const expected =
    normalizeWhitespace(
      decodeHtml(expectedTitle)
    );

  if (!expected) {
    return false;
  }

  if (
    pageText.includes(expected)
  ) {
    return true;
  }

  // 목록에서 말줄임표(...)가 붙은 경우를 위한 보조 비교
  const shortened =
    expected
      .replace(/\.{3,}$/g, "")
      .trim();

  if (
    shortened.length >= 10
    && pageText.includes(shortened)
  ) {
    return true;
  }

  return false;
}


function detailContainsDate(
  html,
  expectedDate
) {
  if (
    !html
    || !expectedDate
  ) {
    return false;
  }

  const dotted =
    expectedDate.replace(
      /-/g,
      "."
    );

  const slashed =
    expectedDate.replace(
      /-/g,
      "/"
    );

  const pageText =
    stripTags(html);

  return (
    pageText.includes(expectedDate)
    || pageText.includes(dotted)
    || pageText.includes(slashed)
  );
}


async function validateDetails(
  items
) {
  const samples =
    items.slice(
      0,
      MAX_DETAIL_TESTS
    );

  const results =
    [];

  for (
    const item
    of samples
  ) {
    const fetched =
      await fetchText(
        item.detailUrl
      );

    const titleMatch =
      fetched.ok
        ? detailContainsTitle(
            fetched.body,
            item.title
          )
        : false;

    const dateMatch =
      fetched.ok
        ? detailContainsDate(
            fetched.body,
            item.publishedAt
          )
        : false;

    const validUrl =
      fetched.status >= 200
      && fetched.status < 400;

    const pass =
      validUrl
      && titleMatch
      && dateMatch;

    results.push({
      bId:
        item.bId,

      title:
        item.title,

      publishedAt:
        item.publishedAt,

      url:
        item.detailUrl,

      status:
        fetched.status,

      finalUrl:
        fetched.finalUrl,

      transport:
        fetched.transport,

      titleMatch,

      dateMatch,

      validUrl,

      pass,

      error:
        fetched.error || null
    });
  }

  return results;
}


// ============================================================
// 5. 중복 제거
// ============================================================

function dedupeItems(items) {
  const map =
    new Map();

  let duplicateKeys =
    0;

  for (
    const item
    of items
  ) {
    if (
      map.has(item.detailKey)
    ) {
      duplicateKeys += 1;
      continue;
    }

    map.set(
      item.detailKey,
      item
    );
  }

  return {
    items:
      [...map.values()],

    duplicateKeys
  };
}


// ============================================================
// 6. 메인
// ============================================================

async function main() {
  const listResponse =
    await fetchText(
      LIST_URL
    );

  if (!listResponse.ok) {
    console.log(
      JSON.stringify(
        {
          decision:
            "COLLECTOR_REVIEW_REQUIRED",

          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          status:
            listResponse.status,

          finalUrl:
            listResponse.finalUrl,

          transport:
            listResponse.transport,

          error:
            listResponse.error,

          nextAction:
            "REVIEW_DAESHIN_NEWS_FETCH_FAILURE",

          hashSafe:
            true
        },
        null,
        2
      )
    );

    process.exitCode =
      1;

    return;
  }


  const rawTrMatches =
    listResponse.body.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || [];


  const extractedItems =
    extractRows(
      listResponse.body
    );


  const {
    items:
      uniqueItems,

    duplicateKeys
  } =
    dedupeItems(
      extractedItems
    );


  const distinctTitles =
    new Set(
      uniqueItems.map(
        item =>
          normalizeWhitespace(
            item.title
          )
      )
    ).size;


  const distinctDates =
    new Set(
      uniqueItems.map(
        item =>
          item.publishedAt
      )
    ).size;


  const detailResults =
    await validateDetails(
      uniqueItems
    );


  const detailValidation =
    {
      tested:
        detailResults.length,

      pass:
        detailResults.filter(
          item =>
            item.pass
        ).length,

      titlePass:
        detailResults.filter(
          item =>
            item.titleMatch
        ).length,

      datePass:
        detailResults.filter(
          item =>
            item.dateMatch
        ).length,

      validUrls:
        detailResults.filter(
          item =>
            item.validUrl
        ).length
    };


  const collectorReady =
    uniqueItems.length >= 5
    &&
    detailValidation.tested > 0
    &&
    detailValidation.pass
      === detailValidation.tested
    &&
    distinctTitles >= 5
    &&
    distinctDates >= 2;


  const proposedCollector =
    collectorReady
      ? {
          id:
            SOURCE_ID,

          name:
            SOURCE_NAME,

          category:
            "school_news",

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

          parser:
            {
              itemStrategy:
                "TR_WITH_TITLE_AND_DATE",

              itemSelector:
                "tr",

              titleStrategy:
                "TD_TITLE_ANCHOR",

              titleSelector:
                "td.Title a",

              dateStrategy:
                "TD_DATE",

              dateSelector:
                "td.Date",

              detailStrategy:
                "AT_V_B_ID",

              detailIdParameter:
                "b_id",

              dedupeKey:
                "B_ID"
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


  const result =
    {
      decision:
        collectorReady
          ? "COLLECTOR_READY"
          : "COLLECTOR_REVIEW_REQUIRED",

      universityId:
        UNIVERSITY_ID,

      universityName:
        UNIVERSITY_NAME,

      status:
        listResponse.status,

      finalUrl:
        listResponse.finalUrl,

      transport:
        listResponse.transport,

      rawRows:
        rawTrMatches.length,

      extracted:
        extractedItems.length,

      unique:
        uniqueItems.length,

      duplicateKeys,

      withDates:
        uniqueItems.filter(
          item =>
            Boolean(
              item.publishedAt
            )
        ).length,

      distinctTitles,

      distinctDates,

      samples:
        uniqueItems
          .slice(0, 5),

      detailValidation,

      detailSamples:
        detailResults,

      proposedCollector,

      nextAction:
        collectorReady
          ? "VERIFY_DAESHIN_ACTIVATION_READY"
          : "REVIEW_DAESHIN_COLLECTOR_FAILURES",

      requests:
        1
        + detailResults.length,

      hashSafe:
        true,

      safety:
        {
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


  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );


  if (!collectorReady) {
    process.exitCode =
      2;
  }
}


main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          decision:
            "COLLECTOR_ERROR",

          universityId:
            UNIVERSITY_ID,

          universityName:
            UNIVERSITY_NAME,

          error:
            error?.message
            || String(error),

          stack:
            error?.stack
            || null,

          hashSafe:
            true
        },
        null,
        2
      )
    );

    process.exitCode =
      1;
  }
);