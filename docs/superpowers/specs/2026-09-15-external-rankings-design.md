# Thiết kế: Bảng xếp hạng truyện Trung Quốc hằng ngày (external rankings)

## Bối cảnh & mục tiêu

Thêm 1 section mới trên homepage, hiển thị công khai cho độc giả: top truyện đang hot
trên các trang gốc lớn (Qidian, 69shuba, novel543, Fanqie, Faloo), theo nhiều khung
thời gian (hằng ngày/hằng tuần/hằng tháng/quý) và nhiều loại (lượt đọc/lượt theo
dõi/đề cử/tổng quát), tùy theo site đó thực sự công bố loại nào — không ép mọi site
phải có đủ tổ hợp.

Đây là mục "khám phá" độc lập, KHÔNG cần khớp với catalog truyện đã dịch trên site —
truyện trong top có thể chưa được dịch. Mỗi mục có link mở tab mới ra trang gốc.

Không liên quan đến sự cố cạn quota D1 free tier (commit `37f94f0`) — quy mô dữ liệu
ở đây rất nhỏ (~100-400 dòng/ngày), không có rủi ro chi phí tương tự.

## Kiến trúc

```
GitHub Actions (cron hằng ngày, giờ khác với check_lanh_chua.yml để tránh chồng tải)
  → tools/fetch_rankings.py
      → với mỗi (source, category, window) đã cấu hình:
          fetch https://r.jina.ai/<rank-url-gốc> (urllib, giống auto_check_lanh_chua.py)
          → parser riêng theo từng site → top 20 items
      → combo nào scrape/parse lỗi thì bỏ qua, log cảnh báo, không chặn combo khác
  → POST /api/admin/sync-rankings (header x-sync-key, giống sync-novel hiện có)
  → Worker upsert vào bảng D1 `external_rankings`

Trình duyệt độc giả
  → GET /api/rankings (cache 3-6h, giống /api/stats)
  → ExternalRankingsSection.jsx trên homepage
```

Nếu 1 nguồn scrape lỗi hôm đó, dữ liệu D1 cũ của nguồn đó giữ nguyên (không xóa),
`snapshot_date` cho biết dữ liệu có thể "cũ" vài ngày — hiển thị minh bạch trên UI.

## Data model (D1)

Thêm migration mới `migrations/008_external_rankings.sql` (file cuối cùng hiện có
là `007_takedown.sql`):

```sql
CREATE TABLE IF NOT EXISTS external_rankings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,   -- 'qidian' | '69shuba' | 'novel543' | 'fanqie' | 'faloo'
  category      TEXT NOT NULL,   -- 'views' | 'follows' | 'recommend' | 'general'
  window        TEXT NOT NULL,   -- 'daily' | 'weekly' | 'monthly' | 'quarterly'
  rank          INTEGER NOT NULL,
  title         TEXT NOT NULL,
  author        TEXT DEFAULT '',
  cover_url     TEXT DEFAULT '',
  stat_label    TEXT DEFAULT '', -- text hiển thị scrape được, vd "12.3萬 lượt đọc"
  source_url    TEXT NOT NULL,   -- link ra trang gốc, mở tab mới
  snapshot_date TEXT NOT NULL,   -- ngày lấy dữ liệu, 'YYYY-MM-DD'
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rankings_slot
  ON external_rankings(source, category, window, rank);

CREATE INDEX IF NOT EXISTS idx_rankings_lookup
  ON external_rankings(source, category, window, snapshot_date);
```

Mỗi lần sync **upsert (ghi đè)** theo khóa `(source, category, window, rank)` —
KHÔNG cộng dồn lịch sử theo ngày. Bảng luôn chỉ giữ snapshot mới nhất của mỗi tổ hợp
(giữ bảng nhỏ, không cần job dọn dẹp định kỳ). `snapshot_date` chỉ để hiển thị
"cập nhật lúc...", không dùng để truy vấn lịch sử.

## Backend API (`src/index.js`)

### `POST /api/admin/sync-rankings`

- Xác thực **giống hệt pattern `/api/admin/sync-novel` hiện có**: header `x-sync-key`
  so khớp `env.SYNC_KEY` bằng `timingSafeEqualStr` (xem dòng 49-51, 76-79 của
  `src/index.js`). Dùng chung rate limiter category `sync` đã có (`SYNC_RATE_LIMITER`).
- Body JSON:
  ```json
  {
    "source": "qidian",
    "snapshot_date": "2026-09-15",
    "entries": [
      {
        "category": "views",
        "window": "daily",
        "rank": 1,
        "title": "...",
        "author": "...",
        "cover_url": "...",
        "stat_label": "12.3萬 lượt đọc",
        "source_url": "https://..."
      }
    ]
  }
  ```
- Validate cơ bản trước khi upsert: `source`/`snapshot_date` là string không rỗng,
  `entries` là mảng, mỗi entry có `category`/`window`/`rank`(số nguyên >0)/`title`/
  `source_url` không rỗng — entry thiếu field bắt buộc thì bỏ qua (không fail cả batch),
  trả về trong response số lượng đã upsert / đã bỏ qua.
- Trả về `{ upserted: N, skipped: M }`.
- 401 nếu sai/thiếu `x-sync-key`.

### `GET /api/rankings`

- Public, không cần auth.
- Không có query param bắt buộc — trả về TẤT CẢ tổ hợp `(source, category, window)`
  hiện có trong bảng, gom nhóm sẵn để frontend không cần tự group:
  ```json
  {
    "groups": [
      {
        "source": "qidian",
        "category": "views",
        "window": "daily",
        "snapshot_date": "2026-09-15",
        "items": [ { "rank":1, "title":"...", "author":"...", "cover_url":"...",
                     "stat_label":"...", "source_url":"..." }, ... ]
      }
    ]
  }
  ```
- Cache: header `Cache-Control: public, max-age=10800, s-maxage=10800` (3 giờ) —
  theo đúng pattern `getStats()` (`/api/stats`) đang dùng cho cache 5 phút, chỉ khác
  thời lượng vì dữ liệu này chỉ đổi 1 lần/ngày.

## Script scrape (`tools/fetch_rankings.py`)

- File mới, đứng cạnh `tools/auto_check_lanh_chua.py`, **tái dùng đúng pattern fetch
  qua Jina Reader** đã có ở đó (`urllib.request` tới `https://r.jina.ai/<url-gốc>`,
  header `User-Agent` giả lập trình duyệt, timeout 30s) — KHÔNG cần Playwright cho
  tính năng này.
- Đầu file: bảng cấu hình khai báo tường minh từng combo cần scrape, dạng:
  ```python
  RANKING_SOURCES = [
      {"source": "qidian", "category": "views", "window": "daily",
       "rank_url": "https://www.qidian.com/rank/...", "parser": "parse_qidian_rank"},
      # ... các combo khác, mỗi site chỉ khai những gì site đó thực sự có
  ]
  ```
- Mỗi `parser_*` là 1 hàm thuần (input: markdown/text trả về từ Jina, output: list
  dict `{rank, title, author, cover_url, stat_label, source_url}`) — viết riêng theo
  từng site vì định dạng khác nhau, không dùng chung 1 parser.
- Vòng lặp chính: với mỗi combo trong `RANKING_SOURCES`, fetch + parse trong
  try/except riêng — lỗi ở 1 combo (site đổi giao diện, bị chặn, tạm thời sập) chỉ
  log cảnh báo và bỏ qua combo đó, KHÔNG dừng toàn bộ script.
- Gom kết quả theo `source`, POST từng batch lên `/api/admin/sync-rankings` — tái
  dùng đúng cơ chế đọc `HACDAO_SYNC_KEY` từ env và gửi HTTP request đã có trong
  hàm `sync_via_worker_api` của `auto_check_lanh_chua.py` (đọc lại file đó để lấy
  đúng cách build request/header/retry, không viết lại từ đầu).
- In log rõ ràng: combo nào thành công (số item lấy được), combo nào bị bỏ qua và lý do.

## GitHub Actions workflow

- File mới `.github/workflows/fetch_rankings.yml`, mô phỏng cấu trúc
  `check_lanh_chua.yml` (`actions/checkout`, `actions/setup-python`, cài
  `requirements.lock`, chạy script, không cần cài Playwright vì không dùng).
- `schedule: cron: '30 17 * * *'` (00:30 giờ VN) — lệch 30 phút so với
  `check_lanh_chua.yml` (chạy 00:00) để tránh chồng tải cùng lúc.
- `workflow_dispatch:` để chạy tay khi cần test.
- Secret cần: `HACDAO_SYNC_KEY` (đã có sẵn trong repo, tái dùng).
- KHÔNG cần bước "Commit và push kết quả" như `check_lanh_chua.yml` — script này
  chỉ ghi lên D1 qua API, không sinh ra file cần commit vào repo.

## Frontend (`frontend/src/pages/homepage/ExternalRankingsSection.jsx`)

- Component mới, theo đúng pattern các section khác (skeleton loading,
  `AbortController` khi unmount, tự ẩn khi lỗi — xem `UpdatesSection.jsx` làm mẫu).
- Fetch `GET /api/rankings` một lần khi mount.
- Tab cấp 1: theo `source` (chỉ hiện source nào có ít nhất 1 group dữ liệu).
- Trong mỗi source, tab/dropdown cấp 2: theo `category` + `window` — chỉ hiện tổ hợp
  mà source đó thực sự có (không hiện tab rỗng).
- Mỗi item: rank, title, author, stat_label, ảnh cover (nếu có) — bấm vào mở
  `source_url` ở tab mới (`target="_blank" rel="noopener noreferrer"`).
- Hiển thị "Cập nhật: {snapshot_date}" cho mỗi group.
- Thêm vào `HomePage.jsx` theo đúng cách các section khác đang được import/render.

## Testing

- Worker: thêm test cho `/api/admin/sync-rankings` (401 khi sai key, upsert đúng,
  bỏ qua entry thiếu field) và `/api/rankings` (group đúng, cache header đúng)
  trong `tests/worker/*.test.mjs`, theo đúng pattern test hiện có trong thư mục đó.
- Script Python: unit test từng `parser_*` bằng fixture markdown/HTML mẫu cố định
  lưu sẵn trong repo (không gọi mạng thật trong test/CI).
- Không cần test tích hợp thật với Qidian/69shuba... trong CI (tránh phụ thuộc
  mạng ngoài + tránh bị chặn khi CI chạy).

## Ngoài phạm vi (out of scope)

- Không tính toán window hằng tuần/tháng/quý từ dữ liệu tự thu thập — chỉ lấy đúng
  trang BXH có sẵn của từng site cho khung thời gian đó.
- Không khớp/link chéo với catalog truyện đã dịch của HacDaoTruyen.
- Không giữ lịch sử theo ngày (chỉ giữ snapshot mới nhất mỗi tổ hợp).
