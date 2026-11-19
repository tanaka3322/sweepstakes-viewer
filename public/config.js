// サイトからシートへ「担当」を書き込むための中継（Apps Script Webアプリ）の設定。
// endpoint が空の間、担当ボタンはシートの該当セルを直接開くフォールバック動作になる。
// デプロイ手順は apps-script/README.md。URLが決まったら endpoint に入れること。
window.SWEEP_WRITE = {
  endpoint: "",
  passcode: "kinako3150"
};
