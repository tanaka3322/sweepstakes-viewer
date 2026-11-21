'use strict';
// 懸賞リストの保存層（Upstash Redis / Vercel Storage）
//
// 保存の形:
//   sweep:items … Redis のハッシュ。フィールド = No（文字列）、値 = 1件分のJSON文字列
//   sweep:meta  … 最終更新時刻などのメタ情報（JSON文字列）
//
// 1件を1フィールドで持つので、むぎときなこが別の案件を同時に更新しても消し合わない。
//
// 環境変数（Vercel の Upstash 連携が自動で入れる）:
//   KV_REST_API_URL / KV_REST_API_TOKEN
//   旧名 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN も受け付ける。

const KEY_ITEMS = 'sweep:items';
const KEY_META = 'sweep:meta';
const KEY_COUNTER = 'sweep:counter';
const COUNTER_HISTORY_MAX = 20;

// 触ってよい項目（No はキーなのでここには入れない）
const FIELDS = [
  'name', 'sponsor', 'prize', 'deadline', 'decision', 'category',
  'agent_can', 'user_must', 'status', 'url', 'evidence',
  'owner', 'mugi', 'kinako', 'pad', 'daily', 'failed',
];

// owner の許可値（それ以外は bad_owner）
const OWNERS = ['', '未振り分け', '本人', 'むぎ', 'きなこ', 'パッド', 'やらない', '応募しない'];
// 画面で「非表示」にする担当
const HIDDEN_OWNERS = ['やらない', '応募しない'];
// 可否の許可値（それ以外は bad_value）
const CAPS = ['', '1', '2', '3'];

function dbConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url: url.replace(/\/+$/, ''), token };
}

function isConfigured() {
  const c = dbConfig();
  return Boolean(c.url && c.token);
}

async function post(path, body, timeoutMs = 8000) {
  const { url, token } = dbConfig();
  if (!url || !token) throw new Error('db_not_configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { throw new Error('db_bad_response'); }
    if (!res.ok || (json && json.error)) {
      throw new Error('db_error: ' + ((json && json.error) || ('HTTP ' + res.status)));
    }
    return json ? json.result : null;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('db_timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 1コマンド実行（例: ['HGETALL', 'sweep:items']）
function command(cmd) {
  return post('', cmd);
}

// 複数コマンドをまとめて実行（/pipeline）。エラーがあれば投げる。
async function pipeline(cmds) {
  const out = await post('/pipeline', cmds);
  const failed = (out || []).filter((r) => r && r.error);
  if (failed.length) throw new Error('db_error: ' + failed[0].error);
  return out;
}

// HGETALL の戻りは「[f1,v1,f2,v2,…]」と「[[f1,v1],[f2,v2],…]」の両形があり得るので対応
function pairs(result) {
  const list = [];
  if (!Array.isArray(result)) return list;
  if (result.length && Array.isArray(result[0])) {
    for (const p of result) list.push([String(p[0]), p[1]]);
  } else {
    for (let i = 0; i + 1 < result.length; i += 2) list.push([String(result[i]), result[i + 1]]);
  }
  return list;
}

function normalizeNo(no) {
  const s = String(no == null ? '' : no).trim();
  if (!s) return '';
  const m = s.match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)) : s;
}

function parseItem(raw) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  if (raw && typeof raw === 'object') return raw;
  return null;
}

// daily は "" / "○" に統一（true/false・◯ も受け付ける）
function normalizeDaily(v) {
  if (v === true) return '○';
  if (v === false || v == null) return '';
  const s = String(v).trim();
  if (s === '' || s === '0' || s === 'false') return '';
  if (s === '○' || s === '◯' || s === 'o' || s === 'O' || s === '1' || s === 'true') return '○';
  return null; // 不正
}

// failed は "" / "×" に統一（応募しようとしてできなかった案件）
// true/false・x/X も受け付け、返却は "×" / "" にそろえる。
function normalizeFailed(v) {
  if (v === true) return '×';
  if (v === false || v == null) return '';
  if (typeof v === 'number') return v === 1 ? '×' : (v === 0 ? '' : null);
  const s = String(v).trim();
  if (s === '' || s === '0' || s === 'false') return '';
  if (s === '×' || s === 'x' || s === 'X' || s === '1' || s === 'true') return '×';
  return null; // 不正
}

// 1件分の入力を検証して、保存する項目だけのオブジェクトにする
function sanitizeItem(input) {
  const out = {};
  const src = input || {};
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, f)) {
      const v = src[f];
      out[f] = v == null ? '' : String(v).trim();
    }
  }
  if (out.owner !== undefined) {
    if (!OWNERS.includes(out.owner)) throw new Error('bad_owner');
  }
  for (const f of ['mugi', 'kinako', 'pad']) {
    if (out[f] !== undefined && !CAPS.includes(out[f])) throw new Error('bad_value');
  }
  if (out.daily !== undefined) {
    const d = normalizeDaily(out.daily);
    if (d === null) throw new Error('bad_value');
    out.daily = d;
  }
  if (out.failed !== undefined) {
    const f = normalizeFailed(out.failed);
    if (f === null) throw new Error('bad_value');
    out.failed = f;
  }
  return out;
}

// 保存済みの1件に、未設定の failed を "" として補う（既存データを壊さない）
// pad は後から足した項目なので、既存データに無ければ "" として返す（書き戻しはしない）。
function withDefaults(item) {
  if (item.failed === undefined || normalizeFailed(item.failed) === null) item.failed = '';
  if (item.pad === undefined || item.pad === null) item.pad = '';
  return item;
}

function sortItems(items) {
  return items.sort((a, b) => {
    const na = parseInt(String(a.no).replace(/\D/g, ''), 10);
    const nb = parseInt(String(b.no).replace(/\D/g, ''), 10);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.no).localeCompare(String(b.no));
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function listItems() {
  const raw = await command(['HGETALL', KEY_ITEMS]);
  const items = [];
  for (const [no, value] of pairs(raw)) {
    const item = parseItem(value);
    if (item) {
      item.no = normalizeNo(item.no || no);
      items.push(withDefaults(item));
    }
  }
  return sortItems(items);
}

async function getMeta() {
  try {
    const raw = await command(['GET', KEY_META]);
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return {};
  }
}

async function setMeta(patch) {
  const meta = Object.assign({}, await getMeta(), patch, { updated_at: nowIso() });
  await command(['SET', KEY_META, JSON.stringify(meta)]);
  return meta;
}

async function getItem(no) {
  const key = normalizeNo(no);
  if (!key) return null;
  const raw = await command(['HGET', KEY_ITEMS, key]);
  const item = parseItem(raw);
  if (!item) return null;
  item.no = normalizeNo(item.no || key);
  return withDefaults(item);
}

function dupKey(it) {
  return [String(it.name || '').trim(), String(it.url || '').trim(), String(it.deadline || '').trim()].join('\u0001');
}

// 1件の項目を部分更新する（指定した項目だけ書き換え、他はそのまま）
async function patchItem(no, changes, by) {
  const key = normalizeNo(no);
  if (!key) throw new Error('bad_no');
  const safe = sanitizeItem(changes || {});
  if (!Object.keys(safe).length) throw new Error('no_changes');
  const current = await getItem(key);
  if (!current) throw new Error('no_not_found');
  const next = Object.assign({}, current, safe, { no: key, updated_at: nowIso() });
  if (by) next.updated_by = String(by).slice(0, 20);
  await command(['HSET', KEY_ITEMS, key, JSON.stringify(next)]);
  await setMeta({ last_change: { no: key, by: by || '', at: next.updated_at } });
  return next;
}

// まとめて部分更新（1件の失敗で他を巻き戻さない）
async function bulkPatch(updates, by) {
  const list = Array.isArray(updates) ? updates : [];
  const updated = [];
  const failed = [];
  let n = 0;
  for (const u of list) {
    n += 1;
    const no = normalizeNo(u && u.no);
    if (!no) { failed.push({ index: n - 1, no: '', error: 'bad_no' }); continue; }
    const changes = {};
    for (const f of FIELDS) {
      if (u && Object.prototype.hasOwnProperty.call(u, f)) changes[f] = u[f];
    }
    if (!Object.keys(changes).length) { failed.push({ no, error: 'no_changes' }); continue; }
    try {
      updated.push(await patchItem(no, changes, by || (u && u.by)));
    } catch (err) {
      failed.push({ no, error: String((err && err.message) || err) });
    }
  }
  return { updated, failed };
}

async function addItem(input, by, noInput) {
  const safe = sanitizeItem(input || {});
  if (!safe.name) throw new Error('bad_name');
  const items = await listItems();
  // 同じ name+url+deadline の重複は作らない
  const key = dupKey(safe);
  const dup = items.find((it) => dupKey(it) === key);
  if (dup) {
    const err = new Error('duplicate');
    err.dupNo = dup.no;
    throw err;
  }
  let no = normalizeNo(noInput);
  if (no) {
    if (items.some((it) => String(it.no) === no)) throw new Error('duplicate_no');
  } else {
    let max = 0;
    for (const it of items) {
      const v = parseInt(String(it.no).replace(/\D/g, ''), 10);
      if (Number.isFinite(v) && v > max) max = v;
    }
    no = String(max + 1);
  }
  const stamp = nowIso();
  const item = Object.assign({
    name: '', sponsor: '', prize: '', deadline: '', decision: '',
    category: '', agent_can: '', user_must: '', status: '未応募',
    url: '', evidence: '', owner: '', mugi: '', kinako: '', pad: '', daily: '', failed: '',
  }, safe, { no, created_at: stamp, updated_at: stamp });
  if (by) item.created_by = String(by).slice(0, 20);
  await command(['HSET', KEY_ITEMS, no, JSON.stringify(item)]);
  await setMeta({ last_change: { no, by: by || '', at: stamp, created: true } });
  return item;
}

async function deleteItem(no, by) {
  const key = normalizeNo(no);
  if (!key) throw new Error('bad_no');
  const current = await getItem(key);
  if (!current) throw new Error('no_not_found');
  await command(['HDEL', KEY_ITEMS, key]);
  await setMeta({ last_change: { no: key, by: by || '', deleted: true, at: nowIso() } });
  return current;
}

// ============================================================
// 応募キリ番カウンター（応募した数）
//   sweep:counter … JSON文字列 { count, updated_at, updated_by, note, history:[…] }
//   まだ保存が無いときは、DB内の「応募済」件数（status が 応募済 で始まる件数）を
//   初期値の候補として返す（GETでは書き込まない）。最初の更新のときに候補から続ける。
// ============================================================

function countApplied(items) {
  return (items || []).filter((it) => String((it && it.status) || '').trim().startsWith('応募済')).length;
}

// 保存済みのカウンターだけを読む（無ければ null）
async function readCounter() {
  const raw = await command(['GET', KEY_COUNTER]);
  if (!raw) return null;
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const n = Number(v.count);
  if (!Number.isInteger(n) || n < 0) return null;
  return v;
}

async function getCounter() {
  const stored = await readCounter();
  if (stored) {
    return {
      count: stored.count,
      initialized: true,
      updated_at: stored.updated_at || null,
      updated_by: stored.updated_by || '',
      note: stored.note || '',
      history: Array.isArray(stored.history) ? stored.history : [],
    };
  }
  const candidate = countApplied(await listItems());
  return {
    count: candidate,
    initialized: false,
    initial_candidate: candidate,
    updated_at: null,
    updated_by: '',
    note: '',
    history: [],
  };
}

function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

// { delta: n } か { set: n } のどちらか一方だけを受け付ける
function parseCounterOp(input) {
  const src = input || {};
  const hasDelta = src.delta !== undefined && src.delta !== null && src.delta !== '';
  const hasSet = src.set !== undefined && src.set !== null && src.set !== '';
  if (hasDelta === hasSet) throw new Error('bad_counter');
  if (hasDelta) {
    const d = toInt(src.delta);
    if (d === null || d === 0) throw new Error('bad_counter');
    return { delta: d };
  }
  const s = toInt(src.set);
  if (s === null || s < 0) throw new Error('bad_counter');
  return { set: s };
}

// 加算・設定。同時更新で上書きされたら読み直してやり直す。
async function updateCounter(input, by) {
  const op = parseCounterOp(input);
  const note = String((input && input.note) || '').trim().slice(0, 120);
  const actor = String(by || '').trim().slice(0, 20);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const current = await getCounter();
    const from = current.count;
    const next = op.delta !== undefined ? from + op.delta : op.set;
    if (next < 0) throw new Error('counter_negative');
    const stamp = nowIso();
    const entry = Object.assign(
      { at: stamp, by: actor, from, count: next },
      op.delta !== undefined ? { delta: op.delta } : { set: op.set },
      note ? { note } : {}
    );
    const history = (current.history || []).concat([entry]).slice(-COUNTER_HISTORY_MAX);
    const value = { count: next, updated_at: stamp, updated_by: actor, note, history };
    await command(['SET', KEY_COUNTER, JSON.stringify(value)]);
    const after = await readCounter();
    if (after && after.count === next) {
      return {
        count: next,
        previous: from,
        initialized: true,
        initialized_from_items: !current.initialized,
        updated_at: stamp,
        updated_by: actor,
        note,
        history,
      };
    }
  }
  throw new Error('counter_conflict');
}

// まとめて投入（初回移行・復旧用）。
// 一時キーに書いてから RENAME で入れ替えるので、途中で失敗しても既存データは壊れない。
async function importItems(inputItems, mode, by) {
  const list = Array.isArray(inputItems) ? inputItems : [];
  if (!list.length) throw new Error('empty_import');
  const stamp = nowIso();
  const pairsOut = [];
  let seq = 0;
  for (const raw of list) {
    seq += 1;
    const no = normalizeNo(raw && raw.no) || String(seq);
    const safe = sanitizeItem(raw || {});
    if (!safe.name) continue;
    pairsOut.push(no, JSON.stringify(Object.assign({ failed: '', pad: '' }, safe, {
      no,
      updated_at: (raw && raw.updated_at) || stamp,
    })));
  }
  if (!pairsOut.length) throw new Error('empty_import');
  const tmp = KEY_ITEMS + ':import';
  const cmds = [['DEL', tmp], ['HSET', tmp, ...pairsOut]];
  if (mode === 'merge') {
    const existing = await command(['HGETALL', KEY_ITEMS]);
    const incoming = new Set();
    for (let i = 0; i < pairsOut.length; i += 2) incoming.add(pairsOut[i]);
    const keepPairs = [];
    for (const [no, value] of pairs(existing)) {
      if (!incoming.has(String(no))) keepPairs.push(no, value);
    }
    if (keepPairs.length) cmds.push(['HSET', tmp, ...keepPairs]);
  }
  cmds.push(['RENAME', tmp, KEY_ITEMS]);
  await pipeline(cmds);
  const meta = await setMeta({
    imported_count: pairsOut.length / 2,
    import_mode: mode === 'merge' ? 'merge' : 'replace',
    last_change: { by: by || '', at: stamp, import: true },
  });
  return { count: pairsOut.length / 2, meta };
}

module.exports = {
  FIELDS,
  OWNERS,
  HIDDEN_OWNERS,
  CAPS,
  KEY_ITEMS,
  KEY_META,
  KEY_COUNTER,
  isConfigured,
  listItems,
  getItem,
  patchItem,
  bulkPatch,
  addItem,
  deleteItem,
  importItems,
  getMeta,
  setMeta,
  countApplied,
  getCounter,
  updateCounter,
  normalizeNo,
  normalizeDaily,
  normalizeFailed,
  sanitizeItem,
};
