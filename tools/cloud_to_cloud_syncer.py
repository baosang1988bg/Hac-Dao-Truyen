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
import hashlib
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


# ── [E04] Chunk theo cả số chương lẫn số byte, expected_r2_key, reconcile ──

MAX_CHUNK_CHAPTERS = 25
# Dưới hard cap 2 MiB của Worker (readLimitedJson/syncNovelBatch) — chừa dư
# cho các field khác trong payload (title/author/genre/synopsis...).
MAX_CHUNK_BYTES = 1_500_000


def compute_content_key(slug: str, title: str, content: str) -> str:
    """Tính lại CHÍNH XÁC r2_key mà Worker sẽ tính (src/index.js:syncNovelBatch):
    sha256 của nội dung sau khi thêm heading nếu chưa có. Dùng để tự suy ra
    'expected_r2_key' cục bộ (key MỚI ta sắp gửi) mà không cần round-trip đọc
    D1 riêng — kết hợp với chapter_keys đã ghi nhận ở lần sync trước để biết
    'key CŨ' hợp lệ cần gửi kèm khi nội dung 1 chương thay đổi."""
    body = content if content.startswith('#') else f"# {title}\n\n{content}"
    digest = hashlib.sha256(body.encode('utf-8')).hexdigest()
    return f"{slug}/content/{digest}.md"


def chunk_chapters(chapters: list, max_count: int = MAX_CHUNK_CHAPTERS,
                    max_bytes: int = MAX_CHUNK_BYTES) -> list:
    """[E04] Chia `chapters` thành nhiều chunk theo CẢ số lượng (max_count) LẪN
    tổng số byte JSON ước tính (max_bytes). Chỉ giới hạn theo số lượng (như
    trước) không đủ: 25 chương rất dài (hoặc lỡ gộp nhầm nhiều raw) vẫn có thể
    vượt 2 MiB, khiến request bị Worker từ chối (413) lặp đi lặp lại mà không
    bao giờ tự chia nhỏ lại được. 1 chương ĐƠN LẺ vượt max_bytes vẫn phải đứng
    riêng 1 chunk — không thể chia nhỏ hơn được nữa, lỗi sẽ được báo rõ thay
    vì âm thầm gộp sai chương."""
    chunks = []
    current, current_bytes = [], 0
    for chap in chapters:
        size = len(json.dumps(chap, ensure_ascii=False).encode('utf-8'))
        if current and (len(current) >= max_count or current_bytes + size > max_bytes):
            chunks.append(current)
            current, current_bytes = [], 0
        current.append(chap)
        current_bytes += size
    if current:
        chunks.append(current)
    return chunks


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


def sync_novel_from_drive(slug: str, novel_data: dict, budget: 'SyncBudget', known_keys: dict = None) -> dict:
    """`known_keys`: {filename: r2_key} đã ghi nhận sau lần sync thành công gần
    nhất (đọc/ghi bởi main() qua .cloud_sync_state.json['chapter_keys']).
    Dùng để tự tính `expected_r2_key` gửi kèm mỗi chương [E04] — Worker chỉ
    chấp nhận ghi đè 1 chương đã tồn tại nếu content không đổi (idempotent)
    hoặc client gửi đúng key cũ đã biết; nếu không, trả 409 và ta phải BÁO
    CÁO rõ (không tự động retry mù, không đè bừa).
    """
    known_keys = known_keys or {}
    files_info = novel_data.get('files', {})
    chaps_file_id = files_info.get('chapters', {}).get('id')
    meta_file_id = files_info.get('meta', {}).get('id')
    synopsis_file_id = files_info.get('synopsis', {}).get('id')

    if not chaps_file_id:
        return {'slug': slug, 'success': False, 'error': 'Không tìm thấy chapters.json trên Google Drive'}

    conn = None
    synced_so_far = 0
    updated_keys = {}
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

        total_chapters = len(all_chapters)
        chunks = chunk_chapters(all_chapters)

        conn = http.client.HTTPSConnection(HOST, context=SSL_CTX, timeout=60)

        for idx, chunk in enumerate(chunks):
            # [E04] Gắn expected_r2_key cho từng chương dựa trên key ĐÃ BIẾT từ
            # lần sync trước (nếu có) — cho phép Worker phân biệt "content
            # không đổi/đúng như lần trước ta thấy" (ghi bình thường) với
            # "content đã đổi ở phía Cloudflare mà client không hay biết"
            # (409, cần reconcile thủ công).
            chunk_with_keys = []
            for chap in chunk:
                fname = chap.get('filename')
                item = dict(chap)
                expected = known_keys.get(fname)
                if expected:
                    item['expected_r2_key'] = expected
                chunk_with_keys.append(item)

            payload = {
                'slug': slug,
                'title': title,
                'original_title': '',
                'author': author,
                'genre': genre,
                'synopsis': synopsis if idx == 0 else "",
                'chapters': chunk_with_keys,
                'is_first_chunk': (idx == 0),
                'total_chapter_count': total_chapters,
                # [E06] KHÔNG được fallback về chaps_file_id (ID của
                # chapters.json) khi thiếu EPUB — đó là 2 loại tài nguyên khác
                # nhau trên Drive. Worker (src/index.js:getEpub) dùng
                # `novel.drive_file_id` để tải TRỰC TIẾP từ Google Drive và
                # trả về cho client coi như file .epub; gán nhầm ID của
                # chapters.json vào đây sẽ khiến getEpub tải & trả về nội dung
                # JSON của chapters.json như thể là EPUB. Thiếu EPUB thật thì
                # để trống — Worker tự fallback sang R2 "<slug>/book.epub"
                # (xem getEpub, bước 2). Việc getEpub cần tự kiểm tra response
                # đúng định dạng EPUB (Content-Type/magic bytes) là phần sửa
                # phía Worker (src/index.js), KHÔNG thuộc phạm vi file này.
                'drive_file_id': files_info.get('epub', {}).get('id') or ''
            }

            res, conn = send_chunk_persistent(conn, payload, budget=budget)
            if not res['success']:
                if conn:
                    conn.close()
                if res.get('conflict'):
                    # [E04] KHÔNG tự động retry mù — báo rõ chương nào cần
                    # reconcile thủ công, cùng số chương ĐàSYNC được (partial
                    # success) trước khi gặp conflict.
                    return {
                        'slug': slug, 'success': False, 'conflict': True,
                        'conflict_filename': res.get('filename'),
                        'chapters_synced_before_failure': synced_so_far,
                        'updated_keys': updated_keys,
                        'error': (f"Chunk {idx + 1}/{len(chunks)}: chương "
                                  f"{res.get('filename') or '?'} đã đổi trên Cloudflare "
                                  f"— cần reconcile thủ công trước khi sync lại "
                                  f"({synced_so_far}/{total_chapters} chương đã đồng bộ OK "
                                  f"trước khi dừng).")
                    }
                return {
                    'slug': slug, 'success': False,
                    'budget_exceeded': res.get('budget_exceeded', False),
                    'chapters_synced_before_failure': synced_so_far,
                    'updated_keys': updated_keys,
                    'error': (f"Chunk {idx+1}/{len(chunks)} lỗi: {res['error']} "
                              f"({synced_so_far}/{total_chapters} chương đã đồng bộ OK "
                              f"trước khi dừng — KHÔNG phải toàn bộ truyện đã lỗi).")
                }

            synced_so_far += len(chunk)
            for chap in chunk:
                fname = chap.get('filename')
                if fname:
                    updated_keys[fname] = compute_content_key(slug, chap.get('title', ''), chap.get('content', ''))

        if conn:
            conn.close()
        return {'slug': slug, 'success': True, 'chapters': total_chapters, 'updated_keys': updated_keys}

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
    # [E04] chapter_keys[slug][filename] = r2_key đã biết từ lần sync trước —
    # dùng làm expected_r2_key để phân biệt "content không đổi" (ghi lại được)
    # với "content đã đổi ở Cloudflare mà ta không biết" (409, cần reconcile).
    chapter_keys = {}
    if cloud_sync_path.exists():
        try:
            cdata = json.loads(cloud_sync_path.read_text(encoding='utf-8'))
            synced_slugs = set(cdata.get('synced_slugs', []))
            chapter_keys = cdata.get('chapter_keys', {}) or {}
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

    conflict_slugs = {}  # slug -> conflict_filename, báo cáo cuối cùng cần reconcile thủ công

    def save_cloud_state():
        atomic_json(cloud_sync_path, {'last_updated':datetime.now().isoformat(),
                    'total_synced':len(synced_slugs),'synced_slugs':sorted(synced_slugs),
                    'chapter_keys':chapter_keys})

    while not stop_all:
        pending_slugs = [s for s in uploaded_novels.keys() if s not in synced_slugs]
        if not pending_slugs:
            print("\n🎉 DỮ LIỆU CLOUD-TO-CLOUD ĐÃ ĐỒNG BỘ BẢO TOÀN 100% SANG CLOUDFLARE R2!")
            break

        batch = pending_slugs[:args.workers * 4]

        try:
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {
                    executor.submit(sync_novel_from_drive, slug, uploaded_novels[slug], budget,
                                     chapter_keys.get(slug, {})): slug
                    for slug in batch
                }

                for future in as_completed(futures):
                    res = future.result()
                    slug = res['slug']

                    if res['success']:
                        synced_slugs.add(slug)
                        if res.get('updated_keys'):
                            chapter_keys[slug] = res['updated_keys']
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
                        # [E04] Partial success: giữ lại chapter_keys của các chunk ĐÃ
                        # commit thành công trước khi hết ngân sách — KHÔNG đánh dấu
                        # slug là "đã sync" (vẫn nằm trong pending_slugs lần chạy sau).
                        if res.get('updated_keys'):
                            chapter_keys[slug] = {**chapter_keys.get(slug, {}), **res['updated_keys']}
                            save_cloud_state()
                        # Ngân sách Cloudflare đã hết (tháng/ngày UTC hoặc giới hạn per-run) —
                        # DỪNG NGAY toàn bộ, không thử slug khác (ngân sách dùng chung cho cả
                        # lần chạy). Tiến độ (synced_slugs) đã lưu sau mỗi novel thành công
                        # nên chạy lại script sau sẽ tiếp tục đúng chỗ, không mất gì.
                        sys.stderr.write(f"\n\n🛑 DỪNG DO NGÂN SÁCH CLOUDFLARE: {res.get('error')}\n")
                        stop_all = True
                    elif res.get('conflict'):
                        # [E04] Conflict thật (Worker từ chối vì chương đã đổi ở
                        # Cloudflare) — KHÔNG tự động retry mù, KHÔNG đánh dấu
                        # slug hoàn tất; báo cáo rõ chương nào cần rà thủ công.
                        had_failure = True
                        conflict_slugs[slug] = res.get('conflict_filename') or '?'
                        if res.get('updated_keys'):
                            chapter_keys[slug] = {**chapter_keys.get(slug, {}), **res['updated_keys']}
                            save_cloud_state()
                        sys.stderr.write(
                            f"\n⚠️  CONFLICT [{slug}] chương '{res.get('conflict_filename')}' đã "
                            f"đổi trên Cloudflare — CẦN RECONCILE THỦ CÔNG. {res.get('error')}\n"
                        )
                    else:
                        had_failure = True
                        stop_all = True
                        # [E04] Partial success: giữ chapter_keys của các chunk đã
                        # commit trước khi lỗi, để lần chạy sau không phải coi các
                        # chương đó là "chưa từng sync" (tránh 409 giả khi retry).
                        if res.get('updated_keys'):
                            chapter_keys[slug] = {**chapter_keys.get(slug, {}), **res['updated_keys']}
                            save_cloud_state()
                        sys.stderr.write(f"\n❌ Lỗi sync [{slug}]: {res.get('error')}\n")


        except Exception as e:
            had_failure = True
            stop_all = True
            sys.stderr.write(f"\nĐồng bộ thất bại: {e}\n")

    print(f"\n💰 Ngân sách sau khi chạy: {budget.summary()}")
    if conflict_slugs:
        print(f"\n⚠️  {len(conflict_slugs)} truyện có CONFLICT cần reconcile thủ công trước khi sync lại:")
        for slug, fname in conflict_slugs.items():
            print(f"    • {slug}: chương '{fname}'")
    if had_failure:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
