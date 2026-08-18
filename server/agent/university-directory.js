"use strict";

/**
 * universities.js 조회 (에이전트용)
 *
 * universities.js 는 브라우저 전역(window.UNI_PICK_UNIVERSITIES)에 배열을 노출하는
 * 스크립트라서 그대로 require 할 수 없습니다. vm으로 안전하게 실행해 배열을 꺼냅니다.
 * (같은 방식을 server/agent/onboarding/run-onboarding-agent.js 에서도 사용합니다.)
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const UNIVERSITY_FILE = path.join(__dirname, "..", "..", "universities.js");

let cache = null;

function loadUniversities() {
  if (cache) return cache;
  const code = fs
    .readFileSync(UNIVERSITY_FILE, "utf8")
    .replace("const universities =", "const universities = globalThis.UNIS =");
  const context = { globalThis: {}, console: { log() {}, warn() {}, info() {} } };
  context.window = context.globalThis;
  vm.createContext(context);
  vm.runInContext(code, context);
  cache = Array.isArray(context.globalThis.UNIS) ? context.globalThis.UNIS : [];
  return cache;
}

/**
 * 대학 id로 공식 엠블럼/로고 이미지 경로를 찾습니다.
 * placeholder 엠블럼이거나 등록된 이미지가 없으면 null을 반환합니다.
 * @param {string} universityId
 * @returns {string|null}
 */
function emblemForUniversityId(universityId) {
  if (!universityId) return null;
  const university = loadUniversities().find((item) => item.id === universityId);
  if (!university || !university.emblem) return null;
  if (/placeholder-emblem/.test(university.emblem)) return null;
  return university.emblem;
}

module.exports = { loadUniversities, emblemForUniversityId };
