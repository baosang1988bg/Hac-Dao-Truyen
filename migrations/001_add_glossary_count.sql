-- Migration 001: thêm cột glossary_count vào bảng novels (roadmap 1.1)
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/001_add_glossary_count.sql --remote
-- (SQLite không có ALTER TABLE IF NOT EXISTS — nếu cột đã tồn tại lệnh sẽ báo lỗi, bỏ qua được)
ALTER TABLE novels ADD COLUMN glossary_count INTEGER DEFAULT 0;
