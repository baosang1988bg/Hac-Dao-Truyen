#!/usr/bin/env python3
"""
tools/batch_cloud_syncer.py

Hệ thống đồng bộ Cloudflare D1/R2 Tốc Độ Cao Chuẩn Hạn Ngạch Cloudflare Rate Limiter (3 Workers, 25 chaps/chunk):
- 3 Workers song song + HTTP Keep-Alive Connection Pool
- CHUNK_SIZE = 25 chương / request (luôn an toàn dưới 50 subrequests limit)
- Pause 0.35s giữa các chunk để không bao giờ chạm Cloudflare Worker Burst Rate Limiter
- Tự động Retry 6 lần với Exponential Backoff dài (6s, 12s, 18s, 24s...) khi gặp HTTP 503 / 429
"""

import sys
import os
import time
import json
import ssl
import http.client
import argparse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

HOST = "hac-dao-truyen.nguyenbaosang1998.workers.dev"
PATH = "/api/admin/sync-novel"
# SYNC_KEY đọc từ biến môi trường — KHÔNG hardcode nữa vì giá trị cũ
# 'hacdao-secret-2026' đã lộ công khai trong lịch sử git (repo public).
# Set biến này TRƯỚC khi chạy: export HACDAO_SYNC_KEY="<giá-trị-mới-đã-rotate>"
SYNC_KEY = os.environ.get("HACDAO_SYNC_KEY", "")
if not SYNC_KEY:
    print("[FATAL] Thiếu biến môi trường HACDAO_SYNC_KEY.")
    print("        Set giá trị secret MỚI (đã rotate qua `wrangler secret put SYNC_KEY`")
    print("        trên Cloudflare) rồi chạy lại, ví dụ:")
    print('        export HACDAO_SYNC_KEY="giá-trị-mới"')
    sys.exit(1)
SSL_CTX = ssl.create_default_context()


def send_chunk_persistent(conn: http.client.HTTPSConnection, payload: dict, max_retries: int = 6) -> tuple[dict, http.client.HTTPSConnection]:
    """Gửi 1 chunk bằng HTTPS Connection Re-use với cơ chế Retry chống Rate Limit 503."""
    body_bytes = json.dumps(payload).encode('utf-8')
    headers = {
        'Host': HOST,
        'x-sync-key': SYNC_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 HacDaoRateProofSyncer/9.0',
        'Connection': 'keep-alive'
    }

    last_error = "Unknown error"

    for attempt in range(1, max_retries + 1):
        try:
            if conn is None:
                conn = http.client.HTTPSConnection(HOST, context=SSL_CTX, timeout=60)

            conn.request("POST", PATH, body=body_bytes, headers=headers)
            res = conn.getresponse()
            res_body = res.read().decode('utf-8', errors='replace')

            if res.status == 200:
                res_json = json.loads(res_body)
                if res_json.get('success'):
                    return {'success': True}, conn
                else:
                    last_error = res_json.get('error', 'API error')
                    return {'success': False, 'error': last_error}, conn
            elif res.status in (503, 429, 502, 504):
                last_error = f"HTTP {res.status} (Cloudflare Rate Limit/Burst)"
                conn.close()
                conn = None
                time.sleep(6.0 * attempt)  # Tăng thời gian chờ dài để Cloudflare reset hẳn rate-limit window
                continue
            else:
                last_error = f"HTTP {res.status}: {res_body[:120]}"
                return {'success': False, 'error': last_error}, conn

        except Exception as e:
            last_error = str(e)
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None
            if attempt < max_retries:
                time.sleep(4.0 * attempt)
                continue
            return {'success': False, 'error': last_error}, None

    return {'success': False, 'error': f"Max retries exceeded ({last_error})"}, conn


def sync_single_novel(novel_dir: Path) -> dict:
    """Đồng bộ 1 novel qua HTTPS Keep-Alive Connection Pool (CHUNK_SIZE = 25)."""
    slug = novel_dir.name
    novel_json = novel_dir / "novel.json"
    trans_dir = novel_dir / "translated"
    synopsis_path = novel_dir / "synopsis.md"

    if not novel_json.exists() or not trans_dir.exists():
        return {'slug': slug, 'success': False, 'error': 'Thiếu novel.json hoặc translated/'}

    conn = None
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

        # CHUNK_SIZE = 25 chương / request (an toàn tuyệt đối cho Cloudflare Rate Limiter)
        CHUNK_SIZE = 25
        total_chapters = len(all_chapters)
        chunks = [all_chapters[i:i + CHUNK_SIZE] for i in range(0, total_chapters, CHUNK_SIZE)]

        conn = http.client.HTTPSConnection(HOST, context=SSL_CTX, timeout=60)

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

            res, conn = send_chunk_persistent(conn, payload)
            if not res['success']:
                if conn:
                    conn.close()
                return {'slug': slug, 'success': False, 'error': f"Chunk {idx+1}/{len(chunks)} lỗi: {res['error']}"}

            if len(chunks) > 1:
                time.sleep(0.35)  # Nghỉ 0.35s giữa các chunk để giải phóng rate limit meter

        if conn:
            conn.close()
        return {'slug': slug, 'success': True, 'chapters': total_chapters}

    except Exception as e:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
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

            # Lấy 24 folder cho mỗi đợt xử lý
            batch_folders = pending_folders[:24]

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
