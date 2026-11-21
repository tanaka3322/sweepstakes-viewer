// サイトの設定
// apiBase: データの取得・更新先（自サイトのServerless API）
// passcode: 書き込み（と読み取り）に使う合言葉。Vercel の環境変数 SWEEP_PASSCODE と
//           きなこ側の設定を同じ値にそろえること（未設定なら kinako3150）。
window.SWEEP_CONFIG = {
  apiBase: "/api/items",
  counterApiBase: "/api/counter",
  passcode: "kinako3150"
};
