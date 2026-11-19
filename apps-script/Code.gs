// 懸賞リスト：サイトからの「担当」更新を受け付ける中継（Google Apps Script Webアプリ）
// 作成：きなこ（2026-11-19）／デプロイ：むぎ想定（手順は同フォルダ README.md）
//
// 仕様：
// - POST JSON {passcode, no, owner} を受け、シート「応募リスト」の A列で No を探し、
//   M列（担当）だけを owner に書き換える。他の列・行は一切触らない。
// - owner は「本人」「むぎ」「きなこ」の3値のみ許可。それ以外はエラー。
// - パスコードは簡易ゲート（低リスク列のみの更新という前提）。変えるときは
//   サイト側 public/config.js の passcode と必ず一致させること。

var SPREADSHEET_ID = "161-pa0R3LgMKRhtNSwSsTaeIBai-0GonqvpOn8Rf00g";
var SHEET_NAME = "応募リスト";
var PASSCODE = "kinako3150";
var ALLOWED_OWNERS = ["本人", "むぎ", "きなこ"];
var NO_COL = 1;    // A列 = No
var OWNER_COL = 13; // M列 = 担当

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return jsonOut({ ok: true, service: "sweepstakes-owner-writer" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.passcode !== PASSCODE) return jsonOut({ ok: false, error: "bad_passcode" });
    var no = String(body.no || "");
    var owner = String(body.owner || "");
    if (ALLOWED_OWNERS.indexOf(owner) < 0) return jsonOut({ ok: false, error: "bad_owner" });
    if (!no) return jsonOut({ ok: false, error: "bad_no" });

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(SHEET_NAME);
    var last = sh.getLastRow();
    var nos = sh.getRange(2, NO_COL, Math.max(last - 1, 1), 1).getValues();
    var row = -1;
    for (var i = 0; i < nos.length; i++) {
      if (String(nos[i][0]) === no) { row = i + 2; break; }
    }
    if (row < 0) return jsonOut({ ok: false, error: "no_not_found", no: no });
    sh.getRange(row, OWNER_COL).setValue(owner);
    return jsonOut({ ok: true, no: no, owner: owner, row: row });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
