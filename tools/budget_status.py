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
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))
BUDGET_FILE = "tools/.cloud_sync_budget.json"
D1_DB = "hacdao-db"
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


def show_cloudflare():
    from tools.cloudflare_usage import FREE_LIMITS, current_usage
    ratio = float(os.getenv("HACDAO_REAL_USAGE_RATIO", "0.8"))
    print(f"\n② Mức dùng thật trên Cloudflare (so với gói Free; script sync tự dừng ở {ratio:.0%} các mục có ⛔):")
    usage, err = current_usage()
    if usage is None:
        print(f"  Không lấy được: {err}")
        return
    rows = [("d1_rows_written_day", "D1 dòng ghi hôm nay", "⛔"), ("d1_rows_read_day", "D1 dòng đọc hôm nay", ""),
            ("r2_class_a_month", "R2 Class A (ghi) tháng", "⛔"), ("r2_class_b_month", "R2 Class B (đọc) tháng", ""),
            ("workers_requests_day", "Workers request hôm nay", "")]
    for key, label, guard in rows:
        _line(f"{label} {guard}".strip(), usage[key], FREE_LIMITS[key])
    gb, free_gb = usage["r2_storage_bytes"] / 1e9, FREE_LIMITS["r2_storage_bytes"] / 1e9
    over = max(0.0, gb - free_gb)
    note = f"VƯỢT {over:.1f} GB ≈ {over * 0.015:.2f} USD/tháng nếu ở gói Free" if over else "trong hạn mức"
    print(f"  {'R2 dung lượng':<28} {gb:>10.1f} GB / {free_gb:>7.0f} GB  ({note})")


def main():
    show_fuse()
    show_cloudflare()
    print("\nGhi chú: ① là cầu chì tự đặt (có thể nâng/hạ bằng `gh variable set`); ② mới quyết định có tốn tiền.")


if __name__ == "__main__":
    main()
