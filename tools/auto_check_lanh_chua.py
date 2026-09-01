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

def sync_via_worker_api(slug: str, novel_meta: dict, pending: list, base_dir: Path) -> bool:
    """Đồng bộ trực tiếp lên Cloudflare D1 + R2 qua Worker API /api/admin/sync-novel bằng HACDAO_SYNC_KEY."""
    sync_key = os.getenv("HACDAO_SYNC_KEY", "").strip()
    if not sync_key:
        print("ℹ️ Không tìm thấy HACDAO_SYNC_KEY để đồng bộ qua Worker API.")
        return False

    host = "hac-dao-truyen.nguyenbaosang1998.workers.dev"
    url = f"https://{host}/api/admin/sync-novel"
    trans_dir = base_dir / "novels" / slug / "translated"

    if not trans_dir.exists():
        print(f"⚠️ Thư mục dịch {trans_dir} không tồn tại.")
        return False

    chapters_to_sync = []
    for c in pending:
        ch_num = c["number"]
        found_file = None
        for fp in trans_dir.glob("*.md"):
            if f"Chương {ch_num}" in fp.name or f"第{ch_num}章" in fp.name or fp.name.startswith(f"{ch_num}_") or f"_{ch_num}_" in fp.name:
                found_file = fp
                break

        if not found_file:
            print(f"⚠️ Không tìm thấy file dịch cho Chương {ch_num}")
            continue

        content = found_file.read_text(encoding="utf-8")
        first_line = content.splitlines()[0] if content else f"Chương {ch_num}"
        title = first_line.lstrip("# ").strip()

        chapters_to_sync.append({
            "filename": found_file.name,
            "title": title,
            "number": ch_num,
            "content": content
        })

    if not chapters_to_sync:
        print("⚠️ Không có nội dung chương nào để sync qua Worker API.")
        return False

    print(f"📡 Đang đẩy {len(chapters_to_sync)} chương lên Cloudflare D1 + R2 qua Worker API (/api/admin/sync-novel)...")
    payload = {
        "slug": slug,
        "title": novel_meta.get("title", slug),
        "original_title": novel_meta.get("original_title", ""),
        "author": novel_meta.get("author", "Unknown"),
        "genre": novel_meta.get("genre", "cultivation"),
        "total_chapter_count": novel_meta.get("total_chapters", len(chapters_to_sync)),
        "is_first_chunk": True,
        "chapters": chapters_to_sync
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "x-sync-key": sync_key,
            "User-Agent": "HacDaoAutoSyncer/1.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp_body = resp.read().decode("utf-8")
            print(f"✅ Đồng bộ thành công lên Cloudflare D1 + R2 ({resp_body[:80]}).")
            return True
    except Exception as e:
        print(f"⚠️ Lỗi khi sync qua Worker API: {e}")
        return False

def main():
    print(f"⏰ [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Kiểm tra chương mới cho truyện '{NOVEL_SLUG}'...")
    
    NOVEL_DIR.mkdir(parents=True, exist_ok=True)
    (NOVEL_DIR / "translated").mkdir(parents=True, exist_ok=True)
    (NOVEL_DIR / "text_raw").mkdir(parents=True, exist_ok=True)

    if not NOVEL_JSON.exists():
        print("ℹ️ Chưa có novel.json, đang khởi tạo cấu hình mặc định...")
        novel_meta = {
            "slug": NOVEL_SLUG,
            "title": "Lãnh Chúa Cầu Sinh: Thiên Phú Hợp Thành",
            "original_title": "領主求生之天賦合成",
            "author": "Kỳ Khai (祁開)",
            "source_url": "https://www.novel543.com/0606657941/8096_1.html",
            "genre": "cultivation",
            "last_translated_url": "https://www.novel543.com/0606657941/8096_1500.html",
            "last_chapter_number": 1500,
            "total_chapters": 1500,
            "glossary": {
                "陈辞": "Trần Từ",
                "领主": "Lãnh chúa",
                "求生": "Cầu sinh",
                "天赋合成": "Thiên phú hợp thành"
            },
            "translation_style": "",
            "notes": "Tự động dịch từ novel543"
        }
        with open(NOVEL_JSON, 'w', encoding='utf-8') as f:
            json.dump(novel_meta, f, ensure_ascii=False, indent=2)
    else:
        with open(NOVEL_JSON, encoding='utf-8') as f:
            novel_meta = json.load(f)

    if not CATALOG_JSON.exists():
        print("ℹ️ Chưa có catalog.json, đang khởi tạo danh mục ban đầu...")
        catalog = [
            {
                "number": 1500,
                "title": "Chương 1500",
                "original_title": "第1500章 禪山城",
                "url": "https://www.novel543.com/0606657941/8096_1500.html",
                "original_chapter_number": 1500,
                "filename": "Chương 1500_VI.md"
            }
        ]
        with open(CATALOG_JSON, 'w', encoding='utf-8') as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)
    else:
        with open(CATALOG_JSON, encoding='utf-8') as f:
            catalog = json.load(f)

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

    # Đọc lại novel.json sau khi dịch để lấy last_chapter_number mới nhất
    if NOVEL_JSON.exists():
        try:
            with open(NOVEL_JSON, encoding='utf-8') as f:
                novel_meta = json.load(f)
        except Exception:
            pass

    # 2. Sync lên Cloudflare R2/D1
    print("☁️ Đang đồng bộ lên Cloudflare R2/D1...")
    cf_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    synced = False

    if cf_token:
        try:
            cmd_sync = [sys.executable, "-u", "migrate_to_cloudflare.py", "--slug", NOVEL_SLUG, "--from-chapter", str(first_new)]
            subprocess.run(cmd_sync, cwd=BASE_DIR, check=True)
            print("✅ Đã đồng bộ thành công lên Cloudflare qua wrangler CLI.")
            synced = True
        except Exception as e:
            print(f"⚠️ Lỗi khi đồng bộ qua wrangler CLI: {e}")

    if not synced:
        sync_ok = sync_via_worker_api(NOVEL_SLUG, novel_meta, pending, BASE_DIR)
        if not sync_ok and not cf_token:
            print("ℹ️ Chưa cấu hình CLOUDFLARE_API_TOKEN hoặc HACDAO_SYNC_KEY hợp lệ.")

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

    print("🎉 Tự động dịch và đồng bộ chương mới thành công!")

if __name__ == "__main__":
    main()
