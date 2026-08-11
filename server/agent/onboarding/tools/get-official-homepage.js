"use strict";

// The site-owned university dataset is the bootstrap source of truth.  This
// helper evaluates only its data declaration in an empty VM context and never
// makes network requests or invents a homepage.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../../../..");
let cache = null;

function allUniversities() {
  if (cache) return cache;
  const file = path.join(ROOT, "universities.js");
  const source = fs.readFileSync(file, "utf8");
  const context = Object.create(null);
  context.window = Object.create(null);
  const values = vm.runInNewContext(`${source}\n; universities`, context, { filename: file });
  cache = Array.isArray(values) ? values : [];
  return cache;
}

function getOfficialHomepage(universityId) {
  const item = allUniversities().find(value => value && value.id === universityId);
  const raw = item && (item.officialHomepage || item.homepage || item.website || item.url || item.domain);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? { url: url.href, domain: url.hostname.replace(/^www\./, "").toLowerCase(), source: "universities.js.website" } : null;
  } catch {
    return null;
  }
}

module.exports = { getOfficialHomepage };
