#!/usr/bin/env python3
"""
tools/manage_auto_check.py — Quản lý danh sách truyện tự động kiểm tra & cập nhật chương mới.

Hỗ trợ:
  - list: Hiển thị các truyện đang được theo dõi và trạng thái chương.
  - add <slug> [--url <source_index_url>]: Thêm hoặc kích hoạt truyện vào danh sách auto-check.
  - remove <slug>: Hủy kích hoạt truyện khỏi danh sách auto-check.
  - run [--slug <slug>]: Thực thi kiểm tra & cập nhật chương mới cho toàn bộ danh sách hoặc 1 truyện.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent.parent
NOVELS_DIR = BASE_DIR / "novels"
AUTO_CHECK_SCRIPT = BASE_DIR / "tools" / "auto_check_novel.py"


def _get_novel_path(slug: str) -> Path:
    return NOVELS_DIR / slug / "novel.json"


def list_tracked():
    """Hiển thị bảng danh sách các truyện và trạng thái auto-check."""
    print("=" * 80)
    print("DANH SÁCH TRUYỆN AUTO-CHECK CẬP NHẬT CHƯƠNG MỚI")
    print("=" * 80)
    
    tracked = []
    untracked = []

    for novel_json in sorted(NOVELS_DIR.glob("*/novel.json")):
        slug = novel_json.parent.name
        try:
            with open(novel_json, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            continue

        title = data.get("title", slug)
        last_ch = data.get("last_chapter_number", 0)
        auto_cfg = data.get("auto_check") or {}
        is_enabled = bool(auto_cfg.get("enabled"))
        source_index = auto_cfg.get("source_index_url", "")

        info = {
            "slug": slug,
            "title": title,
            "last_ch": last_ch,
            "enabled": is_enabled,
            "source_index": source_index,
        }

        if is_enabled:
            tracked.append(info)
        else:
            untracked.append(info)

    if tracked:
        print("\n[Đang theo dõi tự động]:")
        for idx, item in enumerate(tracked, 1):
            print(f" {idx}. {item['title']} ({item['slug']})")
            print(f"    - Chương hiện tại : {item['last_ch']}")
            print(f"    - Nguồn index     : {item['source_index']}")
    else:
        print("\n[!] Chưa có truyện nào được kích hoạt theo dõi tự động.")

    if untracked:
        print("\n[Truyện có sẵn nhưng chưa bật auto-check]:")
        for item in untracked:
            print(f" - {item['slug']} (Chương: {item['last_ch']})")
    print("=" * 80)


def add_tracked(slug: str, source_url: str = None) -> bool:
    """Thêm hoặc bật auto_check cho một truyện."""
    novel_path = _get_novel_path(slug)
    if not novel_path.exists():
        print(f"❌ Không tìm thấy novel.json cho slug '{slug}' tại {novel_path}")
        return False

    with open(novel_path, encoding="utf-8") as f:
        data = json.load(f)

    if not source_url:
        existing_auto = (data.get("auto_check") or {}).get("source_index_url")
        if existing_auto:
            source_url = existing_auto
        else:
            base_source = data.get("source_url", "")
            # Chuẩn hóa nếu là novel543 .../dir -> .../
            if "novel543.com" in base_source:
                import re
                m = re.match(r"(https?://www\.novel543\.com/\d+/)", base_source)
                if m:
                    source_url = m.group(1)
                else:
                    source_url = base_source
            else:
                source_url = base_source

    if not source_url:
        print(f"❌ Không xác định được source_index_url cho slug '{slug}'. Vui lòng cung cấp --url.")
        return False

    data["auto_check"] = {
        "enabled": True,
        "source_index_url": source_url,
    }

    with open(novel_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ Đã thêm '{slug}' vào danh sách auto-check:")
    print(f"   - Tên truyện: {data.get('title', slug)}")
    print(f"   - Source index URL: {source_url}")
    return True


def remove_tracked(slug: str) -> bool:
    """Tắt auto_check cho một truyện."""
    novel_path = _get_novel_path(slug)
    if not novel_path.exists():
        print(f"❌ Không tìm thấy novel.json cho slug '{slug}'")
        return False

    with open(novel_path, encoding="utf-8") as f:
        data = json.load(f)

    if "auto_check" in data:
        data["auto_check"]["enabled"] = False
    else:
        data["auto_check"] = {"enabled": False}

    with open(novel_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ Đã hủy kích hoạt auto-check cho '{slug}'.")
    return True


def run_update(slug: str = None):
    """Gọi công cụ auto_check_novel.py."""
    cmd = [sys.executable, "-u", str(AUTO_CHECK_SCRIPT)]
    if slug:
        cmd.extend(["--slug", slug])

    print(f"🚀 Bắt đầu cập nhật chương mới: {'slug=' + slug if slug else 'Tất cả truyện theo dõi'}...")
    res = subprocess.run(cmd, cwd=BASE_DIR)
    return res.returncode == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", help="Lệnh thực hiện")

    # list
    subparsers.add_parser("list", help="Liệt kê danh sách truyện theo dõi")

    # add
    add_parser = subparsers.add_parser("add", help="Thêm truyện vào danh sách auto-check")
    add_parser.add_argument("slug", help="Slug của truyện trong thư mục novels/")
    add_parser.add_argument("--url", help="URL trang index/danh mục nguồn (qua Jina Reader)")

    # remove
    rm_parser = subparsers.add_parser("remove", help="Tắt auto-check cho một truyện")
    rm_parser.add_argument("slug", help="Slug của truyện")

    # run
    run_parser = subparsers.add_parser("run", help="Chạy cập nhật chương mới")
    run_parser.add_argument("--slug", help="Chỉ chạy cho 1 slug cụ thể")

    args = parser.parse_args()

    if args.action == "list" or not args.action:
        list_tracked()
    elif args.action == "add":
        add_tracked(args.slug, args.url)
    elif args.action == "remove":
        remove_tracked(args.slug)
    elif args.action == "run":
        ok = run_update(args.slug)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
