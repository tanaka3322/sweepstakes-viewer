# 懸賞スマホ専用ページ（DB版）sweepstakes-viewer

共通スプレッドシート「懸賞_共通応募リスト」を **データベース** に移し、
iPhone向けカード画面から見る／担当を決めるためのページです。
Googleスプレッドシート＋Apps Script 中継は使いません（v1.0 / 2026-11-19 移行）。

- リポジトリ：https://github.com/tanaka3322/sweepstakes-viewer （public）
- 公開URL：https://sweepstakes-viewer.vercel.app/ （main へ push すると自動で再デプロイ）
- 保存先：Vercel Storage の **Upstash Redis**（リソース名 `sweepstakes-kv`／東京 hnd1／Free プラン）
- API：`https://sweepstakes-viewer.vercel.app/api/sweepstakes`

## しくみ

```
iPhone (public/index.html)
    │  fetch  /api/sweepstakes   （GET=読む / PATCH=担当を変える）
    ▼
Vercel Serverless Function  api/sweepstakes.js
    │  Redis REST（環境変数 KV_REST_API_URL / KV_REST_API_TOKEN）
    ▼
Upstash Redis
    sweep:items … ハッシュ。フィールド=No、値=1件分のJSON
    sweep:meta  … 最終更新時刻など
```

- 1件＝1フィールドで持つので、むぎときなこが別の案件を同時に更新しても消し合わない。
- 画面は毎回APIから取り直す（キャッシュ無効）。「最新を読み込む」ボタンでも再取得できる。
- スプレッドシートは**もう更新しません**。移行時点の内容を `data/seed.json`（72件）に控えてある。
  シートは読み取り専用の控えとして残している。

## API仕様（きなこ・むぎ共通）

共通の約束：

- 形式はJSON。読み取り（GET）は合言葉なしでOK。書き込みは合言葉が必要。
- 合言葉は `x-sweep-passcode: <合言葉>` ヘッダー、または本文の `passcode` で渡す。
- 合言葉の初期値は `kinako3150`（Vercel の環境変数 `SWEEP_PASSCODE` で変更可）。
- 書き込みの `by` に「きなこ」「むぎ」などを入れると、最終更新者として `sweep:meta` に残る。
- 応答はすべて `Cache-Control: no-store`。

| メソッド | URL | 用途 | 本文の例 |
|---|---|---|---|
| GET | `/api/sweepstakes` | 全件取得 | — |
| GET | `/api/sweepstakes?no=12` | 1件取得 | — |
| GET | `/api/sweepstakes?health=1` | DB接続の確認 | — |
| PATCH | `/api/sweepstakes?no=12` | 1件の項目を更新 | `{"passcode":"…","owner":"むぎ","by":"きなこ"}` |
| POST | `/api/sweepstakes` | 1件追加（Noは自動採番） | `{"passcode":"…","item":{"name":"…","sponsor":"…"},"by":"きなこ"}` |
| PUT | `/api/sweepstakes` | まとめて投入（移行・復旧） | `{"passcode":"…","items":[…],"mode":"replace"}` |
| DELETE | `/api/sweepstakes?no=12` | 1件削除 | ヘッダーに合言葉 |

### 項目（16個）

`no`（キー・変更不可）、`name` キャンペーン名、`sponsor` 主催、`prize` 賞品・当選人数、
`deadline` 締切、`decision` やるかどうか、`category` 分類、`agent_can` きなこ・むぎができること、
`user_must` 本人がやること、`status` 応募状況、`url` 公式URL、`evidence` 根拠・確認状況、
`owner` 担当、`mugi` むぎ可否、`kinako` きなこ可否、`daily` 毎日応募。

- `owner` は `本人` / `むぎ` / `きなこ` / `やらない` / `未振り分け` のいずれか。
- `mugi`・`kinako` は `1`（できる）/ `2`（たぶんできる・未検証）/ `3`（絶対にできない）/ 空欄。
- `daily` は `○` か空欄。

### 例（curl）

```bash
# 読む
curl -s 'https://sweepstakes-viewer.vercel.app/api/sweepstakes' | head -c 400

# 担当を「むぎ」にする
curl -s -X PATCH 'https://sweepstakes-viewer.vercel.app/api/sweepstakes?no=12' \
  -H 'Content-Type: application/json' \
  -d '{"passcode":"kinako3150","owner":"むぎ","by":"きなこ"}'

# 応募状況を更新する（項目は部分的に送ればOK）
curl -s -X PATCH 'https://sweepstakes-viewer.vercel.app/api/sweepstakes?no=1' \
  -H 'Content-Type: application/json' \
  -d '{"passcode":"kinako3150","changes":{"status":"応募済（2026/11/20 きなこ代行）"},"by":"きなこ"}'

# 1件追加する（Noは自動で振られる）
curl -s -X POST 'https://sweepstakes-viewer.vercel.app/api/sweepstakes' \
  -H 'Content-Type: application/json' \
  -d '{"passcode":"kinako3150","item":{"name":"新キャンペーン","sponsor":"主催社","deadline":"2026/12/31 23:59"},"by":"きなこ"}'
```

### エラー

`401 bad_passcode` / `400 bad_owner` / `400 bad_capability` / `404 no_not_found` /
`504 db_timeout` / `500 db_not_configured` を返す。`message` に日本語の説明が入る。

## 画面

- タブは5つ：**未振り分け / 振り分け済み / 応募済み / 毎日応募 / やらない**。
  どのタブにも件数を表示し、0件のときは「未振り分けは0件です（全件どれかの担当に振り分け済み）」と
  件数のあるタブへのボタンを出す。
- カード：左上 `No.○`、名前、主催／賞品、締切（今日締切は赤、あと3日以内はオレンジ、期限切れは灰色）、
  応募状況、担当、分類、本人がやること、公式URLボタン。
- 担当ボタン：`本人` / `むぎ` / `きなこ` ＋ `やらない`。
  色はその人の可否（`mugi`・`kinako` 欄の 1=青 / 2=黄 / 3=赤、未入力=色なし）。
  **いまの担当は太い黒枠**で示す（色は可否の意味なので枠で区別）。
- 押した瞬間に画面へ反映し、DBへの書き込みが10秒でタイムアウトしたとき・失敗したときは
  **元の担当に戻して**「更新できませんでした：理由」と「最新を読み込み直す」ボタンを出す。
  書き込み中はそのカードの4ボタンを押せなくする（連打の二重書き込み防止）。
- 「やらない」は**確認ダイアログ**を出してから移動。押した案件は「やらない」タブに残り、
  そこで `本人`／`むぎ`／`きなこ` を押せば戻せる。
- 期限切れの案件は各タブの**末尾**にまとめ、薄く表示する。
- 検索はキャンペーン名・主催が対象。

## データの移行・復旧

```bash
# シート最終状態（72件）をDBへ投入（置き換え）
BASE=https://sweepstakes-viewer.vercel.app PASS=kinako3150 ./tools/import_seed.sh

# 件数・全項目が seed と一致するか検証
BASE=https://sweepstakes-viewer.vercel.app python3 tools/verify_seed.py
```

`data/seed.json` は2026-11-19時点のシート内容（72件・16列）そのもの。
`MODE=merge` を付けると、seed に無いNoは残したまま投入する。

## ローカル確認

```bash
KV_REST_API_URL=... KV_REST_API_TOKEN=... npm start   # → http://localhost:3211
```

## 旧構成からの変更点（v0.5.2 → v1.0）

| 旧 | 新 |
|---|---|
| 画面が Google シートの gviz を直読み＋スナップショット `data.js` | 自サイトの `/api/sweepstakes` から取得（キャッシュ無効） |
| 担当の書き込みは Apps Script 中継 | Serverless Function が Upstash Redis へ直接書き込み |
| スナップショット生成 `tools/build_data.py` | 不要（DBが正）。`data/seed.json` は移行・復旧用 |

`apps-script/`（中継）は役目を終えたので削除した。

## 注意

- ページは「見る・担当を決める・公式URLへ飛ぶ」まで。応募の自動送信・個人情報の入力は行わない。
- 保存しているのは懸賞リストの16項目だけで、氏名・住所・電話などの個人情報は含まない。
- 書き込みの合言葉は画面の `public/config.js` に入っている（3人だけが使う前提の簡易な門）。
  外部に広げたくなったら Vercel の `SWEEP_PASSCODE` を変え、`config.js` ときなこ側の設定も同じ値にそろえる。
- 作品系（分類④）は生成AI禁止のため、作句・執筆支援機能は入れない。
