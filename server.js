// ローカル検証用サーバー（本番は Vercel：public を静的配信し、api/ を Serverless Function として動かす）
//
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node server.js
//   → http://localhost:3211
//
// DBの環境変数が無いと /api/items は 500（db_not_configured）を返す。
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8" };

const itemsIndex = require("./api/items/index");
const itemsOne = require("./api/items/[no]");
const itemsBulk = require("./api/items/bulk");

// Vercel のファイル配置に合わせた簡易ルーティング
//   /api/items        → api/items/index.js
//   /api/items/bulk   → api/items/bulk.js（静的な名前が優先）
//   /api/items/<no>   → api/items/[no].js
function route(pathname) {
  if (pathname === "/api/items" || pathname === "/api/items/") return { handler: itemsIndex, params: {} };
  if (pathname === "/api/items/bulk") return { handler: itemsBulk, params: {} };
  const m = pathname.match(/^\/api\/items\/([^/]+)\/?$/);
  if (m) return { handler: itemsOne, params: { no: decodeURIComponent(m[1]) } };
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const hit = route(url.pathname);
  if (hit) {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const query = Object.assign(Object.fromEntries(url.searchParams.entries()), hit.params);
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch (e) { body = raw; } }
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); return res; };
      Promise.resolve(hit.handler({ method: req.method, headers: req.headers, query, body, url: req.url }, res))
        .catch((e) => { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); } });
    });
    return;
  }
  const p = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.listen(Number(process.env.PORT) || 3211, () => console.log("http://localhost:" + (Number(process.env.PORT) || 3211)));
