"""
tests/test_integration.py
-------------------------
Bộ integration test contract API (roadmap 1.4) — chạy bằng FastAPI TestClient
trên dữ liệu thật trong novels/, không cần server.

Chạy:  python3 -m pytest tests/test_integration.py -v
hoặc:  python3 tests/test_integration.py   (chạy trực tiếp, in ✓/✗)

Các test này là "hợp đồng" của API guest — Worker Cloudflare (src/index.js)
phải trả cùng shape. Nếu sửa routers/novels.py, sửa cả Worker.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
import api  # noqa: E402

client = TestClient(api.app)

# Field cấm lộ cho guest — đồng bộ với _PUBLIC_FIELDS (routers/novels.py)
FORBIDDEN_GUEST_FIELDS = {"glossary", "source_url", "last_translated_url"}
REQUIRED_LIST_FIELDS = {"slug", "title", "chapter_count", "glossary_count"}


def _first_translated_slug():
    r = client.get("/api/novels")
    for n in r.json():
        if n.get("chapter_count", 0) > 0:
            return n["slug"]
    return None


# ── Guest: danh sách & chi tiết ──────────────────────────────────────────────

def test_list_novels_public_shape():
    r = client.get("/api/novels")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) > 0
    for n in data:
        assert REQUIRED_LIST_FIELDS <= set(n.keys()), f"thiếu field: {n.get('slug')}"
        leak = FORBIDDEN_GUEST_FIELDS & set(n.keys())
        assert not leak, f"lộ field {leak} trong /api/novels ({n.get('slug')})"


def test_novel_detail_guest_no_glossary():
    slug = _first_translated_slug()
    assert slug, "cần ít nhất 1 truyện đã dịch trong novels/"
    r = client.get(f"/api/novels/{slug}")
    assert r.status_code == 200
    n = r.json()
    leak = FORBIDDEN_GUEST_FIELDS & set(n.keys())
    assert not leak, f"lộ field {leak} trong chi tiết truyện"
    assert n["chapter_count"] > 0


def test_read_one_chapter():
    slug = _first_translated_slug()
    r = client.get(f"/api/novels/{slug}/chapters")
    assert r.status_code == 200
    chapters = r.json()
    assert len(chapters) > 0
    ident = chapters[0].get("filename") or chapters[0].get("chapter_number")
    r2 = client.get(f"/api/novels/{slug}/chapters/{ident}")
    assert r2.status_code == 200
    assert len(r2.json().get("content", "")) > 50


# ── Bảo mật ──────────────────────────────────────────────────────────────────

def test_translate_requires_admin():
    slug = _first_translated_slug()
    r = client.post(f"/api/novels/{slug}/translate", json={"chapters": 1})
    assert r.status_code == 401, f"translate không token phải 401, được {r.status_code}"


def test_glossary_update_requires_admin():
    slug = _first_translated_slug()
    r = client.post(f"/api/novels/{slug}/glossary", json={"glossary": {"a": "b"}})
    assert r.status_code == 401


def test_path_traversal_blocked():
    for evil in ("..%2F..%2Fetc", "..", "a/../../etc"):
        r = client.get(f"/api/novels/{evil}")
        assert r.status_code in (400, 404, 422), \
            f"slug độc '{evil}' phải bị chặn, được {r.status_code}"


def test_chapter_path_traversal_blocked():
    slug = _first_translated_slug()
    r = client.get(f"/api/novels/{slug}/chapters/..%2F..%2Fnovel.json")
    assert r.status_code in (400, 404, 422)


# ── User system (roadmap 3.1–3.4) ────────────────────────────────────────────
# Email ngẫu nhiên mỗi lần chạy để test idempotent (DB users.db persist).

import random  # noqa: E402
import secrets  # noqa: E402


def _register_user():
    """Đăng ký user mới với email ngẫu nhiên, trả về (email, password, token, user)."""
    email = f"t{secrets.token_hex(4)}@test.local"
    password = "matkhau-test-123"
    r = client.post("/api/user/register",
                    json={"email": email, "password": password, "name": "Tester"})
    assert r.status_code == 201, f"register phải 201, được {r.status_code}"
    body = r.json()
    assert body.get("token", "").startswith("u_")
    assert body["user"]["email"] == email
    return email, password, body["token"], body["user"]


def test_user_full_flow():
    email, password, token, user = _register_user()
    h = {"Authorization": f"Bearer {token}"}

    # me
    r = client.get("/api/user/me", headers=h)
    assert r.status_code == 200 and r.json()["email"] == email

    # login lại
    r = client.post("/api/user/login", json={"email": email, "password": password})
    assert r.status_code == 200 and r.json()["user"]["id"] == user["id"]

    # login sai mật khẩu → 401
    r = client.post("/api/user/login", json={"email": email, "password": "sai-mat-khau"})
    assert r.status_code == 401

    # bookmark PUT / GET / DELETE
    slug = _first_translated_slug()
    assert slug, "cần ít nhất 1 truyện đã dịch trong novels/"
    r = client.put(f"/api/user/bookmarks/{slug}", headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True}
    # idempotent — PUT lần 2 vẫn ok
    assert client.put(f"/api/user/bookmarks/{slug}", headers=h).status_code == 200
    r = client.get("/api/user/bookmarks", headers=h)
    assert r.status_code == 200
    assert [b["slug"] for b in r.json()] == [slug]
    r = client.delete(f"/api/user/bookmarks/{slug}", headers=h)
    assert r.status_code == 200
    assert client.get("/api/user/bookmarks", headers=h).json() == []

    # progress PUT / GET
    r = client.put(f"/api/user/progress/{slug}", json={"chapter": 7}, headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True}
    r = client.get("/api/user/progress", headers=h)
    assert r.status_code == 200
    prog = r.json()
    assert len(prog) == 1 and prog[0]["slug"] == slug and prog[0]["chapter"] == 7

    # đăng ký lại email trùng → 409
    r = client.post("/api/user/register",
                    json={"email": email, "password": password})
    assert r.status_code == 409


def test_user_comments_flow():
    _, _, token, _ = _register_user()
    h = {"Authorization": f"Bearer {token}"}
    slug = _first_translated_slug()
    # Chapter ngẫu nhiên lớn để lọc đúng comment của lần chạy này
    chapter = random.randint(10**6, 10**7)

    # POST comment → 201 {id}
    r = client.post(f"/api/novels/{slug}/comments",
                    json={"chapter": chapter, "content": "Truyện hay!"}, headers=h)
    assert r.status_code == 201, f"comment phải 201, được {r.status_code}"
    comment_id = r.json()["id"]

    # comment thứ 2 ngay lập tức → 429 (rate limit 20s)
    r = client.post(f"/api/novels/{slug}/comments",
                    json={"chapter": chapter, "content": "Spam thử"}, headers=h)
    assert r.status_code == 429, f"comment spam phải 429, được {r.status_code}"

    # GET comments (public, không cần token) thấy đúng 1 comment
    r = client.get(f"/api/novels/{slug}/comments?chapter={chapter}")
    assert r.status_code == 200
    comments = r.json()
    assert len(comments) == 1
    assert comments[0]["id"] == comment_id
    assert comments[0]["user_name"] == "Tester"
    assert comments[0]["content"] == "Truyện hay!"

    # content rỗng → 400
    r = client.post(f"/api/novels/{slug}/comments",
                    json={"chapter": chapter, "content": "   "}, headers=h)
    assert r.status_code == 400  # check nội dung rỗng phải đứng trước rate limit
    # DELETE bằng người lạ → 403
    _, _, token2, _ = _register_user()
    r = client.delete(f"/api/comments/{comment_id}",
                      headers={"Authorization": f"Bearer {token2}"})
    assert r.status_code == 403
    # DELETE bằng chính chủ → 200
    r = client.delete(f"/api/comments/{comment_id}", headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True}
    r = client.get(f"/api/novels/{slug}/comments?chapter={chapter}")
    assert r.json() == []


def test_user_me_requires_token():
    assert client.get("/api/user/me").status_code == 401
    assert client.get("/api/user/me",
                      headers={"Authorization": "Bearer u_khong_ton_tai"}).status_code == 401
    assert client.get("/api/user/bookmarks").status_code == 401
    assert client.get("/api/user/progress").status_code == 401


def test_user_register_validation():
    # password ngắn → 400
    r = client.post("/api/user/register",
                    json={"email": f"t{secrets.token_hex(4)}@test.local",
                          "password": "ngan"})
    assert r.status_code == 400
    # email không hợp lệ → 400
    r = client.post("/api/user/register",
                    json={"email": "khong-phai-email", "password": "matkhau-test-123"})
    assert r.status_code == 400


def test_user_logout_invalidates_token():
    _, _, token, _ = _register_user()
    h = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/user/logout", headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.get("/api/user/me", headers=h).status_code == 401


# ── Chạy trực tiếp không cần pytest ─────────────────────────────────────────

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
