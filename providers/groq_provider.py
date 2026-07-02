"""
providers/groq_provider.py
--------------------------
GroqBackend — fallback miễn phí khi Gemini hết quota.
"""

from config import GROQ_API_KEY, GROQ_MODEL


class GroqBackend:
    def __init__(self):
        if not GROQ_API_KEY:
            raise ValueError("Thiếu GROQ_API_KEY — lấy miễn phí: https://console.groq.com")
        from groq import Groq
        self._client = Groq(api_key=GROQ_API_KEY)

    def call(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=8192,
        )
        return resp.choices[0].message.content

    @property
    def name(self) -> str:
        return f"Groq/{GROQ_MODEL}"
