#!/usr/bin/env python3
"""
tools/translate_range.py — Dịch 1 khoảng chương bắt đầu từ URL bất kỳ rồi
công bố lên Cloudflare qua Worker API (dùng cho workflow translate_range.yml).

Khác auto_check_novel.py (chỉ dịch chương MỚI hơn last_chapter_number): ở đây
người dùng chỉ định điểm bắt đầu, vd nhảy cóc tới chương 1684 khi site mới có
tới 1185. Số chương công bố lấy theo catalog.json (field `number`).

Usage:
  python tools/translate_range.py --slug <slug> --url <url bắt đầu> [--chapters N]
  (bỏ --chapters = dịch tới hết catalog)
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import auto_check_novel

BASE_DIR = auto_check_novel.BASE_DIR


def catalog_range(slug: str, start_url: str, chapters: int | None) -> list:
    """Các mục catalog từ start_url, tối đa `chapters` mục (None = tới cuối)."""
    catalog = json.loads((auto_check_novel.NOVELS_DIR / slug / "catalog.json").read_text(encoding="utf-8"))
    start = next((i for i, item in enumerate(catalog) if item.get("url") == start_url), None)
    if start is None:
        raise SystemExit(f"❌ Không tìm thấy {start_url} trong catalog.json của {slug}")
    end = len(catalog) if not chapters else start + chapters
    return catalog[start:end]


def untranslated_numbers(slug: str, numbers: list) -> list:
    """Số chương trong `numbers` chưa có bản dịch tốt trong translated/."""
    from migrate_to_cloudflare import get_chapter_number, get_title
    trans_dir = auto_check_novel.NOVELS_DIR / slug / "translated"
    failed = set(auto_check_novel.find_failed_chapters(trans_dir))
    done = {get_chapter_number(get_title(fp), fp.name) for fp in trans_dir.glob("*.md")} if trans_dir.exists() else set()
    return [n for n in numbers if n not in done or n in failed]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--url", required=True, help="URL chương bắt đầu (phải có trong catalog.json)")
    ap.add_argument("--chapters", type=int, default=0, help="Số chương (0 = tới cuối catalog)")
    args = ap.parse_args()

    items = catalog_range(args.slug, args.url, args.chapters)
    numbers = [item["number"] for item in items]
    print(f"📚 [{args.slug}] Dịch {len(items)} chương: {numbers[0]} → {numbers[-1]}")

    missing = untranslated_numbers(args.slug, numbers)
    if missing:
        subprocess.run(
            [sys.executable, "-u", "main.py", "translate", "--novel", args.slug,
             "--url", args.url, "--chapters", str(len(items))],
            cwd=BASE_DIR, check=True,
        )
    else:
        # Chạy lại sau khi lần trước dịch xong nhưng sync lỗi (vd hết ngân
        # sách) → chỉ công bố, không tốn quota dịch lại.
        print(f"♻️ [{args.slug}] Đã có đủ bản dịch, chỉ công bố lên Cloudflare.")

    novel_json = auto_check_novel.NOVELS_DIR / args.slug / "novel.json"
    novel_meta = json.loads(novel_json.read_text(encoding="utf-8"))
    # Chương đã đăng nhưng đổi nội dung (vd chuẩn hoá tên theo glossary) nằm
    # trong republish_pending.json kèm r2_key cũ → đẩy trước, nếu không đợt
    # đẩy thường bên dưới bị Worker trả 409 vì thiếu expected_r2_key.
    if not auto_check_novel.publish_republish_queue(args.slug, novel_meta):
        sys.exit(1)
    # sync_via_worker_api tự loại bản dịch lỗi và trả False nếu có chương lỗi.
    synced = auto_check_novel.sync_via_worker_api(
        args.slug, novel_meta, [{"number": n} for n in numbers], BASE_DIR)
    if synced is not True:
        print(f"❌ [{args.slug}] Chưa công bố đủ {len(numbers)} chương (kết quả sync: {synced}).")
        sys.exit(1)
    print(f"🎉 [{args.slug}] Đã dịch & công bố chương {numbers[0]} → {numbers[-1]}.")


if __name__ == "__main__":
    main()
