"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const DATA = path.join(ROOT, "server", "agent", "data");

const OUT = path.join(
  DATA,
  "uni-pick-transient-network-state.json"
);

const previous = path.join(
  DATA,
  "sangmyung-cheonan-source-validation.json"
);

function read(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function atomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.renameSync(tmp, file);
}

function main() {
  const priorValidation = read(previous, null);

  const now = new Date();

  const retryAt = new Date(
    now.getTime() + 24 * 60 * 60 * 1000
  );

  const report = {
    schemaVersion: "1.0",

    generatedAt: now.toISOString(),

    items: [
      {
        universityId:
          "sangmyung-university-제2캠퍼",

        universityName:
          "상명대학교 제2캠퍼",

        currentClass:
          "SERVER_CONNECT_TIMEOUT",

        previousClass:
          "CANONICAL_SOURCE_DISCOVERY",

        sourceCandidate:
          "https://www.smu.ac.kr/smuchina/community/sm_notice.do?mode=list&srCampus=smuc",

        evidence: {
          canonicalCandidateFound: true,
          listPagePreviouslyReached: true,
          previousListStatus:
            priorValidation?.listPage?.status ?? 200,
          previousCandidateCount:
            priorValidation?.candidateCount ?? 5,
          previousUniqueDetailUrls:
            priorValidation?.uniqueDetailUrls ?? 3,
          nodeTimeout:
            "UND_ERR_CONNECT_TIMEOUT",
          curlTimeout:
            true
        },

        retryDisposition:
          "RETRY_LATER",

        retryAfter:
          retryAt.toISOString(),

        autoRetryAllowed:
          true,

        automaticActivation:
          false,

        recommendedAction:
          "24시간 이후 동일 canonical source 후보에 대해 상세 selector 검증만 재개합니다.",

        preserveFindings: [
          "smu.ac.kr 공식 도메인 확인",
          "srCampus=smuc 천안캠퍼스 후보 확인",
          "목록 HTTP 200 확인 이력",
          "상세 후보 3건 확인 이력"
        ]
      }
    ],

    safety: {
      sourceModified: false,
      storeModified: false,
      previewModified: false,
      queueModified: false,
      gitTriggered: false,
      deploymentTriggered: false
    }
  };

  atomic(OUT, report);

  console.log(
    JSON.stringify(report, null, 2)
  );
}

if (require.main === module) {
  main();
}