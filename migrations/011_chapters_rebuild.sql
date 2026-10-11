-- HacDaoTruyen — Migration 011: rebuild bảng `chapters` để khớp schema.sql
-- Phát hiện qua audit tools/migrate_schema.py --check-drift 2026-09-17:
-- production có chapter_number kiểu `INT` (không phải `INTEGER`),
-- created_at kiểu `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` (không phải
-- `TEXT DEFAULT (datetime('now'))`), thiếu UNIQUE(novel_slug,filename) ở
-- mức bảng (đang thay bằng index rời `idx_chapters_slug_filename`), và
-- thiếu index idx_chapters_novel. Đã audit dữ liệu thật trước khi viết
-- migration này: 0 NULL vi phạm NOT NULL mới, 0 trùng (novel_slug,filename),
-- 0 dòng mồ côi FK novel_slug — an toàn để rebuild.
--
-- Rollback thủ công nếu cần: DROP TABLE chapters; ALTER TABLE chapters__pre_migration RENAME TO chapters;
-- Chạy: npx wrangler d1 execute hacdao-db --file=migrations/011_chapters_rebuild.sql --remote

ALTER TABLE chapters RENAME TO chapters__pre_migration;

CREATE TABLE chapters (
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

INSERT INTO chapters (id, novel_slug, filename, title, chapter_number, r2_key, created_at)
SELECT id, novel_slug, filename, title, chapter_number, r2_key, created_at FROM chapters__pre_migration;

INSERT INTO sqlite_sequence(name, seq)
SELECT 'chapters', COALESCE((SELECT MAX(id) FROM chapters), 0)
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'chapters');

UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM chapters), 0) WHERE name = 'chapters';

CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_slug, chapter_number);
