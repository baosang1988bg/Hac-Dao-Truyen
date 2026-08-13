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


def is_adk_enabled() -> bool:
    """
    True nếu biến môi trường ADK_ENABLED = "true"/"1"/"yes" (không phân biệt hoa/thường).
    Mặc định (không set, hoặc set giá trị khác) → False → giữ nguyên luồng dịch cũ.
    """
    return os.getenv("ADK_ENABLED", "false").strip().lower() in ("1", "true", "yes")


__all__ = ["is_adk_enabled"]
