-- F02: bảng phiếu đánh giá có định danh, thay cho việc cộng dồn vô hạn vào
-- novels.rating_sum/rating_count mỗi lần POST /api/novels/:slug/rate.
-- Người dùng đăng nhập: định danh bằng user_id (FK users).
-- Guest: định danh bằng guest_id do client tự sinh (localStorage) và gửi qua
-- header X-Guest-Id — CHỈ để chống double-submit vô ý, KHÔNG phải cơ chế
-- chống gian lận tuyệt đối (client có thể xóa/đổi guest_id bất kỳ lúc nào).
CREATE TABLE IF NOT EXISTS novel_ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL REFERENCES novels(slug),
  user_id    INTEGER REFERENCES users(id),
  guest_id   TEXT,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((user_id IS NOT NULL) OR (guest_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_ratings_user
  ON novel_ratings(slug, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_ratings_guest
  ON novel_ratings(slug, guest_id) WHERE guest_id IS NOT NULL;
