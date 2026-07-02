"""
providers
---------
Package chứa các backend AI cho việc dịch:
  - gemini.py        : GeminiBackend (kèm key rotation + model rotation)
  - deepseek.py      : DeepSeekBackend (OpenAI-compatible)
  - groq_provider.py : GroqBackend
  - ollama.py        : OllamaBackend (local self-host)
  - key_manager.py   : Lưu/đọc trạng thái key (key_status.json)

translator.py là facade — import backend từ đây và giữ nguyên public API.
"""

from providers.gemini import GeminiBackend, GEMINI_MODEL_POOL, _DailyQuotaExhausted
from providers.deepseek import DeepSeekBackend
from providers.groq_provider import GroqBackend
from providers.ollama import OllamaBackend
from providers.key_manager import (
    _KEY_STATUS_FILE,
    _QUOTA_RESET_HOURS,
    _RATE_LIMIT_SKIP_HOURS,
    _load_key_status,
    _save_key_status,
    _now_iso,
    _hours_since,
)

__all__ = [
    "GeminiBackend", "DeepSeekBackend", "GroqBackend", "OllamaBackend",
    "GEMINI_MODEL_POOL", "_DailyQuotaExhausted",
    "_KEY_STATUS_FILE", "_QUOTA_RESET_HOURS", "_RATE_LIMIT_SKIP_HOURS",
    "_load_key_status", "_save_key_status", "_now_iso", "_hours_since",
]
