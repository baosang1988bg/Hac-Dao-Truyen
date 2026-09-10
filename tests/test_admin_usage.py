"""
tests/test_admin_usage.py
--------------------------
Test cho GET /api/admin/sync-usage — hiển thị ước lượng ngân sách sync cục bộ
(đọc tools/.cloud_sync_budget.json, KHÔNG phải billing Cloudflare thật).

Chạy:  python3 -m pytest tests/test_admin_usage.py -v
"""

import json
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


def test_sync_usage_requires_admin():
    r = client.get("/api/admin/sync-usage")
    assert r.status_code == 401


def test_sync_usage_file_missing(tmp_path, monkeypatch):
    missing = tmp_path / "khong-ton-tai.json"
    monkeypatch.setenv("HACDAO_BUDGET_FILE", str(missing))
    r = client.get("/api/admin/sync-usage", headers=_admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert "reason" in body


def test_sync_usage_file_present(tmp_path, monkeypatch):
    budget_file = tmp_path / ".cloud_sync_budget.json"
    budget_file.write_text(json.dumps({
        "r2_ops": 12,
        "r2_month": "2026-09",
        "d1_ops": 34,
        "d1_day": "2026-09-10",
    }), encoding="utf-8")
    monkeypatch.setenv("HACDAO_BUDGET_FILE", str(budget_file))
    r = client.get("/api/admin/sync-usage", headers=_admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert body["r2_ops"] == 12
    assert body["r2_month"] == "2026-09"
    assert body["d1_ops"] == 34
    assert body["d1_day"] == "2026-09-10"
    assert isinstance(body.get("note"), str) and body["note"]
