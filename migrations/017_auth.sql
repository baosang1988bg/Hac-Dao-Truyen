-- HacDaoTruyen — Migration 017: đăng nhập Google an toàn + quản lý tài khoản
-- Kế hoạch: plans/KE_HOACH_TRIEN_KHAI_DANG_NHAP_2026-11-27.md
--
-- users.email_verified_at : đặt khi đăng nhập Google (email đã được Google xác minh).
--                           Tài khoản có mật khẩu mà cột này trống bị coi là email
--                           CHƯA xác minh → khi liên kết Google, Worker xoá mật khẩu
--                           + mọi session cũ (vá pre-account hijacking).
-- users.last_login_at     : hiển thị ở trang Tài khoản.
-- users.deleted_at        : tài khoản đã xoá (dòng được giữ, đã ẩn danh, để bình
--                           luận/góp ý cũ không gãy khoá ngoại).
-- user_sessions.created_at, user_agent : danh sách "thiết bị đang đăng nhập". Không lưu IP.
--
-- Chi phí: chỉ ADD COLUMN (đổi metadata, không ghi lại từng dòng) → vài dòng ghi.
-- Worker tự dò cột (PRAGMA table_info) nên chạy được cả trước lẫn sau migration.
-- Chạy (người dùng tự chạy, sau 013–016, TRƯỚC npm run deploy):
--   npx wrangler d1 execute hacdao-db --file=migrations/017_auth.sql --remote
-- ALTER không có IF NOT EXISTS: chạy lại sẽ báo "duplicate column" — bỏ qua được.

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE user_sessions ADD COLUMN created_at TEXT;
ALTER TABLE user_sessions ADD COLUMN user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
