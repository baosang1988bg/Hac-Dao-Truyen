"""
publish_status.py
------------------
F03: kiểm tra trạng thái xuất bản/gỡ (takedown) của 1 truyện — dùng chung bởi
routers/novels.py và routers/chapters.py mà không tạo import vòng giữa 2 file.

`published` mặc định True cho truyện cũ chưa có field này trong novel.json
(tương thích ngược, không coi im lặng là bị gỡ).
"""

import json
import os

NOVELS_DIR = "novels"


def is_published(slug: str) -> bool:
    """True nếu truyện được phép hiển thị công khai (không bị takedown)."""
    json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
    if not os.path.isfile(json_path):
        return True  # không tồn tại -> để caller tự trả 404 theo logic riêng
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return True
    return bool(data.get("published", True))
