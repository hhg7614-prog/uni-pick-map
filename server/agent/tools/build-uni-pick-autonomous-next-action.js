"use strict";

/**
 * UNI PICK Autonomous Next Action Planner v1.1
 *
 * 목적
 * ------------------------------------------------------------
 * 여러 진단 파일의 최신 상태를 하나로 합쳐
 * 현재 UNI PICK에서 다음에 처리해야 할 작업을 선택한다.
 *
 * 핵심 정책
 * ------------------------------------------------------------
 * 1. evaluator가 이미 RESOLVED로 판정한 대학은 최우선 RESOLVED
 * 2. SHARED_SOURCE_VISIBLE도 RESOLVED로 인정
 * 3. ENVIRONMENT_WAF_BLOCKED는 로컬에서 재진단하지 않는다
 * 4. WAF 차단 대학은 cooldown/non-actionable 상태로 유지한다
 * 5. transient RETRY_LATER는 재시도 시각 전까지 실행하지 않는다
 * 6. stale discovery 결과가 RESOLVED/WAF 판정을 덮어쓰지 못한다
 * 7. 최신 discovery 후보는 미해결 대학에 대해서만 사용한다
 * 8. source/store/preview/queue 수정 없음
 * 9. 네트워크 요청 없음
 * 10. Git/Deploy 없음
 */

const fs = require("fs");
const path = require("path");

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

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const EVALUATION_FILE = path.join(
  DATA,
  "uni-pick-recovered-pilot-evaluation.json"
);

const DISCOVERY_FILE = path.join(
  DATA,
  "uni-pick-no-candidate-discovery.json"
);

const TRANSIENT_FILE = path.join(
  DATA,
  "uni-pick-transient-network-state.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-autonomous-next-action.json"
);

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

  const temporary =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(
      temporary,
      "utf8"
    )
  );

  fs.renameSync(
    temporary,
    file
  );
}

function key(value) {
  return String(
    value || ""
  ).normalize(
    "NFC"
  );
}

function timestamp(value) {
  const ms =
    Date.parse(
      value || ""
    );

  return Number.isFinite(ms)
    ? ms
    : 0;
}

/* =========================================================
 * Catalog
 * ========================================================= */

function getUniversities(catalog) {
  if (!catalog) {
    return [];
  }

  if (
    Array.isArray(
      catalog.universities
    )
  ) {
    return catalog.universities;
  }

  if (Array.isArray(catalog)) {
    return catalog;
  }

  return [];
}

function getSources(university) {
  if (
    !university
    ||
    !Array.isArray(
      university.sources
    )
  ) {
    return [];
  }

  return university.sources;
}

function buildVerifiedMap(catalog) {
  const map =
    new Map();

  for (
    const university
    of getUniversities(catalog)
  ) {
    const verified =
      getSources(university)
        .filter(
          source =>
            source?.verified === true
            &&
            source?.enabled === true
        );

    if (
      verified.length > 0
    ) {
      map.set(
        key(
          university.universityId
        ),
        verified
      );
    }
  }

  return map;
}

/**
 * SHARED_SOURCE를 실제 owner 대학에만 저장해도
 * visibleToCampuses에 포함된 캠퍼스는
 * 해당 source를 유효한 verified source로 사용할 수 있다.
 */
function buildSharedVisibleMap(catalog) {
  const map =
    new Map();

  for (
    const university
    of getUniversities(catalog)
  ) {
    for (
      const source
      of getSources(university)
    ) {
      if (
        source?.verified !== true
        ||
        source?.enabled !== true
        ||
        source?.campusScope
          !== "SHARED_SOURCE"
      ) {
        continue;
      }

      const visibleToCampuses =
        Array.isArray(
          source.visibleToCampuses
        )
          ? source.visibleToCampuses
          : [];

      for (
        const universityId
        of visibleToCampuses
      ) {
        const id =
          key(universityId);

        if (!map.has(id)) {
          map.set(
            id,
            []
          );
        }

        map.get(id)
          .push({
            ...source,

            canonicalOwner:
              source.canonicalOwner
              ||
              university.universityId,

            sourceAccess:
              key(
                university.universityId
              )
              === id
                ? "DIRECT"
                : "SHARED_VISIBLE"
          });
      }
    }
  }

  return map;
}

/* =========================================================
 * Transient / Cooldown
 * ========================================================= */

function buildTransientMap(transient) {
  const map =
    new Map();

  for (
    const item
    of transient?.items || []
  ) {
    map.set(
      key(
        item.universityId
      ),
      item
    );
  }

  return map;
}

function cooldownState(item, now) {
  if (!item) {
    return {
      active: false,
      retryAfter: null
    };
  }

  if (
    item.retryDisposition
    !== "RETRY_LATER"
  ) {
    return {
      active: false,

      retryAfter:
        item.retryAfter
        || null
    };
  }

  const retry =
    timestamp(
      item.retryAfter
    );

  return {
    active:
      retry > now,

    retryAfter:
      item.retryAfter
      || null
  };
}

/* =========================================================
 * Latest Discovery Map
 * ========================================================= */

function buildDiscoveryMap(discovery) {
  const map =
    new Map();

  for (
    const item
    of discovery?.results || []
  ) {
    map.set(
      key(
        item.universityId
      ),
      item
    );
  }

  return map;
}

/* =========================================================
 * Priority
 * ========================================================= */

const PRIORITIES = {
  VALIDATE_DISCOVERED_CANDIDATE: 10,
  VALIDATE_REVIEW_CANDIDATE: 20,
  QUALITY_REVIEW: 30,
  DISCOVERY_DIAGNOSIS: 40,
  CANONICAL_SOURCE_DISCOVERY: 50,
  NO_CANDIDATE_DISCOVERY: 60,
  SHARED_SOURCE_REVIEW: 70,

  ENVIRONMENT_WAF_BLOCKED: 90,
  RETRY_LATER: 91,

  RESOLVED: 100
};

/* =========================================================
 * Classification
 * ========================================================= */

function classify({
  evaluator,
  discovery,
  transient,
  verified,
  sharedVisibleVerified,
  now
}) {
  const evaluatorClass =
    evaluator?.nextClass
    || "UNKNOWN";

  /*
   * ---------------------------------------------------------
   * 1. Evaluator가 이미 해결 판정한 경우
   *
   * 중요:
   * stale discovery가 이 결과를 덮어쓰면 안 된다.
   * ---------------------------------------------------------
   */

  if (
    evaluatorClass
    ===
    "RESOLVED_BY_EXISTING_VERIFIED_SOURCE"
    ||
    evaluator?.resolved === true
  ) {
    return {
      state:
        "RESOLVED",

      priority:
        PRIORITIES.RESOLVED,

      actionable:
        false,

      reason:
        evaluator?.reason
        ||
        "기존 verified source 또는 shared visible source로 해결되었습니다.",

      sourceResolutionMode:
        evaluator?.sourceResolutionMode
        || (
          sharedVisibleVerified
          &&
          sharedVisibleVerified.length > 0
            ? "SHARED_SOURCE_VISIBLE"
            : "DIRECT_SOURCE"
        ),

      verifiedSources:
        Array.isArray(
          evaluator?.verifiedSources
        )
          ? evaluator.verifiedSources
          : []
    };
  }

  /*
   * ---------------------------------------------------------
   * 2. Catalog direct verified source
   * ---------------------------------------------------------
   */

  if (
    verified
    &&
    verified.length > 0
  ) {
    return {
      state:
        "RESOLVED",

      priority:
        PRIORITIES.RESOLVED,

      actionable:
        false,

      reason:
        "verified=true, enabled=true인 직접 source가 이미 존재합니다.",

      sourceResolutionMode:
        "DIRECT_SOURCE",

      verifiedSources:
        verified.map(
          source => ({
            sourceId:
              source.id
              || source.sourceId
              || null,

            listUrl:
              source.listUrl
              || null,

            category:
              source.category
              || null,

            campusScope:
              source.campusScope
              || null,

            canonicalOwner:
              source.canonicalOwner
              || null,

            sourceAccess:
              "DIRECT"
          })
        )
    };
  }

  /*
   * ---------------------------------------------------------
   * 3. Catalog SHARED_SOURCE visible
   *
   * owner 쪽에만 source가 저장되어 있어도
   * visibleToCampuses에 현재 캠퍼스가 있으면 해결 상태다.
   * ---------------------------------------------------------
   */

  if (
    sharedVisibleVerified
    &&
    sharedVisibleVerified.length > 0
  ) {
    return {
      state:
        "RESOLVED",

      priority:
        PRIORITIES.RESOLVED,

      actionable:
        false,

      reason:
        "canonical owner에 저장된 verified SHARED_SOURCE의 visibleToCampuses에 포함되어 공동 source를 사용합니다.",

      sourceResolutionMode:
        "SHARED_SOURCE_VISIBLE",

      verifiedSources:
        sharedVisibleVerified.map(
          source => ({
            sourceId:
              source.id
              || source.sourceId
              || null,

            listUrl:
              source.listUrl
              || null,

            category:
              source.category
              || null,

            campusScope:
              source.campusScope
              || null,

            canonicalOwner:
              source.canonicalOwner
              || null,

            sourceAccess:
              "SHARED_VISIBLE",

            collectOnce:
              source.collectOnce
              === true,

            duplicateStorage:
              source.duplicateStorage
              === true,

            visibleToCampuses:
              Array.isArray(
                source.visibleToCampuses
              )
                ? source.visibleToCampuses
                : []
          })
        )
    };
  }

  /*
   * ---------------------------------------------------------
   * 4. ENVIRONMENT_WAF_BLOCKED
   *
   * 이것이 이번 수정의 핵심이다.
   *
   * 로컬 환경에서 이미 WAF 차단으로 판정된 대학은
   * DIAGNOSE_FIRST나 RUN_DEEP_DISCOVERY로 보내지 않는다.
   *
   * 다른 환경에서 재검증하기 전까지 non-actionable이다.
   * ---------------------------------------------------------
   */

  if (
    evaluatorClass
    === "ENVIRONMENT_WAF_BLOCKED"
    ||
    evaluator?.networkSubtype
      === "ENVIRONMENT_WAF_BLOCKED"
    ||
    evaluator?.networkNextClass
      === "RETRY_IN_DIFFERENT_ENVIRONMENT"
    ||
    evaluator?.localDiscoveryBlocked
      === true
  ) {
    return {
      state:
        "ENVIRONMENT_WAF_BLOCKED",

      priority:
        PRIORITIES
          .ENVIRONMENT_WAF_BLOCKED,

      actionable:
        false,

      cooldown:
        true,

      retryable:
        evaluator?.retryable
        !== false,

      nextEnvironmentAction:
        evaluator?.nextAction
        ||
        "RETRY_IN_DIFFERENT_ENVIRONMENT",

      reason:
        evaluator?.reason
        ||
        "현재 로컬 환경의 웹방화벽 정책으로 수집이 차단되어 다른 네트워크 또는 배포 환경에서 재검증해야 합니다."
    };
  }

  /*
   * ---------------------------------------------------------
   * 5. Transient cooldown
   * ---------------------------------------------------------
   */

  const cooldown =
    cooldownState(
      transient,
      now
    );

  if (
    cooldown.active
  ) {
    return {
      state:
        "RETRY_LATER",

      priority:
        PRIORITIES.RETRY_LATER,

      actionable:
        false,

      cooldown:
        true,

      retryAfter:
        cooldown.retryAfter,

      reason:
        "일시적인 서버 또는 네트워크 문제로 cooldown 중이므로 현재 재시도하지 않습니다."
    };
  }

  /*
   * ---------------------------------------------------------
   * 6. 최신 Discovery
   *
   * 여기까지 왔다는 것은
   * resolved / WAF / cooldown이 아니라는 뜻이다.
   * ---------------------------------------------------------
   */

  if (discovery) {
    if (
      discovery.finalStatus
      === "CANDIDATE_DISCOVERED"
    ) {
      return {
        state:
          "VALIDATE_DISCOVERED_CANDIDATE",

        priority:
          PRIORITIES
            .VALIDATE_DISCOVERED_CANDIDATE,

        actionable:
          true,

        reason:
          "최신 Discovery 결과에서 공식 source 후보가 발견되었습니다.",

        candidate:
          discovery.bestCandidate
          || null
      };
    }

    if (
      discovery.finalStatus
      === "REVIEW_CANDIDATE"
    ) {
      return {
        state:
          "VALIDATE_REVIEW_CANDIDATE",

        priority:
          PRIORITIES
            .VALIDATE_REVIEW_CANDIDATE,

        actionable:
          true,

        reason:
          "최신 Discovery 결과에서 검토가 필요한 source 후보가 발견되었습니다.",

        candidate:
          discovery.bestCandidate
          || null
      };
    }

    if (
      discovery.finalStatus
      === "TRANSIENT_NETWORK"
    ) {
      return {
        state:
          "RETRY_LATER",

        priority:
          PRIORITIES.RETRY_LATER,

        actionable:
          false,

        cooldown:
          true,

        reason:
          "최신 Discovery 과정에서 일시적인 네트워크 장애가 확인되었습니다."
      };
    }
  }

  /*
   * ---------------------------------------------------------
   * 7. Evaluator 분류
   * ---------------------------------------------------------
   */

  if (
    evaluatorClass
    === "QUALITY_REVIEW"
  ) {
    return {
      state:
        "QUALITY_REVIEW",

      priority:
        PRIORITIES.QUALITY_REVIEW,

      actionable:
        true,

      reason:
        evaluator.reason,

      candidate:
        evaluator.recommendedUrl
          ? {
              url:
                evaluator.recommendedUrl,

              score:
                evaluator.score,

              grade:
                evaluator.grade
            }
          : null
    };
  }

  if (
    evaluatorClass
    === "DISCOVERY_DIAGNOSIS"
  ) {
    return {
      state:
        "DISCOVERY_DIAGNOSIS",

      priority:
        PRIORITIES
          .DISCOVERY_DIAGNOSIS,

      actionable:
        true,

      reason:
        evaluator.reason
    };
  }

  if (
    evaluatorClass
    === "CANONICAL_SOURCE_DISCOVERY"
  ) {
    return {
      state:
        "CANONICAL_SOURCE_DISCOVERY",

      priority:
        PRIORITIES
          .CANONICAL_SOURCE_DISCOVERY,

      actionable:
        true,

      reason:
        evaluator.reason
    };
  }

  if (
    evaluatorClass
    === "NO_CANDIDATE"
  ) {
    return {
      state:
        "NO_CANDIDATE_DISCOVERY",

      priority:
        PRIORITIES
          .NO_CANDIDATE_DISCOVERY,

      actionable:
        true,

      reason:
        evaluator.reason
    };
  }

  if (
    evaluatorClass
    === "SHARED_SOURCE_REVIEW"
  ) {
    return {
      state:
        "SHARED_SOURCE_REVIEW",

      priority:
        PRIORITIES
          .SHARED_SOURCE_REVIEW,

      actionable:
        true,

      reason:
        evaluator.reason,

      candidate:
        evaluator.recommendedUrl
          ? {
              url:
                evaluator.recommendedUrl
            }
          : null
    };
  }

  if (
    evaluatorClass
    === "SUCCESS_CANDIDATE"
  ) {
    return {
      state:
        "VALIDATE_DISCOVERED_CANDIDATE",

      priority:
        PRIORITIES
          .VALIDATE_DISCOVERED_CANDIDATE,

      actionable:
        true,

      reason:
        evaluator.reason,

      candidate:
        evaluator.recommendedUrl
          ? {
              url:
                evaluator.recommendedUrl,

              score:
                evaluator.score,

              grade:
                evaluator.grade
            }
          : null
    };
  }

  if (
    evaluatorClass
    === "NETWORK_REMAINS"
  ) {
    return {
      state:
        "DISCOVERY_DIAGNOSIS",

      priority:
        PRIORITIES
          .DISCOVERY_DIAGNOSIS,

      actionable:
        true,

      reason:
        evaluator.reason
        ||
        "네트워크 상태에 대한 추가 진단이 필요합니다."
    };
  }

  return {
    state:
      "DIAGNOSE_FIRST",

    priority:
      80,

    actionable:
      true,

    reason:
      evaluator?.reason
      ||
      "현재 상태를 기존 규칙으로 확정할 수 없어 추가 진단이 필요합니다."
  };
}

/* =========================================================
 * Recommended action
 * ========================================================= */

function actionFor(item) {
  switch (
    item.state
  ) {
    case "VALIDATE_DISCOVERED_CANDIDATE":
      return {
        action:
          "VALIDATE_CANDIDATE_SOURCE",

        description:
          "발견된 후보의 상세 URL, 제목, 날짜, 게시판 selector 안정성을 검증합니다."
      };

    case "VALIDATE_REVIEW_CANDIDATE":
      return {
        action:
          "DEEP_VALIDATE_REVIEW_CANDIDATE",

        description:
          "후보 페이지의 실제 게시물 링크 구조와 selector를 상세 분석합니다."
      };

    case "QUALITY_REVIEW":
      return {
        action:
          "REVALIDATE_SOURCE_QUALITY",

        description:
          "후보 source의 제목 안정성, 날짜, 상세 URL 및 selector를 다시 검증합니다."
      };

    case "DISCOVERY_DIAGNOSIS":
      return {
        action:
          "RUN_DISCOVERY_DIAGNOSIS",

        description:
          "접근 가능한 공식 홈페이지에서 공지·뉴스 source discovery를 실행합니다."
      };

    case "CANONICAL_SOURCE_DISCOVERY":
      return {
        action:
          "DISCOVER_CANONICAL_SOURCE",

        description:
          "공식 canonical URL 및 실제 공지·뉴스 진입점을 탐색합니다."
      };

    case "NO_CANDIDATE_DISCOVERY":
      return {
        action:
          "RUN_DEEP_DISCOVERY",

        description:
          "1단계 탐색에서 놓친 중간 메뉴 또는 2-hop 게시판 구조를 탐색합니다."
      };

    case "SHARED_SOURCE_REVIEW":
      return {
        action:
          "RESOLVE_SHARED_SOURCE_SCOPE",

        description:
          "공통 source인지 캠퍼스별 source인지 판별하고 중복 저장 정책을 결정합니다."
      };

    case "ENVIRONMENT_WAF_BLOCKED":
      return {
        action:
          "RETRY_IN_DIFFERENT_ENVIRONMENT",

        description:
          "현재 로컬 환경에서는 재요청하지 않고 다른 네트워크 또는 배포 환경에서 접근성을 재검증합니다."
      };

    case "RETRY_LATER":
      return {
        action:
          "WAIT_FOR_RETRY_WINDOW",

        description:
          "retryAfter 이전에는 네트워크 요청을 수행하지 않습니다."
      };

    case "RESOLVED":
      return {
        action:
          "NONE",

        description:
          "이미 해결된 항목입니다."
      };

    default:
      return {
        action:
          "DIAGNOSE_FIRST",

        description:
          "추가 진단 후 작업 유형을 결정합니다."
      };
  }
}

/* =========================================================
 * Main
 * ========================================================= */

function main() {
  const now =
    Date.now();

  const catalog =
    read(
      CATALOG_FILE,
      {
        universities: []
      }
    );

  const evaluation =
    read(
      EVALUATION_FILE,
      {
        evaluatedItems: []
      }
    );

  const discovery =
    read(
      DISCOVERY_FILE,
      {
        results: []
      }
    );

  const transient =
    read(
      TRANSIENT_FILE,
      {
        items: []
      }
    );

  const verifiedMap =
    buildVerifiedMap(
      catalog
    );

  const sharedVisibleMap =
    buildSharedVisibleMap(
      catalog
    );

  const discoveryMap =
    buildDiscoveryMap(
      discovery
    );

  const transientMap =
    buildTransientMap(
      transient
    );

  const evaluated = [];

  for (
    const row
    of evaluation.evaluatedItems || []
  ) {
    const universityId =
      key(
        row.universityId
      );

    const classification =
      classify({
        evaluator:
          row,

        discovery:
          discoveryMap.get(
            universityId
          ),

        transient:
          transientMap.get(
            universityId
          ),

        verified:
          verifiedMap.get(
            universityId
          ),

        sharedVisibleVerified:
          sharedVisibleMap.get(
            universityId
          ),

        now
      });

    const action =
      actionFor(
        classification
      );

    evaluated.push({
      universityId:
        row.universityId,

      universityName:
        row.universityName,

      previousEvaluatorClass:
        row.nextClass,

      evaluatorResolved:
        row.resolved === true,

      sourceResolutionMode:
        classification.sourceResolutionMode
        ||
        row.sourceResolutionMode
        ||
        null,

      effectiveVerifiedEnabledSourceCount:
        row.effectiveVerifiedEnabledSourceCount
        ??
        0,

      sharedVisibleVerifiedSourceCount:
        row.sharedVisibleVerifiedSourceCount
        ??
        0,

      latestDiscoveryStatus:
        discoveryMap.get(
          universityId
        )?.finalStatus
        || null,

      transientState:
        transientMap.get(
          universityId
        )?.currentClass
        || null,

      ...classification,

      ...action
    });
  }

  /*
   * 현재 즉시 수행 가능한 작업만 queue에 넣는다.
   *
   * ENVIRONMENT_WAF_BLOCKED는 actionable=false이므로
   * queue에서 자동 제외된다.
   */

  const actionable =
    evaluated
      .filter(
        item =>
          item.actionable
          === true
      )
      .sort(
        (a, b) =>
          a.priority
          -
          b.priority
          ||
          String(
            a.universityName
          ).localeCompare(
            String(
              b.universityName
            ),
            "ko"
          )
      );

  const nextAction =
    actionable[0]
    || null;

  const counts = {};

  for (
    const row
    of evaluated
  ) {
    counts[
      row.state
    ] =
      (
        counts[
          row.state
        ]
        || 0
      )
      + 1;
  }

  const resolvedCount =
    evaluated.filter(
      item =>
        item.state
        === "RESOLVED"
    ).length;

  const environmentBlockedCount =
    evaluated.filter(
      item =>
        item.state
        === "ENVIRONMENT_WAF_BLOCKED"
    ).length;

  const retryLaterCount =
    evaluated.filter(
      item =>
        item.state
        === "RETRY_LATER"
    ).length;

  const cooldownCount =
    evaluated.filter(
      item =>
        item.state
          === "RETRY_LATER"
        ||
        item.state
          === "ENVIRONMENT_WAF_BLOCKED"
    ).length;

  const report = {
    schemaVersion:
      "1.1",

    generatedAt:
      new Date()
        .toISOString(),

    planner:
      "UNI_PICK_AUTONOMOUS_NEXT_ACTION",

    counts,

    totalEvaluated:
      evaluated.length,

    actionableCount:
      actionable.length,

    resolvedCount,

    cooldownCount,

    environmentBlockedCount,

    retryLaterCount,

    nextAction,

    queue:
      actionable,

    evaluatedItems:
      evaluated,

    plannerPolicy: {
      evaluatorResolvedWins:
        true,

      verifiedSourceWins:
        true,

      sharedVisibleVerifiedSourceWins:
        true,

      sharedSourceCollectOnce:
        true,

      sharedSourceDuplicateStorage:
        false,

      environmentWafBlockedNonActionable:
        true,

      environmentWafBlockedCooldown:
        true,

      environmentWafRequiresDifferentEnvironment:
        true,

      transientCooldownWins:
        true,

      staleDiscoveryCannotOverrideResolved:
        true,

      staleDiscoveryCannotOverrideWafBlocked:
        true,

      latestDiscoveryOverridesOnlyUnresolvedActionableState:
        true,

      oneTaskAtATime:
        true,

      automaticProductionMutation:
        false
    },

    safety: {
      readOnly:
        true,

      networkRequests:
        0,

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

  atomic(
    OUTPUT_FILE,
    report
  );

  console.log(
    JSON.stringify(
      {
        counts:
          report.counts,

        resolved:
          report.resolvedCount,

        cooldown:
          report.cooldownCount,

        environmentBlocked:
          report.environmentBlockedCount,

        actionable:
          report.actionableCount,

        nextAction:
          report.nextAction
            ? {
                universityId:
                  report.nextAction.universityId,

                universityName:
                  report.nextAction.universityName,

                state:
                  report.nextAction.state,

                action:
                  report.nextAction.action,

                priority:
                  report.nextAction.priority,

                candidate:
                  report.nextAction.candidate
                  || null,

                reason:
                  report.nextAction.reason
              }
            : null,

        safety:
          report.safety
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
  require.main
  === module
) {
  try {
    main();
  } catch (
    error
  ) {
    console.error(
      error.stack
      ||
      error.message
    );

    process.exitCode =
      1;
  }
}

/* =========================================================
 * Export
 * ========================================================= */

module.exports = {
  key,
  timestamp,
  getUniversities,
  getSources,
  buildVerifiedMap,
  buildSharedVisibleMap,
  buildTransientMap,
  buildDiscoveryMap,
  cooldownState,
  classify,
  actionFor
};