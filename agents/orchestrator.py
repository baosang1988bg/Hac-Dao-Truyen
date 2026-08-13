"""
agents/orchestrator.py
------------------------
SequentialAgent điều phối scraper_agent → translator_agent (Pass 1) —
Giai đoạn 1 (Foundation) của kế hoạch tích hợp ADK.
Xem plans/adk-agents/README.md và plans/adk-agents/research-notes.md.

── Biến môi trường ──────────────────────────────────────────────────────────
ADK_ENABLED (mặc định: "false" / không set trong .env)
    - "false"/không set → orchestrator này KHÔNG được dùng ở bất cứ đâu.
      routers/translate.py gọi thẳng `main.cmd_translate_async()` như trước
      khi package agents/ tồn tại — hành vi dịch giữ nguyên 100%.
    - "true" → routers/translate.py sẽ CỐ import module này; nếu import
      thành công VÀ `ORCHESTRATOR_AVAILABLE=True` thì dùng orchestrator,
      ngược lại tự rơi về `cmd_translate_async()` cũ (không raise lỗi ra
      ngoài, không làm sập app).

── Giới hạn Giai đoạn 1 (đọc kỹ trước khi mở rộng) ──────────────────────────
    - `run_translation_via_orchestrator()` chỉ chạy scraper_agent →
      translator_agent (Pass 1) cho ĐÚNG 1 chương — tương đương 1 lần gọi
      `translate_chapter()` sau khi crawl xong 1 URL. Vòng lặp nhiều chương/
      catalog/batch/split KHÔNG nằm trong phạm vi Giai đoạn 1 — phần đó vẫn
      do routers/translate.py + pipeline.py quản lý ở luồng cũ.
    - KHÔNG có Pass 2 (polish)/QC tự động/glossary auto-learn qua agent
      riêng — đó là Giai đoạn 2-3.
    - 2 sub-agent (ScraperAgent, TranslatorAgent) là custom BaseAgent chạy
      code deterministic có sẵn, KHÔNG dùng LLM để "quyết định" gọi tool —
      tránh phát sinh thêm lệnh gọi AI ngoài dự kiến (số lần gọi AI/chương
      vẫn là 1, giống bảng so sánh trong research-notes.md).

⚠️ google-adk là dependency TÙY CHỌN — mọi import phải bọc try/except để
production server chưa cài package này vẫn `import agents.orchestrator`
được (dù ADK_ENABLED=true, việc import lỗi sẽ khiến ORCHESTRATOR_AVAILABLE=False
thay vì crash toàn app).
"""

import logging
from typing import Optional

try:
    from google.adk.agents import SequentialAgent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types
    _ADK_CORE_AVAILABLE = True
except ImportError:
    _ADK_CORE_AVAILABLE = False
    SequentialAgent = None
    Runner = None
    InMemorySessionService = None
    genai_types = None

from agents.scraper_agent import ScraperAgent, ADK_AVAILABLE as _SCRAPER_AGENT_OK, scrape_chapter_standalone
from agents.translator_agent import TranslatorAgent, ADK_AVAILABLE as _TRANSLATOR_AGENT_OK

from scraper import NovelScraper
from translator import NovelTranslator
import pipeline as _pl

# True chỉ khi google-adk (core) VÀ cả 2 sub-agent import thành công.
# routers/translate.py (và mọi caller khác) PHẢI kiểm tra cờ này trước khi
# gọi build_orchestrator()/run_translation_via_orchestrator().
ORCHESTRATOR_AVAILABLE: bool = bool(
    _ADK_CORE_AVAILABLE and _SCRAPER_AGENT_OK and _TRANSLATOR_AGENT_OK
)

_APP_NAME = "hacdaotruyen_novel_translator"


def build_orchestrator(
    scraper: Optional[NovelScraper] = None,
    translator: Optional[NovelTranslator] = None,
    logger: Optional[logging.Logger] = None,
):
    """
    Khởi tạo SequentialAgent: scraper_agent → translator_agent.

    Raise RuntimeError nếu google-adk chưa cài hoặc import lỗi — caller nên
    kiểm tra `ORCHESTRATOR_AVAILABLE` trước khi gọi hàm này.
    """
    if not ORCHESTRATOR_AVAILABLE:
        raise RuntimeError(
            "ADK orchestrator không khả dụng (thiếu google-adk hoặc import lỗi). "
            "Cài bằng: pip install google-adk"
        )
    return SequentialAgent(
        name="novel_translation_pipeline",
        sub_agents=[
            ScraperAgent(scraper=scraper, logger=logger),
            TranslatorAgent(translator=translator),
        ],
    )


async def run_translation_via_orchestrator(
    url: str,
    glossary: Optional[dict] = None,
    translation_style: str = "",
    previous_summary: str = "",
    scraper: Optional[NovelScraper] = None,
    translator: Optional[NovelTranslator] = None,
    logger: Optional[logging.Logger] = None,
    user_id: str = "novel_translator",
) -> dict:
    """
    Chạy pipeline ADK cho ĐÚNG 1 chương: cào (scraper_agent) → dịch Pass 1
    (translator_agent). Trả về dict:
      {"title", "content", "next_url", "translated_text", "chapter_summary", "usage"}

    Đây là hàm ở mức "1 chương" — vòng lặp nhiều chương/batch/split vẫn do
    routers/translate.py + pipeline.py quản lý ở Giai đoạn 1 này (xem
    docstring module). Nếu ORCHESTRATOR_AVAILABLE=False, hàm này raise
    RuntimeError — caller PHẢI tự fallback về `cmd_translate_async()`.
    """
    if not ORCHESTRATOR_AVAILABLE:
        raise RuntimeError("ADK orchestrator không khả dụng (thiếu google-adk hoặc import lỗi)")

    pipeline_agent = build_orchestrator(scraper=scraper, translator=translator, logger=logger)

    session_service = InMemorySessionService()
    initial_state = {
        "chapter_url": url,
        "glossary": glossary or {},
        "translation_style": translation_style,
        "previous_summary": previous_summary,
    }
    # Seed state ban đầu qua create_session(state=...) — ADK InMemorySessionService
    # KHÔNG lấy state từ việc mutate trực tiếp session.state trước khi run
    # (đã verify bằng script test riêng — xem báo cáo). Đây là cách API hỗ trợ chính thức.
    session = await session_service.create_session(
        app_name=_APP_NAME, user_id=user_id, state=initial_state
    )
    runner = Runner(agent=pipeline_agent, app_name=_APP_NAME, session_service=session_service)

    result: dict = {}
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=genai_types.Content(role="user", parts=[genai_types.Part(text=url)]),
    ):
        if event.custom_metadata:
            result.update(event.custom_metadata)

    result.setdefault("title", None)
    result.setdefault("content", None)
    result.setdefault("translated_text", None)
    result.setdefault("chapter_summary", "")
    result.setdefault("usage", {})
    return result


async def run_full_translation_via_orchestrator(args, progress_callback=None) -> None:
    """
    Chạy TOÀN BỘ 1 phiên dịch (nhiều chương) qua khung ADK — bản tương đương
    Giai đoạn 1 của `main.cmd_translate_async()`, dùng contract
    progress_callback GIỐNG HỆT (routers/translate.py phụ thuộc vào contract này).

    Đây là hàm được routers/translate.py gọi khi `ADK_ENABLED=true` VÀ
    `ORCHESTRATOR_AVAILABLE=True`. Nếu ADK_ENABLED không bật (mặc định),
    hàm này KHÔNG được gọi — routers/translate.py gọi thẳng
    `main.cmd_translate_async()` như trước.

    ── Giới hạn Giai đoạn 1 (so với luồng cũ trong pipeline.py) ─────────────
      - Chỉ crawl + dịch TUẦN TỰ từng chương một (scraper_agent → translator_agent
        chạy nối tiếp cho từng URL) — CHƯA hỗ trợ dịch song song nhiều batch
        cùng lúc (MAX_CONCURRENT_BATCHES) như luồng cũ.
      - Chương quá lớn (> CHAPTER_SPLIT_THRESHOLD) KHÔNG được tự động split
        thành nhiều phần — dịch nguyên khối trong 1 lần gọi translator_agent.
      - Không có Pass 2/QC/glossary auto-learn (Giai đoạn 2-3).
      - Không tự động sync Cloudflare cuối phiên (AUTO_SYNC_CLOUDFLARE) —
        tính năng đó gắn với `pipeline.finalize_session()` của luồng cũ.

    Tái sử dụng tối đa helper có sẵn của pipeline.py (không rewrite logic):
      resolve_start_url, TranslationContext, init_catalog, resolve_chapter_budget,
      save_raw_parts, validate_raw_content, _write_chapter_file,
      update_profile_progress_safely.
    """
    from novel_manager import load_novel

    def _report(*a, **kw):
        if progress_callback:
            progress_callback(*a, **kw)

    def _is_cancelled() -> bool:
        if progress_callback is None:
            return False
        from state import cancel_flags
        return bool(cancel_flags.get(getattr(args, "novel", ""), False))

    profile = load_novel(args.novel)
    logger = logging.getLogger(f"agents.orchestrator.{profile.slug}")

    start_url = _pl.resolve_start_url(profile, args, logger)
    if start_url is None:
        _report(0, args.chapters, "error", "[ADK] Không có URL để bắt đầu.")
        return

    translator = NovelTranslator()
    ctx = _pl.TranslationContext(
        args=args, profile=profile, logger=logger,
        translator=translator, report_progress=_report, is_cancelled=_is_cancelled,
    )
    _pl.init_catalog(ctx, start_url)
    _pl.resolve_chapter_budget(ctx)

    if ctx.catalog_active:
        for _ci in ctx.catalog:
            ctx.url_to_catalog_item[_ci["url"]] = _ci

    scraper = NovelScraper()
    ctx.scraper = scraper

    logger.info(f"[ADK] Bắt đầu phiên dịch qua orchestrator: {profile.title} ({profile.slug})")
    _report(0, args.chapters, "running",
            f"[ADK] Bắt đầu dịch {args.chapters} chương (Giai đoạn 1 — tuần tự, không batch)")

    translated_count = 0
    current_url = ctx.current_url
    catalog_idx = ctx.current_idx
    # Bộ đếm chapter number cục bộ cho luồng KHÔNG có catalog (tương đương
    # `profile.last_chapter_number + batch_len` của luồng cũ nhưng batch_len luôn = 1 ở đây).
    local_last_chap_num = profile.last_chapter_number

    try:
        # Resume: nếu không dùng catalog và đang resume từ chương đã dịch,
        # cào 1 lần để lấy URL kế tiếp mà KHÔNG dịch lại chương đó — giống
        # hệt nhánh resume_from_next của `pipeline.run_sequential_flow`.
        if not ctx.catalog_active and ctx.resume_from_next and current_url:
            logger.info("[ADK] Resume — bỏ qua chương đã dịch, cào để lấy URL kế tiếp...")
            skip_result = await scrape_chapter_standalone(scraper, current_url, logger)
            if skip_result:
                _, _, _, resume_next_url = skip_result
                current_url = resume_next_url
            ctx.resume_from_next = False

        for i in range(args.chapters):
            if _is_cancelled():
                _report(translated_count, args.chapters, "cancelled", "⏹ [ADK] Đã dừng theo yêu cầu")
                break

            item = None
            if ctx.catalog_active:
                cat_idx = catalog_idx + i
                if cat_idx >= len(ctx.catalog):
                    logger.info("[ADK] Catalog index vượt phạm vi (đã hết chương).")
                    break
                item = ctx.catalog[cat_idx]
                url = item["url"]
            else:
                if not current_url:
                    logger.info("[ADK] Không còn URL chương tiếp theo.")
                    break
                url = current_url

            _report(translated_count, args.chapters, "running",
                    log_msg=f"[ADK] Đang xử lý: {url}", crawling_chapter=url)

            result = await run_translation_via_orchestrator(
                url=url,
                glossary=profile.glossary,
                translation_style=profile.translation_style,
                previous_summary=ctx.previous_summary,
                scraper=scraper,
                translator=translator,
                logger=logger,
            )

            title       = result.get("title")
            content     = result.get("content")
            translated  = result.get("translated_text")
            summary     = result.get("chapter_summary") or ""
            usage       = result.get("usage") or {}
            next_url    = result.get("next_url")

            if not title or content is None:
                logger.error(f"[ADK][!] Lỗi cào nội dung từ: {url}")
                _report(translated_count, args.chapters, "error", f"[ADK] Lỗi: không cào được nội dung từ {url}")
                break

            _pl.validate_raw_content(content, title, logger)
            _pl.save_raw_parts(profile, title, content)

            model_used = usage.get("model", "unknown")
            _pl._write_chapter_file(ctx, title, translated or "[Translation failed]\nError: no output", url, model_used)

            failed = "[Translation failed" in (translated or "")[:100]
            translated_count += 1
            ctx.previous_summary = summary

            _report(translated_count, args.chapters, "running",
                    current_model=model_used,
                    tokens_delta=usage.get("total_tokens", 0),
                    cost_delta=usage.get("cost_usd", 0.0),
                    chapter_ok=None if failed else title,
                    chapter_fail=title if failed else None,
                    scraped_count=translated_count)

            if ctx.catalog_active:
                ch_num = item.get("number", local_last_chap_num) if item else local_last_chap_num
                _pl.update_profile_progress_safely(profile.slug, url, ch_num)
            else:
                local_last_chap_num += 1
                _pl.update_profile_progress_safely(profile.slug, url, local_last_chap_num)
                current_url = next_url
    finally:
        await scraper.close()

    final_status = "cancelled" if _is_cancelled() else "finished"
    _report(translated_count, args.chapters, final_status,
            f"[ADK] Hoàn thành dịch {translated_count} chương (qua orchestrator).")
