-- C03: cho phép từ chối request tiến độ đọc cũ đến muộn ghi đè bản mới hơn.
-- Legacy databases only — schema.sql đã có cột này cho DB mới.
ALTER TABLE reading_progress ADD COLUMN client_updated_at INTEGER;
