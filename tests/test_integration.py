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
