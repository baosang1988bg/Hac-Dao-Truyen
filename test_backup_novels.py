"""
test_backup_novels.py
----------------------
Kiểm thử E02 (tools/backup_novels.py): backup SQLite an toàn với WAL, D1
export tái dùng helper sẵn có, manifest checksum, restore vào thư mục trống
+ verify, exit code, và KHÔNG rotate bản cũ trước khi bản mới verify OK.

Mọi test dùng tmp_path (fixture của pytest) — NOVELS_DIR/BACKUP_DIR/
USERS_DB_PATH của module đều bị monkeypatch trỏ vào tmp_path, không bao giờ
đụng novels/ thật, backups/ thật hay data/users.db thật. Không có test nào
gọi mạng/wrangler thật — query_d1/download_r2_object đều bị monkeypatch khi
cần.
"""
import json
import os
import sqlite3
import sys
import zipfile

import pytest

from tools import backup_novels as bn


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Trỏ mọi hằng số ghi/đọc của backup_novels vào tmp_path."""
    novels_dir = tmp_path / "novels"
    backup_dir = tmp_path / "backups"
    users_db = tmp_path / "data" / "users.db"
    # conftest.py (autouse) đã tạo sẵn tmp_path/novels (+ 1 truyện mẫu) và
    # tmp_path/users.db cho mọi test trong repo — dùng lại thư mục, không tạo mới.
    novels_dir.mkdir(exist_ok=True)
    monkeypatch.setattr(bn, "NOVELS_DIR", str(novels_dir))
    monkeypatch.setattr(bn, "BACKUP_DIR", str(backup_dir))
    monkeypatch.setattr(bn, "USERS_DB_PATH", str(users_db))
    return {"novels_dir": novels_dir, "backup_dir": backup_dir, "users_db": users_db}


def _make_novel(novels_dir, slug="demo", with_epub=True):
    d = novels_dir / slug
    d.mkdir()
    (d / "novel.json").write_text(
        json.dumps({"slug": slug, "title": "Demo", "glossary": {"甲": "Giáp"}}, ensure_ascii=False),
        encoding="utf-8")
    (d / "synopsis.md").write_text("# Giới thiệu\nNội dung tóm tắt.", encoding="utf-8")
    (d / "failed_chapters.json").write_text(json.dumps([{"url": "x", "title": "y", "error": "z"}]),
                                             encoding="utf-8")
    (d / "translated").mkdir()
    (d / "translated" / "Chuong 1_VI.md").write_text("# Chương 1\nNội dung.", encoding="utf-8")
    (d / "extras").mkdir()
    (d / "extras" / "note.txt").write_text("ghi chú", encoding="utf-8")
    if with_epub:
        (d / f"{slug}.epub").write_bytes(b"PK\x03\x04fake-epub-bytes")
    return d


# ── SQLite backup API an toàn với WAL ────────────────────────────────────

def test_backup_sqlite_db_safe_copy_under_wal(tmp_path):
    src = tmp_path / "custom_users_src.db"
    conn = sqlite3.connect(src)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
    conn.execute("INSERT INTO users (email) VALUES ('a@example.com')")
    conn.commit()
    # Không đóng connection để mô phỏng "đang có tiến trình khác giữ kết nối"
    # — copy file thô trong tình huống này có thể đọc phải trạng thái nửa
    # vời; sqlite3.Connection.backup() vẫn phải cho ra bản sao nhất quán.
    dest = tmp_path / "backup_users.db"
    ok = bn.backup_sqlite_db(str(src), str(dest))
    conn.close()

    assert ok is True
    assert dest.is_file()
    check = sqlite3.connect(dest)
    rows = check.execute("SELECT email FROM users").fetchall()
    check.close()
    assert rows == [("a@example.com",)]


def test_backup_sqlite_db_missing_source_returns_false(tmp_path):
    assert bn.backup_sqlite_db(str(tmp_path / "no.db"), str(tmp_path / "out.db")) is False


# ── create_backup + manifest + verify ────────────────────────────────────

def test_create_backup_manifest_verify_no_db_no_d1_no_r2(sandbox):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=True)
    path = bn.create_backup(include_raw=False, include_epub=True, include_d1=False, include_r2=False)

    assert os.path.isfile(path)
    ok, problems = bn.verify_backup(path)
    assert ok, problems

    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        manifest = json.loads(z.read("MANIFEST.json"))

    for expected in ("novels/demo/novel.json", "novels/demo/synopsis.md",
                     "novels/demo/failed_chapters.json",
                     "novels/demo/translated/Chuong 1_VI.md",
                     "novels/demo/extras/note.txt", "novels/demo/demo.epub"):
        assert expected in names

    assert manifest["scope"]["users_db"] is False
    assert manifest["scope"]["d1"]["status"] == "skipped"
    assert manifest["scope"]["r2_manifest_checksum"]["status"] == "skipped"
    assert "text_raw" not in "".join(names)  # không --include-raw thì không có text_raw


def test_create_backup_includes_users_db(sandbox):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    sandbox["users_db"].parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(sandbox["users_db"])
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
    conn.execute("INSERT INTO users (email) VALUES ('u@example.com')")
    conn.commit()
    conn.close()

    path = bn.create_backup(include_raw=False, include_epub=True)
    ok, problems = bn.verify_backup(path)
    assert ok, problems

    with zipfile.ZipFile(path) as z:
        assert "data/users.db" in z.namelist()
        with z.open("data/users.db") as f:
            data = f.read()
    restored_db_path = str(sandbox["backup_dir"] / "extracted_users.db")
    with open(restored_db_path, "wb") as f:
        f.write(data)
    check = sqlite3.connect(restored_db_path)
    assert check.execute("SELECT email FROM users").fetchall() == [("u@example.com",)]
    check.close()


def test_create_backup_excludes_text_raw_unless_include_raw(sandbox):
    d = _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    (d / "text_raw").mkdir()
    (d / "text_raw" / "1.txt").write_text("raw", encoding="utf-8")

    path_without = bn.create_backup(include_raw=False, include_epub=False)
    with zipfile.ZipFile(path_without) as z:
        assert not any("text_raw" in n for n in z.namelist())

    path_with = bn.create_backup(include_raw=True, include_epub=False)
    with zipfile.ZipFile(path_with) as z:
        assert "novels/demo/text_raw/1.txt" in z.namelist()


# ── D1 export: tái dùng query_d1, không gọi mạng thật ────────────────────

def test_backup_d1_reports_per_table_status_without_network(sandbox, monkeypatch, tmp_path):
    def fake_query_d1(sql):
        if "FROM users" in sql:
            return [{"id": 1, "email": "a@example.com"}]
        if "FROM novels" in sql:
            return None  # mô phỏng lỗi wrangler/network cho bảng này
        return []

    monkeypatch.setattr(bn, "query_d1", fake_query_d1)
    dest_dir = tmp_path / "d1_out"
    result = bn.backup_d1(str(dest_dir), tables=["users", "novels", "comments"])

    assert result["tables"]["users"]["status"] == "ok"
    assert result["tables"]["users"]["count"] == 1
    assert result["tables"]["novels"]["status"] == "error"
    assert result["status"] == "partial"
    assert (dest_dir / "users.json").is_file()
    assert not (dest_dir / "novels.json").exists()


def test_backup_d1_all_failed_reports_failed_status_not_success(tmp_path, monkeypatch):
    monkeypatch.setattr(bn, "query_d1", lambda sql: None)
    result = bn.backup_d1(str(tmp_path / "d1"), tables=["users", "novels"])
    assert result["status"] == "failed"
    assert all(t["status"] == "error" for t in result["tables"].values())


def test_create_backup_with_include_d1_uses_mocked_query_d1(sandbox, monkeypatch):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    monkeypatch.setattr(bn, "query_d1", lambda sql: [{"slug": "demo"}] if "novels" in sql else [])

    path = bn.create_backup(include_raw=False, include_epub=False, include_d1=True)
    ok, problems = bn.verify_backup(path)
    assert ok, problems
    with zipfile.ZipFile(path) as z:
        manifest = json.loads(z.read("MANIFEST.json"))
        assert manifest["scope"]["d1"]["status"] == "ok"
        assert "d1/novels.json" in z.namelist()


# ── R2 manifest/checksum snapshot: không gọi mạng thật ───────────────────

def test_backup_r2_manifests_mocked_no_network(tmp_path, monkeypatch):
    def fake_download(key, path):
        if "bundles/manifest.json" in key:
            with open(path, "w", encoding="utf-8") as f:
                f.write('{"a.md": "demo/bundles/bundle-0001.json"}')
            return True
        return False  # glossary.json không có trên R2

    monkeypatch.setattr(bn, "download_r2_object", fake_download)
    result = bn.backup_r2_manifests(["demo"], str(tmp_path / "r2out"))
    assert result["slugs"]["demo"]["bundles_manifest"]["status"] == "ok"
    assert "sha256" in result["slugs"]["demo"]["bundles_manifest"]
    assert result["slugs"]["demo"]["glossary"]["status"] == "absent_or_error"


# ── restore_full: verify checksum, chỉ ghi vào thư mục trống, exit code ──

def test_restore_full_roundtrip_verifies_checksum(sandbox, tmp_path):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=True)
    path = bn.create_backup(include_raw=False, include_epub=True)

    dest = tmp_path / "restore_empty"
    ok = bn.restore_full(path, str(dest), verify=True)
    assert ok is True
    assert (dest / "novels" / "demo" / "novel.json").is_file()
    assert (dest / "novels" / "demo" / "demo.epub").is_file()


def test_restore_full_refuses_non_empty_dest(sandbox, tmp_path):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    path = bn.create_backup(include_raw=False, include_epub=False)

    dest = tmp_path / "not_empty"
    dest.mkdir()
    (dest / "existing_real_data.txt").write_text("dữ liệu thật đang có sẵn", encoding="utf-8")

    ok = bn.restore_full(path, str(dest), verify=True)
    assert ok is False
    # Không được động vào thư mục không rỗng — file cũ vẫn còn nguyên, và
    # restore_full không được âm thầm giải nén đè lên.
    assert (dest / "existing_real_data.txt").read_text(encoding="utf-8") == "dữ liệu thật đang có sẵn"
    assert not (dest / "novels").exists()


def test_restore_full_detects_tampered_checksum(tmp_path):
    """Zip có MANIFEST.json khai sha256 không khớp nội dung thật -> phải
    verify thất bại (mô phỏng backup bị hỏng/tampered)."""
    zip_path = tmp_path / "corrupt.zip"
    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("novels/demo/novel.json", '{"slug": "demo"}')
        z.writestr("MANIFEST.json", json.dumps({
            "created_at": "now",
            "scope": {"d1": {"status": "skipped"}},
            "files": [{"path": "novels/demo/novel.json", "sha256": "0" * 64, "size": 999}],
        }))

    dest = tmp_path / "dest_corrupt"
    ok = bn.restore_full(str(zip_path), str(dest), verify=True)
    assert ok is False


def test_verify_backup_missing_manifest_fails(tmp_path):
    zip_path = tmp_path / "no_manifest.zip"
    with zipfile.ZipFile(zip_path, "w") as z:
        z.writestr("novels/demo/novel.json", "{}")
    ok, problems = bn.verify_backup(str(zip_path))
    assert ok is False
    assert problems


# ── rotate không được chạy trước khi verify OK; exit code CLI ────────────

def test_main_cli_does_not_rotate_when_verify_fails(sandbox, monkeypatch):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    sandbox["backup_dir"].mkdir(parents=True, exist_ok=True)
    # 2 backup "cũ" giả lập đã có sẵn, đáng lẽ sẽ bị rotate nếu KEEP nhỏ hơn.
    old1 = sandbox["backup_dir"] / "novels-20200101-000000.zip"
    old2 = sandbox["backup_dir"] / "novels-20200102-000000.zip"
    old1.write_bytes(b"old-backup-1")
    old2.write_bytes(b"old-backup-2")

    monkeypatch.setattr(bn, "KEEP", 0)  # để chắc chắn rotate() (nếu bị gọi) sẽ xoá cả 2
    monkeypatch.setattr(bn, "verify_backup", lambda path: (False, ["checksum giả lập sai"]))
    monkeypatch.setattr(sys, "argv", ["backup_novels.py"])

    exit_code = bn.main()

    assert exit_code == 1
    assert old1.exists() and old2.exists(), "Không được rotate/xoá backup cũ khi bản mới chưa verify OK"


def test_main_cli_backup_success_exit_code_0(sandbox, monkeypatch):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    monkeypatch.setattr(sys, "argv", ["backup_novels.py"])
    assert bn.main() == 0


def test_main_cli_restore_full_into_non_empty_dest_returns_nonzero_exit(sandbox, tmp_path, monkeypatch):
    _make_novel(sandbox["novels_dir"], "demo", with_epub=False)
    monkeypatch.setattr(sys, "argv", ["backup_novels.py"])
    assert bn.main() == 0
    latest = sorted((sandbox["backup_dir"]).glob("novels-*.zip"))[-1]

    dest = tmp_path / "occupied"
    dest.mkdir()
    (dest / "keep.txt").write_text("giữ nguyên", encoding="utf-8")

    monkeypatch.setattr(sys, "argv",
                         ["backup_novels.py", "--restore", str(latest), "--dest", str(dest)])
    assert bn.main() == 1
