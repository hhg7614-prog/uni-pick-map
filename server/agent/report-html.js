"use strict";

const fs = require("fs");
const path = require("path");

function esc(value) { return String(value ?? "").replace(/[&<>\"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }
function renderBreakdownCell(v) {
  const updated = Array.isArray(v.updated) ? v.updated : [];
  const noNew = Array.isArray(v.noNewItems) ? v.noNewItems : [];
  const failed = Array.isArray(v.failed) ? v.failed : [];
  const sumNew = updated.reduce((n, u) => n + (Number(u.newCount) || 0), 0);
  const t2 = (rowsHtml, head) => rowsHtml
    ? `<table class="ubk"><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table>`
    : `<p class="ubk-empty">없음</p>`;
  const updatedRows = updated.map(u => `<tr><td>${esc(u.universityName)}</td><td>${esc(u.newCount)}</td></tr>`).join("");
  const noNewRows = noNew.map(u => `<tr><td>${esc(u.universityName)}</td><td>${esc(u.reason)}</td></tr>`).join("");
  const failedRows = failed.map(u => `<tr><td>${esc(u.universityName)}</td><td>${esc(u.reason)}</td></tr>`).join("");
  return `<p><strong>업데이트 완료 ${updated.length}개교 (신규 ${sumNew}건) / 변경 없음 ${noNew.length}개교 / 수집 실패 ${failed.length}개교</strong></p>`
    + `<h4>업데이트 완료</h4>${t2(updatedRows, "<th>학교</th><th>신규</th>")}`
    + `<h4>변경 없음</h4>${t2(noNewRows, "<th>학교</th><th>사유</th>")}`
    + `<h4>수집 실패</h4>${t2(failedRows, "<th>학교</th><th>사유</th>")}`;
}
function writeHtmlReport(filePath, title, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rows = Object.entries(data).map(([key, value]) => {
    if (key === "universityBreakdown" && value && typeof value === "object" && !Array.isArray(value)) {
      return `<tr><th>${esc("학교별 업데이트 내역")}</th><td>${renderBreakdownCell(value)}</td></tr>`;
    }
    return `<tr><th>${esc(key)}</th><td><pre>${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre></td></tr>`;
  }).join("\n");
  fs.writeFileSync(filePath, `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui;margin:32px;max-width:1100px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8d8d8;padding:10px;text-align:left;vertical-align:top}th{width:260px;background:#f6f8fa}pre{margin:0;white-space:pre-wrap}.ubk{width:auto;margin:4px 0 12px}.ubk th{width:auto;background:#fff}h4{margin:12px 0 4px}</style><h1>${esc(title)}</h1><table>${rows}</table></html>\n`, "utf8");
}
module.exports = { writeHtmlReport };
