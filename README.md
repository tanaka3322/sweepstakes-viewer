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
    sweep:counter … 応募キリ番カウンター（応募した数）のJSON
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

### 項目（18項目＋updated_at）

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
| `owner` | 担当 | `""` / `未振り分け` / `本人` / `むぎ` / `きなこ` / `パッド` / `やらない` / `応募しない`（他は `bad_owner`） |
| `mugi` | むぎ可否 | `""` / `"1"`（できる）/ `"2"`（たぶんできる）/ `"3"`（できない） |
| `kinako` | きなこ可否 | 同上 |
| `pad` | パッド可否 | 同上（後から追加した項目。未設定の既存データは `""` として扱う） |
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
| GET | `/api/counter` | 応募キリ番カウンター（応募した数）を取得 |
| POST / PATCH | `/api/counter` | カウンターの加算・数値合わせ（下の「応募キリ番カウンター」参照） |

### エラーコード

`bad_passcode`(401) / `bad_owner`(400) / `bad_value`(400) / `bad_no`(400) / `bad_name`(400) /
`no_changes`(400) / `no_not_found`(404) / `duplicate`(409) / `duplicate_no`(409) /
`bad_counter`(400) / `counter_negative`(400) / `counter_conflict`(409) /
`db_timeout`(504) / `db_not_configured`(500) / `db_error`(502)

`failed` の不正値（`○`・`△`・`2` など）も `bad_value`(400)。`mugi`・`kinako`・`pad` の可否も同じく
`""`／`"1"`／`"2"`／`"3"` 以外は `bad_value`(400)。

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

## 応募キリ番カウンター（`/api/counter`）

「応募した数」を数える独立のカウンター。懸賞リストの件数とは別に持ち、
画面の**いちばん上（`🎯 応募キリ番カウンター`）**に、黒い液晶＋メタリック枠の
**7セグLED風デジタル数字（6桁ゼロ埋め・例 `000060`）** で大きく表示する。

- **画面は表示専用**。＋1・まとめて加算・数値合わせのボタンや入力欄は置いていない。
  数字を動かすのは API（下の「呼び方」）だけで、きなこ・パッド・むぎがそれぞれの道具から加算・設定する。
- 画面は `GET /api/counter` を読むだけで、書き込み（POST/PATCH）は一切しない。
  読むたびに「次のキリ番 ○○ まであと ○○ 件」（キリ番なら「🎉 キリ番 ○○ 達成！」）、
  最終更新の時刻と更新者（`updated_at` / `updated_by`）を控えめに添える。

- 保存先は `sweep:counter`（JSON）。`{count, updated_at, updated_by, note, history}` を保持する。
  `history` は直近20件（いつ・誰が・いくつから いくつへ）。
- 合言葉は `/api/items` と同じ `x-chat-passcode`。GET も含めて必須（401 `bad_passcode`）。
- `count` は 0 以上の整数。加算は `delta`、数値合わせは `set` で行い、**どちらか一方だけ**を送る。
- **まだ一度も保存が無いとき**（初回）は、GET がDB内の「応募済」件数（`status` が `応募済` で始まる件数）を
  `count` と `initial_candidate` に入れ、`initialized:false` で返す（**GETでは書き込まない**）。
  最初の `delta` はこの「応募済件数」を起点に加算し、そのときに保存される。
  0から始めたい／別の数にしたいときは `set` で合わせる。

### 呼び方

| 送るもの | 動き |
|---|---|
| `{"delta":3,"by":"パッド","note":"X懸賞3件応募"}` | 3件加算（`delta` は0以外の整数。負も可だが結果が0未満なら400 `counter_negative`） |
| `{"delta":-2,"by":"むぎ"}` | 2件減算（数え間違えの戻し） |
| `{"set":120,"by":"わきさか"}` | 合計を120に合わせる（`set` は0以上の整数） |

- 応答は GET と同じ形＋`previous`（変更前の数）と `initialized_from_items`（初回に応募済件数から始めたか）。
- `delta`・`set` の両方指定、どちらも無し、小数、数字でない値は 400 `bad_counter`。
- 同時更新で上書きされたときは読み直してやり直す（3回でだめなら 409 `counter_conflict`）。
- `by` は `わきさか` / `本人` / `むぎ` / `きなこ` / `パッド` / `サイト`（画面からの操作）などを自由記入。
  省略時はヘッダー `x-chat-by` を見る。

```bash
# 今の数を見る（初回は initialized:false・count は応募済件数）
curl -s -H 'x-chat-passcode: kinako3150' \
  'https://sweepstakes-viewer.vercel.app/api/counter'

# +1（1件だけ加算。画面にボタンは無いので、これがワンタップの代わり）
curl -s -X POST 'https://sweepstakes-viewer.vercel.app/api/counter' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"delta":1,"by":"パッド"}'

# まとめて5件（数さえ合っていればまとめてでOK）
curl -s -X POST 'https://sweepstakes-viewer.vercel.app/api/counter' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"delta":5,"by":"むぎ","note":"X懸賞5件"}'

# 合計を任意の数に合わせる（手動補正）
curl -s -X POST 'https://sweepstakes-viewer.vercel.app/api/counter' \
  -H 'Content-Type: application/json' -H 'x-chat-passcode: kinako3150' \
  -d '{"set":120,"by":"わきさか"}'
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
- 担当ボタン：`本人` / `むぎ` / `きなこ` / `パッド` ＋ `やらない` ＋ `× できなかった`。
  色はその人の可否（`mugi`・`kinako`・`pad` の 1=青 / 2=黄 / 3=赤、未入力=色なし）。
  **いまの担当は太い黒枠**で示す（色は可否の意味なので枠で区別）。
- `× できなかった`：確認ダイアログのうえ `failed="×"` にして×タブへ移す（担当はそのまま）。
  ×タブ内では「×を解除」で `failed=""` に戻せる。
- 人別フィルター：**振り分け済み**タブと**×**タブに `全員／本人／むぎ／きなこ／パッド` のボタン。
  押した人の案件だけを表示し、件数バッジも人別に切り替わる（並びは締切が近い順・期限切れ末尾のまま）。
- 押した瞬間に画面へ反映し、書き込みが10秒でタイムアウトしたとき・失敗したときは
  **元の担当に戻して**「更新できませんでした：理由」と「最新を読み込み直す」ボタンを出す。
  書き込み中はそのカードの4ボタンを押せなくする（連打の二重書き込み防止）。
- 「やらない」は**確認ダイアログ**を出してから移動。押した案件は「やらない」タブに残り、
  そこで `本人`／`むぎ`／`きなこ`／`パッド` を押せば戻せる。
- 期限切れの案件は各タブの**末尾**にまとめ、薄く表示する。
- 検索はキャンペーン名・主催が対象。
- **応募キリ番カウンター（表示専用）**：ページの1番上（ヘッダーより上）に、
  銀〜水色のメタリック枠＋黒い液晶の中に**蛍光緑の7セグLED風デジタル数字**で累計応募数を6桁ゼロ埋め表示（例 `000060`）。
  下に「累計応募数は 000060 件です！」「次のキリ番 100 まであと 40 件」（キリ番のときは「🎉 キリ番 ○○ 達成！」）、
  最終更新の日時と更新者を小さく添える。キリ番（100ごと・1000ごと・3桁以上のゾロ目）に当たると表示が変わる。
  **画面には加算・数値合わせのボタンや入力欄が無い**（数字は `/api/counter` から読むだけ）。
  ヘッダーには同じ色味の小さいチップ（`🎯 000060 件`）を常時出し、スクロールしても数が見えるようにしている。
  未設定のときは「未設定（DBの応募済 ○件を表示中）」と添える。リロード・タブ切替・絞り込みでも最新の数を描き直す。

## データの移行・復旧

```bash
# シート最終状態（72件）をDBへ投入（置き換え）
BASE=https://sweepstakes-viewer.vercel.app PASS=kinako3150 ./tools/import_seed.sh

# 件数・全項目が seed と一致するか検証
BASE=https://sweepstakes-viewer.vercel.app python3 tools/verify_seed.py
```

`data/seed.json` は2026-11-19時点のシート内容（72件・17項目、`failed` は全て空欄）そのもの。
`MODE=merge` を付けると、seed に無いNoは残したまま投入する。

※ `pad`（パッド可否）は2026-11-21に追加した項目なので seed には無い。既存データと同じく
未設定（`""`）として扱われ、`pad` を指定しない投入でも消えたり壊れたりしない。

※ seed.json は「移行時点の控え」なので、移行後にDB側で担当（owner）などを変えた分は差分として出ます。
（2026-11-19深夜の時点では、DBの70件が「本人」から「未振り分け」に変わっているため、
`verify_seed.py` は owner の差異を70件と報告します。データの欠けではない）

## ローカル確認

```bash
KV_REST_API_URL=... KV_REST_API_TOKEN=... npm start   # → http://localhost:3211
npm test                                                # 擬似RedisでAPIと画面ロジックを検証
node tools/preview.js                                   # 擬似Redis＋server.js（http://localhost:3211・本番DBに触らない）
```

`tests/run.js` は擬似Redis（`tests/fake-redis.js`）を立てて本物の `server.js` / `api/` / `lib/` を
そのまま動かすので、Upstash の実データを汚さずに failed・pad の設定・解除・バリデーション・
`?failed=1`・bulk・振り分け優先順位・人別フィルター（パッド含む）・応募キリ番カウンター
（初期値・加算・まとめて加算・set・0未満防止・不正値400・認証・GETで書き込まないこと）を確認できる。
画面側は、7セグ表示のゼロ埋め（59→`000059`）と各数字の点灯セグメント、
カウンターがヘッダーより上（ページの1番上）にあること、**手動の加算・数値合わせが残っていないこと**、
画面が `GET /api/counter` しか呼ばないことまで見ている。

## 旧構成からの変更点（v0.5.2 → v1.0）

| 旧 | 新 |
|---|---|
| 画面が Google シートの gviz を直読み＋スナップショット `data.js` | 自サイトの `/api/items` から取得（キャッシュ無効） |
| 担当の書き込みは Apps Script 中継 | Serverless Function が Upstash Redis へ直接書き込み |
| スナップショット生成 `tools/build_data.py` | 不要（DBが正）。`data/seed.json` は移行・復旧用 |

`apps-script/`（中継）は役目を終えたので削除した。

## 注意

- ページは「見る・担当を決める・公式URLへ飛ぶ」まで。応募の自動送信・個人情報の入力は行わない。
- 保存しているのは懸賞リストの17項目だけで、氏名・住所・電話などの個人情報は含まない。
- 書き込みの合言葉は画面の `public/config.js` に入っている（身内だけが使う前提の簡易な門）。
  外部に広げたくなったら Vercel の `SWEEP_PASSCODE` を変え、`config.js` ときなこ側の設定も同じ値にそろえる。
- 作品系（分類④）は生成AI禁止のため、作句・執筆支援機能は入れない。
