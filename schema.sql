-- HacDaoTruyen — D1 Schema
-- Chạy: npx wrangler d1 execute hacdao-db --file=schema.sql --remote

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
  glossary          TEXT DEFAULT '{}',   -- JSON string (thực tế để '{}', nội dung ở R2)
  glossary_count    INTEGER DEFAULT 0,   -- số thuật ngữ (đếm sẵn cho /api/novels)
  translation_style TEXT DEFAULT '',
  notes             TEXT DEFAULT '',
  cover_url         TEXT DEFAULT '',
  status            TEXT DEFAULT 'ongoing',  -- ongoing | completed
  synopsis          TEXT DEFAULT '',         -- giới thiệu truyện (trích từ EPUB/meta)
  views             INTEGER DEFAULT 0,
  rating_sum        INTEGER DEFAULT 0,
  rating_count      INTEGER DEFAULT 0,
  has_epub          INTEGER DEFAULT 0,
  drive_file_id     TEXT DEFAULT '',
  updated_at        TEXT DEFAULT (datetime('now')),
  -- F03: gỡ xuất bản (takedown) TÁCH BIỆT khỏi status ongoing/completed —
  -- 1 truyện completed vẫn có thể bị gỡ vì lý do bản quyền. published=0 ẩn
  -- khỏi mọi đường đọc công khai (list/detail/chapters/epub/synopsis) nhưng
  -- KHÔNG xóa dữ liệu — admin có thể restore. license_note là bằng chứng
  -- provenance/license tùy chọn do admin tự ghi, KHÔNG suy luận tự động.
  published         INTEGER DEFAULT 1,
  takedown_reason   TEXT DEFAULT '',
  takedown_at       TEXT,
  license_note      TEXT DEFAULT '',
  -- Migration 016: số bản dịch phụ (bảng editions) đang published; 0 = chỉ có
  -- bản AI mặc định 'he-thong'. Worker /api/sync/edition ghi. (Production thêm
  -- bằng ALTER nên nằm SAU chapter_count — drift check so cột theo tên, không theo thứ tự.)
  edition_count     INTEGER DEFAULT 0,
  -- Migration 014: số chương (chapter_number > 0, khác nhau) lưu sẵn — chỉ dùng
  -- để sắp xếp sort=chapter_count; Worker sync + migrate_to_cloudflare.py ghi.
  chapter_count     INTEGER DEFAULT 0
);

-- F03: nhật ký thao tác admin (takedown/restore...) — audit trail, không cho sửa/xóa qua API thường.
CREATE TABLE IF NOT EXISTS admin_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,           -- 'takedown' | 'restore'
  slug       TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_slug     TEXT NOT NULL,
  filename       TEXT NOT NULL,
  title          TEXT NOT NULL,
  chapter_number INTEGER DEFAULT 0,
  r2_key         TEXT NOT NULL,   -- key trong R2: "slug/filename"
  created_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (novel_slug) REFERENCES novels(slug),
  UNIQUE(novel_slug, filename)
);

CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_slug, chapter_number);
-- Migration 013: phục vụ GET /api/updates (nhật ký cập nhật) —
-- `WHERE created_at >= datetime('now','-7 days')` chỉ đọc các dòng trong cửa sổ.
CREATE INDEX IF NOT EXISTS idx_chapters_created ON chapters(created_at);

-- Current bootstrap snapshot. Upgrade existing DBs with tools/migrate_schema.py.
-- HacDaoTruyen — Migration 002: Hệ thống tài khoản người dùng (roadmap 3.1–3.4)
-- Bảng: users, user_sessions, bookmarks, reading_progress, comments
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/002_users.sql --remote

-- Tài khoản người dùng (đăng ký bằng email + mật khẩu PBKDF2, hoặc Google)
-- Migration 009: google_id/avatar_url — tài khoản đăng nhập bằng Google có
-- password_hash rỗng ('') vì không có mật khẩu, chỉ đăng nhập qua Google.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT DEFAULT '',
  password_hash TEXT NOT NULL,               -- format: pbkdf2$100000$<salt_hex>$<hash_hex>, hoặc '' nếu chỉ đăng nhập Google
  google_id     TEXT,                        -- "sub" trong id_token Google — định danh bất biến, NULL nếu chưa liên kết
  avatar_url    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  -- Migration 017
  email_verified_at TEXT,
  last_login_at     TEXT,
  deleted_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

-- Session token (Bearer u_<hex>), TTL 30 ngày
CREATE TABLE IF NOT EXISTS user_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL,                  -- UTC "YYYY-MM-DD HH:MM:SS", so sánh với datetime('now')
  created_at TEXT,                           -- Migration 017
  user_agent TEXT,                           -- Migration 017 (rút gọn 200 ký tự, không lưu IP)
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- Truyện đã đánh dấu (bookmark) của từng user
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    INTEGER NOT NULL,
  slug       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, slug),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (slug) REFERENCES novels(slug)
);

-- Tiến độ đọc: chương gần nhất user đang đọc của mỗi truyện
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id    INTEGER NOT NULL,
  slug       TEXT NOT NULL,
  chapter    INTEGER,
  position   TEXT,               -- chuỗi vị trí: số chương dạng text hoặc CFI (EPUB)
  type       TEXT DEFAULT 'chapter' CHECK (type IN ('chapter', 'epub')), -- 'chapter' | 'epub'
  updated_at TEXT,
  client_updated_at INTEGER, -- C03: epoch ms client gửi, chặn request cũ đến muộn ghi đè bản mới
  PRIMARY KEY (user_id, slug),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (slug) REFERENCES novels(slug)
);

-- Bình luận theo truyện/chương
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  slug       TEXT NOT NULL,
  chapter    INTEGER,
  content    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (slug) REFERENCES novels(slug)
);

-- Index phục vụ query danh sách comment theo chương và dọn session hết hạn
CREATE INDEX IF NOT EXISTS idx_comments_slug_chapter ON comments(slug, chapter);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);

-- HacDaoTruyen — Migration 003: Request Novel (độc giả gợi ý truyện muốn dịch)
-- Bảng: novel_requests
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/003_novel_requests.sql --remote

-- Yêu cầu truyện mới do độc giả đã đăng nhập gửi; admin duyệt/từ chối.
-- Duyệt CHỈ đổi trạng thái, KHÔNG tự động import — admin tự chạy
-- `python main.py import --url ...` thủ công sau khi duyệt.
CREATE TABLE IF NOT EXISTS novel_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  url         TEXT NOT NULL,
  note        TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note  TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Index phục vụ query "đếm pending của user" (chống spam) và lọc theo status
CREATE INDEX IF NOT EXISTS idx_novel_requests_user_status ON novel_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_novel_requests_status ON novel_requests(status);

CREATE INDEX IF NOT EXISTS idx_novels_views ON novels(views DESC);
CREATE INDEX IF NOT EXISTS idx_novels_chapter_count ON novels(updated_at);
-- Ghi chú: idx_novels_chapter_count thực chất index theo updated_at (tên lịch sử,
-- KHÔNG đổi tên để tránh drift với production). Migration 012: index ghép cho
-- `WHERE published = 1 ORDER BY updated_at DESC` (danh sách công khai, sitemap).
CREATE INDEX IF NOT EXISTS idx_novels_published_updated ON novels(published, updated_at DESC);
-- Migration 014: `WHERE published = 1 ORDER BY chapter_count DESC` (BXH Nhiều Chương).
CREATE INDEX IF NOT EXISTS idx_novels_published_chapters ON novels(published, chapter_count DESC);

-- HacDaoTruyen — Migration 005: phiếu đánh giá có định danh (F02).
-- Thay cho việc cộng dồn vô hạn vào novels.rating_sum/rating_count mỗi lần
-- POST /api/novels/:slug/rate — mỗi user/guest chỉ giữ 1 phiếu/truyện.
CREATE TABLE IF NOT EXISTS novel_ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL REFERENCES novels(slug),
  user_id    INTEGER REFERENCES users(id),
  guest_id   TEXT,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((user_id IS NOT NULL) OR (guest_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_ratings_user
  ON novel_ratings(slug, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_ratings_guest
  ON novel_ratings(slug, guest_id) WHERE guest_id IS NOT NULL;

-- HacDaoTruyen — Migration 015: lượt đọc theo ngày, góp ý name, cài đặt người dùng.
CREATE TABLE IF NOT EXISTS novel_views_daily (
  slug  TEXT NOT NULL,
  day   TEXT NOT NULL,           -- 'YYYY-MM-DD' theo giờ Việt Nam (UTC+7)
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_novel_views_daily_day ON novel_views_daily(day, slug);

CREATE TABLE IF NOT EXISTS glossary_suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  chapter     INTEGER,
  from_text   TEXT NOT NULL,      -- cụm đang hiển thị trong bản dịch (vd "Hạ Thìn")
  to_text     TEXT NOT NULL,      -- cụm đề xuất (vd "Hạ Thần")
  original    TEXT,               -- chữ Hán gốc nếu người đọc biết (khoá glossary)
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_glossary_suggestions_status ON glossary_suggestions(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_glossary_suggestions_user ON glossary_suggestions(user_id, status);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id),
  prefs             TEXT NOT NULL DEFAULT '{}',
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  client_updated_at INTEGER
);

-- HacDaoTruyen — Migration 016: một truyện nhiều bản dịch (bản AI hiện có = mặc định ngầm định 'he-thong', không có dòng ở đây).
CREATE TABLE IF NOT EXISTS editions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_slug    TEXT NOT NULL REFERENCES novels(slug),
  code          TEXT NOT NULL,                 -- [a-z0-9-]{1,40}, khác 'he-thong'
  name          TEXT NOT NULL,                 -- tên hiển thị, vd "Bản dịch của nhóm X"
  translator    TEXT DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('ai','human','convert')),
  license_note  TEXT NOT NULL DEFAULT '',      -- giấy phép/nguồn gốc (bắt buộc khi sync)
  published     INTEGER NOT NULL DEFAULT 0,
  chapter_count INTEGER NOT NULL DEFAULT 0,    -- số chương (chapter_number > 0, khác nhau)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_slug, code)
);

CREATE TABLE IF NOT EXISTS edition_chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id     INTEGER NOT NULL REFERENCES editions(id),
  filename       TEXT NOT NULL,
  title          TEXT NOT NULL,
  chapter_number INTEGER DEFAULT 0,
  r2_key         TEXT NOT NULL,                -- "<slug>/ed/<code>/content/<sha256>.md"
  created_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(edition_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_edition_chapters_number ON edition_chapters(edition_id, chapter_number);
