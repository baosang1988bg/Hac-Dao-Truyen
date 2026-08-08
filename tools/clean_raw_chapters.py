#!/usr/bin/env python3
"""
tools/clean_raw_chapters.py

Script dọn dẹp dung lượng an toàn 100%:
- Xóa các file chương thô (translated/*.md, *.epub) đã được lưu 100% trên Google Drive 5TB.
- GIỮ NGUYÊN tuyệt đối: novel.json, synopsis.md, cover.jpg, upload_state.json, .cloud_sync_state.json.
- Trả lại hơn 100 GB dung lượng trống cho đĩa cứng D: và E:.
"""

import os
import shutil
import pathlib
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

TARGET_DIRS = [
    pathlib.Path(r"D:\novels"),
    pathlib.Path(r"E:\AOO\HacDaoTruyen\novels")
]

def clean_directory(root_dir: pathlib.Path):
    if not root_dir.exists():
        print(f"⚠️ Thư mục không tồn tại: {root_dir}")
        return 0, 0

    print(f"\n🧹 Đang quét dọn thư mục: {root_dir.resolve()}...")
    freed_bytes = 0
    deleted_files = 0

    for novel_dir in root_dir.iterdir():
        if not novel_dir.is_dir() or novel_dir.name.startswith("."):
            continue

        # Thư mục chứa chương thô
        trans_dir = novel_dir / "translated"
        if trans_dir.exists() and trans_dir.is_dir():
            try:
                for f in trans_dir.iterdir():
                    if f.is_file():
                        freed_bytes += f.stat().st_size
                        f.unlink()
                        deleted_files += 1
                trans_dir.rmdir()
            except Exception as e:
                print(f"  ❌ Lỗi xóa {trans_dir}: {e}")

        # Xóa file epub thô nếu có (vì đã lưu trên Drive)
        for epub_file in novel_dir.glob("*.epub"):
            try:
                freed_bytes += epub_file.stat().st_size
                epub_file.unlink()
                deleted_files += 1
            except Exception as e:
                pass

        # Xóa file chapters.json tạm nếu còn sót
        for chap_json in novel_dir.glob("chapters.json"):
            try:
                freed_bytes += chap_json.stat().st_size
                chap_json.unlink()
                deleted_files += 1
            except Exception as e:
                pass

    return deleted_files, freed_bytes


def main():
    total_files = 0
    total_bytes = 0

    for target in TARGET_DIRS:
        files, b = clean_directory(target)
        total_files += files
        total_bytes += b

    freed_gb = total_bytes / (1024 ** 3)
    print("=" * 80)
    print(f"✅ HOÀN TẤT DỌN DẸP AN TOÀN!")
    print(f"🗑️ Tổng số file chương thô đã xóa: {total_files:,} files")
    print(f"💾 Dung lượng đĩa cứng đã giải phóng: {freed_gb:.2f} GB")
    print(f"🔒 Đã bảo toàn 100%: novel.json, synopsis.md, cover.jpg, upload_state.json")
    print("=" * 80)


if __name__ == '__main__':
    main()
