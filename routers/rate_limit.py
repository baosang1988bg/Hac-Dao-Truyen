"""
routers/rate_limit.py
----------------------
Rate limiter in-memory (per-process) cho các endpoint dễ bị brute-force:
đăng nhập admin, đăng nhập user, đăng ký user.

Thuật toán: sliding window log — mỗi key giữ 1 deque timestamp các lần gọi
gần đây; khi số lượng trong cửa sổ [now - window_sec, now] vượt `limit` thì
từ chối (429) kèm header Retry-After.

⚠️ GIỚI HẠN QUAN TRỌNG — chỉ đúng trong 1 PROCESS:
_bucket là dict Python thuần trong bộ nhớ tiến trình hiện tại. Nếu server
chạy nhiều worker process (vd. `gunicorn -w N`, hoặc `uvicorn --workers N`),
mỗi process có bộ đếm RIÊNG — không share bộ nhớ giữa các worker. Kẻ tấn
công có thể gửi request rải qua nhiều worker (round-robin) để mỗi worker chỉ
thấy một phần nhỏ số lần thử, làm giới hạn thực tế cao hơn N lần so với cấu
hình (N × số worker). Muốn đúng khi scale nhiều worker/nhiều instance, cần
chuyển sang store dùng chung giữa các process (Redis, Memcached, DB có TTL,
...) — chưa cần thiết ở quy mô hiện tại (1 process, single-server).

⚠️ Client key dùng `request.client.host` — địa chỉ IP kết nối TCP THẬT tới
Uvicorn (do OS/ASGI server xác định, không phải do client tự khai báo).
KHÔNG đọc `X-Forwarded-For` / `X-Real-IP`: các header này client tự set được
trong request nên có thể giả mạo để "đổi IP" và bypass giới hạn theo IP. Nếu
sau này server chạy sau 1 reverse proxy đáng tin cậy (Nginx/Caddy...) thì chỉ
nên tin các header đó khi có cấu hình tường minh (vd. allowlist IP của proxy
để biết header nào do proxy ghi đè, không phải do client đầu cuối gửi thẳng)
— hiện repo CHƯA có cấu hình proxy nào như vậy nên module này luôn bỏ qua mọi
header proxy, kể cả khi client cố tình gửi kèm.
"""

import os
import threading
import time
from collections import deque

from fastapi import HTTPException, Request


class InMemoryRateLimiter:
    """Sliding-window rate limiter cho 1 nhóm endpoint (vd. "login")."""

    def __init__(self, limit: int, window_sec: float):
        if limit <= 0:
            raise ValueError("limit phải > 0")
        if window_sec <= 0:
            raise ValueError("window_sec phải > 0")
        self.limit = limit
        self.window_sec = window_sec
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _client_key(request: Request) -> str:
        """Chỉ dùng địa chỉ IP kết nối TCP thật — không tin header proxy."""
        client = request.client
        return client.host if client is not None else "unknown"

    def check(self, key: str) -> None:
        """Raise HTTPException 429 nếu `key` đã vượt giới hạn trong cửa sổ hiện tại."""
        now = time.time()
        with self._lock:
            dq = self._hits.setdefault(key, deque())
            # Loại các lần gọi đã ra khỏi cửa sổ trượt
            while dq and dq[0] <= now - self.window_sec:
                dq.popleft()
            if len(dq) >= self.limit:
                retry_after = max(0.0, self.window_sec - (now - dq[0]))
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Quá nhiều yêu cầu, thử lại sau {int(retry_after) + 1} giây"
                    ),
                    headers={"Retry-After": str(int(retry_after) + 1)},
                )
            dq.append(now)

    def reset(self) -> None:
        """Xóa toàn bộ bộ đếm — dùng trong test để tránh rò rỉ trạng thái giữa các test."""
        with self._lock:
            self._hits.clear()

    def as_dependency(self, bucket_name: str):
        """Tạo FastAPI dependency áp giới hạn riêng cho 1 bucket (vd. 'login')."""

        def _dependency(request: Request) -> None:
            key = f"{bucket_name}:{self._client_key(request)}"
            self.check(key)

        return _dependency


def _limiter_from_env(prefix: str, default_limit: int, default_window: float) -> InMemoryRateLimiter:
    limit = int(os.getenv(f"{prefix}_MAX", str(default_limit)))
    window = float(os.getenv(f"{prefix}_WINDOW_SEC", str(default_window)))
    return InMemoryRateLimiter(limit=limit, window_sec=window)


# Giới hạn mặc định: 5 lần / 60 giây cho mỗi IP — riêng theo từng loại endpoint
# để brute-force 1 endpoint không vô tình khóa luôn endpoint khác.
# Có thể chỉnh qua .env: RATE_LIMIT_ADMIN_LOGIN_MAX, RATE_LIMIT_ADMIN_LOGIN_WINDOW_SEC, ...
admin_login_rate_limiter = _limiter_from_env("RATE_LIMIT_ADMIN_LOGIN", 5, 60)
login_rate_limiter = _limiter_from_env("RATE_LIMIT_LOGIN", 5, 60)
register_rate_limiter = _limiter_from_env("RATE_LIMIT_REGISTER", 5, 60)
