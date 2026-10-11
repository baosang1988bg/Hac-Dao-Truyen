-- HacDaoTruyen — Migration 010: bổ sung cột reading_progress còn thiếu trên
-- production (position/type/client_updated_at có sẵn trong schema.sql cho DB
-- mới từ lâu, nhưng chưa từng có migration ALTER cho DB cũ — phát hiện qua
-- audit tools/migrate_schema.py --remote ngày 2026-09-17: POST /api/user/progress
-- đang lỗi "no such column" thật trên production).
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/010_reading_progress_columns.sql --remote
--
-- KHÔNG thêm CHECK (type IN ('chapter','epub')) như schema.sql — SQLite
-- không hỗ trợ ADD COLUMN kèm CHECK; validate đã có ở tầng code
-- (userProgressUpdate() trong src/index.js).
ALTER TABLE reading_progress ADD COLUMN position TEXT;
ALTER TABLE reading_progress ADD COLUMN type TEXT DEFAULT 'chapter';
ALTER TABLE reading_progress ADD COLUMN client_updated_at INTEGER;
