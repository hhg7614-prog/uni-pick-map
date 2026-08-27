"use strict";

/**
 * UNI PICK - Kyungwoon Title Cell Inspector v1
 *
 * 목적
 * ---------------------------------------------------------
 * 경운대학교 입학 공지 목록의 실제 TR 구조를 확인한다.
 *
 * 현재 상태
 * ---------------------------------------------------------
 * rawRows = 18
 * extracted = 0
 *
 * 원인 추정
 * ---------------------------------------------------------
 * 상세 이동이 일반 href가 아니라
 * onclick / data-* / javascript 함수 호출일 가능성이 높다.
 *
 * 이번 단계
 * ---------------------------------------------------------
 * 각 TR에 대해:
 * - td index/class/text
 * - a href
 * - onclick
 * - data-* 속성
 * - 숫자 ID
 * - 날짜
 * 를 그대로 구조화해서 출력한다.
 *
 * 안전
 * ---------------------------------------------------------
 * read-only
 * curl TLS 우회 없음
 * 파일 변경 없음
 */

const { spawnSync } = require("child_process");

const LIST_URL =
  "https://www.ikw.ac.kr/ipsi/page/link.tc?mn=2415&pageSeq=1608";


function plain(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}


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
        "Mozilla/5.0 compatible UNI-PICK Kyungwoon Title Inspector",
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
        maxBuffer: 20 * 1024 * 1024
      }
    );


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

  if (
    result.error
    ||
    index < 0
  ) {
    throw new Error(
      result.error?.message
      ||
      String(result.stderr || "")
      ||
      "curl failed"
    );
  }


  const html =
    stdout.slice(
      0,
      index
    );

  const [
    status,
    finalUrl
  ] =
    stdout.slice(
      index + marker.length
    )
      .trim()
      .split("|");


  return {
    status:
      Number(status),

    finalUrl,

    html
  };
}


function extractRows(html) {
  return (
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
    || []
  );
}


function parseDate(value) {
  const text =
    plain(value);

  const match =
    text.match(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
    );

  if (!match) {
    return null;
  }

  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}


function extractAttributes(attrs) {
  const output = {};


  for (
    const match
    of String(attrs || "").matchAll(
      /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g
    )
  ) {
    output[
      match[1]
    ] =
      match[3];
  }


  return output;
}


function extractCells(raw) {
  const cells = [];


  for (
    const match
    of raw.matchAll(
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    )
  ) {
    const attrs =
      extractAttributes(
        match[1]
      );

    const body =
      match[2];


    const anchors = [];


    for (
      const anchorMatch
      of body.matchAll(
        /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
      )
    ) {
      const anchorAttrs =
        extractAttributes(
          anchorMatch[1]
        );

      anchors.push({
        text:
          plain(anchorMatch[2]),

        href:
          anchorAttrs.href || null,

        onclick:
          anchorAttrs.onclick || null,

        title:
          anchorAttrs.title || null,

        data:
          Object.fromEntries(
            Object.entries(anchorAttrs)
              .filter(
                ([key]) =>
                  key.startsWith("data-")
              )
          )
      });
    }


    const numericIds =
      [
        ...new Set(
          (
            body.match(
              /\b\d{3,}\b/g
            )
            || []
          )
        )
      ];


    cells.push({
      index:
        cells.length,

      className:
        attrs.class || null,

      id:
        attrs.id || null,

      text:
        plain(body),

      date:
        parseDate(body),

      anchors,

      numericIds,

      htmlSnippet:
        body
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1200)
    });
  }


  return cells;
}


function inspectRow(raw, index) {
  const rowAttrsMatch =
    raw.match(
      /^<tr\b([^>]*)>/i
    );

  const rowAttrs =
    extractAttributes(
      rowAttrsMatch
      ? rowAttrsMatch[1]
      : ""
    );


  return {
    rowIndex:
      index,

    rowClass:
      rowAttrs.class || null,

    rowId:
      rowAttrs.id || null,

    rowOnclick:
      rowAttrs.onclick || null,

    rowData:
      Object.fromEntries(
        Object.entries(rowAttrs)
          .filter(
            ([key]) =>
              key.startsWith("data-")
          )
      ),

    text:
      plain(raw),

    cells:
      extractCells(raw),

    rawSnippet:
      raw
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000)
  };
}


function main() {
  const page =
    curlPage(
      LIST_URL
    );


  if (
    page.status !== 200
  ) {
    throw new Error(
      `HTTP_${page.status}`
    );
  }


  const rows =
    extractRows(
      page.html
    );


  const inspected =
    rows.map(
      (raw, index) =>
        inspectRow(
          raw,
          index
        )
    );


  console.log(
    JSON.stringify(
      {
        status:
          page.status,

        finalUrl:
          page.finalUrl,

        rowCount:
          inspected.length,

        rows:
          inspected
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