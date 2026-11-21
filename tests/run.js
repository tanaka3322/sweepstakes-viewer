"use strict";
// ローカルテスト（擬似Redis＋本物の server.js / api / lib をそのまま動かす）
//
//   node tests/run.js
//
// 見るもの:
//   - failed の設定・解除（× / 空欄 / true / false）
//   - 不正値は 400 bad_value、存在しないNoは 404 no_not_found
//   - 通常GETでも×は返る／?failed=1 で×だけ
//   - bulk で failed をまとめて更新（1件失敗しても他は通る）
//   - owner は変えない
//   - パッド（owner:"パッド"・pad:"1"/"2"/"3"）の設定・検証・一括更新・人別フィルター
//   - 既存72件（failed・pad未設定）が壊れない
//   - 画面の優先順位（やらない ＞ × ＞ 毎日応募 ＞ 未振り分け／応募済み／振り分け済み）と人別フィルター
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createFakeRedis } = require("./fake-redis");
const logic = require("../public/logic");

const ROOT = path.join(__dirname, "..");
const PASS = "kinako3150";

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push({ name, error: e });
    console.log("  NG  " + name + "\n      " + String((e && e.message) || e).split("\n").join("\n      "));
  }
}

function makeClient(base) {
  async function call(method, urlPath, body) {
    const opt = { method, headers: { "x-chat-passcode": PASS } };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(base + urlPath, opt);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: res.status, json };
  }
  return {
    get: (p) => call("GET", p),
    getNoPass: async (p) => {
      const res = await fetch(base + p);
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    },
    patch: (no, body) => call("PATCH", "/api/items/" + encodeURIComponent(no), body),
    post: (p, body) => call("POST", p, body),
    del: (no) => call("DELETE", "/api/items/" + encodeURIComponent(no)),
  };
}

async function waitForServer(child, url) {
  const started = Date.now();
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  while (Date.now() - started < 15000) {
    if (log.includes("http://localhost")) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start: " + log);
}

async function main() {
  const seedPath = path.join(ROOT, "data", "seed.json");
  const seedDoc = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const seedItems = seedDoc.items;

  // --- seed.json 自体の確認（既存72件が failed:"" で揃っているか） ---
  await test("seed.json は72件すべて failed:'' を持つ", () => {
    assert.strictEqual(seedItems.length, 72);
    assert.ok(seedItems.every((it) => it.failed === ""), "failed が無い項目がある");
    assert.ok(seedDoc.fields.includes("failed"));
  });

  const redis = createFakeRedis();
  const redisPort = await redis.listen();
  const appPort = 3299;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(appPort),
      KV_REST_API_URL: "http://127.0.0.1:" + redisPort,
      KV_REST_API_TOKEN: "test-token",
      SWEEP_PASSCODE: PASS,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = "http://127.0.0.1:" + appPort;
  let client = null;

  try {
    await waitForServer(child, base);
    client = makeClient(base);

    // 起点：移行直後と同じ72件をDBへ入れる（failed 未設定の既存データの再現）
    const legacy = seedItems.map((it) => {
      const copy = Object.assign({}, it);
      delete copy.failed;               // 既存DBには failed が無い状態
      return copy;
    });
    const imported = await client.post("/api/items", { items: legacy, mode: "replace", by: "test" });
    await test("既存72件（failed未設定）を投入できる", () => {
      assert.strictEqual(imported.status, 200);
      assert.strictEqual(imported.json.ok, true);
      assert.strictEqual(imported.json.count, 72);
    });

    const initial = await client.get("/api/items?include_hidden=1");
    await test("既存データは failed:'' として返る（72件・項目が増えても壊れない）", () => {
      assert.strictEqual(initial.status, 200);
      assert.strictEqual(initial.json.count, 72);
      assert.ok(initial.json.items.every((it) => it.failed === ""), "failed が '' でない項目がある");
    // pad は後から追加した項目。既存データに無くても '' として返り、エラーにならない
    assert.ok(initial.json.items.every((it) => it.pad === ""), "pad が '' でない項目がある");
      const no1 = initial.json.items.find((it) => it.no === "1");
      assert.strictEqual(no1.name, "ピルクル エイジングライフ-トリプル- 8本入り");
      assert.strictEqual(no1.owner, "むぎ");
    });

    await test("合言葉なしの書き込みは401 bad_passcode", async () => {
      const out = await client.getNoPass("/api/items");
      assert.strictEqual(out.status, 401);
      assert.strictEqual(out.json.error, "bad_passcode");
    });

    // --- failed の設定・解除 ---
    const before2 = initial.json.items.find((it) => it.no === "2");
    const set2 = await client.patch("2", { failed: "×", by: "test" });
    await test("PATCH で failed=× を設定でき、返却に failed が入る", () => {
      assert.strictEqual(set2.status, 200);
      assert.strictEqual(set2.json.item.failed, "×");
      assert.strictEqual(set2.json.item.no, "2");
    });

    await test("×にしても owner と他の項目は変わらない", () => {
      assert.strictEqual(set2.json.item.owner, before2.owner);
      assert.strictEqual(set2.json.item.name, before2.name);
      assert.strictEqual(set2.json.item.deadline, before2.deadline);
      assert.strictEqual(set2.json.item.daily, before2.daily);
      assert.strictEqual(set2.json.item.updated_by, "test");
    });

    const afterSet = await client.get("/api/items/2");
    await test("GET /api/items/2 で failed=× が読み戻せる", () => {
      assert.strictEqual(afterSet.status, 200);
      assert.strictEqual(afterSet.json.item.failed, "×");
    });

    const normalGet = await client.get("/api/items");
    await test("通常の GET /api/items でも×の案件は消えない", () => {
      assert.strictEqual(normalGet.status, 200);
      const hit = normalGet.json.items.find((it) => it.no === "2");
      assert.ok(hit, "No.2 が通常GETに無い");
      assert.strictEqual(hit.failed, "×");
    });

    const onlyFailed = await client.get("/api/items?failed=1");
    await test("GET /api/items?failed=1 は×だけを返す", () => {
      assert.strictEqual(onlyFailed.status, 200);
      assert.strictEqual(onlyFailed.json.count, 1);
      assert.deepStrictEqual(onlyFailed.json.items.map((it) => it.no), ["2"]);
      assert.ok(onlyFailed.json.items.every((it) => it.failed === "×"));
    });

    await test("PATCH {failed:''} で解除できる（?failed=1 が0件に戻る）", async () => {
      const out = await client.patch("2", { failed: "", by: "test" });
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.json.item.failed, "");
      const list = await client.get("/api/items?failed=1");
      assert.strictEqual(list.json.count, 0);
    });

    await test("true は×、false は空欄に正規化される", async () => {
      const on = await client.patch("3", { failed: true });
      assert.strictEqual(on.json.item.failed, "×");
      const off = await client.patch("3", { failed: false });
      assert.strictEqual(off.json.item.failed, "");
    });

    await test("不正値は 400 bad_value（○・△・2・null以外の数字）", async () => {
      for (const bad of ["○", "◯", "△", "2", "××"]) {
        const out = await client.patch("4", { failed: bad });
        assert.strictEqual(out.status, 400, "値 " + JSON.stringify(bad) + " が通ってしまった");
        assert.strictEqual(out.json.error, "bad_value");
      }
      const still = await client.get("/api/items/4");
      assert.strictEqual(still.json.item.failed, "");
    });

    await test("存在しないNoへの failed 設定は 404 no_not_found", async () => {
      const out = await client.patch("999", { failed: "×" });
      assert.strictEqual(out.status, 404);
      assert.strictEqual(out.json.error, "no_not_found");
    });

    // --- bulk ---
    const owner5 = (await client.get("/api/items/5")).json.item.owner;
    await test("bulk で failed をまとめて更新（1件失敗しても他は通る）", async () => {
      const out = await client.post("/api/items/bulk", {
        updates: [
          { no: "5", failed: "×" },
          { no: "6", failed: "×" },
          { no: "999", failed: "×" },
          { no: "7", failed: "△" },
        ],
        by: "bulk-test",
      });
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.json.requested, 4);
      assert.strictEqual(out.json.updated, 2);
      assert.strictEqual(out.json.failed.length, 2);
      const errs = out.json.failed.map((f) => f.no + ":" + f.error).sort();
      assert.deepStrictEqual(errs, ["7:bad_value", "999:no_not_found"]);
    });

    await test("bulk後の?failed=1 は No.5・No.6 の2件", async () => {
      const out = await client.get("/api/items?failed=1");
      assert.strictEqual(out.json.count, 2);
      assert.deepStrictEqual(out.json.items.map((it) => it.no).sort(), ["5", "6"]);
      const five = out.json.items.find((it) => it.no === "5");
      assert.strictEqual(five.owner, owner5);
    });

    await test("bulk で解除もできる", async () => {
      const out = await client.post("/api/items/bulk", {
        updates: [{ no: "5", failed: "" }, { no: "6", failed: "" }],
        by: "bulk-test",
      });
      assert.strictEqual(out.json.updated, 2);
      const list = await client.get("/api/items?failed=1");
      assert.strictEqual(list.json.count, 0);
    });

    // --- パッド ---
    const owner8 = (await client.get("/api/items/8")).json.item.owner;
    await test("PATCH で owner='パッド'・pad='1' を設定でき、読み戻せる", async () => {
      const out = await client.patch("8", { owner: "パッド", pad: "1", by: "test" });
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.json.item.owner, "パッド");
      assert.strictEqual(out.json.item.pad, "1");
      const got = await client.get("/api/items/8");
      assert.strictEqual(got.json.item.owner, "パッド");
      assert.strictEqual(got.json.item.pad, "1");
      assert.strictEqual(got.json.item.name, initial.json.items.find((it) => it.no === "8").name);
    });

    await test("pad は 2・3・空欄も受け付ける", async () => {
      const two = await client.patch("8", { pad: "2" });
      assert.strictEqual(two.json.item.pad, "2");
      const three = await client.patch("8", { pad: "3" });
      assert.strictEqual(three.json.item.pad, "3");
      const clear = await client.patch("8", { pad: "" });
      assert.strictEqual(clear.json.item.pad, "");
      await client.patch("8", { pad: "1" });
    });

    await test("pad の不正値は 400 bad_value（0・4・○・できる）", async () => {
      for (const bad of ["0", "4", "○", "できる"]) {
        const out = await client.patch("8", { pad: bad });
        assert.strictEqual(out.status, 400, "pad " + JSON.stringify(bad) + " が通ってしまった");
        assert.strictEqual(out.json.error, "bad_value");
      }
      const still = await client.get("/api/items/8");
      assert.strictEqual(still.json.item.pad, "1");
      assert.strictEqual(still.json.item.owner, "パッド");
    });

    await test("許可外の担当（ぱっど）は 400 bad_owner", async () => {
      const out = await client.patch("8", { owner: "ぱっど" });
      assert.strictEqual(out.status, 400);
      assert.strictEqual(out.json.error, "bad_owner");
      assert.ok(out.json.message.includes("パッド"), "エラー文言にパッドが無い");
    });

    await test("bulk で owner=パッド・pad をまとめて更新できる", async () => {
      const out = await client.post("/api/items/bulk", {
        updates: [
          { no: "9", owner: "パッド", pad: "2" },
          { no: "10", pad: "3" },
          { no: "11", pad: "9" },
        ],
        by: "bulk-test",
      });
      assert.strictEqual(out.status, 200);
      assert.strictEqual(out.json.updated, 2);
      assert.deepStrictEqual(out.json.failed.map((f) => f.no + ":" + f.error), ["11:bad_value"]);
      const nine = out.json.items.find((it) => it.no === "9");
      assert.strictEqual(nine.owner, "パッド");
      assert.strictEqual(nine.pad, "2");
    });

    // --- 新規追加 ---
    await test("新規追加（POST）で failed を指定でき、未指定なら ''", async () => {
      const made = await client.post("/api/items", {
        item: { name: "テスト用キャンペーン(failed)", sponsor: "テスト", deadline: "2026/12/31 23:59", failed: true },
        by: "test",
      });
      assert.strictEqual(made.status, 201);
      assert.strictEqual(made.json.item.failed, "×");
      const plain = await client.post("/api/items", {
        item: { name: "テスト用キャンペーン(通常)", sponsor: "テスト", deadline: "2026/12/31 23:59" },
        by: "test",
      });
      assert.strictEqual(plain.status, 201);
      assert.strictEqual(plain.json.item.failed, "");
      assert.strictEqual(plain.json.item.pad, "");
      const padded = await client.post("/api/items", {
        item: { name: "テスト用キャンペーン(パッド)", sponsor: "テスト", deadline: "2026/12/31 23:59", owner: "パッド", pad: "3" },
        by: "test",
      });
      assert.strictEqual(padded.status, 201);
      assert.strictEqual(padded.json.item.owner, "パッド");
      assert.strictEqual(padded.json.item.pad, "3");
      await client.del(made.json.item.no);
      await client.del(plain.json.item.no);
      await client.del(padded.json.item.no);
    });

    await test("不正な failed での新規追加は 400 bad_value", async () => {
      const out = await client.post("/api/items", {
        item: { name: "テスト用(不正)", sponsor: "テスト", deadline: "2026/12/31 23:59", failed: "○" },
        by: "test",
      });
      assert.strictEqual(out.status, 400);
      assert.strictEqual(out.json.error, "bad_value");
    });

    // --- 元に戻す（72件・failed は ''） ---
    const restored = await client.post("/api/items", { items: seedItems, mode: "replace", by: "test" });
    const final = await client.get("/api/items?include_hidden=1");
    await test("テスト後に72件・failed:'' へ戻せる", () => {
      assert.strictEqual(restored.json.count, 72);
      assert.strictEqual(final.json.count, 72);
      assert.ok(final.json.items.every((it) => it.failed === ""));
    });
  } finally {
    child.kill();
    await redis.close();
  }

  // ================= 画面ロジック（優先順位・人別フィルター） =================
  const now = new Date(2026, 10, 19, 12, 0, 0); // 2026-11-19 12:00
  const baseItem = { no: "1", name: "x", deadline: "2026/12/09 17:00", status: "未応募", owner: "むぎ", daily: "", failed: "" };

  await test("優先順位: やらない ＞ × ＞ 毎日応募", () => {
    const it = Object.assign({}, baseItem, { owner: "やらない", failed: "×", daily: "○" });
    assert.strictEqual(logic.tabOf(it, now), "skip");
  });

  await test("優先順位: × ＞ 毎日応募（×にした時点で毎日応募から×へ移る）", () => {
    const it = Object.assign({}, baseItem, { failed: "×", daily: "○", owner: "きなこ" });
    assert.strictEqual(logic.tabOf(it, now), "failed");
  });

  await test("毎日応募: daily=○ かつ締切当日まで", () => {
    assert.strictEqual(logic.tabOf(Object.assign({}, baseItem, { daily: "○" }), now), "daily");
    const today = Object.assign({}, baseItem, { daily: "○", deadline: "2026/11/19 23:59" });
    assert.strictEqual(logic.tabOf(today, now), "daily");
  });

  await test("毎日応募: 締切を過ぎたら毎日応募から外れる（未振り分けへ）", () => {
    const expired = Object.assign({}, baseItem, { daily: "○", deadline: "2026/11/18 23:59", owner: "未振り分け" });
    assert.strictEqual(logic.tabOf(expired, now), "unassigned");
  });

  await test("未振り分け／応募済み／振り分け済み", () => {
    assert.strictEqual(logic.tabOf(Object.assign({}, baseItem, { owner: "未振り分け" }), now), "unassigned");
    assert.strictEqual(logic.tabOf(Object.assign({}, baseItem, { owner: "むぎ", status: "応募済（2026/11/11 むぎ代行）" }), now), "done");
    assert.strictEqual(logic.tabOf(Object.assign({}, baseItem, { owner: "むぎ", status: "未応募" }), now), "assigned");
  });

  await test("人別フィルター: 全員／本人／むぎ／きなこ／パッド", () => {
    const list = [
      Object.assign({}, baseItem, { no: "1", owner: "本人" }),
      Object.assign({}, baseItem, { no: "2", owner: "むぎ" }),
      Object.assign({}, baseItem, { no: "3", owner: "きなこ" }),
      Object.assign({}, baseItem, { no: "4", owner: "未振り分け" }),
      Object.assign({}, baseItem, { no: "5", owner: "パッド", pad: "1" }),
    ];
    assert.deepStrictEqual(logic.OWNER_FILTERS, ["全員", "本人", "むぎ", "きなこ", "パッド"]);
    assert.strictEqual(logic.filterByOwner(list, "全員").length, 5);
    assert.deepStrictEqual(logic.filterByOwner(list, "むぎ").map((it) => it.no), ["2"]);
    assert.deepStrictEqual(logic.filterByOwner(list, "本人").map((it) => it.no), ["1"]);
    assert.deepStrictEqual(logic.filterByOwner(list, "きなこ").map((it) => it.no), ["3"]);
    assert.deepStrictEqual(logic.filterByOwner(list, "パッド").map((it) => it.no), ["5"]);
  });

  await test("担当パッドの案件は「振り分け済み」に入り、人別フィルターの件数になる", () => {
    const list = [
      Object.assign({}, baseItem, { no: "1", owner: "パッド", pad: "1" }),
      Object.assign({}, baseItem, { no: "2", owner: "パッド", pad: "2" }),
      Object.assign({}, baseItem, { no: "3", owner: "むぎ" }),
      Object.assign({}, baseItem, { no: "4", owner: "パッド", failed: "×" }),
      Object.assign({}, baseItem, { no: "5", owner: "パッド", status: "応募済（2026/11/20 パッド代行）" }),
    ];
    assert.strictEqual(logic.tabOf(list[0], now), "assigned");
    assert.strictEqual(logic.tabOf(list[3], now), "failed");
    assert.strictEqual(logic.tabOf(list[4], now), "done");
    const assigned = list.filter((it) => logic.tabOf(it, now) === "assigned");
    assert.strictEqual(logic.filterByOwner(assigned, "パッド").length, 2);
    const failed = list.filter((it) => logic.tabOf(it, now) === "failed");
    assert.strictEqual(logic.filterByOwner(failed, "パッド").length, 1);
  });

  await test("並び順: 締切が近い順・期限切れは末尾", () => {
    const list = logic.decorate([
      Object.assign({}, baseItem, { no: "a", deadline: "2026/12/09 17:00" }),
      Object.assign({}, baseItem, { no: "b", deadline: "2026/11/20 23:59" }),
      Object.assign({}, baseItem, { no: "c", deadline: "2026/11/10 23:59" }),
      Object.assign({}, baseItem, { no: "d", deadline: "2026/11/25 23:59" }),
    ], now);
    assert.deepStrictEqual(logic.sortForList(list).map((it) => it.no), ["b", "d", "a", "c"]);
  });

  // 画面HTMLの構造（タブ・フィルター・ボタンの取りこぼし防止）
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  await test("画面: ×タブ・人別フィルター・×ボタン・ロジック読み込みがある", () => {
    assert.ok(html.includes('data-tab="failed"'), "×タブが無い");
    assert.ok(html.includes('id="filter"'), "人別フィルターが無い");
    for (const who of ["全員", "本人", "むぎ", "きなこ", "パッド"]) {
      assert.ok(html.includes('data-filter="' + who + '"'), "フィルター " + who + " が無い");
    }
    assert.ok(html.includes('data-filter="パッド">パッド<span class="cnt">-</span></button>'), "パッドのフィルターボタンが仕様どおりでない");
    assert.ok(html.includes("× できなかった"), "×ボタンが無い");
    assert.ok(html.includes("×を解除"), "×を解除ボタンが無い");
    assert.ok(html.includes('src="logic.js"'), "logic.js を読んでいない");
  });

  await test("画面: 担当ボタンにパッドがあり、pad の可否を読んでラベルを付ける", () => {
    assert.ok(html.includes('const OWNER_CHOICES = ["本人", "むぎ", "きなこ", "パッド"];'), "OWNER_CHOICES にパッドが無い");
    assert.ok(html.includes('if(who === "パッド") return String(it.pad ?? "").trim();'), "capVal が pad を見ていない");
    assert.ok(html.includes("むぎ・きなこ・パッド欄"), "凡例がパッドを説明していない");
  });

  console.log("");
  console.log("passed " + passed + " / " + (passed + failures.length));
  if (failures.length) {
    console.log("FAILED:");
    for (const f of failures) console.log(" - " + f.name);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("テスト実行に失敗:", e);
  process.exit(1);
});
