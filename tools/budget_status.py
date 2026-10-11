#!/usr/bin/env python3
"""
tools/budget_status.py — Xem còn bao nhiêu ngân sách ghi Cloudflare.

Hai lớp:
  1. Cầu chì của project (biến repo HACDAO_* + bộ đếm tools/.cloud_sync_budget.json
     trên origin/main do CI commit) — script sync tự dừng khi chạm mức này.
  2. Mức dùng THẬT trên Cloudflare so với hạn mức gói Free: D1 (wrangler d1 info)
     và R2 (GraphQL Analytics, cần token wrangler/CLOUDFLARE_API_TOKEN).

Usage (macOS/Windows, tại thư mục gốc repo):
  python tools/budget_status.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
BUDGET_FILE = "tools/.cloud_sync_budget.json"
D1_DB = "hacdao-db"
FREE = {"d1_rows_written_day": 100_000, "d1_rows_read_day": 5_000_000,
        "r2_class_a_month": 1_000_000, "r2_class_b_month": 10_000_000}
# Thao tác R2 tính phí Class A (ghi/list); còn lại (GetObject, HeadObject…) là Class B.
R2_CLASS_A = {"PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload",
              "UploadPart", "UploadPartCopy", "ListObjects", "ListMultipartUploads", "ListParts",
              "PutBucket", "DeleteBucket", "PutBucketCors", "PutBucketLifecycleConfiguration"}

if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _run(cmd):
    exe = shutil.which(cmd[0]) or cmd[0]
    return subprocess.run([exe, *cmd[1:]], cwd=BASE_DIR, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def fuse_usage(state: dict, now: datetime) -> dict:
    """Bộ đếm hiện hành (về 0 khi sang tháng/ngày mới, giống tools/sync_budget.py)."""
    r2 = state.get("r2_ops", 0) if state.get("r2_month") == now.strftime("%Y-%m") else 0
    d1 = state.get("d1_ops", 0) if state.get("d1_day") == now.strftime("%Y-%m-%d") else 0
    return {"r2_month": r2, "d1_day": d1}


def split_r2_classes(rows: list) -> tuple:
    a = sum(r["sum"]["requests"] for r in rows if r["dimensions"]["actionType"] in R2_CLASS_A)
    b = sum(r["sum"]["requests"] for r in rows if r["dimensions"]["actionType"] not in R2_CLASS_A)
    return a, b


def _line(label, used, limit, unit=""):
    pct = f"{used / limit:.1%}" if limit else "—"
    left = f"còn {limit - used:,}" if limit else "không giới hạn"
    print(f"  {label:<28} {used:>10,} / {limit:>10,}{unit}  ({pct}, {left})")


def show_fuse():
    print("① Cầu chì của project (script sync tự dừng khi chạm):")
    _run(["git", "fetch", "-q", "origin", "main"])
    raw = _run(["git", "show", f"origin/main:{BUDGET_FILE}"]).stdout
    state = json.loads(raw) if raw.strip() else {}
    vars_out = _run(["gh", "variable", "list", "--json", "name,value"])
    limits = {v["name"]: int(v["value"]) for v in json.loads(vars_out.stdout or "[]")
              if v["name"].startswith("HACDAO_") and v["value"].isdigit()} if vars_out.returncode == 0 else {}
    if not limits:
        print("  (không đọc được biến repo — cần `gh auth login`)")
    use = fuse_usage(state, datetime.now(timezone.utc))
    _line("R2 tháng này", use["r2_month"], limits.get("HACDAO_R2_WRITE_BUDGET", 0))
    _line("D1 hôm nay (UTC)", use["d1_day"], limits.get("HACDAO_D1_WRITE_BUDGET", 0))
    print(f"  {'Tối đa mỗi lần chạy':<28} {limits.get('HACDAO_MAX_OPS_PER_RUN', 0):>10,}  (R2 + D1 gộp, tính riêng từng run)")


def _wrangler_token():
    if os.getenv("CLOUDFLARE_API_TOKEN"):
        return os.environ["CLOUDFLARE_API_TOKEN"]
    home = Path.home()
    for p in [home / "Library/Preferences/.wrangler/config/default.toml",       # macOS
              home / ".config/.wrangler/config/default.toml",                   # Linux
              home / ".wrangler/config/default.toml",
              Path(os.getenv("APPDATA", home)) / "xdg.config/.wrangler/config/default.toml"]:  # Windows
        if p.exists():
            m = re.search(r'^oauth_token\s*=\s*"([^"]+)"', p.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1)
    return None


def show_cloudflare():
    print("\n② Mức dùng thật trên Cloudflare (so với gói Free):")
    npx = "npx.cmd" if sys.platform == "win32" else "npx"
    info = _run([npx, "wrangler", "d1", "info", D1_DB, "--json"])
    try:
        d = json.loads(info.stdout[info.stdout.index("{"):])
        _line("D1 dòng ghi 24h", int(d.get("rows_written_24h", 0)), FREE["d1_rows_written_day"])
        _line("D1 dòng đọc 24h", int(d.get("rows_read_24h", 0)), FREE["d1_rows_read_day"])
        print(f"  {'D1 dung lượng':<28} {int(d.get("database_size", 0)) / 1e6:>10.1f} MB / 5,000 MB")
    except Exception:
        print("  D1: không đọc được (`npx wrangler login` rồi chạy lại)")

    token = _wrangler_token()
    who = _run([npx, "wrangler", "whoami"]).stdout
    acc = os.getenv("CLOUDFLARE_ACCOUNT_ID") or (re.findall(r"\b[0-9a-f]{32}\b", who) or [None])[0]
    if not token or not acc:
        print("  R2: thiếu token/account (`npx wrangler login` hoặc đặt CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)")
        return
    now = datetime.now(timezone.utc)
    q = {"query": "query($a:String!,$s:Date!,$e:Date!){viewer{accounts(filter:{accountTag:$a}){"
                  "r2OperationsAdaptiveGroups(limit:1000,filter:{date_geq:$s,date_leq:$e})"
                  "{sum{requests}dimensions{actionType}}}}}",
         "variables": {"a": acc, "s": now.strftime("%Y-%m-01"), "e": now.strftime("%Y-%m-%d")}}
    req = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", data=json.dumps(q).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=30))
        rows = data["data"]["viewer"]["accounts"][0]["r2OperationsAdaptiveGroups"]
        a, b = split_r2_classes(rows)
        _line("R2 Class A (ghi) tháng này", a, FREE["r2_class_a_month"])
        _line("R2 Class B (đọc) tháng này", b, FREE["r2_class_b_month"])
    except Exception as e:
        print(f"  R2: không truy vấn được Analytics ({e})")


def main():
    show_fuse()
    show_cloudflare()
    print("\nGhi chú: ① là cầu chì tự đặt (có thể nâng/hạ bằng `gh variable set`); ② mới quyết định có tốn tiền.")


if __name__ == "__main__":
    main()
