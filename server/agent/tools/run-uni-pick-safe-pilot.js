"use strict";

/**
 * UNI PICK Safe Pilot Executor v1.1
 *
 * 목적:
 * - Improvement Planner가 선정한 NETWORK_FETCH 후보만 사용
 * - 최대 10개 대학만 제한적으로 재진단
 * - 기존 diagnoseUniversitySource() 재사용
 * - 기존 getOfficialHomepage() Resolver 재사용
 * - 운영 source/store/preview/git/deploy 변경 금지
 *
 * 허용:
 * - 네트워크 진단
 * - onboarding reports 생성
 * - Safe Pilot 결과 JSON 생성
 *
 * 보호:
 * - development/university-news/data/university-news-sources.final.json
 * - server/agent/data/agent-news-store.json
 * - data/university-news-preview.json
 *
 * 위 3개 운영 파일은 실행 전후 SHA-256을 비교한다.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  diagnoseUniversitySource
} = require(
  "../onboarding/tools/diagnose-source"
);

const {
  getOfficialHomepage
} = require(
  "../onboarding/tools/get-official-homepage"
);


// =========================================================
// 0. 경로
// =========================================================

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

const PLAN_FILE = path.join(
  DATA_DIR,
  "uni-pick-improvement-plan.json"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "uni-pick-safe-pilot-result.json"
);


// =========================================================
// 1. 운영 보호 대상
// =========================================================

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


// =========================================================
// 2. 공통 유틸
// =========================================================

function readJson(
  file
) {
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

  // 저장 직후 JSON 무결성 확인
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


function sha256(
  file
) {
  if (
    !fs.existsSync(
      file
    )
  ) {
    return null;
  }

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(
        file
      )
    )
    .digest(
      "hex"
    );
}


function hashOperationalFiles() {
  return Object.fromEntries(
    OPERATIONAL_FILES.map(
      file => [
        path.relative(
          ROOT,
          file
        ),

        sha256(
          file
        )
      ]
    )
  );
}


function hashesEqual(
  before,
  after
) {
  return (
    JSON.stringify(
      before
    )
    ===
    JSON.stringify(
      after
    )
  );
}


function normalizeId(
  value
) {
  return String(
    value || ""
  ).normalize(
    "NFC"
  );
}


function cleanUrl(
  value
) {
  if (!value) {
    return "";
  }

  let text =
    String(
      value
    ).trim();

  // Markdown 링크:
  // [https://example.com](https://example.com)
  const markdown =
    text.match(
      /^\[[^\]]+\]\((.+)\)$/
    );

  if (
    markdown
    &&
    markdown[1]
  ) {
    text =
      markdown[1];
  }

  return text
    .replace(
      /\\&/g,
      "&"
    )
    .trim();
}


// =========================================================
// 3. Catalog 대학 찾기
// =========================================================

function findUniversity(
  catalog,
  universityId
) {
  const target =
    normalizeId(
      universityId
    );

  return (
    catalog.universities
    || []
  ).find(
    item =>
      normalizeId(
        item.universityId
      )
      === target
  );
}


// =========================================================
// 4. 공식 URL Resolver
// =========================================================

function getOfficialUrl(
  university
) {
  if (!university) {
    return "";
  }

  // -------------------------------------------------------
  // 1순위:
  // 기존 UNI PICK 공식 홈페이지 Resolver
  // -------------------------------------------------------

  try {
    const resolved =
      getOfficialHomepage(
        university.universityId
      );

    if (
      resolved
      &&
      resolved.url
    ) {
      return cleanUrl(
        resolved.url
      );
    }
  } catch {
    // Resolver 실패 시 아래 fallback으로 이동
  }


  // -------------------------------------------------------
  // 2순위:
  // Catalog의 공식 source
  // -------------------------------------------------------

  const sources =
    Array.isArray(
      university.sources
    )
      ? university.sources
      : [];

  const preferred =
    sources.find(
      source =>
        source.sourceType
          === "official"
        &&
        source.listUrl
    )
    ||
    sources.find(
      source =>
        source.listUrl
    );

  if (
    preferred
    &&
    preferred.listUrl
  ) {
    return cleanUrl(
      preferred.listUrl
    );
  }


  // -------------------------------------------------------
  // 3순위:
  // Catalog university 필드 fallback
  // -------------------------------------------------------

  return cleanUrl(
    university.officialUrl
    ||
    university.website
    ||
    ""
  );
}


// =========================================================
// 5. Planner 후보 읽기
// =========================================================

function loadPilotCandidates(
  limit = 10
) {
  if (
    !fs.existsSync(
      PLAN_FILE
    )
  ) {
    throw new Error(
      "uni-pick-improvement-plan.json이 없습니다. "
      + "먼저 build-uni-pick-improvement-plan.js를 실행하세요."
    );
  }

  const plan =
    readJson(
      PLAN_FILE
    );

  const rows =
    Array.isArray(
      plan.pilotCandidates
    )
      ? plan.pilotCandidates
      : [];

  return rows
    .filter(
      item =>
        item.failureType
          === "NETWORK_FETCH"
        &&
        item.recoveryClass
          ===
        "AUTO_RECOVERY_CANDIDATE"
    )
    .slice(
      0,
      limit
    );
}


// =========================================================
// 6. 결과 분류
// =========================================================

function classifyPilotResult(
  diagnosis
) {
  if (
    diagnosis
    &&
    diagnosis.decision
      === "SUCCESS"
  ) {
    return "SUCCESS";
  }

  if (
    diagnosis
    &&
    diagnosis.decision
      === "REVIEW"
  ) {
    return "REVIEW";
  }

  return "ERROR";
}


// =========================================================
// 7. NETWORK_FETCH 복구 판단
// =========================================================

function recoveredFromNetwork(
  diagnosis
) {
  if (!diagnosis) {
    return false;
  }

  const homepage =
    diagnosis.homepageRequest
    || {};

  // 실제 HTTP 응답을 받았다면
  // 기존 fetch failed 상태 자체는 복구된 것으로 판단
  if (
    !homepage.error
    &&
    Number(
      homepage.status
    ) > 0
  ) {
    return true;
  }

  // 후보 발견 단계까지 도달했다면
  // 역시 네트워크 레벨은 통과
  if (
    Number(
      diagnosis
        .discoveredCandidateCount
      || 0
    ) > 0
  ) {
    return true;
  }

  if (
    diagnosis.decision
      === "SUCCESS"
    ||
    diagnosis.decision
      === "REVIEW"
  ) {
    return true;
  }

  return false;
}


// =========================================================
// 8. Selection Report
// =========================================================

function buildSelectionReport(
  candidates,
  catalog
) {
  return candidates.map(
    item => {
      const university =
        findUniversity(
          catalog,
          item.universityId
        );

      const officialUrl =
        getOfficialUrl(
          university
        );

      return {
        universityId:
          item.universityId,

        universityName:
          item.universityName,

        previousReason:
          item.reason,

        failureType:
          item.failureType,

        recoveryClass:
          item.recoveryClass,

        catalogFound:
          Boolean(
            university
          ),

        officialUrl,

        officialUrlResolved:
          Boolean(
            officialUrl
          )
      };
    }
  );
}


// =========================================================
// 9. Selection Integrity 검사
// =========================================================

function validateSelection(
  selected
) {
  const normalizedIds =
    selected.map(
      item =>
        normalizeId(
          item.universityId
        )
    );

  const uniqueIds =
    new Set(
      normalizedIds
    );

  const duplicateIds =
    selected.length
    -
    uniqueIds.size;

  const missingCatalog =
    selected.filter(
      item =>
        !item.catalogFound
    ).length;

  const missingOfficialUrl =
    selected.filter(
      item =>
        !item.officialUrl
    ).length;

  return {
    selectedCount:
      selected.length,

    duplicateIds,

    missingCatalog,

    missingOfficialUrl,

    valid:
      selected.length > 0
      &&
      duplicateIds === 0
      &&
      missingCatalog === 0
      &&
      missingOfficialUrl === 0
  };
}


// =========================================================
// 10. Main
// =========================================================

async function main() {
  const selectionOnly =
    process.argv.includes(
      "--selection-only"
    );

  const candidates =
    loadPilotCandidates(
      10
    );

  const catalog =
    readJson(
      CATALOG_FILE
    );

  const selected =
    buildSelectionReport(
      candidates,
      catalog
    );

  const selectionIntegrity =
    validateSelection(
      selected
    );


  // =======================================================
  // Selection-only 모드
  // =======================================================

  if (
    selectionOnly
  ) {
    console.log(
      JSON.stringify(
        {
          mode:
            "SELECTION_ONLY",

          ...selectionIntegrity,

          selected,

          safety: {
            networkRequests:
              0,

            operationalFilesModified:
              false,

            retryExecuted:
              false,

            deploymentTriggered:
              false,

            gitTriggered:
              false
          }
        },
        null,
        2
      )
    );

    return;
  }


  // =======================================================
  // 실제 실행 전 Selection Gate
  // =======================================================

  if (
    !selectionIntegrity.valid
  ) {
    throw new Error(
      "SAFE_PILOT_SELECTION_INTEGRITY_FAILED "
      + JSON.stringify(
        selectionIntegrity
      )
    );
  }


  // =======================================================
  // 실행 전 운영 파일 Hash
  // =======================================================

  const beforeHashes =
    hashOperationalFiles();

  const startedAt =
    new Date()
      .toISOString();

  const results = [];


  // =======================================================
  // 최대 10개만 제한 실행
  // =======================================================

  for (
    const item
    of selected
  ) {
    try {
      const diagnosis =
        await diagnoseUniversitySource({
          universityId:
            item.universityId,

          universityName:
            item.universityName,

          officialUrl:
            item.officialUrl
        });

      results.push({
        universityId:
          item.universityId,

        universityName:
          item.universityName,

        previousReason:
          item.previousReason,

        failureType:
          item.failureType,

        officialUrl:
          item.officialUrl,

        finalStatus:
          classifyPilotResult(
            diagnosis
          ),

        recoveredFromNetwork:
          recoveredFromNetwork(
            diagnosis
          ),

        decision:
          diagnosis.decision,

        score:
          Number(
            diagnosis.score
            || 0
          ),

        grade:
          diagnosis.grade
          || null,

        externalRequests:
          Number(
            diagnosis.externalRequests
            || 0
          ),

        homepageStatus:
          diagnosis
            .homepageRequest
            ?.status
          ?? null,

        homepageError:
          diagnosis
            .homepageRequest
            ?.error
          ?? null,

        candidateCount:
          Number(
            diagnosis
              .discoveredCandidateCount
            || 0
          ),

        recommendedUrl:
          diagnosis
            .recommendedCandidate
            ?.url
          || null,

        uniqueDetailUrls:
          Number(
            diagnosis
              .uniqueDetailUrls
            || 0
          ),

        passCount:
          Number(
            diagnosis.passCount
            || 0
          ),

        warnCount:
          Number(
            diagnosis.warnCount
            || 0
          ),

        failCount:
          Number(
            diagnosis.failCount
            || 0
          ),

        selectorStable:
          Boolean(
            diagnosis.selectorStable
          ),

        errors:
          Array.isArray(
            diagnosis.errors
          )
            ? diagnosis.errors
            : []
      });

    } catch (
      error
    ) {
      results.push({
        universityId:
          item.universityId,

        universityName:
          item.universityName,

        previousReason:
          item.previousReason,

        failureType:
          item.failureType,

        officialUrl:
          item.officialUrl,

        finalStatus:
          "ERROR",

        recoveredFromNetwork:
          false,

        reason:
          "DIAGNOSE_EXCEPTION",

        error:
          error.message
      });
    }
  }


  // =======================================================
  // 실행 후 운영 파일 Hash
  // =======================================================

  const afterHashes =
    hashOperationalFiles();

  const operationalHashUnchanged =
    hashesEqual(
      beforeHashes,
      afterHashes
    );


  // =======================================================
  // 운영 파일이 바뀌었으면 즉시 안전 실패
  // =======================================================

  if (
    !operationalHashUnchanged
  ) {
    const failureReport = {
      schemaVersion:
        "1.1",

      phase:
        "UNI_PICK_SAFE_PILOT_NETWORK_FETCH",

      startedAt,

      finishedAt:
        new Date()
          .toISOString(),

      operationalHashUnchanged:
        false,

      beforeHashes,

      afterHashes,

      results,

      safetyViolation:
        "OPERATIONAL_FILE_MUTATION_DETECTED"
    };

    atomicWriteJson(
      OUTPUT_FILE,
      failureReport
    );

    throw new Error(
      "SAFE_PILOT_OPERATIONAL_FILE_MUTATION_DETECTED"
    );
  }


  // =======================================================
  // 통계
  // =======================================================

  const processed =
    results.length;

  const success =
    results.filter(
      item =>
        item.finalStatus
          === "SUCCESS"
    ).length;

  const review =
    results.filter(
      item =>
        item.finalStatus
          === "REVIEW"
    ).length;

  const error =
    results.filter(
      item =>
        item.finalStatus
          === "ERROR"
    ).length;

  const recovered =
    results.filter(
      item =>
        item.recoveredFromNetwork
          === true
    ).length;

  const totalExternalRequests =
    results.reduce(
      (
        sum,
        item
      ) =>
        sum
        +
        Number(
          item.externalRequests
          || 0
        ),
      0
    );


  const successRate =
    processed > 0
      ? Number(
          (
            success
            / processed
            * 100
          ).toFixed(
            2
          )
        )
      : 0;


  const networkRecoveryRate =
    processed > 0
      ? Number(
          (
            recovered
            / processed
            * 100
          ).toFixed(
            2
          )
        )
      : 0;


  // =======================================================
  // 다음 확대 판단
  // =======================================================

  let expansionDecision =
    "DO_NOT_EXPAND";

  let expansionReason =
    "파일럿 결과가 자동 확대 기준을 충족하지 않았습니다.";


  if (
    operationalHashUnchanged
    &&
    networkRecoveryRate
      >= 70
    &&
    error === 0
  ) {
    expansionDecision =
      "EXPANSION_CANDIDATE";

    expansionReason =
      (
        "NETWORK_FETCH 복구율이 70% 이상이고 "
        + "실행 오류가 없으며 운영 파일 무결성이 유지되었습니다."
      );
  }


  const finishedAt =
    new Date()
      .toISOString();


  // =======================================================
  // 최종 Report
  // =======================================================

  const report = {
    schemaVersion:
      "1.1",

    phase:
      "UNI_PICK_SAFE_PILOT_NETWORK_FETCH",

    startedAt,

    finishedAt,

    plannerSource:
      path.basename(
        PLAN_FILE
      ),

    selectionIntegrity,

    selectedCount:
      selected.length,

    processed,

    success,

    review,

    error,

    recoveredFromNetwork:
      recovered,

    successRate,

    networkRecoveryRate,

    totalExternalRequests,

    operationalHashUnchanged,

    beforeHashes,

    afterHashes,

    expansionDecision,

    expansionReason,

    results,

    safety: {
      maximumPilotSize:
        10,

      plannerCandidatesOnly:
        true,

      selectionGatePassed:
        selectionIntegrity.valid,

      sourceConfigModified:
        false,

      newsStoreModified:
        false,

      previewModified:
        false,

      gitTriggered:
        false,

      deploymentTriggered:
        false,

      automaticActivation:
        false,

      operationalHashVerified:
        operationalHashUnchanged
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


// =========================================================
// 11. 시작
// =========================================================

if (
  require.main
  === module
) {
  main().catch(
    error => {
      console.error(
        error.stack
        || error.message
      );

      process.exitCode =
        1;
    }
  );
}


// =========================================================
// 12. 테스트/재사용 Export
// =========================================================

module.exports = {
  cleanUrl,
  findUniversity,
  getOfficialUrl,
  loadPilotCandidates,
  classifyPilotResult,
  recoveredFromNetwork,
  buildSelectionReport,
  validateSelection,
  hashOperationalFiles,
  hashesEqual
};