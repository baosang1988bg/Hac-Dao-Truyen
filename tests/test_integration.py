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


from fastapi.testclient import TestClient  # noqa: E402
import api  # noqa: E402

client = TestClient(api.app)

# Field cấm lộ cho guest — đồng bộ với _PUBLIC_FIELDS (routers/novels.py)
FORBIDDEN_GUEST_FIELDS = {"glossary", "source_url", "last_translated_url"}
REQUIRED_LIST_FIELDS = {"slug", "title", "chapter_count", "glossary_count"}


def _first_translated_slug():
    r = client.get("/api/novels")
    for n in r.json()["novels"]:
        if n.get("chapter_count", 0) > 0:
            return n["slug"]
    return None


# ── Guest: danh sách & chi tiết ──────────────────────────────────────────────

def test_list_novels_public_shape():
    # B01/B02: envelope {novels,total,page,limit,pages} — PHẢI khớp Worker
    # Cloudflare (src/index.js getNovels), không còn mảng trần như trước (bug
    # cũ: AccountPage.jsx .find() trên object cloud vs mảng local không khớp).
    r = client.get("/api/novels")
    assert r.status_code == 200
    data = r.json()
    assert set(data.keys()) >= {"novels", "total", "page", "limit", "pages"}
    assert isinstance(data["novels"], list) and len(data["novels"]) > 0
    for n in data["novels"]:
        assert REQUIRED_LIST_FIELDS <= set(n.keys()), f"thiếu field: {n.get('slug')}"
        leak = FORBIDDEN_GUEST_FIELDS & set(n.keys())
        assert not leak, f"lộ field {leak} trong /api/novels ({n.get('slug')})"


def test_list_novels_search_and_pagination():
    all_res = client.get("/api/novels", params={"limit": 200}).json()
    total = all_res["total"]
    assert total > 0
    slug = all_res["novels"][0]["slug"]

    # Tìm theo slug đầy đủ phải ra đúng ít nhất truyện đó (contract 'q', không
    # phải 'search' — bug cũ HomePage.jsx gửi 'search' trong khi backend đọc 'q').
    found = client.get("/api/novels", params={"q": slug}).json()
    assert any(n["slug"] == slug for n in found["novels"])

    page1 = client.get("/api/novels", params={"limit": 1, "page": 1}).json()
    assert len(page1["novels"]) == 1
    assert page1["pages"] == total  # limit=1 → mỗi trang 1 truyện
    if total > 1:
        page2 = client.get("/api/novels", params={"limit": 1, "page": 2}).json()
        assert page2["novels"][0]["slug"] != page1["novels"][0]["slug"], (
            "truyện ở trang 2 không được trùng trang 1 — bug cũ chỉ tải trang đầu"
        )


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


def test_chapter_list_has_canonical_number_field():
    # B04: contract phải khớp Worker (D1 chapters.chapter_number) — trước đây
    # local CHỈ trả filename/title, không có số chương chuẩn hóa nào.
    slug = _first_translated_slug()
    chapters = client.get(f"/api/novels/{slug}/chapters").json()
    assert len(chapters) > 0
    for c in chapters:
        assert "chapter_number" in c
        # chapter_number là None (author note không đánh số) hoặc int — không
        # bao giờ là sentinel nội bộ 999999 dùng để sắp xếp.
        assert c["chapter_number"] is None or isinstance(c["chapter_number"], int)
        assert c["chapter_number"] != 999999


def test_chapter_content_has_version_for_cache_invalidation():
    # C07/B04: version (hash nội dung) cho phép service worker phát hiện
    # chương được dịch lại mà URL/identifier không đổi.
    slug = _first_translated_slug()
    chapters = client.get(f"/api/novels/{slug}/chapters").json()
    ident = chapters[0]["filename"]
    r = client.get(f"/api/novels/{slug}/chapters/{ident}")
    data = r.json()
    assert "version" in data and isinstance(data["version"], str) and len(data["version"]) > 0


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


def test_user_progress_epub_position():
    _, _, token, _ = _register_user()
    h = {"Authorization": f"Bearer {token}"}
    cfi = "epubcfi(/6/4[chap01]!/4/2/1:0)"

    r = client.put("/api/user/progress/mot-truyen-epub",
                    json={"type": "epub", "position": cfi}, headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True}

    r = client.get("/api/user/progress", headers=h)
    assert r.status_code == 200
    prog = r.json()
    assert len(prog) == 1
    assert prog[0]["slug"] == "mot-truyen-epub"
    assert prog[0]["type"] == "epub"
    assert prog[0]["position"] == cfi
    assert prog[0]["chapter"] is None

    # thiếu position → 400
    r = client.put("/api/user/progress/mot-truyen-epub",
                    json={"type": "epub"}, headers=h)
    assert r.status_code == 400


def test_user_progress_rejects_stale_out_of_order_write():
    """C03: request PUT progress cũ đến muộn (client_updated_at nhỏ hơn bản đã
    lưu) không được ghi đè bản mới hơn — trả 409 thay vì âm thầm overwrite."""
    _, _, token, _ = _register_user()
    h = {"Authorization": f"Bearer {token}"}

    r = client.put("/api/user/progress/demo-slug",
                    json={"chapter": 20, "client_updated_at": 2000}, headers=h)
    assert r.status_code == 200

    r = client.put("/api/user/progress/demo-slug",
                    json={"chapter": 5, "client_updated_at": 1000}, headers=h)
    assert r.status_code == 409

    prog = client.get("/api/user/progress", headers=h).json()
    assert prog[0]["chapter"] == 20, "chương 20 (mới hơn) không được ghi đè bởi request đến muộn"

    # Đọc lại chương trước (số nhỏ hơn) vẫn hợp lệ nếu timestamp MỚI hơn —
    # không được lấy max(chapter).
    r = client.put("/api/user/progress/demo-slug",
                    json={"chapter": 3, "client_updated_at": 3000}, headers=h)
    assert r.status_code == 200
    prog = client.get("/api/user/progress", headers=h).json()
    assert prog[0]["chapter"] == 3


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
