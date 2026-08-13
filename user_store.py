"""
user_store.py
-------------
Lưu trữ tài khoản người dùng (roadmap 3.1–3.4) trên SQLite `data/users.db`.

- Schema tạo tự động khi import (users, user_sessions, bookmarks,
  reading_progress, comments), PRAGMA journal_mode=WAL.
- Password hash: `pbkdf2$100000$<salt_hex>$<hash_hex>` (PBKDF2-HMAC-SHA256,
  salt 16 bytes) — format cố định để tương thích Worker D1 sau này.
- Token user: 'u_' + secrets.token_hex(32), TTL 30 ngày, lưu bảng
  user_sessions; session hết hạn được xóa lazily mỗi lần tra token.
- Connection mở mới cho mỗi thao tác (_conn) — an toàn đa thread.
"""

import os
import re
import hmac
import hashlib
import secrets
import sqlite3

# ── Cấu hình ──────────────────────────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "users.db")

# TTL của token user — 30 ngày (dùng modifier của SQLite datetime)
TOKEN_TTL_SQL = "+30 days"
# Khoảng cách tối thiểu giữa 2 comment của cùng user (giây)
COMMENT_COOLDOWN_SECONDS = 20
# Số request truyện đang 'pending' tối đa mỗi user được giữ cùng lúc (chống spam)
MAX_PENDING_NOVEL_REQUESTS = 3

# Regex email đơn giản — đồng bộ với Worker D1
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookmarks (
    user_id    INTEGER,
    slug       TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, slug)
);
CREATE TABLE IF NOT EXISTS reading_progress (
    user_id    INTEGER,
    slug       TEXT,
    chapter    INTEGER,
    updated_at TEXT,
    PRIMARY KEY (user_id, slug)
);
CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    slug       TEXT,
    chapter    INTEGER,
    content    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS novel_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    url        TEXT NOT NULL,
    note       TEXT DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT
);
"""


def _conn() -> sqlite3.Connection:
    """Mở connection mới (per-request), row trả về dạng dict-like."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    """Tạo thư mục data/ + schema nếu chưa có (chạy khi import)."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with _conn() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)


# ── Password ─────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Băm mật khẩu: pbkdf2$100000$<salt_hex>$<hash_hex> (PBKDF2-HMAC-SHA256)."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
    return f"pbkdf2$100000${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """So khớp mật khẩu với hash đã lưu (constant-time)."""
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


def is_valid_email(email: str) -> bool:
    """Kiểm tra email bằng regex đơn giản."""
    return bool(_EMAIL_RE.match(email or ""))


# ── Users & sessions ─────────────────────────────────────────────────────────

def create_user(email: str, password: str, name: str = "") -> dict | None:
    """Tạo user mới; trả về dict user hoặc None nếu email đã tồn tại."""
    try:
        with _conn() as conn:
            cur = conn.execute(
                "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
                (email, name, hash_password(password)),
            )
            return {"id": cur.lastrowid, "email": email, "name": name}
    except sqlite3.IntegrityError:
        return None


def authenticate(email: str, password: str) -> dict | None:
    """Kiểm tra email+password; trả về dict user hoặc None nếu sai."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, email, name, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()
    if row is None or not verify_password(password, row["password_hash"]):
        return None
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def create_session(user_id: int) -> str:
    """Phát token mới cho user, TTL 30 ngày."""
    token = "u_" + secrets.token_hex(32)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO user_sessions (token, user_id, expires_at) "
            "VALUES (?, ?, datetime('now', ?))",
            (token, user_id, TOKEN_TTL_SQL),
        )
    return token


def delete_session(token: str) -> None:
    """Xóa session (logout)."""
    with _conn() as conn:
        conn.execute("DELETE FROM user_sessions WHERE token = ?", (token,))


def get_user_by_token(token: str) -> dict | None:
    """Tra user theo token; xóa session hết hạn lazily. None nếu không hợp lệ."""
    with _conn() as conn:
        conn.execute(
            "DELETE FROM user_sessions WHERE expires_at < datetime('now')"
        )
        row = conn.execute(
            "SELECT u.id, u.email, u.name FROM user_sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,),
        ).fetchone()
    return dict(row) if row else None


# ── Bookmarks ────────────────────────────────────────────────────────────────

def list_bookmarks(user_id: int) -> list[dict]:
    """Danh sách bookmark của user, mới nhất trước."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT slug, created_at FROM bookmarks "
            "WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def add_bookmark(user_id: int, slug: str) -> None:
    """Thêm bookmark (idempotent — đã có thì bỏ qua)."""
    with _conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO bookmarks (user_id, slug) VALUES (?, ?)",
            (user_id, slug),
        )


def remove_bookmark(user_id: int, slug: str) -> None:
    """Xóa bookmark (không có cũng coi như thành công)."""
    with _conn() as conn:
        conn.execute(
            "DELETE FROM bookmarks WHERE user_id = ? AND slug = ?",
            (user_id, slug),
        )


# ── Reading progress ─────────────────────────────────────────────────────────

def list_progress(user_id: int) -> list[dict]:
    """Tiến độ đọc của user, cập nhật gần nhất trước."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT slug, chapter, updated_at FROM reading_progress "
            "WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def set_progress(user_id: int, slug: str, chapter: int) -> None:
    """Upsert tiến độ đọc một truyện."""
    with _conn() as conn:
        conn.execute(
            "INSERT INTO reading_progress (user_id, slug, chapter, updated_at) "
            "VALUES (?, ?, ?, datetime('now')) "
            "ON CONFLICT(user_id, slug) DO UPDATE SET "
            "chapter = excluded.chapter, updated_at = excluded.updated_at",
            (user_id, slug, chapter),
        )


# ── Comments ─────────────────────────────────────────────────────────────────

def list_comments(slug: str, chapter: int | None = None, limit: int = 100) -> list[dict]:
    """Comment của một truyện (lọc theo chương nếu có), mới nhất trước."""
    sql = (
        "SELECT c.id, COALESCE(u.name, '') AS user_name, c.chapter, "
        "c.content, c.created_at FROM comments c "
        "LEFT JOIN users u ON u.id = c.user_id WHERE c.slug = ?"
    )
    params: list = [slug]
    if chapter is not None:
        sql += " AND c.chapter = ?"
        params.append(chapter)
    sql += " ORDER BY c.id DESC LIMIT ?"
    params.append(limit)
    with _conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def user_commented_recently(user_id: int) -> bool:
    """True nếu user đã comment trong COMMENT_COOLDOWN_SECONDS giây gần nhất."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM comments WHERE user_id = ? "
            f"AND created_at > datetime('now', '-{COMMENT_COOLDOWN_SECONDS} seconds') "
            "LIMIT 1",
            (user_id,),
        ).fetchone()
    return row is not None


def add_comment(user_id: int, slug: str, chapter: int, content: str) -> int:
    """Thêm comment, trả về id."""
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO comments (user_id, slug, chapter, content) "
            "VALUES (?, ?, ?, ?)",
            (user_id, slug, chapter, content),
        )
        return cur.lastrowid


def get_comment(comment_id: int) -> dict | None:
    """Lấy 1 comment theo id (kèm user_id để kiểm tra chính chủ)."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, user_id, slug, chapter, content, created_at "
            "FROM comments WHERE id = ?",
            (comment_id,),
        ).fetchone()
    return dict(row) if row else None


def delete_comment(comment_id: int) -> None:
    """Xóa comment theo id."""
    with _conn() as conn:
        conn.execute("DELETE FROM comments WHERE id = ?", (comment_id,))


# ── Novel requests (độc giả gợi ý truyện muốn dịch) ─────────────────────────

def count_pending_requests(user_id: int) -> int:
    """Đếm số request đang 'pending' của user — dùng để chặn spam (tối đa
    MAX_PENDING_NOVEL_REQUESTS request cùng lúc, khác cooldown thời gian của comment)."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM novel_requests WHERE user_id = ? AND status = 'pending'",
            (user_id,),
        ).fetchone()
    return row["n"] if row else 0


def create_novel_request(user_id: int, url: str, note: str = "") -> int:
    """Tạo request mới, trả về id."""
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO novel_requests (user_id, url, note) VALUES (?, ?, ?)",
            (user_id, url, note),
        )
        return cur.lastrowid


def list_my_requests(user_id: int) -> list[dict]:
    """Danh sách request của chính user, mới nhất trước."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, url, note, status, admin_note, created_at, reviewed_at "
            "FROM novel_requests WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def list_all_requests(status: str | None = None) -> list[dict]:
    """Danh sách TẤT CẢ request (admin), lọc theo status nếu có, mới nhất trước,
    kèm email người gửi."""
    sql = (
        "SELECT r.id, r.user_id, COALESCE(u.email, '') AS email, r.url, r.note, "
        "r.status, r.admin_note, r.created_at, r.reviewed_at "
        "FROM novel_requests r LEFT JOIN users u ON u.id = r.user_id"
    )
    params: list = []
    if status:
        sql += " WHERE r.status = ?"
        params.append(status)
    sql += " ORDER BY r.id DESC"
    with _conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_novel_request(request_id: int) -> dict | None:
    """Lấy 1 request theo id."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, user_id, url, note, status, admin_note, created_at, reviewed_at "
            "FROM novel_requests WHERE id = ?",
            (request_id,),
        ).fetchone()
    return dict(row) if row else None


def review_novel_request(request_id: int, status: str, admin_note: str = "") -> bool:
    """Cập nhật status + admin_note + reviewed_at=now. Trả về False nếu không tìm thấy id."""
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE novel_requests SET status = ?, admin_note = ?, "
            "reviewed_at = datetime('now') WHERE id = ?",
            (status, admin_note, request_id),
        )
        return cur.rowcount > 0


# Tạo DB + schema ngay khi import module
_init_db()
