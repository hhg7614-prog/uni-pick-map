"use strict";

/**
 * 저장소 + preview 원자적 저장
 *
 * 뉴스 저장소(agent-news-store.json)와
 * 공개 사이트용 미리보기(data/university-news-preview.json)를
 * 같이 저장합니다. 저장 중 오류가 나도 기존 파일은 손상되지 않습니다.
 */

const fs = require("fs");
const path = require("path");

// 에이전트 전용 저장소 경로 (프로젝트 루트 기준)
const PROJECT_ROOT = path.resolve(__dirname, "../../");
const STORE_PATH = path.join(PROJECT_ROOT, "server/agent/data/agent-news-store.json");

// 공개 사이트에 표시되는 preview 경로 (서버가 제공하는 파일)
const PREVIEW_PATH = path.join(PROJECT_ROOT, "data/university-news-preview.json");

// 최대 저장 건수 (오래된 것부터 제거)
const MAX_STORE_ITEMS = 1000;

// preview 전체 최대 건수 (안전장치, 대학 수가 늘어도 무한정 커지지 않도록)
const MAX_PREVIEW_ITEMS = 200;

// 대학 1곳당 preview에 넣을 최대 건수. 이 상한이 없으면 공지가 잦은 대학이
// 상위 N건을 모두 차지해서, 공지 빈도가 낮은 대학은 실제로 수집이 되고도
// 화면에는 "소식 없음"으로 보이는 문제가 생깁니다.
const MAX_PREVIEW_ITEMS_PER_UNIVERSITY = 4;

// 이 연도보다 이전에 게시된 항목은 preview에 노출하지 않습니다.
// (개발 초기 목업/샘플 데이터가 실제 수집 데이터처럼 섞여 보이는 것을 방지)
const MIN_PREVIEW_YEAR = 2026;

const EXTERNAL_PREVIEW_HOSTS = new Set([
  "youtube.com", "youtu.be", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com",
]);

function now() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isPublicPreviewItem(item) {
  if (!item?.publishedAt || !/^\d{4}-\d{2}-\d{2}/.test(String(item.publishedAt))) return false;
  if (Number(String(item.publishedAt).slice(0, 4)) < MIN_PREVIEW_YEAR) return false;
  if (!/^https?:\/\//i.test(String(item.sourceUrl || ""))) return false;
  const sourceHost = hostOf(item.sourceUrl);
  const officialHost = hostOf(item.sourceSiteUrl);
  if (!sourceHost || EXTERNAL_PREVIEW_HOSTS.has(sourceHost)) return false;
  if (!officialHost || sourceHost !== officialHost) return false;
  const sourceUrl = new URL(item.sourceUrl);
  const listUrl = item.sourceSiteUrl ? new URL(item.sourceSiteUrl) : null;
  if (sourceUrl.pathname === "/" || (listUrl && sourceUrl.href === listUrl.href)) return false;
  if (/(?:login|signin|auth|error|404|500)/i.test(sourceUrl.pathname)) return false;
  return true;
}

function createPreview(storeItems) {
  const eligible = storeItems
    .filter(isPublicPreviewItem)
    .sort((first, second) => String(second.publishedAt).localeCompare(String(first.publishedAt)));

  // 대학별로 최신 N건까지만 남겨서, 공지가 잦은 대학이 전체 목록을
  // 독점하지 않고 모든 대학이 고르게 노출되도록 합니다.
  // 캠퍼스별 고유 id로 카운트합니다 (같은 학교의 다른 캠퍼스끼리 할당량을
  // 나눠 갖지 않도록 - 예: 연세대 신촌/국제 캠퍼스는 각각 별도로 보장).
  const perUniversityCount = new Map();
  const balanced = eligible.filter((item) => {
    const key = item.universityId || item.universityGroupId;
    const count = perUniversityCount.get(key) || 0;
    if (count >= MAX_PREVIEW_ITEMS_PER_UNIVERSITY) return false;
    perUniversityCount.set(key, count + 1);
    return true;
  });

  const previewItems = balanced
    .sort((first, second) => String(second.publishedAt).localeCompare(String(first.publishedAt)))
    .slice(0, MAX_PREVIEW_ITEMS);
  return {
    generatedAt: now(),
    isDevelopmentPreview: false,
    agentGenerated: true,
    totalStoredItems: storeItems.length,
    supportedUniversities: [...new Set(previewItems.map((item) => item.universityName))],
    items: previewItems,
  };
}

/**
 * 파일을 임시 파일에 먼저 쓴 뒤 rename 해서 덮어씁니다.
 * 쓰다가 오류가 나도 기존 파일은 손상되지 않습니다.
 */
function writeAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  const content = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(tmp, content, "utf8");
  // 검증: 쓴 파일이 유효한 JSON인지 확인
  JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.renameSync(tmp, filePath);
}

/**
 * 기존 저장소를 읽어옵니다. 파일이 없으면 빈 저장소를 반환합니다.
 */
function loadStore() {
  ensureDir(STORE_PATH);
  if (!fs.existsSync(STORE_PATH)) {
    return { version: 1, createdAt: now(), updatedAt: now(), totalItems: 0, items: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!Array.isArray(data.items)) throw new Error("items 배열이 없습니다.");
    return data;
  } catch (error) {
    console.error("[agent/store] 저장소 읽기 실패, 빈 저장소로 시작합니다:", error.message);
    return { version: 1, createdAt: now(), updatedAt: now(), totalItems: 0, items: [] };
  }
}

/**
 * 새 항목들을 저장소에 추가하고 preview 파일도 함께 업데이트합니다.
 * 원자적(atomic)으로 저장하므로 중간에 끊겨도 기존 파일이 유지됩니다.
 *
 * @param {Array} newItems - 저장할 신규 뉴스 항목 배열
 * @returns {{ savedCount: number, totalCount: number }}
 */
function saveNewItems(newItems) {
  if (!newItems || newItems.length === 0) {
    return { savedCount: 0, totalCount: loadStore().totalItems };
  }

  ensureDir(STORE_PATH);
  ensureDir(PREVIEW_PATH);

  const store = loadStore();

  // 신규 항목을 앞에 추가 (최신 게시물이 위에 오도록)
  const merged = [...newItems, ...store.items];

  // 최대 건수 초과 시 오래된 항목 제거
  const trimmed = merged.slice(0, MAX_STORE_ITEMS);

  const updatedStore = {
    version: 1,
    createdAt: store.createdAt || now(),
    updatedAt: now(),
    totalItems: trimmed.length,
    items: trimmed,
  };

  // 1. 저장소 저장
  writeAtomic(STORE_PATH, updatedStore);

  // 2. preview 저장 (최신 MAX_PREVIEW_ITEMS 개만)
  const preview = createPreview(trimmed);

  writeAtomic(PREVIEW_PATH, preview);

  return { savedCount: newItems.length, totalCount: trimmed.length };
}

/**
 * 저장소의 모든 항목을 반환합니다.
 */
function getAllItems() {
  return loadStore().items;
}

function rebuildPreviewFromStore() {
  ensureDir(PREVIEW_PATH);
  const store = loadStore();
  const preview = createPreview(store.items);
  writeAtomic(PREVIEW_PATH, preview);
  return { totalCount: store.items.length, previewCount: preview.items.length };
}

module.exports = { loadStore, saveNewItems, getAllItems, rebuildPreviewFromStore, isPublicPreviewItem, STORE_PATH, PREVIEW_PATH };
