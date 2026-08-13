#!/usr/bin/env python3
"""
tools/cloud_to_cloud_syncer.py

Hệ thống Đồng bộ Cloud-to-Cloud Tốc độ cao (Google Drive ➔ Cloudflare R2):
- Lấy file chapters.json và novel.json trực tiếp từ Google Drive 5TB
- Đẩy trực tiếp vào Cloudflare Worker R2 API (/api/admin/sync-novel)
- Chạy hoàn toàn độc lập 24/7 trên Đám mây (hoặc Local PC) mà không cần giữ file thô local.

⚠️ NGÂN SÁCH CHI PHÍ CLOUDFLARE (đọc trước khi chạy) ─────────────────────────
Script này từng bị chạy qua cron 30 phút/lần và tạo ra 1.4 triệu lượt ghi R2,
vượt free tier và phát sinh phí thật (~$9/tháng) — xem
plans/TONG_HOP_VAN_DE_2026-08-13.md, Vấn đề 3. Cron đã bị xóa từ đó, nhưng
bản thân script KHÔNG có cơ chế tự giới hạn nào — nếu chạy tay (workflow_dispatch
hoặc local) với backlog lớn, vẫn có thể tiêu tốn hết ngân sách free tier chỉ
trong vài phút.

Từ bản này, script TỰ ĐẾM số lượt ghi R2 (Class A: PutObject)/D1 (rows written)
mà CHÍNH NÓ gửi đi, lưu bền vững qua file ngân sách (mặc định
`.cloud_sync_budget.json` cạnh state file), và TỰ DỪNG trước khi chạm ngưỡng.
Mặc định để dư ~20% so với free tier thật của Cloudflare (tính đến 2026):
  - R2 Class A (ghi)  : free tier 1,000,000 lượt/THÁNG → mặc định dùng tối đa 800,000
  - D1 rows written   : free tier 100,000 dòng/NGÀY (reset 00:00 UTC) → mặc định tối đa 80,000
(Nguồn: https://developers.cloudflare.com/r2/pricing và
https://developers.cloudflare.com/d1/platform/pricing — kiểm tra lại nếu
Cloudflare đổi chính sách.)

⚠️ QUAN TRỌNG: đây là ƯỚC LƯỢNG CỤC BỘ, chỉ tính những gì SCRIPT NÀY gửi đi.
KHÔNG tính lượt ghi từ `migrate_to_cloudflare.py` (chạy cron hàng ngày) hay
traffic thật từ độc giả (xem/bình luận/đánh giá) — cả hai đều dùng chung
R2/D1 với script này. Vì vậy ngân sách mặc định cố ý để dư 20%, và bạn nên
thỉnh thoảng tự kiểm tra dashboard Cloudflare thật (Account Home → Analytics)
để chắc chắn tổng mức dùng thực tế trên TOÀN BỘ dự án, không chỉ script này.

Tùy chỉnh ngân sách: `--r2-budget`, `--d1-budget`, `--max-ops-per-run` (giới
hạn cho MỖI LẦN CHẠY, mặc định 20,000 lượt R2 — để 1 lần chạy không "ăn" hết
ngân sách tháng, đặc biệt lần đầu backfill với backlog lớn). Khi đạt ngân
sách, script dừng NGAY (không lỗi, không retry), lưu lại tiến độ, và có thể
chạy lại sau (tháng sau với R2, ngày sau với D1, hoặc lần chạy tiếp theo với
--max-ops-per-run).
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

# ── Ngân sách chi phí Cloudflare (xem docstring đầu file) ────────────────────
# Free tier thật của Cloudflare (2026): R2 Class A = 1,000,000/tháng,
# D1 rows written = 100,000/ngày. Mặc định dùng 80% để dư chỗ cho
# migrate_to_cloudflare.py + traffic thật cùng chia sẻ R2/D1.
DEFAULT_R2_MONTHLY_BUDGET = 800_000
DEFAULT_D1_DAILY_BUDGET   = 80_000
DEFAULT_MAX_OPS_PER_RUN   = 20_000


def _utc_month_str() -> str:
    return datetime.utcnow().strftime('%Y-%m')


def _utc_day_str() -> str:
    return datetime.utcnow().strftime('%Y-%m-%d')


class SyncBudget:
    """
    Theo dõi & giới hạn số lượt ghi R2 (Class A)/D1 (rows written) mà script
    này thực hiện, bền vững qua các lần chạy (lưu file JSON), thread-safe
    (nhiều thread trong ThreadPoolExecutor cùng gọi try_reserve()).

    ⚠️ Đây là ƯỚC LƯỢNG CỤC BỘ — chỉ đếm những gì CHÍNH SCRIPT NÀY gửi đi qua
    send_chunk_persistent(), KHÔNG phải số liệu thật lấy từ API Cloudflare
    (script không gọi Cloudflare Analytics API). Các nguồn ghi R2/D1 khác
    (migrate_to_cloudflare.py, traffic thật từ độc giả) KHÔNG được tính vào
    đây — xem cảnh báo trong docstring đầu file.
    """

    def __init__(self, state_path: Path, r2_monthly_budget: int, d1_daily_budget: int,
                 max_ops_per_run: int):
        self.state_path = state_path
        self.r2_monthly_budget = r2_monthly_budget
        self.d1_daily_budget = d1_daily_budget
        self.max_ops_per_run = max_ops_per_run
        self._lock = threading.Lock()
        self._state = self._load()
        self._run_r2_ops = 0   # chỉ đếm trong lần chạy hiện tại, KHÔNG persist
        self._run_d1_ops = 0
        self.stopped_reason: str | None = None  # set khi hết ngân sách

    def _load(self) -> dict:
        if self.state_path.exists():
            try:
                return json.loads(self.state_path.read_text(encoding='utf-8'))
            except Exception:
                pass
        return {}

    def _save(self):
        try:
            self.state_path.write_text(
                json.dumps(self._state, ensure_ascii=False, indent=2), encoding='utf-8'
            )
        except Exception:
            pass

    def _rollover_locked(self):
        """Reset bộ đếm khi sang tháng mới (R2)/ngày mới UTC (D1). Gọi khi đang giữ _lock."""
        month = _utc_month_str()
        day = _utc_day_str()
        if self._state.get('r2_month') != month:
            self._state['r2_month'] = month
            self._state['r2_ops'] = 0
        if self._state.get('d1_day') != day:
            self._state['d1_day'] = day
            self._state['d1_ops'] = 0

    def try_reserve(self, r2_ops: int, d1_ops: int) -> bool:
        """
        Cố "đặt chỗ" trước r2_ops/d1_ops lượt ghi SẮP thực hiện. Trả về True và
        trừ luôn vào ngân sách nếu còn đủ chỗ (cả ngân sách bền vững lẫn giới
        hạn per-run); trả về False (KHÔNG trừ gì) nếu sẽ vượt — gọi TRƯỚC khi
        gửi request thật để không bao giờ phải hủy giữa chừng.
        """
        with self._lock:
            self._rollover_locked()

            if self._run_r2_ops + r2_ops > self.max_ops_per_run:
                self.stopped_reason = (
                    f"Đã đạt giới hạn {self.max_ops_per_run:,} lượt ghi R2 cho MỖI LẦN CHẠY "
                    f"(--max-ops-per-run). Chạy lại script để tiếp tục phần còn lại."
                )
                return False

            cur_r2 = self._state.get('r2_ops', 0)
            cur_d1 = self._state.get('d1_ops', 0)

            if cur_r2 + r2_ops > self.r2_monthly_budget:
                self.stopped_reason = (
                    f"Đã đạt ngân sách R2 tháng {self._state.get('r2_month')} "
                    f"({self.r2_monthly_budget:,} lượt — an toàn dưới free tier thật "
                    f"1,000,000/tháng). Tự động có ngân sách mới vào tháng sau, "
                    f"hoặc tăng bằng --r2-budget nếu bạn chấp nhận trả phí thêm."
                )
                return False
            if cur_d1 + d1_ops > self.d1_daily_budget:
                self.stopped_reason = (
                    f"Đã đạt ngân sách D1 ngày {self._state.get('d1_day')} "
                    f"({self.d1_daily_budget:,} dòng ghi — an toàn dưới free tier thật "
                    f"100,000/ngày). Tự động có ngân sách mới vào ngày mai (UTC), "
                    f"hoặc tăng bằng --d1-budget nếu bạn chấp nhận trả phí thêm."
                )
                return False

            self._state['r2_ops'] = cur_r2 + r2_ops
            self._state['d1_ops'] = cur_d1 + d1_ops
            self._run_r2_ops += r2_ops
            self._run_d1_ops += d1_ops
            self._save()
            return True

    def summary(self) -> str:
        with self._lock:
            self._rollover_locked()
            r2_used = self._state.get('r2_ops', 0)
            d1_used = self._state.get('d1_ops', 0)
            return (
                f"R2: {r2_used:,}/{self.r2_monthly_budget:,} lượt ghi tháng "
                f"{self._state.get('r2_month')} (free tier thật: 1,000,000/tháng) | "
                f"D1: {d1_used:,}/{self.d1_daily_budget:,} dòng ghi ngày "
                f"{self._state.get('d1_day')} (free tier thật: 100,000/ngày) | "
                f"Lần chạy này: +{self._run_r2_ops:,} lượt R2, +{self._run_d1_ops:,} dòng D1"
            )


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


import threading

thread_local = threading.local()

def get_drive_service():
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

        CHUNK_SIZE = 150
        total_chapters = len(all_chapters)
        chunks = [all_chapters[i:i + CHUNK_SIZE] for i in range(0, total_chapters, CHUNK_SIZE)]

        conn = http.client.HTTPSConnection(HOST, context=SSL_CTX, timeout=60)

        for idx, chunk in enumerate(chunks):
            # Ước lượng số lượt ghi R2/D1 mà chunk NÀY sẽ tạo ra ở syncNovelBatch()
            # (src/index.js): mỗi chương = 1 R2 put + 1 D1 insert; +1 R2 put cho
            # catalog.json mỗi chunk; chunk đầu tiên +1 D1 upsert bảng novels và
            # (nếu có synopsis) +1 R2 put synopsis.md.
            r2_ops_estimate = len(chunk) + 1 + (1 if idx == 0 and synopsis else 0)
            d1_ops_estimate = len(chunk) + (1 if idx == 0 else 0)

            if not budget.try_reserve(r2_ops_estimate, d1_ops_estimate):
                if conn:
                    conn.close()
                return {
                    'slug': slug, 'success': False, 'budget_exceeded': True,
                    'error': f"Dừng do ngân sách Cloudflare: {budget.stopped_reason}",
                }

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
    parser.add_argument("--r2-budget", type=int, default=DEFAULT_R2_MONTHLY_BUDGET,
                        help=f"Ngân sách lượt ghi R2 (Class A) TỐI ĐA mỗi tháng UTC "
                             f"(mặc định {DEFAULT_R2_MONTHLY_BUDGET:,}, an toàn dưới free tier "
                             f"thật 1,000,000/tháng)")
    parser.add_argument("--d1-budget", type=int, default=DEFAULT_D1_DAILY_BUDGET,
                        help=f"Ngân sách dòng ghi D1 TỐI ĐA mỗi ngày UTC "
                             f"(mặc định {DEFAULT_D1_DAILY_BUDGET:,}, an toàn dưới free tier "
                             f"thật 100,000/ngày)")
    parser.add_argument("--max-ops-per-run", type=int, default=DEFAULT_MAX_OPS_PER_RUN,
                        help=f"Giới hạn lượt ghi R2 cho MỖI LẦN CHẠY script (mặc định "
                             f"{DEFAULT_MAX_OPS_PER_RUN:,}) — để 1 lần chạy không dùng hết "
                             f"ngân sách cả tháng, đặc biệt khi backfill lần đầu với backlog lớn")
    parser.add_argument("--budget-file", default=None,
                        help="Đường dẫn file lưu ngân sách (mặc định: .cloud_sync_budget.json "
                             "cạnh state file)")
    args = parser.parse_args()

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
        except Exception:
            pass

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

    def save_cloud_state():
        try:
            cloud_sync_path.write_text(json.dumps({
                'last_updated': datetime.now().isoformat(),
                'total_synced': len(synced_slugs),
                'synced_slugs': list(synced_slugs)
            }, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

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
                        # Ngân sách Cloudflare đã hết (tháng/ngày UTC hoặc giới hạn per-run) —
                        # DỪNG NGAY toàn bộ, không thử slug khác (ngân sách dùng chung cho cả
                        # lần chạy). Tiến độ (synced_slugs) đã lưu sau mỗi novel thành công
                        # nên chạy lại script sau sẽ tiếp tục đúng chỗ, không mất gì.
                        sys.stderr.write(f"\n\n🛑 DỪNG DO NGÂN SÁCH CLOUDFLARE: {res.get('error')}\n")
                        stop_all = True
                    else:
                        sys.stderr.write(f"\n❌ Lỗi sync [{slug}]: {res.get('error')}\n")

                    if stop_all:
                        break

        except Exception as e:
            sys.stderr.write(f"\n⚠️ Mạng tạm ngắt kết nối ({e}), tự động khôi phục sau 3 giây...\n")
            time.sleep(3.0)

    print(f"\n💰 Ngân sách sau khi chạy: {budget.summary()}")


if __name__ == '__main__':
    main()
