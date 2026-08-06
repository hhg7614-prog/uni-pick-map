"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadData, projectRoot } = require("./services/dataService");
const { handleAiRoute } = require("./routes/ai");
const newsConfig = require("./config/newsConfig");
const { createNewsRepository } = require("./news/repositories/newsRepository");
const { createUniversityNewsService } = require("./news/services/universityNewsService");
const { handleUniversityNewsRoute } = require("./news/routes/universityNewsRoutes");

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
const newsRepository = createNewsRepository(data.sampleUniversityNews);
const newsService = createUniversityNewsService({
  repository: newsRepository,
  universities: data.universities,
  config: newsConfig,
  sourceEntries: Array.isArray(data.universityNewsSources.items) ? data.universityNewsSources.items : [],
});
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
  if (requested === "news-bootstrap.js") {
    const developmentItems = process.env.NODE_ENV === "production" ? [] : data.sampleUniversityNews;
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    response.end(`window.UNI_PICK_DEVELOPMENT_NEWS=${JSON.stringify(developmentItems)};`);
    return true;
  }
  if (requested === "universities.js") {
    const universitiesSource = fs.readFileSync(path.join(projectRoot, "universities.js"), "utf8");
    const developmentItems = process.env.NODE_ENV === "production" ? [] : data.sampleUniversityNews;
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    response.end(`${universitiesSource}\nwindow.UNI_PICK_DEVELOPMENT_NEWS=${JSON.stringify(developmentItems)};`);
    return true;
  }
  if (requested === "news-ui-v2.js") {
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    response.end(fs.readFileSync(path.join(projectRoot, "script.js"), "utf8"));
    return true;
  }
  const target = path.resolve(projectRoot, requested);
  if (!target.startsWith(projectRoot + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return false;
  response.writeHead(200, { "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(target).pipe(response);
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
    return response.end();
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/")) {
    try {
      const route = handleUniversityNewsRoute(url.pathname, url.searchParams, newsService);
      if (route) return sendJson(response, route.status, route.payload);
      return sendJson(response, 404, { error: "Not found" });
    } catch {
      return sendJson(response, 500, { error: "학교 소식 정보를 불러오지 못했습니다." });
    }
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
