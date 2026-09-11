"""
test_translator_ollama.py
--------------------------
B06 — Provider Ollama.

Quyết định (xem báo cáo cuối cùng để biết đầy đủ bằng chứng): nhánh dịch
Ollama trong translator.py (đơn + batch + cleanup pass) chỉ đơn thuần bị
COMMENT OUT dù providers/ollama.py (OllamaBackend) vẫn là code hợp lý, đầy
đủ (kết nối OpenAI-compatible API, kiểm tra model đã pull, retry sẵn có ở
_call_ollama) và NovelTranslator._init_backends() vẫn khởi tạo self._ollama
khi OLLAMA_ENABLED=true. Vì vậy đã HOÀN THIỆN lại (uncomment) nhánh dịch đơn
+ batch cho Ollama trong translate_chapter/translate_batch + cleanup pass,
thay vì loại bỏ.

Test này dùng MOCK OllamaBackend (không cài/gọi Ollama thật, không network).
Đồng thời có test cho B06 phần 2: nhánh Groq trước đây không set _used_model
khi thành công → usage log luôn ghi "unknown" dù dịch thành công bằng Groq.
"""
import translator
from translator import NovelTranslator, GROQ_MODEL


class FakeOllamaBackend:
    """Mock OllamaBackend — không gọi Ollama thật, chỉ trả response giả lập."""

    def __init__(self, responses=None, model="hunyuan-mt", fail_times=0):
        self._model = model
        self._responses = list(responses) if responses is not None else None
        self._fail_times = fail_times
        self.calls = []

    @property
    def name(self):
        return f"Ollama/{self._model}"

    def call(self, prompt: str) -> str:
        self.calls.append(prompt)
        if self._fail_times > 0 and len(self.calls) <= self._fail_times:
            raise RuntimeError("ollama connection refused (giả lập)")
        if self._responses is not None:
            idx = min(len(self.calls) - 1, len(self._responses) - 1)
            return self._responses[idx]
        return "# Chương Không\n\nNội dung dịch bởi Ollama.\n\n%%SUMMARY%%\nTóm tắt Ollama."


class FakeDeepSeekBackend:
    def __init__(self, response, model="deepseek-chat"):
        self._model = model
        self._response = response

    @property
    def name(self):
        return f"DeepSeek/{self._model}"

    def call(self, prompt: str) -> str:
        return self._response


class FakeGroqBackend:
    def __init__(self, response):
        self._response = response

    @property
    def name(self):
        return f"Groq/{GROQ_MODEL}"

    def call(self, prompt: str) -> str:
        return self._response


def _make_translator(provider="ollama"):
    """Tạo NovelTranslator KHÔNG chạy __init__/_init_backends thật (tránh cần
    API key/network thật) — tự set các backend giả lập cần thiết."""
    t = object.__new__(NovelTranslator)
    t._gemini = None
    t._groq = None
    t._deepseek = None
    t._ollama = None
    t._last_call_time = 0.0
    t._provider = provider
    return t


def _no_sleep(monkeypatch):
    """Không sleep thật khi test retry (2**attempt giây)."""
    monkeypatch.setattr(translator.time, "sleep", lambda *_a, **_k: None)


# ── Dịch 1 chương bằng Ollama ─────────────────────────────────────────────────

def test_ollama_dich_1_chuong_thanh_cong():
    t = _make_translator(provider="ollama")
    t._ollama = FakeOllamaBackend(
        responses=["# Chương Một\n\nĐây là nội dung đã dịch bởi Ollama local.\n\n"
                   "%%SUMMARY%%\nTóm tắt ngắn gọn."]
    )

    translated, summary, usage = t.translate_chapter(
        title="第一章", content="这是中文内容", glossary={}, translation_style="",
    )

    assert "nội dung đã dịch bởi Ollama" in translated
    assert summary == "Tóm tắt ngắn gọn."
    assert usage["model"] == "hunyuan-mt"
    assert len(t._ollama.calls) == 1


def test_ollama_that_bai_ca_max_retries_tra_ve_loi_ro_rang(monkeypatch):
    _no_sleep(monkeypatch)
    t = _make_translator(provider="ollama")
    t._ollama = FakeOllamaBackend(fail_times=99)  # luôn luôn lỗi

    translated, summary, usage = t.translate_chapter(
        title="X", content="nội dung", glossary={}, translation_style="",
        max_retries=2,
    )

    assert "[Translation failed]" in translated
    assert usage == {}


def test_ollama_retry_thanh_cong_sau_1_lan_loi(monkeypatch):
    """_call_ollama phải retry (không bung lỗi ngay) khi lần gọi đầu thất bại."""
    _no_sleep(monkeypatch)
    t = _make_translator(provider="ollama")
    t._ollama = FakeOllamaBackend(
        fail_times=1,
        responses=["# Chương Hai\n\nDịch thành công sau khi retry.\n\n%%SUMMARY%%\nTóm tắt."],
    )

    translated, summary, usage = t.translate_chapter(
        title="X", content="nội dung", glossary={}, translation_style="",
        max_retries=3,
    )

    assert "Dịch thành công sau khi retry." in translated
    assert len(t._ollama.calls) == 2   # 1 lần lỗi + 1 lần thành công


# ── Dịch batch bằng Ollama ────────────────────────────────────────────────────

def test_ollama_dich_batch_thanh_cong():
    t = _make_translator(provider="ollama")
    raw = (
        "=== CHAPTER 0 ===\n"
        "# Chương Không\n\n" + ("Nội dung chương không dịch bởi Ollama batch. " * 8) +
        "\n\n=== CHAPTER 1 ===\n"
        "# Chương Một\n\n" + ("Nội dung chương một dịch bởi Ollama batch. " * 8) +
        "\n\n%%SUMMARY%%\nTóm tắt batch.\n\n%%GLOSSARY%%\n{}"
    )
    t._ollama = FakeOllamaBackend(responses=[raw])

    chapters = [("Chương 0", "nội dung 0"), ("Chương 1", "nội dung 1")]
    translated_list, summary, new_glossary, usage = t.translate_batch(chapters, glossary={})

    assert len(translated_list) == 2
    assert "chương không dịch bởi Ollama batch" in translated_list[0]
    assert "chương một dịch bởi Ollama batch" in translated_list[1]
    assert summary == "Tóm tắt batch."
    assert usage["model"] == "hunyuan-mt"
    assert usage["parse_errors"] == []


# ── Fallback: Ollama lỗi trong auto chain → rơi sang backend kế tiếp ─────────

def test_ollama_loi_trong_auto_chain_fallback_sang_deepseek(monkeypatch):
    monkeypatch.setattr(translator, "FALLBACK_ORDER", ["ollama", "deepseek"])
    t = _make_translator(provider="auto")
    t._ollama = FakeOllamaBackend(fail_times=99)
    t._deepseek = FakeDeepSeekBackend(
        response="# Chương\n\nDịch bởi DeepSeek sau khi Ollama lỗi.\n\n%%SUMMARY%%\nTóm tắt."
    )

    translated, summary, usage = t.translate_chapter(
        title="X", content="nội dung dài hơn ngưỡng chương ngắn " * 20,
        glossary={}, translation_style="", max_retries=1,
    )

    assert "Dịch bởi DeepSeek sau khi Ollama lỗi." in translated
    assert usage["model"] == "deepseek-chat"


# ── Cleanup pass dùng Ollama khi đó là backend duy nhất ─────────────────────

def test_cleanup_pass_dung_ollama_khi_chi_co_ollama():
    t = _make_translator(provider="ollama")
    # Bản dịch đầu còn sót chữ Hán -> cleanup pass phải gọi Ollama (backend
    # duy nhất có sẵn) để dọn sạch.
    first_response = "# Chương\n\nCòn sót 汉字 chưa dịch.\n\n%%SUMMARY%%\nTóm tắt."
    cleaned_response = "Đã dọn sạch, không còn chữ Hán."
    t._ollama = FakeOllamaBackend(responses=[first_response, cleaned_response])

    translated, summary, usage = t.translate_chapter(
        title="X", content="nội dung", glossary={}, translation_style="",
    )

    assert "汉字" not in translated
    assert "Đã dọn sạch" in translated
    assert len(t._ollama.calls) == 2  # 1 lần dịch + 1 lần cleanup


# ── B06 phần 2: Groq phải ghi ĐÚNG model đã dùng, không phải "unknown" ──────

def test_groq_thanh_cong_ghi_dung_model_trong_usage_khong_phai_unknown():
    t = _make_translator(provider="groq")
    t._groq = FakeGroqBackend(
        response="# Chương\n\nDịch bởi Groq.\n\n%%SUMMARY%%\nTóm tắt."
    )

    translated, summary, usage = t.translate_chapter(
        title="X", content="nội dung", glossary={}, translation_style="",
    )

    assert "Dịch bởi Groq." in translated
    assert usage["model"] == GROQ_MODEL
    assert usage["model"] != "unknown"


def test_groq_batch_thanh_cong_ghi_dung_model_khong_phai_unknown():
    t = _make_translator(provider="groq")
    raw = (
        "=== CHAPTER 0 ===\n" + "Nội dung chương không Groq batch. " * 8 +
        "\n\n%%SUMMARY%%\nTóm tắt.\n\n%%GLOSSARY%%\n{}"
    )
    t._groq = FakeGroqBackend(response=raw)

    translated_list, summary, new_glossary, usage = t.translate_batch(
        [("Chương 0", "nội dung 0")], glossary={}
    )

    assert usage["model"] == GROQ_MODEL
    assert usage["model"] != "unknown"
