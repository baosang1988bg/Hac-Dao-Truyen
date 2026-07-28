#!/usr/bin/env python3
"""
fetch_catalog.py — Lấy toàn bộ danh sách truyện từ audiotruyenfull.org
Chạy 1 lần, lưu ra catalog_full.jsonl (1 dòng = 1 truyện).
Lần sau dùng lại file này, không cần fetch lại trừ khi muốn cập nhật.

Usage:
  python fetch_catalog.py --output-dir ~/Downloads/epub_library
  python fetch_catalog.py --output-dir ~/Downloads/epub_library --force   # fetch lại dù đã có
"""
import argparse, json, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
from datetime import datetime

BASE = "https://web.audiotruyenfull.org/api/bff"
HEADERS = {"Accept":"application/json","User-Agent":"Mozilla/5.0"}

def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def fetch_all(status="", sort="newest"):
    params = {"page":1,"limit":100,"sort":sort}
    if status: params["status"] = status
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k,v in params.items())
    p1 = get(f"{BASE}/ebook-convert/list?{qs}")
    total_pages = p1["total_pages"]
    total = p1.get("filtered_total", p1["total"])
    items = list(p1["items"])
    print(f"[catalog] {total:,} truyện | {total_pages} trang")

    for page in range(2, total_pages+1):
        time.sleep(0.35)
        for attempt in range(3):
            try:
                params["page"] = page
                qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k,v in params.items())
                r = get(f"{BASE}/ebook-convert/list?{qs}")
                items.extend(r["items"])
                pct = page/total_pages*100
                print(f"\r  Trang {page}/{total_pages} ({pct:.0f}%) — {len(items):,}", end="", flush=True)
                break
            except Exception as e:
                if attempt==2: print(f"\n  Lỗi trang {page}: {e}")
                else: time.sleep(2)
    print()
    return items

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output-dir", default="./epub_library")
    p.add_argument("--force", action="store_true", help="Fetch lại dù đã có catalog")
    args = p.parse_args()

    outdir = Path(args.output_dir).expanduser().resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    jsonl_path = outdir / "catalog_full.jsonl"
    meta_path  = outdir / "catalog_meta.json"

    # Skip nếu đã có và không --force
    if jsonl_path.exists() and not args.force:
        count = sum(1 for _ in open(jsonl_path, encoding="utf-8"))
        meta  = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        print(f"[catalog] Đã có {count:,} truyện (lấy lúc {meta.get('fetched_at','?')})")
        print("  Dùng --force để fetch lại")
        return

    print("[catalog] Đang fetch từ API...")
    items = fetch_all()

    with open(jsonl_path, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")

    meta_path.write_text(json.dumps({
        "fetched_at": datetime.now().isoformat(),
        "total": len(items),
    }, ensure_ascii=False, indent=2))

    print(f"[catalog] Lưu {len(items):,} truyện → {jsonl_path}")

if __name__ == "__main__":
    main()
