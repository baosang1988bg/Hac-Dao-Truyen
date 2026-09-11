"""
agents/polish_agent.py
------------------------
PolishAgent — ADK Giai đoạn 2 (Quality Enhancement), Pass 2 (polish văn phong).
Xem docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md (mục 4.2).

Bọc `NovelTranslator.polish_chapter` (method MỚI thêm trong translator.py,
KHÔNG sửa/xóa gì ở `translate_chapter` Pass 1) — gọi LLM thật, theo đúng mẫu
`TranslatorAgent`: chạy qua `asyncio.to_thread` để không block event loop của
ADK Runner, và tái sử dụng NGUYÊN VẸN cơ chế xoay vòng key/retry/fallback
provider đã có trong translator.py (KHÔNG tạo đường gọi API song song riêng).

Input  (session.state): "translated_text" (bản Pass 1 — lý tưởng là bản ĐÃ
                         pass QC lần 1, do orchestrator quyết định khi nào
                         gọi agent này).
Output (session.state):  "polished_text", "usage" (usage của riêng lần gọi
                         Polish này — orchestrator tự cộng dồn với usage
                         Pass 1, xem agents/orchestrator.py).

⚠️ google-adk là dependency TÙY CHỌN — import phải bọc try/except (xem
agents/__init__.py, agents/scraper_agent.py, agents/translator_agent.py).
"""

import asyncio
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

    class PolishAgent(BaseAgent):
        """Bọc NovelTranslator.polish_chapter (Pass 2) thành 1 bước của SequentialAgent."""

        def __init__(
            self,
            translator: Optional[NovelTranslator] = None,
            name: str = "polish_agent",
            **kwargs,
        ):
            super().__init__(name=name, **kwargs)
            object.__setattr__(self, "_translator", translator or NovelTranslator())

        async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
            state = ctx.session.state
            translated = state.get("translated_text")
            if translated is None:
                raise ValueError(
                    "PolishAgent: thiếu 'translated_text' trong session.state "
                    "(cần chạy sau translator_agent, lý tưởng là sau khi đã pass QC lần 1)"
                )

            # polish_chapter là hàm sync (đã tự retry + fallback provider bên
            # trong, giống translate_chapter) — chạy trong thread riêng để
            # không block event loop của ADK Runner.
            polished, usage = await asyncio.to_thread(
                self._translator.polish_chapter,
                translated_text=translated,
                max_retries=3,
            )

            state["polished_text"] = polished
            state["usage"] = usage

            model_used = usage.get("model", "unknown") if usage else "unchanged (polish thất bại)"
            yield Event(
                author=self.name,
                content=genai_types.Content(
                    role="model",
                    parts=[genai_types.Part(
                        text=f"[polish_agent] Đã polish xong (model={model_used})"
                    )],
                ),
                custom_metadata={"polished_text": polished, "usage": usage},
            )

else:
    # google-adk chưa cài — orchestrator.py phải tự kiểm tra ADK_AVAILABLE
    # trước khi dùng PolishAgent.
    PolishAgent = None


async def polish_chapter_standalone(
    translator: NovelTranslator,
    translated_text: str,
    max_retries: int = 3,
):
    """
    Hàm tiện ích KHÔNG phụ thuộc google-adk — gọi thẳng
    NovelTranslator.polish_chapter (Pass 2) trong 1 thread riêng.
    Dùng để test/verify độc lập, và được agents/orchestrator.py dùng làm
    control-flow thường (không phải ADK graph) cho vòng lặp retry Pass 2.
    Trả về (polished_text, usage) — usage rỗng ({}) nếu mọi provider lỗi.
    """
    return await asyncio.to_thread(
        translator.polish_chapter,
        translated_text=translated_text,
        max_retries=max_retries,
    )
