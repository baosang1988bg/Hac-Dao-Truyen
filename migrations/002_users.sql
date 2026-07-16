-- HacDaoTruyen — Migration 002: Hệ thống tài khoản người dùng (roadmap 3.1–3.4)
-- Bảng: users, user_sessions, bookmarks, reading_progress, comments
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/002_users.sql --remote

-- Tài khoản người dùng (đăng ký bằng email + mật khẩu PBKDF2)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT DEFAULT '',
  password_hash TEXT NOT NULL,               -- format: pbkdf2$100000$<salt_hex>$<hash_hex>
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Session token (Bearer u_<hex>), TTL 30 ngày
CREATE TABLE IF NOT EXISTS user_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL                   -- UTC "YYYY-MM-DD HH:MM:SS", so sánh với datetime('now')
);

-- Truyện đã đánh dấu (bookmark) của từng user
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    INTEGER,
  slug       TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, slug)
);

-- Tiến độ đọc: chương gần nhất user đang đọc của mỗi truyện
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id    INTEGER,
  slug       TEXT,
  chapter    INTEGER,
  updated_at TEXT,
  PRIMARY KEY (user_id, slug)
);

-- Bình luận theo truyện/chương
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  slug       TEXT,
  chapter    INTEGER,
  content    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index phục vụ query danh sách comment theo chương và dọn session hết hạn
CREATE INDEX IF NOT EXISTS idx_comments_slug_chapter ON comments(slug, chapter);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
