"""
translator.py
-------------
Dịch nội dung chương tiểu thuyết sang tiếng Việt.

Thứ tự ưu tiên (TRANSLATION_PROVIDER=auto):
  1. Gemini — thử tất cả key trong pool
  2. Groq   — fallback nếu tất cả Gemini key đều bị 429

Rate limit tự xử lý:
  - Per-minute 429: chờ đúng số giây API yêu cầu rồi retry
  - Per-day 429: rotate sang key khác; nếu hết key thì fallback Groq
"""

import re
import time
import os
import itertools
from config import (
    GOOGLE_API_KEYS, GEMINI_MODEL,
    GROQ_API_KEY, GROQ_MODEL,
    DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL,
    OLLAMA_ENABLED, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT,
    TRANSLATION_PROVIDER, FALLBACK_ORDER,
    REQUEST_DELAY_SECONDS,
    TARGET_LANGUAGE, DEFAULT_TRANSLATION_STYLE,
)

# Model fallback list: rotate khi model bị daily quota
# Đọc từ .env GEMINI_FALLBACK_MODELS, hoặc dùng list mặc định
_raw_fallbacks = os.getenv("GEMINI_FALLBACK_MODELS", "")
GEMINI_MODEL_POOL: list[str] = (
    [m.strip() for m in _raw_fallbacks.split(",") if m.strip()]
    if _raw_fallbacks
    else [
        GEMINI_MODEL,
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-2.0-flash",
        "gemini-3.1-flash-lite-preview",
    ]
)
# Đảm bảo GEMINI_MODEL luôn ở đầu pool
if GEMINI_MODEL not in GEMINI_MODEL_POOL:
    GEMINI_MODEL_POOL.insert(0, GEMINI_MODEL)


# ── Helpers ───────────────────────────────────────────────────────────────────

def build_prompt(title, content, glossary, translation_style, previous_summary=""):
    style = translation_style.strip() or DEFAULT_TRANSLATION_STYLE
    glossary_block = (
        "\n".join(f"  - {k} → {v}" for k, v in glossary.items())
        if glossary else "(No glossary — transliterate Chinese names phonetically into Vietnamese if needed)"
    )
    prev_context = (
        f"--- PREVIOUS CHAPTER SUMMARY (context only, do NOT translate) ---\n{previous_summary}\n\n"
        if previous_summary.strip() else ""
    )
    return f"""You are an expert literary translator specializing in Chinese web novels (网文). Your task is to produce a high-quality Vietnamese translation that reads like it was originally written in Vietnamese — not a translation.

**CRITICAL RULES — MUST FOLLOW:**
1. **ZERO Chinese characters allowed** in the output. Every single Chinese character (汉字) MUST be translated or transliterated into Vietnamese. No exceptions.
2. **Character names**: Use the glossary if provided. Otherwise, transliterate Chinese names phonetically (e.g., 乔桑 → Kiều Tang, 张桑 → Trương Tang, 叶湘婷 → Diệp Tương Đình).
3. **Special terms** (beast tamer ranks, skills, place names): Keep them in Vietnamese flavor (e.g., 御兽师 → Ngự Thú Sư, 火牙狗 → Hỏa Nha Cẩu).
4. **Natural Vietnamese flow**: Avoid stiff, machine-like sentences. Write as a native Vietnamese novelist would.
5. **Pronouns**: Choose contextually appropriate pronouns — 'hắn/y' for male characters, 'nàng/cô' for female, 'ta/tôi' for first person, 'ngươi/anh/em/mày' for second person based on relationship and tone.
6. **Dialogue**: Make conversations feel alive and natural. Avoid overly formal phrasing in casual exchanges.
7. **Do NOT add commentary, translator notes, or summaries inside the chapter content itself.**

--- TRANSLATION STYLE ---
{style}

--- GLOSSARY (follow strictly) ---
{glossary_block}

{prev_context}--- CHAPTER TITLE ---
{title}

--- CHAPTER CONTENT (translate everything below) ---
{content}

--- OUTPUT FORMAT (STRICT) ---
Output ONLY two sections separated by the marker below. Do not add anything else.

# [Dịch tiêu đề chương sang tiếng Việt]

[Nội dung đã dịch — đoạn văn cách nhau bằng dòng trống — KHÔNG có chữ Hán — KHÔNG có tóm tắt]

%%SUMMARY%%
[Tóm tắt ngắn 3-5 câu bằng tiếng Việt để làm context cho chương tiếp theo]"""


def parse_response(raw: str) -> tuple[str, str]:
    # New format: %%SUMMARY%%
    if "%%SUMMARY%%" in raw:
        parts = raw.split("%%SUMMARY%%", 1)
        return parts[0].strip(), parts[1].strip()
    # Fallback: old format
    sep = "--- END OF CHAPTER SUMMARY"
    if sep in raw:
        parts = raw.split(sep, 1)
        return parts[0].strip(), parts[1].strip().lstrip("(Vietnamese, 3-5 sentences)").strip(" -\n")
    return raw.strip(), ""


def build_batch_prompt(chapters: list[tuple[str, str]], glossary, translation_style, previous_summary=""):
    style = translation_style.strip() or DEFAULT_TRANSLATION_STYLE
    glossary_block = (
        "\n".join(f"  - {k} → {v}" for k, v in glossary.items())
        if glossary else "(No glossary — transliterate Chinese names phonetically into Vietnamese if needed)"
    )
    prev_context = (
        f"--- PREVIOUS SUMMARY (context only, do NOT translate) ---\n{previous_summary}\n\n"
        if previous_summary.strip() else ""
    )
    num_ch = len(chapters)   # số chương thực tế trong batch

    chapters_text = ""
    for idx, (title, content) in enumerate(chapters):
        chapters_text += f"\n\n=== CHAPTER {idx} ===\n--- CHAPTER TITLE ---\n{title}\n--- CHAPTER CONTENT ---\n{content}\n"
        
    return f"""You are an expert literary translator specializing in Chinese web novels (网文). Your task is to produce a high-quality Vietnamese translation that reads like it was originally written in Vietnamese — not a translation.

**CRITICAL RULES — MUST FOLLOW:**
1. **ZERO Chinese characters allowed** in the output. Every single Chinese character (汉字) MUST be translated or transliterated into Vietnamese. No exceptions.
2. **Character names**: Use the glossary if provided. Otherwise, transliterate Chinese names phonetically (e.g., 乔桑 → Kiều Tang, 张桑 → Trương Tang, 叶湘婷 → Diệp Tương Đình).
3. **Special terms** (beast tamer ranks, skills, place names): Keep them in Vietnamese flavor (e.g., 御兽师 → Ngự Thú Sư, 火牙狗 → Hỏa Nha Cẩu).
4. **Natural Vietnamese flow**: Avoid stiff, machine-like sentences. Write as a native Vietnamese novelist would.
5. **Pronouns**: Choose contextually appropriate pronouns.
6. **Dialogue**: Make conversations feel alive and natural.
7. **Do NOT add commentary, translator notes, or summaries inside the chapter content itself.**

--- TRANSLATION STYLE ---
{style}

--- GLOSSARY (follow strictly) ---
{glossary_block}

{prev_context}
--- CHAPTERS TO TRANSLATE ---
{chapters_text}

--- OUTPUT FORMAT (STRICT — READ CAREFULLY) ---
CRITICAL: Each chapter MUST be output separately with its own === CHAPTER X === marker.
Even if chapters share the same characters, location, or storyline — they are SEPARATE chapters and MUST be output as SEPARATE sections.
NEVER merge two chapters into one. NEVER skip a chapter. Output ALL {num_ch} chapters.

=== CHAPTER 0 ===
# [Dịch tiêu đề chương 0 sang tiếng Việt]

[Nội dung đã dịch chương 0 — đoạn văn cách nhau bằng dòng trống — KHÔNG có chữ Hán — KHÔNG có tóm tắt]

=== CHAPTER 1 ===
# [Dịch tiêu đề chương 1 sang tiếng Việt]

[Nội dung đã dịch chương 1 — TÁCH BIỆT hoàn toàn với chương 0]

(Continue for ALL {num_ch} chapters — do NOT stop early)

%%SUMMARY%%
[Tóm tắt ngắn 3-5 câu của chương CUỐI CÙNG trong batch bằng tiếng Việt để làm context cho batch tiếp theo]

%%GLOSSARY%%
[Extract 3-5 NEW character names, place names, or martial arts terms introduced in these chapters. Return ONLY valid JSON format: {{"Chinese Name": "Vietnamese Name"}}. If no new important terms, return {{}}]"""

def parse_batch_response(raw: str, num_chapters: int) -> tuple[list[str], str, dict]:
    """Parse batch response into list of chapter texts, a single summary, and new glossary terms."""
    summary = ""
    new_glossary = {}
    
    if "%%GLOSSARY%%" in raw:
        parts = raw.split("%%GLOSSARY%%", 1)
        raw = parts[0]
        glossary_raw = parts[1].strip()
        # Parse JSON
        import json
        import re
        # Find the JSON block inside the text
        match = re.search(r'\{.*\}', glossary_raw, re.DOTALL)
        if match:
            try:
                new_glossary = json.loads(match.group(0))
            except Exception as e:
                print(f"  [⚠] Failed to parse glossary JSON: {e}")

    if "%%SUMMARY%%" in raw:
        parts = raw.split("%%SUMMARY%%", 1)
        raw = parts[0]
        summary = parts[1].strip()
        
    chapters = []
    # Split by === CHAPTER X ===
    import re
    chunks = re.split(r'===\s*CHAPTER\s+\d+\s*===', raw)
    for chunk in chunks:
        chunk = chunk.strip()
        if chunk:
            chapters.append(chunk)

    # Fallback: model không dùng marker → trả về raw làm 1 chương
    if len(chapters) == 0:
        chapters = [raw.strip()]

    # Phát hiện chunk quá ngắn (< 100 chars) — dấu hiệu bị cắt/thiếu nội dung
    # Đánh dấu để caller biết cần retry riêng lẻ
    validated = []
    for i, chunk in enumerate(chapters):
        if len(chunk.strip()) < 100 and i > 0:
            # Chunk đầu tiên có thể ngắn hợp lệ (chương cực ngắn),
            # nhưng chunk giữa/cuối mà < 100 chars thì nghi ngờ bị cắt
            print(f"  [⚠] Chunk {i} rất ngắn ({len(chunk.strip())} chars) — có thể bị cắt")
            validated.append(None)   # None = cần retry riêng lẻ
        else:
            validated.append(chunk)

    # Nếu số chunk ít hơn mong đợi → pad None để caller biết vị trí thiếu
    while len(validated) < num_chapters:
        print(f"  [⚠] Thiếu chunk {len(validated)}/{num_chapters} — sẽ retry riêng lẻ")
        validated.append(None)

    return validated, summary, new_glossary


def estimate_tokens(text: str) -> int:
    """
    Ước tính số token từ text (không cần tokenizer thật).
    Chinese: ~1.5 token/char | Latin/Vietnamese: ~0.3 token/char
    Đủ chính xác để ước tính chi phí và tránh vượt context limit.
    """
    chinese_chars = len(re.findall(r'[一-鿿㐀-䶿]', text))
    other_chars   = len(text) - chinese_chars
    return int(chinese_chars * 1.5 + other_chars * 0.3)


# Bảng giá USD/1M tokens (input, output) — cập nhật 2025
_PRICING: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash":        (0.0,   0.0),    # free tier
    "gemini-2.5-flash-lite":   (0.0,   0.0),    # free tier
    "gemini-2.0-flash":        (0.0,   0.0),    # free tier
    "gemini-flash-lite-latest":(0.0,   0.0),    # free tier
    "deepseek-chat":           (0.07,  1.10),   # DeepSeek V3
    "deepseek-reasoner":       (0.55,  2.19),   # DeepSeek R1
    "llama-3.3-70b-versatile": (0.0,   0.0),    # Groq free tier
}

def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Ước tính chi phí USD cho một lần gọi API."""
    price_in, price_out = _PRICING.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


def has_chinese_chars(text: str) -> bool:
    """Kiểm tra xem text có còn chứa chữ Hán không."""
    return bool(re.search(r'[\u4e00-\u9fff\u3400-\u4dbf]', text))


def build_cleanup_prompt(text: str) -> str:
    """Prompt để Gemini dọn sạch chữ Hán còn sót trong bản dịch."""
    return f"""The following Vietnamese text still contains some Chinese characters (汉字) that were not translated. 
Your task: Replace every Chinese character/word with appropriate Vietnamese transliteration or translation.

Rules:
- Chinese names → phonetic Vietnamese (e.g., 乔桑 → Kiều Tang, 秦守 → Tần Thủ, 方思思 → Phương Tư Tư)
- Chinese place names → phonetic Vietnamese (e.g., 杭港 → Hàng Cảng, 浙江 → Chiết Giang)  
- Chinese terms → meaningful Vietnamese (e.g., 御兽师 → Ngự Thú Sư, 同桌 → bạn cùng bàn)
- Keep ALL existing Vietnamese text exactly as is
- Output ONLY the corrected text, nothing else

Text to fix:
{text}"""


def extract_retry_delay(err: str) -> float:
    """Parse thời gian retry từ error message 429."""
    for pattern in [r"retry[_\s]delay[^\d]*(\d+)", r"retry in (\d+\.?\d*)"]:
        m = re.search(pattern, err, re.IGNORECASE)
        if m:
            return float(m.group(1)) + 3
    return 65.0  # default an toàn nếu không parse được


def is_quota_error(err: str) -> bool:
    return "429" in err or "quota" in err.lower()


def is_daily_quota_error(err: str) -> bool:
    """Phân biệt lỗi hết quota ngày (không retry được) vs hết quota phút (chờ là xong)."""
    return "PerDay" in err or "per_day" in err.lower() or "daily" in err.lower()


# ── Gemini backend ────────────────────────────────────────────────────────────

# ── Key status persistence ────────────────────────────────────────────────────

import json as _json
from datetime import datetime as _dt, timezone as _tz

_KEY_STATUS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "key_status.json")
_QUOTA_RESET_HOURS    = 24  # Gemini free tier quota resets every 24h
_RATE_LIMIT_SKIP_HOURS = 1  # Bỏ qua key bị per-minute rate limit trong 1h


def _load_key_status() -> dict:
    """Load key status từ file. Tạo mới nếu chưa có."""
    if os.path.exists(_KEY_STATUS_FILE):
        try:
            with open(_KEY_STATUS_FILE, "r", encoding="utf-8") as f:
                return _json.load(f)
        except Exception:
            pass
    return {}


def _save_key_status(status: dict):
    """Lưu key status xuống file."""
    try:
        with open(_KEY_STATUS_FILE, "w", encoding="utf-8") as f:
            _json.dump(status, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  [!] Không thể lưu key_status.json: {e}")


def _now_iso() -> str:
    return _dt.now(_tz.utc).isoformat()


def _hours_since(iso_ts: str) -> float:
    """Tính số giờ đã qua kể từ timestamp ISO."""
    try:
        t = _dt.fromisoformat(iso_ts)
        if t.tzinfo is None:
            t = t.replace(tzinfo=_tz.utc)
        return (_dt.now(_tz.utc) - t).total_seconds() / 3600
    except Exception:
        return 999.0


# ── GeminiBackend ─────────────────────────────────────────────────────────────

class GeminiBackend:
    """
    Gemini backend với key health tracking:
      - working       : key đang hoạt động tốt
      - quota_exceeded: hết quota ngày, tự recover sau QUOTA_RESET_HOURS
      - invalid       : key sai/bị thu hồi, không thử lại tự động
    Trạng thái được lưu vào key_status.json và persist giữa các session.
    """

    # Phân loại lỗi theo HTTP status / message
    _INVALID_PATTERNS  = ("400", "401", "403", "API_KEY_INVALID", "invalid api key",
                          "api key not valid", "permission denied")
    _QUOTA_PATTERNS    = ("429", "quota", "RESOURCE_EXHAUSTED", "rate_limit", "rateLimitExceeded")

    def __init__(self):
        if not GOOGLE_API_KEYS:
            raise ValueError("Thiếu GOOGLE_API_KEY — lấy miễn phí: https://aistudio.google.com/app/apikey")
        from google import genai
        self._genai = genai
        self._all_keys      = list(GOOGLE_API_KEYS)
        self._key_status    = _load_key_status()   # dict: key → {status, since, note}
        self._exhausted_models: set[str] = set()
        self._client        = None
        self._current_key   = None
        self._current_model = GEMINI_MODEL_POOL[0]

        # Chạy auto-recovery: key quota_exceeded đã qua 24h → reset về working
        self._maybe_recover_keys()

        # Chọn key đầu tiên khả dụng
        first = self._first_working_key()
        if first is None:
            raise ValueError(
                f"Không có Gemini key nào khả dụng.\n"
                f"  Key status: {self._status_summary()}\n"
                f"  Kiểm tra: python check_keys.py"
            )
        self._apply_key(first)
        print(f"  [Gemini] model={self._current_model} — "
              f"{self._count_working()}/{len(self._all_keys)} key(s) working")

    # ── Key status helpers ────────────────────────────────────────────────────

    def _get_status(self, key: str) -> str:
        return self._key_status.get(key, {}).get("status", "working")

    def _set_status(self, key: str, status: str, note: str = ""):
        self._key_status[key] = {
            "status": status,
            "since":  _now_iso(),
            "note":   note,
            "suffix": f"...{key[-6:]}",
        }
        _save_key_status(self._key_status)

    def _maybe_recover_keys(self):
        """Keys bị quota_exceeded (24h) hoặc rate_limited (1h) → reset về working."""
        recovered = 0
        for key, info in self._key_status.items():
            st    = info.get("status", "working")
            hours = _hours_since(info.get("since", ""))
            if st == "quota_exceeded" and hours >= _QUOTA_RESET_HOURS:
                self._key_status[key]["status"] = "working"
                self._key_status[key]["note"] = f"auto-recovered (quota) after {hours:.1f}h"
                recovered += 1
            elif st == "rate_limited" and hours >= _RATE_LIMIT_SKIP_HOURS:
                self._key_status[key]["status"] = "working"
                self._key_status[key]["note"] = f"auto-recovered (rate-limit) after {hours:.1f}h"
                recovered += 1
        if recovered:
            _save_key_status(self._key_status)
            print(f"  [Gemini] Auto-recovered {recovered} key(s)")

    def _first_working_key(self) -> str | None:
        """Trả về key đầu tiên đang working — bỏ qua rate_limited và quota_exceeded."""
        # Ưu tiên 1: key working hoàn toàn
        for key in self._all_keys:
            if self._get_status(key) == "working":
                return key
        # Fallback: rate_limited đã hết 1h (đã recover ở _maybe_recover_keys)
        return None

    def _count_working(self) -> int:
        return sum(1 for k in self._all_keys if self._get_status(k) == "working")

    def _status_summary(self) -> str:
        counts = {}
        for k in self._all_keys:
            s = self._get_status(k)
            counts[s] = counts.get(s, 0) + 1
        return ", ".join(f"{v} {k}" for k, v in counts.items())

    def _classify_error(self, err: str) -> str:
        """Phân loại lỗi: 'invalid' | 'quota' | 'other'"""
        err_lower = err.lower()
        if any(p.lower() in err_lower for p in self._INVALID_PATTERNS):
            return "invalid"
        if any(p.lower() in err_lower for p in self._QUOTA_PATTERNS):
            return "quota"
        return "other"

    # ── Key rotation ──────────────────────────────────────────────────────────

    def _apply_key(self, key: str):
        self._client      = self._genai.Client(api_key=key)
        self._current_key = key
        print(f"  [Gemini] Using key ...{key[-6:]}")

    def next_available_key(self, error_type: str = "quota") -> bool:
        """
        Đánh dấu key hiện tại là lỗi và rotate sang key tiếp theo.
        error_type: 'quota' | 'invalid' | 'rate_limited'
        """
        if error_type == "rate_limited":
            status = "rate_limited"
            note   = f"per-minute rate limited — skip for {_RATE_LIMIT_SKIP_HOURS}h"
        elif error_type == "quota":
            status = "quota_exceeded"
            note   = "daily quota hit"
        else:
            status = "invalid"
            note   = "API key invalid/revoked"
        self._set_status(self._current_key, status, note)
        print(f"  [Gemini] Key ...{self._current_key[-6:]} → {status}")
        print(f"  [Key status] {self._status_summary()}")

        next_key = self._first_working_key()
        if next_key:
            self._apply_key(next_key)
            return True
        print(f"  [Gemini] No working keys left for model {self._current_model}.")
        return False

    def next_available_model(self) -> bool:
        """
        Rotate sang model mới khi cả pool key đều hết quota cho model hiện tại.
        Reset quota_exceeded keys (chúng có quota riêng cho mỗi model).
        """
        self._exhausted_models.add(self._current_model)
        for model in GEMINI_MODEL_POOL:
            if model not in self._exhausted_models:
                print(f"  [Gemini] Model {self._current_model} exhausted → switching to {model}")
                self._current_model = model
                # Reset quota_exceeded và rate_limited keys cho model mới
                for key in self._all_keys:
                    st = self._get_status(key)
                    if st in ("quota_exceeded", "rate_limited"):
                        self._key_status[key]["status"] = "working"
                        self._key_status[key]["note"] = f"reset for new model {model}"
                _save_key_status(self._key_status)
                first = self._first_working_key()
                if first:
                    self._apply_key(first)
                return True
        print(f"  [Gemini] All {len(GEMINI_MODEL_POOL)} model(s) exhausted.")
        return False

    def all_exhausted(self) -> bool:
        """True khi không còn key nào khả dụng ngay lúc này cho bất kỳ model nào."""
        models_left  = len(GEMINI_MODEL_POOL) - len(self._exhausted_models)
        working_keys = self._count_working()
        return models_left == 0 or (models_left == 1 and working_keys == 0)

    def available_key_count(self) -> int:
        """Số key khả dụng ngay lúc này (working, không bị rate_limited hay quota)."""
        return self._count_working()

    def all_keys_exhausted(self) -> bool:
        return self.all_exhausted()

    def call(self, prompt: str) -> str:
        response = self._client.models.generate_content(
            model=self._current_model,
            contents=prompt,
            config={
                # Explicitly request max output tokens to avoid default 8192 cap
                # Gemini 2.5 Flash supports up to 65536 output tokens
                "max_output_tokens": 65536,
                "temperature": 0.7,
            },
        )
        return response.text

    @property
    def name(self) -> str:
        return f"Gemini/{self._current_model}"


# ── Groq backend ──────────────────────────────────────────────────────────────

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


# ── DeepSeek backend ──────────────────────────────────────────────────────────

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


# ── Ollama backend (local self-host) ──────────────────────────────────────────

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


# ── Main Translator ───────────────────────────────────────────────────────────

class NovelTranslator:
    def __init__(self):
        self._gemini:   GeminiBackend   | None = None
        self._groq:     GroqBackend     | None = None
        self._deepseek: DeepSeekBackend | None = None
        self._ollama:   OllamaBackend   | None = None
        self._last_call_time: float = 0.0
        self._provider = TRANSLATION_PROVIDER
        self._init_backends()

    def _init_backends(self):
        errors = []

        if self._provider in ("gemini", "auto"):
            try:
                self._gemini = GeminiBackend()
                print(f"[✓] Gemini ready — {len(GOOGLE_API_KEYS)} key(s)")
            except Exception as e:
                errors.append(f"Gemini: {e}")

        if self._provider == "groq":  # explicit only, not in auto chain
            try:
                self._groq = GroqBackend()
                print(f"[✓] Groq ready — {GROQ_MODEL}")
            except Exception as e:
                errors.append(f"Groq: {e}")

        if self._provider in ("deepseek", "auto"):
            try:
                self._deepseek = DeepSeekBackend()
                print(f"[✓] DeepSeek ready — {DEEPSEEK_MODEL}")
            except Exception as e:
                errors.append(f"DeepSeek: {e}")

        # Ollama chỉ khởi tạo khi OLLAMA_ENABLED=true
        if OLLAMA_ENABLED and self._provider in ("ollama", "auto"):
            try:
                self._ollama = OllamaBackend()
                print(f"[✓] Ollama ready — {OLLAMA_MODEL} (local)")
            except Exception as e:
                errors.append(f"Ollama: {e}")
                print(f"  [!] Ollama không khả dụng: {e}")

        if not self._gemini and not self._groq and not self._deepseek and not self._ollama:
            raise RuntimeError("Không có backend nào khả dụng:\n" + "\n".join(errors))

    def _throttle(self):
        if REQUEST_DELAY_SECONDS <= 0:
            return
        elapsed = time.time() - self._last_call_time
        wait = REQUEST_DELAY_SECONDS - elapsed
        if wait > 0:
            print(f"  [*] Waiting {wait:.1f}s (rate limit)...")
            time.sleep(wait)

    # ── Gọi Gemini với đầy đủ xử lý 429 ─────────────────────────────────────

    def _call_gemini(self, prompt: str, max_retries: int) -> str:
        """
        Thử gọi Gemini với:
          - Per-minute 429: chờ rồi retry (cùng key, cùng model)
          - Per-day 429:    rotate sang key mới, nếu hết key thì rotate model
          - Hết cả key + model: raise _DailyQuotaExhausted để fallback Groq
        """
        per_minute_retries = 0

        while True:
            if self._gemini.all_exhausted():
                raise _DailyQuotaExhausted("All Gemini keys & models hit daily quota")

            try:
                self._throttle()
                print(f"  [*] Calling {self._gemini.name}...")
                self._last_call_time = time.time()
                return self._gemini.call(prompt)

            except Exception as e:
                err = str(e)
                print(f"  [!] {err[:180]}")

                if not is_quota_error(err):
                    # Kiểm tra nếu là lỗi invalid key → rotate ngay, không retry
                    err_type = self._gemini._classify_error(err)
                    if err_type == "invalid":
                        print(f"  [!] Invalid key detected — rotating...")
                        rotated = self._gemini.next_available_key(error_type="invalid")
                        if not rotated:
                            raise _DailyQuotaExhausted("All Gemini keys invalid or exhausted")
                        per_minute_retries = 0  # reset counter cho key mới
                    else:
                        per_minute_retries += 1
                        if per_minute_retries >= max_retries:
                            raise
                        wait = 2 ** per_minute_retries
                        print(f"  [!] Non-quota error. Retrying in {wait}s...")
                        time.sleep(wait)

                elif is_daily_quota_error(err):
                    # Phân loại: quota hết ngày vs key không hợp lệ
                    err_type = self._gemini._classify_error(err)
                    rotated_key = self._gemini.next_available_key(error_type=err_type)
                    if not rotated_key:
                        # Hết key cho model này → rotate model
                        rotated_model = self._gemini.next_available_model()
                        if not rotated_model:
                            raise _DailyQuotaExhausted("All Gemini keys & models hit daily quota")
                    # Tiếp tục loop với key/model mới

                else:
                    # Per-minute quota → chờ lần đầu, sau đó mark rate_limited
                    per_minute_retries += 1
                    if per_minute_retries >= max_retries:
                        # Retry nhiều lần vẫn bị → đánh dấu key rate_limited 1h
                        # rồi thử sang key khác; nếu hết key mới rotate model
                        print(f"  [!] Key ...{self._gemini._current_key[-6:]} bị rate-limit liên tục → skip 1h")
                        rotated_key = self._gemini.next_available_key(error_type="rate_limited")
                        if rotated_key:
                            per_minute_retries = 0  # thử lại với key mới
                        else:
                            # Hết key → rotate model
                            rotated_model = self._gemini.next_available_model()
                            if not rotated_model:
                                raise _DailyQuotaExhausted(f"Per-minute quota: all keys rate-limited")
                            per_minute_retries = 0
                    else:
                        wait = extract_retry_delay(err)
                        print(f"  [⏳] Per-minute quota. Waiting {wait:.0f}s...")
                        time.sleep(wait)

    # ── Gọi Groq với retry thông thường ──────────────────────────────────────

    def _call_groq(self, prompt: str, max_retries: int) -> str:
        for attempt in range(1, max_retries + 1):
            try:
                self._throttle()
                print(f"  [Fallback] Calling {self._groq.name} (attempt {attempt}/{max_retries})...")
                self._last_call_time = time.time()
                return self._groq.call(prompt)
            except Exception as e:
                err = str(e)
                print(f"  [!] Groq error: {err[:120]}")
                if attempt < max_retries:
                    wait = extract_retry_delay(err) if is_quota_error(err) else 2 ** attempt
                    print(f"  [⏳] Retrying in {wait:.0f}s...")
                    time.sleep(wait)
                else:
                    raise

    # ── Gọi DeepSeek với retry thông thường ──────────────────────────────────

    def _call_deepseek(self, prompt: str, max_retries: int) -> str:
        for attempt in range(1, max_retries + 1):
            try:
                self._throttle()
                print(f"  [Fallback] Calling {self._deepseek.name} (attempt {attempt}/{max_retries})...")
                self._last_call_time = time.time()
                return self._deepseek.call(prompt)
            except Exception as e:
                err = str(e)
                print(f"  [!] DeepSeek error: {err[:120]}")
                if attempt < max_retries:
                    wait = extract_retry_delay(err) if is_quota_error(err) else 2 ** attempt
                    print(f"  [⏳] Retrying in {wait:.0f}s...")
                    time.sleep(wait)
                else:
                    raise

    # ── Gọi Ollama (local) với retry ─────────────────────────────────────────

    def _call_ollama(self, prompt: str, max_retries: int) -> str:
        for attempt in range(1, max_retries + 1):
            try:
                # Không throttle cho local — không có rate limit
                print(f"  [Local] Calling {self._ollama.name} (attempt {attempt}/{max_retries})...")
                return self._ollama.call(prompt)
            except Exception as e:
                err = str(e)
                print(f"  [!] Ollama error: {err[:120]}")
                if attempt < max_retries:
                    wait = 2 ** attempt
                    print(f"  [⏳] Retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    raise

    # ── Public API ────────────────────────────────────────────────────────────

    def translate_chapter(
        self,
        title: str,
        content: str,
        glossary: dict = None,
        translation_style: str = "",
        previous_summary: str = "",
        max_retries: int = 3,
    ) -> tuple[str, str, dict]:
        """Dịch 1 chương. Returns (translated_markdown, chapter_summary, usage).
        usage = {model, input_tokens, output_tokens, cost_usd}
        """
        prompt = build_prompt(title, content, glossary or {}, translation_style, previous_summary)

        raw = None
        _used_model = 'unknown'

        # ── Duyệt qua danh sách fallback ──
        active_chain = FALLBACK_ORDER if self._provider == "auto" else [self._provider]
        
        for p in active_chain:
            if p == "gemini" and self._gemini:
                try:
                    raw = self._call_gemini(prompt, max_retries)
                    _used_model = self._gemini._current_model
                    print(f"  [✓] Gemini success")
                    break
                except _DailyQuotaExhausted as e:
                    print(f"  [!] Gemini unavailable: {e}")
                    if self._provider == "gemini":
                        return f"[Translation failed]\nError: {e}", ""
                    print("  [→] Falling back...")
                except Exception as e:
                    print(f"  [!] Gemini failed: {e}")
                    if self._provider == "gemini":
                        return f"[Translation failed]\nError: {e}", ""
                    print("  [→] Falling back...")
                    
            elif p == "deepseek" and self._deepseek:
                try:
                    raw = self._call_deepseek(prompt, max_retries)
                    _used_model = self._deepseek._model if self._deepseek else 'deepseek-chat'
                    print(f"  [✓] DeepSeek success")
                    break
                except Exception as e:
                    print(f"  [!] DeepSeek failed: {e}")
                    if self._provider == "deepseek":
                        return f"[Translation failed]\nError: {e}", ""
                    print("  [→] Falling back...")
                    
            elif p == "groq" and self._groq:
                try:
                    raw = self._call_groq(prompt, max_retries)
                    print(f"  [✓] Groq success")
                    break
                except Exception as e:
                    print(f"  [!] Groq failed: {e}")
                    if self._provider == "groq":
                        return f"[Translation failed]\nError: {e}", ""
                    print("  [→] Falling back...")
                    
            elif p == "ollama" and self._ollama:
                try:
                    raw = self._call_ollama(prompt, max_retries)
                    _used_model = self._ollama._model if self._ollama else 'ollama'
                    print(f"  [✓] Ollama success")
                    break
                except Exception as e:
                    print(f"  [!] Ollama failed: {e}")
                    if self._provider == "ollama":
                        return f"[Translation failed]\nError: {e}", ""
                    print("  [→] Falling back...")

        if raw is None:
            return "[Translation failed]\nError: No backend available", ""

        translated, summary = parse_response(raw)

        # Tính usage stats
        in_tok  = estimate_tokens(prompt)
        out_tok = estimate_tokens(raw)
        cost    = estimate_cost(_used_model, in_tok, out_tok)
        cost_str = f'~${cost:.5f}' if cost > 0 else 'free'
        _usage = {
            "model":         _used_model,
            "input_tokens":  in_tok,
            "output_tokens": out_tok,
            "total_tokens":  in_tok + out_tok,
            "cost_usd":      cost,
        }
        print(f'  [💰] {_used_model}: ~{in_tok}→{out_tok} tokens, {cost_str}')

        # ── Bước 4: Cleanup pass — dọn sạch chữ Hán còn sót ──
        if has_chinese_chars(translated):
            chinese_count = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', translated))
            print(f"  [⚠] Found {chinese_count} Chinese chars in output. Running cleanup pass...")
            cleanup_prompt = build_cleanup_prompt(translated)
            try:
                if self._gemini and not self._gemini.all_keys_exhausted():
                    cleaned = self._call_gemini(cleanup_prompt, max_retries=2)
                elif self._deepseek:
                    cleaned = self._call_deepseek(cleanup_prompt, max_retries=2)
                elif self._ollama:
                    cleaned = self._call_ollama(cleanup_prompt, max_retries=2)
                else:
                    cleaned = translated
                if not has_chinese_chars(cleaned):
                    print("  [✓] Cleanup successful — no more Chinese chars")
                    translated = cleaned
                else:
                    remaining = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', cleaned))
                    print(f"  [⚠] Cleanup reduced to {remaining} chars (some may be intentional in quotes)")
                    translated = cleaned
            except Exception as e:
                print(f"  [!] Cleanup pass failed: {e}")

        return translated, summary, _usage

    def translate_batch(
        self,
        chapters: list[tuple[str, str]],
        glossary: dict = None,
        translation_style: str = "",
        previous_summary: str = "",
        max_retries: int = 3,
    ) -> tuple[list[str], str, dict, dict]:
        """Dịch 1 lúc nhiều chương (batch).
        Returns (list_of_translated_markdown, batch_summary, new_glossary, usage).
        usage = {model, input_tokens, output_tokens, total_tokens, cost_usd}
        """
        prompt = build_batch_prompt(chapters, glossary or {}, translation_style, previous_summary)
        raw = None
        _batch_model = "unknown"

        # ── Duyệt qua danh sách fallback ──
        active_chain = FALLBACK_ORDER if self._provider == "auto" else [self._provider]
        
        for p in active_chain:
            if p == "gemini" and self._gemini:
                try:
                    raw = self._call_gemini(prompt, max_retries)
                    _batch_model = self._gemini._current_model
                    print(f"  [✓] Gemini success")
                    break
                except _DailyQuotaExhausted as e:
                    print(f"  [!] Gemini unavailable: {e}")
                    if self._provider == "gemini":
                        return [f"[Translation failed]\nError: {e}"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}
                    print("  [→] Falling back...")
                except Exception as e:
                    print(f"  [!] Gemini failed: {e}")
                    if self._provider == "gemini":
                        return [f"[Translation failed]\nError: {e}"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}
                    print("  [→] Falling back...")
                    
            elif p == "deepseek" and self._deepseek:
                try:
                    raw = self._call_deepseek(prompt, max_retries)
                    _batch_model = self._deepseek._model if self._deepseek else "deepseek-chat"
                    print(f"  [✓] DeepSeek success")
                    break
                except Exception as e:
                    print(f"  [!] DeepSeek failed: {e}")
                    if self._provider == "deepseek":
                        return [f"[Translation failed]\nError: {e}"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}
                    print("  [→] Falling back...")
                    
            elif p == "groq" and self._groq:
                try:
                    raw = self._call_groq(prompt, max_retries)
                    print(f"  [✓] Groq success")
                    break
                except Exception as e:
                    print(f"  [!] Groq failed: {e}")
                    if self._provider == "groq":
                        return [f"[Translation failed]\nError: {e}"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}
                    print("  [→] Falling back...")
                    
            elif p == "ollama" and self._ollama:
                try:
                    raw = self._call_ollama(prompt, max_retries)
                    _batch_model = self._ollama._model if self._ollama else "ollama"
                    print(f"  [✓] Ollama success")
                    break
                except Exception as e:
                    print(f"  [!] Ollama failed: {e}")
                    if self._provider == "ollama":
                        return [f"[Translation failed]\nError: {e}"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}
                    print("  [→] Falling back...")



        if raw is None:
            return ["[Translation failed]\nError: No backend available"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}

        translated_chapters, summary, new_glossary = parse_batch_response(raw, len(chapters))

        # Cleanup pass
        cleaned_chapters = []
        for translated in translated_chapters:
            if has_chinese_chars(translated):
                chinese_count = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', translated))
                print(f"  [⚠] Found {chinese_count} Chinese chars. Running cleanup pass...")
                cleanup_prompt = build_cleanup_prompt(translated)
                try:
                    if self._gemini and not self._gemini.all_keys_exhausted():
                        cleaned = self._call_gemini(cleanup_prompt, max_retries=2)
                    elif self._deepseek:
                        cleaned = self._call_deepseek(cleanup_prompt, max_retries=2)
                    elif self._ollama:
                        cleaned = self._call_ollama(cleanup_prompt, max_retries=2)
                    else:
                        cleaned = translated
                    if not has_chinese_chars(cleaned):
                        print("  [✓] Cleanup successful")
                        translated = cleaned
                    else:
                        print("  [⚠] Cleanup pass left some Chinese chars")
                        translated = cleaned
                except Exception as e:
                    print(f"  [!] Cleanup pass failed: {e}")
            cleaned_chapters.append(translated)

        # Tính usage cho cả batch
        in_tok   = estimate_tokens(prompt)
        out_tok  = estimate_tokens(raw) if raw else 0
        cost     = estimate_cost(_batch_model, in_tok, out_tok)
        cost_str = f"~${cost:.5f}" if cost > 0 else "free"
        print(f"  [💰] {_batch_model} (batch {len(chapters)}ch): ~{in_tok}→{out_tok} tokens, {cost_str}")
        _batch_usage = {
            "model":         _batch_model,
            "input_tokens":  in_tok,
            "output_tokens": out_tok,
            "total_tokens":  in_tok + out_tok,
            "cost_usd":      cost,
            "chapters":      len(chapters),
        }
        return cleaned_chapters, summary, new_glossary, _batch_usage



class _DailyQuotaExhausted(Exception):
    """Raised khi tất cả Gemini key đã hết daily quota."""
    pass


if __name__ == "__main__":
    t = NovelTranslator()
    translated, summary, _ = t.translate_chapter(
        title="The Silent Wind",
        content="The wind whispered through the ancient trees, carrying secrets of a forgotten era.",
        glossary={"The Forgotten Era": "Thời Đại Bị Lãng Quên"},
    )
    print("=== TRANSLATION ===\n", translated)
    print("\n=== SUMMARY ===\n", summary)
