"""E07/E08 — schema integrity constraints + migrate_schema.py reconciliation.

Toàn bộ test dùng SQLite `:memory:` (không đụng users.db thật, không đụng D1).
Không tự động sinh dữ liệu để "đạt snapshot": mọi audit thất bại phải raise
ValueError với thông tin cụ thể (bảng/cột/ràng buộc), không tự DROP.
"""
import sqlite3

import pytest

from tools.migrate_schema import ROOT, plan

CURRENT_SCHEMA = (ROOT / 'schema.sql').read_text()

# Ảnh chụp schema TRƯỚC E07: các bảng user_sessions/bookmarks/reading_progress/
# comments/novel_requests chưa có FK, cột PK còn NULL-able, chưa có CHECK.
OLD_SCHEMA = """
CREATE TABLE IF NOT EXISTS novels (
  slug              TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  original_title    TEXT DEFAULT '',
  author            TEXT DEFAULT '',
  genre             TEXT DEFAULT '',
  source_url        TEXT DEFAULT '',
  last_translated_url TEXT DEFAULT '',
  last_chapter_number INTEGER DEFAULT 0,
  total_chapters    INTEGER DEFAULT 0,
  glossary          TEXT DEFAULT '{}',
  glossary_count    INTEGER DEFAULT 0,
  translation_style TEXT DEFAULT '',
  notes             TEXT DEFAULT '',
  cover_url         TEXT DEFAULT '',
  status            TEXT DEFAULT 'ongoing',
  synopsis          TEXT DEFAULT '',
  views             INTEGER DEFAULT 0,
  rating_sum        INTEGER DEFAULT 0,
  rating_count      INTEGER DEFAULT 0,
  has_epub          INTEGER DEFAULT 0,
  drive_file_id     TEXT DEFAULT '',
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_slug     TEXT NOT NULL,
  filename       TEXT NOT NULL,
  title          TEXT NOT NULL,
  chapter_number INTEGER DEFAULT 0,
  r2_key         TEXT NOT NULL,
  created_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (novel_slug) REFERENCES novels(slug),
  UNIQUE(novel_slug, filename)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER,
  slug TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, slug)
);
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id INTEGER,
  slug TEXT,
  chapter INTEGER,
  position TEXT,
  type TEXT DEFAULT 'chapter',
  updated_at TEXT,
  PRIMARY KEY (user_id, slug)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  slug TEXT,
  chapter INTEGER,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS novel_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);
"""


def db():
    conn = sqlite3.connect(':memory:')
    conn.execute('PRAGMA foreign_keys = ON')
    conn.row_factory = sqlite3.Row
    return conn


def apply(conn, schema=None):
    conn.executescript('\n'.join(plan(lambda sql: [dict(r) for r in conn.execute(sql)], schema=schema)))


def seed_valid_fixture(conn):
    """Dữ liệu hợp lệ mô phỏng — không orphan, không duplicate, không NULL cấm."""
    conn.executescript(OLD_SCHEMA)
    conn.execute("INSERT INTO novels(slug, title) VALUES ('demo-truyen', 'Truyện Demo')")
    conn.execute("INSERT INTO users(id, email, password_hash) VALUES (1, 'a@x.com', 'h1')")
    conn.execute("INSERT INTO users(id, email, password_hash) VALUES (2, 'b@x.com', 'h2')")
    conn.execute("INSERT INTO user_sessions(token, user_id, expires_at) VALUES ('t1', 1, '2099-01-01 00:00:00')")
    conn.execute("INSERT INTO bookmarks(user_id, slug) VALUES (1, 'demo-truyen')")
    conn.execute("INSERT INTO reading_progress(user_id, slug, chapter, type, updated_at) "
                 "VALUES (1, 'demo-truyen', 3, 'chapter', datetime('now'))")
    conn.execute("INSERT INTO comments(user_id, slug, chapter, content) VALUES (1, 'demo-truyen', 3, 'hay lắm')")
    conn.execute("INSERT INTO novel_requests(user_id, url, status) VALUES (2, 'http://x', 'pending')")


# ── E07: audit trước khi ép ràng buộc mới ──────────────────────────────────

def test_audit_passes_and_migration_preserves_valid_data():
    conn = db()
    seed_valid_fixture(conn)
    apply(conn)   # rebuild các bảng cần FK/NOT NULL/CHECK
    apply(conn)   # idempotent: chạy lại không đổi gì thêm, không lỗi

    # Dữ liệu cũ còn nguyên sau rebuild.
    assert conn.execute("SELECT content FROM comments WHERE slug='demo-truyen'").fetchone()[0] == 'hay lắm'
    assert conn.execute("SELECT chapter FROM reading_progress WHERE user_id=1").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM bookmarks").fetchone()[0] == 1
    assert conn.execute("SELECT status FROM novel_requests WHERE user_id=2").fetchone()[0] == 'pending'

    # Ràng buộc mới thực sự có hiệu lực (không chỉ có mặt trong text CREATE TABLE).
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO bookmarks(user_id, slug) VALUES (999, 'demo-truyen')")  # orphan user_id
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO comments(user_id, slug, chapter, content) VALUES (1, NULL, 1, 'x')")  # slug NOT NULL
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO reading_progress(user_id, slug, chapter, type, updated_at) "
            "VALUES (1, 'demo-truyen', 1, 'not-a-real-type', datetime('now'))"
        )  # CHECK type IN (...)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO novel_requests(user_id, url, status) VALUES (2, 'http://y', 'bogus')")  # CHECK status

    # AUTOINCREMENT vẫn tiếp tục đúng sau khi rebuild (không cấp lại id cũ).
    cur = conn.execute("INSERT INTO comments(user_id, slug, chapter, content) VALUES (1, 'demo-truyen', 4, 'mới')")
    assert cur.lastrowid > conn.execute("SELECT MAX(id) FROM comments WHERE content='hay lắm'").fetchone()[0]
    conn.close()


def test_audit_rejects_orphan_rows_instead_of_dropping_them():
    conn = db()
    seed_valid_fixture(conn)
    # Orphan: bookmark trỏ tới user_id không tồn tại.
    conn.execute("INSERT INTO bookmarks(user_id, slug) VALUES (12345, 'demo-truyen')")
    with pytest.raises(ValueError, match=r'orphan'):
        apply(conn)
    # Không có thay đổi nào được áp dụng — bảng cũ (không FK) vẫn còn nguyên,
    # dữ liệu orphan không bị xóa để "đạt snapshot".
    assert conn.execute("SELECT COUNT(*) FROM bookmarks WHERE user_id=12345").fetchone()[0] == 1
    conn.close()


def test_audit_rejects_null_in_column_becoming_not_null():
    conn = db()
    seed_valid_fixture(conn)
    conn.execute("INSERT INTO comments(user_id, slug, chapter, content) VALUES (1, 'demo-truyen', 5, NULL)")
    with pytest.raises(ValueError, match=r'comments\.content'):
        apply(conn)
    conn.close()


def test_audit_rejects_duplicate_rows_for_new_unique_constraint():
    """Dùng schema tổng hợp nhỏ để test riêng nhánh audit UNIQUE (schema thật
    không thêm UNIQUE mới cho user_sessions/bookmarks/... theo yêu cầu review)."""
    old = """
    CREATE TABLE IF NOT EXISTS widgets (
      id INTEGER PRIMARY KEY,
      code TEXT
    );
    """
    new = """
    CREATE TABLE IF NOT EXISTS widgets (
      id INTEGER PRIMARY KEY,
      code TEXT,
      UNIQUE(code)
    );
    """
    conn = db()
    conn.executescript(old)
    conn.execute("INSERT INTO widgets(id, code) VALUES (1, 'dup')")
    conn.execute("INSERT INTO widgets(id, code) VALUES (2, 'dup')")
    with pytest.raises(ValueError, match=r'UNIQUE.*widgets'):
        apply(conn, schema=new)
    conn.close()


# ── E08: đối chiếu FK/CHECK/UNIQUE/index đầy đủ, không chỉ tên ────────────

def test_fixture_old_current_and_drift_schemas_differ_as_expected():
    """Bộ 3 fixture bắt buộc: cũ (không ràng buộc), hiện tại (schema.sql thật),
    drift (có sai khác nguy hiểm)."""
    assert 'FOREIGN KEY (user_id) REFERENCES users(id)' not in OLD_SCHEMA
    assert 'FOREIGN KEY (user_id) REFERENCES users(id)' in CURRENT_SCHEMA
    assert "CHECK (status IN ('pending', 'approved', 'rejected'))" in CURRENT_SCHEMA


def test_rejects_drift_foreign_key_pointing_to_wrong_table():
    """Drift: DB thật có bookmarks.user_id FK vào bảng novels (sai) thay vì users."""
    conn = db()
    bad_current = CURRENT_SCHEMA.replace(
        "CREATE TABLE IF NOT EXISTS bookmarks (\n  user_id    INTEGER NOT NULL,\n  slug       TEXT NOT NULL,\n"
        "  created_at TEXT DEFAULT (datetime('now')),\n  PRIMARY KEY (user_id, slug),\n"
        "  FOREIGN KEY (user_id) REFERENCES users(id),\n  FOREIGN KEY (slug) REFERENCES novels(slug)\n);",
        "CREATE TABLE IF NOT EXISTS bookmarks (\n  user_id    INTEGER NOT NULL,\n  slug       TEXT NOT NULL,\n"
        "  created_at TEXT DEFAULT (datetime('now')),\n  PRIMARY KEY (user_id, slug),\n"
        "  FOREIGN KEY (user_id) REFERENCES novels(slug),\n  FOREIGN KEY (slug) REFERENCES novels(slug)\n);",
    )
    assert bad_current != CURRENT_SCHEMA, 'sanity: chuỗi thay thế phải khớp được nội dung schema.sql thật'
    conn.executescript(bad_current)
    with pytest.raises(ValueError, match=r'Incompatible foreign key bookmarks\(user_id\)'):
        apply(conn, schema=CURRENT_SCHEMA)
    conn.close()


def test_rejects_drift_check_constraint_with_different_allowed_values():
    """Drift: DB thật cho phép status='archived' (không có trong schema chuẩn)."""
    conn = db()
    drifted = CURRENT_SCHEMA.replace(
        "CHECK (status IN ('pending', 'approved', 'rejected'))",
        "CHECK (status IN ('pending', 'approved', 'rejected', 'archived'))",
    )
    assert drifted != CURRENT_SCHEMA
    conn.executescript(drifted)
    with pytest.raises(ValueError, match=r'Unexpected CHECK constraint on novel_requests'):
        apply(conn, schema=CURRENT_SCHEMA)
    conn.close()


def test_rejects_drift_index_with_different_definition():
    """Drift: index cùng tên nhưng thiếu cột — không phát hiện nếu chỉ so tên."""
    conn = db()
    conn.executescript(CURRENT_SCHEMA)
    conn.execute('DROP INDEX idx_comments_slug_chapter')
    conn.execute('CREATE INDEX idx_comments_slug_chapter ON comments(slug)')  # thiếu cột chapter
    with pytest.raises(ValueError, match=r'Incompatible index idx_comments_slug_chapter'):
        apply(conn, schema=CURRENT_SCHEMA)
    conn.close()


def test_rejects_drift_unexpected_foreign_key_not_in_desired_schema():
    """Drift: DB thật có FK trên comments.chapter (không có trong schema chuẩn)."""
    conn = db()
    drifted = CURRENT_SCHEMA.replace(
        "CREATE TABLE IF NOT EXISTS comments (\n  id         INTEGER PRIMARY KEY AUTOINCREMENT,\n"
        "  user_id    INTEGER NOT NULL,\n  slug       TEXT NOT NULL,\n  chapter    INTEGER,\n"
        "  content    TEXT NOT NULL,\n  created_at TEXT DEFAULT (datetime('now')),\n"
        "  FOREIGN KEY (user_id) REFERENCES users(id),\n  FOREIGN KEY (slug) REFERENCES novels(slug)\n);",
        "CREATE TABLE IF NOT EXISTS comments (\n  id         INTEGER PRIMARY KEY AUTOINCREMENT,\n"
        "  user_id    INTEGER NOT NULL,\n  slug       TEXT NOT NULL,\n  chapter    INTEGER,\n"
        "  content    TEXT NOT NULL,\n  created_at TEXT DEFAULT (datetime('now')),\n"
        "  FOREIGN KEY (user_id) REFERENCES users(id),\n  FOREIGN KEY (slug) REFERENCES novels(slug),\n"
        "  FOREIGN KEY (chapter) REFERENCES chapters(id)\n);",
    )
    assert drifted != CURRENT_SCHEMA
    conn.executescript(drifted)
    with pytest.raises(ValueError, match=r'Unexpected foreign key comments\(chapter\)'):
        apply(conn, schema=CURRENT_SCHEMA)
    conn.close()


# ── PRAGMA foreign_keys bật trên connection của chính migrate_schema.py ────

def test_migrate_schema_tool_enables_foreign_keys_on_its_own_connections():
    import subprocess
    import sys
    import tempfile
    import os

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, 'scratch.db')
        conn = sqlite3.connect(db_path)
        conn.executescript(CURRENT_SCHEMA)
        conn.close()
        result = subprocess.run(
            [sys.executable, str(ROOT / 'tools' / 'migrate_schema.py'), '--sqlite', db_path],
            capture_output=True, text=True, cwd=str(ROOT),
        )
        assert result.returncode == 0, result.stderr
