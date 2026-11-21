'use strict';
// API の共通処理（応答・認証・本文読み取り・エラー文言）

const PASSCODE = (process.env.SWEEP_PASSCODE || 'kinako3150').trim();

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(body);
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString('utf8')); } catch (e) { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    return Object.fromEntries(u.searchParams.entries());
  } catch (e) {
    return {};
  }
}

// 合言葉：ヘッダー x-chat-passcode（きなこ仕様）か x-sweep-passcode（旧）か本文の passcode
function authorized(req, body, query) {
  const given = String(
    req.headers['x-chat-passcode']
    || req.headers['x-sweep-passcode']
    || (body && body.passcode)
    || (query && query.passcode)
    || ''
  ).trim();
  return Boolean(given) && given === PASSCODE;
}

function actor(req, body) {
  return String((body && body.by) || req.headers['x-chat-by'] || '').trim().slice(0, 20);
}

function fail(res, err) {
  const msg = String((err && err.message) || err);
  const map = {
    db_not_configured: [500, 'データベースが未設定です（環境変数 KV_REST_API_URL / KV_REST_API_TOKEN）。'],
    db_timeout: [504, 'データベースの応答がありませんでした。少し待って再度お試しください。'],
    db_bad_response: [502, 'データベースの応答を読めませんでした。'],
    no_not_found: [404, 'そのNoの案件が見つかりません。'],
    bad_no: [400, 'Noが不正です。'],
    bad_name: [400, 'キャンペーン名（name）が必要です。'],
    bad_owner: [400, 'owner は ""／未振り分け／本人／むぎ／きなこ／パッド／やらない／応募しない のどれかです。'],
    bad_value: [400, 'mugi・kinako・pad は 1／2／3、daily は ○ か空欄、failed は × か空欄だけです。'],
    no_changes: [400, '更新する項目がありません。'],
    duplicate: [409, '同じキャンペーン（name＋url＋deadline）が既にあります。'],
    duplicate_no: [409, 'そのNoは既に使われています。'],
    empty_import: [400, '投入するデータが空です。'],
    bad_counter: [400, 'delta（0以外の整数）か set（0以上の整数）のどちらか一方だけを指定してください。'],
    counter_negative: [400, '加算の結果が0未満になります。0以上になるようにしてください。'],
    counter_conflict: [409, 'ほかの更新と重なりました。少し待ってからもう一度お試しください。'],
    bad_request: [400, 'リクエストの形式が正しくありません。'],
  };
  if (msg === 'duplicate' && err && err.dupNo) {
    return send(res, 409, { ok: false, error: 'duplicate', no: err.dupNo, message: map.duplicate[1] });
  }
  if (map[msg]) return send(res, map[msg][0], { ok: false, error: msg, message: map[msg][1] });
  if (msg.startsWith('db_error')) {
    return send(res, 502, { ok: false, error: 'db_error', message: 'データベースでエラーが起きました。', detail: msg });
  }
  return send(res, 500, { ok: false, error: 'server_error', message: 'サーバー内部でエラーが発生しました。', detail: msg });
}

module.exports = { PASSCODE, send, readBody, queryOf, authorized, actor, fail };
