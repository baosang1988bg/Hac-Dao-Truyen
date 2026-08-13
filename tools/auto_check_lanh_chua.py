#!/usr/bin/env python3
"""
tools/auto_check_lanh_chua.py — Tự động kiểm tra & dịch chương mới cho "Lãnh Chúa Cầu Sinh: Thiên Phú Hợp Thành"
Khung giờ chạy: 12h đêm (00:00 UTC+7 / 17:00 UTC).
"""

import sys
import os
import re
import json
import subprocess
import urllib.request
from pathlib import Path
from datetime import datetime

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

NOVEL_SLUG = "lanh-chua-cau-sinh-thien-phu-hop-thanh"
BASE_DIR = Path(__file__).parent.parent
NOVEL_DIR = BASE_DIR / "novels" / NOVEL_SLUG
NOVEL_JSON = NOVEL_DIR / "novel.json"
CATALOG_JSON = NOVEL_DIR / "catalog.json"
ANNOUNCEMENTS_JSON = BASE_DIR / "frontend" / "src" / "content" / "announcements.json"

SOURCE_PAGE = "https://r.jina.ai/https://www.novel543.com/0606657941/"

def fetch_latest_chapters():
    print(f"🔍 Đang truy cập trang nguồn novel543: {SOURCE_PAGE}...")
    req = urllib.request.Request(
        SOURCE_PAGE,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode("utf-8", errors="ignore")

    # Match chapters like: [第1499章 聯軍納新](https://www.novel543.com/0606657941/8096_1499.html ...)
    pattern = re.compile(r'\[第(\d+)章\s*([^\]]+)\]\((https?://[^\s\)]+)')
    matches = pattern.findall(content)
    
    new_chapters = []
    for num_str, title_orig, url in matches:
        ch_num = int(num_str)
        new_chapters.append({
            "number": ch_num,
            "original_title": f"第{ch_num}章 {title_orig.strip()}",
            "raw_title": title_orig.strip(),
            "url": url
        })
    return new_chapters

def main():
    print(f"⏰ [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Kiểm tra chương mới cho truyện '{NOVEL_SLUG}'...")
    
    if not NOVEL_JSON.exists() or not CATALOG_JSON.exists():
        print("❌ Không tìm thấy novel.json hoặc catalog.json.")
        sys.exit(1)

    with open(NOVEL_JSON, encoding='utf-8') as f:
        novel_meta = json.load(f)

    last_num = novel_meta.get("last_chapter_number", 0)
    print(f"📖 Chương hiện tại trong hệ thống: {last_num}")

    try:
        remote_chapters = fetch_latest_chapters()
    except Exception as e:
        print(f"⚠️ Lỗi khi lấy thông tin trang nguồn: {e}")
        sys.exit(1)

    # Lọc các chương lớn hơn last_num
    pending = [c for c in remote_chapters if c["number"] > last_num]
    pending.sort(key=lambda x: x["number"])

    if not pending:
        print(f"✅ Chưa có chương mới nào trên novel543 (Vẫn ở chương {last_num}).")
        return

    print(f"🔥 Phát hiện {len(pending)} chương mới: {[c['number'] for c in pending]}")

    with open(CATALOG_JSON, encoding='utf-8') as f:
        catalog = json.load(f)

    first_new = pending[0]["number"]

    for c in pending:
        ch_num = c["number"]
        url = c["url"]
        orig_title = c["original_title"]

        # Thêm vào catalog nếu chưa có
        if not any(item.get("number") == ch_num for item in catalog):
            catalog.append({
                "number": ch_num,
                "title": f"Chương {ch_num}",
                "original_title": orig_title,
                "url": url,
                "original_chapter_number": ch_num,
                "filename": f"Chương {ch_num}_VI.md"
            })

    # Ghi lại catalog & novel.json
    with open(CATALOG_JSON, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    novel_meta["total_chapters"] = pending[-1]["number"]
    with open(NOVEL_JSON, 'w', encoding='utf-8') as f:
        json.dump(novel_meta, f, ensure_ascii=False, indent=2)

    # 1. Chạy dịch bằng AI
    print("🚀 Đang chạy dịch chương mới...")
    cmd_trans = [sys.executable, "-u", "main.py", "translate", "--novel", NOVEL_SLUG, "--chapters", str(len(pending))]
    subprocess.run(cmd_trans, cwd=BASE_DIR, check=True)

    # 2. Sync lên Cloudflare R2/D1
    print("☁️ Đang đồng bộ lên Cloudflare R2/D1...")
    cmd_sync = [sys.executable, "-u", "migrate_to_cloudflare.py", "--slug", NOVEL_SLUG, "--from-chapter", str(first_new)]
    subprocess.run(cmd_sync, cwd=BASE_DIR, check=True)

    # 3. Cập nhật announcements.json
    today_str = datetime.now().strftime('%Y-%m-%d')
    ann_text = f"🔥 Vừa dịch & cập nhật thành công Chương {pending[-1]['number']} cho truyện 'Lãnh Chúa Cầu Sinh: Thiên Phú Hợp Thành'!"
    
    ann_data = []
    if ANNOUNCEMENTS_JSON.exists():
        try:
            with open(ANNOUNCEMENTS_JSON, encoding='utf-8') as f:
                ann_data = json.load(f)
        except Exception:
            pass

    ann_data.insert(0, {
        "date": today_str,
        "text": ann_text,
        "novel_slug": NOVEL_SLUG,
        "chapter": pending[-1]["number"]
    })
    
    with open(ANNOUNCEMENTS_JSON, 'w', encoding='utf-8') as f:
        json.dump(ann_data[:5], f, ensure_ascii=False, indent=2)

    # 4. Rebuild frontend & deploy wrangler
    print("📦 Đang build frontend...")
    npm_cmd = "npm.cmd" if os.name == 'nt' else "npm"
    npx_cmd = "npx.cmd" if os.name == 'nt' else "npx"
    subprocess.run([npm_cmd, "run", "build"], cwd=BASE_DIR / "frontend", check=True)

    print("🌐 Đang deploy Cloudflare Worker & Assets...")
    subprocess.run([npx_cmd, "wrangler", "deploy"], cwd=BASE_DIR, check=True)

    print("🎉 Tự động dịch, đồng bộ và deploy chương mới thành công!")

if __name__ == "__main__":
    main()
