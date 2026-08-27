"use strict";

/**
 * UNI PICK TLS Environment Diagnostic v1
 *
 * 목적:
 * - Network Subtype Probe에서 TLS 관련 오류가 난 대학만 분석
 * - Node fetch 결과와 Windows curl.exe 결과를 비교
 * - TLS 검증을 절대 비활성화하지 않음
 *
 * 분류:
 * NODE_CA_COMPATIBILITY
 * SITE_CHAIN_ISSUE
 * HOSTNAME_MISMATCH
 * TLS_RECOVERED
 * UNKNOWN_TLS
 *
 * 읽기 중심:
 * - source/store/preview/queue 수정 없음
 * - git/deploy 없음
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const NETWORK_FILE = path.join(
  DATA_DIR,
  "uni-pick-network-subtypes.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "uni-pick-tls-environment-diagnostic.json"
);


// =========================================================
// 1. Utilities
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
// 2. Windows curl probe
// =========================================================

function curlProbe(url) {
  const result =
    spawnSync(
      "curl.exe",
      [
        "-I",
        "-L",
        "--max-redirs",
        "5",
        "--connect-timeout",
        "10",
        "--max-time",
        "20",
        url
      ],
      {
        encoding:
          "utf8",

        windowsHide:
          true
      }
    );

  const output =
    `${result.stdout || ""}\n${result.stderr || ""}`;

  const matches =
    [
      ...output.matchAll(
        /HTTP\/\S+\s+(\d{3})/g
      )
    ];

  const finalStatus =
    matches.length
      ? Number(
          matches[
            matches.length - 1
          ][1]
        )
      : null;

  return {
    exitCode:
      result.status,

    success:
      result.status === 0
      &&
      finalStatus !== null
      &&
      finalStatus < 400,

    finalStatus,

    stderr:
      String(
        result.stderr || ""
      ).slice(
        -2000
      )
  };
}


// =========================================================
// 3. Classification
// =========================================================

function classify({
  subtype,
  nodeOk,
  curl
}) {
  if (
    subtype
    === "TLS_HOSTNAME_MISMATCH"
  ) {
    return {
      classification:
        "HOSTNAME_MISMATCH",

      confidence:
        "HIGH",

      autoRetry:
        false,

      recommendedAction:
        "공식 canonical hostname을 다시 확인합니다."
    };
  }


  if (
    nodeOk === true
  ) {
    return {
      classification:
        "TLS_RECOVERED",

      confidence:
        "HIGH",

      autoRetry:
        false,

      recommendedAction:
        "TLS 오류가 재현되지 않으므로 discovery 단계로 이동합니다."
    };
  }


  if (
    subtype
      === "TLS_CHAIN_ERROR"
    &&
    curl.success
      === true
  ) {
    return {
      classification:
        "NODE_CA_COMPATIBILITY",

      confidence:
        "HIGH",

      autoRetry:
        false,

      recommendedAction:
        (
          "Windows/curl은 인증서를 신뢰하지만 Node/OpenSSL만 실패합니다. "
          + "Node CA 체인 호환 정책을 별도로 설계합니다."
        )
    };
  }


  if (
    subtype
      === "TLS_CHAIN_ERROR"
    &&
    curl.success
      === false
  ) {
    return {
      classification:
        "SITE_CHAIN_ISSUE",

      confidence:
        "MEDIUM",

      autoRetry:
        false,

      recommendedAction:
        (
          "Node와 Windows/curl 모두 TLS 검증에 실패하므로 "
          + "사이트 인증서 체인을 사람 검토 대상으로 분류합니다."
        )
    };
  }


  return {
    classification:
      "UNKNOWN_TLS",

    confidence:
      "LOW",

    autoRetry:
      false,

    recommendedAction:
      "추가 TLS 진단이 필요합니다."
  };
}


// =========================================================
// 4. Main
// =========================================================

function main() {
  if (
    !fs.existsSync(
      NETWORK_FILE
    )
  ) {
    throw new Error(
      "uni-pick-network-subtypes.json이 없습니다."
    );
  }

  const network =
    readJson(
      NETWORK_FILE
    );

  const allItems =
    Array.isArray(
      network.items
    )
      ? network.items
      : [];


  const targets =
    allItems.filter(
      item =>
        item.subtype
          === "TLS_CHAIN_ERROR"
        ||
        item.subtype
          === "TLS_HOSTNAME_MISMATCH"
        ||
        item.subtype
          === "CERT_EXPIRED"
    );


  const results = [];


  for (
    const item
    of targets
  ) {
    const curl =
      curlProbe(
        item.url
      );

    const decision =
      classify({
        subtype:
          item.subtype,

        nodeOk:
          item.ok,

        curl
      });


    results.push({
      universityId:
        item.universityId,

      universityName:
        item.universityName,

      url:
        item.url,

      node: {
        ok:
          item.ok,

        subtype:
          item.subtype,

        causeCode:
          item.causeCode
          || null,

        causeMessage:
          item.causeMessage
          || null
      },

      windowsCurl:
        curl,

      ...decision
    });
  }


  const classificationCounts = {};

  for (
    const row
    of results
  ) {
    classificationCounts[
      row.classification
    ] =
      (
        classificationCounts[
          row.classification
        ]
        || 0
      )
      + 1;
  }


  const nodeCaCompatibility =
    results.filter(
      row =>
        row.classification
          === "NODE_CA_COMPATIBILITY"
    ).length;


  const siteChainIssue =
    results.filter(
      row =>
        row.classification
          === "SITE_CHAIN_ISSUE"
    ).length;


  const hostnameMismatch =
    results.filter(
      row =>
        row.classification
          === "HOSTNAME_MISMATCH"
    ).length;


  let overallDecision =
    "REVIEW_TLS_CASES";


  if (
    targets.length > 0
    &&
    nodeCaCompatibility
      >= Math.ceil(
        targets.length * 0.5
      )
  ) {
    overallDecision =
      "NODE_CA_COMPATIBILITY_DOMINANT";
  }


  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    environment: {
      node:
        process.version,

      openssl:
        process.versions
          .openssl,

      platform:
        process.platform,

      arch:
        process.arch,

      nodeExtraCaCerts:
        process.env
          .NODE_EXTRA_CA_CERTS
        || null,

      tlsRejectUnauthorized:
        process.env
          .NODE_TLS_REJECT_UNAUTHORIZED
        || null
    },

    processed:
      results.length,

    classificationCounts,

    nodeCaCompatibility,

    siteChainIssue,

    hostnameMismatch,

    overallDecision,

    results,

    recommendedPolicy:
      overallDecision
        ===
        "NODE_CA_COMPATIBILITY_DOMINANT"
        ? [
            "TLS 검증 비활성화 금지",
            "NODE_TLS_REJECT_UNAUTHORIZED=0 사용 금지",
            "Windows가 신뢰하는 인증서를 Node에서도 안전하게 검증하는 방법 검토",
            "사이트별 예외 우회보다 CA 환경 호환성을 우선 해결",
            "HOSTNAME_MISMATCH는 Node CA 문제와 별도로 canonical URL 수정"
          ]
        : [
            "TLS 사례를 대학별로 검토",
            "Node와 Windows 모두 실패하는 사이트는 SITE_CHAIN_ISSUE로 유지",
            "TLS 검증 우회 금지"
          ],

    safety: {
      readOnly:
        true,

      tlsVerificationDisabled:
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


  atomicWriteJson(
    OUTPUT_FILE,
    report
  );


  console.log(
    JSON.stringify(
      report,
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
  curlProbe,
  classify
};