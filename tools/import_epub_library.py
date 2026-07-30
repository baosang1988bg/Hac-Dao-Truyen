#!/usr/bin/env python3
"""
tools/import_epub_library.py — Import toàn bộ kho EPUB (28,000+ truyện) từ Google Drive upload_state.json & catalog_full.jsonl vào Cloudflare D1
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

    if not state_file.exists():
        print(f"❌ Không tìm thấy {state_file}")
        sys.exit(1)

    print(f"📖 Đang đọc {state_file}...")
    with open(state_file, encoding='utf-8') as f:
        state = json.load(f)

    uploaded = state.get("uploaded", {})
    print(f"✅ Đã upload {len(uploaded)} EPUBs lên Google Drive.")

    # Đọc catalog_full.jsonl nếu có
    catalog = {}
    if catalog_file.exists():
        print(f"📖 Đang đọc metadata từ {catalog_file}...")
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

    for slug, info in uploaded.items():
        epub_id = info.get("files", {}).get("epub", {}).get("id")
        if not epub_id:
            continue

        meta = catalog.get(slug, {})
        title = meta.get("title") or slug.replace("-", " ").title()
        cover_url = meta.get("cover_url", "")
        chapter_count = meta.get("chapter_count", 0)
        genre = meta.get("genre", "")

        sql = (
            f"INSERT INTO novels (slug, title, cover_url, total_chapters, genre, drive_file_id, has_epub) "
            f"VALUES ({q(slug)}, {q(title)}, {q(cover_url)}, {chapter_count}, {q(genre)}, {q(epub_id)}, 1) "
            f"ON CONFLICT(slug) DO UPDATE SET "
            f"drive_file_id = excluded.drive_file_id, "
            f"has_epub = 1, "
            f"title = CASE WHEN novels.title IS NULL OR novels.title = '' THEN excluded.title ELSE novels.title END, "
            f"cover_url = CASE WHEN novels.cover_url IS NULL OR novels.cover_url = '' THEN excluded.cover_url ELSE novels.cover_url END, "
            f"total_chapters = CASE WHEN novels.total_chapters IS NULL OR novels.total_chapters = 0 THEN excluded.total_chapters ELSE novels.total_chapters END;"
        )
        sql_statements.append(sql)
        count += 1

    print(f"📊 Đã chuẩn bị {count} câu lệnh SQL cho D1...")

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

    print("\n🎉 Đã import toàn bộ kho EPUB Google Drive vào Cloudflare D1!")

    print("\n🎉 Đã import toàn bộ kho EPUB Google Drive vào Cloudflare D1!")

if __name__ == '__main__':
    main()
