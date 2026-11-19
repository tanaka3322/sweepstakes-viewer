// サイトからシートへ「担当」を書き込むための中継（Apps Script Webアプリ）の設定。
// endpoint が空の間、担当ボタンはシートの該当セルを直接開くフォールバック動作になる。
// デプロイ手順は apps-script/README.md。URLが決まったら endpoint に入れること。
window.SWEEP_WRITE = {
  endpoint: "https://script.google.com/macros/s/AKfycbxtTeJvxJRmv2Z48bbXc7gjY_i7qMgSm575SeCFxC17KlmEWktQh_IOZ98bQhYEySQQxg/exec",
  passcode: "kinako3150"
};
