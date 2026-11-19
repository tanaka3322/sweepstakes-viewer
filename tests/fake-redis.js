"use strict";
// テスト用の擬似 Redis（Upstash REST API の最小実装）
//
// 本物の Upstash を使わずに、lib/store.js と api/ の中身をそのまま動かすため、
// POST /（1コマンド）と POST /pipeline（複数コマンド）だけを実装する。
const http = require("http");

function createFakeRedis() {
  const strings = new Map();   // key -> string
  const hashes = new Map();    // key -> Map(field -> value)

  function hash(key) {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  }

  function run(cmd) {
    if (!Array.isArray(cmd) || !cmd.length) return { error: "ERR empty command" };
    const name = String(cmd[0]).toUpperCase();
    const args = cmd.slice(1).map((v) => String(v));
    try {
      switch (name) {
        case "PING":
          return { result: "PONG" };
        case "GET":
          return { result: strings.has(args[0]) ? strings.get(args[0]) : null };
        case "SET":
          strings.set(args[0], args[1]);
          return { result: "OK" };
        case "DEL": {
          let n = 0;
          for (const k of args) {
            if (strings.delete(k)) n += 1;
            if (hashes.delete(k)) n += 1;
          }
          return { result: n };
        }
        case "HGET":
          return { result: hash(args[0]).has(args[1]) ? hash(args[0]).get(args[1]) : null };
        case "HGETALL": {
          const out = [];
          for (const [f, v] of hash(args[0])) out.push(f, v);
          return { result: out };
        }
        case "HSET": {
          const h = hash(args[0]);
          let n = 0;
          for (let i = 1; i + 1 < args.length; i += 2) {
            if (!h.has(args[i])) n += 1;
            h.set(args[i], args[i + 1]);
          }
          return { result: n };
        }
        case "HDEL": {
          const h = hash(args[0]);
          let n = 0;
          for (const f of args.slice(1)) if (h.delete(f)) n += 1;
          return { result: n };
        }
        case "RENAME": {
          const from = args[0], to = args[1];
          if (!hashes.has(from) && !strings.has(from)) return { error: "ERR no such key" };
          if (hashes.has(from)) { hashes.set(to, hashes.get(from)); hashes.delete(from); }
          if (strings.has(from)) { strings.set(to, strings.get(from)); strings.delete(from); }
          return { result: "OK" };
        }
        default:
          return { error: "ERR unknown command " + name };
      }
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const send = (obj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method !== "POST") { res.writeHead(405); res.end("method not allowed"); return; }
      let body = null;
      try { body = JSON.parse(raw); } catch (e) { res.writeHead(400); res.end("bad json"); return; }
      if (String(req.url || "").replace(/\/+$/, "") === "/pipeline") {
        const list = Array.isArray(body) ? body : [];
        send(list.map((c) => run(c)));
        return;
      }
      send(run(body));
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createFakeRedis };
