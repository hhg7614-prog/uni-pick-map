"use strict";

/**
 * UNI PICK Safe Pilot Evaluator v1
 *
 * 역할:
 * - Safe Pilot 결과를 읽는다.
 * - 단순 "fetch failed"를 세부 원인으로 재분류한다.
 * - 전체 NETWORK_FETCH 확대 여부를 판단한다.
 * - 다음 개선 사이클의 작업 방향을 제안한다.
 *
 * 주의:
 * - 운영 데이터 수정 없음
 * - 네트워크 요청 없음
 * - Git/배포 없음
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
  "uni-pick-safe-pilot-evaluation.json"
);


// =========================================================
// 1. 유틸
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
// 2. 에러 subtype 재분류
// =========================================================

function classifyDetailedNetworkFailure(
  row
) {
  if (
    row.recoveredFromNetwork
    === true
  ) {
    if (
      Number(
        row.candidateCount || 0
      ) === 0
    ) {
      return {
        subtype:
          "NETWORK_RECOVERED_NO_CANDIDATE",

        nextClass:
          "NO_CANDIDATE",

        action:
          "DISCOVERY_DIAGNOSIS",

        autoRetry:
          false
      };
    }

    return {
      subtype:
        "NETWORK_RECOVERED",

      nextClass:
        "CONTENT_DIAGNOSIS",

      action:
        "CONTINUE_DISCOVERY_VALIDATION",

      autoRetry:
        false
    };
  }

  const joined =
    [
      row.homepageError,
      ...(Array.isArray(row.errors)
        ? row.errors
        : []),
      row.error,
      row.reason
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();


  // -------------------------------------------------------
  // Redirect loop
  // -------------------------------------------------------

  if (
    joined.includes(
      "redirect count exceeded"
    )
    ||
    joined.includes(
      "too many redirects"
    )
  ) {
    return {
      subtype:
        "REDIRECT_LOOP",

      nextClass:
        "DISCOVERY_RECHECK",

      action:
        "CHECK_CANONICAL_HOMEPAGE_AND_REDIRECT_CHAIN",

      autoRetry:
        false
    };
  }


  // -------------------------------------------------------
  // TLS chain
  // -------------------------------------------------------

  if (
    joined.includes(
      "unable_to_verify_leaf_signature"
    )
    ||
    joined.includes(
      "unable to verify the first certificate"
    )
  ) {
    return {
      subtype:
        "TLS_CHAIN_ERROR",

      nextClass:
        "TLS_ENVIRONMENT_REVIEW",

      action:
        "VERIFY_CERTIFICATE_CHAIN_WITHOUT_DISABLING_TLS",

      autoRetry:
        false
    };
  }


  // -------------------------------------------------------
  // TLS hostname mismatch
  // -------------------------------------------------------

  if (
    joined.includes(
      "err_tls_cert_altname_invalid"
    )
    ||
    joined.includes(
      "does not match certificate"
    )
  ) {
    return {
      subtype:
        "TLS_HOSTNAME_MISMATCH",

      nextClass:
        "URL_CORRECTION_REVIEW",

      action:
        "CHECK_CANONICAL_HOSTNAME",

      autoRetry:
        false
    };
  }


  if (
    joined.includes(
      "cert_has_expired"
    )
    ||
    joined.includes(
      "certificate has expired"
    )
  ) {
    return {
      subtype:
        "CERT_EXPIRED",

      nextClass:
        "HUMAN_REVIEW",

      action:
        "VERIFY_SITE_CERTIFICATE_AND_OFFICIAL_URL",

      autoRetry:
        false
    };
  }


  // -------------------------------------------------------
  // DNS
  // -------------------------------------------------------

  if (
    joined.includes(
      "enotfound"
    )
    ||
    joined.includes(
      "getaddrinfo"
    )
  ) {
    return {
      subtype:
        "DNS_ERROR",

      nextClass:
        "URL_RECHECK",

      action:
        "VERIFY_OFFICIAL_DOMAIN",

      autoRetry:
        false
    };
  }


  // -------------------------------------------------------
  // Connection reset
  // -------------------------------------------------------

  if (
    joined.includes(
      "econnreset"
    )
  ) {
    return {
      subtype:
        "ECONNRESET",

      nextClass:
        "RETRY_LATER",

      action:
        "RETRY_WITH_COOLDOWN",

      autoRetry:
        true
    };
  }


  // -------------------------------------------------------
  // Timeout
  // -------------------------------------------------------

  if (
    joined.includes(
      "etimedout"
    )
    ||
    joined.includes(
      "timeout"
    )
    ||
    joined.includes(
      "aborted"
    )
  ) {
    return {
      subtype:
        "TIMEOUT",

      nextClass:
        "RETRY_LATER",

      action:
        "RETRY_WITH_COOLDOWN",

      autoRetry:
        true
    };
  }


  return {
    subtype:
      "UNKNOWN_NETWORK",

    nextClass:
      "DIAGNOSE_FIRST",

    action:
      "COLLECT_LOW_LEVEL_NETWORK_DIAGNOSTICS",

    autoRetry:
      false
  };
}


// =========================================================
// 3. 그룹화
// =========================================================

function buildGroups(
  evaluated
) {
  const map =
    new Map();

  for (
    const row
    of evaluated
  ) {
    const key =
      row.networkSubtype;

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        {
          networkSubtype:
            key,

          nextClass:
            row.nextClass,

          action:
            row.recommendedAction,

          autoRetry:
            row.autoRetry,

          count:
            0,

          universityIds:
            []
        }
      );
    }

    const group =
      map.get(key);

    group.count += 1;

    group.universityIds.push(
      row.universityId
    );
  }

  return Array.from(
    map.values()
  )
    .map(
      group => ({
        ...group,

        sampleUniversityIds:
          group.universityIds.slice(
            0,
            10
          )
      })
    )
    .sort(
      (a, b) =>
        b.count - a.count
    );
}


// =========================================================
// 4. 다음 전략 판단
// =========================================================

function buildDecision(
  pilot,
  groups,
  evaluated
) {
  const tlsCount =
    evaluated.filter(
      row =>
        row.networkSubtype
          === "TLS_CHAIN_ERROR"
        ||
        row.networkSubtype
          === "TLS_HOSTNAME_MISMATCH"
        ||
        row.networkSubtype
          === "CERT_EXPIRED"
    ).length;

  const recoveredCount =
    evaluated.filter(
      row =>
        row.recoveredFromNetwork
    ).length;

  const retryLaterCount =
    evaluated.filter(
      row =>
        row.nextClass
          === "RETRY_LATER"
    ).length;


  let overallDecision =
    "DO_NOT_EXPAND";

  let reason =
    "파일럿 복구율이 낮아 전체 NETWORK_FETCH 대상으로 확대하지 않습니다.";


  if (
    pilot.operationalHashUnchanged
      !== true
  ) {
    overallDecision =
      "SAFETY_STOP";

    reason =
      "운영 파일 무결성 검사가 실패했습니다.";
  }

  else if (
    Number(
      pilot.networkRecoveryRate
      || 0
    ) >= 70
    &&
    Number(
      pilot.error
      || 0
    ) === 0
  ) {
    overallDecision =
      "EXPAND_NETWORK_RECOVERY";

    reason =
      "네트워크 복구율이 70% 이상이고 실행 오류가 없습니다.";
  }

  else if (
    tlsCount
    >= Math.ceil(
      evaluated.length * 0.5
    )
  ) {
    overallDecision =
      "INVESTIGATE_TLS_ENVIRONMENT";

    reason =
      (
        "파일럿의 절반 이상이 TLS/인증서 계열 오류입니다. "
        + "대학별 개별 장애로 간주하기 전에 Node TLS 환경과 "
        + "공식 URL 인증서 체인을 별도로 검증해야 합니다."
      );
  }


  return {
    overallDecision,

    reason,

    metrics: {
      processed:
        evaluated.length,

      recoveredFromNetwork:
        recoveredCount,

      tlsRelated:
        tlsCount,

      retryLater:
        retryLaterCount,

      networkRecoveryRate:
        Number(
          pilot.networkRecoveryRate
          || 0
        ),

      operationalHashUnchanged:
        pilot.operationalHashUnchanged
          === true
    },

    nextActions: [
      {
        priority:
          1,

        action:
          "TLS_ENVIRONMENT_DIAGNOSTIC",

        executeWhen:
          tlsCount > 0,

        description:
          (
            "TLS 검증을 끄지 않고 시스템 인증서 환경과 "
            + "대학 공식 URL의 인증서 체인을 진단합니다."
          )
      },

      {
        priority:
          2,

        action:
          "REDIRECT_CANONICAL_URL_RECHECK",

        executeWhen:
          groups.some(
            group =>
              group.networkSubtype
                === "REDIRECT_LOOP"
          ),

        description:
          (
            "redirect loop가 발생한 대학의 canonical 홈페이지 "
            + "URL을 다시 확인합니다."
          )
      },

      {
        priority:
          3,

        action:
          "RECLASSIFY_RECOVERED_ITEMS",

        executeWhen:
          recoveredCount > 0,

        description:
          (
            "네트워크가 복구된 대학은 NETWORK_FETCH 큐에서 제거하고 "
            + "NO_CANDIDATE 또는 콘텐츠 품질 진단 단계로 이동합니다."
          )
      },

      {
        priority:
          4,

        action:
          "DO_NOT_BULK_RETRY",

        executeWhen:
          Number(
            pilot.networkRecoveryRate
            || 0
          ) < 70,

        description:
          (
            "현재 NETWORK_FETCH 전체를 자동 재시도하지 않습니다."
          )
      }
    ].filter(
      item =>
        item.executeWhen
    )
  };
}


// =========================================================
// 5. Main
// =========================================================

function main() {
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

  const results =
    Array.isArray(
      pilot.results
    )
      ? pilot.results
      : [];


  const evaluated =
    results.map(
      row => {
        const classified =
          classifyDetailedNetworkFailure(
            row
          );

        return {
          universityId:
            row.universityId,

          universityName:
            row.universityName,

          previousReason:
            row.previousReason,

          originalStatus:
            row.finalStatus,

          recoveredFromNetwork:
            row.recoveredFromNetwork
              === true,

          homepageStatus:
            row.homepageStatus
            ?? null,

          networkSubtype:
            classified.subtype,

          nextClass:
            classified.nextClass,

          recommendedAction:
            classified.action,

          autoRetry:
            classified.autoRetry
        };
      }
    );


  const groups =
    buildGroups(
      evaluated
    );


  const decision =
    buildDecision(
      pilot,
      groups,
      evaluated
    );


  const output = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    sourcePilot:
      path.basename(
        PILOT_FILE
      ),

    pilotSummary: {
      processed:
        pilot.processed,

      success:
        pilot.success,

      review:
        pilot.review,

      error:
        pilot.error,

      recoveredFromNetwork:
        pilot.recoveredFromNetwork,

      networkRecoveryRate:
        pilot.networkRecoveryRate,

      operationalHashUnchanged:
        pilot.operationalHashUnchanged
    },

    reclassifiedCount:
      evaluated.length,

    networkGroups:
      groups,

    evaluatedItems:
      evaluated,

    decision,

    safety: {
      readOnly:
        true,

      networkRequests:
        0,

      tlsVerificationDisabled:
        false,

      operationalFilesModified:
        false,

      deploymentTriggered:
        false,

      gitTriggered:
        false
    }
  };


  atomicWriteJson(
    OUTPUT_FILE,
    output
  );


  console.log(
    JSON.stringify(
      output,
      null,
      2
    )
  );
}


if (
  require.main
  === module
) {
  main();
}


module.exports = {
  classifyDetailedNetworkFailure,
  buildGroups,
  buildDecision
};