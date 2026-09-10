#!/usr/bin/env python3
"""Đồng bộ chunk với ngân sách mặc định 0 và retry hữu hạn.
Ngân sách là ước tính thao tác cục bộ, không bảo đảm hóa đơn toàn account.
Kiểm tra mức dùng và cấu hình hạn mức trước khi chạy; không tự reset state lỗi.
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.sync_budget import SyncBudget, atomic_json, require_cloud_writes
from tools.sync_transport import send_chunk

HOST = os.getenv("HACDAO_SYNC_HOST", "hac-dao-truyen.nguyenbaosang1998.workers.dev")
PATH = "/api/admin/sync-novel"
# SYNC_KEY đọc từ biến môi trường — KHÔNG hardcode nữa vì giá trị cũ
# 'hacdao-secret-2026' đã lộ công khai trong lịch sử git (repo public).
# Set biến này TRƯỚC khi chạy: export HACDAO_SYNC_KEY="<giá-trị-mới-đã-rotate>"
SYNC_KEY = os.environ.get("HACDAO_SYNC_KEY", "")
SSL_CTX = ssl.create_default_context()

DEFAULT_R2_MONTHLY_BUDGET = 0
DEFAULT_D1_DAILY_BUDGET = 0
DEFAULT_MAX_OPS_PER_RUN = 0

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
CREDENTIALS_FILE = str(Path(__file__).parent / "credentials.json")
TOKEN_FILE = str(Path(__file__).parent / "token.json")



import threading

thread_local = threading.local()

def get_drive_service():
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    creds = None
    if Path(TOKEN_FILE).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, ["https://www.googleapis.com/auth/drive"])
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds)

def get_thread_service():
    if not hasattr(thread_local, "service"):
        thread_local.service = get_drive_service()
    return thread_local.service


def send_chunk_persistent(conn, payload, max_retries=5, budget=None):
    return send_chunk(conn,payload,host=HOST,sync_key=SYNC_KEY,budget=budget,max_retries=max_retries)


def fetch_file_content_from_drive(service, file_id: str, retries: int = 5) -> bytes:
    """Tự động retry & khôi phục socket kết nối khi gặp WinError 10054/10053 mạng chập chờn."""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            request = service.files().get_media(fileId=file_id)
            return request.execute()
        except Exception as e:
            last_err = e
            if hasattr(thread_local, "service"):
                try:
                    delattr(thread_local, "service")
                except Exception:
                    pass
            time.sleep(3.0 * attempt)
            service = get_thread_service()
    raise RuntimeError(f"Fetch Drive file {file_id} failed: {last_err}")


def sync_novel_from_drive(slug: str, novel_data: dict, budget: 'SyncBudget') -> dict:
    files_info = novel_data.get('files', {})
    chaps_file_id = files_info.get('chapters', {}).get('id')
    meta_file_id = files_info.get('meta', {}).get('id')
    synopsis_file_id = files_info.get('synopsis', {}).get('id')

    if not chaps_file_id:
        return {'slug': slug, 'success': False, 'error': 'Không tìm thấy chapters.json trên Google Drive'}

    conn = None
    try:
        service = get_thread_service()
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

            res, conn = send_chunk_persistent(conn, payload, budget=budget)
            if not res['success']:
                if conn:
                    conn.close()
                return {'slug': slug, 'success': False, 'budget_exceeded': res.get('budget_exceeded', False), 'error': f"Chunk {idx+1}/{len(chunks)} lỗi: {res['error']}"}

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
    parser.add_argument('--r2-budget', type=int, default=0, help='Ngân sách ghi R2 ước tính, mặc định 0')
    parser.add_argument('--d1-budget', type=int, default=0, help='Ngân sách ghi D1 ước tính, mặc định 0')
    parser.add_argument('--max-ops-per-run', type=int, default=0, help='Tổng thao tác tối đa mỗi lần chạy')
    parser.add_argument('--budget-file', default=None)
    args = parser.parse_args()
    if not SYNC_KEY:
        parser.error("Thiếu HACDAO_SYNC_KEY")
    if args.workers < 1:
        parser.error("workers phải lớn hơn 0")

    try:
        require_cloud_writes()
    except RuntimeError as exc:
        print(f"❌ {exc}")
        sys.exit(1)

    state_path = Path(args.state_file)
    if not state_path.exists():
        fallback_path = Path(__file__).parent / "upload_state.json"
        if fallback_path.exists():
            state_path = fallback_path
        else:
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
        except Exception as exc:
            raise RuntimeError("Checkpoint không hợp lệ; không tự reset tiến độ") from exc

    budget_path = Path(args.budget_file) if args.budget_file else state_path.parent / ".cloud_sync_budget.json"
    budget = SyncBudget(budget_path, args.r2_budget, args.d1_budget, args.max_ops_per_run)

    pending_slugs = [s for s in uploaded_novels.keys() if s not in synced_slugs]

    print("=" * 80)
    print("🚀 HỆ THỐNG ĐỒNG BỘ CLOUD-TO-CLOUD (GOOGLE DRIVE ➔ CLOUDFLARE R2)")
    print(f"📁 Tổng số truyện đã up trên Drive: {len(uploaded_novels):,} bộ")
    print(f"✅ Đã sync sang Cloudflare:        {len(synced_slugs):,} bộ")
    print(f"⏳ Cần đồng bộ tiếp:                {len(pending_slugs):,} bộ")
    print(f"💰 Ngân sách: {budget.summary()}")
    print("=" * 80)

    uploaded_session = 0
    start_time = time.time()
    stop_all = False
    had_failure = False

    def save_cloud_state():
        atomic_json(cloud_sync_path, {'last_updated':datetime.now().isoformat(),
                    'total_synced':len(synced_slugs),'synced_slugs':sorted(synced_slugs)})

    while not stop_all:
        pending_slugs = [s for s in uploaded_novels.keys() if s not in synced_slugs]
        if not pending_slugs:
            print("\n🎉 DỮ LIỆU CLOUD-TO-CLOUD ĐÃ ĐỒNG BỘ BẢO TOÀN 100% SANG CLOUDFLARE R2!")
            break

        batch = pending_slugs[:args.workers * 4]

        try:
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {
                    executor.submit(sync_novel_from_drive, slug, uploaded_novels[slug], budget): slug
                    for slug in batch
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
                    elif res.get('budget_exceeded'):
                        had_failure = True
                        # Ngân sách Cloudflare đã hết (tháng/ngày UTC hoặc giới hạn per-run) —
                        # DỪNG NGAY toàn bộ, không thử slug khác (ngân sách dùng chung cho cả
                        # lần chạy). Tiến độ (synced_slugs) đã lưu sau mỗi novel thành công
                        # nên chạy lại script sau sẽ tiếp tục đúng chỗ, không mất gì.
                        sys.stderr.write(f"\n\n🛑 DỪNG DO NGÂN SÁCH CLOUDFLARE: {res.get('error')}\n")
                        stop_all = True
                    else:
                        had_failure = True
                        stop_all = True
                        sys.stderr.write(f"\n❌ Lỗi sync [{slug}]: {res.get('error')}\n")


        except Exception as e:
            had_failure = True
            stop_all = True
            sys.stderr.write(f"\nĐồng bộ thất bại: {e}\n")

    print(f"\n💰 Ngân sách sau khi chạy: {budget.summary()}")
    if had_failure:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
