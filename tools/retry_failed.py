#!/usr/bin/env python3
"""
tools/retry_failed.py — Dịch lại các chương thất bại (roadmap 2.5).

Đọc novels/<slug>/failed_chapters.json (do pipeline._record_failed_chapter ghi,
list các {url, title, error, ts}) và với mỗi entry chạy:

  python3 main.py translate --novel <slug> --url <url> --chapters 1

(main.py translate hỗ trợ --url: ghi đè URL bắt đầu — dịch đúng 1 chương đó.)

Entry được coi là thành công khi sau khi chạy có file *_VI.md mới/được cập nhật
trong translated/ mà nội dung KHÔNG chứa "[Translation failed" — khi đó entry
bị xóa khỏi failed_chapters.json. File json được ghi lại sau MỖI entry để an
toàn khi bị ngắt giữa chừng; xóa hẳn file khi hết entry.

Usage:
  python3 tools/retry_failed.py --slug <slug> [--limit N] [--dry-run]
"""

import argparse
import json
import os
import subprocess
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOVELS_DIR = os.path.join(REPO_ROOT, "novels")
RETRY_TIMEOUT = 15 * 60  # 15 phút / chương


def load_failed(slug: str) -> tuple[str, list]:
    path = os.path.join(NOVELS_DIR, slug, "failed_chapters.json")
    if not os.path.isfile(path):
        return path, []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return path, data if isinstance(data, list) else []
    except Exception as e:  # noqa: BLE001
        print(f"[!] Không đọc được {path}: {e}")
        return path, []


def save_failed(path: str, entries: list):
    if entries:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
    elif os.path.isfile(path):
        os.unlink(path)  # hết chương lỗi → dọn file
        print(f"[✓] Đã dọn {path} (không còn chương lỗi)")


def translated_snapshot(slug: str) -> dict:
    """{filename: mtime} của các file *_VI.md — dùng detect file mới/cập nhật."""
    d = os.path.join(NOVELS_DIR, slug, "translated")
    if not os.path.isdir(d):
        return {}
    snap = {}
    for f in os.listdir(d):
        if f.endswith("_VI.md"):
            try:
                snap[f] = os.path.getmtime(os.path.join(d, f))
            except OSError:
                continue
    return snap


def retry_ok(slug: str, before: dict) -> bool:
    """Thành công nếu có file *_VI.md mới/được ghi lại và không phải bản lỗi."""
    after = translated_snapshot(slug)
    trans_dir = os.path.join(NOVELS_DIR, slug, "translated")
    for fname, mtime in after.items():
        if fname in before and mtime <= before[fname]:
            continue  # không đổi
        try:
            with open(os.path.join(trans_dir, fname), encoding="utf-8") as fh:
                head = fh.read(500)
        except OSError:
            continue
        if "[Translation failed" not in head:
            print(f"    [✓] File dịch OK: {fname}")
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description="Dịch lại các chương trong failed_chapters.json")
    ap.add_argument("--slug", required=True, help="Slug của truyện")
    ap.add_argument("--limit", type=int, default=0, help="Chỉ retry N entry đầu (0 = tất cả)")
    ap.add_argument("--dry-run", action="store_true", help="Chỉ in danh sách, không dịch")
    args = ap.parse_args()

    path, entries = load_failed(args.slug)
    if not entries:
        print(f"[*] {args.slug}: không có chương lỗi nào ({path} trống/không tồn tại).")
        return

    todo = entries[: args.limit] if args.limit > 0 else list(entries)
    print(f"[*] {args.slug}: {len(entries)} chương lỗi, retry {len(todo)} entry:")
    for e in todo:
        print(f"  • {e.get('title', '?')} — {e.get('url', '?')} ({e.get('ts', '?')})")
    if args.dry_run:
        print("[dry-run] Dừng tại đây.")
        return

    ok_n = fail_n = 0
    for e in todo:
        url, title = e.get("url", ""), e.get("title", "?")
        if not url:
            print(f"  [!] Entry thiếu url, bỏ qua: {title}")
            fail_n += 1
            continue
        print(f"\n[*] Retry: {title}\n    {url}")
        before = translated_snapshot(args.slug)
        time.sleep(0.01)  # đảm bảo mtime file mới > snapshot
        try:
            r = subprocess.run(
                [sys.executable, "main.py", "translate",
                 "--novel", args.slug, "--url", url, "--chapters", "1"],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=RETRY_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            print(f"    [✗] Timeout sau {RETRY_TIMEOUT // 60} phút")
            fail_n += 1
            continue
        except Exception as ex:  # noqa: BLE001
            print(f"    [✗] Không chạy được main.py: {ex}")
            fail_n += 1
            continue

        if r.returncode == 0 and retry_ok(args.slug, before):
            entries.remove(e)
            save_failed(path, entries)  # ghi sau mỗi entry — an toàn khi bị ngắt
            ok_n += 1
            print(f"    [✓] Thành công — đã xóa entry khỏi failed_chapters.json")
        else:
            fail_n += 1
            tail = (r.stderr or r.stdout or "")[-300:].strip()
            print(f"    [✗] Vẫn lỗi (exit {r.returncode}). {tail}")

    print(f"\n[📊] Kết quả: {ok_n} thành công, {fail_n} vẫn lỗi. "
          f"Còn {len(entries)} entry trong {path if entries else '(đã dọn)'}.")


if __name__ == "__main__":
    main()
