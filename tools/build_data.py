#!/usr/bin/env python3
"""共通シートの値JSONから public/data.js（スナップショット）を生成する。

使い方:
  /opt/hatch/bin/hatch_gws_cli sheets spreadsheets values get \
    --params '{"spreadsheetId":"161-pa0R3LgMKRhtNSwSsTaeIBai-0GonqvpOn8Rf00g","range":"応募リスト!A1:O200"}' \
    > /tmp/sheet_values.json
  python3 tools/build_data.py /tmp/sheet_values.json

※ むぎ側で再生成する場合は、同じ15列の値JSON（values配列を含む形式）を渡せばよい。
"""
import json
import sys
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
FIELDS = ["no", "name", "sponsor", "prize", "deadline", "decision",
          "category", "agent_can", "user_must", "status", "url", "evidence", "owner",
          "mugi", "kinako"]


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sheet_values.json"
    with open(src, encoding="utf-8") as f:
        doc = json.load(f)
    values = doc.get("values") or []
    if not values:
        raise SystemExit("values が空です")
    header, rows = values[0], values[1:]
    if len(header) != 15:
        raise SystemExit(f"列数が15ではありません: {len(header)}")
    items = []
    for r in rows:
        r = (list(r) + [""] * 15)[:15]
        items.append(dict(zip(FIELDS, r)))
    snapshot = {
        "generated_at": datetime.now(JST).strftime("%Y-%m-%d %H:%M JST"),
        "source": "懸賞_共通応募リスト / 応募リスト",
        "spreadsheet_id": "161-pa0R3LgMKRhtNSwSsTaeIBai-0GonqvpOn8Rf00g",
        "items": items,
    }
    out = "public/data.js"
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 自動生成ファイル（tools/build_data.py）。直接編集しないこと。\n")
        f.write("window.SWEEP_SNAPSHOT = ")
        json.dump(snapshot, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    print(f"wrote {out}: {len(items)} items")


if __name__ == "__main__":
    main()
