-- F03: gỡ xuất bản (takedown) tách biệt khỏi status ongoing/completed.
-- Legacy databases only — schema.sql đã có các cột/bảng này cho DB mới.
ALTER TABLE novels ADD COLUMN published INTEGER DEFAULT 1;
ALTER TABLE novels ADD COLUMN takedown_reason TEXT DEFAULT '';
ALTER TABLE novels ADD COLUMN takedown_at TEXT;
ALTER TABLE novels ADD COLUMN license_note TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS admin_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  slug       TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
