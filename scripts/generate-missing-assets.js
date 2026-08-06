"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const universitySource = fs.readFileSync(path.join(root, "universities.js"), "utf8");
const context = { console: { log() {}, warn() {} } };
vm.createContext(context);
vm.runInContext(`${universitySource}\nthis.__assetUniversities = universities;`, context);

const missing = context.__assetUniversities
  .filter((university) => university.assetStatus?.logo !== "verified" || university.assetStatus?.image !== "verified")
  .map((university) => ({
    universityId: university.id,
    universityName: university.name,
    logoStatus: university.assetStatus?.logo || "missing",
    imageStatus: university.assetStatus?.image || "missing",
    reason: "검증된 로컬 이미지 파일 및 출처 레코드가 필요합니다.",
  }));

fs.writeFileSync(
  path.join(root, "assets/university-sources/missing-assets.json"),
  `${JSON.stringify(missing, null, 2)}\n`,
);
console.log(`Missing asset records written: ${missing.length}`);
