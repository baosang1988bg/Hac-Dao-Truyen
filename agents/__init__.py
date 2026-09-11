"""
agents/
-------
Package chứa các ADK (Google Agent Development Kit) agent bọc (wrap) lại
pipeline dịch hiện có — Giai đoạn 1 (Foundation) của kế hoạch tích hợp ADK.
Xem đầy đủ bối cảnh/thiết kế tại:
  - plans/adk-agents/README.md          (kế hoạch 3 giai đoạn)
  - plans/adk-agents/research-notes.md  (ghi chú kỹ thuật ADK)

⚠️ QUAN TRỌNG — Toggle & Fallback (đọc trước khi đụng vào package này):

  1. Biến môi trường ADK_ENABLED kiểm soát việc có dùng pipeline ADK hay không.
     Mặc định: "false" (hoặc KHÔNG set biến này trong .env) → ứng dụng dùng
     thẳng `main.cmd_translate_async()` như trước — KHÔNG import bất cứ
     module nào trong package `agents/` ở runtime, hành vi dịch giữ nguyên
     100% so với trước khi có package này.

  2. google-adk là dependency TÙY CHỌN, KHÔNG có trong requirements.txt mặc
     định. Mọi module trong package này (scraper_agent.py, translator_agent.py,
     orchestrator.py) PHẢI tự bọc `import google.adk...` bằng try/except
     ImportError và expose cờ `ADK_AVAILABLE`, để production server chưa cài
     google-adk vẫn khởi động app bình thường (không crash khi import).

  3. Không rewrite logic dịch/crawl — mỗi agent ở đây chỉ gọi lại
     hàm/method đã có sẵn trong scraper.py / translator.py / pipeline.py.

Cách bật thử nghiệm (Giai đoạn 1):
  1. pip install google-adk
  2. Thêm vào .env: ADK_ENABLED=true
  3. routers/translate.py sẽ tự chuyển sang gọi
     agents.orchestrator.run_translation_via_orchestrator(...) cho luồng
     dịch — nếu import agents.orchestrator lỗi vì bất kỳ lý do gì (thiếu
     lib, lỗi cấu hình...), code tự rơi về `cmd_translate_async()` cũ.
"""

import os

# Giá trị an toàn cho ADK_QC_MAX_RETRY/ADK_PASS2_MAX_RETRY nếu biến env
# thiếu/không parse được số nguyên hợp lệ, hoặc âm/quá lớn (D04 — tránh
# vòng lặp chi phí AI vượt kiểm soát vì cấu hình sai).
_RETRY_DEFAULT = 2
_RETRY_MIN = 0
_RETRY_MAX = 10


def is_adk_enabled() -> bool:
    """
    True nếu biến môi trường ADK_ENABLED = "true"/"1"/"yes" (không phân biệt hoa/thường).
    Mặc định (không set, hoặc set giá trị khác) → False → giữ nguyên luồng dịch cũ.
    """
    return os.getenv("ADK_ENABLED", "false").strip().lower() in ("1", "true", "yes")


def _env_flag(name: str, default: bool = False) -> bool:
    """Đọc 1 cờ bool từ env theo đúng pattern của `is_adk_enabled()`."""
    return os.getenv(name, "true" if default else "false").strip().lower() in ("1", "true", "yes")


def is_qc_enabled() -> bool:
    """
    ADK_QC_ENABLED (mặc định "false") — bật QC tự động sau Pass 1 (và sau Pass 2
    nếu Pass 2 cũng bật). Chỉ có ý nghĩa khi `is_adk_enabled()` cũng True.
    """
    return _env_flag("ADK_QC_ENABLED", default=False)


def is_pass2_enabled() -> bool:
    """
    ADK_PASS2_ENABLED (mặc định "false") — bật Polish (Pass 2) sau khi Pass 1
    pass QC (hoặc ngay sau Pass 1 nếu QC tắt). Chỉ có ý nghĩa khi
    `is_adk_enabled()` cũng True.
    """
    return _env_flag("ADK_PASS2_ENABLED", default=False)


def _env_retry_count(name: str, default: int = _RETRY_DEFAULT) -> int:
    """
    Parse số lần retry tối đa từ env, có fallback an toàn:
      - Thiếu biến hoặc không parse được số nguyên → dùng `default`.
      - Giá trị âm hoặc lớn hơn `_RETRY_MAX` (10) → coi là cấu hình sai,
        dùng `default` thay vì để vòng lặp chạy 0 lần (âm) hoặc quá nhiều
        lần (tốn API không kiểm soát).
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw.strip())
    except (TypeError, ValueError):
        return default
    if value < _RETRY_MIN or value > _RETRY_MAX:
        return default
    return value


def get_qc_max_retry() -> int:
    """ADK_QC_MAX_RETRY (mặc định 2) — số lần tối đa gọi lại Pass 1 khi QC fail."""
    return _env_retry_count("ADK_QC_MAX_RETRY", default=_RETRY_DEFAULT)


def get_pass2_max_retry() -> int:
    """ADK_PASS2_MAX_RETRY (mặc định 2) — số lần tối đa gọi lại Polish khi QC (lần 2) fail."""
    return _env_retry_count("ADK_PASS2_MAX_RETRY", default=_RETRY_DEFAULT)


__all__ = [
    "is_adk_enabled",
    "is_qc_enabled",
    "is_pass2_enabled",
    "get_qc_max_retry",
    "get_pass2_max_retry",
]
