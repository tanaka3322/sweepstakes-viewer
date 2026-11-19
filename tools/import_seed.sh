#!/usr/bin/env bash
# data/seed.json を本番DBへ投入する（初回移行・復旧用）
#
# 使い方:
#   BASE=https://sweepstakes-viewer.vercel.app PASS=kinako3150 ./tools/import_seed.sh
#   MODE=merge BASE=... PASS=... ./tools/import_seed.sh data/seed.json
#
# 既定は「置き換え（replace）」。DBの中身は data/seed.json の内容に置き換わる。
# 追加・統合したいときは MODE=merge。
set -eu
BASE="${BASE:-https://sweepstakes-viewer.vercel.app}"
PASS="${PASS:-kinako3150}"
MODE="${MODE:-replace}"
SEED="${1:-data/seed.json}"

if [ ! -f "$SEED" ]; then echo "seed が見つかりません: $SEED" >&2; exit 1; fi

python3 - "$SEED" "$MODE" "$BASE" "$PASS" <<'PY'
import json, sys, urllib.request

seed_path, mode, base, pw = sys.argv[1:5]
doc = json.load(open(seed_path, encoding="utf-8"))
items = doc["items"] if isinstance(doc, dict) else doc
body = json.dumps({"items": items, "mode": mode, "by": "import"}, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(
    base.rstrip("/") + "/api/items",
    data=body,
    method="POST",
    headers={"Content-Type": "application/json", "x-chat-passcode": pw},
)
with urllib.request.urlopen(req, timeout=120) as res:
    out = json.loads(res.read().decode("utf-8"))
print("ok:", out.get("ok"), "mode:", out.get("mode"), "imported:", out.get("imported"), "db_count:", out.get("count"))
PY
