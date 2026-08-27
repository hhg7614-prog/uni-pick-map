"use strict";

/**
 * UNI PICK
 * Next Batch Candidate Evaluator
 *
 * 목적
 * ------------------------------------------------------------
 * 1. uni-pick-next-batch-safe-discovery.json 결과를 읽는다.
 * 2. CANDIDATE_DISCOVERED 후보를 활성화 검증 대상으로 분류한다.
 * 3. HOMEPAGE_IDENTITY_REVIEW는 별도 신원 검증 큐로 보낸다.
 * 4. NO_CANDIDATE는 DEEP_DISCOVERY 대상으로 보낸다.
 * 5. 기존 verified + enabled source가 있으면 RESOLVED 처리한다.
 * 6. source/store/preview/catalog/git/deploy는 절대 수정하지 않는다.
 *
 * 안전 정책
 * ------------------------------------------------------------
 * - read only
 * - network request 없음
 * - catalog mutation 없음
 * - automatic activation 없음
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

const DISCOVERY_FILE = path.join(
  DATA,
  "uni-pick-next-batch-safe-discovery.json"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-next-batch-candidate-evaluation.json"
);

/* ============================================================
 * 기본 설정
 * ============================================================ */

const POLICY = {
  minActivationValidationScore: 150,
  minReviewValidationScore: 110,

  minDateCount: 3,

  requireOfficialDomain: true,
  requireReachable: true,

  automaticActivation: false,
  automaticMutation: false
};

/* ============================================================
 * JSON
 * ============================================================ */

function readJson(
  file,
  fallback = null
) {
  try {
    return JSON.parse(
      fs
        .readFileSync(
          file,
          "utf8"
        )
        .replace(
          /^\uFEFF/,
          ""
        )
    );
  } catch {
    return fallback;
  }
}

function atomicWrite(
  file,
  value
) {
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

/* ============================================================
 * Normalize
 * ============================================================ */

function normalizeId(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .trim();
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value)
      );

    url.hash = "";

    return url.href;
  } catch {
    return String(
      value
    ).trim();
  }
}

/* ============================================================
 * Discovery 구조 호환
 *
 * 이전 스크립트에서는 results,
 * 일부 출력에서는 universities를 사용했으므로 둘 다 지원
 * ============================================================ */

function getDiscoveryResults(
  discovery
) {
  if (!discovery) {
    return [];
  }

  if (
    Array.isArray(
      discovery.results
    )
  ) {
    return discovery.results;
  }

  if (
    Array.isArray(
      discovery.universities
    )
  ) {
    return discovery.universities;
  }

  if (
    Array.isArray(
      discovery.items
    )
  ) {
    return discovery.items;
  }

  return [];
}

/* ============================================================
 * Catalog
 * ============================================================ */

function getCatalogUniversities(
  catalog
) {
  if (!catalog) {
    return [];
  }

  if (
    Array.isArray(catalog)
  ) {
    return catalog;
  }

  if (
    Array.isArray(
      catalog.universities
    )
  ) {
    return catalog.universities;
  }

  if (
    Array.isArray(
      catalog.items
    )
  ) {
    return catalog.items;
  }

  return [];
}

function buildCatalogMap(
  catalog
) {
  const map =
    new Map();

  for (
    const university
    of getCatalogUniversities(
      catalog
    )
  ) {
    if (
      !university
      ||
      !university.universityId
    ) {
      continue;
    }

    map.set(
      normalizeId(
        university.universityId
      ),
      university
    );
  }

  return map;
}

function getSources(
  university
) {
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

function getVerifiedEnabledSources(
  university
) {
  return getSources(
    university
  ).filter(
    source =>
      source?.verified === true
      &&
      source?.enabled === true
  );
}

/* ============================================================
 * SHARED_SOURCE 검색
 *
 * canonical owner에만 저장되어 있어도
 * visibleToCampuses에 현재 대학이 있으면
 * effective verified source로 간주
 * ============================================================ */

function findSharedVisibleSources(
  catalog,
  universityId
) {
  const targetId =
    normalizeId(
      universityId
    );

  const matches = [];

  for (
    const university
    of getCatalogUniversities(
      catalog
    )
  ) {
    for (
      const source
      of getSources(
        university
      )
    ) {
      if (
        source?.verified !== true
        ||
        source?.enabled !== true
      ) {
        continue;
      }

      if (
        source?.campusScope
        !== "SHARED_SOURCE"
      ) {
        continue;
      }

      const visible =
        Array.isArray(
          source.visibleToCampuses
        )
          ? source.visibleToCampuses
          : [];

      if (
        visible.some(
          id =>
            normalizeId(id)
            === targetId
        )
      ) {
        matches.push({
          ownerUniversityId:
            university.universityId,

          source
        });
      }
    }
  }

  return matches;
}

/* ============================================================
 * Discovery row normalize
 * ============================================================ */

function normalizeDiscoveryRow(
  row
) {
  const homepage =
    row?.homepage
    || null;

  const best =
    row?.bestCandidate
    || null;

  return {
    raw:
      row,

    order:
      Number(
        row?.order
        ?? 0
      ),

    universityId:
      row?.universityId
      || null,

    universityName:
      row?.universityName
      || null,

    discoveryStatus:
      row?.status
      || row?.finalStatus
      || null,

    homepageStatus:
      homepage?.status
      ?? row?.homepageStatus
      ?? null,

    finalHomepage:
      homepage?.finalUrl
      || row?.finalHomepage
      || null,

    identityVerified:
      row?.identityVerified
      === true,

    candidateCount:
      Number(
        row?.candidateCount
        ?? (
          Array.isArray(
            row?.candidates
          )
            ? row.candidates.length
            : 0
        )
      ),

    bestCandidate:
      best
        ? {
            text:
              best.text
              || null,

            url:
              normalizeUrl(
                best.url
              ),

            finalUrl:
              normalizeUrl(
                best.finalUrl
                || best.url
              ),

            score:
              Number(
                best.score
                ?? 0
              ),

            validationScore:
              Number(
                best.validationScore
                ?? best.score
                ?? 0
              ),

            reachable:
              best.reachable
              === true,

            officialDomain:
              best.officialDomain
              === true,

            dateCount:
              Number(
                best.dateCount
                ?? 0
              ),

            uniqueDateCount:
              Number(
                best.uniqueDateCount
                ?? 0
              ),

            titleLikeAnchorCount:
              Number(
                best.titleLikeAnchorCount
                ?? 0
              ),

            contentSignalCount:
              Number(
                best.contentSignalCount
                ?? 0
              ),

            error:
              best.error
              || null
          }
        : null
  };
}

/* ============================================================
 * 후보 품질 평가
 * ============================================================ */

function evaluateCandidateQuality(
  row
) {
  const candidate =
    row.bestCandidate;

  if (!candidate) {
    return {
      pass:
        false,

      review:
        false,

      reasons: [
        "BEST_CANDIDATE_MISSING"
      ]
    };
  }

  const reasons = [];

  if (
    POLICY.requireReachable
    &&
    candidate.reachable
    !== true
  ) {
    reasons.push(
      "CANDIDATE_NOT_REACHABLE"
    );
  }

  if (
    POLICY.requireOfficialDomain
    &&
    candidate.officialDomain
    !== true
  ) {
    reasons.push(
      "CANDIDATE_NOT_OFFICIAL_DOMAIN"
    );
  }

  if (
    candidate.validationScore
    <
    POLICY.minReviewValidationScore
  ) {
    reasons.push(
      "VALIDATION_SCORE_TOO_LOW"
    );
  }

  if (
    candidate.dateCount
    <
    POLICY.minDateCount
  ) {
    reasons.push(
      "DATE_SIGNAL_TOO_WEAK"
    );
  }

  const hardFailure =
    reasons.includes(
      "CANDIDATE_NOT_REACHABLE"
    )
    ||
    reasons.includes(
      "CANDIDATE_NOT_OFFICIAL_DOMAIN"
    );

  const pass =
    !hardFailure
    &&
    candidate.validationScore
      >=
      POLICY.minActivationValidationScore
    &&
    candidate.dateCount
      >=
      POLICY.minDateCount;

  const review =
    !pass
    &&
    !hardFailure
    &&
    candidate.validationScore
      >=
      POLICY.minReviewValidationScore;

  return {
    pass,
    review,
    reasons
  };
}

/* ============================================================
 * 후보 유형 추정
 * ============================================================ */

function inferCandidateType(
  candidate
) {
  if (!candidate) {
    return "UNKNOWN";
  }

  const combined =
    `${
      candidate.text || ""
    } ${
      candidate.url || ""
    }`
      .toLowerCase();

  if (
    combined.includes(
      "notice"
    )
    ||
    combined.includes(
      "공지"
    )
  ) {
    return "NOTICE_BOARD";
  }

  if (
    combined.includes(
      "news"
    )
    ||
    combined.includes(
      "소식"
    )
  ) {
    return "NEWS_BOARD";
  }

  if (
    combined.includes(
      "board"
    )
    ||
    combined.includes(
      "bbs"
    )
  ) {
    return "GENERIC_BOARD";
  }

  return "UNKNOWN_BOARD";
}

/* ============================================================
 * 핵심 분류
 * ============================================================ */

function classifyRow({
  row,
  catalog,
  catalogUniversity
}) {
  const directVerified =
    getVerifiedEnabledSources(
      catalogUniversity
    );

  const sharedVisible =
    findSharedVisibleSources(
      catalog,
      row.universityId
    );

  /*
   * 1. 기존 source가 있으면 최우선 RESOLVED
   */

  if (
    directVerified.length > 0
  ) {
    return {
      state:
        "RESOLVED",

      actionable:
        false,

      priority:
        100,

      reason:
        "이미 해당 대학에 verified=true, enabled=true source가 존재합니다.",

      sourceResolutionMode:
        "DIRECT_SOURCE",

      verifiedSources:
        directVerified.map(
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
              || null
          })
        )
    };
  }

  /*
   * 2. SHARED_SOURCE visible 대상이면 RESOLVED
   */

  if (
    sharedVisible.length > 0
  ) {
    return {
      state:
        "RESOLVED",

      actionable:
        false,

      priority:
        100,

      reason:
        "canonical owner에 저장된 verified SHARED_SOURCE의 visibleToCampuses에 포함되어 있습니다.",

      sourceResolutionMode:
        "SHARED_SOURCE_VISIBLE",

      verifiedSources:
        sharedVisible.map(
          item => ({
            sourceId:
              item.source.id
              || item.source.sourceId
              || null,

            listUrl:
              item.source.listUrl
              || null,

            category:
              item.source.category
              || null,

            campusScope:
              item.source.campusScope
              || null,

            canonicalOwner:
              item.source.canonicalOwner
              || item.ownerUniversityId
          })
        )
    };
  }

  /*
   * 3. 홈페이지 신원 검토
   */

  if (
    row.discoveryStatus
    === "HOMEPAGE_IDENTITY_REVIEW"
  ) {
    return {
      state:
        "IDENTITY_REVIEW",

      actionable:
        true,

      priority:
        10,

      reason:
        "공식 홈페이지 응답은 존재하지만 대학명 신원 검증이 완료되지 않았습니다.",

      sourceResolutionMode:
        null,

      verifiedSources:
        []
    };
  }

  /*
   * 4. 후보 없음
   */

  if (
    row.discoveryStatus
    === "NO_CANDIDATE"
  ) {
    return {
      state:
        "DEEP_DISCOVERY",

      actionable:
        true,

      priority:
        40,

      reason:
        "공식 홈페이지 접근은 가능하지만 1차 탐색에서 공지/뉴스 source 후보를 찾지 못했습니다.",

      sourceResolutionMode:
        null,

      verifiedSources:
        []
    };
  }

  /*
   * 5. 시작 URL 없음
   */

  if (
    row.discoveryStatus
    === "NO_START_URL"
  ) {
    return {
      state:
        "RESOLVE_OFFICIAL_DOMAIN",

      actionable:
        true,

      priority:
        20,

      reason:
        "공식 홈페이지 시작 URL이 없어 먼저 공식 도메인을 확정해야 합니다.",

      sourceResolutionMode:
        null,

      verifiedSources:
        []
    };
  }

  /*
   * 6. 홈페이지 fetch 실패
   */

  if (
    row.discoveryStatus
    === "HOMEPAGE_FETCH_FAILED"
  ) {
    return {
      state:
        "NETWORK_REVIEW",

      actionable:
        true,

      priority:
        30,

      reason:
        "공식 홈페이지 요청이 실패하여 네트워크 또는 canonical URL 재검증이 필요합니다.",

      sourceResolutionMode:
        null,

      verifiedSources:
        []
    };
  }

  /*
   * 7. 후보 발견
   */

  if (
    row.discoveryStatus
    === "CANDIDATE_DISCOVERED"
    ||
    row.discoveryStatus
    === "REVIEW_CANDIDATE"
  ) {
    const quality =
      evaluateCandidateQuality(
        row
      );

    if (quality.pass) {
      return {
        state:
          "VALIDATE_ACTIVATION_CANDIDATE",

        actionable:
          true,

        priority:
          5,

        reason:
          "공식 도메인, 접근성, 날짜 신호, validationScore 기준을 통과하여 collector 구조 검증 대상으로 선정합니다.",

        sourceResolutionMode:
          null,

        verifiedSources:
          [],

        quality
      };
    }

    if (quality.review) {
      return {
        state:
          "QUALITY_REVIEW",

        actionable:
          true,

        priority:
          15,

        reason:
          "후보는 유효하지만 자동 활성화 검증 대상으로 바로 넘기기 전에 게시판 성격과 selector 안정성을 추가 확인해야 합니다.",

        sourceResolutionMode:
          null,

        verifiedSources:
          [],

        quality
      };
    }

    return {
      state:
        "CANDIDATE_REJECTED",

      actionable:
        true,

      priority:
        35,

      reason:
        `후보 품질 기준을 충족하지 못했습니다: ${
          quality.reasons.join(
            ", "
          )
        }`,

      sourceResolutionMode:
        null,

      verifiedSources:
        [],

      quality
    };
  }

  return {
    state:
      "DIAGNOSE_FIRST",

    actionable:
      true,

    priority:
      50,

    reason:
      "현재 discovery 상태를 기존 평가 규칙으로 확정할 수 없습니다.",

    sourceResolutionMode:
      null,

    verifiedSources:
      []
  };
}

/* ============================================================
 * Action
 * ============================================================ */

function actionFor(
  state
) {
  switch (state) {
    case "VALIDATE_ACTIVATION_CANDIDATE":
      return {
        action:
          "VERIFY_CANDIDATE_COLLECTOR",

        description:
          "목록 행, 제목, 날짜, 상세 URL, dedupe key를 실제 HTML 기준으로 검증합니다."
      };

    case "IDENTITY_REVIEW":
      return {
        action:
          "VERIFY_HOMEPAGE_IDENTITY",

        description:
          "공식 대학 홈페이지 여부를 별도로 검증합니다."
      };

    case "QUALITY_REVIEW":
      return {
        action:
          "REVIEW_CANDIDATE_QUALITY",

        description:
          "후보 게시판이 일반 대학 공지/뉴스 source로 적합한지 확인합니다."
      };

    case "DEEP_DISCOVERY":
      return {
        action:
          "RUN_DEEP_DISCOVERY",

        description:
          "홈페이지 내부 2-hop 메뉴와 게시판 진입점을 추가 탐색합니다."
      };

    case "RESOLVE_OFFICIAL_DOMAIN":
      return {
        action:
          "RESOLVE_OFFICIAL_DOMAIN",

        description:
          "대학 공식 도메인과 canonical 홈페이지 URL을 확정합니다."
      };

    case "NETWORK_REVIEW":
      return {
        action:
          "REVIEW_NETWORK_ACCESS",

        description:
          "TLS, redirect, WAF, canonical URL 상태를 진단합니다."
      };

    case "CANDIDATE_REJECTED":
      return {
        action:
          "RUN_DEEP_DISCOVERY",

        description:
          "현재 후보 대신 더 적합한 공식 게시판 후보를 다시 탐색합니다."
      };

    case "RESOLVED":
      return {
        action:
          "NONE",

        description:
          "이미 검증된 source로 해결된 대학입니다."
      };

    default:
      return {
        action:
          "DIAGNOSE_FIRST",

        description:
          "추가 진단 후 다음 작업 유형을 결정합니다."
      };
  }
}

/* ============================================================
 * Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      DISCOVERY_FILE
    )
  ) {
    throw new Error(
      "NEXT_BATCH_SAFE_DISCOVERY_FILE_NOT_FOUND"
    );
  }

  if (
    !fs.existsSync(
      CATALOG_FILE
    )
  ) {
    throw new Error(
      "CATALOG_FILE_NOT_FOUND"
    );
  }

  const discovery =
    readJson(
      DISCOVERY_FILE
    );

  const catalog =
    readJson(
      CATALOG_FILE,
      {
        universities: []
      }
    );

  const rawResults =
    getDiscoveryResults(
      discovery
    );

  const catalogMap =
    buildCatalogMap(
      catalog
    );

  const evaluated = [];

  for (
    const rawRow
    of rawResults
  ) {
    const row =
      normalizeDiscoveryRow(
        rawRow
      );

    const universityId =
      normalizeId(
        row.universityId
      );

    const catalogUniversity =
      catalogMap.get(
        universityId
      )
      || null;

    const classification =
      classifyRow({
        row,
        catalog,
        catalogUniversity
      });

    const action =
      actionFor(
        classification.state
      );

    evaluated.push({
      order:
        row.order,

      universityId:
        row.universityId,

      universityName:
        row.universityName,

      discoveryStatus:
        row.discoveryStatus,

      homepageStatus:
        row.homepageStatus,

      finalHomepage:
        row.finalHomepage,

      identityVerified:
        row.identityVerified,

      candidateCount:
        row.candidateCount,

      catalogFound:
        Boolean(
          catalogUniversity
        ),

      catalogSourceCount:
        getSources(
          catalogUniversity
        ).length,

      sourceResolutionMode:
        classification.sourceResolutionMode
        || null,

      state:
        classification.state,

      priority:
        classification.priority,

      actionable:
        classification.actionable,

      action:
        action.action,

      description:
        action.description,

      reason:
        classification.reason,

      candidateType:
        inferCandidateType(
          row.bestCandidate
        ),

      bestCandidate:
        row.bestCandidate,

      quality:
        classification.quality
        || null,

      verifiedSources:
        classification.verifiedSources
        || []
    });
  }

  const actionable =
    evaluated
      .filter(
        item =>
          item.actionable === true
      )
      .sort(
        (a, b) =>
          a.priority
          -
          b.priority
          ||
          a.order
          -
          b.order
      );

  const counts = {};

  for (
    const item
    of evaluated
  ) {
    counts[
      item.state
    ] =
      (
        counts[
          item.state
        ]
        || 0
      )
      + 1;
  }

  const nextAction =
    actionable[0]
    || null;

  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    decision:
      "NEXT_BATCH_CANDIDATES_EVALUATED",

    sourceDiscovery:
      path.basename(
        DISCOVERY_FILE
      ),

    sourceCatalog:
      path.basename(
        CATALOG_FILE
      ),

    processed:
      evaluated.length,

    counts,

    actionable:
      actionable.length,

    resolved:
      evaluated.filter(
        item =>
          item.state
          === "RESOLVED"
      ).length,

    nextAction:
      nextAction
        ? {
            universityId:
              nextAction.universityId,

            universityName:
              nextAction.universityName,

            state:
              nextAction.state,

            action:
              nextAction.action,

            priority:
              nextAction.priority,

            candidate:
              nextAction.bestCandidate,

            reason:
              nextAction.reason
          }
        : null,

    queue:
      actionable.map(
        item => ({
          order:
            item.order,

          universityId:
            item.universityId,

          universityName:
            item.universityName,

          state:
            item.state,

          action:
            item.action,

          priority:
            item.priority,

          candidateType:
            item.candidateType,

          candidate:
            item.bestCandidate
        })
      ),

    evaluatedItems:
      evaluated,

    evaluatorPolicy: {
      verifiedSourceWins:
        true,

      sharedVisibleSourceWins:
        true,

      minActivationValidationScore:
        POLICY.minActivationValidationScore,

      minReviewValidationScore:
        POLICY.minReviewValidationScore,

      requireOfficialDomain:
        POLICY.requireOfficialDomain,

      requireReachable:
        POLICY.requireReachable,

      automaticActivation:
        false,

      automaticMutation:
        false
    },

    safety: {
      readOnly:
        true,

      networkRequests:
        0,

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

  atomicWrite(
    OUTPUT_FILE,
    report
  );

  console.log(
    JSON.stringify(
      {
        decision:
          report.decision,

        processed:
          report.processed,

        counts:
          report.counts,

        actionable:
          report.actionable,

        resolved:
          report.resolved,

        nextAction:
          report.nextAction,

        outputFile:
          OUTPUT_FILE,

        safety:
          report.safety
      },
      null,
      2
    )
  );
}

/* ============================================================
 * Execute
 * ============================================================ */

if (
  require.main === module
) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status:
            "FATAL",

          error: {
            name:
              error.name,

            message:
              error.message
          }
        },
        null,
        2
      )
    );

    process.exitCode =
      1;
  }
}