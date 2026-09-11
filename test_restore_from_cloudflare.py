"""
test_restore_from_cloudflare.py
--------------------------------
Kiểm thử E01: restore() không được ghi đè profile/glossary cũ bằng dữ liệu
rỗng khi tải glossary.json thất bại — phải phân biệt rõ 3 trường hợp:
  - absent        : object thật sự không tồn tại trên R2 (truyện mới)
  - lỗi download  : mạng/auth/timeout... (KHÁC absent)
  - lỗi parse JSON: object tải về nhưng không phải JSON hợp lệ

Toàn bộ test dùng tmp_path (thư mục tạm của pytest) làm novels/, KHÔNG ghi vào
thư mục truyện thật hay .sync_state.json thật, và không gọi mạng/wrangler thật
(mọi download_r2_object/query_d1 đều bị monkeypatch).
"""
import json
from pathlib import Path

import pytest

import restore_from_cloudflare as restore


def _novel_row(slug="demo", **overrides):
    row = {
        "slug": slug,
        "title": "Demo Title",
        "original_title": "", "author": "", "source_url": "",
        "genre": "cultivation", "last_translated_url": "",
        "last_chapter_number": 0, "total_chapters": 0,
        "translation_style": "", "notes": "",
    }
    row.update(overrides)
    return row


@pytest.fixture
def novel_root(tmp_path, monkeypatch):
    """Trỏ mọi đường dẫn ghi của restore_from_cloudflare vào tmp_path — không
    đụng thư mục novels/ thật hay .sync_state.json thật."""
    # conftest.py (autouse) đã tạo sẵn tmp_path/novels và chdir vào tmp_path
    # cho mọi test trong repo — dùng lại thư mục đó thay vì tạo mới.
    root = tmp_path / "novels"
    root.mkdir(exist_ok=True)
    monkeypatch.setattr(restore, "safe_novel_dir", lambda slug: str(root / slug))
    state_path = tmp_path / "state.json"
    monkeypatch.setattr(restore, "SYNC_STATE_PATH", state_path)
    return root


def _no_chapters(sql):
    if sql == "SELECT * FROM novels;":
        raise AssertionError("test này không nên gọi lại danh sách novels qua query_d1 ở đây")
    return []


def test_absent_glossary_on_fresh_restore_uses_empty_dict(novel_root, monkeypatch):
    """Truyện chưa từng có glossary trên R2 (absent thật sự) -> glossary rỗng
    là hợp lệ và novel.json được publish."""
    monkeypatch.setattr(restore, "query_d1",
        lambda sql: [_novel_row()] if sql == "SELECT * FROM novels;" else [])

    def fake_download(key, path):
        restore._R2_LAST_ERROR["stderr"] = "Error: The specified key does not exist."
        return False

    monkeypatch.setattr(restore, "download_r2_object", fake_download)

    assert restore.restore() is True
    profile = json.loads((novel_root / "demo" / "novel.json").read_text(encoding="utf-8"))
    assert profile["glossary"] == {}
    assert profile["slug"] == "demo"


def test_download_error_preserves_existing_glossary_not_wiped(novel_root, monkeypatch):
    """Có profile cũ với glossary không rỗng; lần restore này lỗi TẢI (không
    phải absent) -> phải giữ nguyên glossary cũ, không ghi đè bằng rỗng."""
    novel_dir = novel_root / "demo"
    novel_dir.mkdir()
    old_profile = {
        "slug": "demo", "title": "Demo Title", "original_title": "", "author": "",
        "source_url": "", "genre": "cultivation", "last_translated_url": "",
        "last_chapter_number": 3, "total_chapters": 0,
        "glossary": {"甲": "Giáp", "乙": "Ất"},
        "translation_style": "", "notes": "",
    }
    (novel_dir / "novel.json").write_text(json.dumps(old_profile, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(restore, "query_d1",
        lambda sql: [_novel_row()] if sql == "SELECT * FROM novels;" else [])

    def fake_download(key, path):
        # Lỗi mạng/timeout thật sự — KHÔNG chứa cụm từ "does not exist".
        restore._R2_LAST_ERROR["stderr"] = "Error: connect ETIMEDOUT / network unreachable"
        return False

    monkeypatch.setattr(restore, "download_r2_object", fake_download)

    assert restore.restore() is True
    profile = json.loads((novel_dir / "novel.json").read_text(encoding="utf-8"))
    assert profile["glossary"] == {"甲": "Giáp", "乙": "Ất"}


def test_download_error_with_no_existing_profile_skips_publish(novel_root, monkeypatch):
    """Không có profile cũ để giữ, lỗi tải (không phải absent) -> KHÔNG được
    publish novel.json rỗng; restore() phải báo lỗi tổng thể (trả về False)."""
    monkeypatch.setattr(restore, "query_d1",
        lambda sql: [_novel_row()] if sql == "SELECT * FROM novels;" else [])

    def fake_download(key, path):
        restore._R2_LAST_ERROR["stderr"] = "Error: 401 Unauthorized"
        return False

    monkeypatch.setattr(restore, "download_r2_object", fake_download)

    assert restore.restore() is False
    assert not (novel_root / "demo" / "novel.json").exists()


def test_parse_error_preserves_existing_glossary_not_wiped(novel_root, monkeypatch, tmp_path):
    """glossary.json tải về được nhưng nội dung không phải JSON hợp lệ ->
    coi như lỗi (không phải absent), giữ glossary cũ."""
    novel_dir = novel_root / "demo"
    novel_dir.mkdir()
    old_profile = {
        "slug": "demo", "title": "Demo Title", "original_title": "", "author": "",
        "source_url": "", "genre": "cultivation", "last_translated_url": "",
        "last_chapter_number": 5, "total_chapters": 0,
        "glossary": {"甲": "Giáp"},
        "translation_style": "", "notes": "",
    }
    (novel_dir / "novel.json").write_text(json.dumps(old_profile, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(restore, "query_d1",
        lambda sql: [_novel_row()] if sql == "SELECT * FROM novels;" else [])

    def fake_download(key, path):
        # Tải "thành công" (rc==0 trong thực tế) nhưng nội dung hỏng.
        Path(path).write_text("{not valid json", encoding="utf-8")
        return True

    monkeypatch.setattr(restore, "download_r2_object", fake_download)

    assert restore.restore() is True
    profile = json.loads((novel_dir / "novel.json").read_text(encoding="utf-8"))
    assert profile["glossary"] == {"甲": "Giáp"}


def test_invalid_slug_from_d1_is_skipped_without_crashing(tmp_path, monkeypatch):
    state_path = tmp_path / "state.json"
    monkeypatch.setattr(restore, "SYNC_STATE_PATH", state_path)
    monkeypatch.setattr(restore, "query_d1",
        lambda sql: [_novel_row(slug="../evil")] if sql == "SELECT * FROM novels;" else [])
    assert restore.restore() is False


def test_r2_glossary_status_classifies_absent_vs_error(monkeypatch, tmp_path):
    """Đơn vị: _r2_glossary_status phải phân loại đúng theo stderr, và mặc
    định về 'error' (an toàn) khi không có thông tin phân loại."""
    dest = tmp_path / "g.json"

    def ok(key, path):
        return True

    monkeypatch.setattr(restore, "download_r2_object", ok)
    assert restore._r2_glossary_status("k", dest) == "ok"

    def absent(key, path):
        restore._R2_LAST_ERROR["stderr"] = "The specified key does not exist."
        return False

    monkeypatch.setattr(restore, "download_r2_object", absent)
    assert restore._r2_glossary_status("k", dest) == "absent"

    def unknown_failure(key, path):
        # Không set stderr gì cả (giống mock đơn giản trả bool) -> phải mặc
        # định 'error', không được suy đoán 'absent'.
        return False

    restore._R2_LAST_ERROR["stderr"] = ""
    monkeypatch.setattr(restore, "download_r2_object", unknown_failure)
    assert restore._r2_glossary_status("k", dest) == "error"


# ── E09: file local tồn tại không đủ để skip — verify hash thật ─────────────

def test_local_chapter_matches_content_addressed_hash(tmp_path):
    import hashlib
    content = "# Chương 1\n\nnội dung"
    h = hashlib.sha256(content.encode("utf-8")).hexdigest()
    path = tmp_path / "c1.md"
    path.write_text(content, encoding="utf-8")
    assert restore._local_chapter_matches(path, f"demo/content/{h}.md") is True


def test_local_chapter_mismatch_is_detected(tmp_path):
    import hashlib
    correct_hash = hashlib.sha256(b"noi dung dung").hexdigest()
    path = tmp_path / "c1.md"
    path.write_text("noi dung SAI hoac cu", encoding="utf-8")
    assert restore._local_chapter_matches(path, f"demo/content/{correct_hash}.md") is False


def test_local_chapter_legacy_key_without_hash_cannot_be_verified(tmp_path):
    """r2_key dạng cũ (không content-addressed) không mang hash để so — phải
    trả False (buộc tải lại) thay vì tin tưởng mù theo file tồn tại."""
    path = tmp_path / "c1.md"
    path.write_text("bat ky noi dung nao", encoding="utf-8")
    assert restore._local_chapter_matches(path, "demo/b64_xyz") is False


def test_local_chapter_missing_file_never_matches(tmp_path):
    assert restore._local_chapter_matches(tmp_path / "khong-ton-tai.md", "demo/content/" + "a" * 64 + ".md") is False


def test_restore_redownloads_chapter_when_local_content_stale(novel_root, monkeypatch):
    """E09 — bug cũ: `if local_chap_path.exists(): skip` khiến 1 chương cục bộ
    ĐÃ CŨ/HỎNG (khác nội dung thật trên R2) không bao giờ được cập nhật lại dù
    chạy restore() nhiều lần. Sau khi sửa: hash không khớp -> tải lại."""
    import hashlib
    fresh_content = "# Chương 1\n\nbản MỚI đã sửa lỗi dịch"
    fresh_hash = hashlib.sha256(fresh_content.encode("utf-8")).hexdigest()
    r2_key = f"demo/content/{fresh_hash}.md"

    novel_dir = novel_root / "demo"
    (novel_dir / "translated").mkdir(parents=True)
    stale_path = novel_dir / "translated" / "c1.md"
    stale_path.write_text("# Chương 1\n\nbản CŨ trước khi sửa lỗi dịch", encoding="utf-8")

    def query(sql):
        if sql == "SELECT * FROM novels;":
            return [_novel_row()]
        if "FROM chapters" in sql:
            return [{"filename": "c1.md", "title": "Chương 1", "chapter_number": 1, "r2_key": r2_key}]
        return []
    monkeypatch.setattr(restore, "query_d1", query)

    def fake_download(key, path):
        restore._R2_LAST_ERROR["stderr"] = "Error: The specified key does not exist."
        if key == r2_key:
            Path(path).write_text(fresh_content, encoding="utf-8")
            return True
        return False  # glossary.json absent — không liên quan tới test này
    monkeypatch.setattr(restore, "download_r2_object", fake_download)

    assert restore.restore() is True
    assert stale_path.read_text(encoding="utf-8") == fresh_content


def test_restore_skips_chapter_when_local_content_already_matches(novel_root, monkeypatch):
    """Ngược lại: nội dung local đã đúng hash -> KHÔNG tải lại (vẫn giữ hành
    vi 'skip' cho trường hợp hợp lệ, không phải lúc nào cũng re-download)."""
    import hashlib
    content = "# Chương 1\n\nnội dung đã đúng"
    h = hashlib.sha256(content.encode("utf-8")).hexdigest()
    r2_key = f"demo/content/{h}.md"

    novel_dir = novel_root / "demo"
    (novel_dir / "translated").mkdir(parents=True)
    (novel_dir / "translated" / "c1.md").write_text(content, encoding="utf-8")

    def query(sql):
        if sql == "SELECT * FROM novels;":
            return [_novel_row()]
        if "FROM chapters" in sql:
            return [{"filename": "c1.md", "title": "Chương 1", "chapter_number": 1, "r2_key": r2_key}]
        return []
    monkeypatch.setattr(restore, "query_d1", query)

    called = {"n": 0}
    def fake_download(key, path):
        called["n"] += 1
        restore._R2_LAST_ERROR["stderr"] = "Error: The specified key does not exist."
        return False
    monkeypatch.setattr(restore, "download_r2_object", fake_download)

    assert restore.restore() is True
    # glossary.json absent gây đúng 1 lần gọi download (glossary) — KHÔNG có
    # lần gọi nào cho chương c1.md vì đã khớp hash, được skip thật sự.
    assert called["n"] == 1


def test_verify_chapters_reports_drift_without_writing_anything(novel_root, monkeypatch, capsys):
    """verify_chapters() (--verify-only) không được ghi/tải bất kỳ file nào —
    chỉ in báo cáo."""
    import hashlib
    correct_hash = hashlib.sha256(b"noi dung dung").hexdigest()
    r2_key = f"demo/content/{correct_hash}.md"

    novel_dir = novel_root / "demo"
    (novel_dir / "translated").mkdir(parents=True)
    stale_path = novel_dir / "translated" / "c1.md"
    stale_path.write_text("noi dung SAI", encoding="utf-8")
    before = stale_path.read_text(encoding="utf-8")

    def query(sql):
        if sql == "SELECT slug FROM novels;":
            return [{"slug": "demo"}]
        if "FROM chapters" in sql:
            return [{"filename": "c1.md", "r2_key": r2_key}]
        return []
    monkeypatch.setattr(restore, "query_d1", query)

    def fail_if_called(*a, **k):
        raise AssertionError("verify_chapters() không được gọi download_r2_object")
    monkeypatch.setattr(restore, "download_r2_object", fail_if_called)

    result = restore.verify_chapters()
    assert result is False  # có drift (hash không khớp)
    assert stale_path.read_text(encoding="utf-8") == before  # không bị ghi đè
    out = capsys.readouterr().out
    assert "hash không khớp" in out
