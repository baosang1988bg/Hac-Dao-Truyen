#!/usr/bin/env python3
"""
tools/batch_cloud_syncer.py

Daemon đồng bộ Cloudflare D1/R2 song song với quá trình tách EPUB local:
- Quét liên tục thư mục G:\\novels
- Phát hiện bộ truyện mới tách xong
- Tự động gọi migrate_to_cloudflare.py để sync Novel metadata + Synopsis + Chapters lên D1/R2
- Ghi nhận trạng thái vào G:\\novels\\.sync_state.json để không upload trùng lặp
"""

import sys
import os
import time
import json
import argparse
import subprocess
from pathlib import Path
from datetime import datetime

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).parent.parent))


def main():
    parser = argparse.ArgumentParser(description="Daemon đồng bộ ngầm Cloudflare D1/R2 song song")
    parser.add_argument("--dir", default=r"G:\novels", help="Thư mục chứa novels local")
    parser.add_argument("--delay", type=float, default=2.0, help="Thời gian nghỉ giữa các vòng quét (giây)")
    parser.add_argument("--workers", type=int, default=4, help="Số luồng uploader đồng thời")
    args = parser.parse_args()

    novels_dir = Path(args.dir)
    if not novels_dir.exists():
        print(f"❌ Chưa tìm thấy thư mục: {novels_dir}")
        sys.exit(1)

    state_file = novels_dir / ".cloud_sync_state.json"
    synced_slugs = set()

    if state_file.exists():
        try:
            data = json.loads(state_file.read_text(encoding='utf-8'))
            synced_slugs = set(data.get('synced_slugs', []))
        except Exception:
            pass

    print("=" * 70)
    print(f"☁️  HỆ THỐNG CLOUDFLARE BATCH REAL-TIME SYNCER")
    print(f"📂 Giám sát thư mục local: {novels_dir.resolve()}")
    print(f"✅ Đã đồng bộ trước đó:    {len(synced_slugs):,} bộ truyện")
    print("=" * 70)

    python_exe = sys.executable

    def save_state():
        try:
            state_file.write_text(json.dumps({
                'last_updated': datetime.now().isoformat(),
                'total_synced': len(synced_slugs),
                'synced_slugs': list(synced_slugs)
            }, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

    uploaded_session = 0
    start_time = time.time()

    while True:
        try:
            # Lấy tất cả thư mục truyện trong G:\novels
            all_folders = [d for d in novels_dir.iterdir() if d.is_dir() and not d.name.startswith(".")]

            # Lọc các truyện chưa sync nhưng có đủ novel.json và translated/
            pending = []
            for d in all_folders:
                slug = d.name
                if slug in synced_slugs:
                    continue
                novel_json = d / "novel.json"
                trans_dir = d / "translated"
                if novel_json.exists() and trans_dir.exists():
                    pending.append(slug)

            if not pending:
                time.sleep(args.delay)
                continue

            for slug in pending:
                cmd = [
                    python_exe, "-u", "migrate_to_cloudflare.py",
                    "--slug", slug,
                    "--novel-dir", str(novels_dir / slug)
                ]
                
                try:
                    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                    if res.returncode == 0:
                        synced_slugs.add(slug)
                        uploaded_session += 1
                        save_state()
                        
                        elapsed = time.time() - start_time
                        speed = uploaded_session / elapsed if elapsed > 0 else 0
                        sys.stdout.write(
                            f"\r☁️  [Synced: {len(synced_slugs):,} | Session: +{uploaded_session}] "
                            f"✅ {slug} (⚡ {speed:.2f} novel/s)"
                        )
                        sys.stdout.flush()
                    else:
                        sys.stderr.write(f"\n❌ Sync lỗi {slug}: {res.stderr[:200]}\n")
                except Exception as e:
                    sys.stderr.write(f"\n❌ Exception khi sync {slug}: {str(e)}\n")

        except KeyboardInterrupt:
            print("\n🛑 Đã dừng Daemon Cloudflare Syncer.")
            save_state()
            break
        except Exception as e:
            time.sleep(args.delay)


if __name__ == '__main__':
    main()
