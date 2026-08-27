"use strict";

/**
 * UNI PICK
 * 국립목포대학교 WAF Block Classification
 *
 * 목적
 * ------------------------------------------------------------
 * 국립목포대학교는 실제 공식 공지 게시판이 존재하지만,
 * 현재 로컬 환경에서는 다음 상태가 확인됨.
 *
 * - www.mnu.ac.kr HTTPS:
 *   인증서 hostname mismatch
 *
 * - www.mokpo.ac.kr HTTPS:
 *   인증서 정상
 *
 * - 그러나 실제 GET 응답:
 *   "웹 사이트 필터링 정책에 따라 ... 웹방화벽의 보안정책에 위배되어 차단"
 *
 * 따라서 NO_CANDIDATE 또는 NETWORK_FETCH가 아니라
 * ENVIRONMENT_WAF_BLOCKED 로 분류한다.
 *
 * 이 스크립트는 source/catalog를 활성화하지 않는다.
 * 네트워크 재요청도 하지 않는다.
 *
 * 수정 대상:
 * - uni-pick-network-subtypes.json
 *
 * 안전:
 * - backup 생성
 * - catalog/store/preview 수정 없음
 * - git/deploy 없음
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

const NETWORK_FILE = path.join(
  DATA,
  "uni-pick-network-subtypes.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "mokpo-national-waf-classification.json"
);

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "mokpo-national-waf-classification"
);

const CATALOG_FILE = path.join(
  ROOT,
  "development",
  "university-news",
  "data",
  "university-news-sources.final.json"
);

const STORE_FILE = path.join(
  ROOT,
  "server",
  "agent",
  "data",
  "agent-news-store.json"
);

const PREVIEW_FILE = path.join(
  ROOT,
  "data",
  "university-news-preview.json"
);

const UNIVERSITY_ID =
  "mokpo-national-university-본교";

const UNIVERSITY_NAME =
  "국립목포대학교";


function readJson(file, fallback = null) {
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


function atomicWrite(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
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


function normalizeId(value) {
  return String(value || "")
    .normalize("NFC");
}


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


function snapshotOperationalHashes() {
  return {
    catalog:
      sha256(CATALOG_FILE),

    store:
      sha256(STORE_FILE),

    preview:
      sha256(PREVIEW_FILE)
  };
}


function makeBackup() {
  const stamp =
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14);

  const dir =
    path.join(
      BACKUP_ROOT,
      stamp
    );

  fs.mkdirSync(
    dir,
    { recursive: true }
  );

  if (
    fs.existsSync(
      NETWORK_FILE
    )
  ) {
    fs.copyFileSync(
      NETWORK_FILE,
      path.join(
        dir,
        path.basename(
          NETWORK_FILE
        )
      )
    );
  }

  return dir;
}


function classifyArrayShape(data) {
  if (Array.isArray(data)) {
    return {
      type: "ROOT_ARRAY",
      items: data
    };
  }

  if (
    Array.isArray(
      data?.items
    )
  ) {
    return {
      type: "ITEMS",
      items:
        data.items
    };
  }

  if (
    Array.isArray(
      data?.universities
    )
  ) {
    return {
      type: "UNIVERSITIES",
      items:
        data.universities
    };
  }

  if (
    Array.isArray(
      data?.results
    )
  ) {
    return {
      type: "RESULTS",
      items:
        data.results
    };
  }

  return {
    type: "UNKNOWN",
    items: []
  };
}


function main() {
  if (
    !fs.existsSync(
      NETWORK_FILE
    )
  ) {
    throw new Error(
      "NETWORK_STATE_FILE_NOT_FOUND"
    );
  }

  const operationalBefore =
    snapshotOperationalHashes();

  const network =
    readJson(
      NETWORK_FILE
    );

  if (!network) {
    throw new Error(
      "NETWORK_STATE_INVALID_JSON"
    );
  }

  const shape =
    classifyArrayShape(
      network
    );

  if (
    shape.type === "UNKNOWN"
  ) {
    throw new Error(
      "NETWORK_STATE_SHAPE_UNKNOWN"
    );
  }

  const target =
    shape.items.find(
      item =>
        normalizeId(
          item.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    );

  if (!target) {
    throw new Error(
      "MOKPO_NETWORK_ENTRY_NOT_FOUND"
    );
  }

  const beforeTarget =
    JSON.parse(
      JSON.stringify(
        target
      )
    );

  const backup =
    makeBackup();

  /*
   * 핵심 재분류
   *
   * evaluator가 사용하는 기존 필드 이름을 최대한 보존하고
   * 새로운 subtype/nextClass를 추가한다.
   */

  target.networkSubtype =
    "ENVIRONMENT_WAF_BLOCKED";

  target.networkNextClass =
    "RETRY_IN_DIFFERENT_ENVIRONMENT";

  target.status =
    "REVIEW";

  target.resolved =
    false;

  target.autoActivate =
    false;

  target.cooldown =
    true;

  target.retryable =
    true;

  target.retryScope =
    "DIFFERENT_NETWORK_OR_DEPLOYMENT_ENVIRONMENT";

  target.reason =
    "공식 게시판은 존재하지만 현재 로컬 환경에서 국립목포대학교 웹방화벽 정책에 의해 HTML 수집 요청이 차단됩니다.";

  target.evidence = {
    ...(target.evidence || {}),

    tlsCanonicalHost:
      "www.mokpo.ac.kr",

    certificateSubject:
      "CN=*.mokpo.ac.kr",

    certificateSan: [
      "*.mokpo.ac.kr",
      "mokpo.ac.kr"
    ],

    httpsCanonicalReachable:
      true,

    httpRedirectsToHttps:
      true,

    wafBlocked:
      true,

    wafMessage:
      "웹 사이트 필터링 정책에 따라 웹방화벽의 보안정책에 위배되어 차단되었습니다.",

    verifiedOfficialBoardPaths: [
      "/www/308/subview.do",
      "/www/309/subview.do"
    ]
  };

  target.updatedAt =
    new Date()
      .toISOString();

  /*
   * 일부 evaluator/planner가 subtype만 보는 경우와
   * nextAction 계열을 보는 경우 모두 대비
   */

  target.nextAction =
    "RETRY_IN_DIFFERENT_ENVIRONMENT";

  target.nextClass =
    "ENVIRONMENT_WAF_BLOCKED";

  target.discoveryEligible =
    false;

  target.localDiscoveryBlocked =
    true;

  atomicWrite(
    NETWORK_FILE,
    network
  );

  const reread =
    readJson(
      NETWORK_FILE
    );

  const rereadShape =
    classifyArrayShape(
      reread
    );

  const writtenTarget =
    rereadShape.items.find(
      item =>
        normalizeId(
          item.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    );

  if (!writtenTarget) {
    throw new Error(
      "WRITE_VERIFY_TARGET_MISSING"
    );
  }

  if (
    writtenTarget.networkSubtype
    !==
    "ENVIRONMENT_WAF_BLOCKED"
  ) {
    throw new Error(
      "WRITE_VERIFY_CLASSIFICATION_FAILED"
    );
  }

  const operationalAfter =
    snapshotOperationalHashes();

  const operationalSafe =
    JSON.stringify(
      operationalBefore
    )
    ===
    JSON.stringify(
      operationalAfter
    );

  if (!operationalSafe) {
    throw new Error(
      "OPERATIONAL_FILES_CHANGED"
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

    decision:
      "ENVIRONMENT_WAF_BLOCKED",

    previous: {
      networkSubtype:
        beforeTarget.networkSubtype
        || null,

      networkNextClass:
        beforeTarget.networkNextClass
        || null,

      reason:
        beforeTarget.reason
        || null
    },

    current: {
      networkSubtype:
        writtenTarget.networkSubtype,

      networkNextClass:
        writtenTarget.networkNextClass,

      nextAction:
        writtenTarget.nextAction,

      cooldown:
        writtenTarget.cooldown,

      retryable:
        writtenTarget.retryable,

      discoveryEligible:
        writtenTarget.discoveryEligible,

      localDiscoveryBlocked:
        writtenTarget.localDiscoveryBlocked,

      reason:
        writtenTarget.reason
    },

    evidence:
      writtenTarget.evidence,

    backup,

    operationalHashesUnchanged:
      operationalSafe,

    safety: {
      sourceModified:
        false,

      catalogModified:
        false,

      storeModified:
        false,

      previewModified:
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
  require.main === module
) {
  main();
}