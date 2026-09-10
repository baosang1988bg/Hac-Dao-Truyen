"""
tests/test_auth_rate_limit.py
-------------------------------
Test cho rate limiter in-memory (A03 — kế hoạch review 2026-09-10):
- Brute-force login/register/admin-login bị chặn sau N lần.
- Cửa sổ thời gian (sliding window) hết hạn thì được reset đúng.
- Không bypass được bằng cách giả header proxy (X-Forwarded-For/X-Real-IP).

Rate limiter dùng chung 1 dict in-memory cho toàn tiến trình test — fixture
`isolated_app` (autouse, conftest.py) đã reset 3 limiter này trước/sau MỖI
test, nên các test dưới đây không rò rỉ trạng thái sang test khác.

Chạy:  .venv/bin/python -m pytest tests/test_auth_rate_limit.py -v
"""

import os
import secrets
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402
import auth  # noqa: E402
from routers.rate_limit import (  # noqa: E402
    InMemoryRateLimiter,
    admin_login_rate_limiter,
    login_rate_limiter,
    register_rate_limiter,
)

client = TestClient(api.app)


def test_admin_login_blocked_after_n_attempts():
    """N lần sai mật khẩu đầu tiên vẫn là 401 (không phải bị limiter chặn sớm);
    lần thứ N+1 (kể cả gõ đúng mật khẩu) phải bị chặn 429."""
    auth.ADMIN_PASSWORD = "mat-khau-dung-" + secrets.token_hex(4)
    limit = admin_login_rate_limiter.limit

    for i in range(limit):
        r = client.post("/api/auth/login", json={"password": "sai-mat-khau"})
        assert r.status_code == 401, f"lần thử {i + 1}/{limit} phải là 401, được {r.status_code}"

    r = client.post("/api/auth/login", json={"password": auth.ADMIN_PASSWORD})
    assert r.status_code == 429, f"phải bị chặn sau {limit} lần thử, được {r.status_code}"
    assert "Retry-After" in r.headers


def test_admin_login_recovers_after_reset():
    """Sau khi bị chặn, reset thủ công (hoặc cửa sổ trôi qua) thì login lại được."""
    auth.ADMIN_PASSWORD = "mat-khau-dung-2-" + secrets.token_hex(4)
    limit = admin_login_rate_limiter.limit
    for _ in range(limit):
        client.post("/api/auth/login", json={"password": "sai"})
    r = client.post("/api/auth/login", json={"password": auth.ADMIN_PASSWORD})
    assert r.status_code == 429

    admin_login_rate_limiter.reset()
    r = client.post("/api/auth/login", json={"password": auth.ADMIN_PASSWORD})
    assert r.status_code == 200, "sau reset phải login được bình thường"
    assert "token" in r.json()


def test_rate_limiter_window_expiry_directly():
    """Kiểm tra logic sliding-window: quá cửa sổ thì request cũ bị loại khỏi bộ
    đếm và request mới lại được chấp nhận (không cần chờ reset thủ công)."""
    limiter = InMemoryRateLimiter(limit=2, window_sec=0.2)
    limiter.check("1.2.3.4")
    limiter.check("1.2.3.4")
    with pytest.raises(HTTPException) as exc_info:
        limiter.check("1.2.3.4")
    assert exc_info.value.status_code == 429

    time.sleep(0.25)  # cửa sổ đã trôi qua
    limiter.check("1.2.3.4")  # không raise — bộ đếm đã được reset theo thời gian


def test_user_register_blocked_after_n_attempts():
    limit = register_rate_limiter.limit
    for i in range(limit):
        r = client.post(
            "/api/user/register",
            json={
                "email": f"rl-register-{i}-{secrets.token_hex(3)}@test.local",
                "password": "matkhau-test-123",
            },
        )
        assert r.status_code == 201, f"lần {i + 1}/{limit} phải 201, được {r.status_code}: {r.text}"

    r = client.post(
        "/api/user/register",
        json={
            "email": f"rl-register-extra-{secrets.token_hex(3)}@test.local",
            "password": "matkhau-test-123",
        },
    )
    assert r.status_code == 429, f"phải bị chặn sau {limit} lần đăng ký, được {r.status_code}"


def test_user_login_blocked_after_n_attempts():
    # Tạo 1 user hợp lệ trước (không tính vào bộ đếm login)
    email = f"rl-login-{secrets.token_hex(4)}@test.local"
    password = "matkhau-test-123"
    r = client.post("/api/user/register", json={"email": email, "password": password})
    assert r.status_code == 201

    limit = login_rate_limiter.limit
    for i in range(limit):
        r = client.post("/api/user/login", json={"email": email, "password": "sai-mat-khau"})
        assert r.status_code == 401, f"lần {i + 1}/{limit} phải 401, được {r.status_code}"

    # Lần kế tiếp — dù gõ đúng mật khẩu — vẫn bị chặn vì đã vượt giới hạn
    r = client.post("/api/user/login", json={"email": email, "password": password})
    assert r.status_code == 429, f"phải bị chặn sau {limit} lần thử, được {r.status_code}"


def test_rate_limit_not_bypassed_by_spoofed_proxy_headers():
    """Client tự khai X-Forwarded-For/X-Real-IP khác nhau mỗi request không
    được dùng để tách bộ đếm — limiter chỉ tin request.client.host thật."""
    limit = login_rate_limiter.limit
    statuses = []
    for i in range(limit + 3):
        r = client.post(
            "/api/user/login",
            json={"email": "khong-ton-tai@test.local", "password": "x"},
            headers={
                "X-Forwarded-For": f"203.0.113.{i}",
                "X-Real-IP": f"198.51.100.{i}",
            },
        )
        statuses.append(r.status_code)

    assert 429 in statuses, (
        "dù mỗi request khai báo header proxy khác nhau, vẫn phải bị chặn theo "
        f"IP kết nối thật (statuses={statuses})"
    )
    # Toàn bộ trước khi bị chặn phải là 401 (sai email/password), không phải lỗi khác
    assert all(s in (401, 429) for s in statuses)
