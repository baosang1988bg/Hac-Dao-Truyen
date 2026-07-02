"""
providers/ollama.py
-------------------
OllamaBackend — chạy model local trên GPU, không tốn API cost.
"""

from config import OLLAMA_ENABLED, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT


class OllamaBackend:
    """
    Ollama local backend — chạy model trên GPU của máy, không tốn API cost.
    Dùng OpenAI-compatible API của Ollama (v0.1.24+).

    Setup:
      1. Cài Ollama: https://ollama.com/download
      2. ollama pull hunyuan-mt       (hoặc tạo từ GGUF — xem use.md)
      3. Set OLLAMA_ENABLED=true trong .env

    Khuyên dùng với RTX 4060 8GB:
      - hunyuan-mt Q4_K_M: ~4.5GB VRAM, tốt cho dịch Chinese→Vietnamese
      - Tốc độ: ~25-35 tokens/giây (~40-60s/chương)
    """

    def __init__(self):
        if not OLLAMA_ENABLED:
            raise ValueError("Ollama chưa được bật — set OLLAMA_ENABLED=true trong .env")
        # Ollama dùng OpenAI-compatible API, không cần thư viện riêng
        from openai import OpenAI
        self._client = OpenAI(
            api_key="ollama",           # placeholder, Ollama không cần auth
            base_url=f"{OLLAMA_BASE_URL.rstrip('/')}/v1",
        )
        self._model   = OLLAMA_MODEL
        self._timeout = OLLAMA_TIMEOUT
        # Kiểm tra Ollama có đang chạy không
        self._check_connection()

    def _check_connection(self):
        """Ping Ollama server để xác nhận đang chạy và model đã được pull."""
        import urllib.request
        try:
            url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
            with urllib.request.urlopen(url, timeout=5) as resp:
                import json
                data = json.loads(resp.read())
                models = [m["name"].split(":")[0] for m in data.get("models", [])]
                model_base = self._model.split(":")[0]
                if model_base not in models:
                    available = ", ".join(models) if models else "(chưa có model nào)"
                    raise ValueError(
                        f"Model '{self._model}' chưa được pull trong Ollama.\n"
                        f"  Models hiện có: {available}\n"
                        f"  Chạy: ollama pull {self._model}"
                    )
                print(f"  [Ollama] model={self._model} — server OK")
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(
                f"Không thể kết nối Ollama tại {OLLAMA_BASE_URL}.\n"
                f"  Hãy chắc chắn Ollama đang chạy: ollama serve\n"
                f"  Lỗi: {e}"
            )

    def call(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,        # thấp hơn cloud vì model nhỏ hơn
            max_tokens=4096,
            timeout=self._timeout,
        )
        return resp.choices[0].message.content

    @property
    def name(self) -> str:
        return f"Ollama/{self._model}"
