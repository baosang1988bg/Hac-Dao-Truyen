-- HacDaoTruyen — D1 Schema
-- Chạy: npx wrangler d1 execute hacdao-db --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS novels (
  slug              TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  original_title    TEXT DEFAULT '',
  author            TEXT DEFAULT '',
  genre             TEXT DEFAULT '',
  source_url        TEXT DEFAULT '',
  last_translated_url TEXT DEFAULT '',
  last_chapter_number INTEGER DEFAULT 0,
  total_chapters    INTEGER DEFAULT 0,
  glossary          TEXT DEFAULT '{}',   -- JSON string (thực tế để '{}', nội dung ở R2)
  glossary_count    INTEGER DEFAULT 0,   -- số thuật ngữ (đếm sẵn cho /api/novels)
  translation_style TEXT DEFAULT '',
  notes             TEXT DEFAULT '',
  cover_url         TEXT DEFAULT '',
  status            TEXT DEFAULT 'ongoing',  -- ongoing | completed
  synopsis          TEXT DEFAULT '',         -- giới thiệu truyện (trích từ EPUB/meta)
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
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

CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_slug, chapter_number);
