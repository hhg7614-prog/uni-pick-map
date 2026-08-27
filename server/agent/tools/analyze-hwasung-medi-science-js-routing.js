"use strict";

/**
 * UNI PICK - Hwasung Medi-Science JS Routing Analyzer v1
 *
 * 목적
 * ---------------------------------------------------------
 * 화성의과학대학교 공지사항 페이지에서
 * JS onclick / form / hidden input / 숫자 ID 조합을 분석해
 * 실제 상세 페이지 URL 생성 규칙을 복원한다.
 *
 * 이 단계는 "규칙 분석"이 핵심이다.
 * 후보 규칙이 충분히 안정적일 때만 상세 URL 3~5건을 실제 요청한다.
 *
 * 안전
 * ---------------------------------------------------------
 * - source catalog 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 *
 * 실행 권장
 * ---------------------------------------------------------
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\analyze-hwasung-medi-science-js-routing.js
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

const PREVIOUS_FILE = path.join(
  DATA,
  "hwasung-medi-science-source-validation.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-js-routing.json"
);

const LIST_URL =
  "https://www.hsmu.ac.kr/web/contents/HSMU40101000.do";

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const REQUEST_TIMEOUT_MS = 20000;
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
 * Utilities
 * ========================================================= */

function read(file, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}


function atomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const tmp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(tmp, "utf8")
  );

  fs.renameSync(
    tmp,
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
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  let text =
    String(value)
      .trim()
      .replace(/&amp;/gi, "&")
      .replace(/\\&/g, "&");

  if (
    /^javascript:/i.test(text)
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
        .replace(/^www\./, "");

    return (
      host === "hsmu.ac.kr"
      ||
      host.endsWith(".hsmu.ac.kr")
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
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect: "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK HSMU JS Routing Analyzer",

            "Accept":
              "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "ko-KR,ko;q=0.9,en;q=0.8"
          }
        }
      );

    const body =
      await response.text();

    return {
      ok: true,

      status:
        response.status,

      finalUrl:
        response.url,

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

      bytes:
        Buffer.byteLength(
          body,
          "utf8"
        ),

      body
    };

  } catch (error) {
    return {
      ok: false,

      status: null,

      finalUrl: null,

      contentType: "",

      bytes: 0,

      body: "",

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
    clearTimeout(timer);
  }
}


/* =========================================================
 * 날짜
 * ========================================================= */

function parseDate(value) {
  const text =
    plain(value);

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
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}


/* =========================================================
 * onclick 함수 호출 추출
 * ========================================================= */

function extractOnclickCalls(html) {
  const calls = [];

  const matcher =
    /onclick\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (
      match =
        matcher.exec(html)
    )
  ) {
    const raw =
      match[1].trim();

    const functionMatch =
      raw.match(
        /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?$/
      );

    let functionName = null;
    let args = [];

    if (functionMatch) {
      functionName =
        functionMatch[1];

      args =
        splitArguments(
          functionMatch[2]
        );
    }

    calls.push({
      raw,

      functionName,

      args,

      numericArgs:
        args.filter(
          value =>
            /^\d+$/.test(
              String(value)
            )
        ),

      stringArgs:
        args.filter(
          value =>
            !/^\d+$/.test(
              String(value)
            )
        )
    });
  }

  return calls;
}


/* =========================================================
 * 함수 인자 분리
 * ========================================================= */

function splitArguments(value) {
  const text =
    String(value || "");

  const output = [];

  let current = "";
  let quote = null;
  let escaped = false;
  let depth = 0;

  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {
    const char =
      text[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (
      char === "\\"
    ) {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;

      if (
        char === quote
      ) {
        quote = null;
      }

      continue;
    }

    if (
      char === "\""
      ||
      char === "'"
    ) {
      quote = char;
      current += char;
      continue;
    }

    if (
      char === "("
      ||
      char === "["
      ||
      char === "{"
    ) {
      depth += 1;
      current += char;
      continue;
    }

    if (
      char === ")"
      ||
      char === "]"
      ||
      char === "}"
    ) {
      depth -= 1;
      current += char;
      continue;
    }

    if (
      char === ","
      &&
      depth === 0
    ) {
      output.push(
        cleanArgument(
          current
        )
      );

      current = "";
      continue;
    }

    current += char;
  }

  if (
    current.trim()
  ) {
    output.push(
      cleanArgument(
        current
      )
    );
  }

  return output;
}


function cleanArgument(value) {
  let text =
    String(value || "")
      .trim();

  if (
    (
      text.startsWith("\"")
      &&
      text.endsWith("\"")
    )
    ||
    (
      text.startsWith("'")
      &&
      text.endsWith("'")
    )
  ) {
    text =
      text.slice(
        1,
        -1
      );
  }

  return text;
}


/* =========================================================
 * 함수 정의 추출
 * ========================================================= */

function extractFunctionDefinitions(
  html,
  names
) {
  const scripts =
    [
      ...html.matchAll(
        /<script\b[^>]*>([\s\S]*?)<\/script>/gi
      )
    ].map(
      match =>
        match[1]
    );

  const definitions = [];

  for (
    const script
    of scripts
  ) {
    for (
      const name
      of names
    ) {
      const functionRegex =
        new RegExp(
          `function\\s+${escapeRegExp(name)}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]{0,8000}?)\\}`,
          "i"
        );

      const match =
        script.match(
          functionRegex
        );

      if (
        match
      ) {
        definitions.push({
          functionName:
            name,

          parameters:
            match[1]
              .split(",")
              .map(
                value =>
                  value.trim()
              )
              .filter(Boolean),

          body:
            match[2],

          source:
            "FUNCTION_DECLARATION"
        });

        continue;
      }


      const assignedRegex =
        new RegExp(
          `${escapeRegExp(name)}\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]{0,8000}?)\\}`,
          "i"
        );

      const assigned =
        script.match(
          assignedRegex
        );

      if (
        assigned
      ) {
        definitions.push({
          functionName:
            name,

          parameters:
            assigned[1]
              .split(",")
              .map(
                value =>
                  value.trim()
              )
              .filter(Boolean),

          body:
            assigned[2],

          source:
            "FUNCTION_ASSIGNMENT"
        });
      }
    }
  }

  return definitions;
}


function escapeRegExp(value) {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


/* =========================================================
 * Form 추출
 * ========================================================= */

function extractForms(html, baseUrl) {
  const forms = [];

  const matcher =
    /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;

  let match;

  while (
    (
      match =
        matcher.exec(html)
    )
  ) {
    const attrs =
      match[1] || "";

    const body =
      match[2] || "";

    const id =
      (
        attrs.match(
          /\bid\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1] || null;

    const name =
      (
        attrs.match(
          /\bname\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1] || null;

    const actionRaw =
      (
        attrs.match(
          /\baction\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1] || "";

    const method =
      (
        attrs.match(
          /\bmethod\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1] || "GET";

    const inputs = [];

    for (
      const input
      of body.matchAll(
        /<input\b([^>]*)>/gi
      )
    ) {
      const inputAttrs =
        input[1] || "";

      const inputName =
        (
          inputAttrs.match(
            /\bname\s*=\s*["']([^"']+)["']/i
          )
          || []
        )[1];

      if (!inputName) {
        continue;
      }

      const value =
        (
          inputAttrs.match(
            /\bvalue\s*=\s*["']([^"']*)["']/i
          )
          || []
        )[1] || "";

      const type =
        (
          inputAttrs.match(
            /\btype\s*=\s*["']([^"']+)["']/i
          )
          || []
        )[1] || "";

      inputs.push({
        name:
          inputName,

        value,

        type
      });
    }

    forms.push({
      id,

      name,

      action:
        normalizeUrl(
          actionRaw || baseUrl,
          baseUrl
        ),

      actionRaw,

      method:
        method.toUpperCase(),

      inputs
    });
  }

  return forms;
}


/* =========================================================
 * JS body에서 form 조작 패턴 찾기
 * ========================================================= */

function analyzeFunctionBody(definition) {
  const body =
    definition.body;

  const fieldAssignments = [];

  /*
   * form.field.value = arg
   */

  const directMatches =
    body.matchAll(
      /(?:document\.)?(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\.value\s*=\s*([A-Za-z_$][\w$]*|["'][^"']*["']|\d+)/g
    );

  for (
    const match
    of directMatches
  ) {
    fieldAssignments.push({
      field:
        match[1],

      expression:
        cleanArgument(
          match[2]
        ),

      method:
        "DIRECT_VALUE_ASSIGNMENT"
    });
  }


  /*
   * $('input[name=x]').val(arg)
   */

  for (
    const match
    of body.matchAll(
      /\$\(\s*["'][^"']*name\s*=\s*['"]?([^'"\]\s]+)[^"']*["']\s*\)\.val\(\s*([A-Za-z_$][\w$]*|["'][^"']*["']|\d+)\s*\)/g
    )
  ) {
    fieldAssignments.push({
      field:
        match[1],

      expression:
        cleanArgument(
          match[2]
        ),

      method:
        "JQUERY_VAL"
    });
  }


  /*
   * URL 직접 할당
   */

  const urlAssignments = [];

  for (
    const match
    of body.matchAll(
      /(?:location(?:\.href)?|window\.location(?:\.href)?)\s*=\s*([^;]+)/gi
    )
  ) {
    urlAssignments.push(
      match[1].trim()
    );
  }


  /*
   * form.action
   */

  const actionAssignments = [];

  for (
    const match
    of body.matchAll(
      /\.action\s*=\s*["']([^"']+)["']/gi
    )
  ) {
    actionAssignments.push(
      match[1]
    );
  }


  /*
   * submit()
   */

  const submits =
    /\.submit\s*\(\s*\)/i.test(
      body
    );


  return {
    fieldAssignments,

    urlAssignments,

    actionAssignments,

    submits
  };
}


/* =========================================================
 * 함수 호출 → 파라미터 매핑
 * ========================================================= */

function instantiateAssignments(
  definition,
  call,
  analysis
) {
  const parameterMap = {};

  for (
    let index = 0;
    index < definition.parameters.length;
    index += 1
  ) {
    parameterMap[
      definition.parameters[index]
    ] =
      call.args[index]
      ?? null;
  }

  const assignments =
    analysis.fieldAssignments
      .map(
        item => ({
          ...item,

          resolvedValue:
            Object.prototype.hasOwnProperty.call(
              parameterMap,
              item.expression
            )
              ? parameterMap[
                  item.expression
                ]
              : item.expression
        })
      );

  return {
    parameterMap,
    assignments
  };
}


/* =========================================================
 * Form 기반 상세 URL 생성
 * ========================================================= */

function buildFormUrl(
  form,
  instantiated,
  actionOverride = null
) {
  const action =
    normalizeUrl(
      actionOverride
      || form.action
      || LIST_URL,
      LIST_URL
    );

  if (!action) {
    return null;
  }

  try {
    const url =
      new URL(action);

    /*
     * 기존 input 유지
     */

    for (
      const input
      of form.inputs
    ) {
      if (
        input.name
        &&
        input.value !== ""
      ) {
        url.searchParams.set(
          input.name,
          input.value
        );
      }
    }

    /*
     * JS에서 덮어쓰는 값 적용
     */

    for (
      const item
      of instantiated.assignments
    ) {
      if (
        item.field
        &&
        item.resolvedValue != null
      ) {
        url.searchParams.set(
          item.field,
          item.resolvedValue
        );
      }
    }

    return url.href;

  } catch {
    return null;
  }
}


/* =========================================================
 * onclick가 붙은 element의 텍스트/날짜 추출
 * ========================================================= */

function extractCallContexts(html) {
  const contexts = [];

  /*
   * tr 단위 우선
   */

  for (
    const match
    of html.matchAll(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    )
  ) {
    const raw =
      match[0];

    if (
      !/onclick\s*=|javascript:/i.test(
        raw
      )
    ) {
      continue;
    }

    contexts.push(
      contextFromContainer(
        raw,
        "TR"
      )
    );
  }


  /*
   * li
   */

  for (
    const match
    of html.matchAll(
      /<li\b[^>]*>[\s\S]*?<\/li>/gi
    )
  ) {
    const raw =
      match[0];

    if (
      !/onclick\s*=|javascript:/i.test(
        raw
      )
    ) {
      continue;
    }

    contexts.push(
      contextFromContainer(
        raw,
        "LI"
      )
    );
  }

  return contexts;
}


function contextFromContainer(
  raw,
  type
) {
  const calls =
    extractOnclickCalls(
      raw
    );

  const text =
    plain(
      raw
    );

  const dates =
    [
      ...text.matchAll(
        /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
      )
    ].map(
      match =>
        parseDate(
          match[0]
        )
    ).filter(Boolean);

  return {
    type,

    text:
      text.slice(
        0,
        1000
      ),

    date:
      dates[0] || null,

    calls,

    raw:
      raw.slice(
        0,
        5000
      )
  };
}


/* =========================================================
 * Routing 후보 생성
 * ========================================================= */

function buildRoutingCandidates({
  calls,
  definitions,
  forms
}) {
  const definitionsByName =
    new Map(
      definitions.map(
        item => [
          item.functionName,
          item
        ]
      )
    );

  const candidates = [];

  for (
    const call
    of calls
  ) {
    if (
      !call.functionName
    ) {
      continue;
    }

    const definition =
      definitionsByName.get(
        call.functionName
      );

    if (!definition) {
      continue;
    }

    const analysis =
      analyzeFunctionBody(
        definition
      );

    const instantiated =
      instantiateAssignments(
        definition,
        call,
        analysis
      );


    /*
     * form submit 유형
     */

    if (
      analysis.submits
      &&
      forms.length > 0
    ) {
      for (
        const form
        of forms
      ) {
        const overrides =
          analysis.actionAssignments.length
            ? analysis.actionAssignments
            : [null];

        for (
          const action
          of overrides
        ) {
          const url =
            buildFormUrl(
              form,
              instantiated,
              action
            );

          if (
            url
            &&
            officialDomain(
              url
            )
          ) {
            candidates.push({
              functionName:
                call.functionName,

              args:
                call.args,

              parameterMap:
                instantiated.parameterMap,

              assignments:
                instantiated.assignments,

              formId:
                form.id,

              formName:
                form.name,

              formMethod:
                form.method,

              url,

              generationMethod:
                "FORM_SUBMIT",

              confidence:
                90
            });
          }
        }
      }
    }


    /*
     * location.href 직접 생성
     */

    for (
      const expression
      of analysis.urlAssignments
    ) {
      const resolved =
        evaluateSimpleJsStringExpression(
          expression,
          instantiated.parameterMap
        );

      const url =
        normalizeUrl(
          resolved,
          LIST_URL
        );

      if (
        url
        &&
        officialDomain(
          url
        )
      ) {
        candidates.push({
          functionName:
            call.functionName,

          args:
            call.args,

          parameterMap:
            instantiated.parameterMap,

          assignments:
            instantiated.assignments,

          url,

          generationMethod:
            "LOCATION_ASSIGNMENT",

          confidence:
            95
        });
      }
    }
  }


  /*
   * URL별 최고 confidence만
   */

  const map =
    new Map();

  for (
    const item
    of candidates
  ) {
    const current =
      map.get(
        item.url
      );

    if (
      !current
      ||
      item.confidence
      >
      current.confidence
    ) {
      map.set(
        item.url,
        item
      );
    }
  }

  return [
    ...map.values()
  ].sort(
    (a, b) =>
      b.confidence
      -
      a.confidence
  );
}


/* =========================================================
 * 간단한 JS 문자열 결합 평가
 * ========================================================= */

function evaluateSimpleJsStringExpression(
  expression,
  parameterMap
) {
  const parts =
    String(expression || "")
      .split("+")
      .map(
        value =>
          value.trim()
      )
      .filter(Boolean);

  let output = "";

  for (
    const part
    of parts
  ) {
    if (
      (
        part.startsWith("\"")
        &&
        part.endsWith("\"")
      )
      ||
      (
        part.startsWith("'")
        &&
        part.endsWith("'")
      )
    ) {
      output +=
        part.slice(
          1,
          -1
        );

      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        parameterMap,
        part
      )
    ) {
      output +=
        parameterMap[
          part
        ]
        ?? "";

      continue;
    }

    /*
     * 너무 복잡하면 실패
     */

    return null;
  }

  return output || null;
}


/* =========================================================
 * 상세 페이지 검증
 * ========================================================= */

function extractTitleCandidates(html) {
  const patterns = [
    [
      "OG_TITLE",
      /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i
    ],

    [
      "H1",
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
    ],

    [
      "H2",
      /<h2\b[^>]*>([\s\S]*?)<\/h2>/i
    ],

    [
      "H3",
      /<h3\b[^>]*>([\s\S]*?)<\/h3>/i
    ],

    [
      "TITLE",
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    ]
  ];

  const output = [];

  for (
    const [method, regex]
    of patterns
  ) {
    const match =
      html.match(
        regex
      );

    if (
      match
      &&
      plain(
        match[1]
      )
    ) {
      output.push({
        method,

        title:
          plain(
            match[1]
          )
      });
    }
  }

  return output;
}


function extractDates(html) {
  const text =
    plain(
      html
    );

  const results = [];

  for (
    const match
    of text.matchAll(
      /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g
    )
  ) {
    const publishedAt =
      parseDate(
        match[0]
      );

    if (
      publishedAt
      &&
      !results.includes(
        publishedAt
      )
    ) {
      results.push(
        publishedAt
      );
    }
  }

  return results.slice(
    0,
    20
  );
}


async function validateRoutingCandidate(
  candidate
) {
  const page =
    await fetchPage(
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

      decision:
        "FAIL",

      reasons: [
        "UNREACHABLE"
      ],

      error:
        page.error || null
    };
  }

  const reasons = [];

  const official =
    officialDomain(
      page.finalUrl
    );

  if (!official) {
    reasons.push(
      "NON_OFFICIAL_DOMAIN"
    );
  }

  const sameAsList =
    normalizeUrl(
      page.finalUrl
    )
    ===
    normalizeUrl(
      LIST_URL
    );

  if (sameAsList) {
    reasons.push(
      "SAME_AS_LIST"
    );
  }

  const titles =
    extractTitleCandidates(
      page.body
    );

  const dates =
    extractDates(
      page.body
    );

  const bodyLength =
    plain(
      page.body
    ).length;

  if (
    titles.length === 0
  ) {
    reasons.push(
      "TITLE_NOT_FOUND"
    );
  }

  if (
    dates.length === 0
  ) {
    reasons.push(
      "DATE_NOT_FOUND"
    );
  }

  if (
    bodyLength < 100
  ) {
    reasons.push(
      "BODY_TOO_SHORT"
    );
  }

  let decision = "PASS";

  if (
    reasons.length > 0
  ) {
    decision =
      official
      &&
      titles.length > 0
        ? "WARN"
        : "FAIL";
  }

  return {
    ...candidate,

    status:
      page.status,

    finalUrl:
      page.finalUrl,

    officialDomain:
      official,

    sameAsList,

    title:
      titles[0]?.title
      || null,

    titleMethod:
      titles[0]?.method
      || null,

    dates,

    bodyLength,

    decision,

    reasons
  };
}


/* =========================================================
 * Routing 안정성
 * ========================================================= */

function analyzeRoutingStability(
  validated
) {
  const useful =
    validated.filter(
      item =>
        item.decision
        !== "FAIL"
    );

  const methodCounts = {};

  for (
    const item
    of useful
  ) {
    methodCounts[
      item.generationMethod
    ] =
      (
        methodCounts[
          item.generationMethod
        ]
        || 0
      )
      + 1;
  }

  const topMethod =
    Object.entries(
      methodCounts
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]
      || null;

  const functionCounts = {};

  for (
    const item
    of useful
  ) {
    functionCounts[
      item.functionName
    ] =
      (
        functionCounts[
          item.functionName
        ]
        || 0
      )
      + 1;
  }

  const topFunction =
    Object.entries(
      functionCounts
    )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]
      || null;

  return {
    stable:
      useful.length >= 3
      &&
      topMethod
      &&
      topMethod[1] >= 3,

    usefulCount:
      useful.length,

    topMethod:
      topMethod
        ? {
            method:
              topMethod[0],

            count:
              topMethod[1]
          }
        : null,

    topFunction:
      topFunction
        ? {
            functionName:
              topFunction[0],

            count:
              topFunction[1]
          }
        : null,

    methodCounts,

    functionCounts
  };
}


/* =========================================================
 * Main
 * ========================================================= */

async function main() {
  const previous =
    read(
      PREVIOUS_FILE,
      {}
    );

  if (
    previous.nextAction
      !== "ANALYZE_JS_API_STRUCTURE"
  ) {
    throw new Error(
      "HSMU_PREVIOUS_STAGE_NOT_READY"
    );
  }

  const beforeHashes =
    operationalHashes();

  let requestCount = 0;

  requestCount += 1;

  const list =
    await fetchPage(
      LIST_URL
    );

  if (
    !list.ok
    ||
    list.status !== 200
  ) {
    throw new Error(
      "HSMU_LIST_UNREACHABLE"
    );
  }

  const calls =
    extractOnclickCalls(
      list.body
    );

  const functionNames =
    [
      ...new Set(
        calls
          .map(
            item =>
              item.functionName
          )
          .filter(Boolean)
      )
    ];

  const definitions =
    extractFunctionDefinitions(
      list.body,
      functionNames
    );

  const forms =
    extractForms(
      list.body,
      list.finalUrl
    );

  const callContexts =
    extractCallContexts(
      list.body
    );

  const routingCandidates =
    buildRoutingCandidates({
      calls,
      definitions,
      forms
    });

  /*
   * 안정된 URL 후보만 최대 5건 테스트
   */

  const testTargets =
    routingCandidates
      .filter(
        item =>
          item.confidence >= 80
      )
      .slice(
        0,
        MAX_DETAIL_TESTS
      );

  const validated = [];

  for (
    const item
    of testTargets
  ) {
    requestCount += 1;

    validated.push(
      await validateRoutingCandidate(
        item
      )
    );
  }

  const pass =
    validated.filter(
      item =>
        item.decision === "PASS"
    ).length;

  const warn =
    validated.filter(
      item =>
        item.decision === "WARN"
    ).length;

  const fail =
    validated.filter(
      item =>
        item.decision === "FAIL"
    ).length;

  const stability =
    analyzeRoutingStability(
      validated
    );

  let decision =
    "ROUTING_RULE_NOT_FOUND";

  if (
    pass >= 3
    &&
    stability.stable
  ) {
    decision =
      "ROUTING_RULE_VALIDATED";
  }

  else if (
    pass + warn >= 2
  ) {
    decision =
      "ROUTING_REVIEW_REQUIRED";
  }

  else if (
    definitions.length === 0
    &&
    calls.length > 0
  ) {
    decision =
      "EXTERNAL_SCRIPT_ANALYSIS_REQUIRED";
  }

  let nextAction =
    "TRACE_EXTERNAL_SCRIPT_OR_API";

  if (
    decision
    === "ROUTING_RULE_VALIDATED"
  ) {
    nextAction =
      "BUILD_HSMU_COLLECTOR";
  }

  else if (
    decision
    === "ROUTING_REVIEW_REQUIRED"
  ) {
    nextAction =
      "REFINE_ROUTING_RULE";
  }

  else if (
    decision
    === "EXTERNAL_SCRIPT_ANALYSIS_REQUIRED"
  ) {
    nextAction =
      "FETCH_REFERENCED_JS_FILES";
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

    listUrl:
      LIST_URL,

    list: {
      status:
        list.status,

      finalUrl:
        list.finalUrl,

      bytes:
        list.bytes
    },

    onclickAnalysis: {
      callCount:
        calls.length,

      functionNames,

      calls:
        calls.slice(
          0,
          50
        )
    },

    functionAnalysis: {
      definitionCount:
        definitions.length,

      definitions:
        definitions.map(
          item => ({
            functionName:
              item.functionName,

            parameters:
              item.parameters,

            source:
              item.source,

            body:
              item.body.slice(
                0,
                5000
              ),

            analysis:
              analyzeFunctionBody(
                item
              )
          })
        )
    },

    formAnalysis: {
      formCount:
        forms.length,

      forms
    },

    callContextCount:
      callContexts.length,

    callContexts:
      callContexts.slice(
        0,
        30
      ),

    routingCandidateCount:
      routingCandidates.length,

    routingCandidates:
      routingCandidates.slice(
        0,
        30
      ),

    tested:
      validated.length,

    pass,

    warn,

    fail,

    validated,

    routingStable:
      stability.stable,

    stability,

    decision,

    nextAction,

    requestCount,

    operationalHashUnchanged:
      hashSafe,

    beforeHashes,

    afterHashes,

    safety: {
      readOnly: true,

      sourceModified: false,

      storeModified: false,

      previewModified: false,

      queueModified: false,

      gitTriggered: false,

      deploymentTriggered: false,

      tlsVerificationDisabled: false
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

        status:
          report.list.status,

        calls:
          report.onclickAnalysis
            .callCount,

        functions:
          report.onclickAnalysis
            .functionNames,

        definitions:
          report.functionAnalysis
            .definitionCount,

        forms:
          report.formAnalysis
            .formCount,

        routingCandidates:
          report.routingCandidateCount,

        tested:
          report.tested,

        pass:
          report.pass,

        warn:
          report.warn,

        fail:
          report.fail,

        routingStable:
          report.routingStable,

        stability:
          report.stability,

        nextAction:
          report.nextAction,

        requests:
          report.requestCount,

        hashSafe:
          report.operationalHashUnchanged
      },
      null,
      2
    )
  );
}


/* =========================================================
 * Execute
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

      process.exitCode = 1;
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
  splitArguments,
  cleanArgument,
  extractOnclickCalls,
  extractFunctionDefinitions,
  extractForms,
  analyzeFunctionBody,
  instantiateAssignments,
  buildFormUrl,
  extractCallContexts,
  buildRoutingCandidates,
  evaluateSimpleJsStringExpression,
  extractTitleCandidates,
  extractDates,
  validateRoutingCandidate,
  analyzeRoutingStability
};