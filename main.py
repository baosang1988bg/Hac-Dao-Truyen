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

Ghi chú refactor: logic pipeline dịch (crawl → batch → translate → save → merge)
đã tách sang pipeline.py; các hàm tiện ích thuần sang chapter_utils.py.
main.py giữ vai trò CLI + orchestrator, và re-export các tên cũ để tương thích
ngược (tools/ và scratch/ vẫn `from main import ...` được).
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
from config import LOG_DIR

import pipeline

# ── Re-exports tương thích ngược ─────────────────────────────────────────────
# Code cũ (tools/, scratch/) import các tên này từ main — giữ nguyên hoạt động.
from chapter_utils import (              # noqa: F401
    safe_filename,
    is_already_translated,
    is_failed_translation,
    is_split_original,
    get_split_part_count,
    split_chapter_content,
    _split_at_sentence,
    CHAPTER_SPLIT_THRESHOLD,
)
from pipeline import (                   # noqa: F401
    update_profile_glossary_safely,
    update_profile_progress_safely,
    get_output_path,
    get_vietnamese_translated_path,
    fetch_and_merge_paginated_chapter_async,
    find_untranslated_raws,
    save_raw_parts,
    save_raw,
    merge_translated_parts,
    compute_batch_size,
    _save_session_stats,
)


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

    # Translator output already has "# Chương ...: <VI title>" on line 1.
    # Extract that VI title and rewrite heading with the correct numeric number.
    # No extra API call needed – title is already translated by the model.
    import re as _re
    translated_lines = translated.splitlines(keepends=True)
    vi_title_only = title  # fallback = raw title
    body_lines = translated_lines

    if translated_lines:
        first = translated_lines[0].strip()
        m = _re.match(r"^#\s*(.+)$", first, _re.IGNORECASE)
        if m:
            vi_title_only = m.group(1).strip()
            body_lines = translated_lines[1:]  # drop old heading line

    # Clean double prefixes in title
    import re as _re_single
    vi_title_only = _re_single.sub(r"^(Chương\s+[\w\d]+|第[一二三四五六七八九十\d\s]+章)\s*[:：\-]*\s*", "", vi_title_only, flags=_re_single.IGNORECASE).strip()

    clean_header = f"# Chương {chapter_number}: {vi_title_only}\n"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(clean_header + "".join(body_lines))

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
    """
    Orchestrator của pipeline dịch — logic chi tiết nằm trong pipeline.py.

    Contract progress_callback GIỮ NGUYÊN như cũ (routers/translate.py phụ thuộc):
      progress_callback(current, total, status, log_msg="", active_batches=None,
                        scraped_count=None, current_chapter=None, crawling_chapter=None,
                        current_model=None, tokens_delta=0, cost_delta=0.0,
                        chapter_ok=None, chapter_fail=None, batch_detail=None)
    """
    def report_progress(current, total, status, log_msg="", active_batches=None, scraped_count=None,
                        current_chapter=None, crawling_chapter=None,
                        current_model=None, tokens_delta=0, cost_delta=0.0,
                        chapter_ok=None, chapter_fail=None, batch_detail=None):
        if progress_callback:
            progress_callback(current, total, status, log_msg,
                              active_batches=active_batches,
                              scraped_count=scraped_count,
                              current_chapter=current_chapter,
                              crawling_chapter=crawling_chapter,
                              current_model=current_model,
                              tokens_delta=tokens_delta,
                              cost_delta=cost_delta,
                              chapter_ok=chapter_ok,
                              chapter_fail=chapter_fail,
                              batch_detail=batch_detail)

    def is_cancelled() -> bool:
        """Kiểm tra xem có yêu cầu dừng không (từ progress_callback hoặc cancel_flags)."""
        if progress_callback is None:
            return False
        # progress_callback sẽ set task status = 'cancelling' hoặc 'cancelled'
        # cancel_flags nằm trong state.py (dùng chung với routers/translate.py)
        from state import cancel_flags
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

    # ── Phase 0: xác định vị trí bắt đầu ──
    start_url = pipeline.resolve_start_url(profile, args, logger)
    if start_url is None:
        return

    ctx = pipeline.TranslationContext(
        args=args,
        profile=profile,
        logger=logger,
        translator=translator,
        report_progress=report_progress,
        is_cancelled=is_cancelled,
    )
    pipeline.init_catalog(ctx, start_url)
    pipeline.resolve_chapter_budget(ctx)
    pipeline.prepare_session(ctx, _get_scraper)

    # ── Phase 1: crawl + enqueue + dịch song song ──
    if ctx.catalog_active:
        await pipeline.run_catalog_flow(ctx)
    else:
        await pipeline.run_sequential_flow(ctx)

    # ── Phase 2: chờ luồng dịch, merge split, lưu stats ──
    await pipeline.finalize_session(ctx, session_ts, started_at)


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
            out_path = os.path.join(profile.translated_dir, f"{safe_filename(stem)}_VI.md")
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

        translated, summary, _usage = translator.translate_chapter(
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

        _model_used = _usage.get("model", "unknown") if isinstance(_usage, dict) else "unknown"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(translated + f"\n\n*(Bản dịch được thực hiện bởi model: {_model_used})*\n")

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


async def async_import_novel(url: str, slug: str = ""):
    from scraper import NovelScraper
    from slugify import slugify
    import json
    from pathlib import Path

    scraper = NovelScraper()
    print(f"🔍 Đang tự động bóc tách thông tin từ URL: {url}...")
    meta = await scraper.fetch_novel_metadata(url)
    await scraper.close()

    if not meta or not meta.get("title"):
        print("❌ Không thể lấy thông tin truyện từ URL cung cấp.")
        return

    novel_slug = slug or slugify(meta["title"])
    novel_dir = Path("novels") / novel_slug
    novel_dir.mkdir(parents=True, exist_ok=True)
    (novel_dir / "raw").mkdir(exist_ok=True)
    (novel_dir / "translated").mkdir(exist_ok=True)

    # 1. novel.json
    novel_info = {
        "slug": novel_slug,
        "title": meta["title"],
        "original_title": meta["original_title"],
        "author": meta["author"],
        "source_url": url,
        "genre": meta["genre"],
        "last_translated_url": meta["chapters"][0]["url"] if meta["chapters"] else url,
        "last_chapter_number": 0,
        "total_chapters": len(meta["chapters"]),
        "glossary": {}
    }
    with open(novel_dir / "novel.json", "w", encoding="utf-8") as f:
        json.dump(novel_info, f, ensure_ascii=False, indent=2)

    # 2. catalog.json
    catalog = []
    for item in meta["chapters"]:
        ch_num = item["number"]
        catalog.append({
            "number": ch_num,
            "title": f"Chương {ch_num}",
            "original_title": item["title"],
            "url": item["url"],
            "original_chapter_number": ch_num,
            "filename": f"Chương {ch_num}_VI.md"
        })
    with open(novel_dir / "catalog.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    # 3. synopsis.md
    if meta.get("synopsis"):
        with open(novel_dir / "synopsis.md", "w", encoding="utf-8") as f:
            f.write(meta["synopsis"])

    print(f"\n🎉 Nhập truyện 1-Click thành công!")
    print(f"  📖 Tên truyện: {meta['title']}")
    print(f"  ✍️ Tác giả: {meta['author']}")
    print(f"  📚 Tổng số chương tìm thấy: {len(meta['chapters'])}")
    print(f"  📁 Thư mục lưu: novels/{novel_slug}")
    print(f"  👉 Chạy dịch tiếp: python main.py translate --novel {novel_slug} --chapters 10\n")

def cmd_import(args):
    asyncio.run(async_import_novel(args.url, args.slug))


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

    # ── import ──
    p_import = subparsers.add_parser(
        "import",
        help="Nhập truyện mới 1-Click tự động từ URL (Qidian, 69shuba, novel543...)",
    )
    p_import.add_argument("--url", required=True, type=str, help="URL của trang truyện bên Trung")
    p_import.add_argument("--slug", type=str, default="", help="Tùy chọn slug riêng")

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
        "import": cmd_import,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
