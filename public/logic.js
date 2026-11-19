"use strict";
// 振り分け・並べ替えの判定（画面から使う純粋な関数）
//
// 画面（index.html）とローカルテスト（tests/）で同じ判定を使うために分けてある。
// ブラウザでは window.SWEEP_LOGIC、Node では module.exports で読める。
(function (root) {
  var TAB_NAMES = {
    unassigned: "未振り分け",
    assigned: "振り分け済み",
    done: "応募済み",
    daily: "毎日応募",
    failed: "×（できなかった）",
    skip: "やらない",
  };
  var HIDDEN_OWNERS = ["やらない", "応募しない"];
  var OWNER_FILTERS = ["全員", "本人", "むぎ", "きなこ"];

  function parseDeadline(s) {
    if (!s) return null;
    var m = String(s).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59), 59);
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function daysLeft(dl, now) {
    if (!dl) return null;
    return Math.round((startOfDay(dl) - startOfDay(now)) / 86400000);
  }

  function ownerOf(it) { return String((it && it.owner) || "").trim(); }
  function isSkip(it) { return HIDDEN_OWNERS.indexOf(ownerOf(it)) >= 0; }
  function isUnassigned(it) {
    var o = ownerOf(it);
    return o === "" || o === "未振り分け" || o === "未定" || o === "保留" || o === "-" || o === "—";
  }
  function isDone(it) { return String((it && it.status) || "").startsWith("応募済"); }
  function isDaily(it) {
    var v = String((it && it.daily) || "").trim();
    return v.indexOf("○") >= 0 || v.indexOf("◯") >= 0;
  }
  function isFailed(it) { return String((it && it.failed) || "").trim() === "×"; }
  function dailyActive(it, now) {
    if (!isDaily(it)) return false;
    var left = daysLeft(parseDeadline(it.deadline), now || new Date());
    return left === null || left >= 0;
  }

  // 振り分けの優先順位：やらない／応募しない ＞ × ＞ 毎日応募 ＞ 未振り分け／応募済み／振り分け済み
  function tabOf(it, now) {
    if (isSkip(it)) return "skip";
    if (isFailed(it)) return "failed";
    if (dailyActive(it, now)) return "daily";
    if (isUnassigned(it)) return "unassigned";
    if (isDone(it)) return "done";
    return "assigned";
  }

  // 人別フィルター（振り分け済み・×タブ用）。「全員」はそのまま返す。
  function filterByOwner(list, who) {
    if (!who || who === "全員") return list.slice();
    return list.filter(function (it) { return ownerOf(it) === who; });
  }

  // 画面表示用に締切を計算してから、期限切れを末尾・残りは締切が近い順に並べる
  function decorate(items, now) {
    var n = now || new Date();
    return (items || []).map(function (it) {
      var dl = parseDeadline(it.deadline);
      return Object.assign({}, it, { _dl: dl, _left: daysLeft(dl, n) });
    });
  }
  function sortForList(list) {
    return list.slice().sort(function (a, b) {
      var ae = a._left !== null && a._left !== undefined && a._left < 0;
      var be = b._left !== null && b._left !== undefined && b._left < 0;
      if (ae !== be) return ae ? 1 : -1;
      if (a._dl && b._dl) return a._dl - b._dl;
      if (a._dl) return -1;
      if (b._dl) return 1;
      return 0;
    });
  }

  var api = {
    TAB_NAMES: TAB_NAMES,
    HIDDEN_OWNERS: HIDDEN_OWNERS,
    OWNER_FILTERS: OWNER_FILTERS,
    parseDeadline: parseDeadline,
    startOfDay: startOfDay,
    daysLeft: daysLeft,
    ownerOf: ownerOf,
    isSkip: isSkip,
    isUnassigned: isUnassigned,
    isDone: isDone,
    isDaily: isDaily,
    isFailed: isFailed,
    dailyActive: dailyActive,
    tabOf: tabOf,
    filterByOwner: filterByOwner,
    decorate: decorate,
    sortForList: sortForList,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SWEEP_LOGIC = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
