# 懸賞スマホ専用ページ（案②）sweepstakes-viewer

共通スプレッドシート「懸賞_共通応募リスト」（13列）はiPhoneで見づらいため、
裏データはシートのままに、iPhone向けカード画面で見るためのページです。

- 作成：きなこ（2026-11-19 初版 v0.1）
- 分担：きなこ作成 → むぎ確認 → きなこ最終確認
- リポジトリ：https://github.com/tanaka3322/sweepstakes-viewer （public）
- 公開URL：https://sweepstakes-viewer.vercel.app/ （Vercel。main へ push すると自動で再デプロイ）
- データ元：スプレッドシート「懸賞_共通応募リスト」（ID: 161-pa0R3LgMKRhtNSwSsTaeIBai-0GonqvpOn8Rf00g）タブ「応募リスト」

## 画面
- カード表示：キャンペーン名／主催／賞品／締切（あと何日・今日締切は赤）／応募状況／担当／分類／本人がやること／公式URLボタン
- タブ：締切が近い順（既定・期限切れ除外）／今日締切／わきさか用（担当に「本人」を含む、または分類②③④）／応募済み／全件
- 検索：キャンペーン名・主催企業
- データ取得：まずシートのライブ取得（gviz）を試み、読めない環境では同梱スナップショット `public/data.js` を表示。画面上部にどちらで表示中か出す。

## コード共有（2人とも触れるように）
1. GitHubに新規リポジトリ `sweepstakes-viewer` を作り、このフォルダ一式を push する（3人チャットの `tanaka3322/kinako-mugi-chat` と同じ方式）。むぎ・きなこ両方が clone / push できる状態にする。
   - 実施済み（2026-11-19 むぎ）：`tanaka3322/sweepstakes-viewer`（public）を作成し push。個人情報・秘密情報が入っていないことを確認のうえ公開リポジトリにした。
2. あわせて、このフォルダの zip を Google Drive フォルダ「懸賞リスト」（1IDWmBP63yKwOF2q3GNaczhq_CWN6wInY）に置く。GitHubが使えない側は zip から触れる。
3. デプロイは Vercel でこのリポジトリを Import（設定は `vercel.json` のとおり、出力は `public/`）。公開URLを3人チャットで共有する。

## データ更新
シートが変わったら、スナップショットを再生成して commit する：
```bash
/opt/hatch/bin/hatch_gws_cli sheets spreadsheets values get \
  --params '{"spreadsheetId":"161-pa0R3LgMKRhtNSwSsTaeIBai-0GonqvpOn8Rf00g","range":"応募リスト!A1:M200"}' \
  > /tmp/sheet_values.json
python3 tools/build_data.py /tmp/sheet_values.json
```
（むぎ側は、同じ13列の values JSON を用意できれば同じスクリプトで再生成できる）

## ローカル確認
```bash
node server.js   # → http://localhost:3211
```

## 注意
- ページは「見る・公式URLへ飛ぶ」まで。応募の自動送信・個人情報の入力は行わない。
- シートの列には個人情報は含まれていない（確認済み 2026-11-19）。列構成を変えるときは個人情報を追加しないこと。
- 作品系（分類④）は生成AI禁止のため、作句・執筆支援機能は入れない。
