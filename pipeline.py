"""
pipeline.py
-----------
Các phase của pipeline dịch — tách từ main.cmd_translate_async (trước đây ~615 dòng).

Kiến trúc:
  TranslationContext      : trạng thái dùng chung của 1 phiên dịch
  resolve_start_url       : xác định URL bắt đầu
  init_catalog            : load catalog.json + xác định vị trí resume
  resolve_chapter_budget  : xử lý --chapters <= 0 (dịch toàn bộ phần còn lại)
  prepare_session         : log cấu hình, khởi tạo scraper, build url→catalog map
  run_catalog_flow        : vòng lặp crawl/chuẩn bị chương theo catalog
  run_sequential_flow     : vòng lặp crawl tuần tự theo link "next chapter"
  process_batch_async     : dịch 1 batch (đa luồng) + lưu kết quả
  flush_batch             : đẩy batch hiện tại vào queue dịch song song
  finalize_session        : chờ các luồng, merge chương split, lưu stats

Kèm các helper IO của pipeline (save_raw_parts, merge_translated_parts...)
được move nguyên vẹn từ main.py — main.py re-export để tương thích ngược.
"""

import os
import re
import sys
import json
import asyncio
import logging
import threading
from datetime import datetime

from config import (
    BATCH_SIZE, BATCH_MAX_CHARS, MAX_CONCURRENT_BATCHES,
    SCRAPE_DELAY_SECONDS,
)
from novel_manager import NovelProfile, load_novel
from chapter_utils import (
    safe_filename,
    is_already_translated,
    is_failed_translation,
    is_split_original,
    get_split_part_count,
    split_chapter_content,
    extract_chapter_number_from_text,
    CHAPTER_SPLIT_THRESHOLD,
)


# ── Thread-safe profile updates ───────────────────────────────────────────────

_novel_profile_lock = threading.Lock()


def update_profile_glossary_safely(slug: str, new_terms: dict, logger=None) -> tuple[int, dict]:
    """Cập nhật glossary vào novel.json một cách thread-safe."""
    with _novel_profile_lock:
        profile = load_novel(slug)
        added = 0
        for k, v in new_terms.items():
            if k not in profile.glossary:
                profile.glossary[k] = v
                added += 1
        if added > 0:
            if logger:
                logger.info(f"[*] Thread-safe auto-learned {added} new glossary term(s)")
            profile.save()
        return added, profile.glossary


def update_profile_progress_safely(slug: str, chapter_url: str, chapter_number: int):
    """Cập nhật tiến độ vào novel.json một cách thread-safe."""
    with _novel_profile_lock:
        profile = load_novel(slug)
        if chapter_number > profile.last_chapter_number:
            profile.last_translated_url = chapter_url
            profile.last_chapter_number = chapter_number
            profile.save()


# ── Path helpers ──────────────────────────────────────────────────────────────

def get_output_path(profile: NovelProfile, title: str) -> str:
    os.makedirs(profile.translated_dir, exist_ok=True)
    return os.path.join(profile.translated_dir, f"{safe_filename(title)}_VI.md")


def get_vietnamese_translated_path(profile: NovelProfile, stem: str, chap_num: int, part_num: int = None) -> str:
    """Trả về đường dẫn file dịch tiếng Việt nếu đã tồn tại, ngược lại trả về mặc định."""
    if chap_num > 0:
        prefix = f"Chương {chap_num} "
        suffix = f"-{part_num}_VI.md" if part_num is not None else "_VI.md"
        if os.path.isdir(profile.translated_dir):
            for f in os.listdir(profile.translated_dir):
                if f.startswith(prefix) and f.endswith(suffix):
                    return os.path.join(profile.translated_dir, f)
    # Fallback mặc định
    if part_num is not None:
        return os.path.join(profile.translated_dir, f"{safe_filename(stem)}-{part_num}_VI.md")
    return os.path.join(profile.translated_dir, f"{safe_filename(stem)}_VI.md")


# ── Crawl helpers ─────────────────────────────────────────────────────────────

async def fetch_and_merge_paginated_chapter_async(scraper, url: str, logger) -> tuple[str, str, str | None, str | None] | None:
    """Cào và tự động ghép các trang của chương nếu có phân trang (1/2), (2/2)..."""
    html = await scraper.fetch_html(url)
    if not html:
        return None

    title, content, prev_url, next_url = scraper.parse_content(html, url)
    if not content:
        return title, content, prev_url, next_url

    # Check for pagination (e.g. "第...章 ... (1/2)")
    import re as _re_page
    m_page = _re_page.search(r'[\(\（]\s*1\s*/\s*(\d+)\s*[\)\）]', title)
    if m_page:
        total_pages = int(m_page.group(1))
        current_page = 1

        def get_page_url(base_url: str, page_num: int) -> str:
            if re.search(r'_\d+_\d+\.html$', base_url):
                return re.sub(r'_(\d+)\.html$', f'_{page_num}.html', base_url)
            else:
                return re.sub(r'\.html$', f'_{page_num}.html', base_url)

        # If next_url is None, generate it for page 2
        current_url = next_url if next_url else get_page_url(url, 2)

        logger.info(f"[*] Phát hiện chương phân trang (1/{total_pages}), đang cào các trang tiếp theo...")

        while current_page < total_pages and current_url:
            logger.info(f"[*] Crawling page {current_page + 1}/{total_pages}: {current_url}")
            next_html = await scraper.fetch_html(current_url)
            if not next_html:
                logger.error(f"[!] Lỗi cào trang {current_page + 1} từ: {current_url}")
                break
            next_title, next_content, _, next_url = scraper.parse_content(next_html, current_url)
            if next_content and "Could not find" not in next_content:
                content += "\n\n" + next_content
            current_page += 1

            # Construct next URL if missing but we need more pages
            if not next_url and current_page < total_pages:
                current_url = get_page_url(url, current_page + 1)
            else:
                current_url = next_url

    # Clean pagination suffix from title if present (e.g., "(1/2)")
    clean_title = _re_page.sub(r'\s*[\(\（]\s*\d+\s*/\s*\d+\s*[\)\）]\s*$', '', title).strip()
    return clean_title, content, prev_url, next_url


def validate_raw_content(content: str, title: str, logger):
    """Kiểm tra tự động để phát hiện các dấu hiệu bất thường của text thô (mất thoại, quá ngắn)."""
    if not content:
        return

    # 1. Kiểm tra độ dài chương
    raw_len = len(content.strip())
    if raw_len < 1000:
        logger.warning(f"  [⚠️ WARNING] Chương '{title}' có độ dài cực ngắn ({raw_len:,} ký tự chữ Hán)!")

    # 2. Kiểm tra mất thoại
    import re as _re_check
    lines = content.splitlines()
    missing_dialogues = []
    for idx, line in enumerate(lines):
        line = line.strip()
        # Nếu dòng kết thúc bằng động từ chỉ thoại + dấu hai chấm
        if _re_check.search(r'(?:道|说|笑|哭|喊|叫|喝|啐|问|应|答)[\s：:]*$', line):
            next_idx = idx + 1
            while next_idx < len(lines) and not _check_line_empty(lines[next_idx]):
                next_idx += 1
            if next_idx < len(lines):
                next_line = lines[next_idx].strip()
                # Nếu dòng tiếp theo không bắt đầu bằng ngoặc kép/gạch đầu dòng và không có ngoặc kép
                if not next_line.startswith(('“', '"', '「', '—', '-')) and '“' not in next_line and '「' not in next_line:
                    missing_dialogues.append((idx + 1, line, next_line))
            else:
                missing_dialogues.append((idx + 1, line, "[Hết chương]"))

    if missing_dialogues:
        logger.warning(f"  [⚠️ WARNING] Phát hiện nghi ngờ bị MẤT THOẠI ở chương '{title}'!")
        for idx, l, nl in missing_dialogues[:3]:
            logger.warning(f"    → Dòng {idx}: '{l}' | Dòng tiếp theo: '{nl[:40]}...'")
        if len(missing_dialogues) > 3:
            logger.warning(f"    → và {len(missing_dialogues) - 3} cảnh báo tương tự khác.")

def _check_line_empty(line: str) -> bool:
    return bool(line.strip())


# ── Raw save / split / merge ──────────────────────────────────────────────────

def save_raw_parts(profile: NovelProfile, title: str, content: str) -> list[tuple[str, str]]:
    """
    Lưu raw content. Nếu content > CHAPTER_SPLIT_THRESHOLD:
      - Lưu file gốc (title.txt) để tham khảo
      - Lưu các phần nhỏ: title-1.txt, title-2.txt, ...
      - Trả về list [(part_title, part_content)] để đưa vào pipeline dịch

    Nếu content <= threshold:
      - Lưu bình thường (title.txt)
      - Trả về [(title, content)]
    """
    os.makedirs(profile.raw_dir, exist_ok=True)

    # Sanitize title to prevent directory traversal / file creation errors due to slashes
    title = title.replace("/", "-").replace("\\", "-")

    if len(content) <= CHAPTER_SPLIT_THRESHOLD:
        # Dùng title trực tiếp (giữ ký tự Unicode) — nhất quán với tên file thực tế
        raw_path = os.path.join(profile.raw_dir, f"{title}.txt")
        if not os.path.exists(raw_path):
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(content)
        return [(title, content)]

    # Chương lớn → split
    parts = split_chapter_content(content)

    # Lưu file gốc (để tham khảo, không dịch trực tiếp)
    orig_path = os.path.join(profile.raw_dir, f"{title}.txt")
    if not os.path.exists(orig_path):
        with open(orig_path, "w", encoding="utf-8") as f:
            f.write(content)

    result = []
    for i, part_content in enumerate(parts, start=1):
        # Dùng title gốc trực tiếp — nhất quán với merge_translated_parts
        part_title = f"{title}-{i}"   # VD: "第1033章 xxx-1"
        part_path  = os.path.join(profile.raw_dir, f"{part_title}.txt")
        if not os.path.exists(part_path):
            with open(part_path, "w", encoding="utf-8") as f:
                f.write(part_content)
        result.append((part_title, part_content))

    return result


def save_raw(profile: NovelProfile, title: str, content: str):
    """Legacy wrapper — dùng save_raw_parts nội bộ."""
    save_raw_parts(profile, title, content)


def merge_translated_parts(profile: NovelProfile, original_title: str, num_parts: int) -> bool:
    """
    Sau khi dịch xong tất cả phần, ghép lại thành 1 file output duy nhất.
    VD: stem-1_VI.md + stem-2_VI.md → stem_VI.md

    Hỗ trợ tìm kiếm file tiếng Việt (Chương {chap_num} - {vi_title}-{part_num}_VI.md)
    bằng cách tra cứu catalog.
    Returns True nếu ghép thành công.
    """
    # 1. Tra cứu chapter number trong catalog
    chap_num = None
    try:
        catalog_path = os.path.join("novels", profile.slug, "catalog.json")
        if os.path.exists(catalog_path):
            with open(catalog_path, "r", encoding="utf-8") as f:
                catalog = json.load(f)
            for item in catalog:
                if item.get("title") == original_title or item.get("original_title") == original_title:
                    chap_num = item.get("number")
                    break
    except Exception:
        pass

    # 2. Tìm kiếm đường dẫn các file phần dịch
    parts_paths = []
    for i in range(1, num_parts + 1):
        found_path = None
        if chap_num is not None:
            if os.path.isdir(profile.translated_dir):
                for f in os.listdir(profile.translated_dir):
                    if f.lower().startswith(f"chương {chap_num} "):
                        if re.search(rf"-{i}_vi\.md$", f, re.IGNORECASE):
                            found_path = os.path.join(profile.translated_dir, f)
                            break
        if not found_path:
            part_stem = f"{original_title}-{i}"
            part_path = os.path.join(profile.translated_dir, f"{part_stem}_VI.md")
            if os.path.exists(part_path):
                found_path = part_path

        if not found_path or os.path.getsize(found_path) == 0:
            return False  # Chưa đủ phần hoặc file trống
        parts_paths.append(found_path)

    # 3. Đọc nội dung các phần
    parts_content = []
    for p_path in parts_paths:
        try:
            with open(p_path, "r", encoding="utf-8") as f:
                part_text = f.read().strip()
            if "[Translation failed" in part_text[:100]:
                return False  # Có phần lỗi
            parts_content.append(part_text)
        except Exception:
            return False

    if not parts_content:
        return False

    # 4. Trích xuất tiêu đề tiếng Việt sạch từ phần 1
    vi_title = ""
    first_line = parts_content[0].splitlines()[0].strip() if parts_content[0] else ""
    if first_line.startswith("#"):
        header_title = first_line.lstrip("#").strip()
        vi_title = re.sub(r"^(Chương\s+\d+|第[一二三四五六七八九十\d\s]+章)\s*[:：\-]*\s*", "", header_title, flags=re.IGNORECASE).strip()

    if not vi_title:
        vi_title = original_title

    # 5. Ghép nội dung
    merged_parts = []
    for idx, text in enumerate(parts_content):
        if idx == 0:
            merged_parts.append(text)
        else:
            lines = text.splitlines()
            start = 0
            while start < len(lines) and lines[start].strip().startswith('#'):
                start += 1
            merged_parts.append('\n'.join(lines[start:]).strip())

    final_text = '\n\n'.join(p for p in merged_parts if p)

    # 6. Xác định đường dẫn file đầu ra
    if chap_num is not None:
        final_out = os.path.join(profile.translated_dir, f"Chương {chap_num} - {safe_filename(vi_title)}_VI.md")
    else:
        final_out = os.path.join(profile.translated_dir, f"{safe_filename(vi_title)}_VI.md")

    with open(final_out, "w", encoding="utf-8") as f:
        f.write(final_text + "\n")

    # 7. Xóa các file phần tạm
    for p_path in parts_paths:
        try:
            os.remove(p_path)
        except Exception:
            pass

    return True


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


# ── Scan raw chưa dịch (dùng cho retranslate) ─────────────────────────────────

def find_untranslated_raws(profile: NovelProfile) -> list[tuple[str, str]]:
    """
    Scan text_raw/ và trả về list các file chưa có bản dịch tốt.
    Trả về: list of (raw_filepath, expected_output_filepath)
    Bao gồm cả file chưa dịch lẫn file dịch bị lỗi (Translation failed).
    """
    if not os.path.isdir(profile.raw_dir):
        return []

    # Load catalog mapping
    catalog_map = {}
    catalog_path = os.path.join("novels", profile.slug, "catalog.json")
    if os.path.exists(catalog_path):
        try:
            with open(catalog_path, "r", encoding="utf-8") as f:
                cat = json.load(f)
                for item in cat:
                    orig_t = item.get("original_title") or item.get("title") or ""
                    catalog_map[orig_t] = item
        except Exception as e:
            print("CATALOG LOAD ERROR:", e)

    raw_files = sorted(
        f for f in os.listdir(profile.raw_dir) if f.endswith(".txt")
    )

    pending = []
    for raw_name in raw_files:
        raw_path = os.path.join(profile.raw_dir, raw_name)
        stem     = os.path.splitext(raw_name)[0]

        # Lấy chapter number từ catalog
        cat_item = catalog_map.get(stem)
        chap_num = cat_item["number"] if cat_item else 0
        if not chap_num:
            try:
                chap_num = extract_chapter_number_from_text(stem)
            except Exception:
                pass
        if chap_num == 999999:
            chap_num = 0

        out_path = get_vietnamese_translated_path(profile, stem, chap_num)

        # ── Trường hợp file gốc đã split ──────────────────────────────────
        if is_split_original(profile.raw_dir, stem):
            # Nếu đã có file merge (stem_VI.md hoặc bản dịch tiếng Việt tương ứng) → coi là hoàn tất
            if is_already_translated(out_path) and not is_failed_translation(out_path):
                continue

            # Chưa có merge file → kiểm tra tất cả phần đã dịch chưa
            num_parts = get_split_part_count(profile.raw_dir, stem)
            all_parts_done = all(
                is_already_translated(
                    get_vietnamese_translated_path(profile, stem, chap_num, i)
                ) and not is_failed_translation(
                    get_vietnamese_translated_path(profile, stem, chap_num, i)
                )
                for i in range(1, num_parts + 1)
            )

            if all_parts_done:
                # Tất cả phần dịch xong nhưng chưa merge → merge ngay
                ok = merge_translated_parts(profile, stem, num_parts)
                if ok:
                    print(f"[*] Auto-merge: '{stem}' ({num_parts} phần → 1 file)")
                    continue
                # Merge thất bại → vẫn skip (không dịch lại file gốc khổng lồ)
                continue
            else:
                # Một số phần chưa dịch → bỏ qua file GỐC,
                # để các file PHẦN (-1, -2...) tự được xử lý bên dưới
                continue

        # ── Trường hợp file phần (stem-N) ────────────────────────────────
        # Bỏ qua nếu không có _VI.md nhưng đây là phần của chapter đã merge
        part_match = re.match(r'^(.+)-(\d+)$', stem)
        if part_match:
            orig_stem = part_match.group(1)
            orig_cat = catalog_map.get(orig_stem)
            orig_chap_num = orig_cat["number"] if orig_cat else 0
            if not orig_chap_num:
                try:
                    orig_chap_num = extract_chapter_number_from_text(orig_stem)
                except Exception:
                    pass
            if orig_chap_num == 999999:
                orig_chap_num = 0

            orig_vi = get_vietnamese_translated_path(profile, orig_stem, orig_chap_num)
            if is_already_translated(orig_vi) and not is_failed_translation(orig_vi):
                # File gốc đã được merge → không cần dịch lại phần này nữa
                continue

        # ── Trường hợp thông thường ───────────────────────────────────────
        if not is_already_translated(out_path) or is_failed_translation(out_path):
            pending.append((raw_path, out_path))

    return pending


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


# ══════════════════════════════════════════════════════════════════════════════
# TranslationContext + các phase của cmd_translate_async
# ══════════════════════════════════════════════════════════════════════════════

class TranslationContext:
    """
    Trạng thái dùng chung giữa các phase của 1 phiên dịch.
    Thay thế cho các biến local + nonlocal trong cmd_translate_async cũ.
    """

    def __init__(self, args, profile: NovelProfile, logger: logging.Logger,
                 translator, report_progress, is_cancelled):
        self.args      = args
        self.profile   = profile
        self.logger    = logger
        self.translator = translator
        self.report_progress = report_progress
        self.is_cancelled    = is_cancelled
        self.scraper   = None

        # Vị trí bắt đầu / catalog
        self.start_url        = None
        self.catalog          = []
        self.catalog_active   = False
        self.current_idx      = -1
        self.current_url      = None
        self.resume_from_next = False
        self.url_to_catalog_item: dict = {}

        # Bộ đếm & batch state
        self.previous_summary = ""
        self.chapter_count    = 0      # số chương đã fetch
        self.translated_count = 0      # số chương gốc đã dịch xong (không đếm từng phần split)
        self.batch: list[tuple[str, str]] = []
        self.batch_urls: list[str] = []
        self.batch_orig_count = 0      # số chương gốc trong batch hiện tại
        self.background_tasks: set = set()
        self.pending_merges: dict[str, int] = {}  # {original_title: num_parts}

        self.session_usage = {
            "total_tokens":  0,
            "input_tokens":  0,
            "output_tokens": 0,
            "cost_usd":      0.0,
            "models":        set(),
            "chapters_saved": [],
            "errors":        [],
        }


# ── Phase: xác định vị trí bắt đầu ────────────────────────────────────────────

def resolve_start_url(profile: NovelProfile, args, logger) -> str | None:
    """Xác định URL bắt đầu: ưu tiên --url > chương đã dịch cuối > URL ban đầu."""
    start_url = args.url or profile.last_translated_url or profile.source_url
    if not start_url:
        logger.error(
            "[!] Không có URL để bắt đầu. "
            f"Thêm source_url vào novels/{profile.slug}/novel.json "
            "hoặc dùng --url <URL>"
        )
        return None
    return start_url


def init_catalog(ctx: TranslationContext, start_url: str):
    """Load catalog.json (nếu có) và xác định index/URL để bắt đầu (resume)."""
    args, profile, logger = ctx.args, ctx.profile, ctx.logger
    ctx.start_url = start_url

    # Nếu đã dịch rồi và không dùng --url thì tự động đi đến chương TIẾP THEO
    # (tránh dịch lại chương cuối cùng)
    ctx.resume_from_next = bool(profile.last_translated_url and not args.url)

    catalog_path = os.path.join("novels", profile.slug, "catalog.json")
    catalog = []
    catalog_active = False
    if os.path.exists(catalog_path):
        try:
            with open(catalog_path, "r", encoding="utf-8") as f:
                catalog = json.load(f)
            if catalog:
                catalog_active = True
                logger.info(f"[*] Loaded catalog from catalog.json: {len(catalog)} chapter(s)")
        except Exception as e:
            logger.error(f"[!] Error loading catalog.json: {e}")

    current_idx = -1
    current_url = None
    if catalog_active:
        if args.url:
            for idx, item in enumerate(catalog):
                if item["url"] == args.url:
                    current_idx = idx
                    current_url = args.url
                    logger.info(f"[*] Found target URL in catalog at index {current_idx}: {current_url}")
                    break
            if current_idx == -1:
                logger.warning(f"[!] Target URL {args.url} not found in catalog. Falling back to dynamic scraping mode.")
                catalog_active = False
                current_url = start_url
        else:
            if profile.last_translated_url:
                for idx, item in enumerate(catalog):
                    if item["url"] == profile.last_translated_url:
                        current_idx = idx
                        break
                if current_idx != -1:
                    current_idx += 1
                    if current_idx < len(catalog):
                        current_url = catalog[current_idx]["url"]
                        logger.info(f"[*] Resuming from next catalog chapter at index {current_idx}: {current_url}")
                    else:
                        current_url = None
                        logger.info("[*] Catalog index out of range (all chapters translated).")
                    ctx.resume_from_next = False
                else:
                    if 0 <= profile.last_chapter_number < len(catalog):
                        current_idx = profile.last_chapter_number
                        current_url = catalog[current_idx]["url"]
                        logger.info(f"[*] Map to catalog index {current_idx} using last_chapter_number={profile.last_chapter_number}")
                    else:
                        current_idx = 0
                        current_url = catalog[0]["url"]
                        logger.info(f"[*] Fallback to catalog index 0")
                    ctx.resume_from_next = False
            else:
                current_idx = 0
                current_url = catalog[0]["url"]
                logger.info(f"[*] Starting from catalog index 0: {current_url}")
                ctx.resume_from_next = False
    else:
        current_url = start_url

    ctx.catalog        = catalog
    ctx.catalog_active = catalog_active
    ctx.current_idx    = current_idx
    ctx.current_url    = current_url


def resolve_chapter_budget(ctx: TranslationContext):
    """Nếu chapters <= 0 → dịch toàn bộ phần còn lại (theo catalog hoặc tới hết link)."""
    args, logger = ctx.args, ctx.logger
    if args.chapters <= 0:
        if ctx.catalog_active:
            args.chapters = max(1, len(ctx.catalog) - (ctx.current_idx if ctx.current_idx != -1 else 0))
            logger.info(f"[*] Auto translate: translating all remaining {args.chapters} chapters from catalog.")
        else:
            args.chapters = 999999  # dịch cho tới khi hết link
            logger.info("[*] Auto translate: translating all chapters until no next link is found.")


def prepare_session(ctx: TranslationContext, scraper_factory):
    """Log thông tin phiên, khởi tạo scraper và build map url→catalog item."""
    args, profile, logger = ctx.args, ctx.profile, ctx.logger

    logger.info(f"[*] Novel: {profile.title} ({profile.slug})")
    logger.info(f"[*] Start URL: {ctx.current_url or ctx.start_url}")
    logger.info(f"[*] Chapters to translate: {args.chapters}")
    ctx.report_progress(0, args.chapters, "running",
                        f"Bắt đầu dịch {args.chapters} chương từ {ctx.current_url or ctx.start_url}")

    ctx.scraper = scraper_factory()

    logger.info(f"[*] Batch config: max {BATCH_SIZE} chapters/batch, max {BATCH_MAX_CHARS} chars/batch")
    logger.info(f"[*] Concurrency limit: {MAX_CONCURRENT_BATCHES} parallel batches")

    # Build url→catalog item map for fast chapter-number lookup (AR flow)
    ctx.url_to_catalog_item = {}
    if ctx.catalog_active:
        for _ci in ctx.catalog:
            ctx.url_to_catalog_item[_ci["url"]] = _ci


# ── Phase: dịch batch + lưu kết quả ───────────────────────────────────────────

async def _translate_batch_call(ctx: TranslationContext, batch_copy, summary_copy,
                                batch_id, batch_titles):
    """Gọi translator.translate_batch trong thread riêng, ghi nhận usage + progress."""
    args, logger = ctx.args, ctx.logger
    batch_len = len(batch_copy)

    logger.info(f"[*] Translating batch of {batch_len} chapters (Background)...")
    ctx.report_progress(
        ctx.translated_count, args.chapters, "running",
        f"Đang dịch {batch_len} chương (đa luồng)...",
        current_chapter=batch_titles[0] if batch_titles else "",
        batch_detail={"id": batch_id, "chapters": batch_titles, "status": "translating", "model": "...", "tokens": 0},
    )

    translated_chapters, summary, new_glossary, batch_usage = await asyncio.to_thread(
        ctx.translator.translate_batch,
        chapters=batch_copy,
        glossary=ctx.profile.glossary,
        translation_style=ctx.profile.translation_style,
        previous_summary=summary_copy,
        max_retries=3
    )

    ctx.session_usage["total_tokens"]  += batch_usage.get("total_tokens", 0)
    ctx.session_usage["input_tokens"]  += batch_usage.get("input_tokens", 0)
    ctx.session_usage["output_tokens"] += batch_usage.get("output_tokens", 0)
    ctx.session_usage["cost_usd"]      += batch_usage.get("cost_usd", 0.0)
    _m   = batch_usage.get("model", "unknown")
    _tok = batch_usage.get("total_tokens", 0)
    _bc  = batch_usage.get("cost_usd", 0.0)
    if _m and _m != "unknown":
        ctx.session_usage["models"].add(_m)
    _bc_str = "free" if _bc == 0 else f"${_bc:.5f}"
    logger.info(
        f"[💰] {_m}: batch {batch_len}ch "
        f"~{batch_usage.get('input_tokens',0)}→{batch_usage.get('output_tokens',0)} tokens "
        f"{_bc_str}"
    )
    # Emit token + cost + model ngay sau khi batch xong
    ctx.report_progress(ctx.translated_count, args.chapters, "running",
                        current_model=_m,
                        tokens_delta=_tok,
                        cost_delta=_bc,
                        batch_detail={"id": batch_id, "chapters": batch_titles,
                                      "status": "saving", "model": _m, "tokens": _tok, "cost": _bc})
    return translated_chapters, summary, new_glossary, _m


async def _retry_single_chunk(ctx: TranslationContext, idx: int, title, content, summary_copy):
    """Chunk thiếu/bị cắt trong batch → dịch lại riêng lẻ bằng translate_chapter."""
    args, logger = ctx.args, ctx.logger
    logger.warning(f"  [!] Chunk {idx} thiếu/bị cắt — retry riêng lẻ: {title}")
    ctx.report_progress(ctx.translated_count, args.chapters, "running",
                        f"Retry riêng lẻ: {title}",
                        current_chapter=title)
    chunk, _, _ru = await asyncio.to_thread(
        ctx.translator.translate_chapter,
        title=title,
        content=content,
        glossary=ctx.profile.glossary,
        translation_style=ctx.profile.translation_style,
        previous_summary=summary_copy,
        max_retries=3,
    )
    _rm = _ru.get("model", "unknown")
    _rt = _ru.get("total_tokens", 0)
    _rc = _ru.get("cost_usd", 0.0)
    ctx.session_usage["total_tokens"]  += _rt
    ctx.session_usage["input_tokens"]  += _ru.get("input_tokens", 0)
    ctx.session_usage["output_tokens"] += _ru.get("output_tokens", 0)
    ctx.session_usage["cost_usd"]      += _rc
    if _rm != "unknown":
        ctx.session_usage["models"].add(_rm)
    ctx.report_progress(ctx.translated_count, args.chapters, "running",
                        current_model=_rm, tokens_delta=_rt, cost_delta=_rc)
    logger.info(f"  [{'✓' if '[Translation failed' not in chunk[:50] else '!'}] Retry result: {title}")
    return chunk, _rm


def _write_chapter_file(ctx: TranslationContext, title: str, chunk: str,
                        chap_url: str, model_used: str):
    """
    Ghi 1 chương đã dịch xuống file:
    - Header "# Chương N: <VI title>" (số chương lấy từ catalog nếu có)
    - Tên file tiếng Việt (Chương N - <VI title>_VI.md), giữ hậu tố -N cho split part.
    """
    profile, logger = ctx.profile, ctx.logger

    # Đảm bảo translated_dir tồn tại (giữ side-effect của get_output_path cũ)
    os.makedirs(profile.translated_dir, exist_ok=True)

    # ── Header: lấy chapter_number từ catalog (AR flow) + VI title từ chunk ──
    _chunk_lines = chunk.splitlines(keepends=True)
    _vi_title = title  # fallback
    _body_lines = _chunk_lines
    if _chunk_lines:
        _first = _chunk_lines[0].strip()
        _hm = re.match(r"^#\s*(.+)$", _first, re.IGNORECASE)
        if _hm:
            _vi_title = _hm.group(1).strip()
            _body_lines = _chunk_lines[1:]

    # Clean double prefixes in title
    _vi_title = re.sub(r"^(Chương\s+[\w\d]+|第[一二三四五六七八九十\d\s]+章)\s*[:：\-]*\s*", "", _vi_title, flags=re.IGNORECASE).strip()

    _cat_item = ctx.url_to_catalog_item.get(chap_url)
    _chap_num = _cat_item["number"] if _cat_item else 0
    _clean_hdr = f"# Chương {_chap_num}: {_vi_title}\n" if _chap_num else f"# {_vi_title}\n"

    # Redefine out path to be Vietnamese filename instead of Chinese
    part_match = re.match(r'^(.+)-(\d+)$', title)
    _file_stem = f"Chương {_chap_num} - {_vi_title}" if _chap_num else _vi_title
    if part_match:
        part_n = int(part_match.group(2))
        out = os.path.join(profile.translated_dir, f"{safe_filename(_file_stem)}-{part_n}_VI.md")
    else:
        out = os.path.join(profile.translated_dir, f"{safe_filename(_file_stem)}_VI.md")

    with open(out, "w", encoding="utf-8") as f:
        f.write(_clean_hdr + "".join(_body_lines) + f"\n\n*(Bản dịch được thực hiện bởi model: {model_used})*\n")
    logger.info(f"[+] Saved: {out}")


_failed_chapters_lock = threading.Lock()


def _record_failed_chapter(slug: str, url: str, title: str, error: str):
    """
    Ghi 1 chương dịch thất bại vào novels/<slug>/failed_chapters.json
    (list các {url, title, error, ts}) để tools/retry_failed.py dịch lại sau.
    Không bao giờ raise — lỗi ghi file không được phá phiên dịch.
    """
    path = os.path.join("novels", slug, "failed_chapters.json")
    try:
        with _failed_chapters_lock:
            entries = []
            if os.path.isfile(path):
                try:
                    with open(path, encoding="utf-8") as f:
                        entries = json.load(f)
                    if not isinstance(entries, list):
                        entries = []
                except Exception:
                    entries = []
            ts = datetime.now().isoformat(timespec="seconds")
            for e in entries:
                if isinstance(e, dict) and e.get("url") == url and e.get("title") == title:
                    e["error"], e["ts"] = str(error)[:300], ts  # cập nhật entry cũ
                    break
            else:
                entries.append({"url": url, "title": title,
                                "error": str(error)[:300], "ts": ts})
            with open(path, "w", encoding="utf-8") as f:
                json.dump(entries, f, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001 — best-effort, không phá flow dịch
        pass


def _tally_chapter_result(ctx: TranslationContext, title: str, chunk: str):
    """Cập nhật translated_count + progress + session_usage cho 1 chương/phần."""
    args = ctx.args
    failed = "[Translation failed" in chunk[:100]
    # Lấy tên chương gốc (bỏ phần "-N" cuối nếu là split part)
    orig_title_match = re.match(r'^(.+)-(\d+)$', title)
    is_split_part = bool(orig_title_match)
    orig_title = orig_title_match.group(1) if orig_title_match else title

    if failed:
        ctx.session_usage["errors"].append(f"Dịch thất bại: {title}")
        # Với split part, chỉ tính là xong 1 chương khi đến part cuối
        if is_split_part:
            part_n   = int(orig_title_match.group(2))
            n_total  = ctx.pending_merges.get(orig_title, 1)
            if part_n == n_total:
                ctx.translated_count += 1
                ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                    f"❌ Thất bại: {orig_title} ({n_total} phần)",
                                    chapter_fail=orig_title)
            else:
                ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                    f"❌ Part {part_n}/{n_total} lỗi: {title}")
        else:
            ctx.translated_count += 1
            ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                f"❌ Thất bại: {title}", chapter_fail=title)
    else:
        ctx.session_usage["chapters_saved"].append(title)
        # Emit chapter_ok: nếu là split part chỉ emit khi là phần cuối
        if is_split_part:
            part_n   = int(orig_title_match.group(2))
            n_total  = ctx.pending_merges.get(orig_title, 1)
            if part_n == n_total:  # là phần cuối
                ctx.translated_count += 1
                ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                    f"✓ Đã dịch xong '{orig_title}' ({n_total} phần)",
                                    chapter_ok=orig_title)
            else:
                # Vẫn gửi progress nhưng không tăng translated_count
                ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                    f"✓ Part {part_n}/{n_total}: {title}")
        else:
            ctx.translated_count += 1
            ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                f"✓ Đã lưu: {title}", chapter_ok=title)


def _finish_batch(ctx: TranslationContext, batch_copy, urls_copy, new_glossary, summary):
    """Sau khi lưu hết batch: cập nhật glossary + tiến độ profile + summary chuyền tiếp."""
    args, profile = ctx.args, ctx.profile
    batch_len = len(batch_copy)

    # Batch finished, ensure final count is sent (redundant but safe)
    ctx.report_progress(ctx.translated_count, args.chapters, "running",
                        current_chapter=batch_copy[-1][0] if batch_copy else "")

    # Auto-update glossary with newly extracted terms
    if new_glossary:
        added, latest_glossary = update_profile_glossary_safely(profile.slug, new_glossary, ctx.logger)
        profile.glossary = latest_glossary

    if urls_copy:
        if ctx.catalog_active:
            ch_num = profile.last_chapter_number
            for idx, item in enumerate(ctx.catalog):
                if item["url"] == urls_copy[-1]:
                    ch_num = item["number"]
                    break
            update_profile_progress_safely(profile.slug, urls_copy[-1], ch_num)
        else:
            update_profile_progress_safely(profile.slug, urls_copy[-1], profile.last_chapter_number + batch_len)

    ctx.previous_summary = summary
    # Update active_batches count after this batch completes
    ctx.report_progress(ctx.translated_count, args.chapters, "running",
                        active_batches=max(0, len(ctx.background_tasks) - 1),
                        scraped_count=ctx.chapter_count)


async def process_batch_async(ctx: TranslationContext, batch_copy, urls_copy,
                              summary_copy, orig_chapter_count=None):
    """Dịch 1 batch (chạy song song) rồi lưu từng chương + cập nhật tiến độ."""
    if not batch_copy:
        return

    # orig_chapter_count: số chương gốc thực sự trong batch này
    # (khác với len(batch_copy) vì split chương tạo ra nhiều phần)
    if orig_chapter_count is None:
        orig_chapter_count = len(batch_copy)  # fallback: assume không có split

    batch_id     = id(batch_copy)   # unique id cho batch này
    batch_titles = [t for t, _ in batch_copy]

    translated_chapters, summary, new_glossary, _m = await _translate_batch_call(
        ctx, batch_copy, summary_copy, batch_id, batch_titles
    )

    for i, (title, content) in enumerate(batch_copy):
        chunk = translated_chapters[i] if i < len(translated_chapters) else None
        _model_used = _m

        # Nếu chunk là None (thiếu/bị cắt) → retry riêng lẻ bằng translate_chapter
        if chunk is None:
            chunk, _model_used = await _retry_single_chunk(ctx, i, title, content, summary_copy)

        _chap_url = urls_copy[i] if i < len(urls_copy) else ""
        # Chương dịch thất bại (kể cả sau retry riêng lẻ) → ghi vào
        # failed_chapters.json để tools/retry_failed.py xử lý lại (roadmap 2.5)
        if "[Translation failed" in (chunk or "")[:100]:
            _record_failed_chapter(ctx.profile.slug, _chap_url, title,
                                   (chunk or "").strip()[:300])
        _write_chapter_file(ctx, title, chunk, _chap_url, _model_used)
        _tally_chapter_result(ctx, title, chunk)

    _finish_batch(ctx, batch_copy, urls_copy, new_glossary, summary)


async def flush_batch(ctx: TranslationContext):
    """Đẩy batch hiện tại vào queue dịch song song (giới hạn MAX_CONCURRENT_BATCHES)."""
    if not ctx.batch:
        return
    # Giới hạn số lượng task song song
    while len(ctx.background_tasks) >= MAX_CONCURRENT_BATCHES:
        done, pending = await asyncio.wait(ctx.background_tasks, return_when=asyncio.FIRST_COMPLETED)
        ctx.background_tasks.intersection_update(pending)

    task = asyncio.create_task(
        process_batch_async(ctx, list(ctx.batch), list(ctx.batch_urls),
                            ctx.previous_summary, orig_chapter_count=ctx.batch_orig_count)
    )
    ctx.background_tasks.add(task)
    ctx.batch.clear()
    ctx.batch_urls.clear()
    ctx.batch_orig_count = 0  # reset bộ đếm
    ctx.report_progress(ctx.translated_count, ctx.args.chapters, "running",
                        active_batches=len(ctx.background_tasks),
                        scraped_count=ctx.chapter_count)


# ── Phase: chuẩn bị chương (split) + enqueue vào batch ────────────────────────

def _prepare_work_items(ctx: TranslationContext, title: str, content: str):
    """Lưu raw (auto-split chương lớn) và log/progress nếu bị split."""
    work_items = save_raw_parts(ctx.profile, title, content)
    is_split   = len(work_items) > 1

    if is_split:
        num_parts = len(work_items)
        ctx.logger.info(
            f"[✂] '{title}' quá lớn ({len(content):,} chars > {CHAPTER_SPLIT_THRESHOLD}) "
            f"→ split thành {num_parts} phần"
        )
        ctx.report_progress(ctx.translated_count, ctx.args.chapters, "running",
                            f"✂ Split '{title}' thành {num_parts} phần",
                            crawling_chapter=title)
    return work_items, is_split


async def _enqueue_work_items(ctx: TranslationContext, work_items, url: str,
                              title: str, is_split: bool):
    """Thêm các phần của 1 chương vào batch, flush khi vượt limit chars/size."""
    for part_title, part_content in work_items:
        # Flush batch trước nếu cần
        if compute_batch_size(ctx.batch, part_content) == 0 and ctx.batch:
            total_chars = sum(len(c) for _, c in ctx.batch)
            ctx.logger.info(
                f"[*] Batch flush: {len(ctx.batch)} chapter(s), {total_chars} chars "
                f"(adding '{part_title}' would exceed limit)"
            )
            await flush_batch(ctx)

        ctx.batch.append((part_title, part_content))
        ctx.batch_urls.append(url)

        if len(ctx.batch) >= BATCH_SIZE:
            await flush_batch(ctx)

    # Tăng batch_orig_count đúng 1 lần cho mỗi chương gốc (dù có split hay không)
    ctx.batch_orig_count += 1

    # Nếu đã split, đăng ký merge callback sau khi tất cả phần dịch xong
    if is_split:
        ctx.pending_merges[title] = len(work_items)

    # Flush khi đạt đúng BATCH_SIZE
    if len(ctx.batch) >= BATCH_SIZE:
        await flush_batch(ctx)


# ── Phase: crawl theo catalog ─────────────────────────────────────────────────

async def run_catalog_flow(ctx: TranslationContext):
    """Cào/Chuẩn bị tuần tự theo catalog & dịch song song động."""
    args, profile, logger = ctx.args, ctx.profile, ctx.logger

    logger.info(f"[*] Bắt đầu xử lý {args.chapters} chương từ catalog...")

    # Để tránh nghẽn mạng và quản lý tốt hơn, chúng ta chuẩn bị tuần tự (hoặc batch nhỏ)
    # và đẩy ngay vào batch dịch. Vì crawler giờ có local cache nên việc chuẩn bị rất nhanh.
    for i in range(args.chapters):
        if ctx.is_cancelled():
            logger.info("[⏹] Dừng theo yêu cầu người dùng.")
            ctx.report_progress(ctx.translated_count, args.chapters, "cancelled", "⏹ Đã dừng theo yêu cầu")
            break

        idx = ctx.current_idx + i
        if idx >= len(ctx.catalog):
            logger.info("[*] Catalog index out of range (reached end of catalog).")
            break

        item = ctx.catalog[idx]
        url = item["url"]
        chap_num = item.get("number")
        title_base = item.get("original_title") or item.get("title") or f"Chương {chap_num if chap_num is not None else idx}"
        title_orig = f"Chương {chap_num} - {title_base}" if chap_num is not None else title_base

        # 1. Đọc local raw trước
        raw_file_name = f"{title_orig}.txt"
        raw_path_check = os.path.join(profile.raw_dir, raw_file_name)

        has_local = False
        title = title_orig
        content = ""

        if os.path.exists(raw_path_check):
            try:
                with open(raw_path_check, "r", encoding="utf-8") as f:
                    content = f.read()
                has_local = True
            except Exception as e:
                logger.error(f"[!] Lỗi đọc file raw local {raw_file_name}: {e}")

        # 2. Nếu không có local, tiến hành crawl
        if not has_local:
            logger.info(f"[*] Crawling: {url}")
            ctx.report_progress(ctx.translated_count, args.chapters, "running",
                                log_msg=f"[*] Đang tải: {title_orig}",
                                crawling_chapter=title_orig)
            res = await fetch_and_merge_paginated_chapter_async(ctx.scraper, url, logger)
            if not res:
                logger.error(f"[!] Lỗi cào nội dung từ: {url}")
                ctx.report_progress(ctx.translated_count, args.chapters, "error", f"Lỗi: Không thể lấy nội dung chương {item['number']}")
                break
            title, content, _, _ = res

        if not content or "Could not find" in content:
            logger.error(f"[!] Lỗi phân tích nội dung chương tại {url}")
            ctx.report_progress(ctx.translated_count, args.chapters, "error", f"Lỗi: Nội dung chương {item['number']} bị trống")
            break

        validate_raw_content(content, title, logger)

        source_tag = "[📖 Local]" if has_local else "[🌐 Crawled]"
        logger.info(f"{source_tag} Sẵn sàng: {title}")
        ctx.report_progress(ctx.translated_count, args.chapters, "running", f"Sẵn sàng: {title}",
                            scraped_count=ctx.chapter_count,
                            crawling_chapter=title)

        # ── Auto-split chương lớn + enqueue vào batch ────────────────────────
        work_items, is_split = _prepare_work_items(ctx, title, content)
        ctx.chapter_count += 1
        await _enqueue_work_items(ctx, work_items, url, title, is_split)


# ── Phase: crawl tuần tự truyền thống ─────────────────────────────────────────

async def run_sequential_flow(ctx: TranslationContext):
    """Cào tuần tự theo link 'next chapter' (không có catalog)."""
    args, logger = ctx.args, ctx.logger

    while ctx.current_url and ctx.chapter_count < args.chapters:
        # Check cancel request trước mỗi chương
        if ctx.is_cancelled():
            logger.info("[⏹] Dừng theo yêu cầu người dùng.")
            ctx.report_progress(ctx.translated_count, args.chapters, "cancelled", "⏹ Đã dừng theo yêu cầu")
            break

        logger.info(f"[*] Fetching {ctx.chapter_count + 1}/{args.chapters}: {ctx.current_url}")
        ctx.report_progress(ctx.translated_count, args.chapters, "running",
                            crawling_chapter=f"Chương {ctx.chapter_count + 1}...")

        res = await fetch_and_merge_paginated_chapter_async(ctx.scraper, ctx.current_url, logger)
        if not res:
            logger.error(f"[!] Lỗi cào nội dung từ: {ctx.current_url}")
            ctx.report_progress(ctx.translated_count, args.chapters, "error", f"Lỗi: Không thể lấy nội dung từ {ctx.current_url}")
            break
        title, content, _prev_url, next_url = res

        content_lower = content.lower() if content else ""
        is_block_page = (
            "cloudflare" in content_lower or
            "security check" in content_lower or
            "attention required" in content_lower or
            "captcha" in content_lower or
            "checking your browser" in content_lower
        )
        is_empty_title = not title or title.strip() == "" or title == "Untitled Chapter"

        if not content or len(content.strip()) < 200 or "Could not find" in content or is_block_page or is_empty_title:
            logger.error(f"[!] Could not parse content (error/block page/empty title): {ctx.current_url} | Title: {title} | Content Len: {len(content) if content else 0}")
            ctx.report_progress(ctx.translated_count, args.chapters, "error", f"Lỗi: Không thể phân tích nội dung tại {ctx.current_url}")
            break

        validate_raw_content(content, title, logger)

        logger.info(f"[*] Scraped: {title}")
        ctx.report_progress(ctx.translated_count, args.chapters, "running", f"Đã lấy nội dung: {title}",
                            scraped_count=ctx.chapter_count,
                            crawling_chapter=title)

        if ctx.resume_from_next:
            ctx.resume_from_next = False
            logger.info(f"[→] Resuming — skipping last translated chapter, moving to next.")
            if next_url:
                ctx.current_url = next_url
                # Delay giữa 2 lần fetch — cấu hình qua SCRAPE_DELAY_SECONDS (.env)
                if SCRAPE_DELAY_SECONDS > 0:
                    await asyncio.sleep(SCRAPE_DELAY_SECONDS)
                continue
            else:
                logger.info("[*] No next chapter found after resume point.")
                break

        # ── Auto-split chương lớn + enqueue vào batch ────────────────────────
        work_items, is_split = _prepare_work_items(ctx, title, content)
        ctx.chapter_count += 1
        await _enqueue_work_items(ctx, work_items, ctx.current_url, title, is_split)

        if next_url and ctx.chapter_count < args.chapters:
            logger.info(f"[→] Next chapter: {next_url}")
            ctx.current_url = next_url
            # Delay giữa 2 lần fetch — chỉ sleep khi CÒN chương tiếp theo
            # (điều kiện ở trên đã loại chương cuối cùng của vòng lặp)
            if SCRAPE_DELAY_SECONDS > 0:
                await asyncio.sleep(SCRAPE_DELAY_SECONDS)
        else:
            if not next_url and ctx.chapter_count < args.chapters:
                logger.info("[*] No more chapters found.")
            break


# ── Phase: kết thúc phiên ─────────────────────────────────────────────────────

async def finalize_session(ctx: TranslationContext, session_ts: str, started_at: str):
    """Flush batch còn lại, chờ các luồng dịch, merge chương split, lưu stats."""
    args, profile, logger = ctx.args, ctx.profile, ctx.logger

    # Process remaining in batch
    await flush_batch(ctx)
    if ctx.background_tasks:
        logger.info(f"[*] Chờ {len(ctx.background_tasks)} luồng dịch đang chạy hoàn tất...")
        await asyncio.gather(*ctx.background_tasks)

    # ── Merge các chương đã split ─────────────────────────────────────────────
    if ctx.pending_merges:
        logger.info(f"[*] Ghép {len(ctx.pending_merges)} chương đã split...")
        merged_ok = 0
        for orig_title, num_parts in ctx.pending_merges.items():
            ok = merge_translated_parts(profile, orig_title, num_parts)
            if ok:
                logger.info(f"  [✓] Đã ghép: '{orig_title}' ({num_parts} phần → 1 file)")
                merged_ok += 1
            else:
                logger.warning(f"  [!] Chưa ghép được '{orig_title}' — một số phần chưa dịch xong hoặc lỗi")
        logger.info(f"[*] Ghép xong: {merged_ok}/{len(ctx.pending_merges)} chương")

    await ctx.scraper.close()

    if ctx.is_cancelled():
        logger.info(f"[⏹] Dừng! Đã dịch {ctx.chapter_count} chương trước khi dừng.")
        ctx.report_progress(ctx.translated_count, args.chapters, "cancelled",
                            f"⏹ Đã dừng — {ctx.chapter_count} chương hoàn thành")
    else:
        logger.info(f"[✓] Done! Translated {ctx.chapter_count} chapter(s) for '{profile.title}'.")
        if ctx.chapter_count > 0:
            logger.info(f"[✓] Output: novels/{profile.slug}/translated/")
    _ms = ", ".join(sorted(ctx.session_usage["models"])) or "unknown"
    _cs = f"${ctx.session_usage['cost_usd']:.5f}" if ctx.session_usage["cost_usd"] > 0 else "free"
    logger.info(
        f"[📊] Token summary: {ctx.session_usage['total_tokens']:,} tokens "
        f"(in={ctx.session_usage['input_tokens']:,} out={ctx.session_usage['output_tokens']:,}) "
        f"| models={_ms} | cost={_cs}"
    )
    _save_session_stats(profile.slug, ctx.chapter_count, ctx.session_usage, logger,
                        timestamp=session_ts, started_at=started_at)
    ctx.report_progress(ctx.chapter_count, args.chapters, "finished",
                        f"Hoàn thành dịch {ctx.chapter_count} chương.")

    # ── Đồng bộ Cloudflare tự động (roadmap 1.2) ─────────────────────────────
    # Bật bằng env AUTO_SYNC_CLOUDFLARE=1. Chạy nền, lỗi sync không được làm
    # hỏng phiên dịch — chỉ log warning để check_drift.py bắt lại sau.
    _maybe_auto_sync(profile.slug, ctx.chapter_count, logger)


def _maybe_auto_sync(slug: str, new_chapters: int, logger):
    """Gọi migrate_to_cloudflare.py --slug <slug> nếu AUTO_SYNC_CLOUDFLARE=1
    và phiên vừa dịch được ít nhất 1 chương."""
    import subprocess
    if new_chapters <= 0:
        return
    if os.getenv("AUTO_SYNC_CLOUDFLARE", "0") != "1":
        logger.info("[sync] AUTO_SYNC_CLOUDFLARE tắt — bỏ qua đồng bộ. "
                    "Chạy tay: python3 migrate_to_cloudflare.py --slug %s" % slug)
        return
    logger.info(f"[sync] Đồng bộ '{slug}' lên Cloudflare...")
    try:
        r = subprocess.run(
            [sys.executable, "migrate_to_cloudflare.py", "--slug", slug],
            capture_output=True, text=True, timeout=600,
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        if r.returncode == 0:
            logger.info(f"[sync] ✓ Đồng bộ '{slug}' hoàn tất.")
        else:
            logger.warning(f"[sync] ✗ Sync lỗi (exit {r.returncode}): {r.stderr[-500:]}")
    except Exception as e:  # noqa: BLE001 — sync không được phá phiên dịch
        logger.warning(f"[sync] ✗ Không chạy được migrate_to_cloudflare.py: {e}")
