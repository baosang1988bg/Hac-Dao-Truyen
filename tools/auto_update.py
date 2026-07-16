#!/usr/bin/env python3
"""
tools/auto_update.py — Cron orchestrator tự động dịch chương mới (roadmap 2.4).

Chạy từ cron trên máy user (nguồn crawl chặn IP datacenter nên KHÔNG chạy
được từ server/sandbox):

  0 6 * * * cd /path/to/HacDaoTruyen && python3 tools/auto_update.py >> logs/cron.log 2>&1

Quy trình với mỗi truyện trong novels/ (hoặc --slug):
  1. Đọc novel.json — chỉ xử lý truyện có source_url và
     total_chapters > last_chapter_number (còn chương mới), hoặc khi --force.
  2. Chạy `python3 main.py translate --novel <slug> --chapters 0`
     (dịch toàn bộ phần còn lại, subprocess timeout 2 giờ, tuần tự từng truyện).
  3. Nếu có chương mới → build EPUB (tools/build_epub.py, cache novels/<slug>/book.epub).
  4. Sau khi build EPUB → chạy `python3 migrate_to_cloudflare.py --slug <slug> --smart-sync`
     (trừ khi --no-sync) để đẩy chương mới + book.epub lên D1/R2.

⚠️ LƯU Ý VỀ AUTO_SYNC_CLOUDFLARE:
  finalize_session của pipeline cũng tự gọi migrate khi env AUTO_SYNC_CLOUDFLARE=1.
  auto_update.py TỰ sync sau khi build EPUB (để book.epub được upload cùng đợt),
  nên khi dùng auto_update hãy để AUTO_SYNC_CLOUDFLARE tắt (hoặc =0) để tránh
  sync 2 lần. Script này chủ động set AUTO_SYNC_CLOUDFLARE=0 trong env của
  subprocess translate để đảm bảo điều đó.

Chống chạy chồng: lock file /tmp/hacdao-auto-update.lock (chứa PID; lock của
process đã chết sẽ tự được dọn).

Notify: nếu env NOTIFY_WEBHOOK_URL có giá trị → POST JSON {"content": "..."}
(format Discord webhook) tóm tắt truyện nào thêm bao nhiêu chương + lỗi.

Log: logs/auto_update-YYYYMMDD.log (+ stdout).

Flags:
  --slug SLUG    chỉ chạy 1 truyện
  --force        chạy cả truyện không có chương mới theo total_chapters
  --dry-run      chỉ in kế hoạch, không dịch/sync
  --no-sync      bỏ qua bước migrate_to_cloudflare
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import urllib.request
from datetime import datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOVELS_DIR = os.path.join(REPO_ROOT, "novels")
LOCK_FILE = "/tmp/hacdao-auto-update.lock"
TRANSLATE_TIMEOUT = 2 * 60 * 60  # 2h mỗi truyện
SYNC_TIMEOUT = 30 * 60


# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logger() -> logging.Logger:
    logs_dir = os.path.join(REPO_ROOT, "logs")
    os.makedirs(logs_dir, exist_ok=True)
    log_path = os.path.join(logs_dir, f"auto_update-{datetime.now():%Y%m%d}.log")
    logger = logging.getLogger("auto_update")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S")
    for h in (logging.FileHandler(log_path, encoding="utf-8"),
              logging.StreamHandler(sys.stdout)):
        h.setFormatter(fmt)
        logger.addHandler(h)
    return logger


# ── Lock file ─────────────────────────────────────────────────────────────────

def acquire_lock(logger) -> bool:
    """Tạo lock file chứa PID. Trả False nếu 1 instance khác đang chạy."""
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE) as f:
                old_pid = int(f.read().strip() or 0)
        except (ValueError, OSError):
            old_pid = 0
        if old_pid > 0:
            try:
                os.kill(old_pid, 0)  # chỉ kiểm tra process còn sống
                logger.warning(f"Instance khác đang chạy (PID {old_pid}) — thoát.")
                return False
            except (ProcessLookupError, PermissionError):
                pass  # process chết → lock cũ, dọn
        logger.info("Dọn lock file cũ (process không còn chạy).")
        try:
            os.unlink(LOCK_FILE)
        except OSError:
            pass
    try:
        fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "w") as f:
            f.write(str(os.getpid()))
        return True
    except FileExistsError:
        logger.warning("Không lấy được lock (race) — thoát.")
        return False


def release_lock():
    try:
        os.unlink(LOCK_FILE)
    except OSError:
        pass


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_novel_json(slug: str) -> dict | None:
    path = os.path.join(NOVELS_DIR, slug, "novel.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def count_translated(slug: str) -> int:
    """Đếm số file *_VI.md trong translated/ (đo delta trước/sau khi dịch)."""
    d = os.path.join(NOVELS_DIR, slug, "translated")
    if not os.path.isdir(d):
        return 0
    return len([f for f in os.listdir(d) if f.endswith("_VI.md")])


def plan_updates(slugs: list[str], force: bool, logger) -> list[dict]:
    """Chọn truyện cần update: có source_url và còn chương mới (hoặc --force)."""
    plan = []
    for slug in slugs:
        data = load_novel_json(slug)
        if data is None:
            logger.info(f"[skip] {slug}: không có novel.json hợp lệ")
            continue
        source_url = data.get("source_url") or ""
        total = data.get("total_chapters") or 0
        last = data.get("last_chapter_number") or 0
        if not source_url:
            logger.info(f"[skip] {slug}: không có source_url")
            continue
        has_new = total > last
        if not (has_new or force):
            logger.info(f"[skip] {slug}: không có chương mới (total={total}, last={last})")
            continue
        plan.append({
            "slug": slug,
            "title": data.get("title") or slug,
            "total_chapters": total,
            "last_chapter_number": last,
            "expected_new": max(0, total - last),
        })
    return plan


def notify_webhook(content: str, logger):
    """POST {"content": ...} tới NOTIFY_WEBHOOK_URL (Discord webhook format)."""
    url = os.getenv("NOTIFY_WEBHOOK_URL", "").strip()
    if not url:
        return
    try:
        body = json.dumps({"content": content[:1900]}).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Content-Type": "application/json",
                     "User-Agent": "hacdao-auto-update/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            logger.info(f"[notify] Webhook OK (HTTP {res.status})")
    except Exception as e:  # noqa: BLE001 — notify không được phá quy trình
        logger.warning(f"[notify] Webhook lỗi: {e}")


# ── Các bước xử lý 1 truyện ──────────────────────────────────────────────────

def run_translate(slug: str, logger) -> tuple[bool, str]:
    """Chạy main.py translate --chapters 0. Trả (ok, error_msg)."""
    env = dict(os.environ)
    env["AUTO_SYNC_CLOUDFLARE"] = "0"  # auto_update tự sync SAU khi build EPUB
    try:
        r = subprocess.run(
            [sys.executable, "main.py", "translate", "--novel", slug, "--chapters", "0"],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True,
            timeout=TRANSLATE_TIMEOUT,
        )
        if r.returncode != 0:
            return False, f"translate exit {r.returncode}: {(r.stderr or r.stdout)[-400:].strip()}"
        return True, ""
    except subprocess.TimeoutExpired:
        return False, f"translate timeout sau {TRANSLATE_TIMEOUT // 3600}h"
    except Exception as e:  # noqa: BLE001
        return False, f"translate không chạy được: {e}"


def run_build_epub(slug: str, logger) -> tuple[bool, str]:
    try:
        sys.path.insert(0, REPO_ROOT)
        from tools.build_epub import build_novel_epub
        info = build_novel_epub(slug, novels_dir=NOVELS_DIR, prefer_ebooklib=None, quiet=True)
        logger.info(f"[epub] {slug}: {info['chapters']} chương → {info['path']}")
        return True, ""
    except Exception as e:  # noqa: BLE001
        return False, f"build EPUB lỗi: {e}"


def run_sync(slug: str, logger) -> tuple[bool, str]:
    try:
        r = subprocess.run(
            [sys.executable, "migrate_to_cloudflare.py", "--slug", slug, "--smart-sync"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=SYNC_TIMEOUT,
        )
        if r.returncode != 0:
            return False, f"sync exit {r.returncode}: {(r.stderr or r.stdout)[-400:].strip()}"
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "sync timeout"
    except Exception as e:  # noqa: BLE001
        return False, f"sync không chạy được: {e}"


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Cron orchestrator: tự động dịch chương mới")
    ap.add_argument("--slug", help="Chỉ chạy 1 truyện")
    ap.add_argument("--force", action="store_true",
                    help="Chạy cả truyện không có chương mới theo total_chapters")
    ap.add_argument("--dry-run", action="store_true",
                    help="Chỉ in kế hoạch, không dịch/sync")
    ap.add_argument("--no-sync", action="store_true",
                    help="Bỏ qua bước migrate_to_cloudflare")
    args = ap.parse_args()

    logger = setup_logger()

    if args.slug:
        slugs = [args.slug]
    else:
        slugs = sorted(
            d for d in os.listdir(NOVELS_DIR)
            if os.path.isfile(os.path.join(NOVELS_DIR, d, "novel.json"))
        ) if os.path.isdir(NOVELS_DIR) else []

    plan = plan_updates(slugs, args.force, logger)
    if not plan:
        logger.info("Không có truyện nào cần update. Xong.")
        return

    logger.info(f"Kế hoạch update ({len(plan)} truyện):")
    for p in plan:
        logger.info(f"  • {p['slug']} — {p['title']}: "
                    f"last={p['last_chapter_number']}/{p['total_chapters']} "
                    f"(~{p['expected_new']} chương mới)")

    if args.dry_run:
        logger.info("[dry-run] Dừng tại đây — không dịch/sync.")
        return

    if not acquire_lock(logger):
        sys.exit(1)

    lines, had_error = [], False
    try:
        for p in plan:  # tuần tự từng truyện — tránh nghẽn API/nguồn crawl
            slug = p["slug"]
            logger.info(f"=== {slug}: bắt đầu dịch ===")
            before = count_translated(slug)
            ok, err = run_translate(slug, logger)
            added = count_translated(slug) - before

            if not ok:
                had_error = True
                logger.error(f"[{slug}] {err}")
                lines.append(f"❌ {p['title']}: {err}")
                if added <= 0:
                    continue  # lỗi và không có gì mới → sang truyện tiếp theo

            if added > 0:
                logger.info(f"[{slug}] +{added} chương mới → build EPUB")
                ok_e, err_e = run_build_epub(slug, logger)
                if not ok_e:
                    had_error = True
                    logger.error(f"[{slug}] {err_e}")
                    lines.append(f"⚠️ {p['title']}: +{added} chương nhưng {err_e}")
                if not args.no_sync:
                    ok_s, err_s = run_sync(slug, logger)
                    if ok_s:
                        logger.info(f"[{slug}] Sync Cloudflare OK")
                    else:
                        had_error = True
                        logger.error(f"[{slug}] {err_s}")
                        lines.append(f"⚠️ {p['title']}: +{added} chương nhưng {err_s}")
                if ok and ok_e and (args.no_sync or ok_s):
                    lines.append(f"✅ {p['title']}: +{added} chương mới")
            elif ok:
                logger.info(f"[{slug}] Không có chương mới sau khi chạy translate.")
                lines.append(f"➖ {p['title']}: không có chương mới")
    finally:
        release_lock()

    summary = "📖 HacDaoTruyen auto-update:\n" + "\n".join(lines or ["(không có gì)"])
    logger.info("Tóm tắt:\n" + summary)
    notify_webhook(summary, logger)
    if had_error:
        sys.exit(2)


if __name__ == "__main__":
    main()
