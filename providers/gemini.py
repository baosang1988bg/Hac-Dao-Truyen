"""
providers/gemini.py
-------------------
GeminiBackend — backend Google Gemini với key rotation + model rotation.

Key health tracking (persist qua key_status.json — xem providers/key_manager.py):
  - working       : key đang hoạt động tốt
  - quota_exceeded: hết quota ngày, tự recover sau 24h
  - invalid       : key sai/bị thu hồi, không thử lại tự động
"""

import os

from config import GOOGLE_API_KEYS, GEMINI_MODEL
from providers.key_manager import (
    _QUOTA_RESET_HOURS, _RATE_LIMIT_SKIP_HOURS,
    _load_key_status, _save_key_status, _now_iso,
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


class _DailyQuotaExhausted(Exception):
    """Raised khi tất cả Gemini key đã hết daily quota."""
    pass


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
        from providers.key_manager import _hours_since
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
