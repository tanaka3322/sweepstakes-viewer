'use strict';
// GET  /api/items      … 全件取得（?q= 名前・主催の部分一致／?include_hidden=1 で「やらない」「応募しない」も含む／?failed=1 で「×」だけ）
// POST /api/items      … 1件追加（No省略時は自動採番）／{items:[…],mode:"replace"|"merge"} でまとめて投入

const store = require('../../lib/store');
const { send, readBody, queryOf, authorized, actor, fail } = require('../../lib/http');

function matchesQuery(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return String(item.name || '').toLowerCase().includes(needle)
    || String(item.sponsor || '').toLowerCase().includes(needle);
}

module.exports = async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const query = queryOf(req);
  const body = readBody(req);

  try {
    if (method === 'GET' && query.health) {
      const configured = store.isConfigured();
      let reachable = false;
      let itemCount = null;
      let error = null;
      if (configured) {
        try {
          const items = await store.listItems();
          reachable = true;
          itemCount = items.length;
        } catch (e) {
          error = String((e && e.message) || e);
        }
      }
      return send(res, configured && reachable ? 200 : 503, {
        ok: configured && reachable,
        backend: 'upstash-redis',
        configured,
        reachable,
        itemCount,
        error,
      });
    }

    if (!authorized(req, body, query)) {
      return send(res, 401, { ok: false, error: 'bad_passcode' });
    }

    if (method === 'GET') {
      let items = await store.listItems();
      const includeHidden = String(query.include_hidden || '') === '1';
      if (!includeHidden) {
        items = items.filter((it) => !store.HIDDEN_OWNERS.includes(String(it.owner || '').trim()));
      }
      items = items.filter((it) => matchesQuery(it, String(query.q || '').trim()));
      // failed=1 … 応募しようとしてできなかった「×」だけを返す（×は非表示にしない）
      const onlyFailed = String(query.failed || '') === '1';
      if (onlyFailed) items = items.filter((it) => String(it.failed || '') === '×');
      const meta = await store.getMeta();
      return send(res, 200, {
        ok: true,
        source: 'db',
        count: items.length,
        items,
        updated_at: meta.updated_at || null,
      });
    }

    if (method === 'POST') {
      // まとめて投入（初回移行・復旧用）
      if (Array.isArray(body.items)) {
        const mode = body.mode === 'merge' ? 'merge' : 'replace';
        const out = await store.importItems(body.items, mode, actor(req, body));
        const saved = await store.listItems();
        return send(res, 200, {
          ok: true,
          mode,
          imported: out.count,
          count: saved.length,
          items: saved,
          updated_at: out.meta.updated_at,
        });
      }
      // 1件追加
      const src = body.item && typeof body.item === 'object' ? body.item : body;
      const item = await store.addItem(src, actor(req, body), src && src.no);
      return send(res, 201, { ok: true, item });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    return fail(res, err);
  }
};
