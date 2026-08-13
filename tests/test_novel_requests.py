"""
tests/test_novel_requests.py
-----------------------------
Integration test cho tính năng "Request Novel" — độc giả gửi URL truyện muốn
dịch, admin duyệt/từ chối. Hợp đồng API này được Worker Cloudflare (D1) làm
theo (src/index.js: novelRequestCreate/novelRequestsMine/adminNovelRequests*),
đổi shape ở đây phải đổi cả hai nơi.

Chạy:  python3 -m pytest tests/test_novel_requests.py -v
"""

import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
import api  # noqa: E402
import auth  # noqa: E402

client = TestClient(api.app)


def _register_user():
    """Đăng ký user mới với email ngẫu nhiên, trả về (headers, user)."""
    email = f"nr{secrets.token_hex(4)}@test.local"
    password = "matkhau-test-123"
    r = client.post("/api/user/register",
                    json={"email": email, "password": password, "name": "Tester"})
    assert r.status_code == 201
    body = r.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]


def _admin_headers():
    """Cấp token admin hợp lệ trực tiếp qua auth.login (không phụ thuộc .env)."""
    auth.ADMIN_PASSWORD = "test-admin-pw-" + secrets.token_hex(4)
    token = auth.login(auth.ADMIN_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


def test_novel_request_full_flow():
    h, user = _register_user()

    # Gửi request hợp lệ → 201 {id}
    r = client.post("/api/novel-requests",
                     json={"url": "https://example.com/novel/1", "note": "Truyện hay"},
                     headers=h)
    assert r.status_code == 201, r.text
    req_id = r.json()["id"]
    assert isinstance(req_id, int)

    # Thấy trong /mine, status pending
    r = client.get("/api/novel-requests/mine", headers=h)
    assert r.status_code == 200
    mine = r.json()
    assert len(mine) == 1
    assert mine[0]["id"] == req_id
    assert mine[0]["status"] == "pending"
    assert mine[0]["url"] == "https://example.com/novel/1"

    # URL không hợp lệ (thiếu scheme) → 400
    r = client.post("/api/novel-requests", json={"url": "example.com/no-scheme"}, headers=h)
    assert r.status_code == 400

    # Gửi thêm 2 request nữa cho đủ 3 pending
    for i in range(2):
        r = client.post("/api/novel-requests",
                         json={"url": f"https://example.com/novel/{i + 2}"}, headers=h)
        assert r.status_code == 201

    # Request thứ 4 khi đang có 3 pending → 429
    r = client.post("/api/novel-requests", json={"url": "https://example.com/novel/4"}, headers=h)
    assert r.status_code == 429, f"phải chặn spam pending, được {r.status_code}"

    # User thường gọi endpoint admin → 401 (thiếu token admin, có token user cũng không hợp lệ)
    r = client.get("/api/admin/novel-requests", headers=h)
    assert r.status_code == 401

    r = client.post(f"/api/admin/novel-requests/{req_id}/review",
                     json={"status": "approved"}, headers=h)
    assert r.status_code == 401

    # Không token admin → 401
    r = client.get("/api/admin/novel-requests")
    assert r.status_code == 401

    # Admin xem danh sách, thấy đủ request + email
    ah = _admin_headers()
    r = client.get("/api/admin/novel-requests", headers=ah)
    assert r.status_code == 200
    all_reqs = r.json()
    found = next((x for x in all_reqs if x["id"] == req_id), None)
    assert found is not None
    assert found["email"] == user["email"]
    assert found["status"] == "pending"

    # Lọc theo status=pending
    r = client.get("/api/admin/novel-requests?status=pending", headers=ah)
    assert r.status_code == 200
    assert all(x["status"] == "pending" for x in r.json())

    # Admin duyệt request đầu tiên
    r = client.post(f"/api/admin/novel-requests/{req_id}/review",
                     json={"status": "approved", "admin_note": "OK, sẽ import"}, headers=ah)
    assert r.status_code == 200 and r.json() == {"ok": True}

    # Status đổi thành approved trong /mine
    r = client.get("/api/novel-requests/mine", headers=h)
    updated = next(x for x in r.json() if x["id"] == req_id)
    assert updated["status"] == "approved"
    assert updated["admin_note"] == "OK, sẽ import"
    assert updated["reviewed_at"] is not None

    # status không hợp lệ → 400
    r = client.post(f"/api/admin/novel-requests/{req_id}/review",
                     json={"status": "banana"}, headers=ah)
    assert r.status_code == 400

    # id không tồn tại → 404
    r = client.post("/api/admin/novel-requests/999999999/review",
                     json={"status": "rejected"}, headers=ah)
    assert r.status_code == 404

    # Duyệt lại lần 2 request đã approved ở trên → 409 (double-review), KHÔNG phải 200
    r = client.post(f"/api/admin/novel-requests/{req_id}/review",
                     json={"status": "rejected", "admin_note": "đổi ý"}, headers=ah)
    assert r.status_code == 409, f"double-review phải bị chặn 409, được {r.status_code}"

    # Status vẫn giữ nguyên approved (không bị ghi đè bởi lần review thứ 2)
    r = client.get("/api/novel-requests/mine", headers=h)
    still_approved = next(x for x in r.json() if x["id"] == req_id)
    assert still_approved["status"] == "approved"
    assert still_approved["admin_note"] == "OK, sẽ import"


def test_novel_request_requires_login():
    r = client.post("/api/novel-requests", json={"url": "https://example.com/x"})
    assert r.status_code == 401
    r = client.get("/api/novel-requests/mine")
    assert r.status_code == 401


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {fn.__name__}: lỗi {type(e).__name__}: {e}")
    total = len(fns)
    print(f"\n{passed}/{total} PASS")
    sys.exit(0 if passed == total else 1)
