"""
tools/check_drift.py
--------------------
So sánh số chương đã dịch giữa LOCAL (novels/<slug>/translated/) và PRODUCTION
(Cloudflare D1, đọc qua GET /api/novels — field chapter_count có từ roadmap 1.1).

Dùng để phát hiện "drift" khi quên chạy migrate_to_cloudflare.py.

Chạy:
  python3 tools/check_drift.py                       # so với URL production mặc định
  python3 tools/check_drift.py --url https://...     # URL khác
  python3 tools/check_drift.py --fail-on-drift       # exit 1 nếu lệch (dùng cho CI/cron)

Cách đếm local đồng bộ với routers/novels.py: file *_VI.md, bỏ file phần split
khi bản merge đã tồn tại.
"""

import os
import re
import sys
import json
import argparse
import urllib.request

# Bootstrap để chạy được từ root hoặc từ tools/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_URL = os.getenv(
    "PROD_URL", "https://hac-dao-truyen.nguyenbaosang1998.workers.dev"
)
NOVELS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "novels"
)
_SPLIT_PART_RE = re.compile(r"^(.+)-(\d+)_VI\.md$")


def count_local(slug: str) -> int:
    trans_dir = os.path.join(NOVELS_DIR, slug, "translated")
    if not os.path.isdir(trans_dir):
        return 0
    all_md = set(f for f in os.listdir(trans_dir) if f.endswith("_VI.md"))
    n = 0
    for f in all_md:
        m = _SPLIT_PART_RE.match(f)
        if m and f"{m.group(1)}_VI.md" in all_md:
            continue  # phần split đã có bản merge
        n += 1
    return n


def fetch_remote(base_url: str) -> dict:
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/novels",
        headers={"User-Agent": "hacdao-check-drift/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    return {n["slug"]: n for n in data}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--fail-on-drift", action="store_true")
    args = ap.parse_args()

    remote = fetch_remote(args.url)
    local_slugs = sorted(
        d for d in os.listdir(NOVELS_DIR)
        if os.path.isfile(os.path.join(NOVELS_DIR, d, "novel.json"))
    )

    print(f"{'slug':<45} {'local':>6} {'remote':>6} {'lệch':>6}")
    print("-" * 68)
    drift_total = 0
    for slug in local_slugs:
        lc = count_local(slug)
        rc = remote.get(slug, {}).get("chapter_count")
        if rc is None:
            mark = "❌ thiếu trên production" if lc > 0 else "(chưa dịch, bỏ qua)"
            if lc > 0:
                drift_total += lc
            print(f"{slug:<45} {lc:>6} {'—':>6}   {mark}")
            continue
        d = lc - rc
        drift_total += abs(d)
        mark = "✅" if d == 0 else f"⚠️  lệch {d:+d}"
        print(f"{slug:<45} {lc:>6} {rc:>6}   {mark}")

    only_remote = sorted(set(remote) - set(local_slugs))
    for slug in only_remote:
        rc = remote[slug].get("chapter_count", 0)
        print(f"{slug:<45} {'—':>6} {rc:>6}   (chỉ có trên production)")

    print("-" * 68)
    if drift_total == 0:
        print("✅ Không lệch — local và production đồng bộ.")
    else:
        print(f"⚠️  Tổng lệch {drift_total} chương. "
              f"Chạy: python3 migrate_to_cloudflare.py --slug <slug-bị-lệch>")
    if args.fail_on_drift and drift_total > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
