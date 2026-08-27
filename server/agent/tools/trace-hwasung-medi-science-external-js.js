"use strict";

/**
 * UNI PICK - Hwasung Medi-Science External JS / API Tracer v1
 *
 * 이전 결과:
 * ---------------------------------------------------------
 * ROUTING_RULE_NOT_FOUND
 * inline function:
 *   fn_egov_link_page
 *
 * 판단:
 * ---------------------------------------------------------
 * fn_egov_link_page는 pagination 함수일 가능성이 높으므로
 * 게시글 상세 이동 로직이 외부 JavaScript / form / AJAX에 있는지 추적한다.
 *
 * 수행:
 * ---------------------------------------------------------
 * 1. 공지 목록 HTML 요청
 * 2. script src 전체 추출
 * 3. hsmu.ac.kr 또는 상대경로 JS만 선별
 * 4. 최대 15개 JS 파일 요청
 * 5. 다음 패턴 탐색
 *    - detail / view / read
 *    - board / bbs / notice
 *    - seq / idx / no / nttId
 *    - location.href
 *    - form.action / submit
 *    - $.ajax / $.get / $.post / fetch
 *    - .do / .ajax / .json endpoint
 * 6. 목록 HTML 자체의 form/input/select/button 구조도 재분석
 * 7. 발견된 endpoint/URL rule 점수화
 *
 * 안전:
 * ---------------------------------------------------------
 * - source 변경 없음
 * - store 변경 없음
 * - preview 변경 없음
 * - queue 변경 없음
 * - git/deploy 없음
 *
 * 실행:
 * ---------------------------------------------------------
 * D:\tools\node22\node.exe --use-system-ca
 *   .\server\agent\tools\trace-hwasung-medi-science-external-js.js
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
  "hwasung-medi-science-js-routing.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "hwasung-medi-science-external-js-trace.json"
);

const LIST_URL =
  "https://www.hsmu.ac.kr/web/contents/HSMU40101000.do";

const UNIVERSITY_ID =
  "hwasung-medi-science-university-본교";

const UNIVERSITY_NAME =
  "화성의과학대학교";

const REQUEST_TIMEOUT_MS = 20000;

const MAX_SCRIPT_REQUESTS = 15;


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
  if (
    !fs.existsSync(file)
  ) {
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

async function fetchText(url) {
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
              "Mozilla/5.0 compatible UNI-PICK HSMU External JS Tracer",

            "Accept":
              "text/html,application/javascript,text/javascript,application/json,*/*",

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
 * Script src 추출
 * ========================================================= */

function extractScriptSources(
  html,
  baseUrl
) {
  const results = [];

  for (
    const match
    of html.matchAll(
      /<script\b([^>]*)><\/script>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const src =
      (
        attrs.match(
          /\bsrc\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1];

    if (!src) {
      continue;
    }

    const url =
      normalizeUrl(
        src,
        baseUrl
      );

    if (!url) {
      continue;
    }

    results.push({
      src,
      url,

      officialDomain:
        officialDomain(
          url
        )
    });
  }

  return [
    ...new Map(
      results.map(
        item => [
          item.url,
          item
        ]
      )
    ).values()
  ];
}


/* =========================================================
 * JS relevance 점수
 * ========================================================= */

function scoreScriptUrl(url) {
  const value =
    String(url || "")
      .toLowerCase();

  let score = 0;
  const reasons = [];

  const positive = [
    ["board", 30],
    ["bbs", 30],
    ["notice", 30],
    ["contents", 15],
    ["common", 5],
    ["egov", 10],
    ["web", 5]
  ];

  for (
    const [word, points]
    of positive
  ) {
    if (
      value.includes(word)
    ) {
      score += points;

      reasons.push(
        `${word}:${points}`
      );
    }
  }

  if (
    /jquery(?:\.min)?\.js/i.test(
      value
    )
  ) {
    score -= 20;

    reasons.push(
      "jquery:-20"
    );
  }

  if (
    /swiper|slick|aos|chart|moment|bootstrap/i.test(
      value
    )
  ) {
    score -= 15;

    reasons.push(
      "vendor:-15"
    );
  }

  return {
    score,
    reasons
  };
}


/* =========================================================
 * JS 내부 endpoint 추출
 * ========================================================= */

function extractEndpoints(
  code,
  baseUrl
) {
  const results = [];

  const patterns = [
    {
      type:
        "QUOTED_PATH",

      regex:
        /["']([^"']+\.(?:do|jsp|ajax|json|php)(?:\?[^"']*)?)["']/gi,

      score:
        30
    },

    {
      type:
        "AJAX_URL",

      regex:
        /(?:url\s*:|fetch\s*\(|\.get\s*\(|\.post\s*\()\s*["']([^"']+)["']/gi,

      score:
        45
    },

    {
      type:
        "LOCATION",

      regex:
        /(?:location(?:\.href)?|window\.location(?:\.href)?)\s*=\s*["']([^"']+)["']/gi,

      score:
        50
    },

    {
      type:
        "ACTION",

      regex:
        /\.action\s*=\s*["']([^"']+)["']/gi,

      score:
        50
    }
  ];

  for (
    const config
    of patterns
  ) {
    let match;

    while (
      (
        match =
          config.regex.exec(
            code
          )
      )
    ) {
      const raw =
        match[1];

      const url =
        normalizeUrl(
          raw,
          baseUrl
        );

      if (
        !url
        ||
        !officialDomain(
          url
        )
      ) {
        continue;
      }

      let score =
        config.score;

      const joined =
        `${url} ${raw}`.toLowerCase();

      const reasons = [
        config.type
      ];

      if (
        /view|detail|read/.test(
          joined
        )
      ) {
        score += 35;
        reasons.push(
          "DETAIL_SIGNAL"
        );
      }

      if (
        /board|bbs|notice/.test(
          joined
        )
      ) {
        score += 20;
        reasons.push(
          "BOARD_SIGNAL"
        );
      }

      if (
        /(?:seq|idx|no|ntt|article|board)[^=]*=/.test(
          joined
        )
      ) {
        score += 20;
        reasons.push(
          "ID_PARAMETER_SIGNAL"
        );
      }

      results.push({
        raw,
        url,
        type:
          config.type,

        score,
        reasons
      });
    }
  }

  return [
    ...new Map(
      results.map(
        item => [
          `${item.type}|${item.url}`,
          item
        ]
      )
    ).values()
  ];
}


/* =========================================================
 * JS 내부 함수 분석
 * ========================================================= */

function extractInterestingFunctions(code) {
  const results = [];

  const functionPattern =
    /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{([\s\S]{0,10000}?)\}/gi;

  let match;

  while (
    (
      match =
        functionPattern.exec(
          code
        )
    )
  ) {
    const name =
      match[1];

    const params =
      match[2]
        .split(",")
        .map(
          value =>
            value.trim()
        )
        .filter(Boolean);

    const body =
      match[3];

    const joined =
      `${name} ${body}`
        .toLowerCase();

    let score = 0;
    const reasons = [];

    if (
      /view|detail|read/.test(
        joined
      )
    ) {
      score += 40;
      reasons.push(
        "DETAIL_FUNCTION"
      );
    }

    if (
      /board|bbs|notice/.test(
        joined
      )
    ) {
      score += 25;
      reasons.push(
        "BOARD_FUNCTION"
      );
    }

    if (
      /\.submit\s*\(/.test(
        body
      )
    ) {
      score += 20;
      reasons.push(
        "FORM_SUBMIT"
      );
    }

    if (
      /\.action\s*=/.test(
        body
      )
    ) {
      score += 20;
      reasons.push(
        "FORM_ACTION"
      );
    }

    if (
      /location(?:\.href)?\s*=/.test(
        body
      )
    ) {
      score += 25;
      reasons.push(
        "LOCATION_CHANGE"
      );
    }

    if (
      /\$\.ajax|fetch\s*\(|XMLHttpRequest|\$\.get|\$\.post/.test(
        body
      )
    ) {
      score += 25;
      reasons.push(
        "NETWORK_CALL"
      );
    }

    if (
      /\b(?:seq|idx|no|ntt|article|board)[A-Za-z_]*\b/i.test(
        body
      )
    ) {
      score += 20;
      reasons.push(
        "ID_VARIABLE"
      );
    }

    if (
      score > 0
    ) {
      results.push({
        name,
        params,

        score,
        reasons,

        body:
          body.slice(
            0,
            7000
          )
      });
    }
  }

  return results
    .sort(
      (a, b) =>
        b.score
        -
        a.score
    )
    .slice(
      0,
      50
    );
}


/* =========================================================
 * 일반 코드 신호
 * ========================================================= */

function extractCodeSignals(code) {
  const signals = {
    submitCount:
      (
        code.match(
          /\.submit\s*\(/g
        )
        || []
      ).length,

    actionAssignmentCount:
      (
        code.match(
          /\.action\s*=/g
        )
        || []
      ).length,

    locationCount:
      (
        code.match(
          /(?:window\.)?location(?:\.href)?\s*=/g
        )
        || []
      ).length,

    ajaxCount:
      (
        code.match(
          /\$\.ajax\s*\(/g
        )
        || []
      ).length,

    fetchCount:
      (
        code.match(
          /fetch\s*\(/g
        )
        || []
      ).length,

    postCount:
      (
        code.match(
          /\$\.post\s*\(/g
        )
        || []
      ).length,

    getCount:
      (
        code.match(
          /\$\.get\s*\(/g
        )
        || []
      ).length
  };

  return signals;
}


/* =========================================================
 * HTML form 심층 분석
 * ========================================================= */

function extractForms(
  html,
  baseUrl
) {
  const results = [];

  for (
    const match
    of html.matchAll(
      /<form\b([^>]*)>([\s\S]*?)<\/form>/gi
    )
  ) {
    const attrs =
      match[1] || "";

    const body =
      match[2] || "";

    const actionRaw =
      (
        attrs.match(
          /\baction\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || "";

    const id =
      (
        attrs.match(
          /\bid\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const name =
      (
        attrs.match(
          /\bname\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || null;

    const method =
      (
        attrs.match(
          /\bmethod\s*=\s*["']([^"']+)["']/i
        )
        || []
      )[1]
      || "GET";

    const fields = [];

    for (
      const input
      of body.matchAll(
        /<(?:input|select|textarea)\b([^>]*)>/gi
      )
    ) {
      const inputAttrs =
        input[1] || "";

      const fieldName =
        (
          inputAttrs.match(
            /\bname\s*=\s*["']([^"']+)["']/i
          )
          || []
        )[1];

      if (!fieldName) {
        continue;
      }

      const fieldValue =
        (
          inputAttrs.match(
            /\bvalue\s*=\s*["']([^"']*)["']/i
          )
          || []
        )[1]
        || "";

      const fieldType =
        (
          inputAttrs.match(
            /\btype\s*=\s*["']([^"']+)["']/i
          )
          || []
        )[1]
        || "";

      fields.push({
        name:
          fieldName,

        value:
          fieldValue,

        type:
          fieldType
      });
    }

    results.push({
      id,
      name,

      method:
        method.toUpperCase(),

      actionRaw,

      action:
        normalizeUrl(
          actionRaw || baseUrl,
          baseUrl
        ),

      fields
    });
  }

  return results;
}


/* =========================================================
 * onclick 원문 + 주변 HTML
 * ========================================================= */

function extractOnclickContexts(html) {
  const results = [];

  const containers = [
    {
      type: "TR",
      regex:
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    },

    {
      type: "LI",
      regex:
        /<li\b[^>]*>[\s\S]*?<\/li>/gi
    },

    {
      type: "DIV",
      regex:
        /<div\b[^>]*>[\s\S]{0,4000}?<\/div>/gi
    }
  ];

  for (
    const config
    of containers
  ) {
    const matches =
      html.match(
        config.regex
      )
      || [];

    for (
      const raw
      of matches
    ) {
      const onclicks =
        [
          ...raw.matchAll(
            /onclick\s*=\s*["']([^"']+)["']/gi
          )
        ].map(
          item =>
            item[1]
        );

      if (
        onclicks.length === 0
      ) {
        continue;
      }

      results.push({
        type:
          config.type,

        onclicks,

        text:
          plain(raw)
            .slice(
              0,
              1200
            ),

        raw:
          raw.slice(
            0,
            5000
          )
      });
    }
  }

  return results.slice(
    0,
    100
  );
}


/* =========================================================
 * 최종 후보 규칙 점수화
 * ========================================================= */

function buildRuleCandidates(
  scriptReports
) {
  const candidates = [];

  for (
    const script
    of scriptReports
  ) {
    for (
      const endpoint
      of script.endpoints || []
    ) {
      candidates.push({
        kind:
          "ENDPOINT",

        scriptUrl:
          script.url,

        url:
          endpoint.url,

        score:
          endpoint.score,

        evidence:
          endpoint.reasons
      });
    }

    for (
      const fn
      of script.interestingFunctions
      || []
    ) {
      candidates.push({
        kind:
          "FUNCTION",

        scriptUrl:
          script.url,

        functionName:
          fn.name,

        params:
          fn.params,

        score:
          fn.score,

        evidence:
          fn.reasons,

        body:
          fn.body
      });
    }
  }

  return candidates
    .sort(
      (a, b) =>
        b.score
        -
        a.score
    )
    .slice(
      0,
      50
    );
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
      !== "TRACE_EXTERNAL_SCRIPT_OR_API"
    ) {
    throw new Error(
      "HSMU_PREVIOUS_STAGE_NOT_READY"
    );
  }


  const beforeHashes =
    operationalHashes();


  let requestCount = 0;


  /*
   * 목록 페이지
   */

  requestCount += 1;

  const list =
    await fetchText(
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


  /*
   * script 목록
   */

  const scripts =
    extractScriptSources(
      list.body,
      list.finalUrl
    );


  const rankedScripts =
    scripts
      .filter(
        item =>
          item.officialDomain
      )
      .map(
        item => ({
          ...item,
          ...scoreScriptUrl(
            item.url
          )
        })
      )
      .sort(
        (a, b) =>
          b.score
          -
          a.score
      );


  const selectedScripts =
    rankedScripts.slice(
      0,
      MAX_SCRIPT_REQUESTS
    );


  const scriptReports = [];


  for (
    const script
    of selectedScripts
  ) {
    requestCount += 1;

    const page =
      await fetchText(
        script.url
      );

    if (
      !page.ok
      ||
      page.status !== 200
    ) {
      scriptReports.push({
        url:
          script.url,

        score:
          script.score,

        status:
          page.status,

        bytes:
          page.bytes,

        error:
          page.error || null,

        endpoints:
          [],

        interestingFunctions:
          [],

        signals:
          null
      });

      continue;
    }


    const endpoints =
      extractEndpoints(
        page.body,
        page.finalUrl
      );


    const interestingFunctions =
      extractInterestingFunctions(
        page.body
      );


    const signals =
      extractCodeSignals(
        page.body
      );


    scriptReports.push({
      url:
        script.url,

      score:
        script.score,

      scoreReasons:
        script.reasons,

      status:
        page.status,

      bytes:
        page.bytes,

      contentType:
        page.contentType,

      endpoints,

      interestingFunctions,

      signals
    });
  }


  /*
   * HTML 자체 재분석
   */

  const forms =
    extractForms(
      list.body,
      list.finalUrl
    );


  const onclickContexts =
    extractOnclickContexts(
      list.body
    );


  /*
   * Rule 후보
   */

  const ruleCandidates =
    buildRuleCandidates(
      scriptReports
    );


  const strongRules =
    ruleCandidates.filter(
      item =>
        item.score >= 60
    );


  let decision =
    "MANUAL_STRUCTURE_INSPECTION_REQUIRED";


  if (
    strongRules.length >= 1
  ) {
    decision =
      "ROUTING_EVIDENCE_FOUND";
  }

  else if (
    scriptReports.some(
      item =>
        (
          item.endpoints?.length
          || 0
        ) > 0
        ||
        (
          item.interestingFunctions
            ?.length
          || 0
        ) > 0
    )
  ) {
    decision =
      "PARTIAL_ROUTING_EVIDENCE";
  }


  let nextAction =
    "INSPECT_FORM_AND_ONCLICK_CONTEXT";


  if (
    decision
    === "ROUTING_EVIDENCE_FOUND"
  ) {
    nextAction =
      "VALIDATE_EXTRACTED_ROUTING_RULE";
  }

  else if (
    decision
    === "PARTIAL_ROUTING_EVIDENCE"
  ) {
    nextAction =
      "CORRELATE_JS_FUNCTION_WITH_HTML_IDS";
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
        list.bytes,

      contentType:
        list.contentType
    },

    scriptDiscovery: {
      totalScriptTags:
        scripts.length,

      officialScripts:
        rankedScripts.length,

      selectedScripts:
        selectedScripts.length,

      scripts:
        rankedScripts.slice(
          0,
          30
        )
    },

    scriptReports,

    htmlStructure: {
      formCount:
        forms.length,

      forms,

      onclickContextCount:
        onclickContexts.length,

      onclickContexts:
        onclickContexts.slice(
          0,
          50
        )
    },

    ruleCandidateCount:
      ruleCandidates.length,

    strongRuleCount:
      strongRules.length,

    ruleCandidates,

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

        scriptTags:
          report.scriptDiscovery
            .totalScriptTags,

        officialScripts:
          report.scriptDiscovery
            .officialScripts,

        requestedScripts:
          report.scriptDiscovery
            .selectedScripts,

        scriptsWithEndpoints:
          report.scriptReports.filter(
            item =>
              (
                item.endpoints
                || []
              ).length > 0
          ).length,

        scriptsWithInterestingFunctions:
          report.scriptReports.filter(
            item =>
              (
                item.interestingFunctions
                || []
              ).length > 0
          ).length,

        forms:
          report.htmlStructure
            .formCount,

        onclickContexts:
          report.htmlStructure
            .onclickContextCount,

        ruleCandidates:
          report.ruleCandidateCount,

        strongRules:
          report.strongRuleCount,

        topRules:
          report.ruleCandidates.slice(
            0,
            10
          ).map(
            item => ({
              kind:
                item.kind,

              score:
                item.score,

              script:
                item.scriptUrl,

              url:
                item.url || null,

              functionName:
                item.functionName || null,

              params:
                item.params || null,

              evidence:
                item.evidence
            })
          ),

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
  extractScriptSources,
  scoreScriptUrl,
  extractEndpoints,
  extractInterestingFunctions,
  extractCodeSignals,
  extractForms,
  extractOnclickContexts,
  buildRuleCandidates
};