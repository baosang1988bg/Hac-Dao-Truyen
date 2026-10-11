-- HacDaoTruyen — Migration 009: Đăng nhập Google cho tài khoản user thường
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/009_google_auth.sql --remote

-- google_id = "sub" trong id_token của Google (định danh tài khoản Google, bất
-- biến — KHÔNG dùng email làm khóa liên kết vì email có thể đổi phía Google).
-- Cho phép NULL vì tài khoản đăng ký bằng email+password không có giá trị này.
ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
