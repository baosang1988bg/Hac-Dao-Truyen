"""
providers/key_manager.py
------------------------
Lưu/đọc trạng thái các API key (key_status.json) — dùng chung cho GeminiBackend.

Trạng thái mỗi key:
  - working        : key đang hoạt động tốt
  - quota_exceeded : hết quota ngày, tự recover sau _QUOTA_RESET_HOURS
  - rate_limited   : bị per-minute rate limit, bỏ qua trong _RATE_LIMIT_SKIP_HOURS
  - invalid        : key sai/bị thu hồi, không thử lại tự động
"""

import os
import json as _json
import threading
from datetime import datetime as _dt, timezone as _tz

# key_status.json nằm ở thư mục gốc project (cạnh translator.py)
_KEY_STATUS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "key_status.json"
)
_QUOTA_RESET_HOURS    = 24  # Gemini free tier quota resets every 24h
_RATE_LIMIT_SKIP_HOURS = 1  # Bỏ qua key bị per-minute rate limit trong 1h

# Khóa module-level cho thao tác đọc-sửa-ghi key_status.json — tránh 2 thread
# (2 batch dịch chạy song song) ghi đè mất cập nhật của nhau khi cùng gọi
# _save_key_status().
_key_status_lock = threading.Lock()


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
    """Lưu key status xuống file (khóa lại để tránh 2 thread ghi đè lẫn nhau)."""
    with _key_status_lock:
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
