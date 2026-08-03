#!/usr/bin/env python3
"""
tools/batch_cloud_syncer.py

Hệ thống đồng bộ Cloudflare D1/R2 Tốc Độ Cao Chuẩn Hạn Ngạch Cloudflare Free:
- 3 Workers song song
- CHUNK_SIZE = 25 chương / chunk
- Delay 0.25s giữa các chunk để không bao giờ vi phạm Cloudflare Rate Limiter / Subrequest Rate
- Tự động Retry 5 lần với Exponential Backoff (3s, 6s, 9s, 12s) khi gặp HTTP 503 / 429
"""

import sys
import os
import time
import json
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

WORKER_SYNC_URL = "https://hac-dao-truyen.nguyenbaosang1998.workers.dev/api/admin/sync-novel"
SYNC_KEY = "hacdao-secret-2026"


def send_chunk_with_retry(payload: dict, max_retries: int = 5) -> dict:
    """Gửi 1 chunk tới Cloudflare API với cơ chế retry thông minh và delay chống 503."""
    body_bytes = json.dumps(payload).encode('utf-8')
    
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(
            WORKER_SYNC_URL,
            data=body_bytes,
            headers={
                'x-sync-key': SYNC_KEY,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HacDaoRateLimitProofSyncer/5.0'
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as res:
                res_body = res.read().decode('utf-8')
                res_json = json.loads(res_body)
                if res_json.get('success'):
                    return {'success': True}
                else:
                    return {'success': False, 'error': res_json.get('error', 'API error')}
        except urllib.error.HTTPError as e:
            err_text = e.read().decode('utf-8', errors='replace')
            # Nếu Cloudflare trả 503 (Error 1102 - CPU limit/Rate limit) hoặc 429 -> Tự động dừng 3s * attempt
            if e.code in (503, 429, 502, 504) and attempt < max_retries:
                time.sleep(3.0 * attempt)
                continue
            return {'success': False, 'error': f"HTTP {e.code}: {err_text[:120]}"}
        except Exception as e:
            if attempt < max_retries:
                time.sleep(2.0 * attempt)
                continue
            return {'success': False, 'error': str(e)}
            
    return {'success': False, 'error': 'Max retries exceeded'}


def sync_single_novel(novel_dir: Path) -> dict:
    """Đồng bộ 1 novel với chunk size 25 chương + delay 0.25s chống nghẽn Cloudflare Rate limit."""
    slug = novel_dir.name
    novel_json = novel_dir / "novel.json"
    trans_dir = novel_dir / "translated"
    synopsis_path = novel_dir / "synopsis.md"

    if not novel_json.exists() or not trans_dir.exists():
        return {'slug': slug, 'success': False, 'error': 'Thiếu novel.json hoặc translated/'}

    try:
        data = json.loads(novel_json.read_text(encoding='utf-8'))
        synopsis = synopsis_path.read_text(encoding='utf-8') if synopsis_path.exists() else ""

        all_chapters = []
        for f in sorted(trans_dir.glob("*.md")):
            parts = f.name.split('_')
            num = int(parts[0]) if parts[0].isdigit() else 0
            all_chapters.append({
                'number': num,
                'title': f.name.replace('_VI.md', '').replace('-', ' '),
                'filename': f.name,
                'content': f.read_text(encoding='utf-8')
            })

        if not all_chapters:
            return {'slug': slug, 'success': False, 'error': 'Thư mục translated/ trống'}

        # CHUNK_SIZE = 25 chương / request (luôn an toàn dưới 50 subrequests)
        CHUNK_SIZE = 25
        total_chapters = len(all_chapters)
        chunks = [all_chapters[i:i + CHUNK_SIZE] for i in range(0, total_chapters, CHUNK_SIZE)]

        for idx, chunk in enumerate(chunks):
            payload = {
                'slug': data.get('slug', slug),
                'title': data.get('title', slug),
                'original_title': data.get('original_title', ''),
                'author': data.get('author', 'Unknown'),
                'genre': data.get('genre', 'Khác'),
                'synopsis': synopsis if idx == 0 else "",
                'chapters': chunk,
                'is_first_chunk': (idx == 0),
                'total_chapter_count': total_chapters
            }

            res = send_chunk_with_retry(payload)
            if not res['success']:
                return {'slug': slug, 'success': False, 'error': f"Chunk {idx+1}/{len(chunks)} lỗi: {res['error']}"}

            # Tăng nghỉ 0.25s giữa mỗi chunk để Cloudflare giải phóng CPU rate-limit window
            if len(chunks) > 1:
                time.sleep(0.25)

        return {'slug': slug, 'success': True, 'chapters': total_chapters}

    except Exception as e:
        return {'slug': slug, 'success': False, 'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description="Daemon Cloudflare Syncer Chống 503 Rate Limit (3 Workers, 25 chaps/chunk)")
    parser.add_argument("--dir", default=r"D:\novels", help="Thư mục chứa novels local (mặc định: D:\\novels)")
    parser.add_argument("--workers", type=int, default=3, help="Số luồng đồng bộ song song (mặc định: 3)")
    parser.add_argument("--delay", type=float, default=1.0, help="Thời gian nghỉ giữa các đợt quét (giây)")
    args = parser.parse_args()

    novels_dir = Path(args.dir)
    if not novels_dir.exists():
        print(f"❌ Chưa tìm thấy thư mục: {novels_dir}")
        sys.exit(1)

    state_file = novels_dir / ".cloud_sync_state.json"
    issues_file = novels_dir / ".sync_issues.json"

    synced_slugs = set()
    sync_issues = {}

    if state_file.exists():
        try:
            data = json.loads(state_file.read_text(encoding='utf-8'))
            synced_slugs = set(data.get('synced_slugs', []))
        except Exception:
            pass

    if issues_file.exists():
        try:
            sync_issues = json.loads(issues_file.read_text(encoding='utf-8'))
        except Exception:
            pass

    print("=" * 80)
    print(f"🚀 HỆ THỐNG CLOUDFLARE SYNCER (CHỐNG 503 RATE LIMIT - 3 WORKERS - 25 CHAPS/CHUNK)")
    print(f"📂 Thư mục local:       {novels_dir.resolve()}")
    print(f"⚡ Số luồng uploader:    {args.workers} workers song song")
    print(f"✅ Đã đồng bộ trước đó:  {len(synced_slugs):,} bộ truyện")
    print("=" * 80)

    def save_state():
        try:
            state_file.write_text(json.dumps({
                'last_updated': datetime.now().isoformat(),
                'total_synced': len(synced_slugs),
                'synced_slugs': list(synced_slugs)
            }, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

    def save_issues():
        try:
            issues_file.write_text(json.dumps(sync_issues, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

    uploaded_session = 0
    start_time = time.time()

    while True:
        try:
            all_folders = [d for d in novels_dir.iterdir() if d.is_dir() and not d.name.startswith(".")]

            pending_folders = []
            for d in all_folders:
                slug = d.name
                if slug in synced_slugs:
                    continue
                novel_json = d / "novel.json"
                trans_dir = d / "translated"
                if novel_json.exists() and trans_dir.exists():
                    pending_folders.append(d)

            if not pending_folders:
                time.sleep(args.delay)
                continue

            # Lấy 16 folder cho mỗi đợt xử lý
            batch_folders = pending_folders[:16]

            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {executor.submit(sync_single_novel, folder): folder.name for folder in batch_folders}

                for future in as_completed(futures):
                    res = future.result()
                    slug = res['slug']

                    if res['success']:
                        synced_slugs.add(slug)
                        if slug in sync_issues:
                            del sync_issues[slug]
                            save_issues()
                        uploaded_session += 1
                        save_state()

                        elapsed = time.time() - start_time
                        speed = uploaded_session / elapsed if elapsed > 0 else 0
                        sys.stdout.write(
                            f"\r☁️  [Server Synced: {len(synced_slugs):,} | Session: +{uploaded_session}] "
                            f"✅ {slug[:40]} ({res['chapters']} chaps - ⚡ {speed:.2f} novel/s)       "
                        )
                        sys.stdout.flush()
                    else:
                        err_text = res.get('error', 'Lỗi không xác định')
                        sync_issues[slug] = {
                            'error': err_text,
                            'timestamp': datetime.now().isoformat()
                        }
                        save_issues()
                        sys.stderr.write(f"\n❌ Lỗi sync [{slug}]: {err_text}\n")

        except KeyboardInterrupt:
            print("\n🛑 Đã dừng Daemon Cloudflare Syncer.")
            save_state()
            save_issues()
            break
        except Exception as e:
            time.sleep(args.delay)


if __name__ == '__main__':
    main()
