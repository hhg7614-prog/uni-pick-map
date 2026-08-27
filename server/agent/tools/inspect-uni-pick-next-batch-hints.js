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

const BATCH_FILE = path.join(
  DATA,
  "uni-pick-next-university-batch.json"
);

const OUTPUT_FILE = path.join(
  DATA,
  "uni-pick-next-batch-hints.json"
);

/* ============================================================
 * Utilities
 * ============================================================ */

function readJson(
  file,
  fallback = null
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      ).replace(
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

function normalizeId(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .trim();
}

function normalizeText(value) {
  return String(
    value || ""
  )
    .normalize("NFC")
    .trim();
}

function isUrl(value) {
  return /^https?:\/\//i.test(
    String(value || "").trim()
  );
}

function normalizeUrl(value) {
  if (!isUrl(value)) {
    return null;
  }

  try {
    const url =
      new URL(
        String(value).trim()
      );

    url.hash = "";

    return url.href;
  } catch {
    return null;
  }
}

function hostnameOf(value) {
  try {
    return new URL(
      value
    )
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ============================================================
 * Catalog normalization
 * ============================================================ */

function getUniversities(catalog) {
  if (!catalog) {
    return [];
  }

  if (Array.isArray(catalog)) {
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

function getSources(university) {
  const keys = [
    "sources",
    "newsSources",
    "collectors",
    "feeds"
  ];

  for (
    const key
    of keys
  ) {
    if (
      Array.isArray(
        university?.[key]
      )
    ) {
      return university[key];
    }
  }

  return [];
}

/* ============================================================
 * Recursive URL extraction
 * ============================================================ */

function collectUrlFields(
  node,
  {
    currentPath = "$",
    depth = 0,
    maxDepth = 8,
    results = [],
    visited = new Set()
  } = {}
) {
  if (
    node === null
    ||
    node === undefined
    ||
    depth > maxDepth
  ) {
    return results;
  }

  if (
    typeof node === "string"
  ) {
    const direct =
      normalizeUrl(
        node
      );

    if (
      direct
      &&
      !visited.has(
        direct
      )
    ) {
      visited.add(
        direct
      );

      results.push({
        path:
          currentPath,

        value:
          node,

        url:
          direct,

        hostname:
          hostnameOf(
            direct
          )
      });
    }

    /*
     * 문자열 내부에 URL이 포함된 경우도 탐색
     */
    const matches =
      node.match(
        /https?:\/\/[^\s"'<>\\]+/gi
      )
      || [];

    for (
      const match
      of matches
    ) {
      const url =
        normalizeUrl(
          match
        );

      if (
        url
        &&
        !visited.has(
          url
        )
      ) {
        visited.add(
          url
        );

        results.push({
          path:
            currentPath,

          value:
            match,

          url,

          hostname:
            hostnameOf(
              url
            )
        });
      }
    }

    return results;
  }

  if (
    typeof node !== "object"
  ) {
    return results;
  }

  if (
    Array.isArray(node)
  ) {
    node.forEach(
      (
        child,
        index
      ) => {
        collectUrlFields(
          child,
          {
            currentPath:
              `${currentPath}[${index}]`,

            depth:
              depth + 1,

            maxDepth,

            results,

            visited
          }
        );
      }
    );

    return results;
  }

  for (
    const [
      key,
      value
    ]
    of Object.entries(node)
  ) {
    collectUrlFields(
      value,
      {
        currentPath:
          `${currentPath}.${key}`,

        depth:
          depth + 1,

        maxDepth,

        results,

        visited
      }
    );
  }

  return results;
}

/* ============================================================
 * Homepage-like fields
 * ============================================================ */

function collectHomepageHints(
  university
) {
  const preferredKeys = [
    "homepage",
    "homepageUrl",
    "homeUrl",
    "website",
    "websiteUrl",
    "site",
    "siteUrl",
    "url",
    "officialUrl",
    "officialWebsite",
    "domain"
  ];

  const hints = [];

  for (
    const key
    of preferredKeys
  ) {
    const value =
      university?.[key];

    if (!value) {
      continue;
    }

    if (
      typeof value === "string"
    ) {
      hints.push({
        field:
          key,

        value,

        url:
          normalizeUrl(
            value
          ),

        hostname:
          normalizeUrl(value)
            ? hostnameOf(
                normalizeUrl(value)
              )
            : null
      });
    }
  }

  return hints;
}

/* ============================================================
 * Source hints
 * ============================================================ */

function analyzeSources(
  university
) {
  return getSources(
    university
  ).map(
    source => {
      const urls =
        collectUrlFields(
          source
        );

      return {
        id:
          source?.id
          || source?.sourceId
          || null,

        name:
          source?.name
          || null,

        category:
          source?.category
          || null,

        sourceType:
          source?.sourceType
          || null,

        collectionType:
          source?.collectionType
          || null,

        verified:
          source?.verified
          === true,

        enabled:
          source?.enabled
          === true,

        status:
          source?.status
          || null,

        healthStatus:
          source?.healthStatus
          || null,

        listUrl:
          normalizeUrl(
            source?.listUrl
            || source?.url
          ),

        parser:
          source?.parser
          || null,

        urls
      };
    }
  );
}

/* ============================================================
 * Domain candidates
 * ============================================================ */

function buildDomainCandidates({
  homepageHints,
  allUrls,
  sources
}) {
  const map =
    new Map();

  function add(
    hostname,
    reason,
    url = null
  ) {
    if (!hostname) {
      return;
    }

    if (
      !map.has(
        hostname
      )
    ) {
      map.set(
        hostname,
        {
          hostname,
          score: 0,
          reasons: [],
          sampleUrls: []
        }
      );
    }

    const item =
      map.get(
        hostname
      );

    if (
      !item.reasons.includes(
        reason
      )
    ) {
      item.reasons.push(
        reason
      );
    }

    if (
      url
      &&
      !item.sampleUrls.includes(
        url
      )
    ) {
      item.sampleUrls.push(
        url
      );
    }
  }

  for (
    const hint
    of homepageHints
  ) {
    add(
      hint.hostname,
      "HOMEPAGE_FIELD",
      hint.url
    );
  }

  for (
    const entry
    of allUrls
  ) {
    add(
      entry.hostname,
      "CATALOG_URL_FIELD",
      entry.url
    );
  }

  for (
    const source
    of sources
  ) {
    if (
      source.listUrl
    ) {
      add(
        hostnameOf(
          source.listUrl
        ),
        source.verified
          &&
          source.enabled
          ? "VERIFIED_ENABLED_SOURCE"
          : "EXISTING_SOURCE",
        source.listUrl
      );
    }

    for (
      const entry
      of source.urls
    ) {
      add(
        entry.hostname,
        "SOURCE_URL",
        entry.url
      );
    }
  }

  for (
    const item
    of map.values()
  ) {
    if (
      item.reasons.includes(
        "HOMEPAGE_FIELD"
      )
    ) {
      item.score += 100;
    }

    if (
      item.reasons.includes(
        "VERIFIED_ENABLED_SOURCE"
      )
    ) {
      item.score += 90;
    }

    if (
      item.reasons.includes(
        "EXISTING_SOURCE"
      )
    ) {
      item.score += 70;
    }

    if (
      item.reasons.includes(
        "SOURCE_URL"
      )
    ) {
      item.score += 50;
    }

    if (
      item.reasons.includes(
        "CATALOG_URL_FIELD"
      )
    ) {
      item.score += 30;
    }

    /*
     * 대학 사이트 가능성이 낮은 일반 외부 도메인 감점
     */
    if (
      /^(youtube\.com|youtu\.be|facebook\.com|instagram\.com|blog\.naver\.com|naver\.com|kakao\.com)$/i
        .test(
          item.hostname
        )
    ) {
      item.score -= 100;
      item.reasons.push(
        "LIKELY_EXTERNAL_SERVICE"
      );
    }
  }

  return [
    ...map.values()
  ].sort(
    (a, b) =>
      b.score - a.score
      ||
      a.hostname.localeCompare(
        b.hostname
      )
  );
}

/* ============================================================
 * Main
 * ============================================================ */

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
      BATCH_FILE
    )
  ) {
    throw new Error(
      "NEXT_BATCH_FILE_NOT_FOUND"
    );
  }

  const catalog =
    readJson(
      CATALOG_FILE,
      {
        universities: []
      }
    );

  const batchFile =
    readJson(
      BATCH_FILE,
      {
        batch: []
      }
    );

  const universities =
    getUniversities(
      catalog
    );

  const universityMap =
    new Map();

  for (
    const university
    of universities
  ) {
    const id =
      normalizeId(
        university.universityId
        || university.id
      );

    if (id) {
      universityMap.set(
        id,
        university
      );
    }
  }

  const results = [];

  for (
    const batchItem
    of batchFile.batch || []
  ) {
    const universityId =
      normalizeId(
        batchItem.universityId
      );

    const university =
      universityMap.get(
        universityId
      )
      || null;

    if (!university) {
      results.push({
        order:
          batchItem.order,

        universityId,

        universityName:
          batchItem.universityName,

        catalogFound:
          false,

        hintStatus:
          "CATALOG_UNIVERSITY_NOT_FOUND",

        homepageHints:
          [],

        existingSources:
          [],

        domainCandidates:
          []
      });

      continue;
    }

    const homepageHints =
      collectHomepageHints(
        university
      );

    const allUrls =
      collectUrlFields(
        university
      );

    const existingSources =
      analyzeSources(
        university
      );

    const domainCandidates =
      buildDomainCandidates({
        homepageHints,
        allUrls,
        sources:
          existingSources
      });

    const viableDomains =
      domainCandidates.filter(
        item =>
          item.score > 0
      );

    results.push({
      order:
        batchItem.order,

      universityId,

      universityName:
        batchItem.universityName,

      catalogFound:
        true,

      catalogKeys:
        Object.keys(
          university
        ),

      homepageHints,

      existingSourceCount:
        existingSources.length,

      existingSources,

      totalUrlHints:
        allUrls.length,

      urlHints:
        allUrls.slice(
          0,
          30
        ),

      domainCandidates:
        domainCandidates.slice(
          0,
          15
        ),

      viableDomainCount:
        viableDomains.length,

      bestDomainCandidate:
        viableDomains[0]
        || null,

      hintStatus:
        viableDomains.length > 0
          ? "HINTS_AVAILABLE"
          : "NO_CATALOG_URL_HINT"
    });
  }

  const counts = {
    total:
      results.length,

    catalogFound:
      results.filter(
        item =>
          item.catalogFound
      ).length,

    hintsAvailable:
      results.filter(
        item =>
          item.hintStatus
          === "HINTS_AVAILABLE"
      ).length,

    noCatalogUrlHint:
      results.filter(
        item =>
          item.hintStatus
          === "NO_CATALOG_URL_HINT"
      ).length,

    catalogUniversityNotFound:
      results.filter(
        item =>
          item.hintStatus
          === "CATALOG_UNIVERSITY_NOT_FOUND"
      ).length
  };

  const report = {
    schemaVersion:
      "1.0",

    generatedAt:
      new Date()
        .toISOString(),

    decision:
      counts.noCatalogUrlHint === 0
        ? "NEXT_BATCH_HINTS_READY"
        : "NEXT_BATCH_HINTS_PARTIAL",

    sourceBatch:
      path.basename(
        BATCH_FILE
      ),

    sourceCatalog:
      path.basename(
        CATALOG_FILE
      ),

    counts,

    results,

    nextAction:
      counts.noCatalogUrlHint === 0
        ? "RUN_HINT_BASED_SAFE_DISCOVERY"
        : "RESOLVE_MISSING_OFFICIAL_DOMAINS",

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

        counts:
          report.counts,

        universities:
          report.results.map(
            item => ({
              order:
                item.order,

              universityId:
                item.universityId,

              universityName:
                item.universityName,

              hintStatus:
                item.hintStatus,

              existingSourceCount:
                item.existingSourceCount
                || 0,

              viableDomainCount:
                item.viableDomainCount
                || 0,

              bestDomainCandidate:
                item.bestDomainCandidate
                  ? {
                      hostname:
                        item.bestDomainCandidate.hostname,

                      score:
                        item.bestDomainCandidate.score,

                      reasons:
                        item.bestDomainCandidate.reasons,

                      sampleUrls:
                        item.bestDomainCandidate.sampleUrls
                    }
                  : null
            })
          ),

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