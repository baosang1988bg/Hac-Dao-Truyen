"""
agents/orchestrator.py
------------------------
SequentialAgent điều phối scraper_agent → translator_agent (Pass 1), cộng
thêm vòng QC + Pass 2 (polish) có điều kiện — Giai đoạn 1 (Foundation) +
Giai đoạn 2 (Quality Enhancement) của kế hoạch tích hợp ADK.
Xem plans/adk-agents/README.md, plans/adk-agents/research-notes.md và
docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md (nguồn sự thật cho
kiến trúc/luồng Giai đoạn 2).

── Biến môi trường ──────────────────────────────────────────────────────────
ADK_ENABLED (mặc định: "false" / không set trong .env)
    - "false"/không set → orchestrator này KHÔNG được dùng ở bất cứ đâu.
      routers/translate.py gọi thẳng `main.cmd_translate_async()` như trước
      khi package agents/ tồn tại — hành vi dịch giữ nguyên 100%.
    - "true" → routers/translate.py sẽ CỐ import module này; nếu import
      thành công VÀ `ORCHESTRATOR_AVAILABLE=True` thì dùng orchestrator,
      ngược lại tự rơi về `cmd_translate_async()` cũ (không raise lỗi ra
      ngoài, không làm sập app).

4 cờ dưới đây CHỈ có ý nghĩa khi ADK_ENABLED=true (đọc qua agents/__init__.py,
cùng pattern is_adk_enabled()); mặc định TẤT CẢ đều tắt — bật/tắt không cần
sửa code, chỉ đổi .env:
  ADK_QC_ENABLED      (mặc định false) — bật QC (check_translation_quality)
                      sau Pass 1 (và sau Pass 2 nếu Pass 2 cũng bật).
  ADK_PASS2_ENABLED   (mặc định false) — bật Polish sau khi Pass 1 pass QC
                      (hoặc ngay sau Pass 1 nếu QC tắt).
  ADK_QC_MAX_RETRY    (mặc định 2) — số lần tối đa gọi lại Pass 1 khi QC fail.
  ADK_PASS2_MAX_RETRY (mặc định 2) — số lần tối đa gọi lại Polish khi QC
                      (lần 2) fail.

── Luồng QC/Pass 2 (Giai đoạn 2 — xem spec mục 3) ───────────────────────────
    ScraperAgent → TranslatorAgent (Pass 1)
        → [ADK_QC_ENABLED?] false: bỏ qua QC, đi thẳng xuống Pass 2/kết thúc
                             true:  check_translation_quality(...)
                                    fail (còn retry) → gọi lại TranslatorAgent,
                                                        quay lại QC, đếm retry
                                    hết retry vẫn fail → dùng bản Pass 1 gốc,
                                                        KHÔNG polish, ghi
                                                        failed_chapters.json
                                    pass → tiếp tục
        → [ADK_PASS2_ENABLED?] false: kết thúc, dùng bản (đã) qua QC ở trên
                               true:  PolishAgent.polish(...)
                                      → QC lần 2 trên bản polish
                                        fail (còn retry) → gọi lại Polish,
                                                            quay lại QC, đếm retry
                                        hết retry vẫn fail → dùng bản Pass 1
                                                            (đã pass QC lần 1),
                                                            ghi failed_chapters.json
                                        pass → dùng bản polish

    Vòng lặp trên là CODE PYTHON THƯỜNG (for/while đếm số lần trong
    `run_pass2_qc_for_chapter()` bên dưới) — KHÔNG dùng LLM-driven loop của
    ADK, giữ đúng nguyên tắc "deterministic control flow" đã áp dụng ở Giai
    đoạn 1. Hàm này gọi thẳng các hàm thuần/standalone
    (`agents.qc_agent.check_translation_quality`,
    `agents.translator_agent.translate_chapter_standalone`,
    `agents.polish_agent.polish_chapter_standalone`) — KHÔNG phụ thuộc
    google-adk, nên chạy/test được dù google-adk chưa cài (khác với
    `run_translation_via_orchestrator()` bên dưới, hàm đó vẫn cần ADK Runner
    cho Pass 1 scraper+translator như Giai đoạn 1).

    Khi hết retry ở bất kỳ vòng nào mà vẫn fail: KHÔNG raise lỗi, KHÔNG chặn
    lưu file — dùng bản TỐT NHẤT theo thứ tự ưu tiên (spec mục 6):
      1. Bản polish nếu polish từng tự pass QC (dù ở lần retry nào).
      2. Bản Pass 1 nếu đã pass QC nhưng Polish/QC-lần-2 hết retry vẫn fail.
      3. Bản Pass 1 gốc (chưa từng pass QC) nếu chính QC-lần-1 hết retry vẫn
         fail và không còn lựa chọn nào khác.
    Ghi cảnh báo vào `novels/<slug>/failed_chapters.json` — TÁI DÙNG nguyên
    hàm `pipeline._record_failed_chapter()` (cấu trúc/đường dẫn không đổi),
    gói giai đoạn fail + lý do QC + số lần đã retry vào field `error`.

── Giới hạn (đọc kỹ trước khi mở rộng thêm) ─────────────────────────────────
    - `run_translation_via_orchestrator()` chỉ xử lý ĐÚNG 1 chương/lần gọi —
      tương đương 1 lần `translate_chapter()` (+ QC/Polish nếu bật) sau khi
      crawl xong 1 URL. Vòng lặp nhiều chương/catalog/batch/split vẫn do
      `run_full_translation_via_orchestrator()` + pipeline.py quản lý,
      TUẦN TỰ (không batch/song song) — như Giai đoạn 1.
    - KHÔNG có glossary auto-learn qua agent riêng — đó là Giai đoạn 3.
    - Toàn bộ sub-agent (Scraper/Translator/QC) là custom BaseAgent chạy
      code deterministic có sẵn; QCAgent KHÔNG dùng LLM để quyết định.
      PolishAgent CÓ gọi LLM thật (khác QC) nhưng tái dùng nguyên cơ chế
      xoay vòng key/retry/fallback provider đã có trong translator.py.

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

from agents import is_qc_enabled, is_pass2_enabled, get_qc_max_retry, get_pass2_max_retry
from agents.scraper_agent import ScraperAgent, ADK_AVAILABLE as _SCRAPER_AGENT_OK, scrape_chapter_standalone
from agents.translator_agent import TranslatorAgent, ADK_AVAILABLE as _TRANSLATOR_AGENT_OK, translate_chapter_standalone
from agents.qc_agent import check_translation_quality
from agents.polish_agent import polish_chapter_standalone

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


def _aggregate_usage(usage_history: list) -> dict:
    """
    Cộng dồn usage của TẤT CẢ lần gọi AI đã ghi nhận (Pass 1 gốc + mọi lần
    retry Pass 1 + Polish) thành 1 dict tổng — tái dùng ĐÚNG các field đã có
    trong usage của `translate_chapter`/`polish_chapter`
    (input_tokens/output_tokens/total_tokens/cost_usd), KHÔNG bịa công thức
    tính cost mới (D05). `model` lấy từ lần gọi cuối cùng có usage hợp lệ, để
    tương thích ngược với code hiển thị "model hiện tại" (report progress...).
    """
    valid = [u for u in usage_history if u]
    if not valid:
        return {"model": "unknown", "input_tokens": 0, "output_tokens": 0,
                "total_tokens": 0, "cost_usd": 0.0}
    return {
        "model":         valid[-1].get("model", "unknown"),
        "input_tokens":  sum(u.get("input_tokens", 0) for u in valid),
        "output_tokens": sum(u.get("output_tokens", 0) for u in valid),
        "total_tokens":  sum(u.get("total_tokens", 0) for u in valid),
        "cost_usd":      sum(u.get("cost_usd", 0.0) for u in valid),
    }


async def run_pass2_qc_for_chapter(
    translator: NovelTranslator,
    title: str,
    content: str,
    pass1_text: str,
    pass1_usage: Optional[dict] = None,
    glossary: Optional[dict] = None,
    translation_style: str = "",
    previous_summary: str = "",
    novel_slug: Optional[str] = None,
    url: str = "",
    logger: Optional[logging.Logger] = None,
) -> dict:
    """
    Chạy vòng QC (+ Pass 2/Polish nếu bật) cho 1 chương ĐÃ có bản Pass 1
    (`pass1_text`) — xem sơ đồ luồng ở docstring đầu module. CODE PYTHON
    THƯỜNG (for/while đếm số lần), KHÔNG dùng ADK graph/LLM-driven loop, và
    KHÔNG phụ thuộc google-adk (chạy/test được kể cả khi ORCHESTRATOR_AVAILABLE
    = False) — chỉ gọi các hàm thuần/standalone:
      agents.qc_agent.check_translation_quality        (không AI, deterministic)
      agents.translator_agent.translate_chapter_standalone (Pass 1, retry)
      agents.polish_agent.polish_chapter_standalone     (Pass 2)

    Đọc 4 cờ qua agents/__init__.py (is_qc_enabled/is_pass2_enabled/
    get_qc_max_retry/get_pass2_max_retry) — mặc định QC/Pass 2 đều TẮT nên
    hàm này trả về y hệt bản Pass 1 đầu vào, KHÔNG gọi thêm AI call nào.

    Trả về dict:
      {
        "final_text":    str,            # bản TỐT NHẤT theo ưu tiên mục 6 spec
        "stage":         str,            # nhãn giai đoạn tạo ra final_text
        "qc_passed":     Optional[bool], # None nếu QC tắt hoàn toàn
        "qc_reason":     Optional[str],
        "usage_history": list[dict],     # usage của MỌI lần gọi AI (Pass1 gốc
                                          # + mọi retry Pass1 + mọi lần Polish)
        "usage":         dict,           # usage CỘNG DỒN — xem _aggregate_usage()
      }

    Khi hết retry ở bất kỳ vòng nào mà vẫn fail: KHÔNG raise lỗi, KHÔNG chặn
    lưu file. Nếu `novel_slug` được cung cấp, ghi cảnh báo vào
    `novels/<novel_slug>/failed_chapters.json` qua
    `pipeline._record_failed_chapter()` (TÁI DÙNG nguyên cấu trúc/đường dẫn
    hiện có — không tạo file trạng thái mới), gói giai đoạn fail + số lần đã
    retry + lý do QC vào field `error` hiện có.
    """
    logger = logger or logging.getLogger("agents.orchestrator.pass2_qc")
    glossary = glossary or {}

    usage_history: list = [pass1_usage] if pass1_usage else []

    qc_enabled = is_qc_enabled()
    pass2_enabled = is_pass2_enabled()

    current_text = pass1_text
    qc_passed: Optional[bool] = None
    qc_reason: Optional[str] = None
    stage = "pass1_qc_disabled"

    if qc_enabled:
        qc_max_retry = get_qc_max_retry()
        passed, reason = check_translation_quality(content, current_text)
        attempts = 0
        while not passed and attempts < qc_max_retry:
            attempts += 1
            logger.info(f"[ADK][QC] Pass 1 fail ({reason}) — retry {attempts}/{qc_max_retry}...")
            current_text, _summary, retry_usage = await translate_chapter_standalone(
                translator, title, content,
                glossary=glossary,
                translation_style=translation_style,
                previous_summary=previous_summary,
            )
            if retry_usage:
                usage_history.append(retry_usage)
            passed, reason = check_translation_quality(content, current_text)

        qc_passed = passed
        qc_reason = reason
        stage = "pass1_qc_pass" if passed else "pass1_qc_fail"

        if not passed:
            logger.warning(f"[ADK][QC] Pass 1 hết retry ({qc_max_retry}) vẫn fail: {reason}")
            if novel_slug:
                _pl._record_failed_chapter(
                    novel_slug, url, title,
                    f"[ADK QC] Giai đoạn: pass1; Retries: {attempts}/{qc_max_retry}; Lý do: {reason}",
                )

    best_text = current_text
    best_stage = stage

    # Chỉ vào Pass 2 khi: Pass 2 bật VÀ (QC tắt HOẶC Pass 1 đã pass QC).
    # Nếu QC bật mà Pass 1 hết retry vẫn fail → KHÔNG polish (đúng sơ đồ:
    # nhánh "fail" chỉ quay lại retry Pass 1, không có đường vào Pass 2).
    can_polish = pass2_enabled and (not qc_enabled or qc_passed)

    if can_polish:
        polish_source = current_text  # bản đã pass QC (hoặc Pass 1 nếu QC tắt)
        polished_text, polish_usage = await polish_chapter_standalone(translator, polish_source)
        if polish_usage:
            usage_history.append(polish_usage)

        if qc_enabled:
            pass2_max_retry = get_pass2_max_retry()
            passed2, reason2 = check_translation_quality(content, polished_text)
            attempts2 = 0
            while not passed2 and attempts2 < pass2_max_retry:
                attempts2 += 1
                logger.info(f"[ADK][QC] Polish fail ({reason2}) — retry {attempts2}/{pass2_max_retry}...")
                polished_text, polish_usage = await polish_chapter_standalone(translator, polish_source)
                if polish_usage:
                    usage_history.append(polish_usage)
                passed2, reason2 = check_translation_quality(content, polished_text)

            qc_passed = passed2
            qc_reason = reason2

            if passed2:
                best_text = polished_text
                best_stage = "polish_qc_pass"
            else:
                # Hết retry Pass 2 vẫn fail → ưu tiên #2 (spec mục 6): giữ bản
                # Pass 1 đã pass QC lần 1 (best_text/stage giữ nguyên từ trên).
                logger.warning(f"[ADK][QC] Polish hết retry ({pass2_max_retry}) vẫn fail: {reason2}")
                best_stage = "polish_qc_fail_fallback_pass1"
                if novel_slug:
                    _pl._record_failed_chapter(
                        novel_slug, url, title,
                        f"[ADK QC] Giai đoạn: pass2; Retries: {attempts2}/{pass2_max_retry}; Lý do: {reason2}",
                    )
        else:
            # QC tắt — không có gate, dùng thẳng bản polish (đúng luồng
            # "ADK_QC_ENABLED=false → bỏ qua QC, đi thẳng xuống Pass 2" của spec).
            best_text = polished_text
            best_stage = "polish_no_qc"

    return {
        "final_text": best_text,
        "stage": best_stage,
        "qc_passed": qc_passed,
        "qc_reason": qc_reason,
        "usage_history": usage_history,
        "usage": _aggregate_usage(usage_history),
    }


async def run_translation_via_orchestrator(
    url: str,
    glossary: Optional[dict] = None,
    translation_style: str = "",
    previous_summary: str = "",
    scraper: Optional[NovelScraper] = None,
    translator: Optional[NovelTranslator] = None,
    logger: Optional[logging.Logger] = None,
    user_id: str = "novel_translator",
    novel_slug: Optional[str] = None,
) -> dict:
    """
    Chạy pipeline ADK cho ĐÚNG 1 chương: cào (scraper_agent) → dịch Pass 1
    (translator_agent) → QC/Pass 2 có điều kiện (`run_pass2_qc_for_chapter`,
    xem docstring module để biết luồng đầy đủ). Trả về dict:
      {"title", "content", "next_url", "translated_text" (bản CUỐI CÙNG sau
       QC/Polish nếu có), "chapter_summary", "usage" (cộng dồn), "usage_history",
       "qc_passed", "qc_reason", "stage"}

    Đây là hàm ở mức "1 chương" — vòng lặp nhiều chương/batch/split vẫn do
    routers/translate.py + pipeline.py quản lý (xem docstring module). Nếu
    ORCHESTRATOR_AVAILABLE=False, hàm này raise RuntimeError — caller PHẢI tự
    fallback về `cmd_translate_async()`.

    `novel_slug`: truyền vào để QC/Polish fail sau khi hết retry được ghi vào
    `novels/<novel_slug>/failed_chapters.json`; nếu không truyền (None), bỏ
    qua bước ghi cảnh báo (không biết đường dẫn để ghi).
    """
    if not ORCHESTRATOR_AVAILABLE:
        raise RuntimeError("ADK orchestrator không khả dụng (thiếu google-adk hoặc import lỗi)")

    # Dùng chung 1 instance NovelTranslator cho cả Pass 1 (qua TranslatorAgent
    # bên trong SequentialAgent) VÀ mọi lần gọi lại Pass 1/Polish ở vòng QC
    # bên dưới — giữ nguyên trạng thái rotation key/model giữa các lần gọi,
    # không tạo thêm instance/đường gọi API song song nào khác.
    translator = translator or NovelTranslator()

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

    # ── QC + Pass 2 có điều kiện (Giai đoạn 2) ──────────────────────────────
    # Chỉ chạy khi Pass 1 đã cào+dịch xong (có translated_text) — nếu scraper
    # hoặc translator Pass 1 lỗi, result["translated_text"] là None, bỏ qua
    # bước này y hệt hành vi Giai đoạn 1 (không phát sinh thêm AI call).
    if result.get("translated_text") is not None:
        qc_result = await run_pass2_qc_for_chapter(
            translator=translator,
            title=result.get("title") or "",
            content=result.get("content") or "",
            pass1_text=result["translated_text"],
            pass1_usage=result.get("usage"),
            glossary=glossary,
            translation_style=translation_style,
            previous_summary=previous_summary,
            novel_slug=novel_slug,
            url=url,
            logger=logger,
        )
        result["translated_text"] = qc_result["final_text"]
        result["usage"] = qc_result["usage"]
        result["usage_history"] = qc_result["usage_history"]
        result["qc_passed"] = qc_result["qc_passed"]
        result["qc_reason"] = qc_result["qc_reason"]
        result["stage"] = qc_result["stage"]
    else:
        result.setdefault("usage_history", [result["usage"]] if result.get("usage") else [])
        result.setdefault("qc_passed", None)
        result.setdefault("qc_reason", None)
        result.setdefault("stage", "pass1_scrape_or_translate_failed")

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

    ── Giới hạn (so với luồng cũ trong pipeline.py) ─────────────────────────
      - Chỉ crawl + dịch TUẦN TỰ từng chương một (scraper_agent → translator_agent
        chạy nối tiếp cho từng URL) — CHƯA hỗ trợ dịch song song nhiều batch
        cùng lúc (MAX_CONCURRENT_BATCHES) như luồng cũ.
      - Chương quá lớn (> CHAPTER_SPLIT_THRESHOLD) KHÔNG được tự động split
        thành nhiều phần — dịch nguyên khối trong 1 lần gọi translator_agent.
      - QC (ADK_QC_ENABLED) + Pass 2/Polish (ADK_PASS2_ENABLED) ĐÃ có (Giai
        đoạn 2 — xem `run_pass2_qc_for_chapter`), chạy qua
        `run_translation_via_orchestrator()` cho từng chương (truyền
        `novel_slug=profile.slug` để ghi `failed_chapters.json` khi hết retry
        vẫn fail). Glossary auto-learn qua agent riêng vẫn CHƯA có (Giai đoạn 3).
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
                novel_slug=profile.slug,
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
