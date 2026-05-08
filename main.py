"""
main.py
-------
CLI chính. Hỗ trợ quản lý và dịch nhiều truyện.

Commands:
    python main.py new                              # tạo truyện mới (interactive)
    python main.py list                             # liệt kê tất cả truyện
    python main.py info --novel <slug>              # xem chi tiết 1 truyện
    python main.py translate --novel <slug>         # dịch tiếp từ chỗ đã dừng
    python main.py translate --novel <slug> --chapters 10
    python main.py translate --novel <slug> --url <URL>    # ghi đè URL bắt đầu
    python main.py translate --novel <slug> --force        # dịch lại dù đã có file
    python main.py retranslate --novel <slug>       # dịch lại từ file raw (không crawl web)
    python main.py retranslate --novel <slug> --force      # dịch lại TẤT CẢ raw, kể cả đã dịch
    python main.py glossary --novel <slug>          # xem/thêm glossary
"""

import asyncio
import argparse
import os
import logging
from datetime import datetime

# NovelScraper và NovelTranslator được import lazy trong hàm cần dùng
# để tránh lỗi ModuleNotFoundError khi chỉ chạy các command không cần API/browser
from novel_manager import (
    NovelProfile,
    create_novel,
    load_novel,
    list_novels,
    print_novel_list,
)
from config import LOG_DIR, BATCH_SIZE, BATCH_MAX_CHARS, MAX_CONCURRENT_BATCHES

def _get_scraper():
    from scraper import NovelScraper
    return NovelScraper()

def _get_translator():
    from translator import NovelTranslator
    return NovelTranslator()


# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logging(novel_slug: str = "general") -> tuple[logging.Logger, str]:
    os.makedirs(LOG_DIR, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = os.path.join(LOG_DIR, f"{novel_slug}_{ts}.log")
    logger = logging.getLogger(novel_slug)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        logger.addHandler(logging.FileHandler(log_file, encoding="utf-8"))
        logger.addHandler(logging.StreamHandler())
        for h in logger.handlers:
            h.setFormatter(fmt)
    return logger, ts


# ── Helpers ───────────────────────────────────────────────────────────────────

def safe_filename(name: str) -> str:
    return "".join(c for c in name if c.isalnum() or c in (" ", "-", "_")).strip()


def get_output_path(profile: NovelProfile, title: str) -> str:
    os.makedirs(profile.translated_dir, exist_ok=True)
    return os.path.join(profile.translated_dir, f"{safe_filename(title)}_VI.md")


def is_already_translated(path: str) -> bool:
    return os.path.exists(path) and os.path.getsize(path) > 0


def is_failed_translation(path: str) -> bool:
    """Kiểm tra xem file đã dịch có phải là bản lỗi không (translation failed message)."""
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read(200)  # chỉ đọc đầu file
        return "[Translation failed" in content
    except Exception:
        return False


def find_untranslated_raws(profile: NovelProfile) -> list[tuple[str, str]]:
    """
    Scan text_raw/ và trả về list các file chưa có bản dịch tốt.
    Trả về: list of (raw_filepath, expected_output_filepath)
    Bao gồm cả file chưa dịch lẫn file dịch bị lỗi (Translation failed).
    """
    if not os.path.isdir(profile.raw_dir):
        return []

    raw_files = sorted(
        f for f in os.listdir(profile.raw_dir) if f.endswith(".txt")
    )

    pending = []
    for raw_name in raw_files:
        raw_path = os.path.join(profile.raw_dir, raw_name)
        # Output file: thay .txt → _VI.md
        stem = os.path.splitext(raw_name)[0]
        out_path = os.path.join(profile.translated_dir, f"{stem}_VI.md")

        if not is_already_translated(out_path) or is_failed_translation(out_path):
            pending.append((raw_path, out_path))

    return pending


def compute_batch_size(pending_batch: list[tuple[str, str]], new_content: str) -> int:
    """
    Kiểm tra xem có nên flush batch hiện tại trước khi thêm chương mới không.

    Logic:
      - Tính tổng chars của batch hiện tại + chương mới sắp thêm vào
      - Nếu tổng > BATCH_MAX_CHARS → trả về 0 (flush ngay batch hiện tại trước)
      - Nếu số chương trong batch đã đạt BATCH_SIZE → trả về 0 (flush)
      - Ngược lại → trả về số chương có thể thêm vào (1 = thêm bình thường)

    Returns:
      0  → cần flush batch hiện tại trước khi append chương mới
      1  → có thể append bình thường
    """
    # Kiểm tra số chương trước
    if len(pending_batch) >= BATCH_SIZE:
        return 0

    # Kiểm tra tổng chars
    current_chars = sum(len(content) for _, content in pending_batch)
    if current_chars + len(new_content) > BATCH_MAX_CHARS and pending_batch:
        return 0  # Flush trước để tránh vượt limit

    return 1


def save_raw(profile: NovelProfile, title: str, content: str):
    os.makedirs(profile.raw_dir, exist_ok=True)
    raw_path = os.path.join(profile.raw_dir, f"{safe_filename(title)}.txt")
    if not os.path.exists(raw_path):
        with open(raw_path, "w", encoding="utf-8") as f:
            f.write(content)


# ── Core: dịch 1 chương ──────────────────────────────────────────────────────

async def process_chapter(
    translator,
    profile: NovelProfile,
    logger: logging.Logger,
    title: str,
    content: str,
    output_file: str,
    chapter_url: str = "",
    chapter_number: int = 0,
    previous_summary: str = "",
    force: bool = False,
) -> str:
    """Dịch và lưu 1 chương. Trả về summary để truyền sang chương tiếp."""
    if not force and is_already_translated(output_file):
        logger.info(f"[SKIP] Already translated: {output_file}")
        try:
            with open(output_file, "r", encoding="utf-8") as f:
                existing = f.read()
            lines = [l for l in existing.strip().split("\n") if l.strip()]
            return " ".join(lines[-5:])
        except Exception:
            return ""

    logger.info(f"[*] Translating: {title} ({len(content)} chars)")

    translated, summary, _ = translator.translate_chapter(
        title=title,
        content=content,
        glossary=profile.glossary,
        translation_style=profile.translation_style,
        previous_summary=previous_summary,
    )

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(translated)

    # Cập nhật tiến độ vào novel.json
    if chapter_url:
        profile.update_progress(chapter_url, chapter_number)

    logger.info(f"[+] Saved: {output_file}")
    return summary


# ── Command: new ─────────────────────────────────────────────────────────────

def cmd_new(_args):
    """Tạo truyện mới qua interactive prompt."""
    print("\n📖  Tạo truyện mới\n" + "─" * 40)
    title = input("Tên truyện (tiếng Việt, vd: Thần Đạo Đế Tôn): ").strip()
    if not title:
        print("[!] Tên truyện không được để trống.")
        return

    original_title = input("Tên gốc (tiếng Trung, để trống nếu không có): ").strip()
    author = input("Tác giả (để trống nếu không biết): ").strip()
    source_url = input("URL chương đầu tiên: ").strip()
    genre = input("Thể loại [cultivation/modern/romance/other] (mặc định: cultivation): ").strip() or "cultivation"
    notes = input("Ghi chú thêm (để trống nếu không có): ").strip()

    print("\n📝  Nhập glossary (tên nhân vật & thuật ngữ riêng của truyện).")
    print("   Định dạng: <gốc> = <tiếng Việt>  |  Để trống để kết thúc.\n")
    glossary = {}
    while True:
        entry = input("   Glossary entry (vd: Chen Ming = Trần Minh): ").strip()
        if not entry:
            break
        if "=" in entry:
            k, v = entry.split("=", 1)
            glossary[k.strip()] = v.strip()
        else:
            print("   [!] Định dạng sai, bỏ qua.")

    try:
        profile = create_novel(
            title=title,
            original_title=original_title,
            author=author,
            source_url=source_url,
            genre=genre,
            glossary=glossary,
            notes=notes,
        )
        print(f"\n✅  Đã tạo truyện: {profile.title}")
        print(f"   Slug:   {profile.slug}")
        print(f"   Thư mục: novels/{profile.slug}/")
        print(f"\n   Bắt đầu dịch: python main.py translate --novel {profile.slug}")
    except ValueError as e:
        print(f"[!] {e}")


# ── Command: list ─────────────────────────────────────────────────────────────

def cmd_list(_args):
    print_novel_list()


# ── Command: info ─────────────────────────────────────────────────────────────

def cmd_info(args):
    try:
        profile = load_novel(args.novel)
    except FileNotFoundError as e:
        print(f"[!] {e}")
        return

    print(f"\n{'─'*50}")
    print(f"  📖  {profile.title}")
    print(f"{'─'*50}")
    print(f"  Slug:             {profile.slug}")
    print(f"  Tên gốc:          {profile.original_title or '(chưa có)'}")
    print(f"  Tác giả:          {profile.author or '(chưa có)'}")
    print(f"  Thể loại:         {profile.genre}")
    print(f"  URL bắt đầu:      {profile.source_url or '(chưa có)'}")
    print(f"  Chương đã dịch:   {profile.last_chapter_number}")
    print(f"  URL dịch cuối:    {profile.last_translated_url or '(chưa dịch)'}")
    print(f"  Tổng số chương:   {profile.total_chapters or '(chưa biết)'}")
    print(f"  Thư mục:          novels/{profile.slug}/")
    if profile.notes:
        print(f"  Ghi chú:          {profile.notes}")
    if profile.glossary:
        print(f"\n  Glossary ({len(profile.glossary)} entries):")
        for k, v in profile.glossary.items():
            print(f"    {k} → {v}")
    print(f"{'─'*50}\n")


# ── Command: glossary ─────────────────────────────────────────────────────────

def cmd_glossary(args):
    try:
        profile = load_novel(args.novel)
    except FileNotFoundError as e:
        print(f"[!] {e}")
        return

    print(f"\n📚  Glossary của '{profile.title}'")
    print("─" * 40)
    if profile.glossary:
        for k, v in profile.glossary.items():
            print(f"  {k} → {v}")
    else:
        print("  (Chưa có entry nào)")

    print("\n  Thêm entry mới (để trống để kết thúc):")
    while True:
        entry = input("  <gốc> = <tiếng Việt>: ").strip()
        if not entry:
            break
        if "=" in entry:
            k, v = entry.split("=", 1)
            profile.add_glossary_entry(k.strip(), v.strip())
            print(f"  ✅ Đã thêm: {k.strip()} → {v.strip()}")
        else:
            print("  [!] Định dạng sai, thử lại.")


# ── Command: translate ────────────────────────────────────────────────────────

async def cmd_translate_async(args, progress_callback=None):
    def report_progress(current, total, status, log_msg="", active_batches=None, scraped_count=None):
        if progress_callback:
            progress_callback(current, total, status, log_msg,
                              active_batches=active_batches,
                              scraped_count=scraped_count)

    def is_cancelled() -> bool:
        """Kiểm tra xem có yêu cầu dừng không (từ progress_callback hoặc cancel_flags)."""
        if progress_callback is None:
            return False
        # progress_callback sẽ set task status = 'cancelling' hoặc 'cancelled'
        # Kiểm tra qua dummy call để sync state
        from api import cancel_flags
        slug = getattr(args, 'novel', '')
        return bool(cancel_flags.get(slug, False))


    try:
        profile = load_novel(args.novel)
    except FileNotFoundError as e:
        print(f"[!] {e}")
        return

    logger, session_ts = setup_logging(profile.slug)
    started_at = datetime.now().isoformat()
    translator = _get_translator()
    previous_summary = ""

    # Xác định URL bắt đầu: ưu tiên --url > chương đã dịch cuối > URL ban đầu
    start_url = args.url or profile.last_translated_url or profile.source_url
    if not start_url:
        logger.error(
            "[!] Không có URL để bắt đầu. "
            f"Thêm source_url vào novels/{profile.slug}/novel.json "
            "hoặc dùng --url <URL>"
        )
        return

    # Nếu đã dịch rồi và không dùng --url thì tự động đi đến chương TIẾP THEO
    # (tránh dịch lại chương cuối cùng)
    resume_from_next = bool(profile.last_translated_url and not args.url)

    logger.info(f"[*] Novel: {profile.title} ({profile.slug})")
    logger.info(f"[*] Start URL: {start_url}")
    logger.info(f"[*] Chapters to translate: {args.chapters}")
    report_progress(0, args.chapters, "running", f"Bắt đầu dịch {args.chapters} chương từ {start_url}")

    scraper = _get_scraper()
    current_url = start_url
    chapter_count = 0      # số chương đã fetch
    translated_count = 0   # số chương đã dịch xong (dùng cho progress bar)
    batch = []
    batch_urls = []
    background_tasks = set()
    session_usage = {
        "total_tokens":  0,
        "input_tokens":  0,
        "output_tokens": 0,
        "cost_usd":      0.0,
        "models":        set(),
        "chapters_saved": [],
        "errors":        [],
    }

    logger.info(f"[*] Batch config: max {BATCH_SIZE} chapters/batch, max {BATCH_MAX_CHARS} chars/batch")
    logger.info(f"[*] Concurrency limit: {MAX_CONCURRENT_BATCHES} parallel batches")

    async def process_batch_async(batch_copy, urls_copy, summary_copy):
        nonlocal previous_summary, translated_count
        if not batch_copy: return

        batch_len = len(batch_copy)
        logger.info(f"[*] Translating batch of {batch_len} chapters (Background)...")
        report_progress(
            translated_count, args.chapters, "running",
            f"Đang dịch {batch_len} chương (đa luồng)..."
        )

        translated_chapters, summary, new_glossary, batch_usage = await asyncio.to_thread(
            translator.translate_batch,
            chapters=batch_copy,
            glossary=profile.glossary,
            translation_style=profile.translation_style,
            previous_summary=summary_copy,
            max_retries=3
        )

        session_usage["total_tokens"]  += batch_usage.get("total_tokens", 0)
        session_usage["input_tokens"]  += batch_usage.get("input_tokens", 0)
        session_usage["output_tokens"] += batch_usage.get("output_tokens", 0)
        session_usage["cost_usd"]      += batch_usage.get("cost_usd", 0.0)
        _m = batch_usage.get("model", "unknown")
        if _m and _m != "unknown":
            session_usage["models"].add(_m)
        _bc = batch_usage.get("cost_usd", 0.0)
        _bc_str = "free" if _bc == 0 else f"${_bc:.5f}"
        logger.info(
            f"[💰] {_m}: batch {batch_len}ch "
            f"~{batch_usage.get('input_tokens',0)}→{batch_usage.get('output_tokens',0)} tokens "
            f"{_bc_str}"
        )

        for i, (title, content) in enumerate(batch_copy):
            out = get_output_path(profile, title)
            chunk = translated_chapters[i] if i < len(translated_chapters) else None

            # Nếu chunk là None (thiếu/bị cắt) → retry riêng lẻ bằng translate_chapter
            if chunk is None:
                logger.warning(f"  [!] Chunk {i} thiếu/bị cắt — retry riêng lẻ: {title}")
                report_progress(translated_count, args.chapters, "running",
                                f"Retry riêng lẻ: {title}")
                chunk, _, _ru = await asyncio.to_thread(
                    translator.translate_chapter,
                    title=title,
                    content=content,
                    glossary=profile.glossary,
                    translation_style=profile.translation_style,
                    previous_summary=summary_copy,
                    max_retries=3,
                )
                session_usage["total_tokens"]  += _ru.get("total_tokens", 0)
                session_usage["input_tokens"]  += _ru.get("input_tokens", 0)
                session_usage["output_tokens"] += _ru.get("output_tokens", 0)
                session_usage["cost_usd"]      += _ru.get("cost_usd", 0.0)
                if _ru.get("model", "unknown") != "unknown":
                    session_usage["models"].add(_ru["model"])
                logger.info(f"  [{'✓' if '[Translation failed' not in chunk[:50] else '!'}] Retry result: {title}")

            with open(out, "w", encoding="utf-8") as f:
                f.write(chunk)
            logger.info(f"[+] Saved: {out}")
            
            if "[Translation failed" in chunk[:100]:
                session_usage["errors"].append(f"Dịch thất bại: {title}")
            else:
                session_usage["chapters_saved"].append(title)
                
            translated_count += 1
            report_progress(
                translated_count, args.chapters, "running",
                f"Đã lưu: {title}"
            )

        # Auto-update glossary with newly extracted terms
        if new_glossary:
            added = 0
            for k, v in new_glossary.items():
                if k not in profile.glossary:
                    profile.glossary[k] = v
                    added += 1
            if added > 0:
                logger.info(f"[*] Auto-learned {added} new glossary term(s)")
                profile.save()

        if urls_copy:
            profile.update_progress(urls_copy[-1], profile.last_chapter_number + batch_len)

        previous_summary = summary
        # Update active_batches count after this batch completes
        report_progress(translated_count, args.chapters, "running",
                        active_batches=max(0, len(background_tasks) - 1),
                        scraped_count=chapter_count)

    async def flush_batch():
        if not batch: return
        # Giới hạn số lượng task song song
        while len(background_tasks) >= MAX_CONCURRENT_BATCHES:
            done, pending = await asyncio.wait(background_tasks, return_when=asyncio.FIRST_COMPLETED)
            background_tasks.intersection_update(pending)
            
        task = asyncio.create_task(process_batch_async(list(batch), list(batch_urls), previous_summary))
        background_tasks.add(task)
        batch.clear()
        batch_urls.clear()
        report_progress(translated_count, args.chapters, "running",
                        active_batches=len(background_tasks),
                        scraped_count=chapter_count)

    while current_url and chapter_count < args.chapters:
        # Check cancel request trước mỗi chương
        if is_cancelled():
            logger.info("[⏹] Dừng theo yêu cầu người dùng.")
            report_progress(translated_count, args.chapters, "cancelled", "⏹ Đã dừng theo yêu cầu")
            break

        logger.info(f"[*] Fetching {chapter_count + 1}/{args.chapters}: {current_url}")

        html = await scraper.fetch_html(current_url)
        if not html:
            logger.error("[!] Failed to fetch HTML. Site might be blocking the script.")
            report_progress(translated_count, args.chapters, "error", f"Lỗi: Không thể lấy nội dung từ {current_url}")
            break

        title, content, _prev_url, next_url = scraper.parse_content(html, current_url)

        if not content or "Could not find" in content:
            logger.error(f"[!] Could not parse content: {current_url}")
            report_progress(translated_count, args.chapters, "error", f"Lỗi: Không thể phân tích nội dung tại {current_url}")
            break

        logger.info(f"[*] Scraped: {title}")
        report_progress(translated_count, args.chapters, "running", f"Đã lấy nội dung: {title}",
                        scraped_count=chapter_count)

        if resume_from_next:
            resume_from_next = False
            logger.info(f"[→] Resuming — skipping last translated chapter, moving to next.")
            if next_url:
                current_url = next_url
                await asyncio.sleep(2)
                continue
            else:
                logger.info("[*] No next chapter found after resume point.")
                break

        save_raw(profile, title, content)

        chapter_count += 1

        # Flush batch trước nếu thêm chương này sẽ vượt giới hạn chars hoặc số chương
        if compute_batch_size(batch, content) == 0 and batch:
            total_chars = sum(len(c) for _, c in batch)
            logger.info(
                f"[*] Batch flush: {len(batch)} chapter(s), {total_chars} chars "
                f"(adding '{title}' would exceed limit)"
            )
            await flush_batch()

        batch.append((title, content))
        batch_urls.append(current_url)

        # Flush khi đạt đúng BATCH_SIZE
        if len(batch) >= BATCH_SIZE:
            await flush_batch()

        if next_url and chapter_count < args.chapters:
            logger.info(f"[→] Next chapter: {next_url}")
            current_url = next_url
            await asyncio.sleep(2)
        else:
            if not next_url and chapter_count < args.chapters:
                logger.info("[*] No more chapters found.")
            break

    # Process remaining in batch
    await flush_batch()
    if background_tasks:
        logger.info(f"[*] Chờ {len(background_tasks)} luồng dịch đang chạy hoàn tất...")
        await asyncio.gather(*background_tasks)

    await scraper.close()

    if is_cancelled():
        logger.info(f"[⏹] Dừng! Đã dịch {chapter_count} chương trước khi dừng.")
        report_progress(translated_count, args.chapters, "cancelled", f"⏹ Đã dừng — {chapter_count} chương hoàn thành")
    else:
        logger.info(f"[✓] Done! Translated {chapter_count} chapter(s) for '{profile.title}'.")
        if chapter_count > 0:
            logger.info(f"[✓] Output: novels/{profile.slug}/translated/")
    _ms = ", ".join(sorted(session_usage["models"])) or "unknown"
    _cs = f"${session_usage['cost_usd']:.5f}" if session_usage["cost_usd"] > 0 else "free"
    logger.info(
        f"[📊] Token summary: {session_usage['total_tokens']:,} tokens "
        f"(in={session_usage['input_tokens']:,} out={session_usage['output_tokens']:,}) "
        f"| models={_ms} | cost={_cs}"
    )
    _save_session_stats(profile.slug, chapter_count, session_usage, logger, timestamp=session_ts, started_at=started_at)
    report_progress(chapter_count, args.chapters, "finished", f"Hoàn thành dịch {chapter_count} chương.")


# ── Session stats persistence ─────────────────────────────────────────────────

def _save_session_stats(slug: str, chapters_done: int, session_usage: dict, logger=None, timestamp=None, started_at=None):
    """
    Lưu token/cost stats của session vào file JSON riêng.
    File: logs/<slug>_<timestamp>_stats.json
    """
    import json as _json
    from datetime import datetime as _dt

    os.makedirs("logs", exist_ok=True)
    if not timestamp:
        timestamp = _dt.now().strftime("%Y%m%d_%H%M%S")
    stats_file = os.path.join("logs", f"{slug}_{timestamp}_stats.json")

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
            logger.info(f"[📁] Stats saved: {stats_file}")
    except Exception as e:
        if logger:
            logger.warning(f"[!] Could not save stats: {e}")



def cmd_translate(args):
    asyncio.run(cmd_translate_async(args))


# ── Command: retranslate ──────────────────────────────────────────────────────

def cmd_retranslate(args):
    """
    Dịch lại từ file raw có sẵn trong text_raw/ — không crawl web.
    Hữu ích khi translation bị fail nhưng raw đã được scrape thành công.

    Mặc định: chỉ dịch các file chưa có bản dịch HOẶC bản dịch bị lỗi.
    --force: dịch lại TẤT CẢ file raw, kể cả đã có bản dịch tốt.
    """
    try:
        profile = load_novel(args.novel)
    except FileNotFoundError as e:
        print(f"[!] {e}")
        return

    logger, _ = setup_logging(profile.slug)

    if args.force:
        # force mode: lấy TẤT CẢ raw files
        if not os.path.isdir(profile.raw_dir):
            logger.error(f"[!] Không tìm thấy thư mục raw: {profile.raw_dir}")
            return
        raw_files = sorted(f for f in os.listdir(profile.raw_dir) if f.endswith(".txt"))
        pending = []
        for raw_name in raw_files:
            raw_path = os.path.join(profile.raw_dir, raw_name)
            stem = os.path.splitext(raw_name)[0]
            out_path = os.path.join(profile.translated_dir, f"{stem}_VI.md")
            pending.append((raw_path, out_path))
    else:
        pending = find_untranslated_raws(profile)

    if not pending:
        logger.info(f"[✓] Không có file nào cần dịch lại trong '{profile.title}'.")
        logger.info(f"    Dùng --force để dịch lại toàn bộ.")
        return

    logger.info(f"[*] Novel: {profile.title} ({profile.slug})")
    logger.info(f"[*] Tìm thấy {len(pending)} file cần dịch lại:")
    for raw_path, out_path in pending:
        status = "❌ lỗi" if is_failed_translation(out_path) else "⬜ chưa dịch"
        logger.info(f"    {status}  {os.path.basename(raw_path)}")

    translator = _get_translator()
    os.makedirs(profile.translated_dir, exist_ok=True)

    success = 0
    failed = 0
    previous_summary = ""

    for i, (raw_path, out_path) in enumerate(pending, 1):
        raw_name = os.path.basename(raw_path)
        logger.info(f"\n[{i}/{len(pending)}] Translating: {raw_name}")

        try:
            with open(raw_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
        except Exception as e:
            logger.error(f"[!] Cannot read {raw_path}: {e}")
            failed += 1
            continue

        if not content:
            logger.warning(f"[!] File rỗng, bỏ qua: {raw_name}")
            failed += 1
            continue

        # Dùng tên file (bỏ .txt) làm title tạm
        title = os.path.splitext(raw_name)[0]

        translated, summary, _ = translator.translate_chapter(
            title=title,
            content=content,
            glossary=profile.glossary,
            translation_style=profile.translation_style,
            previous_summary=previous_summary,
        )

        # Kiểm tra kết quả có phải lỗi không
        if "[Translation failed" in translated:
            logger.error(f"[!] Translation failed: {raw_name}")
            # Vẫn ghi file để biết file nào lỗi
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(translated)
            failed += 1
            continue

        with open(out_path, "w", encoding="utf-8") as f:
            f.write(translated)

        previous_summary = summary
        success += 1
        logger.info(f"[+] Saved: {os.path.basename(out_path)}")

    # ── Summary ──
    print(f"\n{'─'*50}")
    print(f"  Retranslate xong: {profile.title}")
    print(f"  ✅ Thành công : {success} chương")
    if failed:
        print(f"  ❌ Thất bại   : {failed} chương")
        print(f"  → Chạy lại: python main.py retranslate --novel {profile.slug}")
    print(f"  📁 Output: novels/{profile.slug}/translated/")
    print(f"{'─'*50}\n")


# ── CLI setup ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="📖 Novel Translator — Scrape & translate novels to Vietnamese",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")

    # ── new ──
    subparsers.add_parser("new", help="Tạo truyện mới (interactive)")

    # ── list ──
    subparsers.add_parser("list", help="Liệt kê tất cả truyện")

    # ── info ──
    p_info = subparsers.add_parser("info", help="Xem chi tiết 1 truyện")
    p_info.add_argument("--novel", required=True, metavar="SLUG", help="Slug của truyện")

    # ── glossary ──
    p_glossary = subparsers.add_parser("glossary", help="Xem và chỉnh sửa glossary của truyện")
    p_glossary.add_argument("--novel", required=True, metavar="SLUG")

    # ── retranslate ──
    p_retranslate = subparsers.add_parser(
        "retranslate",
        help="Dịch lại từ file raw có sẵn — không cần crawl web (dùng khi translation bị lỗi)",
    )
    p_retranslate.add_argument("--novel", required=True, metavar="SLUG", help="Slug của truyện")
    p_retranslate.add_argument(
        "--force", action="store_true",
        help="Dịch lại TẤT CẢ file raw, kể cả những file đã dịch thành công",
    )

    # ── translate ──
    p_translate = subparsers.add_parser(
        "translate",
        help="Dịch truyện (tiếp tục từ chỗ đã dừng hoặc từ URL mới)",
    )
    p_translate.add_argument("--novel", required=True, metavar="SLUG", help="Slug của truyện")
    p_translate.add_argument("--url", type=str, default="", help="Ghi đè URL bắt đầu")
    p_translate.add_argument(
        "--chapters", type=int, default=1,
        help="Số chương dịch liên tiếp (mặc định: 1)",
    )
    p_translate.add_argument(
        "--force", action="store_true",
        help="Dịch lại dù file output đã tồn tại",
    )

    args = parser.parse_args()

    commands = {
        "new": cmd_new,
        "list": cmd_list,
        "info": cmd_info,
        "glossary": cmd_glossary,
        "translate": cmd_translate,
        "retranslate": cmd_retranslate,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
