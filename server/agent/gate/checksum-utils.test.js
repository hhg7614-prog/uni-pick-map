"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalStringify,
  sha256Hex,
  sha256OfCanonicalObject,
  sha256OfFile,
  computeAllChecksums,
} = require("./checksum-utils");

test("canonicalStringify produces identical output regardless of key order", () => {
  const a = { reviewId: "rp-1", verdict: "APPROVE", reasons: ["ok"] };
  const b = { reasons: ["ok"], verdict: "APPROVE", reviewId: "rp-1" };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test("canonicalStringify sorts keys recursively (nested objects too)", () => {
  const a = { outer: { z: 1, a: 2 }, top: true };
  const b = { top: true, outer: { a: 2, z: 1 } };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test("canonicalStringify preserves array element order (arrays are not sorted)", () => {
  const a = { list: [1, 2, 3] };
  const b = { list: [3, 2, 1] };
  assert.notEqual(canonicalStringify(a), canonicalStringify(b));
});

test("sha256OfCanonicalObject: same object with reordered keys hashes identically", () => {
  const a = { reviewId: "rp-1", verdict: "APPROVE", checkedItems: { robotsPolicyViolation: false, jsRuleUnverified: false } };
  const b = { checkedItems: { jsRuleUnverified: false, robotsPolicyViolation: false }, verdict: "APPROVE", reviewId: "rp-1" };
  assert.equal(sha256OfCanonicalObject(a), sha256OfCanonicalObject(b));
});

test("sha256OfCanonicalObject: changing a single field value changes the hash", () => {
  const base = { reviewId: "rp-1", verdict: "APPROVE" };
  const changed = { reviewId: "rp-1", verdict: "HOLD" };
  assert.notEqual(sha256OfCanonicalObject(base), sha256OfCanonicalObject(changed));
});

test("sha256Hex is a deterministic 64-character hex string", () => {
  const value = sha256Hex("hello world");
  assert.match(value, /^[0-9a-f]{64}$/);
  assert.equal(value, sha256Hex("hello world"));
});

test("sha256OfFile hashes the file content read via the injected readFileImpl", () => {
  const readFileImpl = (filePath) => {
    if (filePath === "fixture.json") return '{"a":1}';
    throw new Error(`unexpected path: ${filePath}`);
  };
  assert.equal(sha256OfFile("fixture.json", readFileImpl), sha256Hex('{"a":1}'));
});

test("computeAllChecksums returns the 4-part shape (sourceCatalogFile/sourceBlockCanonical/storeFile/previewFile)", () => {
  const files = {
    "catalog.json": '{"universities":[]}',
    "store.json": '{"items":[]}',
    "preview.json": '{"items":[]}',
  };
  const readFileImpl = (filePath) => files[filePath];
  const sourceSnapshot = { id: "test-source", enabled: false };

  const checksums = computeAllChecksums({
    sourceCatalogFile: "catalog.json",
    storeFile: "store.json",
    previewFile: "preview.json",
    sourceSnapshot,
    readFileImpl,
  });

  assert.equal(checksums.sourceCatalogFile.path, "catalog.json");
  assert.equal(checksums.sourceCatalogFile.sha256, sha256Hex(files["catalog.json"]));
  assert.equal(checksums.storeFile.sha256, sha256Hex(files["store.json"]));
  assert.equal(checksums.previewFile.sha256, sha256Hex(files["preview.json"]));
  assert.equal(checksums.sourceBlockCanonical.sha256, sha256OfCanonicalObject(sourceSnapshot));
});

test("computeAllChecksums: any single input change (catalog content, store content, or source block) changes only its own checksum", () => {
  const files = {
    "catalog.json": '{"universities":[]}',
    "store.json": '{"items":[]}',
    "preview.json": '{"items":[]}',
  };
  const readFileImpl = (filePath) => files[filePath];
  const sourceSnapshot = { id: "test-source", enabled: false };
  const before = computeAllChecksums({ sourceCatalogFile: "catalog.json", storeFile: "store.json", previewFile: "preview.json", sourceSnapshot, readFileImpl });

  const filesAfterStoreChange = { ...files, "store.json": '{"items":[{"title":"new"}]}' };
  const after = computeAllChecksums({
    sourceCatalogFile: "catalog.json",
    storeFile: "store.json",
    previewFile: "preview.json",
    sourceSnapshot,
    readFileImpl: (filePath) => filesAfterStoreChange[filePath],
  });

  assert.notEqual(before.storeFile.sha256, after.storeFile.sha256);
  assert.equal(before.sourceCatalogFile.sha256, after.sourceCatalogFile.sha256);
  assert.equal(before.previewFile.sha256, after.previewFile.sha256);
  assert.equal(before.sourceBlockCanonical.sha256, after.sourceBlockCanonical.sha256);
});
