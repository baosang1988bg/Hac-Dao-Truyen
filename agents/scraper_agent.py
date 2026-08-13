"""
agents/scraper_agent.py
------------------------
ADK agent bọc scraper.NovelScraper — KHÔNG rewrite logic crawl/parse.
Tái sử dụng nguyên vẹn `pipeline.fetch_and_merge_paginated_chapter_async`
(đã xử lý phân trang, encoding GBK, chặn bot...) — agent này chỉ là 1 lớp
"adapter" chạy lại hàm đó bên trong khung SequentialAgent của ADK.

Input  (session.state):  "chapter_url"  (str, bắt buộc)
Output (session.state):  "chapter_title", "chapter_content",
                          "chapter_prev_url", "chapter_next_url"

Agent này KHÔNG dùng LLM để "quyết định" gọi tool — nó là 1 custom BaseAgent
xử lý deterministic (tương đương 1 node trong pipeline cũ), để không phát
sinh thêm lệnh gọi AI ngoài dự kiến (xem research-notes.md mục
"Vấn đề tiềm ẩn #2 — Rate limiting với nhiều agents").

⚠️ google-adk là dependency TÙY CHỌN — import phải bọc try/except để
production server chưa cài package này vẫn `import agents...` được bình
thường (xem agents/__init__.py). Khi ADK_AVAILABLE=False, `ScraperAgent`
sẽ là None; code gọi nó (agents/orchestrator.py) phải tự kiểm tra cờ này.
"""

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
    BaseAgent = object          # placeholder — tránh lỗi cú pháp ở class bên dưới
    InvocationContext = Any
    Event = Any
    genai_types = None

from scraper import NovelScraper
import pipeline as _pipeline


if ADK_AVAILABLE:

    class ScraperAgent(BaseAgent):
        """Bọc NovelScraper thành 1 bước (step) deterministic của SequentialAgent."""

        def __init__(
            self,
            scraper: Optional[NovelScraper] = None,
            logger: Optional[logging.Logger] = None,
            name: str = "scraper_agent",
            **kwargs,
        ):
            super().__init__(name=name, **kwargs)
            # Dùng object.__setattr__ vì BaseAgent là pydantic model (extra="forbid") —
            # tránh khai báo NovelScraper/Logger thành pydantic field không cần thiết.
            object.__setattr__(self, "_scraper", scraper or NovelScraper())
            object.__setattr__(self, "_logger", logger or logging.getLogger("agents.scraper_agent"))

        async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
            state = ctx.session.state
            url = state.get("chapter_url")
            if not url:
                raise ValueError("ScraperAgent: thiếu 'chapter_url' trong session.state")

            result = await _pipeline.fetch_and_merge_paginated_chapter_async(
                self._scraper, url, self._logger
            )
            if not result:
                raise RuntimeError(f"ScraperAgent: không cào được nội dung từ {url}")
            title, content, prev_url, next_url = result

            state["chapter_title"] = title
            state["chapter_content"] = content
            state["chapter_prev_url"] = prev_url
            state["chapter_next_url"] = next_url

            yield Event(
                author=self.name,
                content=genai_types.Content(
                    role="model",
                    parts=[genai_types.Part(
                        text=f"[scraper_agent] Đã cào: {title} ({len(content or '')} ký tự)"
                    )],
                ),
                custom_metadata={
                    "title": title,
                    "content": content,
                    "next_url": next_url,
                },
            )

else:
    # google-adk chưa cài — orchestrator.py phải tự kiểm tra ADK_AVAILABLE
    # trước khi dùng ScraperAgent.
    ScraperAgent = None


async def scrape_chapter_standalone(scraper: NovelScraper, url: str, logger: Optional[logging.Logger] = None):
    """
    Hàm tiện ích KHÔNG phụ thuộc google-adk — gọi thẳng logic crawl hiện có
    (dùng để test/verify độc lập mà không cần khởi tạo ADK Runner/Session).
    Trả về (title, content, prev_url, next_url) y hệt
    `pipeline.fetch_and_merge_paginated_chapter_async`.
    """
    logger = logger or logging.getLogger("agents.scraper_agent")
    return await _pipeline.fetch_and_merge_paginated_chapter_async(scraper, url, logger)
