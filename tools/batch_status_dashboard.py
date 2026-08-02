#!/usr/bin/env python3
"""
tools/batch_status_dashboard.py

Bảng điều khiển trực quan (Visual Dashboard) theo dõi tiến độ tách & upload Cloudflare:
- Hiển thị tổng số truyện đã tách local (D:\novels)
- Hiển thị tổng số truyện đã sync server Cloudflare (D1/R2)
- Hiển thị danh sách các issue / lỗi phát sinh được cache lại (split_issues, sync_issues)
- Xem thời gian thực thi, phần trăm hoàn thành, số lượng chapter
"""

import sys
import os
import json
import time
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def main():
    novels_dir = Path(r"D:\novels")
    epubs_dir = Path(r"D:\epub_library\epubs")

    total_epubs = len([p for p in epubs_dir.glob("*.epub") if not p.name.startswith("._") and not p.name.startswith(".")]) if epubs_dir.exists() else 28477

    local_folders = [d for d in novels_dir.iterdir() if d.is_dir() and not d.name.startswith(".")] if novels_dir.exists() else []
    local_count = len(local_folders)

    # Cloud sync state
    sync_state_file = novels_dir / ".cloud_sync_state.json"
    synced_slugs = []
    if sync_state_file.exists():
        try:
            data = json.loads(sync_state_file.read_text(encoding='utf-8'))
            synced_slugs = data.get('synced_slugs', [])
        except Exception:
            pass

    # Issues cache
    split_issues_file = novels_dir / ".split_issues.json"
    split_issues = {}
    if split_issues_file.exists():
        try:
            split_issues = json.loads(split_issues_file.read_text(encoding='utf-8'))
        except Exception:
            pass

    sync_issues_file = novels_dir / ".sync_issues.json"
    sync_issues = {}
    if sync_issues_file.exists():
        try:
            sync_issues = json.loads(sync_issues_file.read_text(encoding='utf-8'))
        except Exception:
            pass

    pct_local = (local_count / total_epubs) * 100 if total_epubs > 0 else 0
    pct_sync = (len(synced_slugs) / total_epubs) * 100 if total_epubs > 0 else 0

    print("=" * 80)
    print("📊 BẢNG TIẾN ĐỘ THỜI GIAN THỰC (EPUB SPLITTER & CLOUDFLARE SYNC DASHBOARD)")
    print("=" * 80)
    print(f"📚 Tổng số EPUB cần xử lý:      {total_epubs:,} truyện")
    print(f"📂 Đã tách local (D:\\novels):     {local_count:,} / {total_epubs:,} ({pct_local:.1f}%)")
    print(f"☁️  Đã sync Server (Cloudflare): {len(synced_slugs):,} / {total_epubs:,} ({pct_sync:.1f}%)")
    print(f"⚠️  Tổng số Lỗi Tách (Local):    {len(split_issues):,} truyện")
    print(f"⚠️  Tổng số Lỗi Sync (Server):   {len(sync_issues):,} truyện")
    print("-" * 80)

    # Hiển thị thanh tiến độ trực quan
    bar_length = 40
    filled_local = int(bar_length * local_count // total_epubs) if total_epubs > 0 else 0
    bar_local = '█' * filled_local + '░' * (bar_length - filled_local)
    print(f"Progress Local : [{bar_local}] {pct_local:.1f}% ({local_count:,}/{total_epubs:,})")

    filled_sync = int(bar_length * len(synced_slugs) // total_epubs) if total_epubs > 0 else 0
    bar_sync = '█' * filled_sync + '░' * (bar_length - filled_sync)
    print(f"Progress Server: [{bar_sync}] {pct_sync:.1f}% ({len(synced_slugs):,}/{total_epubs:,})")
    print("-" * 80)

    # Hiển thị chi tiết cache lỗi nếu có
    if split_issues:
        print("\n📄 CHI TIẾT LỖI TÁCH LOCAL (.split_issues.json):")
        for fname, info in list(split_issues.items())[:10]:
            print(f"  ❌ [{fname}] -> Lỗi: {info.get('error','')} (Lúc: {info.get('timestamp','')[:19]})")
        if len(split_issues) > 10:
            print(f"  ... và {len(split_issues)-10} lỗi khác lưu tại D:\\novels\\.split_issues.json")

    if sync_issues:
        print("\n📄 CHI TIẾT LỖI SYNC SERVER (.sync_issues.json):")
        for slug, info in list(sync_issues.items())[:10]:
            print(f"  ❌ [{slug}] -> Lỗi: {info.get('error','')} (Lúc: {info.get('timestamp','')[:19]})")
        if len(sync_issues) > 10:
            print(f"  ... và {len(sync_issues)-10} lỗi khác lưu tại D:\\novels\\.sync_issues.json")

    print("\n" + "=" * 80)


if __name__ == '__main__':
    main()
