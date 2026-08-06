#!/usr/bin/env python3
"""
tools/cloud_to_cloud_syncer.py

Hệ thống Đồng bộ Cloud-to-Cloud Tốc độ cao (Google Drive ➔ Cloudflare R2):
- Lấy file chapters.json và novel.json trực tiếp từ Google Drive 5TB
- Đẩy trực tiếp vào Cloudflare Worker R2 API (/api/admin/sync-novel)
- Chạy hoàn toàn độc lập 24/7 trên Đám mây (hoặc Local PC) mà không cần giữ file thô local.
"""

import sys
import os
import time
import json
import ssl
import http.client
import argparse
import urllib.request
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
SYNC_KEY = "hacdao-secret-2026"
SSL_CTX = ssl.create_default_context()

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
CREDENTIALS_FILE = str(Path(__file__).parent / "credentials.json")
TOKEN_FILE = str(Path(__file__).parent / "token.json")

try:
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
except ImportError:
    print("ERROR: Thiếu thư viện Google API.")
    sys.exit(1)


def get_drive_service():
    creds = None
    if Path(TOKEN_FILE).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, ["https://www.googleapis.com/auth/drive"])
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds)


def send_chunk_persistent(conn: http.client.HTTPSConnection, payload: dict, max_retries: int = 5) -> tuple[dict, http.client.HTTPSConnection]:
    body_bytes = json.dumps(payload).encode('utf-8')
    headers = {
        'Host': HOST,
        'x-sync-key': SYNC_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 HacDaoCloudToCloud/1.0',
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
                time.sleep(5.0 * attempt)
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
                time.sleep(3.0 * attempt)
                continue
            return {'success': False, 'error': last_error}, None

    return {'success': False, 'error': f"Max retries exceeded ({last_error})"}, conn


def fetch_file_content_from_drive(service, file_id: str) -> bytes:
    request = service.files().get_media(fileId=file_id)
    return request.execute()


def sync_novel_from_drive(slug: str, novel_data: dict, service) -> dict:
    files_info = novel_data.get('files', {})
    chaps_file_id = files_info.get('chapters', {}).get('id')
    meta_file_id = files_info.get('meta', {}).get('id')
    synopsis_file_id = files_info.get('synopsis', {}).get('id')

    if not chaps_file_id:
        return {'slug': slug, 'success': False, 'error': 'Không tìm thấy chapters.json trên Google Drive'}

    conn = None
    try:
        # Lấy nội dung chapters.json từ Google Drive
        chaps_bytes = fetch_file_content_from_drive(service, chaps_file_id)
        all_chapters = json.loads(chaps_bytes.decode('utf-8'))

        # Lấy novel.json (nếu có)
        title = slug
        author = "Unknown"
        genre = "Khác"
        if meta_file_id:
            try:
                meta_bytes = fetch_file_content_from_drive(service, meta_file_id)
                meta_json = json.loads(meta_bytes.decode('utf-8'))
                title = meta_json.get('title', slug)
                author = meta_json.get('author', 'Unknown')
                genre = meta_json.get('genre', 'Khác')
            except Exception:
                pass

        # Lấy synopsis.md (nếu có)
        synopsis = ""
        if synopsis_file_id:
            try:
                syn_bytes = fetch_file_content_from_drive(service, synopsis_file_id)
                synopsis = syn_bytes.decode('utf-8')
            except Exception:
                pass

        CHUNK_SIZE = 25
        total_chapters = len(all_chapters)
        chunks = [all_chapters[i:i + CHUNK_SIZE] for i in range(0, total_chapters, CHUNK_SIZE)]

        conn = http.client.HTTPSConnection(HOST, context=SSL_CTX, timeout=60)

        for idx, chunk in enumerate(chunks):
            payload = {
                'slug': slug,
                'title': title,
                'original_title': '',
                'author': author,
                'genre': genre,
                'synopsis': synopsis if idx == 0 else "",
                'chapters': chunk,
                'is_first_chunk': (idx == 0),
                'total_chapter_count': total_chapters,
                'drive_file_id': files_info.get('epub', {}).get('id') or chaps_file_id
            }

            res, conn = send_chunk_persistent(conn, payload)
            if not res['success']:
                if conn:
                    conn.close()
                return {'slug': slug, 'success': False, 'error': f"Chunk {idx+1}/{len(chunks)} lỗi: {res['error']}"}

            if len(chunks) > 1:
                time.sleep(0.35)

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
    parser = argparse.ArgumentParser(description="Cloud-to-Cloud Syncer (Google Drive ➔ Cloudflare R2)")
    parser.add_argument("--state-file", default=r"D:\novels\upload_state.json", help="Path upload_state.json")
    parser.add_argument("--workers", type=int, default=3, help="Số luồng song song (mặc định: 3)")
    args = parser.parse_args()

    state_path = Path(args.state_file)
    if not state_path.exists():
        print(f"❌ Không tìm thấy state file: {state_path}")
        sys.exit(1)

    state_data = json.loads(state_path.read_text(encoding='utf-8'))
    uploaded_novels = state_data.get('uploaded', {})

    cloud_sync_path = state_path.parent / ".cloud_sync_state.json"
    synced_slugs = set()
    if cloud_sync_path.exists():
        try:
            cdata = json.loads(cloud_sync_path.read_text(encoding='utf-8'))
            synced_slugs = set(cdata.get('synced_slugs', []))
        except Exception:
            pass

    pending_slugs = [s for s in uploaded_novels.keys() if s not in synced_slugs]

    print("=" * 80)
    print("🚀 HỆ THỐNG ĐỒNG BỘ CLOUD-TO-CLOUD (GOOGLE DRIVE ➔ CLOUDFLARE R2)")
    print(f"📁 Tổng số truyện đã up trên Drive: {len(uploaded_novels):,} bộ")
    print(f"✅ Đã sync sang Cloudflare:        {len(synced_slugs):,} bộ")
    print(f"⏳ Cần đồng bộ tiếp:                {len(pending_slugs):,} bộ")
    print("=" * 80)

    service = get_drive_service()
    uploaded_session = 0
    start_time = time.time()

    def save_cloud_state():
        try:
            cloud_sync_path.write_text(json.dumps({
                'last_updated': datetime.now().isoformat(),
                'total_synced': len(synced_slugs),
                'synced_slugs': list(synced_slugs)
            }, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(sync_novel_from_drive, slug, uploaded_novels[slug], service): slug
            for slug in pending_slugs
        }

        for future in as_completed(futures):
            res = future.result()
            slug = res['slug']

            if res['success']:
                synced_slugs.add(slug)
                uploaded_session += 1
                save_cloud_state()

                elapsed = time.time() - start_time
                speed = uploaded_session / elapsed if elapsed > 0 else 0
                sys.stdout.write(
                    f"\r☁️  [R2 Synced: {len(synced_slugs):,} | Session: +{uploaded_session}] "
                    f"✅ {slug[:40]} ({res['chapters']} chaps - ⚡ {speed:.2f} novel/s)       "
                )
                sys.stdout.flush()
            else:
                sys.stderr.write(f"\n❌ Lỗi sync [{slug}]: {res.get('error')}\n")


if __name__ == '__main__':
    main()
