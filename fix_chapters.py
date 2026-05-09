"""
fix_chapters.py
---------------
Tự động dịch lại các chương bị lỗi hoặc còn thiếu.

Cách dùng:
    # Sửa cho truyện cụ thể
    python fix_chapters.py --novel xich-tam-tuan-thien

    # Sửa tất cả truyện cùng lúc
    python fix_chapters.py --all

    # Chỉ xem báo cáo, không dịch
    python fix_chapters.py --novel xich-tam-tuan-thien --report

    # Dịch lại TẤT CẢ kể cả file đã dịch tốt
    python fix_chapters.py --novel xich-tam-tuan-thien --force
"""

import os
import sys
import time
import argparse
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from novel_manager import load_novel, list_novel_slugs, NovelProfile
from config import LOG_DIR


# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logger(name: str) -> tuple[logging.Logger, str]:
    os.makedirs(LOG_DIR, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = os.path.join(LOG_DIR, f"fix_{name}_{ts}.log")
    logger = logging.getLogger(f"fix_{name}")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        fh = logging.FileHandler(log_file, encoding="utf-8")
        sh = logging.StreamHandler()
        fh.setFormatter(fmt)
        sh.setFormatter(fmt)
        logger.addHandler(fh)
        logger.addHandler(sh)
    return logger, ts


# ── Scan: tìm file có vấn đề ─────────────────────────────────────────────────

def scan_novel(profile: NovelProfile) -> dict:
    """
    Quét toàn bộ text_raw/ và translated/ của một truyện.
    Trả về dict với:
      - missing:    [(raw_path, out_path)] — chưa có bản dịch
      - failed:     [(raw_path, out_path)] — có [Translation failed
      - suspicious: [(raw_path, out_path, ratio)] — tỷ lệ ký tự bất thường
      - ok:         số chương ổn
    """
    if not os.path.isdir(profile.raw_dir):
        return {"missing": [], "failed": [], "suspicious": [], "ok": 0}

    raw_files = sorted(f for f in os.listdir(profile.raw_dir) if f.endswith(".txt"))
    all_raw   = set(raw_files)

    missing    = []
    failed     = []
    suspicious = []
    ok_count   = 0

    import re as _re
    _part_re = _re.compile(r'^(.+)-(\d+)$')

    for raw_name in raw_files:
        stem     = os.path.splitext(raw_name)[0]
        raw_path = os.path.join(profile.raw_dir, raw_name)
        out_path = os.path.join(profile.translated_dir, f"{stem}_VI.md")

        # ── Xử lý file gốc đã split (stem-1.txt tồn tại) ──────────────────
        has_part1 = f"{stem}-1.txt" in all_raw
        if has_part1:
            # File gốc đã được split — kiểm tra merged _VI.md
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                try:
                    with open(out_path, "r", encoding="utf-8") as f:
                        head = f.read(200)
                    if "[Translation failed" not in head:
                        ok_count += 1
                        continue  # Merged OK → bỏ qua file gốc
                except Exception:
                    pass
            # Merged chưa có hoặc lỗi → kiểm tra từng phần
            # (các phần sẽ được xử lý riêng bên dưới như file thường)
            continue  # Không report file gốc là "missing" — để phần xử lý

        # ── Xử lý file phần split (stem dạng xxx-N) ────────────────────────
        part_m = _part_re.match(stem)
        if part_m:
            orig_stem = part_m.group(1)
            # Tìm file gốc đã merge: prefix match vì gốc có thể có tiêu đề dài hơn
            # VD: "第1033章-1" → orig_stem="第1033章" → tìm "第1033章 xxx_VI.md"
            _no_extra_part = _re.compile(rf'^{_re.escape(orig_stem)}(?:[^-].*)?_VI\.md$')
            all_trans = os.listdir(profile.translated_dir)
            orig_merged_ok = False
            for orig_f in all_trans:
                if not _no_extra_part.match(orig_f):
                    continue
                orig_vi = os.path.join(profile.translated_dir, orig_f)
                if os.path.exists(orig_vi) and os.path.getsize(orig_vi) > 0:
                    try:
                        with open(orig_vi, "r", encoding="utf-8") as f:
                            head = f.read(200)
                        if "[Translation failed" not in head:
                            orig_merged_ok = True
                            break
                    except Exception:
                        pass
            if orig_merged_ok:
                ok_count += 1
                continue  # gốc đã merge OK → bỏ qua phần này

        # ── Kiểm tra thông thường ───────────────────────────────────────────

        # 1. Chưa có bản dịch
        if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            missing.append((raw_path, out_path))
            continue

        # 2. Translation failed
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                head = f.read(400)
            if "[Translation failed" in head:
                failed.append((raw_path, out_path))
                continue
        except Exception:
            failed.append((raw_path, out_path))
            continue

        # 3. Kiểm tra tỷ lệ ký tự (Vietnamese dài hơn Chinese khoảng 1.3–2.5×)
        try:
            raw_bytes  = os.path.getsize(raw_path)
            trans_size = os.path.getsize(out_path)
            if raw_bytes > 200:
                ratio = trans_size / raw_bytes
                if ratio < 0.8 or ratio > 5.0:
                    suspicious.append((raw_path, out_path, ratio))
                    continue
        except Exception:
            pass

        ok_count += 1

    return {
        "missing":    missing,
        "failed":     failed,
        "suspicious": suspicious,
        "ok":         ok_count,
    }


def print_report(slug: str, result: dict):
    total_issues = len(result["missing"]) + len(result["failed"]) + len(result["suspicious"])
    print(f"\n{'─'*60}")
    print(f"  📖  {slug}")
    print(f"{'─'*60}")
    print(f"  ✅ Ổn:         {result['ok']} chương")
    print(f"  ⬜ Chưa dịch:  {len(result['missing'])} chương")
    print(f"  ❌ Dịch lỗi:   {len(result['failed'])} chương")
    print(f"  ⚠️  Nghi vấn:   {len(result['suspicious'])} chương")

    if result["missing"]:
        print(f"\n  Chưa dịch:")
        for raw_path, _ in result["missing"]:
            print(f"    • {os.path.basename(raw_path)}")

    if result["failed"]:
        print(f"\n  Dịch lỗi:")
        for raw_path, out_path in result["failed"]:
            # Lấy thông báo lỗi ngắn
            try:
                with open(out_path, "r", encoding="utf-8") as f:
                    err_line = next(
                        (l.strip() for l in f if l.strip() and "Error:" in l),
                        ""
                    )
            except Exception:
                err_line = ""
            print(f"    • {os.path.basename(raw_path)}")
            if err_line:
                print(f"      → {err_line[:100]}")

    if result["suspicious"]:
        print(f"\n  Nghi vấn (tỷ lệ ký tự bất thường):")
        for raw_path, _, ratio in result["suspicious"]:
            print(f"    • {os.path.basename(raw_path)}  (ratio: {ratio:.2f}×)")

    if total_issues == 0:
        print(f"\n  🎉 Không có vấn đề gì!")
    print(f"{'─'*60}")


def _save_session_stats(slug: str, chapters_done: int, session_usage: dict, logger=None, timestamp=None, started_at=None):
    """
    Lưu token/cost stats của session vào file JSON riêng.
    File: logs/fix_<slug>_<timestamp>_stats.json
    """
    import json as _json
    from datetime import datetime as _dt

    os.makedirs("logs", exist_ok=True)
    if not timestamp:
        timestamp = _dt.now().strftime("%Y%m%d_%H%M%S")
    stats_file = os.path.join("logs", f"fix_{slug}_{timestamp}_stats.json")

    stats = {
        "slug":          slug,
        "timestamp":     _dt.now().isoformat(),
        "chapters_done": chapters_done,
        "total_tokens":  session_usage.get("total_tokens", 0),
        "input_tokens":  session_usage.get("input_tokens", 0),
        "output_tokens": session_usage.get("output_tokens", 0),
        "cost_usd":      session_usage.get("cost_usd", 0.0),
        "models":        sorted(session_usage.get("models", set())),
        "chapters_saved": session_usage.get("chapters_saved", []),
        "errors":        session_usage.get("errors", []),
    }
    
    if started_at:
        stats["started_at"] = started_at
        stats["ended_at"] = _dt.now().isoformat()
        try:
            t0 = _dt.fromisoformat(started_at)
            t1 = _dt.now()
            stats["duration_sec"] = int((t1 - t0).total_seconds())
        except Exception:
            pass
    try:
        with open(stats_file, "w", encoding="utf-8") as f:
            _json.dump(stats, f, ensure_ascii=False, indent=2)
        if logger:
            logger.info(f"[*] Đã lưu thống kê chi phí: {stats_file}")
    except Exception as e:
        if logger:
            logger.error(f"[!] Không lưu được stats file: {e}")


# ── Fix: dịch lại ─────────────────────────────────────────────────────────────

def fix_novel(profile: NovelProfile, result: dict, force: bool, logger: logging.Logger, session_ts: str = None) -> tuple[int, int]:
    """
    Dịch lại tất cả chương có vấn đề.
    force=True: cũng dịch lại cả chương nghi vấn.
    Trả về (success_count, failed_count).
    """
    from datetime import datetime
    started_at = datetime.now().isoformat()
    # Import lazy để tránh lỗi khi chỉ chạy --report
    from translator import NovelTranslator
    translator = NovelTranslator()

    # Tổng hợp danh sách cần xử lý
    to_fix = []
    for raw_path, out_path in result["missing"]:
        to_fix.append((raw_path, out_path, "missing"))
    for raw_path, out_path in result["failed"]:
        to_fix.append((raw_path, out_path, "failed"))
    if force:
        for raw_path, out_path, _ in result["suspicious"]:
            to_fix.append((raw_path, out_path, "suspicious"))

    if not to_fix:
        logger.info(f"[✓] Không có gì cần sửa cho '{profile.title}'")
        return 0, 0

    logger.info(f"[*] Cần xử lý {len(to_fix)} chương cho '{profile.title}'")
    os.makedirs(profile.translated_dir, exist_ok=True)

    success    = 0
    fail_count = 0
    prev_summary = ""
    
    session_usage = {
        "total_tokens": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_usd": 0.0,
        "models": set(),
        "chapters_saved": [],
        "errors": []
    }

    for i, (raw_path, out_path, issue_type) in enumerate(to_fix, 1):
        raw_name = os.path.basename(raw_path)
        stem     = os.path.splitext(raw_name)[0]
        logger.info(f"\n[{i}/{len(to_fix)}] [{issue_type}] {raw_name}")

        try:
            with open(raw_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
        except Exception as e:
            logger.error(f"  [!] Không đọc được raw: {e}")
            fail_count += 1
            continue

        if not content:
            logger.warning(f"  [!] File raw rỗng, bỏ qua.")
            fail_count += 1
            continue

        # ── Auto-split chương lớn trước khi dịch ──────────────────────────
        # Import hàm split từ main.py (tránh duplicate code)
        try:
            from main import split_chapter_content, merge_translated_parts, CHAPTER_SPLIT_THRESHOLD
        except ImportError:
            CHAPTER_SPLIT_THRESHOLD = 4500
            split_chapter_content   = None
            merge_translated_parts  = None

        parts_to_translate = [(stem, content, out_path)]  # default: 1 phần
        is_large = split_chapter_content and len(content) > CHAPTER_SPLIT_THRESHOLD

        if is_large:
            chunks = split_chapter_content(content)
            logger.info(f"  [✂] Chương lớn ({len(content):,} chars) → split thành {len(chunks)} phần")
            parts_to_translate = []
            for idx, chunk in enumerate(chunks, start=1):
                part_stem    = f"{stem}-{idx}"
                part_out     = os.path.join(profile.translated_dir, f"{part_stem}_VI.md")
                # Lưu raw phần vào text_raw/
                part_raw     = os.path.join(profile.raw_dir, f"{part_stem}.txt")
                if not os.path.exists(part_raw):
                    with open(part_raw, "w", encoding="utf-8") as f:
                        f.write(chunk)
                parts_to_translate.append((part_stem, chunk, part_out))

        chapter_success = True
        part_summaries  = []

        for part_stem, part_content, part_out in parts_to_translate:
            logger.info(f"  [*] Dịch '{part_stem}' ({len(part_content):,} chars)...")

            translated, summary, usage = translator.translate_chapter(
                title=part_stem,
                content=part_content,
                glossary=profile.glossary,
                translation_style=profile.translation_style,
                previous_summary=prev_summary,
                max_retries=3,
            )

            with open(part_out, "w", encoding="utf-8") as f:
                f.write(translated)

            if "[Translation failed" in translated[:400]:
                err = next((l.strip() for l in translated.splitlines() if "Error:" in l), "Unknown error")
                logger.error(f"  [!] FAILED part '{part_stem}': {err[:120]}")
                session_usage["errors"].append(f"Dịch thất bại {part_stem}: {err[:120]}")
                chapter_success = False
            else:
                prev_summary = summary
                part_summaries.append(part_stem)
                logger.info(f"  [✓] Saved part: {os.path.basename(part_out)}")
                session_usage["total_tokens"]  += usage.get("total_tokens", 0)
                session_usage["input_tokens"]  += usage.get("input_tokens", 0)
                session_usage["output_tokens"] += usage.get("output_tokens", 0)
                session_usage["cost_usd"]      += usage.get("cost_usd", 0.0)
                if usage.get("model"):
                    session_usage["models"].add(usage["model"])

            time.sleep(2)

        # Merge nếu là chương lớn đã split
        if is_large and chapter_success and merge_translated_parts:
            ok = merge_translated_parts(profile, stem, len(parts_to_translate))
            if ok:
                logger.info(f"  [✓] Merged: '{stem}' ({len(parts_to_translate)} phần → 1 file)")
            else:
                logger.warning(f"  [!] Merge thất bại cho '{stem}'")
                chapter_success = False

        if chapter_success:
            success += 1
            session_usage["chapters_saved"].append(stem)
            logger.info(f"  [✓] Hoàn thành: {stem}")
        else:
            fail_count += 1

        # Throttle
        time.sleep(1)

    if success > 0:
        _save_session_stats(profile.slug, success, session_usage, logger, timestamp=session_ts, started_at=started_at)

    return success, fail_count


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="🔧 Fix chương lỗi/thiếu bản dịch",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--novel", metavar="SLUG", help="Slug truyện cần fix")
    group.add_argument("--all",   action="store_true", help="Fix tất cả truyện")

    parser.add_argument(
        "--report", action="store_true",
        help="Chỉ in báo cáo, không dịch",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Cũng dịch lại chương nghi vấn (tỷ lệ ký tự bất thường)",
    )

    args = parser.parse_args()

    slugs = list_novel_slugs() if args.all else [args.novel]
    if not slugs:
        print("[!] Không có truyện nào.")
        return

    total_success = 0
    total_failed  = 0

    for slug in slugs:
        try:
            profile = load_novel(slug)
        except FileNotFoundError as e:
            print(f"[!] {e}")
            continue

        result = scan_novel(profile)
        print_report(slug, result)

        total_issues = len(result["missing"]) + len(result["failed"])
        if args.force:
            total_issues += len(result["suspicious"])

        if args.report:
            continue

        if total_issues == 0:
            print(f"  → Không cần làm gì thêm.\n")
            continue

        logger, session_ts = setup_logger(slug)
        print(f"\n  🔧 Đang sửa {total_issues} chương...\n")
        s, f = fix_novel(profile, result, args.force, logger, session_ts=session_ts)
        total_success += s
        total_failed  += f

        # Scan lại để xác nhận
        result_after = scan_novel(profile)
        issues_after = len(result_after["missing"]) + len(result_after["failed"])
        if issues_after == 0:
            print(f"\n  ✅ Tất cả chương của '{profile.title}' đã ổn!")
        else:
            print(f"\n  ⚠️  Còn {issues_after} chương chưa sửa được. Chạy lại để thử lại.")

    if not args.report and len(slugs) > 0:
        print(f"\n{'='*60}")
        print(f"  Kết quả: ✅ {total_success} chương thành công  |  ❌ {total_failed} chương thất bại")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
