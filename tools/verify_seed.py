#!/usr/bin/env python3
"""DBの中身が data/seed.json と一致するか検証する。

使い方:
  BASE=https://sweepstakes-viewer.vercel.app python3 tools/verify_seed.py
  BASE=... python3 tools/verify_seed.py path/to/expected.json

- 件数（seed の件数 = DB の件数）
- No の集合が一致
- 16項目すべての値が一致
を順に確かめ、食い違いがあれば最初の数件を表示して exit 1。
"""
import json
import os
import sys
import urllib.request

FIELDS = ["no", "name", "sponsor", "prize", "deadline", "decision", "category",
          "agent_can", "user_must", "status", "url", "evidence",
          "owner", "mugi", "kinako", "daily"]


def norm(v):
    return "" if v is None else str(v)


def main() -> None:
    base = os.environ.get("BASE", "https://sweepstakes-viewer.vercel.app").rstrip("/")
    seed_path = sys.argv[1] if len(sys.argv) > 1 else "data/seed.json"
    doc = json.load(open(seed_path, encoding="utf-8"))
    expected = doc["items"] if isinstance(doc, dict) else doc

    req = urllib.request.Request(base + "/api/items?include_hidden=1&t=" + os.urandom(4).hex(),
                             headers={"x-chat-passcode": os.environ.get("PASS", "kinako3150")})
    with urllib.request.urlopen(req, timeout=60) as res:
        out = json.loads(res.read().decode("utf-8"))
    if not out.get("ok"):
        raise SystemExit(f"API エラー: {out}")
    actual = out["items"]

    print(f"seed={len(expected)}件 db={len(actual)}件")
    if len(expected) != len(actual):
        print("件数が一致しません")
    exp = {norm(i["no"]): i for i in expected}
    act = {norm(i["no"]): i for i in actual}
    missing = sorted(set(exp) - set(act), key=lambda x: int(x) if x.isdigit() else 0)
    extra = sorted(set(act) - set(exp), key=lambda x: int(x) if x.isdigit() else 0)
    print("DBに無いNo:", missing or "なし")
    print("DBだけにあるNo:", extra or "なし")

    diffs = []
    for no in sorted(set(exp) & set(act), key=lambda x: int(x) if x.isdigit() else 0):
        for f in FIELDS:
            if norm(exp[no].get(f)) != norm(act[no].get(f)):
                diffs.append((no, f, norm(exp[no].get(f)), norm(act[no].get(f))))
    print("項目の食い違い:", len(diffs), "件")
    for no, f, a, b in diffs[:20]:
        print(f"  No.{no} {f}: seed={a!r} db={b!r}")

    ok = not missing and not extra and not diffs and len(expected) == len(actual)
    print("判定:", "一致" if ok else "不一致")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
