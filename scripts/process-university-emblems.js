"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const reports = path.join(root, "reports");
const args = new Set(process.argv.slice(2));

function loadUniversities() {
  const source = fs.readFileSync(path.join(root, "universities.js"), "utf8");
  const context = { window: {}, console: { log() {}, warn() {}, table() {} } };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.items=universities;`, context, { timeout: 1000 });
  return context.items;
}

function validateAllUniversityEmblems(universities) {
  const groups = new Map();
  const missing = [];
  const broken = [];
  const duplicateWarnings = [];
  const rows = universities.map((university) => {
    const file = path.join(root, university.emblem || "");
    const fileExists = Boolean(university.emblem) && fs.existsSync(file) && fs.statSync(file).size > 0;
    const status = university.emblemStatus === "verified" ? "verified" : "missing";
    if (!fileExists) broken.push(university.id);
    if (status === "missing") missing.push(university.id);
    if (!groups.has(university.emblem)) groups.set(university.emblem, []);
    groups.get(university.emblem).push(university);
    return { universityId: university.id, universityGroupId: university.universityGroupId, name: university.name, campusName: university.campusName, emblem: university.emblem, source: university.emblemSource, status, fileExists, imageValid: fileExists };
  });
  for (const [emblem, items] of groups) {
    const groupIds = new Set(items.map((item) => item.universityGroupId));
    if (emblem !== "assets/university-emblems/placeholder-emblem.svg" && groupIds.size > 1) duplicateWarnings.push({ emblem, universityIds: items.map((item) => item.id) });
  }
  return { totalUniversities: universities.length, withEmblemPath: rows.filter((row) => row.emblem).length, verified: rows.filter((row) => row.status === "verified").length, missing: missing.length, brokenFiles: broken.length, emptyPaths: rows.filter((row) => !row.emblem).length, duplicateWarnings: duplicateWarnings.length, rows, missingIds: missing, brokenIds: broken, duplicateWarningRows: duplicateWarnings };
}

const universities = loadUniversities();
const report = validateAllUniversityEmblems(universities);
console.log(`전체 대학교 데이터 ${universities.length}개`);
console.table([{ total: report.totalUniversities, withEmblemPath: report.withEmblemPath, verified: report.verified, missing: report.missing, brokenFiles: report.brokenFiles, duplicateWarnings: report.duplicateWarnings }]);

if (!args.has("--validate-only")) {
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, "university-emblem-report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reports, "missing-university-emblems.json"), JSON.stringify(report.rows.filter((row) => row.status === "missing"), null, 2));
  fs.writeFileSync(path.join(reports, "emblem-download-errors.json"), JSON.stringify([], null, 2));
  fs.writeFileSync(path.join(reports, "emblem-duplicate-check.json"), JSON.stringify(report.duplicateWarningRows, null, 2));
  const csv = ["universityId,universityGroupId,name,campusName,emblem,status,fileExists", ...report.rows.map((row) => [row.universityId,row.universityGroupId,row.name,row.campusName,row.emblem,row.status,row.fileExists].map((value) => `"${String(value).replaceAll('"','""')}"`).join(","))].join("\n");
  fs.writeFileSync(path.join(reports, "university-emblem-report.csv"), csv);
}

if (report.totalUniversities !== 247 || report.withEmblemPath !== report.totalUniversities || report.brokenFiles) process.exitCode = 1;

module.exports = { validateAllUniversityEmblems };
