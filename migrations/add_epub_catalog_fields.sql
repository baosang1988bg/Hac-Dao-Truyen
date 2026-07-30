-- Migration: Thêm cột views, rating, has_epub vào bảng novels
ALTER TABLE novels ADD COLUMN views INTEGER DEFAULT 0;
ALTER TABLE novels ADD COLUMN rating_sum INTEGER DEFAULT 0;
ALTER TABLE novels ADD COLUMN rating_count INTEGER DEFAULT 0;
ALTER TABLE novels ADD COLUMN has_epub INTEGER DEFAULT 0;

-- Index để sort hiệu quả
CREATE INDEX IF NOT EXISTS idx_novels_views ON novels(views DESC);
CREATE INDEX IF NOT EXISTS idx_novels_chapter_count ON novels(updated_at);
