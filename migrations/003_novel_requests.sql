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
  status      TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
  admin_note  TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);

-- Index phục vụ query "đếm pending của user" (chống spam) và lọc theo status
CREATE INDEX IF NOT EXISTS idx_novel_requests_user_status ON novel_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_novel_requests_status ON novel_requests(status);
