#!/usr/bin/env python3
"""
tools/import_epub_library.py — Import toàn bộ kho EPUB (28,000+ truyện) từ meta/*.json & upload_state.json vào Cloudflare D1
"""
import os
import sys
import json
import tempfile
import subprocess
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

EPUB_DIR = Path("D:/epub_library")
D1_DB_NAME = "hacdao-db"

GENRE_NAMES = {
    "tien-hiep": "Tiên Hiệp",
    "huyen-huyen": "Huyền Huyễn",
    "kiem-hiep": "Kiếm Hiệp",
    "do-thi": "Đô Thị",
    "he-thong": "Hệ Thống",
    "khoa-huyen": "Khoa Huyễn",
    "dong-nhan": "Đồng Nhân",
    "vong-du": "Võng Du",
    "lich-su": "Lịch Sử",
    "tong-tai": "Tổng Tài",
    "ngon-tinh": "Ngôn Tình",
    "co-dai": "Cổ Đại",
    "kinh-di": "Kinh Dị",
    "duc-tai": "Đức Tài",
    "co-tri": "Cổ Trí",
    "dam-my": "Đam Mỹ",
    "di-gioi": "Dị Giới",
    "quan-su": "Quân Sự",
    "thien-tai": "Thiên Tài",
    "goc-nhin-nam": "Gốc Nhìn Nam",
    "dong-phuong-huyen-huyen": "Đông Phương HH",
}

def clean_str(s):
    if not s:
        return ''
    # Strip null bytes, single quotes, and semicolons (so Wrangler CLI does not split mid-string)
    s = str(s).replace(';', ' - ').replace('\x00', '').replace("'", "''")
    return s.encode('utf-8', errors='ignore').decode('utf-8', errors='ignore')

def q(val):
    if val is None:
        return "''"
    return f"'{clean_str(val)}'"

def main():
    state_file = EPUB_DIR / "upload_state.json"
    catalog_file = EPUB_DIR / "catalog_full.jsonl"
    meta_dir = EPUB_DIR / "meta"

    if not state_file.exists():
        print(f"❌ Không tìm thấy {state_file}")
        sys.exit(1)

    print(f"📖 Đang đọc {state_file}...")
    with open(state_file, encoding='utf-8') as f:
        state = json.load(f)

    uploaded = state.get("uploaded", {})
    print(f"✅ Đã upload {len(uploaded)} EPUBs lên Google Drive.")

    # Đọc catalog_full.jsonl làm fallback
    catalog = {}
    if catalog_file.exists():
        print(f"📖 Đang đọc catalog_full.jsonl...")
        with open(catalog_file, encoding='utf-8') as f:
            for line in f:
                if not line.strip(): continue
                try:
                    item = json.loads(line)
                    catalog[item['slug']] = item
                except Exception:
                    pass

    sql_statements = []
    count = 0

    print("🔄 Đang tạo câu lệnh SQL từ meta/*.json...")
    for slug, info in uploaded.items():
        epub_id = info.get("files", {}).get("epub", {}).get("id")
        if not epub_id:
            continue

        meta = {}
        meta_file = meta_dir / f"{slug}.json"
        if meta_file.exists():
            try:
                with open(meta_file, encoding='utf-8') as f:
                    meta = json.load(f)
            except Exception:
                pass

        cat = catalog.get(slug, {})

        title = meta.get("title") or cat.get("title") or slug.replace("-", " ").title()
        cover_url = meta.get("cover_url") or cat.get("cover_url", "")
        chapter_count = meta.get("chapter_count") or cat.get("chapter_count", 0)

        status_slug = meta.get("manga_status_slug") or cat.get("manga_status_slug", "")
        status = "completed" if status_slug in ["hoan-thanh", "completed"] else "ongoing"

        raw_genres = meta.get("genres") or cat.get("genres") or []
        if isinstance(raw_genres, list):
            mapped_genres = [GENRE_NAMES.get(g, g.replace("-", " ").title()) for g in raw_genres if g]
            genre_str = ", ".join(mapped_genres[:3])
        else:
            genre_str = str(raw_genres)

        sql = (
            f"INSERT INTO novels (slug, title, cover_url, total_chapters, status, genre, drive_file_id, has_epub) "
            f"VALUES ({q(slug)}, {q(title)}, {q(cover_url)}, {chapter_count}, {q(status)}, {q(genre_str)}, {q(epub_id)}, 1) "
            f"ON CONFLICT(slug) DO UPDATE SET "
            f"title = excluded.title, "
            f"cover_url = excluded.cover_url, "
            f"total_chapters = excluded.total_chapters, "
            f"status = excluded.status, "
            f"genre = excluded.genre, "
            f"drive_file_id = excluded.drive_file_id, "
            f"has_epub = 1;"
        )
        sql_statements.append(sql)
        count += 1

    print(f"📊 Đã chuẩn bị {count} câu lệnh SQL cập nhật metadata cho D1...")

    if not sql_statements:
        print("❌ Không có dữ liệu để sync.")
        return

    # Chia nhỏ thành các file batch SQL (500 câu lệnh / batch)
    BATCH_SIZE = 500
    total_batches = (len(sql_statements) + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(sql_statements), BATCH_SIZE):
        batch_num = (i // BATCH_SIZE) + 1
        chunk = sql_statements[i:i + BATCH_SIZE]
        print(f"🚀 Batch {batch_num}/{total_batches} ({len(chunk)} câu lệnh)...")

        with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', encoding='utf-8', delete=False) as f:
            f.write("\n".join(chunk))
            tmp_path = f.name

        try:
            cmd = ["npx.cmd", "wrangler", "d1", "execute", D1_DB_NAME, "--remote", f"--file={tmp_path}", "-y"]
            r = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
            if r.returncode == 0:
                print(f"  ✅ Batch {batch_num} thành công!")
            else:
                err_msg = (r.stderr or r.stdout or "").strip()
                print(f"  ❌ Batch {batch_num} lỗi: {err_msg[:200]}")
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    print("\n🎉 Đã cập nhật toàn bộ thông tin cơ bản (title, cover, genre, status) từ meta/*.json lên D1!")

if __name__ == '__main__':
    main()
