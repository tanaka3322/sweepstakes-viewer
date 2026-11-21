"use strict";
// 画面を目で見るためのローカル確認用（擬似Redis＋server.js を同じプロセスで起動）
//
//   node tools/preview.js        → http://127.0.0.1:3211
//
// 本番DBには触らない。Ctrl+C で終了。
const path = require("path");
const { spawn } = require("child_process");
const { createFakeRedis } = require("../tests/fake-redis");

(async () => {
  const redis = createFakeRedis();
  const redisPort = await redis.listen();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: Object.assign({}, process.env, {
      PORT: process.env.PORT || "3211",
      KV_REST_API_URL: "http://127.0.0.1:" + redisPort,
      KV_REST_API_TOKEN: "preview",
      SWEEP_PASSCODE: "kinako3150",
    }),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const stop = async () => { child.kill(); await redis.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", stop);

  // カウンターを本番と同じ 60 にしておく（プレビュー用の擬似DBなので本番には影響しない）
  setTimeout(async () => {
    try {
      await fetch("http://127.0.0.1:" + (process.env.PORT || "3211") + "/api/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-chat-passcode": "kinako3150" },
        body: JSON.stringify({ set: 60, by: "プレビュー" }),
      });
    } catch (e) { /* preview only */ }
  }, 800);
})();
