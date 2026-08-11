"use strict";

const fs = require("fs");
const path = require("path");

function esc(value) { return String(value ?? "").replace(/[&<>\"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }
function writeHtmlReport(filePath, title, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rows = Object.entries(data).map(([key, value]) => `<tr><th>${esc(key)}</th><td><pre>${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre></td></tr>`).join("\n");
  fs.writeFileSync(filePath, `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui;margin:32px;max-width:1100px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8d8d8;padding:10px;text-align:left;vertical-align:top}th{width:260px;background:#f6f8fa}pre{margin:0;white-space:pre-wrap}</style><h1>${esc(title)}</h1><table>${rows}</table></html>\n`, "utf8");
}
module.exports = { writeHtmlReport };
