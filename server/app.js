"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadData, projectRoot } = require("./services/dataService");
const { handleAiRoute } = require("./routes/ai");

function loadEnv() {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  });
}

loadEnv();
const data = loadData();
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 65536) { reject(new Error("Request body is too large")); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
    request.on("error", reject);
  });
}

function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""));
  const target = path.resolve(projectRoot, requested);
  if (!target.startsWith(projectRoot + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return false;
  // UI JavaScript and the small news preview must always be refreshed during
  // development. Otherwise an already-open browser can continue running an
  // older script and show the old sample news cards.
  const noStoreFiles = new Set([
    "index.html",
    "script.js",
    "style.css",
    "data/university-news-preview.json",
    "data/university-news-latest-report.json",
    "data/university-news-trial-status.json"
  ]);
  const headers = {
    "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream"
  };
  if (noStoreFiles.has(requested)) headers["Cache-Control"] = "no-store, max-age=0";
  response.writeHead(200, headers);
  fs.createReadStream(target).pipe(response);
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
    return response.end();
  }
  if (request.method === "POST" && url.pathname.startsWith("/api/")) {
    try {
      const route = await handleAiRoute(url.pathname, await readBody(request), data);
      if (!route) return sendJson(response, 404, { error: "Not found" });
      return sendJson(response, route.status, route.payload);
    } catch (error) {
      console.error(error);
      return sendJson(response, 500, { error: "추천 기능을 불러오지 못했습니다." });
    }
  }
  if (!serveStatic(url.pathname, response)) sendJson(response, 404, { error: "Not found" });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`UNI PICK server: http://localhost:${port} (universities: ${data.universities.length}, majors: ${data.majors.length})`));
