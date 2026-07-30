#!/usr/bin/env python3
"""
tools/build_all_epubs.py — Build & Sync tất cả file EPUB lên Cloudflare R2
"""
import os
import sys
import subprocess
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.build_epub import build_novel_epub, list_novels

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

NOVELS_DIR = Path("novels")
R2_BUCKET = "hacdao-chapters"
D1_DB_NAME = "hacdao-db"

def main():
    novels = list_novels(NOVELS_DIR)
    print(f"📚 Tìm thấy {len(novels)} truyện có chương dịch trong {NOVELS_DIR}:\n")

    synced_slugs = []

    for slug, title, count in novels:
        print(f"--------------------------------------------------")
        print(f"📖 [{slug}] {title} ({count} chương)")
        try:
            res = build_novel_epub(slug, novels_dir=NOVELS_DIR, prefer_ebooklib=True, quiet=False)
            epub_path = Path(res["path"])
            if not epub_path.exists():
                print(f"  ❌ Không tìm thấy file EPUB: {epub_path}")
                continue

            size_kb = epub_path.stat().st_size // 1024
            print(f"  📦 Đã build EPUB: {epub_path.name} ({size_kb} KB)")

            # Upload lên Cloudflare R2
            r2_key = f"{slug}/book.epub"
            cmd = ["npx.cmd", "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{r2_key}", "--file", str(epub_path.resolve()), "--remote"]
            print(f"  ☁️  Đang upload lên R2: {r2_key}...")
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0:
                print(f"  ✅ Upload R2 thành công!")
                synced_slugs.append(slug)
            else:
                print(f"  ❌ Upload R2 thất bại: {r.stderr[:200]}")

        except Exception as e:
            print(f"  ❌ Lỗi build EPUB cho {slug}: {e}")

    if synced_slugs:
        print(f"\n🔄 Đang cập nhật has_epub = 1 cho {len(synced_slugs)} truyện trong D1...")
        slug_list = ",".join([f"'{s}'" for s in synced_slugs])
        sql = f"UPDATE novels SET has_epub = 1 WHERE slug IN ({slug_list});"
        cmd = ["npx.cmd", "wrangler", "d1", "execute", D1_DB_NAME, "--remote", f"--command={sql}"]
        subprocess.run(cmd)

    print("\n🎉 Hoàn thành build & upload toàn bộ EPUB lên Cloudflare!")

if __name__ == '__main__':
    main()
