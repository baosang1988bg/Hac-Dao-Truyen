"""
tests/test_logs_auth.py
-------------------------
Test cho A02 (kế hoạch review 2026-09-10): GET /api/logs và GET /api/server-info
phải yêu cầu quyền admin — guest/user không có quyền, admin hợp lệ có quyền.

Chạy:  .venv/bin/python -m pytest tests/test_logs_auth.py -v
"""

import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402
import auth  # noqa: E402

client = TestClient(api.app)


def _admin_headers():
    """Cấp token admin hợp lệ trực tiếp qua auth.login (không phụ thuộc .env)."""
    auth.ADMIN_PASSWORD = "test-admin-pw-" + secrets.token_hex(4)
    token = auth.login(auth.ADMIN_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


def _register_user():
    """Đăng ký 1 user thường (không phải admin), trả về header Bearer của user đó."""
    email = f"logsauth-{secrets.token_hex(4)}@test.local"
    r = client.post("/api/user/register",
                    json={"email": email, "password": "matkhau-test-123"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_logs_requires_admin_guest():
    r = client.get("/api/logs")
    assert r.status_code == 401


def test_logs_requires_admin_rejects_normal_user():
    """Token user thường (không phải admin) không được xem log."""
    h = _register_user()
    r = client.get("/api/logs", headers=h)
    assert r.status_code == 401


def test_logs_allows_valid_admin():
    r = client.get("/api/logs", headers=_admin_headers())
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_server_info_requires_admin_guest():
    r = client.get("/api/server-info")
    assert r.status_code == 401


def test_server_info_requires_admin_rejects_normal_user():
    h = _register_user()
    r = client.get("/api/server-info", headers=h)
    assert r.status_code == 401


def test_server_info_allows_valid_admin():
    r = client.get("/api/server-info", headers=_admin_headers())
    assert r.status_code == 200
    assert "server_start" in r.json()


def test_logs_rejects_garbage_token():
    r = client.get("/api/logs", headers={"Authorization": "Bearer khong-ton-tai"})
    assert r.status_code == 401
    r = client.get("/api/logs", headers={"Authorization": "khong-dung-format"})
    assert r.status_code == 401
