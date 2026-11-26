-- HacDaoTruyen — Migration 015: học từ đối thủ (truyentrung / sangtacviet / truyenon)
--
-- 1) novel_views_daily — lượt đọc THẬT theo ngày (giờ VN) cho BXH Ngày/Tuần/Tháng.
--    Chỉ ghi khi Reader báo đã đọc ≥ 30 giây + cuộn gần cuối chương, kèm token
--    HMAC do Worker ký (xem POST /api/novels/:slug/read-start và /view).
--    Mỗi lượt đọc thật = 2 dòng ghi (UPDATE novels.views + UPSERT dòng ngày).
-- 2) glossary_suggestions — người đọc góp ý sửa name/cụm từ (sangtacviet "name
--    chung"); admin duyệt → thành quy tắc thay thế công khai của truyện (R2
--    <slug>/replacements.json) và tuỳ chọn ghi thẳng vào glossary R2.
-- 3) user_prefs — cài đặt Reader + quy tắc thay thế cá nhân đồng bộ theo tài
--    khoản (truyentrung saveReaderPrefs). 1 dòng / user.
--
-- Worker chịu được việc migration CHƯA chạy: các route mới bắt lỗi "no such
-- table" và trả 503/[] thay vì 500, route cũ không đổi hành vi.
--
-- Chạy (người dùng tự chạy, KHÔNG chạy tự động), TRƯỚC npm run deploy:
--   npx wrangler d1 execute hacdao-db --file=migrations/015_reader_engagement.sql --remote
-- Chi phí: chỉ CREATE TABLE/INDEX trên bảng rỗng → vài dòng ghi. Chạy lại an toàn (IF NOT EXISTS).

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
