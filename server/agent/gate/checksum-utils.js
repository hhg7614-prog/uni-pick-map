"use strict";

/**
 * Gate 공용 체크섬 유틸리티 (sha256 계산 공용 함수)
 *
 * server/agent/gate/review-packet.js 와
 * server/agent/gate/apply-source-activation.js 가 공통으로 사용합니다.
 * (.pipeline/spec.md "1) 검토 패킷 스키마" / "3) reviewId·해시·체크섬 연결 방식" 참고)
 *
 * 신규 의존성 없이 Node 내장 crypto 모듈만 사용합니다
 * (server/agent/dedup.js 의 createHash("sha256") 선례와 동일).
 */

const fs = require("fs");
const crypto = require("crypto");

/**
 * 값을 키가 재귀적으로(오름차순) 정렬된 JSON 문자열로 직렬화합니다.
 * 같은 값을 담은 객체라면 키 순서와 무관하게 항상 같은 문자열이 나옵니다.
 * (packetSha256 / 서명 대상 필드 계산에 공통으로 사용)
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * 객체를 canonical(키 정렬) 직렬화한 뒤 sha256 해시를 계산합니다.
 * 값이 하나라도 다르면(키 순서만 다른 경우는 제외) 해시도 반드시 달라집니다.
 */
function sha256OfCanonicalObject(value) {
  return sha256Hex(canonicalStringify(value));
}

/**
 * 파일 내용을 그대로 읽어 sha256 해시를 계산합니다(정렬/가공 없음 --
 * 카탈로그/store/preview 파일처럼 "지금 이 순간의 바이트 그대로"가 기준입니다).
 */
function sha256OfFile(filePath, readFileImpl = fs.readFileSync) {
  return sha256Hex(readFileImpl(filePath, "utf8"));
}

/**
 * ReviewPacket.checksums 스키마(설계안 1번)와 동일한 4개 체크섬을 계산합니다.
 * - sourceCatalogFile / storeFile / previewFile: 파일 바이트 그대로의 sha256
 * - sourceBlockCanonical: 전달된 sourceSnapshot(소스 블록 객체)의 canonical sha256
 *
 * review-packet.js(패킷 생성 시점)와 apply-source-activation.js(--apply 검증
 * 시점, "지금 이 순간"의 값 재계산)가 이 함수를 공통으로 재사용합니다.
 */
function computeAllChecksums({ sourceCatalogFile, storeFile, previewFile, sourceSnapshot, readFileImpl = fs.readFileSync }) {
  return {
    sourceCatalogFile: { path: sourceCatalogFile, sha256: sha256OfFile(sourceCatalogFile, readFileImpl) },
    sourceBlockCanonical: { sha256: sha256OfCanonicalObject(sourceSnapshot) },
    storeFile: { path: storeFile, sha256: sha256OfFile(storeFile, readFileImpl) },
    previewFile: { path: previewFile, sha256: sha256OfFile(previewFile, readFileImpl) },
  };
}

module.exports = {
  canonicalStringify,
  sha256Hex,
  sha256OfCanonicalObject,
  sha256OfFile,
  computeAllChecksums,
};
