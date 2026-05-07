"""
config.py
---------
Global settings cho toàn bộ project.
Settings riêng của từng truyện (glossary, style, URL...) nằm trong novels/<slug>/novel.json
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── Gemini API ────────────────────────────────────────────────────────────────
# Hỗ trợ nhiều API key, cách nhau bằng dấu phẩy để rotate khi bị 429
# Ví dụ: GOOGLE_API_KEYS="key1,key2,key3"
# Nếu chỉ có 1 key thì dùng GOOGLE_API_KEY như cũ
_raw_keys = os.getenv("GOOGLE_API_KEYS", "") or os.getenv("GOOGLE_API_KEY", "")
GOOGLE_API_KEYS: list[str] = [k.strip() for k in _raw_keys.split(",") if k.strip()]
GOOGLE_API_KEY = GOOGLE_API_KEYS[0] if GOOGLE_API_KEYS else ""
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# ── Groq API (fallback miễn phí khi Gemini hết quota) ─────────────────────────
# Đăng ký tại: https://console.groq.com  →  tạo API key miễn phí
# Model mặc định: llama-3.3-70b-versatile (chất lượng cao, 14400 req/ngày free)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# ── DeepSeek API ───────────────────────────────────────────────────────────────
# Đăng ký tại: https://platform.deepseek.com  →  tạo API key
# Model mặc định: deepseek-chat (DeepSeek-V3, chất lượng cao, giá rẻ)
# Các model: deepseek-chat | deepseek-reasoner
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# ── Ollama (Local self-host) ────────────────────────────────────────────────────
# Chạy model local qua Ollama (https://ollama.com)
# Khuyên dùng: Hunyuan-MT-7B-Q4_K_M (RTX 4060 8GB đủ chạy)
# Cài Ollama → tải model → set OLLAMA_MODEL=hunyuan-mt
#
# Setup nhanh:
#   1. Tải Ollama: https://ollama.com/download
#   2. ollama pull hunyuan-mt   (hoặc tạo Modelfile từ GGUF — xem use.md)
#   3. Set OLLAMA_ENABLED=true trong .env
#
# Ollama dùng OpenAI-compatible API nên không cần cài thêm thư viện
OLLAMA_ENABLED  = os.getenv("OLLAMA_ENABLED", "false").lower() == "true"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "hunyuan-mt")
# Timeout riêng cho local model (giây) — local chậm hơn API cloud
OLLAMA_TIMEOUT  = int(os.getenv("OLLAMA_TIMEOUT", "120"))

# Provider ưu tiên: "gemini" | "deepseek" | "ollama" | "groq" | "auto"
# "auto" = Gemini → DeepSeek → Ollama (local) theo thứ tự
# Gợi ý: bỏ groq khỏi rotation nếu không dùng nữa (dễ gây lỗi 413)
TRANSLATION_PROVIDER = os.getenv("TRANSLATION_PROVIDER", "auto")

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Gemini free tier: 15 requests/phút → delay tối thiểu 4s giữa các request
# Set = 0 để tắt delay (nếu dùng paid tier)
REQUEST_DELAY_SECONDS = float(os.getenv("REQUEST_DELAY_SECONDS", "4"))

# ── Batch translation ──────────────────────────────────────────────────────────
# BATCH_SIZE: số chương tối đa gửi cùng 1 lần cho AI (1–10)
#   - Cao hơn = nhanh hơn, tốn ít API call hơn, nhưng dễ vượt token limit
#   - Thấp hơn = an toàn hơn với chương dài, nhưng tốn nhiều API call hơn
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "3"))

# MAX_CONCURRENT_BATCHES: số lượng batch tối đa dịch song song
#   - Dịch đa luồng giúp vượt qua nút thắt cổ chai của việc chờ API
#   - Khuyên dùng: 3-5 đối với API free tier
MAX_CONCURRENT_BATCHES = int(os.getenv("MAX_CONCURRENT_BATCHES", "3"))

# BATCH_MAX_CHARS: tổng ký tự tối đa của tất cả content trong 1 batch
#   Nếu thêm chương mới vào batch mà vượt ngưỡng này → tự động flush batch trước,
#   rồi giảm batch size cho lần tiếp theo.
#   Ước tính: 1 ký tự Chinese ≈ 1.5 token → 6000 chars ≈ 9000 tokens (an toàn cho Groq 12k)
#   Groq limit: ~8000 chars | Gemini/DeepSeek: ~20000 chars
BATCH_MAX_CHARS = int(os.getenv("BATCH_MAX_CHARS", "8000"))

# ── Translation defaults (dùng khi novel profile không override) ──────────────
TARGET_LANGUAGE = "Vietnamese"
DEFAULT_TRANSLATION_STYLE = (
    "Natural, literary, engaging, and culturally appropriate Vietnamese. "
    "Avoid word-for-word translation. Use 'Hán-Việt' terms where appropriate for a novelistic feel."
)

# ── Scraper ───────────────────────────────────────────────────────────────────
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"

# ── Paths ─────────────────────────────────────────────────────────────────────
NOVELS_BASE_DIR = "novels"   # thư mục chứa tất cả truyện
LOG_DIR = "logs"

# ── Multi-site selector config ────────────────────────────────────────────────
# Key = domain substring, value = dict CSS selectors + lambda navigators
SITE_SELECTORS = {
    "novel543.com": {
        "title": "h1",
        "content": "#content",
        "prev": lambda soup: next((a for a in soup.find_all("a") if "上一" in a.get_text() or "Prev" in a.get_text()), None),
        "next": lambda soup: next((a for a in soup.find_all("a") if "下一" in a.get_text() or "Next" in a.get_text()), None),
    },
    # 69shuba.com — Chinese novel site, encoding GBK/GB2312
    # Selector dựa theo cấu trúc HTML phổ biến của site này:
    #   title: h1 hoặc .title69 / .booktitle
    #   content: #contentbox hoặc .txtnav / .contentbox
    #   nav: link có text 下一章 / 上一章
    "69shuba.com": {
        "title": "h1, .title69, .booktitle, .readtitle",
        "content": "#contentbox, .contentbox, #content, .txtnav, .readcontent",
        # Use get_text() not .string — catches links with nested <span> tags
        "prev": lambda soup: next(
            (a for a in soup.find_all("a") if "上一章" in a.get_text() or "上一" in a.get_text()), None
        ),
        "next": lambda soup: next(
            (a for a in soup.find_all("a") if "下一章" in a.get_text()), None
        ) or next(
            (a for a in soup.find_all("a") if "下一" in a.get_text()), None
        ),
    },
    "default": {
        "title": "h1, h2, h3, .title, .chapter-title",
        "content": "#content, .content, .chapter-content, .content-body, .text-content",
        "prev": lambda soup: next(
            (a for a in soup.find_all("a") if any(k in a.get_text() for k in ["上一", "Prev", "Previous", "前一章"])), None
        ),
        "next": lambda soup: next(
            (a for a in soup.find_all("a") if any(k in a.get_text() for k in ["下一", "Next", "后一章"])), None
        ),
    },
}
