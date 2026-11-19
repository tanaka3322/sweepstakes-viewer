'use strict';
// GET    /api/items/:no … 1件取得
// PATCH  /api/items/:no … 部分更新（送った項目だけ変え、更新後の1件全体を返す）
// DELETE /api/items/:no … 削除（誤登録の取り消し用）

const store = require('../../lib/store');
const { send, readBody, queryOf, authorized, actor, fail } = require('../../lib/http');

function noFrom(req, query) {
  if (query && query.no) return query.no;
  const m = String(req.url || '').match(/\/api\/items\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

module.exports = async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const query = queryOf(req);
  const body = readBody(req);

  try {
    if (!authorized(req, body, query)) {
      return send(res, 401, { ok: false, error: 'bad_passcode' });
    }

    const no = noFrom(req, query);

    if (method === 'GET') {
      const item = await store.getItem(no);
      if (!item) return send(res, 404, { ok: false, error: 'no_not_found' });
      return send(res, 200, { ok: true, item });
    }

    if (method === 'PATCH') {
      const changes = body.changes && typeof body.changes === 'object' ? body.changes : null;
      let patch = changes;
      if (!patch) {
        patch = {};
        for (const f of store.FIELDS) {
          if (Object.prototype.hasOwnProperty.call(body, f)) patch[f] = body[f];
        }
      }
      const item = await store.patchItem(no, patch, actor(req, body));
      return send(res, 200, { ok: true, item });
    }

    if (method === 'DELETE') {
      const item = await store.deleteItem(no, actor(req, body));
      return send(res, 200, { ok: true, deleted: item });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    return fail(res, err);
  }
};
