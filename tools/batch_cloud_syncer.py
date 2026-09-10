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
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, FIRST_COMPLETED, wait

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


def send_chunk_persistent(conn, payload, max_retries=5, budget=None):
    return send_chunk(conn,payload,host=HOST,sync_key=SYNC_KEY,budget=budget,max_retries=max_retries)


def sync_single_novel(novel_dir: Path, budget=None) -> dict:
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
            from migrate_to_cloudflare import get_chapter_number, get_title
            num = get_chapter_number(get_title(f), f.name)
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

            res, conn = send_chunk_persistent(conn, payload, budget=budget)
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
    parser.add_argument('--r2-budget', type=int, default=0)
    parser.add_argument('--d1-budget', type=int, default=0)
    parser.add_argument('--max-ops-per-run', type=int, default=0)
    parser.add_argument('--budget-file', default=None)
    parser.add_argument('--watch', action='store_true', help='Theo dõi liên tục; mặc định chạy một lượt')
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

    novels_dir = Path(args.dir)
    if not novels_dir.exists():
        print(f"❌ Chưa tìm thấy thư mục: {novels_dir}")
        sys.exit(1)

    state_file = novels_dir / ".cloud_sync_state.json"
    issues_file = novels_dir / ".sync_issues.json"
    budget = SyncBudget(args.budget_file or novels_dir / '.cloud_sync_budget.json',
                        args.r2_budget,args.d1_budget,args.max_ops_per_run)
    had_failure = False

    synced_slugs = set()
    sync_issues = {}

    if state_file.exists():
        try:
            data = json.loads(state_file.read_text(encoding='utf-8'))
            synced_slugs = set(data.get('synced_slugs', []))
        except Exception as exc:
            raise RuntimeError("Checkpoint không hợp lệ; không tự reset tiến độ") from exc

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
    print(f"💰 Ngân sách: {budget.summary()}")
    print("=" * 80)

    def save_state():
        atomic_json(state_file,{'last_updated':datetime.now().isoformat(),
                    'total_synced':len(synced_slugs),'synced_slugs':sorted(synced_slugs)})

    def save_issues():
        atomic_json(issues_file,sync_issues)

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
                if not args.watch:
                    break
                time.sleep(args.delay)
                continue

            # Lấy 24 folder cho mỗi đợt xử lý
            batch_folders = pending_folders[:24]
            budget_exceeded = False

            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                pending_iter = iter(batch_folders)
                in_flight = {}

                def submit_next():
                    folder = next(pending_iter, None)
                    if folder is not None:
                        in_flight[executor.submit(sync_single_novel, folder, budget)] = folder.name

                for _ in range(args.workers):
                    submit_next()

                # Cửa sổ trượt: chỉ nộp truyện kế tiếp SAU KHI có kết quả và
                # ngân sách vẫn còn — hết ngân sách thì dừng ngay, không nộp
                # thêm bất kỳ truyện nào khác trong batch đang chạy.
                while in_flight and not budget_exceeded:
                    done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                    for future in done:
                        del in_flight[future]
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
                            submit_next()
                        elif res.get('budget_exceeded'):
                            had_failure = True
                            budget_exceeded = True
                            err_text = res.get('error', 'Lỗi không xác định')
                            sync_issues[slug] = {
                                'error': err_text,
                                'timestamp': datetime.now().isoformat()
                            }
                            save_issues()
                            sys.stderr.write(f"\n🛑 DỪNG NGAY DO NGÂN SÁCH [{slug}]: {err_text}\n")
                            break
                        else:
                            had_failure = True
                            err_text = res.get('error', 'Lỗi không xác định')
                            sync_issues[slug] = {
                                'error': err_text,
                                'timestamp': datetime.now().isoformat()
                            }
                            save_issues()
                            sys.stderr.write(f"\n❌ Lỗi sync [{slug}]: {err_text}\n")
                            submit_next()

            print(f"\n💰 Ngân sách: {budget.summary()}")

            if budget_exceeded:
                # Ngân sách dùng chung cho cả lần chạy — dừng hẳn vòng lặp
                # ngoài cùng kể cả khi --watch bật, không xử lý tiếp truyện
                # nào khác. Tiến độ đã lưu sau mỗi truyện thành công nên chạy
                # lại sau sẽ tiếp tục đúng chỗ, không mất gì.
                raise SystemExit(1)

            if had_failure:
                raise SystemExit(1)

        except KeyboardInterrupt:
            print("\n🛑 Đã dừng Daemon Cloudflare Syncer.")
            save_state()
            save_issues()
            print(f"💰 Ngân sách: {budget.summary()}")
            break
        except Exception as e:
            print(f"💰 Ngân sách: {budget.summary()}")
            raise SystemExit(f"Đồng bộ thất bại: {e}")

    print(f"💰 Ngân sách cuối cùng: {budget.summary()}")


if __name__ == '__main__':
    main()
