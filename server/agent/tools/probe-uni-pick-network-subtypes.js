"use strict";

/**
 * UNI PICK Network Subtype Probe v1
 *
 * Safe Pilot에서 계속 NETWORK 실패한 대학의 URL만 다시 확인해
 * 저수준 Node fetch error cause를 기록한다.
 *
 * 읽기 전용:
 * - source 수정 없음
 * - store 수정 없음
 * - preview 수정 없음
 * - queue 수정 없음
 * - git/deploy 없음
 */

const fs = require("fs");
const path = require("path");


const ROOT = path.resolve(
  __dirname,
  "../../.."
);

const DATA_DIR = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const PILOT_FILE = path.join(
  DATA_DIR,
  "uni-pick-safe-pilot-result.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "uni-pick-network-subtypes.json"
);


// =========================================================
// 1. Utility
// =========================================================

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}


function atomicWriteJson(
  file,
  value
) {
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


// =========================================================
// 2. Network subtype classification
// =========================================================

function classifyDiagnostic(
  diagnostic
) {
  if (
    diagnostic.ok
    === true
  ) {
    return {
      subtype:
        "HTTP_REACHABLE",

      nextClass:
        "DISCOVERY_DIAGNOSIS",

      autoRetry:
        false
    };
  }

  const code =
    String(
      diagnostic.causeCode
      ||
      diagnostic.code
      ||
      ""
    ).toUpperCase();

  const message =
    [
      diagnostic.message,
      diagnostic.causeMessage
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();


  if (
    message.includes(
      "redirect count exceeded"
    )
    ||
    message.includes(
      "too many redirects"
    )
  ) {
    return {
      subtype:
        "REDIRECT_LOOP",

      nextClass:
        "CANONICAL_URL_RECHECK",

      autoRetry:
        false
    };
  }


  if (
    code
      ===
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    ||
    message.includes(
      "unable to verify the first certificate"
    )
  ) {
    return {
      subtype:
        "TLS_CHAIN_ERROR",

      nextClass:
        "TLS_ENVIRONMENT_REVIEW",

      autoRetry:
        false
    };
  }


  if (
    code
      ===
      "ERR_TLS_CERT_ALTNAME_INVALID"
    ||
    message.includes(
      "does not match certificate"
    )
  ) {
    return {
      subtype:
        "TLS_HOSTNAME_MISMATCH",

      nextClass:
        "CANONICAL_URL_RECHECK",

      autoRetry:
        false
    };
  }


  if (
    code
      ===
      "CERT_HAS_EXPIRED"
  ) {
    return {
      subtype:
        "CERT_EXPIRED",

      nextClass:
        "HUMAN_REVIEW",

      autoRetry:
        false
    };
  }


  if (
    code
      ===
      "ENOTFOUND"
  ) {
    return {
      subtype:
        "DNS_ERROR",

      nextClass:
        "CANONICAL_URL_RECHECK",

      autoRetry:
        false
    };
  }


  if (
    code
      ===
      "ECONNRESET"
  ) {
    return {
      subtype:
        "ECONNRESET",

      nextClass:
        "RETRY_LATER",

      autoRetry:
        true
    };
  }


  if (
    code
      ===
      "ECONNREFUSED"
  ) {
    return {
      subtype:
        "ECONNREFUSED",

      nextClass:
        "RETRY_LATER",

      autoRetry:
        true
    };
  }


  if (
    code
      ===
      "ETIMEDOUT"
    ||
    diagnostic.name
      ===
      "AbortError"
  ) {
    return {
      subtype:
        "TIMEOUT",

      nextClass:
        "RETRY_LATER",

      autoRetry:
        true
    };
  }


  return {
    subtype:
      "UNKNOWN_NETWORK",

    nextClass:
      "DIAGNOSE_FIRST",

    autoRetry:
      false
  };
}


// =========================================================
// 3. Low-level fetch probe
// =========================================================

async function probe(
  item
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      10000
    );

  try {
    const response =
      await fetch(
        item.officialUrl,
        {
          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 compatible UNI-PICK low-level network diagnostics",

            Accept:
              "text/html,application/xhtml+xml"
          }
        }
      );

    const diagnostic = {
      universityId:
        item.universityId,

      universityName:
        item.universityName,

      url:
        item.officialUrl,

      ok:
        true,

      status:
        response.status,

      finalUrl:
        response.url,

      redirected:
        response.redirected,

      name:
        null,

      message:
        null,

      code:
        null,

      causeCode:
        null,

      causeMessage:
        null
    };

    return {
      ...diagnostic,
      ...classifyDiagnostic(
        diagnostic
      )
    };

  } catch (error) {
    const diagnostic = {
      universityId:
        item.universityId,

      universityName:
        item.universityName,

      url:
        item.officialUrl,

      ok:
        false,

      status:
        null,

      finalUrl:
        null,

      redirected:
        null,

      name:
        error?.name
        || null,

      message:
        error?.message
        || null,

      code:
        error?.code
        || null,

      causeCode:
        error?.cause?.code
        || null,

      causeMessage:
        error?.cause?.message
        || null
    };

    return {
      ...diagnostic,
      ...classifyDiagnostic(
        diagnostic
      )
    };

  } finally {
    clearTimeout(
      timeout
    );
  }
}


// =========================================================
// 4. Group
// =========================================================

function buildGroups(
  items
) {
  const groups = {};

  for (
    const item
    of items
  ) {
    if (
      !groups[
        item.subtype
      ]
    ) {
      groups[
        item.subtype
      ] = {
        subtype:
          item.subtype,

        nextClass:
          item.nextClass,

        autoRetry:
          item.autoRetry,

        count:
          0,

        universityIds:
          []
      };
    }

    groups[
      item.subtype
    ].count += 1;

    groups[
      item.subtype
    ].universityIds.push(
      item.universityId
    );
  }

  return Object.values(
    groups
  ).sort(
    (a, b) =>
      b.count
      -
      a.count
  );
}


// =========================================================
// 5. Main
// =========================================================

async function main() {
  if (
    !fs.existsSync(
      PILOT_FILE
    )
  ) {
    throw new Error(
      "uni-pick-safe-pilot-result.json이 없습니다."
    );
  }

  const pilot =
    readJson(
      PILOT_FILE
    );

  const sourceRows =
    Array.isArray(
      pilot.results
    )
      ? pilot.results
      : [];


  // Safe Pilot 대상만 재사용.
  // 최대 10개 제한 유지.
  const targets =
    sourceRows.slice(
      0,
      10
    );


  const items = [];

  for (
    const target
    of targets
  ) {
    if (
      !target.officialUrl
    ) {
      items.push({
        universityId:
          target.universityId,

        universityName:
          target.universityName,

        url:
          null,

        ok:
          false,

        subtype:
          "URL_MISSING",

        nextClass:
          "CANONICAL_URL_RECHECK",

        autoRetry:
          false
      });

      continue;
    }

    items.push(
      await probe(
        target
      )
    );
  }


  const groups =
    buildGroups(
      items
    );


  const tlsRelatedCount =
    items.filter(
      item =>
        item.subtype
          === "TLS_CHAIN_ERROR"
        ||
        item.subtype
          === "TLS_HOSTNAME_MISMATCH"
        ||
        item.subtype
          === "CERT_EXPIRED"
    ).length;


  const reachableCount =
    items.filter(
      item =>
        item.ok
          === true
    ).length;


  const retryLaterCount =
    items.filter(
      item =>
        item.nextClass
          === "RETRY_LATER"
    ).length;


  let decision =
    "DO_NOT_BULK_RETRY";

  if (
    tlsRelatedCount
    >= Math.ceil(
      items.length
      * 0.5
    )
  ) {
    decision =
      "INVESTIGATE_TLS_ENVIRONMENT";
  }

  else if (
    retryLaterCount
    >= Math.ceil(
      items.length
      * 0.7
    )
  ) {
    decision =
      "CONTROLLED_RETRY_CANDIDATE";
  }


  const result = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    sourcePilot:
      path.basename(
        PILOT_FILE
      ),

    processed:
      items.length,

    reachableCount,

    tlsRelatedCount,

    retryLaterCount,

    groups,

    items,

    decision,

    recommendedNextActions:
      decision
        ===
        "INVESTIGATE_TLS_ENVIRONMENT"
        ? [
            "Node TLS/CA 환경 진단",
            "각 대학 canonical HTTPS hostname 확인",
            "TLS 검증 비활성화 금지",
            "인증서 문제와 로컬 Node CA 문제 분리"
          ]
        : [
            "현재 NETWORK_FETCH 전체 자동 확대 금지",
            "각 subtype별 별도 복구 정책 적용"
          ],

    safety: {
      readOnly:
        true,

      maximumTargets:
        10,

      operationalFilesModified:
        false,

      queueModified:
        false,

      tlsVerificationDisabled:
        false,

      gitTriggered:
        false,

      deploymentTriggered:
        false
    }
  };


  atomicWriteJson(
    OUTPUT_FILE,
    result
  );


  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


if (
  require.main
  === module
) {
  main().catch(
    error => {
      console.error(
        error.stack
        ||
        error.message
      );

      process.exitCode =
        1;
    }
  );
}


module.exports = {
  classifyDiagnostic,
  probe,
  buildGroups
};