# 懸賞スマホ専用ページ（DB版）sweepstakes-viewer

共通スプレッドシート「懸賞_共通応募リスト」を **データベース** に移し、
iPhone向けカード画面から見る／担当を決めるためのページです。
Googleスプレッドシート＋Apps Script 中継は使いません（v1.0 / 2026-11-19 移行）。

- リポジトリ：https://github.com/tanaka3322/sweepstakes-viewer （public）
- 公開URL：https://sweepstakes-viewer.vercel.app/
- API：https://sweepstakes-viewer.vercel.app/api/items
- 保存先：Vercel Storage の **Upstash Redis**（リソース名 `sweepstakes-kv`／東京 hnd1／Free プラン）

## しくみ

```
iPhone (public/index.html)
    │  fetch  /api/items   （GET=読む / PATCH=担当や状況を変える）
    ▼
Vercel Serverless Function  api/items/*
    │  Redis REST（環境変数 KV_REST_API_URL / KV_REST_API_TOKEN）
    ▼
Upstash Redis
    sweep:items … ハッシュ。フィールド=No、値=1件分のJSON
    sweep:meta  … 最終更新時刻・最終更新者など
```

- 1件＝1フィールドで持つので、むぎときなこが別々の案件を同時に更新しても消し合わない。
- 画面は毎回APIから取り直す（キャッシュ無効）。「最新を読み込む」ボタンでも再取得できる。
- スプレッドシートはもう更新しない。移行時点の内容を `data/seed.json`（72件）に控えてある。
  シートは読み取り専用の控えとして残している。

## API仕様（確定版）

### 共通

- ベースURL：`https://sweepstakes-viewer.vercel.app/api/items`
- 認証：ヘッダー **`x-chat-passcode: kinako3150`**（不一致は `{"ok":false,"error":"bad_passcode"}` / HTTP 401）
  - 合言葉は Vercel の環境変数 `SWEEP_PASSCODE` で変更可。変えたら `public/config.js` と きなこ側も同じ値に。
  - 旧ヘッダー `x-sweep-passcode` も受け付ける。本文の `passcode` でも可（互換用）。
- 形式：JSON（UTF-8）。成功 `{"ok":true,…}`／失敗 `{"ok":false,"error":"コード","message":"日本語の説明"}`
- 応答はすべて `Cache-Control: no-store`。
- 書き込み時の `by` に「きなこ」「むぎ」などを入れると、最終更新者として残る。

### 項目（17項目＋updated_at）

| キー | 意味 | 値 |
|---|---|---|
| `no` | No（キー。作成後は変更不可） | "1"〜 |
| `name` | キャンペーン名 | 文字列（必須） |
| `sponsor` | 主催企業 | 文字列 |
| `prize` | 賞品・当選人数 | 文字列 |
| `deadline` | 締切 | `2026/11/30 23:59` 等の文字列 |
| `decision` | やるかどうか | 文字列 |
| `category` | 分類 | `①完全代行` など |
| `agent_can` | きなこ・むぎができること | 文字列 |
| `user_must` | 本人がやること | 文字列 |
| `status` | 応募状況 | `未応募` / `応募済…` など |
| `url` | 公式URL | http(s) |
| `evidence` | 根拠・確認状況 | 文字列 |
| `owner` | 担当 | `""` / `未振り分け` / `本人` / `むぎ` / `きなこ` / `やらない` / `応募しない`（他は `bad_owner`） |
| `mugi` | むぎ可否 | `""` / `"1"`（できる）/ `"2"`（たぶんできる）/ `"3"`（できない） |
| `kinako` | きなこ可否 | 同上 |
| `daily` | 毎日応募 | `"○"` / `""`（`true`/`false` も受付、返却は `"○"`/`""`） |
| `failed` | できなかった（×） | `"×"`（応募しようとしてできなかった）/ `""`（通常）。`true`/`false` も受付、返却は `"×"`/`""`。**owner は変えない**（誰ができなかったかは owner で判断）。理由は `evidence` に追記する運用 |
| `updated_at` | 更新時刻 | ISO8601（サーバーが付ける） |

個人情報の項目は作らない。

### エンドポイント

| メソッド | URL | 用途 |
|---|---|---|
| GET | `/api/items` | 全件取得。`?q=` 名前・主催の部分一致、`?include_hidden=1` で「やらない」「応募しない」も含む（既定は除外）、`?failed=1` で `failed==="×"` のものだけ。**×は通常の取得でも返る**（非表示にしない） |
| GET | `/api/items/:no` | 1件取得 → `{ok:true,item}` |
| POST | `/api/items` | 新規追加。`no` 省略時は自動採番。`name+url+deadline` が同じなら `{ok:false,error:"duplicate",no:"既存No"}`（HTTP 409）。成功は 201 で `{ok:true,item}` |
| PATCH | `/api/items/:no` | 部分更新。送った項目だけ変更し、更新後の1件全体を `{ok:true,item}` で返す |
| POST | `/api/items/bulk` | 一括更新 `{updates:[{no,…},…]}` → `{ok:true,requested,updated,failed:[{no,error}],items:[…]}`。1件の失敗で他は巻き戻さない |
| DELETE | `/api/items/:no` | 削除（誤登録の取り消し用）→ `{ok:true,deleted}` |
| GET | `/api/items?health=1` | DB接続の確認（合言葉不要。`{ok,backend,configured,reachable,itemCount}`） |
| POST | `/api/items`（`{items:[…],mode:"replace"\|"merge"}`） | まとめて投入（移行・復旧用。人が使う想定） |

### エラーコード

`bad_passcode`(401) / `bad_owner`(400) / `bad_value`(400) / `bad_no`(400) / `bad_name`(400) /
`no_changes`(400) / `no_not_found`(404) / `duplicate`(409) / `duplicate_no`(409) /
`db_timeout`(504) / `db_not_configured`(500) / `db_error`(502)

`failed` の不正値（`○`・`△`・`2` など）も `bad_value`(400)。

### 例（curl）

```bash
# 読む（全件・非表示も含む）
curl -s -H 'x-chat-passcode: kinako3150' \
  'https://sweepstakes-viewer.vercel.app/api/items?include_hidden=1'

# 名前で絞る
curl -s -H 'x-chat-passcode: kinako3150' \
  'https://sweepstakes-viewer.vercel.app/api/items?q=%E3%83%94%E3%83%AB%E3%82%AF%E3%83%AB'

# 担当を「むぎ」にする
curl -s -X PATCH 'https://sweepstakes-viewer.vercel.app/api/items/12' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"owner":"むぎ","by":"きなこ"}'

# 応募状況を更新する
curl -s -X PATCH 'https://sweepstakes-viewer.vercel.app/api/items/1' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"status":"応募済（2026/11/20 きなこ代行）","by":"きなこ"}'

# 1件追加（Noは自動）
curl -s -X POST 'https://sweepstakes-viewer.vercel.app/api/items' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"item":{"name":"新キャンペーン","sponsor":"主催社","deadline":"2026/12/31 23:59"},"by":"きなこ"}'

# 一括更新（1件だけ失敗しても他は通る）
curl -s -X POST 'https://sweepstakes-viewer.vercel.app/api/items/bulk' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"updates":[{"no":"2","owner":"きなこ"},{"no":"999","owner":"むぎ"}],"by":"きなこ"}'
# → {"ok":true,"requested":2,"updated":1,"failed":[{"no":"999","error":"no_not_found"}],...}

# 「×（できなかった）」にする／解除する
curl -s -X PATCH 'https://sweepstakes-viewer.vercel.app/api/items/7' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"failed":"×","by":"きなこ"}'
curl -s -X PATCH 'https://sweepstakes-viewer.vercel.app/api/items/7' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"failed":"","by":"きなこ"}'

# ×の案件だけ取得
curl -s -H 'x-chat-passcode: kinako3150' \
  'https://sweepstakes-viewer.vercel.app/api/items?failed=1'
```

## 画面

- タブは6つ：**未振り分け / 振り分け済み / 応募済み / 毎日応募 / × できなかった / やらない**。
  どのタブにも件数を表示し、0件のときは「未振り分けは0件です（全件どれかの担当に振り分け済み）」と
  件数のあるタブへのボタンを出す。
- 振り分けの決まり（優先順位）：非表示（`owner` が「やらない」「応募しない」）→「やらない」タブ／
  `failed==="×"` →「×」タブ／毎日応募（`daily=="○"` かつ締切当日まで）→「毎日応募」／
  担当なし（`owner`が空・未振り分け・未定・保留）→「未振り分け」／
  担当あり＋`status`が「応募済」で始まる→「応募済み」／それ以外→「振り分け済み」。
  ×にした時点で、毎日応募の案件もいったん×タブへ移る。
- カード：左上 `No.○`、名前、主催／賞品、締切（今日締切は赤、あと3日以内はオレンジ、期限切れは灰色）、
  応募状況、担当、分類、本人がやること、公式URLボタン。
- 担当ボタン：`本人` / `むぎ` / `きなこ` ＋ `やらない` ＋ `× できなかった`。
  色はその人の可否（`mugi`・`kinako` の 1=青 / 2=黄 / 3=赤、未入力=色なし）。
  **いまの担当は太い黒枠**で示す（色は可否の意味なので枠で区別）。
- `× できなかった`：確認ダイアログのうえ `failed="×"` にして×タブへ移す（担当はそのまま）。
  ×タブ内では「×を解除」で `failed=""` に戻せる。
- 人別フィルター：**振り分け済み**タブと**×**タブに `全員／本人／むぎ／きなこ` のボタン。
  押した人の案件だけを表示し、件数バッジも人別に切り替わる（並びは締切が近い順・期限切れ末尾のまま）。
- 押した瞬間に画面へ反映し、書き込みが10秒でタイムアウトしたとき・失敗したときは
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

`data/seed.json` は2026-11-19時点のシート内容（72件・17項目、`failed` は全て空欄）そのもの。
`MODE=merge` を付けると、seed に無いNoは残したまま投入する。

## ローカル確認

```bash
KV_REST_API_URL=... KV_REST_API_TOKEN=... npm start   # → http://localhost:3211
npm test                                                # 擬似RedisでAPIと画面ロジックを検証
```

`tests/run.js` は擬似Redis（`tests/fake-redis.js`）を立てて本物の `server.js` / `api/` / `lib/` を
そのまま動かすので、Upstash の実データを汚さずに failed の設定・解除・バリデーション・
`?failed=1`・bulk・振り分け優先順位・人別フィルターを確認できる。

## 旧構成からの変更点（v0.5.2 → v1.0）

| 旧 | 新 |
|---|---|
| 画面が Google シートの gviz を直読み＋スナップショット `data.js` | 自サイトの `/api/items` から取得（キャッシュ無効） |
| 担当の書き込みは Apps Script 中継 | Serverless Function が Upstash Redis へ直接書き込み |
| スナップショット生成 `tools/build_data.py` | 不要（DBが正）。`data/seed.json` は移行・復旧用 |

`apps-script/`（中継）は役目を終えたので削除した。

## 注意

- ページは「見る・担当を決める・公式URLへ飛ぶ」まで。応募の自動送信・個人情報の入力は行わない。
- 保存しているのは懸賞リストの16項目だけで、氏名・住所・電話などの個人情報は含まない。
- 書き込みの合言葉は画面の `public/config.js` に入っている（3人だけが使う前提の簡易な門）。
  外部に広げたくなったら Vercel の `SWEEP_PASSCODE` を変え、`config.js` ときなこ側の設定も同じ値にそろえる。
- 作品系（分類④）は生成AI禁止のため、作句・執筆支援機能は入れない。
