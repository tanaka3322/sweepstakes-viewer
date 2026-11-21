'use strict';
// GET   /api/counter … 応募キリ番カウンター（応募した数）を返す
//   { ok:true, count, initialized, updated_at, updated_by, note, history }
//   まだ保存が無いときは initialized:false で、DBの「応募済」件数を initial_candidate として返す
//   （GETでは書き込まない）。
//
// POST  /api/counter … 加算・設定（PATCH も同じ）
//   { "delta": 3, "by": "パッド", "note": "X懸賞3件応募" }  … 3件加算（負のdeltaで減算も可／0未満は400）
//   { "set": 120, "by": "わきさか" }                        … 合計を120に合わせる（0以上）
//   返り値は GET と同じ形に previous（変更前）を足したもの。

const store = require('../lib/store');
const { send, readBody, queryOf, authorized, actor, fail } = require('../lib/http');

module.exports = async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const query = queryOf(req);
  const body = readBody(req);

  try {
    if (!authorized(req, body, query)) {
      return send(res, 401, { ok: false, error: 'bad_passcode' });
    }

    if (method === 'GET') {
      const counter = await store.getCounter();
      return send(res, 200, Object.assign({ ok: true }, counter));
    }

    if (method === 'POST' || method === 'PATCH') {
      const out = await store.updateCounter(body, actor(req, body));
      return send(res, 200, Object.assign({ ok: true }, out));
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    return fail(res, err);
  }
};
