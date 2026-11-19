// ローカル検証用サーバー（本番は Vercel 等の静的配信でよい）
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
http.createServer((req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(3211, () => console.log("http://localhost:3211"));
