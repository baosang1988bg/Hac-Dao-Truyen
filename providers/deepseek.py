"""
providers/deepseek.py
---------------------
DeepSeekBackend — dùng OpenAI-compatible endpoint.
"""

from config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL


class DeepSeekBackend:
    """
    DeepSeek API — dùng OpenAI-compatible endpoint.
    Model mặc định: deepseek-chat (DeepSeek-V3).
    Tài liệu: https://platform.deepseek.com/api-docs
    """
    def __init__(self):
        if not DEEPSEEK_API_KEY:
            raise ValueError("Thiếu DEEPSEEK_API_KEY — lấy key tại: https://platform.deepseek.com")
        from openai import OpenAI
        self._client = OpenAI(
            api_key=DEEPSEEK_API_KEY,
            base_url=DEEPSEEK_BASE_URL,
        )
        self._model = DEEPSEEK_MODEL

    def call(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=8192,
        )
        return resp.choices[0].message.content

    @property
    def name(self) -> str:
        return f"DeepSeek/{self._model}"
