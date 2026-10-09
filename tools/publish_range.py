#!/usr/bin/env python3
"""
tools/publish_range.py — Công bố lên Cloudflare (Worker API) các chương ĐÃ CÓ
bản dịch trong novels/<slug>/translated/ thuộc khoảng số [--from, --to].

Dùng cho chương không đi qua pipeline dịch (vd lấp khoảng trống bằng bản có
sẵn) hoặc chạy lại sau khi sync lỗi. Hàng đợi republish_pending.json (chương
đã đăng nhưng đổi nội dung) được đẩy trước. Bản dịch lỗi không bao giờ đẩy.

Usage:
  python tools/publish_range.py --slug <slug> --from 1186 --to 1683
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import auto_check_novel

_NUM_RE = re.compile(r"^Chương (\d+)\b")


def publish(slug: str, first: int, last: int) -> bool:
    novel_dir = auto_check_novel.NOVELS_DIR / slug
    novel_meta = json.loads((novel_dir / "novel.json").read_text(encoding="utf-8"))
    if not auto_check_novel.publish_republish_queue(slug, novel_meta):
        return False

    trans_dir = novel_dir / "translated"
    failed = set(auto_check_novel.find_failed_chapters(trans_dir))
    numbers = sorted({int(m.group(1)) for fp in trans_dir.glob("*.md")
                      if (m := _NUM_RE.match(fp.name)) and first <= int(m.group(1)) <= last} - failed)
    if failed & set(range(first, last + 1)):
        print(f"⚠️ [{slug}] Bỏ qua bản dịch lỗi: {sorted(failed & set(range(first, last + 1)))}")
    if not numbers:
        print(f"ℹ️ [{slug}] Không có chương nào trong khoảng {first}–{last}.")
        return True
    print(f"📚 [{slug}] Công bố {len(numbers)} chương: {numbers[0]} → {numbers[-1]}")
    return auto_check_novel.sync_via_worker_api(
        slug, novel_meta, [{"number": n} for n in numbers], auto_check_novel.BASE_DIR) is True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--from", dest="first", type=int, required=True)
    ap.add_argument("--to", dest="last", type=int, required=True)
    args = ap.parse_args()
    if not publish(args.slug, args.first, args.last):
        print(f"❌ [{args.slug}] Chưa công bố đủ; chạy lại để tiếp tục (chương đã đẩy được bỏ qua an toàn).")
        sys.exit(1)
    print(f"🎉 [{args.slug}] Đã công bố khoảng {args.first}–{args.last}.")


if __name__ == "__main__":
    main()
