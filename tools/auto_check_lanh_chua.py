#!/usr/bin/env python3
"""
tools/auto_check_lanh_chua.py — facade tương thích ngược.

Logic thật đã tổng quát hóa sang tools/auto_check_novel.py (mọi truyện có
`auto_check.enabled: true` trong novel.json, không riêng gì "Lãnh Chúa Cầu
Sinh: Thiên Phú Hợp Thành" nữa — xem novels/lanh-chua-cau-sinh-thien-phu-hop-thanh/novel.json).

File này chỉ còn giữ lại làm lối vào cũ cho bất kỳ chỗ nào (script, test)
đang import trực tiếp NOVEL_SLUG/SOURCE_PAGE/fetch_latest_chapters() —
KHÔNG thêm logic mới vào đây, mọi thay đổi hành vi thật sự sửa ở
auto_check_novel.py.
"""

import sys
import urllib.request  # re-export: tests monkeypatch auto_check_lanh_chua.urllib.request.urlopen
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import auto_check_novel

NOVEL_SLUG = "lanh-chua-cau-sinh-thien-phu-hop-thanh"
SOURCE_PAGE = "https://r.jina.ai/https://www.novel543.com/0606657941/"


def fetch_latest_chapters():
    return auto_check_novel.fetch_latest_chapters(SOURCE_PAGE)


def main():
    ok = auto_check_novel.check_and_translate_novel(NOVEL_SLUG)
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
