"""
translator.py
-------------
Dịch nội dung chương tiểu thuyết sang tiếng Việt.

File này là FACADE: giữ nguyên public API (NovelTranslator, build_prompt,
estimate_tokens...) — code backend cụ thể (Gemini/DeepSeek/Groq/Ollama)
đã được tách vào package providers/.

Thứ tự ưu tiên (TRANSLATION_PROVIDER=auto):
  1. Gemini — thử tất cả key trong pool
  2. Groq   — fallback nếu tất cả Gemini key đều bị 429

Rate limit tự xử lý:
  - Per-minute 429: chờ đúng số giây API yêu cầu rồi retry
  - Per-day 429: rotate sang key khác; nếu hết key thì fallback Groq
"""

import re
import time
import functools
from config import (
    GOOGLE_API_KEYS,
    GROQ_MODEL,
    DEEPSEEK_MODEL,
    OLLAMA_ENABLED, OLLAMA_MODEL,
    TRANSLATION_PROVIDER, FALLBACK_ORDER,
    REQUEST_DELAY_SECONDS,
    TARGET_LANGUAGE, DEFAULT_TRANSLATION_STYLE,
    SHORT_CHAPTER_THRESHOLD, SHORT_CHAPTER_PROVIDER,
)

# ── Backends (đã tách sang package providers/) ────────────────────────────────
# Re-export để code cũ (`from translator import GeminiBackend`...) vẫn chạy.
from providers import (
    GeminiBackend, DeepSeekBackend, GroqBackend, OllamaBackend,
    GEMINI_MODEL_POOL, _DailyQuotaExhausted,
    _KEY_STATUS_FILE, _QUOTA_RESET_HOURS, _RATE_LIMIT_SKIP_HOURS,
    _load_key_status, _save_key_status, _now_iso, _hours_since,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def build_prompt(title, content, glossary, translation_style, previous_summary=""):
    style = translation_style.strip() or DEFAULT_TRANSLATION_STYLE

    # Lọc glossary động để giảm thiểu token thừa và tăng tốc độ xử lý cho model local
    if glossary:
        glossary = {k: v for k, v in glossary.items() if k in content or k in title}

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
8. **DO NOT change or hallucinate the chapter number in the title.** If the original title says "第二十四" or "Chương 24", the translation MUST keep it as "Chương 24". Do NOT output random numbers like "Chương 1118".
9. **TRANSLATE COMPLETELY**: Do not skip paragraphs, do not summarize, do not omit any words. The translation must match the source content line by line without any missing text.

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

    # Lọc glossary động cho toàn bộ batch
    if glossary:
        full_text = " ".join(t + " " + c for t, c in chapters)
        glossary = {k: v for k, v in glossary.items() if k in full_text}

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
8. **DO NOT change or hallucinate the chapter number in the title.** If the original title says "第二十四" or "Chương 24", the translation MUST keep it as "Chương 24". Do NOT output random numbers like "Chương 1118".
9. **TRANSLATE COMPLETELY**: Do not skip paragraphs, do not summarize, do not omit any words. The translation must match the source content line by line without any missing text.

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


# Regex chữ Hán — compile 1 lần, dùng lại cho estimate/cleanup (tránh recompile)
_CHINESE_CHARS_RE = re.compile(r'[一-鿿㐀-䶿]')
_CHINESE_ANY_RE   = re.compile(r'[一-鿿㐀-䶿]')


@functools.lru_cache(maxsize=1024)
def _estimate_tokens_cached(text: str) -> int:
    """Tính token estimate 1 lần cho mỗi content string (cache bằng lru_cache)."""
    chinese_chars = len(_CHINESE_CHARS_RE.findall(text))
    other_chars   = len(text) - chinese_chars
    return int(chinese_chars * 1.5 + other_chars * 0.3)


def estimate_tokens(text: str) -> int:
    """
    Ước tính số token từ text (không cần tokenizer thật).
    Chinese: ~1.5 token/char | Latin/Vietnamese: ~0.3 token/char
    Đủ chính xác để ước tính chi phí và tránh vượt context limit.
    Kết quả được cache theo content string — tránh chạy lại regex khi
    cùng 1 nội dung được ước tính nhiều lần (batch + retry).
    """
    return _estimate_tokens_cached(text)


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
    return bool(_CHINESE_ANY_RE.search(text))


def count_chinese_chars(text: str) -> int:
    """Đếm số chữ Hán trong text (1 lần quét regex duy nhất)."""
    return len(_CHINESE_ANY_RE.findall(text))


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
                    err_type = self._gemini._classify_error(err)
                    if err_type == "model_not_found":
                        print(f"  [!] Model {self._gemini._current_model} not found/deprecated → rotating to next model...")
                        rotated = self._gemini.next_available_model()
                        if not rotated:
                            raise _DailyQuotaExhausted("All Gemini models unavailable")
                        per_minute_retries = 0
                        continue
                    elif err_type == "invalid":
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

        # Ngưỡng chương ngắn -> Ưu tiên đưa SHORT_CHAPTER_PROVIDER lên đầu chain
        if len(content) < SHORT_CHAPTER_THRESHOLD:
            print(f"  [*] Chương ngắn ({len(content)} ký tự < {SHORT_CHAPTER_THRESHOLD}) -> Ưu tiên dùng provider rẻ: {SHORT_CHAPTER_PROVIDER}")
            if SHORT_CHAPTER_PROVIDER in active_chain:
                active_chain = [SHORT_CHAPTER_PROVIDER] + [p for p in active_chain if p != SHORT_CHAPTER_PROVIDER]
            else:
                active_chain = [SHORT_CHAPTER_PROVIDER] + active_chain

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
                        return f"[Translation failed]\nError: {e}", "", {}
                    print("  [→] Falling back...")
                except Exception as e:
                    print(f"  [!] Gemini failed: {e}")
                    if self._provider == "gemini":
                        return f"[Translation failed]\nError: {e}", "", {}
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
                        return f"[Translation failed]\nError: {e}", "", {}
                    print("  [→] Falling back...")

            elif p == "groq" and self._groq:
                try:
                    raw = self._call_groq(prompt, max_retries)
                    print(f"  [✓] Groq success")
                    break
                except Exception as e:
                    print(f"  [!] Groq failed: {e}")
                    if self._provider == "groq":
                        return f"[Translation failed]\nError: {e}", "", {}
                    print("  [→] Falling back...")

            # elif p == "ollama" and self._ollama:
            #     try:
            #         raw = self._call_ollama(prompt, max_retries)
            #         _used_model = self._ollama._model if self._ollama else 'ollama'
            #         print(f"  [✓] Ollama success")
            #         break
            #     except Exception as e:
            #         print(f"  [!] Ollama failed: {e}")
            #         if self._provider == "ollama":
            #             return f"[Translation failed]\nError: {e}", ""
            #         print("  [→] Falling back...")

        if raw is None:
            return "[Translation failed]\nError: No backend available", "", {}

        translated, summary = parse_response(raw)

        # ── Bước 3.5: Sửa lỗi dính chữ (stuck paragraphs) ──
        translated = self._fix_stuck_paragraphs(translated)

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
        chinese_count = count_chinese_chars(translated)
        if chinese_count:
            print(f"  [⚠] Found {chinese_count} Chinese chars in output. Running cleanup pass...")
            cleanup_prompt = build_cleanup_prompt(translated)
            try:
                if self._gemini and not self._gemini.all_keys_exhausted():
                    cleaned = self._call_gemini(cleanup_prompt, max_retries=2)
                elif self._deepseek:
                    cleaned = self._call_deepseek(cleanup_prompt, max_retries=2)
                # elif self._ollama:
                #     cleaned = self._call_ollama(cleanup_prompt, max_retries=2)
                else:
                    cleaned = translated
                remaining = count_chinese_chars(cleaned)
                if not remaining:
                    print("  [✓] Cleanup successful — no more Chinese chars")
                    translated = cleaned
                else:
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

        # Ngưỡng chương ngắn -> Ưu tiên đưa SHORT_CHAPTER_PROVIDER lên đầu chain cho batch ngắn
        total_content_len = sum(len(c[1]) for c in chapters)
        avg_len = total_content_len / len(chapters) if chapters else 0
        if avg_len < SHORT_CHAPTER_THRESHOLD:
            print(f"  [*] Batch ngắn (TB {avg_len:.0f} ký tự < {SHORT_CHAPTER_THRESHOLD}) -> Ưu tiên dùng provider rẻ: {SHORT_CHAPTER_PROVIDER}")
            if SHORT_CHAPTER_PROVIDER in active_chain:
                active_chain = [SHORT_CHAPTER_PROVIDER] + [p for p in active_chain if p != SHORT_CHAPTER_PROVIDER]
            else:
                active_chain = [SHORT_CHAPTER_PROVIDER] + active_chain

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

            # elif p == "ollama" and self._ollama:
            #     try:
            #         raw = self._call_ollama(prompt, max_retries)
            #         _batch_model = self._ollama._model if self._ollama else "ollama"
            #         print(f"  [✓] Ollama success")
            #         break
            #     except Exception as e:
            #         print(f"  [!] Ollama failed: {e}")
            #         if self._provider == "ollama":
            #             return [f"[Translation failed]\nError: {e}"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}
            #         print("  [→] Falling back...")



        if raw is None:
            return ["[Translation failed]\nError: No backend available"] * len(chapters), "", {}, {"model":"unknown","input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0}

        translated_chapters, summary, new_glossary = parse_batch_response(raw, len(chapters))

        # ── Bước 3.5: Sửa lỗi dính chữ cho từng chương ──
        translated_chapters = [self._fix_stuck_paragraphs(ch) if ch else ch for ch in translated_chapters]

        # Cleanup pass
        cleaned_chapters = []
        for translated in translated_chapters:
            if translated:
                chinese_count = count_chinese_chars(translated)
            else:
                chinese_count = 0
            if chinese_count:
                print(f"  [⚠] Found {chinese_count} Chinese chars. Running cleanup pass...")
                cleanup_prompt = build_cleanup_prompt(translated)
                try:
                    if self._gemini and not self._gemini.all_keys_exhausted():
                        cleaned = self._call_gemini(cleanup_prompt, max_retries=2)
                    elif self._deepseek:
                        cleaned = self._call_deepseek(cleanup_prompt, max_retries=2)
                    # elif self._ollama:
                    #     cleaned = self._call_ollama(cleanup_prompt, max_retries=2)
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

    def _fix_stuck_paragraphs(self, text: str) -> str:
        """
        Phát hiện và sửa các đoạn văn bị 'dính' (quá dài).
        Chỉ ngắt đoạn khi khối văn bản > 300 ký tự và chọn điểm ngắt là sau 2-3 câu.
        """
        if not text:
            return text

        lines = text.split('\n')
        fixed_lines = []

        for line in lines:
            stripped = line.strip()
            # Bỏ qua tiêu đề hoặc dòng ngắn
            if not stripped or line.startswith('#') or len(stripped) < 300:
                fixed_lines.append(line)
                continue

            # Tách thành các câu (giữ lại dấu câu)
            parts = re.split(r'([.!?…])\s+', stripped)

            new_block = ""
            current_segment = ""

            # Duyệt qua các cặp (nội dung câu, dấu câu)
            for i in range(0, len(parts) - 1, 2):
                sentence = parts[i] + parts[i+1]
                current_segment += sentence + " "

                # Nếu đoạn hiện tại đã đủ dài (> 250 ký tự), thực hiện ngắt
                if len(current_segment) > 250:
                    new_block += current_segment.strip() + "\n\n"
                    current_segment = ""

            # Thêm phần còn lại
            new_block += current_segment.strip()
            fixed_lines.append(new_block.strip())

        return '\n\n'.join([l for l in fixed_lines if l.strip()])


if __name__ == "__main__":
    t = NovelTranslator()
    translated, summary, _ = t.translate_chapter(
        title="The Silent Wind",
        content="The wind whispered through the ancient trees, carrying secrets of a forgotten era.",
        glossary={"The Forgotten Era": "Thời Đại Bị Lãng Quên"},
    )
    print("=== TRANSLATION ===\n", translated)
    print("\n=== SUMMARY ===\n", summary)
