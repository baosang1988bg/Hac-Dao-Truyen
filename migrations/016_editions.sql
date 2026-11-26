-- HacDaoTruyen — Migration 016: một truyện nhiều bản dịch (học từ truyentrung "ban_dich")
--
-- Bản AI hiện có của Hắc Đạo là bản MẶC ĐỊNH NGẦM ĐỊNH, code 'he-thong' — KHÔNG có
-- dòng trong bảng editions và vẫn nằm nguyên ở bảng chapters (không thêm cột vào
-- chapters: UNIQUE(novel_slug, filename) không đổi được nếu không dựng lại bảng).
-- Bản dịch khác (dịch giả người / convert / AI khác) nằm ở:
--   editions          — 1 dòng / (truyện, code). code chỉ [a-z0-9-]{1,40}, cấm 'he-thong'
--                       (Worker + migrate_to_cloudflare.py kiểm tra). license_note BẮT BUỘC
--                       khi sync (ghi rõ giấy phép/nguồn gốc bản dịch).
--   edition_chapters  — 1 dòng / chương của bản dịch; nội dung ở R2
--                       `<slug>/ed/<code>/content/<sha256>.md`.
--   novels.edition_count — số bản dịch phụ đang published (frontend chỉ hiện bộ chọn
--                       "Bản dịch" khi > 0). Worker /api/sync/edition tự cập nhật.
--
-- Worker chịu được việc migration CHƯA chạy: /api/novels/:slug/editions chỉ trả bản
-- mặc định, route bản dịch khác 404, POST /api/sync/edition 503; chi tiết truyện trả
-- edition_count = 0. Route cũ không đổi hành vi.
--
-- Chi phí một lần: CREATE TABLE/INDEX trên bảng rỗng (vài dòng ghi). ALTER TABLE
-- novels ADD COLUMN chỉ sửa schema (SQLite không viết lại ~28k dòng novels) → gần 0
-- dòng ghi. Chi phí khi dùng: ~4 dòng ghi D1 + 1 lượt ghi R2 (Class A) mỗi chương
-- bản dịch mới/sửa, +≤ 5 dòng mỗi lô (editions, novels.edition_count); gửi lại cùng
-- nội dung = 0 ghi.
--
-- Chạy (người dùng tự chạy, KHÔNG chạy tự động), TRƯỚC npm run deploy:
--   npx wrangler d1 execute hacdao-db --file=migrations/016_editions.sql --remote
-- Lệnh ALTER không có IF NOT EXISTS: chạy lần 2 sẽ báo "duplicate column" ở lệnh
-- ALTER (đặt CUỐI file nên các bảng/index phía trên đã tạo xong) — bỏ qua lỗi đó.

CREATE TABLE IF NOT EXISTS editions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_slug    TEXT NOT NULL REFERENCES novels(slug),
  code          TEXT NOT NULL,                 -- [a-z0-9-]{1,40}, khác 'he-thong'
  name          TEXT NOT NULL,                 -- tên hiển thị, vd "Bản dịch của nhóm X"
  translator    TEXT DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('ai','human','convert')),
  license_note  TEXT NOT NULL DEFAULT '',      -- giấy phép/nguồn gốc (bắt buộc khi sync)
  published     INTEGER NOT NULL DEFAULT 0,
  chapter_count INTEGER NOT NULL DEFAULT 0,    -- số chương (chapter_number > 0, khác nhau)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_slug, code)
);

CREATE TABLE IF NOT EXISTS edition_chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id     INTEGER NOT NULL REFERENCES editions(id),
  filename       TEXT NOT NULL,
  title          TEXT NOT NULL,
  chapter_number INTEGER DEFAULT 0,
  r2_key         TEXT NOT NULL,                -- "<slug>/ed/<code>/content/<sha256>.md"
  created_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(edition_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_edition_chapters_number ON edition_chapters(edition_id, chapter_number);

ALTER TABLE novels ADD COLUMN edition_count INTEGER DEFAULT 0;
