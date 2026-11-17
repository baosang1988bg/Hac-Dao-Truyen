-- HacDaoTruyen — Migration 014: cột novels.chapter_count lưu sẵn + index sắp xếp
--
-- Mục đích: GET /api/novels?sort=chapter_count ("BXH Nhiều Chương", "Nhiều chương
-- nhất" ở Kho EPUB/Quản trị) hết phải chạy subquery đếm chương cho TỪNG truyện
-- trên cả bảng novels (~28k dòng + toàn bộ index chapters) mỗi lần cache hết hạn.
--
-- Ai ghi cột này:
--   - Worker syncNovelBatch (mọi đường CI: auto_check, publish_range, translate_range,
--     cloud_to_cloud_syncer): dồn vào lệnh UPDATE novels đã có mỗi chunk → không
--     thêm dòng ghi, chỉ thêm 1 mục index khi số chương đổi.
--   - migrate_to_cloudflare.py: 1 lệnh UPDATE sau mỗi lượt chạy.
--   - Đường ghi cache Drive (ENABLE_DRIVE_CACHE_WRITES) đang TẮT và cố ý không ghi.
-- Worker tự dò cột: chạy được cả trước lẫn sau migration, nên thứ tự migration/deploy
-- không làm hỏng sync. Nên chạy migration TRƯỚC deploy để BXH dùng index ngay.
--
-- Chi phí một lần (ước tính): UPDATE chỉ các truyện có chương trong D1 (vài trăm
-- dòng ghi, đọc toàn bộ index chapters một lượt); CREATE INDEX ghi 1 mục/truyện
-- (~28k) → chạy vào ngày không có đợt sync lớn (gói Free: 100k dòng ghi/ngày).
--
-- Chạy (người dùng tự chạy, KHÔNG chạy tự động):
--   npx wrangler d1 execute hacdao-db --file=migrations/014_novels_chapter_count.sql --remote
-- Lệnh ALTER không có IF NOT EXISTS: chạy lần 2 sẽ báo "duplicate column" ở dòng
-- đầu — khi đó chỉ cần chạy lại 2 lệnh UPDATE/CREATE INDEX bên dưới.

ALTER TABLE novels ADD COLUMN chapter_count INTEGER DEFAULT 0;

UPDATE novels SET chapter_count = (
  SELECT COUNT(DISTINCT CASE WHEN c.chapter_number > 0 THEN c.chapter_number END)
  FROM chapters c WHERE c.novel_slug = novels.slug
) WHERE slug IN (SELECT DISTINCT novel_slug FROM chapters);

CREATE INDEX IF NOT EXISTS idx_novels_published_chapters ON novels(published, chapter_count DESC);
