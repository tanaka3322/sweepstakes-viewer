'use strict';
// POST /api/items/bulk … 一括更新
//   本文: { updates: [ { no: 12, owner: "むぎ" }, { no: 13, status: "応募済" }, … ], by: "きなこ" }
//   応答: { ok: true, requested, updated, failed: [ { no, error }, … ], items: [ …更新後の1件 ] }
//   1件の失敗で他を巻き戻さない（成功したものはそのまま残る）。

const store = require('../../lib/store');
const { send, readBody, queryOf, authorized, actor, fail } = require('../../lib/http');

module.exports = async (req, res) => {
  const method = (req.method || 'POST').toUpperCase();
  const query = queryOf(req);
  const body = readBody(req);

  try {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method_not_allowed' });
    }
    if (!authorized(req, body, query)) {
      return send(res, 401, { ok: false, error: 'bad_passcode' });
    }
    const updates = Array.isArray(body.updates) ? body.updates : [];
    if (!updates.length) return send(res, 400, { ok: false, error: 'bad_request', message: 'updates が空です。' });
    const out = await store.bulkPatch(updates, actor(req, body));
    return send(res, 200, {
      ok: true,
      requested: updates.length,
      updated: out.updated.length,
      failed: out.failed,
      items: out.updated,
    });
  } catch (err) {
    return fail(res, err);
  }
};
