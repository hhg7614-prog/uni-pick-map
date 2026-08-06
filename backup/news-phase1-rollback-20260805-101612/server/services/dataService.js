"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "..", "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readJsonIfExists(relativePath, fallback) {
  const filePath = path.join(projectRoot, relativePath);
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
}

function loadUniversities() {
  const source = fs.readFileSync(path.join(projectRoot, "universities.js"), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__universities = universities;`, context, { timeout: 1000 });
  return Array.isArray(context.__universities) ? context.__universities : [];
}

function loadData() {
  return {
    universities: loadUniversities(),
    majors: readJson("data/university-majors.json"),
    synonyms: readJson("data/major-synonyms.json"),
    admissionSources: readJson("data/official-admission-sources.json"),
    sampleUniversityNews: readJsonIfExists("data/sampleUniversityNews.json", []),
    universityNewsSources: readJsonIfExists("data/universityNewsSources.json", { items: [] }),
  };
}

module.exports = { loadData, projectRoot };
