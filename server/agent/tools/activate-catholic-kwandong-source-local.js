"use strict";

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

const READY_FILE = path.join(
  DATA,
  "catholic-kwandong-activation-ready.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "catholic-kwandong-source-activation.json"
);

const BACKUP_ROOT = path.join(
  ROOT,
  "server",
  "agent",
  "backups",
  "catholic-kwandong-source-activation"
);

const UNIVERSITY_ID =
  "catholic-kwandong-university-본교";

const SOURCE_ID =
  "catholic-kwandong-general-feed";

// ============================================================
// Utilities
// ============================================================

function readJson(file, fallback = null) {
  try {
    return JSON.parse(
      fs
        .readFileSync(file, "utf8")
        .replace(/^\uFEFF/, "")
    );
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function atomicWrite(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  const temp =
    `${file}.${process.pid}.tmp`;

  writeJson(
    temp,
    value
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
    return null;
  }
}

function timestampFolder() {
  const now =
    new Date();

  const pad =
    value =>
      String(value)
        .padStart(
          2,
          "0"
        );

  return (
    now.getFullYear()
    +
    pad(
      now.getMonth() + 1
    )
    +
    pad(
      now.getDate()
    )
    +
    pad(
      now.getHours()
    )
    +
    pad(
      now.getMinutes()
    )
    +
    pad(
      now.getSeconds()
    )
  );
}

function fileHash(file) {
  const crypto =
    require("crypto");

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

// ============================================================
// Validation
// ============================================================

function validateCatalogShape(catalog) {
  if (
    !catalog
    ||
    !Array.isArray(
      catalog.universities
    )
  ) {
    throw new Error(
      "INVALID_CATALOG_SHAPE"
    );
  }
}

function validateReady(ready) {
  if (
    ready?.decision
    !==
    "ACTIVATION_READY"
    ||
    ready?.activationReady
    !== true
  ) {
    throw new Error(
      "ACTIVATION_NOT_READY"
    );
  }

  const source =
    ready
      ?.proposedActivation
      ?.source;

  if (!source) {
    throw new Error(
      "PROPOSED_SOURCE_MISSING"
    );
  }

  if (
    source.id
    !==
    SOURCE_ID
  ) {
    throw new Error(
      "SOURCE_ID_MISMATCH"
    );
  }

  if (
    normalizeId(
      ready
        ?.proposedActivation
        ?.canonicalOwner
    )
    !==
    normalizeId(
      UNIVERSITY_ID
    )
  ) {
    throw new Error(
      "CANONICAL_OWNER_MISMATCH"
    );
  }

  if (
    source.verified
    !== true
    ||
    source.enabled
    !== true
  ) {
    throw new Error(
      "SOURCE_NOT_VERIFIED_ENABLED"
    );
  }
}

// ============================================================
// Main
// ============================================================

function main() {
  if (
    !fs.existsSync(
      CATALOG_FILE
    )
  ) {
    throw new Error(
      "CATALOG_FILE_NOT_FOUND"
    );
  }

  if (
    !fs.existsSync(
      READY_FILE
    )
  ) {
    throw new Error(
      "ACTIVATION_READY_FILE_NOT_FOUND"
    );
  }

  const ready =
    readJson(
      READY_FILE
    );

  validateReady(
    ready
  );

  const catalog =
    readJson(
      CATALOG_FILE
    );

  validateCatalogShape(
    catalog
  );

  const beforeCatalogHash =
    fileHash(
      CATALOG_FILE
    );

  const targetUniversity =
    catalog.universities.find(
      university =>
        normalizeId(
          university.universityId
        )
        ===
        normalizeId(
          UNIVERSITY_ID
        )
    );

  if (!targetUniversity) {
    throw new Error(
      "TARGET_UNIVERSITY_NOT_FOUND"
    );
  }

  if (
    !Array.isArray(
      targetUniversity.sources
    )
  ) {
    targetUniversity.sources = [];
  }

  const proposedSource =
    JSON.parse(
      JSON.stringify(
        ready
          .proposedActivation
          .source
      )
    );

  proposedSource.status =
    "verified";

  proposedSource.healthStatus =
    "validated";

  proposedSource.verified =
    true;

  proposedSource.enabled =
    true;

  proposedSource.canonicalOwner =
    UNIVERSITY_ID;

  // ----------------------------------------------------------
  // Global duplicate guard
  // ----------------------------------------------------------

  const duplicateIds = [];
  const duplicateUrls = [];

  const proposedUrl =
    normalizeUrl(
      proposedSource.listUrl
    );

  for (
    const university
    of catalog.universities
  ) {
    for (
      const source
      of university.sources || []
    ) {
      const sourceId =
        source.id
        ||
        source.sourceId
        ||
        null;

      if (
        sourceId
        ===
        SOURCE_ID
      ) {
        duplicateIds.push({
          universityId:
            university.universityId,

          sourceId
        });
      }

      if (
        proposedUrl
        &&
        normalizeUrl(
          source.listUrl
        )
        ===
        proposedUrl
      ) {
        duplicateUrls.push({
          universityId:
            university.universityId,

          sourceId
        });
      }
    }
  }

  if (
    duplicateIds.length > 0
  ) {
    throw new Error(
      "DUPLICATE_SOURCE_ID_FOUND"
    );
  }

  if (
    duplicateUrls.length > 0
  ) {
    throw new Error(
      "DUPLICATE_LIST_URL_FOUND"
    );
  }

  // ----------------------------------------------------------
  // Backup
  // ----------------------------------------------------------

  const backupDir =
    path.join(
      BACKUP_ROOT,
      timestampFolder()
    );

  fs.mkdirSync(
    backupDir,
    {
      recursive: true
    }
  );

  const backupCatalogFile =
    path.join(
      backupDir,
      path.basename(
        CATALOG_FILE
      )
    );

  fs.copyFileSync(
    CATALOG_FILE,
    backupCatalogFile
  );

  let rollback = false;
  let error = null;

  try {
    targetUniversity.sources.push(
      proposedSource
    );

    atomicWrite(
      CATALOG_FILE,
      catalog
    );

    // --------------------------------------------------------
    // Post validation
    // --------------------------------------------------------

    const writtenCatalog =
      readJson(
        CATALOG_FILE
      );

    validateCatalogShape(
      writtenCatalog
    );

    let foundCount = 0;
    let ownerCount = 0;
    let sameUrlCount = 0;

    for (
      const university
      of writtenCatalog.universities
    ) {
      for (
        const source
        of university.sources || []
      ) {
        if (
          (
            source.id
            ||
            source.sourceId
          )
          ===
          SOURCE_ID
        ) {
          foundCount += 1;

          if (
            normalizeId(
              university.universityId
            )
            ===
            normalizeId(
              UNIVERSITY_ID
            )
          ) {
            ownerCount += 1;
          }

          if (
            source.verified
            !== true
            ||
            source.enabled
            !== true
          ) {
            throw new Error(
              "POST_VALIDATION_SOURCE_NOT_ENABLED"
            );
          }
        }

        if (
          proposedUrl
          &&
          normalizeUrl(
            source.listUrl
          )
          ===
          proposedUrl
        ) {
          sameUrlCount += 1;
        }
      }
    }

    if (
      foundCount !== 1
    ) {
      throw new Error(
        "POST_VALIDATION_SOURCE_COUNT_INVALID"
      );
    }

    if (
      ownerCount !== 1
    ) {
      throw new Error(
        "POST_VALIDATION_OWNER_INVALID"
      );
    }

    if (
      sameUrlCount !== 1
    ) {
      throw new Error(
        "POST_VALIDATION_LIST_URL_COUNT_INVALID"
      );
    }

  } catch (caught) {
    rollback = true;

    error = {
      name:
        caught?.name
        || "Error",

      message:
        caught?.message
        || String(caught)
    };

    fs.copyFileSync(
      backupCatalogFile,
      CATALOG_FILE
    );
  }

  const afterCatalogHash =
    fileHash(
      CATALOG_FILE
    );

  const sourceAdded =
    rollback === false
    &&
    beforeCatalogHash
    !==
    afterCatalogHash;

  const report = {
    status:
      rollback
        ? "ROLLED_BACK"
        : "ACTIVATED_LOCAL",

    sourceAdded,

    universityId:
      UNIVERSITY_ID,

    universityName:
      "가톨릭관동대학교",

    source: rollback
      ? null
      : {
          id:
            proposedSource.id,

          name:
            proposedSource.name,

          listUrl:
            proposedSource.listUrl,

          category:
            proposedSource.category,

          verified:
            proposedSource.verified,

          enabled:
            proposedSource.enabled,

          status:
            proposedSource.status,

          healthStatus:
            proposedSource.healthStatus,

          campusScope:
            proposedSource.campusScope
        },

    tests: {
      activationReady:
        ready.activationReady
        === true,

      collectorUnique:
        ready
          ?.collector
          ?.unique
        || 0,

      detailTested:
        ready
          ?.detailValidation
          ?.tested
        || 0,

      detailPass:
        ready
          ?.detailValidation
          ?.pass
        || 0,

      canonicalListValidated:
        ready
          ?.canonicalization
          ?.canonicalListValidated
        === true
    },

    rollback,

    hashes: {
      catalogChanged:
        beforeCatalogHash
        !==
        afterCatalogHash,

      beforeCatalogHash,

      afterCatalogHash
    },

    backup:
      backupDir,

    outputFile:
      OUTPUT_FILE,

    gitTriggered:
      false,

    deploymentTriggered:
      false,

    error
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

  if (rollback) {
    process.exitCode =
      1;
  }
}

if (
  require.main
  === module
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
              error?.name
              || "Error",

            message:
              error?.message
              || String(error),

            stack:
              error?.stack
              || null
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