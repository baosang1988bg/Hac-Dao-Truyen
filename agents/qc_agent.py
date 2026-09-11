"""
agents/qc_agent.py
--------------------
QCAgent — ADK Giai đoạn 2 (Quality Enhancement).
Xem docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md (mục 4.1).

QCAgent là `BaseAgent` **deterministic** — KHÔNG dùng LLM để "quyết định" kết
quả QC (không phát sinh thêm lệnh gọi AI nào), giữ đúng nguyên tắc đã áp dụng
cho ScraperAgent/TranslatorAgent. Toàn bộ logic kiểm tra nằm trong hàm thuần
Python `check_translation_quality()` — test được độc lập, KHÔNG cần
google-adk/ADK Runner/Session.

Input  (session.state, khi chạy trong ADK graph): "polished_text" nếu có,
                         ngược lại "translated_text"; "chapter_content" (bản
                         gốc, dùng để tính tỷ lệ độ dài).
Output (session.state): "qc_passed" (bool), "qc_reason" (Optional[str])

⚠️ google-adk là dependency TÙY CHỌN — import phải bọc try/except (xem
agents/__init__.py, agents/scraper_agent.py, agents/translator_agent.py).
"""

import re
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


# Regex Hán tự sót — khớp đúng dải Unicode dùng ở README/research-notes.md
# và cleanup pass hiện có trong translator.py (has_chinese_chars/_CHINESE_ANY_RE).
_CHINESE_LEFTOVER_RE = re.compile(r'[一-鿿]')

# Ngưỡng tỷ lệ độ dài translated/original (đếm ký tự) — theo đúng spec mục 4.1.
MIN_LENGTH_RATIO = 0.3
MAX_LENGTH_RATIO = 3.0


def check_translation_quality(original: str, translated: str) -> tuple[bool, Optional[str]]:
    """
    Hàm thuần Python — KHÔNG gọi AI, KHÔNG cần ADK — test độc lập được.

    Kiểm tra 2 tiêu chí (theo đúng spec 4.1):
      1. Hán tự sót trong bản dịch: regex `[一-鿿]`.
      2. Tỷ lệ độ dài `len(translated) / len(original)` (đếm ký tự) phải
         nằm trong [0.3, 3.0] — fail nếu < 0.3 hoặc > 3.0.

    Trả (True, None) nếu qua cả 2 kiểm tra; (False, reason) nếu fail 1 trong 2
    (kiểm tra Hán tự trước — nếu fail thì không cần tính tiếp tỷ lệ độ dài).
    """
    original = original or ""
    translated = translated or ""

    m = _CHINESE_LEFTOVER_RE.search(translated)
    if m:
        return False, (
            f"Còn sót Hán tự '{m.group(0)}' tại vị trí ký tự {m.start()} trong bản dịch"
        )

    len_original = len(original)
    len_translated = len(translated)

    if len_original == 0:
        # Không có bản gốc để so tỷ lệ — chỉ fail rõ ràng khi bản dịch cũng
        # rỗng (raw content rỗng — D04: "raw rỗng"), tránh ZeroDivisionError.
        if len_translated == 0:
            return False, "Bản gốc và bản dịch đều rỗng — không có nội dung để kiểm tra"
        return True, None

    ratio = len_translated / len_original
    if ratio < MIN_LENGTH_RATIO or ratio > MAX_LENGTH_RATIO:
        return False, (
            f"Tỷ lệ độ dài bất thường: {ratio:.2f} "
            f"(bản gốc {len_original} ký tự, bản dịch {len_translated} ký tự; "
            f"ngưỡng cho phép [{MIN_LENGTH_RATIO}, {MAX_LENGTH_RATIO}])"
        )

    return True, None


if ADK_AVAILABLE:

    class QCAgent(BaseAgent):
        """Bọc `check_translation_quality()` thành 1 bước deterministic của SequentialAgent."""

        def __init__(self, name: str = "qc_agent", **kwargs):
            super().__init__(name=name, **kwargs)

        async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
            state = ctx.session.state
            original = state.get("chapter_content") or ""
            translated = state.get("polished_text")
            if translated is None:
                translated = state.get("translated_text") or ""

            passed, reason = check_translation_quality(original, translated)
            state["qc_passed"] = passed
            state["qc_reason"] = reason

            status = "PASS" if passed else "FAIL"
            summary_text = f"[qc_agent] QC {status}" + (f" — {reason}" if reason else "")

            yield Event(
                author=self.name,
                content=genai_types.Content(
                    role="model",
                    parts=[genai_types.Part(text=summary_text)],
                ),
                custom_metadata={"qc_passed": passed, "qc_reason": reason},
            )

else:
    # google-adk chưa cài — orchestrator.py phải tự kiểm tra ADK_AVAILABLE
    # trước khi dùng QCAgent. `check_translation_quality()` ở trên vẫn dùng
    # được bình thường (không phụ thuộc ADK_AVAILABLE).
    QCAgent = None
