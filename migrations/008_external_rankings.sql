CREATE TABLE IF NOT EXISTS external_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  window TEXT NOT NULL,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  stat_label TEXT DEFAULT '',
  source_url TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rankings_slot
  ON external_rankings(source, category, window, rank);
CREATE INDEX IF NOT EXISTS idx_rankings_lookup
  ON external_rankings(source, category, window, snapshot_date);
