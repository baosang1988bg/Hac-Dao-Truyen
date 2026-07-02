"""
auth.py
-------
Xác thực server-side cho REST API.

- Mật khẩu admin đọc từ .env (ADMIN_PASSWORD) — KHÔNG còn hardcode ở client.
- POST /api/auth/login  → so sánh mật khẩu (constant-time), phát session token.
- Token lưu in-memory kèm thời điểm hết hạn (mặc định 7 ngày).
- Các endpoint ghi/dịch dùng dependency `require_admin` để kiểm tra
  header `Authorization: Bearer <token>`.
"""

import os
import hmac
import time
import secrets
import threading

from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv()  # đảm bảo .env được nạp dù module này import trước config

# ── Cấu hình ──────────────────────────────────────────────────────────────────
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
# TTL của token (giây) — mặc định 7 ngày
AUTH_TOKEN_TTL = int(os.getenv("AUTH_TOKEN_TTL", str(7 * 24 * 3600)))

# ── Session store (in-memory) ─────────────────────────────────────────────────
# token → expiry_timestamp
_sessions: dict[str, float] = {}
_lock = threading.Lock()


def _purge_expired() -> None:
    """Xóa các token đã hết hạn (gọi trong lúc giữ _lock)."""
    now = time.time()
    expired = [t for t, exp in _sessions.items() if exp < now]
    for t in expired:
        _sessions.pop(t, None)


def login(password: str) -> str:
    """
    Kiểm tra mật khẩu và phát token mới.
    Raise HTTPException 401 nếu sai, 503 nếu server chưa cấu hình ADMIN_PASSWORD.
    """
    if not ADMIN_PASSWORD:
        raise HTTPException(
            status_code=503,
            detail="Server chưa cấu hình ADMIN_PASSWORD trong .env",
        )
    # So sánh constant-time để tránh timing attack
    if not hmac.compare_digest(password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Sai mật khẩu quản trị")

    token = secrets.token_urlsafe(32)
    with _lock:
        _purge_expired()
        _sessions[token] = time.time() + AUTH_TOKEN_TTL
    return token


def logout(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


def _is_valid(token: str) -> bool:
    with _lock:
        exp = _sessions.get(token)
        if exp is None:
            return False
        if exp < time.time():
            _sessions.pop(token, None)
            return False
        return True


def require_admin(authorization: str = Header(default="")) -> str:
    """
    FastAPI dependency — dùng cho các endpoint cần quyền admin:

        @app.post("/api/...", dependencies=[Depends(require_admin)])
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Thiếu token xác thực")
    token = authorization[len("Bearer "):].strip()
    if not _is_valid(token):
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn")
    return token
