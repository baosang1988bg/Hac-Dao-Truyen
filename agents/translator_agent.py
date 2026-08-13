"""
agents/translator_agent.py
----------------------------
ADK agent bọc NovelTranslator.translate_chapter (Pass 1) — KHÔNG rewrite
logic dịch/retry/fallback provider, chỉ gọi lại method đã có sẵn trong
translator.py.

Input  (session.state): "chapter_title", "chapter_content" (do scraper_agent
                         ghi ở bước trước trong cùng SequentialAgent), cùng
                         các tuỳ chọn "glossary", "translation_style",
                         "previous_summary".
Output (session.state):  "translated_text", "chapter_summary", "usage"

Giai đoạn 1 CHỈ implement Pass 1 (dịch nháp, tương đương luồng hiện tại) —
Pass 2 (polish)/QC/glossary auto-learn thuộc Giai đoạn 2-3, KHÔNG nằm trong
phạm vi file này (xem plans/adk-agents/README.md).

⚠️ google-adk là dependency TÙY CHỌN — import phải bọc try/except (xem
agents/__init__.py và agents/scraper_agent.py).
"""

import asyncio
import logging
from typing import Any, AsyncGenerator, Optional

try:
    from google.adk.agents import BaseAgent
    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.events import Event
    from google.genai import types as genai_types
    ADK_AVAILABLE = True
except ImportError:
    ADK_AVAILABLE = False
    BaseAgent = object
    InvocationContext = Any
    Event = Any
    genai_types = None

from translator import NovelTranslator


if ADK_AVAILABLE:

    class TranslatorAgent(BaseAgent):
        """Bọc NovelTranslator.translate_chapter (Pass 1) thành 1 bước của SequentialAgent."""

        def __init__(
            self,
            translator: Optional[NovelTranslator] = None,
            name: str = "translator_agent",
            **kwargs,
        ):
            super().__init__(name=name, **kwargs)
            object.__setattr__(self, "_translator", translator or NovelTranslator())

        async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
            state = ctx.session.state
            title = state.get("chapter_title")
            content = state.get("chapter_content")
            if not title or content is None:
                raise ValueError(
                    "TranslatorAgent: thiếu 'chapter_title'/'chapter_content' trong "
                    "session.state (cần chạy sau scraper_agent trong cùng SequentialAgent)"
                )

            glossary = state.get("glossary") or {}
            translation_style = state.get("translation_style") or ""
            previous_summary = state.get("previous_summary") or ""

            # translate_chapter là hàm sync (đã tự retry + fallback provider bên trong) —
            # chạy trong thread riêng để không block event loop của ADK Runner.
            translated, summary, usage = await asyncio.to_thread(
                self._translator.translate_chapter,
                title=title,
                content=content,
                glossary=glossary,
                translation_style=translation_style,
                previous_summary=previous_summary,
                max_retries=3,
            )

            state["translated_text"] = translated
            state["chapter_summary"] = summary
            state["usage"] = usage

            yield Event(
                author=self.name,
                content=genai_types.Content(
                    role="model",
                    parts=[genai_types.Part(
                        text=f"[translator_agent] Đã dịch xong '{title}' "
                             f"(model={usage.get('model', 'unknown')})"
                    )],
                ),
                custom_metadata={
                    "translated_text": translated,
                    "chapter_summary": summary,
                    "usage": usage,
                },
            )

else:
    # google-adk chưa cài — orchestrator.py phải tự kiểm tra ADK_AVAILABLE
    # trước khi dùng TranslatorAgent.
    TranslatorAgent = None


async def translate_chapter_standalone(
    translator: NovelTranslator,
    title: str,
    content: str,
    glossary: Optional[dict] = None,
    translation_style: str = "",
    previous_summary: str = "",
    max_retries: int = 3,
):
    """
    Hàm tiện ích KHÔNG phụ thuộc google-adk — gọi thẳng
    NovelTranslator.translate_chapter (Pass 1) trong 1 thread riêng.
    Dùng để test/verify độc lập mà không cần khởi tạo ADK Runner/Session.
    """
    return await asyncio.to_thread(
        translator.translate_chapter,
        title=title,
        content=content,
        glossary=glossary or {},
        translation_style=translation_style,
        previous_summary=previous_summary,
        max_retries=max_retries,
    )
