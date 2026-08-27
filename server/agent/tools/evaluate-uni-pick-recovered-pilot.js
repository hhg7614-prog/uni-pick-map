"use strict";

/**
 * UNI PICK
 * Recovered Pilot Evaluator
 *
 * 주요 정책
 * ------------------------------------------------------------
 * 1. verified=true + enabled=true source가 있으면 최우선 RESOLVED
 * 2. SHARED_SOURCE의 visibleToCampuses에 현재 대학이 포함되면
 *    직접 source가 없어도 기존 verified source를 사용하는 것으로 RESOLVED
 * 3. ENVIRONMENT_WAF_BLOCKED는 NO_CANDIDATE보다 우선
 * 4. HTTP_REACHABLE은 discovery 단계로 이동
 * 5. redirect / hostname mismatch는 canonical source discovery
 * 6. 후보 없음은 NO_CANDIDATE
 * 7. REVIEW 후보는 QUALITY_REVIEW
 * 8. SUCCESS 후보 중 동일 URL이 여러 캠퍼스에 걸리면 SHARED_SOURCE_REVIEW
 * 9. 이미 활성화된 SHARED_SOURCE가 있으면 shared conflict를 다시 만들지 않음
 * 10. 자동 source 변경 / 활성화 / 배포 / git 없음
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");

const DATA = path.join(
  ROOT,
  "server",
  "agent",
  "data"
);

const PILOT_FILE = path.join(
  DATA,
  "uni-pick-safe-pilot-result.json"
);

const NETWORK_FILE = path.join(
  DATA,
  "uni-pick-network-subtypes.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-recovered-pilot-evaluation.json"
);

const CATALOG_CANDIDATES = [
  path.join(
    ROOT,
    "development",
    "university-news",
    "data",
    "university-news-sources.final.json"
  ),
  path.join(
    DATA,
    "university-news-sources.final.json"
  )
];

/* ============================================================
 * 1. 기본 Utility
 * ============================================================ */

function readJson(file, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const temp =
    `${file}.${process.pid}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  JSON.parse(
    fs.readFileSync(temp, "utf8")
  );

  fs.renameSync(
    temp,
    file
  );
}

function normalizeId(value) {
  return String(value || "")
    .normalize("NFC");
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
    return String(value);
  }
}

function firstExistingFile(files) {
  return (
    files.find(
      file =>
        fs.existsSync(file)
    )
    || null
  );
}

/* ============================================================
 * 2. 여러 JSON 형태를 배열로 정규화
 * ============================================================ */

function extractArray(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  const keys = [
    "items",
    "results",
    "universities",
    "evaluatedItems",
    "pilotItems",
    "rows"
  ];

  for (
    const key
    of keys
  ) {
    if (
      Array.isArray(
        data[key]
      )
    ) {
      return data[key];
    }
  }

  return [];
}

/* ============================================================
 * 3. Network Map
 * ============================================================ */

function buildNetworkMap(
  networkState
) {
  const map =
    new Map();

  for (
    const item
    of extractArray(
      networkState
    )
  ) {
    if (
      !item?.universityId
    ) {
      continue;
    }

    map.set(
      normalizeId(
        item.universityId
      ),
      item
    );
  }

  return map;
}

/* ============================================================
 * 4. Catalog
 * ============================================================ */

function normalizeCatalogUniversities(
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

  if (
    typeof catalog
    === "object"
  ) {
    return Object.values(
      catalog
    )
      .filter(
        item =>
          item
          &&
          typeof item
            === "object"
          &&
          item.universityId
      );
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
    of normalizeCatalogUniversities(
      catalog
    )
  ) {
    if (
      !university?.universityId
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
  )
    .filter(
      source =>
        source?.verified
          === true
        &&
        source?.enabled
          === true
    );
}

function getUnverifiedSources(
  university
) {
  return getSources(
    university
  )
    .filter(
      source =>
        !(
          source?.verified
            === true
          &&
          source?.enabled
            === true
        )
    );
}

/* ============================================================
 * 5. Shared Source Index
 *
 * 중요:
 * source는 canonicalOwner 쪽에 한 번만 저장한다.
 * visibleToCampuses에 포함된 캠퍼스는
 * 직접 sources가 없어도 이 source를 사용 가능하다.
 * ============================================================ */

function buildSharedSourceVisibilityMap(
  catalog
) {
  const map =
    new Map();

  const universities =
    normalizeCatalogUniversities(
      catalog
    );

  for (
    const ownerUniversity
    of universities
  ) {
    const ownerId =
      normalizeId(
        ownerUniversity?.universityId
      );

    if (!ownerId) {
      continue;
    }

    for (
      const source
      of getVerifiedEnabledSources(
        ownerUniversity
      )
    ) {
      if (
        source?.campusScope
          !== "SHARED_SOURCE"
      ) {
        continue;
      }

      const canonicalOwner =
        normalizeId(
          source.canonicalOwner
          ||
          ownerId
        );

      const visibleToCampuses =
        Array.isArray(
          source.visibleToCampuses
        )
          ? source.visibleToCampuses
          : [];

      const visibleIds =
        new Set(
          [
            canonicalOwner,
            ownerId,
            ...visibleToCampuses
          ]
            .filter(Boolean)
            .map(
              normalizeId
            )
        );

      for (
        const visibleId
        of visibleIds
      ) {
        if (
          !map.has(
            visibleId
          )
        ) {
          map.set(
            visibleId,
            []
          );
        }

        map.get(
          visibleId
        )
          .push({
            source,
            ownerUniversityId:
              ownerId,
            canonicalOwner
          });
      }
    }
  }

  return map;
}

function getSharedVerifiedEnabledSources(
  universityId,
  sharedSourceMap
) {
  const id =
    normalizeId(
      universityId
    );

  if (!id) {
    return [];
  }

  return (
    sharedSourceMap.get(id)
    || []
  );
}

function buildEffectiveVerifiedSources({
  universityId,
  university,
  sharedSourceMap
}) {
  const directSources =
    getVerifiedEnabledSources(
      university
    )
      .map(
        source => ({
          source,
          sourceAccess:
            "DIRECT",
          ownerUniversityId:
            normalizeId(
              universityId
            )
        })
      );

  const sharedSources =
    getSharedVerifiedEnabledSources(
      universityId,
      sharedSourceMap
    )
      .map(
        entry => ({
          source:
            entry.source,
          sourceAccess:
            normalizeId(
              entry.ownerUniversityId
            )
            ===
            normalizeId(
              universityId
            )
              ? "DIRECT_SHARED_OWNER"
              : "SHARED_VISIBLE",
          ownerUniversityId:
            entry.ownerUniversityId,
          canonicalOwner:
            entry.canonicalOwner
        })
      );

  const merged =
    new Map();

  for (
    const entry
    of [
      ...directSources,
      ...sharedSources
    ]
  ) {
    const source =
      entry.source;

    const key =
      source?.id
      ||
      source?.sourceId
      ||
      normalizeUrl(
        source?.listUrl
      )
      ||
      JSON.stringify(
        source
      );

    if (
      !merged.has(key)
    ) {
      merged.set(
        key,
        entry
      );
    }
  }

  return [
    ...merged.values()
  ];
}

/* ============================================================
 * 6. Pilot row normalizer
 * ============================================================ */

function normalizePilotRow(
  row
) {
  return {
    ...row,

    universityId:
      row.universityId
      ||
      row.id
      ||
      null,

    universityName:
      row.universityName
      ||
      row.name
      ||
      null,

    previousReason:
      row.previousReason
      ||
      row.reason
      ||
      null,

    finalStatus:
      row.finalStatus
      ||
      row.status
      ||
      null,

    recoveredFromNetwork:
      row.recoveredFromNetwork
      === true,

    homepageStatus:
      row.homepageStatus
      ?? null,

    candidateCount:
      Number(
        row.candidateCount
        ??
        row.candidates
        ??
        0
      ),

    score:
      Number(
        row.score
        ??
        0
      ),

    grade:
      row.grade
      ||
      null,

    recommendedUrl:
      row.recommendedUrl
      ||
      row.best?.url
      ||
      null
  };
}

/* ============================================================
 * 7. Classification
 * ============================================================ */

function classifyRow({
  row,
  networkItem,
  university,
  effectiveVerifiedSources
}) {
  const verifiedSources =
    effectiveVerifiedSources;

  const unverifiedSources =
    getUnverifiedSources(
      university
    );

  /*
   * A. 기존 verified source 또는
   *    shared visible verified source가 있으면 최우선 RESOLVED
   */

  if (
    verifiedSources.length
      > 0
  ) {
    const hasSharedVisible =
      verifiedSources.some(
        entry =>
          entry.sourceAccess
          === "SHARED_VISIBLE"
      );

    return {
      nextClass:
        "RESOLVED_BY_EXISTING_VERIFIED_SOURCE",

      reason:
        hasSharedVisible
          ? "현재 대학은 canonical owner에 저장된 verified=true, enabled=true SHARED_SOURCE의 visibleToCampuses에 포함되어 기존 검증 source를 공동 사용합니다."
          : "이미 verified=true, enabled=true인 공식 source가 존재하므로 기존 검증 source를 사용합니다.",

      autoActivate:
        false,

      resolved:
        true,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        null
    };
  }

  /*
   * B. 현재 환경 WAF 차단
   *
   * NO_CANDIDATE보다 반드시 먼저 판단한다.
   */

  const wafBlocked =
    networkItem?.networkSubtype
      ===
      "ENVIRONMENT_WAF_BLOCKED"
    ||
    networkItem?.subtype
      ===
      "ENVIRONMENT_WAF_BLOCKED"
    ||
    networkItem?.networkNextClass
      ===
      "RETRY_IN_DIFFERENT_ENVIRONMENT"
    ||
    networkItem?.nextClass
      ===
      "ENVIRONMENT_WAF_BLOCKED"
    ||
    networkItem?.nextAction
      ===
      "RETRY_IN_DIFFERENT_ENVIRONMENT"
    ||
    networkItem?.localDiscoveryBlocked
      === true
    ||
    networkItem?.evidence?.wafBlocked
      === true;

  if (
    wafBlocked
  ) {
    return {
      nextClass:
        "ENVIRONMENT_WAF_BLOCKED",

      reason:
        networkItem?.reason
        ||
        "공식 source는 존재할 가능성이 있으나 현재 실행 환경에서 웹방화벽 정책에 의해 접근이 차단되어 다른 네트워크 또는 배포 환경에서 재검증해야 합니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        true,

      retryable:
        true,

      nextAction:
        "RETRY_IN_DIFFERENT_ENVIRONMENT"
    };
  }

  /*
   * C. HTTP 접근 가능
   */

  if (
    networkItem?.networkSubtype
      ===
      "HTTP_REACHABLE"
    ||
    networkItem?.subtype
      ===
      "HTTP_REACHABLE"
  ) {
    return {
      nextClass:
        "DISCOVERY_DIAGNOSIS",

      reason:
        "최신 저수준 진단에서 HTTP 접근이 확인되어 NETWORK_FETCH 단계에서 제외하고 공식 공지/뉴스 후보 탐색 단계로 이동합니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        "RUN_DISCOVERY_DIAGNOSIS"
    };
  }

  /*
   * D. Canonical URL 문제
   */

  const networkSubtype =
    networkItem?.networkSubtype
    ||
    networkItem?.subtype
    ||
    null;

  const networkNextClass =
    networkItem?.networkNextClass
    ||
    networkItem?.nextClass
    ||
    null;

  if (
    networkSubtype
      === "REDIRECT_LOOP"
    ||
    networkSubtype
      === "TLS_HOSTNAME_MISMATCH"
    ||
    networkNextClass
      === "CANONICAL_URL_RECHECK"
  ) {
    return {
      nextClass:
        "CANONICAL_SOURCE_DISCOVERY",

      reason:
        "현재 공식 홈페이지 후보 URL이 canonical 진입점으로 적합하지 않아 올바른 공식 source URL 탐색이 필요합니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        "DISCOVER_CANONICAL_SOURCE"
    };
  }

  /*
   * E. 네트워크 자체가 아직 복구되지 않음
   */

  if (
    row.recoveredFromNetwork
      !== true
  ) {
    return {
      nextClass:
        "NETWORK_REMAINS",

      reason:
        "최신 진단에서도 네트워크 접근 자체가 복구되지 않았습니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        true,

      nextAction:
        "RETRY_NETWORK_DIAGNOSIS"
    };
  }

  /*
   * F. HTTP 접근은 복구됐지만 후보가 없음
   */

  if (
    Number(
      row.candidateCount
      || 0
    )
    === 0
  ) {
    return {
      nextClass:
        "NO_CANDIDATE",

      reason:
        "HTTP 접근은 복구됐지만 공식 공지/뉴스 후보를 발견하지 못했습니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        "RUN_DEEP_DISCOVERY"
    };
  }

  /*
   * G. REVIEW 후보
   */

  if (
    row.finalStatus
      === "REVIEW"
  ) {
    return {
      nextClass:
        "QUALITY_REVIEW",

      reason:
        "후보 source는 발견했지만 품질 점수 또는 selector 안정성 기준을 통과하지 못했습니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        "REVALIDATE_SOURCE_QUALITY"
    };
  }

  /*
   * H. SUCCESS 후보
   */

  if (
    row.finalStatus
      === "SUCCESS"
  ) {
    return {
      nextClass:
        "SUCCESS_CANDIDATE",

      reason:
        "진단 기준상 성공 후보이지만 campus/source scope 검증 후 활성화해야 합니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        "VALIDATE_SUCCESS_CANDIDATE"
    };
  }

  /*
   * I. Catalog source 자체가 없는 경우
   */

  if (
    verifiedSources.length
      === 0
    &&
    unverifiedSources.length
      === 0
  ) {
    return {
      nextClass:
        "CANONICAL_SOURCE_DISCOVERY",

      reason:
        "Catalog에 source 후보가 없어 공식 source discovery가 필요합니다.",

      autoActivate:
        false,

      resolved:
        false,

      cooldown:
        false,

      retryable:
        false,

      nextAction:
        "DISCOVER_CANONICAL_SOURCE"
    };
  }

  return {
    nextClass:
      "DIAGNOSE_FIRST",

    reason:
      "현재 정보만으로 다음 상태를 확정할 수 없어 추가 진단이 필요합니다.",

    autoActivate:
      false,

    resolved:
      false,

    cooldown:
      false,

    retryable:
      false,

    nextAction:
      "DIAGNOSE_FIRST"
  };
}

/* ============================================================
 * 8. Shared Source Conflict
 *
 * 이미 verified source 또는 shared visible source로
 * RESOLVED 된 대학은 conflict 후보에서 제외한다.
 * ============================================================ */

function findSharedSourceConflicts(
  evaluated
) {
  const map =
    new Map();

  for (
    const row
    of evaluated
  ) {
    if (
      row.nextClass
        !== "SUCCESS_CANDIDATE"
      ||
      !row.recommendedUrl
    ) {
      continue;
    }

    const url =
      normalizeUrl(
        row.recommendedUrl
      );

    if (!url) {
      continue;
    }

    if (
      !map.has(url)
    ) {
      map.set(
        url,
        []
      );
    }

    map.get(url)
      .push(row);
  }

  const conflicts = [];

  for (
    const [url, rows]
    of map.entries()
  ) {
    const universityIds =
      [
        ...new Set(
          rows.map(
            row =>
              normalizeId(
                row.universityId
              )
          )
        )
      ];

    if (
      universityIds.length
        < 2
    ) {
      continue;
    }

    conflicts.push({
      url,

      count:
        rows.length,

      universityIds:
        rows.map(
          row =>
            row.universityId
        ),

      universityNames:
        rows.map(
          row =>
            row.universityName
        ),

      classification:
        "SHARED_SOURCE_REVIEW",

      autoActivate:
        false,

      reason:
        "동일 후보 URL이 여러 캠퍼스의 성공 후보로 탐지되어 source scope 확인이 필요합니다."
    });
  }

  return conflicts;
}

function applySharedSourceConflicts(
  evaluated,
  conflicts
) {
  const ids =
    new Set();

  for (
    const conflict
    of conflicts
  ) {
    for (
      const universityId
      of conflict.universityIds
    ) {
      ids.add(
        normalizeId(
          universityId
        )
      );
    }
  }

  for (
    const row
    of evaluated
  ) {
    if (
      !ids.has(
        normalizeId(
          row.universityId
        )
      )
    ) {
      continue;
    }

    /*
     * 이미 direct/shared verified source로 해결된 경우
     * conflict 상태로 되돌리지 않는다.
     */

    if (
      row.nextClass
        ===
        "RESOLVED_BY_EXISTING_VERIFIED_SOURCE"
    ) {
      continue;
    }

    row.nextClass =
      "SHARED_SOURCE_REVIEW";

    row.reason =
      "동일 후보 URL이 여러 캠퍼스에서 발견되어 source scope 검증이 필요합니다.";

    row.resolved =
      false;

    row.autoActivate =
      false;

    row.cooldown =
      false;

    row.retryable =
      false;

    row.nextAction =
      "REVIEW_SHARED_SOURCE_SCOPE";
  }
}

/* ============================================================
 * 9. Counts
 * ============================================================ */

function buildCounts(
  evaluated
) {
  const counts = {};

  for (
    const row
    of evaluated
  ) {
    counts[
      row.nextClass
    ] =
      (
        counts[
          row.nextClass
        ]
        || 0
      )
      + 1;
  }

  return counts;
}

/* ============================================================
 * 10. Next Actions
 * ============================================================ */

function buildNextActions(
  counts
) {
  const actions = [];

  if (
    counts.NETWORK_REMAINS
  ) {
    actions.push({
      priority:
        1,

      code:
        "NETWORK_REMAINS",

      count:
        counts.NETWORK_REMAINS,

      action:
        "잔존 네트워크 오류를 subtype별로 재진단합니다."
    });
  }

  if (
    counts.CANONICAL_SOURCE_DISCOVERY
  ) {
    actions.push({
      priority:
        2,

      code:
        "CANONICAL_SOURCE_DISCOVERY",

      count:
        counts.CANONICAL_SOURCE_DISCOVERY,

      action:
        "공식 도메인과 유효한 공지/뉴스 진입 URL을 다시 탐색합니다."
    });
  }

  if (
    counts.DISCOVERY_DIAGNOSIS
  ) {
    actions.push({
      priority:
        3,

      code:
        "DISCOVERY_DIAGNOSIS",

      count:
        counts.DISCOVERY_DIAGNOSIS,

      action:
        "네트워크가 정상인 대학에서 일반공지/뉴스/게시판 후보 discovery를 수행합니다."
    });
  }

  if (
    counts.NO_CANDIDATE
  ) {
    actions.push({
      priority:
        4,

      code:
        "NO_CANDIDATE_DISCOVERY",

      count:
        counts.NO_CANDIDATE,

      action:
        "공식 홈페이지 내부 공지/뉴스/게시판 discovery 규칙을 강화합니다."
    });
  }

  if (
    counts.QUALITY_REVIEW
  ) {
    actions.push({
      priority:
        5,

      code:
        "QUALITY_REVIEW",

      count:
        counts.QUALITY_REVIEW,

      action:
        "selector, 제목 안정성, 실제 날짜, 상세 URL 구조를 재검증합니다."
    });
  }

  if (
    counts.SHARED_SOURCE_REVIEW
  ) {
    actions.push({
      priority:
        6,

      code:
        "SHARED_SOURCE_REVIEW",

      count:
        counts.SHARED_SOURCE_REVIEW,

      action:
        "동일 URL이 공통 source인지 캠퍼스별 source인지 확인하고 중복 저장을 금지합니다."
    });
  }

  if (
    counts.ENVIRONMENT_WAF_BLOCKED
  ) {
    actions.push({
      priority:
        7,

      code:
        "ENVIRONMENT_WAF_BLOCKED",

      count:
        counts.ENVIRONMENT_WAF_BLOCKED,

      action:
        "현재 로컬 환경에서는 재시도하지 않고 다른 네트워크 또는 배포 환경에서 접근성을 재검증합니다."
    });
  }

  if (
    counts.RESOLVED_BY_EXISTING_VERIFIED_SOURCE
  ) {
    actions.push({
      priority:
        8,

      code:
        "CLEAN_STALE_PLACEHOLDER_STATE",

      count:
        counts.RESOLVED_BY_EXISTING_VERIFIED_SOURCE,

      action:
        "이미 verified source가 존재하는 대학은 오래된 NETWORK/미검증 placeholder 상태에서 제외합니다."
    });
  }

  return actions.sort(
    (a, b) =>
      a.priority
      -
      b.priority
  );
}

/* ============================================================
 * 11. Main
 * ============================================================ */

function main() {
  if (
    !fs.existsSync(
      PILOT_FILE
    )
  ) {
    throw new Error(
      "PILOT_FILE_NOT_FOUND"
    );
  }

  if (
    !fs.existsSync(
      NETWORK_FILE
    )
  ) {
    throw new Error(
      "NETWORK_FILE_NOT_FOUND"
    );
  }

  const catalogFile =
    firstExistingFile(
      CATALOG_CANDIDATES
    );

  if (
    !catalogFile
  ) {
    throw new Error(
      "CATALOG_FILE_NOT_FOUND"
    );
  }

  const pilot =
    readJson(
      PILOT_FILE
    );

  const networkState =
    readJson(
      NETWORK_FILE
    );

  const catalog =
    readJson(
      catalogFile
    );

  const pilotRows =
    extractArray(
      pilot
    )
      .map(
        normalizePilotRow
      );

  const networkMap =
    buildNetworkMap(
      networkState
    );

  const catalogMap =
    buildCatalogMap(
      catalog
    );

  const sharedSourceMap =
    buildSharedSourceVisibilityMap(
      catalog
    );

  const evaluated = [];

  for (
    const row
    of pilotRows
  ) {
    const id =
      normalizeId(
        row.universityId
      );

    const networkItem =
      networkMap.get(id)
      || null;

    const university =
      catalogMap.get(id)
      || null;

    const directVerifiedSources =
      getVerifiedEnabledSources(
        university
      );

    const effectiveVerifiedSources =
      buildEffectiveVerifiedSources({
        universityId:
          row.universityId,

        university,

        sharedSourceMap
      });

    const sharedVisibleSources =
      effectiveVerifiedSources
        .filter(
          entry =>
            entry.sourceAccess
              === "SHARED_VISIBLE"
        );

    const classification =
      classifyRow({
        row,
        networkItem,
        university,
        effectiveVerifiedSources
      });

    evaluated.push({
      universityId:
        row.universityId,

      universityName:
        row.universityName,

      previousReason:
        row.previousReason,

      finalStatus:
        row.finalStatus,

      recoveredFromNetwork:
        row.recoveredFromNetwork,

      homepageStatus:
        row.homepageStatus,

      candidateCount:
        row.candidateCount,

      score:
        row.score,

      grade:
        row.grade,

      recommendedUrl:
        normalizeUrl(
          row.recommendedUrl
        )
        || null,

      networkSubtype:
        networkItem?.networkSubtype
        ||
        networkItem?.subtype
        ||
        null,

      networkNextClass:
        networkItem?.networkNextClass
        ||
        networkItem?.nextClass
        ||
        null,

      catalogFound:
        Boolean(
          university
        ),

      catalogSourceCount:
        getSources(
          university
        ).length,

      verifiedEnabledSourceCount:
        directVerifiedSources.length,

      effectiveVerifiedEnabledSourceCount:
        effectiveVerifiedSources.length,

      sharedVisibleVerifiedSourceCount:
        sharedVisibleSources.length,

      sourceResolutionMode:
        sharedVisibleSources.length
          > 0
          &&
          directVerifiedSources.length
            === 0
            ? "SHARED_SOURCE_VISIBLE"
            : directVerifiedSources.length
                > 0
              ? "DIRECT_SOURCE"
              : null,

      nextClass:
        classification.nextClass,

      reason:
        classification.reason,

      resolved:
        classification.resolved
        === true,

      autoActivate:
        classification.autoActivate
        === true,

      cooldown:
        classification.cooldown
        === true,

      retryable:
        classification.retryable
        === true,

      nextAction:
        classification.nextAction
        || null,

      localDiscoveryBlocked:
        networkItem?.localDiscoveryBlocked
        === true,

      verifiedSources:
        effectiveVerifiedSources
          .map(
            entry => ({
              sourceId:
                entry.source?.id
                ||
                entry.source?.sourceId
                ||
                null,

              listUrl:
                entry.source?.listUrl
                ||
                null,

              category:
                entry.source?.category
                ||
                null,

              status:
                entry.source?.status
                ||
                (
                  entry.source?.verified
                    === true
                    ? "verified"
                    : null
                ),

              campusScope:
                entry.source?.campusScope
                ||
                null,

              canonicalOwner:
                entry.source?.canonicalOwner
                ||
                entry.canonicalOwner
                ||
                entry.ownerUniversityId
                ||
                null,

              sourceAccess:
                entry.sourceAccess,

              collectOnce:
                entry.source?.collectOnce
                === true,

              duplicateStorage:
                entry.source?.duplicateStorage
                === true,

              visibleToCampuses:
                Array.isArray(
                  entry.source?.visibleToCampuses
                )
                  ? entry.source.visibleToCampuses
                  : []
            })
          )
    });
  }

  /*
   * Shared URL 충돌 판정
   */

  const sharedSourceConflicts =
    findSharedSourceConflicts(
      evaluated
    );

  applySharedSourceConflicts(
    evaluated,
    sharedSourceConflicts
  );

  const counts =
    buildCounts(
      evaluated
    );

  const resolvedCount =
    evaluated.filter(
      row =>
        row.resolved
        === true
    ).length;

  const unresolvedCount =
    evaluated.length
    -
    resolvedCount;

  const nextActions =
    buildNextActions(
      counts
    );

  const report = {
    schemaVersion:
      "2.2",

    generatedAt:
      new Date()
        .toISOString(),

    sourcePilot:
      path.basename(
        PILOT_FILE
      ),

    sourceNetworkState:
      path.basename(
        NETWORK_FILE
      ),

    sourceCatalog:
      path.basename(
        catalogFile
      ),

    processed:
      evaluated.length,

    resolvedCount,

    unresolvedCount,

    counts,

    sharedSourceConflictCount:
      sharedSourceConflicts.length,

    sharedSourceConflicts,

    evaluatedItems:
      evaluated,

    nextActions,

    decision:
      unresolvedCount > 0
        ? "RECLASSIFY_AND_CONTINUE"
        : "ALL_RESOLVED",

    evaluatorPolicy: {
      verifiedSourceWins:
        true,

      sharedVisibleVerifiedSourceWins:
        true,

      sharedSourceCollectOnce:
        true,

      sharedSourceDuplicateStorage:
        false,

      staleUnverifiedPlaceholderIgnored:
        true,

      httpReachableLeavesNetworkQueue:
        true,

      environmentWafBlockedWinsOverNoCandidate:
        true,

      environmentWafBlockedCooldown:
        true,

      sharedSourceAutoActivation:
        false,

      automaticMutation:
        false
    },

    safety: {
      readOnly:
        true,

      automaticActivation:
        false,

      automaticSourceMutation:
        false,

      queueModified:
        false,

      deploymentTriggered:
        false,

      gitTriggered:
        false
    }
  };

  atomicWrite(
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