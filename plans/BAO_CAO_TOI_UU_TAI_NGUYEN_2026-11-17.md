# Báo cáo: phân tích API và tối ưu mức tốn tài nguyên (2026-11-17)

Nhánh `dev`, chưa push, chưa deploy. Không chạm D1/R2 production.

## 1. Kết luận chính

Site chạm giới hạn nhanh vì ba nguyên nhân cộng dồn, xếp theo mức độ nghiêm trọng:

1. **Trang tổng quan quản trị tải hết catalog.** `AdminDashboard` gọi `fetchAdminNovels()`: lặp mọi trang của `GET /api/novels` (200 truyện/trang) chỉ để cộng ba con số. Mọi request có token admin nên Worker bỏ qua edge cache. Với khoảng 28.000 truyện (con số ghi trong comment của `getNovels`), một lần mở trang là khoảng 140 request liên tiếp; mỗi request chạy `COUNT(*)` trên cả bảng và `OFFSET` tăng dần. Ước tính 6 triệu hàng D1 đọc cho **một lần mở trang**, trong khi gói Free cho 5 triệu hàng/ngày. 140 request dồn dập cũng vượt ngưỡng 120 request/phút/IP nên bị 429.
2. **Mọi file tĩnh và ảnh bìa đều đi qua Worker.** `run_worker_first: true` khiến mỗi file JS/CSS/icon là một lần gọi Worker. Ảnh bìa đi qua `/api/proxy-cover` nhưng response chỉ có header `s-maxage`, không được ghi vào Cache API, nên edge không cache: mỗi lượt xem bìa là một lần Worker tải lại ảnh từ host nguồn. Các lượt này còn tính vào ngưỡng 120 request/phút/IP.
3. **Truy vấn quét cả bảng với TTL ngắn.** `/api/stats` (5 phút), `/api/novels/genres` (1 giờ), `COUNT(*)` của mọi biến thể `/api/novels` (2 phút), và các kiểu sắp xếp không có index (`chapter_count`, `rating`, `title`) đều đọc toàn bộ bảng `novels` mỗi lần cache hết hạn.

Các con số trên là ước tính từ code và schema. Tôi không có quyền xem dashboard Cloudflare nên chưa đối chiếu được với số đo thật.

## 2. Bản đồ API và chi phí

| Endpoint | Chi phí mỗi lần MISS (trước) | Cache trước | Cache sau |
|---|---|---|---|
| `GET /api/novels` (mặc định, `views`) | `COUNT(*)` cả bảng + 1 trang + đếm mọi chương của từng truyện trong trang | edge 2 phút | edge 5 phút, `COUNT` nhớ 15 phút, số chương nhớ theo `(slug, updated_at)` |
| `GET /api/novels?sort=chapter_count` | quét cả bảng + subquery đếm chương cho từng truyện | edge 2 phút | edge 1 giờ |
| `GET /api/novels?sort=rating\|title` | quét và sắp cả bảng | edge 2 phút | edge 30 phút |
| `GET /api/novels?q=\|genre=\|status=\|has_epub=` | `LIKE` trên cả bảng (không index) | edge 2 phút | edge 10 phút |
| `GET /api/novels?slugs=` | tra khoá chính + `COUNT` | edge 2 phút | edge 2 phút, bỏ `COUNT` |
| `GET /api/stats` | aggregate cả bảng `novels` | edge 5 phút | edge 1 giờ |
| `GET /api/novels/genres` | `DISTINCT genre` cả bảng | edge 1 giờ | edge 6 giờ |
| `GET /api/novels/:slug` | đếm mọi chương của truyện | edge 5 phút | edge 15 phút, số chương nhớ theo `(slug, updated_at)` |
| `GET /api/novels/:slug/chapters` | đọc mọi dòng chương + 1 object R2 | edge 10 phút | edge 30 phút |
| `GET /api/novels/:slug/chapters/:id` | 1 dòng D1 (trước cache) + 1 object R2 | edge 1 giờ | không đổi |
| `GET /api/novels/:slug/synopsis` | 1 dòng D1 + 1 object R2 | không cache | edge 1 giờ |
| `GET /api/novels/:slug/comments` | 2 truy vấn D1 mỗi lượt đọc chương | không cache | khách: 60 giây; đã đăng nhập: luôn mới |
| `GET /api/comments/recent` | join 3 bảng | không cache | edge 5 phút |
| `GET /api/updates` | các chương trong 7 ngày (có index) | edge 5 phút | edge 10 phút |
| `GET /api/rankings` | nhỏ | edge 1 giờ | không đổi |
| `GET /api/proxy-cover` | 1 subrequest tải ảnh, tính rate limit | **không cache ở edge** | edge + trình duyệt 30 ngày; HIT không tính rate limit |
| `GET /api/novels/:slug/epub` | 1 dòng D1 + stream cả file từ Drive/R2 | trình duyệt 1 ngày | không đổi (xem mục 6) |
| File tĩnh (`/assets/*`, `sw.js`, icon, `/`) | 1 lần gọi Worker mỗi file | — | phục vụ thẳng, không gọi Worker |

Sync và takedown vẫn purge chi tiết truyện, mục lục và chương vừa ghi như cũ, nên chương mới không phải chờ hết TTL ở colo nhận lệnh sync.

## 3. Trang nào gọi nhiều nhất

Số request vào Worker cho một lượt xem đầu tiên của khách (ước tính từ code; ảnh bìa tải lười nên số thực tế phụ thuộc mức cuộn):

| Trang | Trước | Sau | Ghi chú |
|---|---|---|---|
| Quản trị → Tổng quan | ~140 API + poll 12 lần/phút | 2 API + poll 4 lần/phút | Nguồn tốn D1 lớn nhất |
| Trang chủ | 7–8 API + ~9 file tĩnh + tới ~55 bìa | 3 API lúc mở, 4 API còn lại chỉ khi cuộn tới; 0 file tĩnh | Bìa vẫn 1 request/ảnh nhưng trả từ edge cache |
| Kho EPUB | 2 API + 24 bìa mỗi lần tải | 2 API + 12 bìa mỗi lần tải | Bấm "Tải thêm" mới lấy lô kế |
| Reader | 3 API + 1 bình luận + 1 prefetch chương kế | như cũ, bình luận và mục lục cache lâu hơn | Đã hợp lý từ trước |
| Trang truyện | 2 API + bookmark nếu đăng nhập | như cũ | |
| Quản trị → chi tiết truyện đang dịch | poll 30 lần/phút | poll 12 lần/phút, dừng khi tab ẩn | |

## 4. Việc đã làm

**Worker (`src/index.js`).** `proxyCover` ghi và đọc Cache API; route này được xét trước rate limit, chỉ khi MISS mới qua limiter. `getNovels` nhớ kết quả `COUNT(*)` theo bộ lọc (biến module + Cache API 15 phút) và bỏ `COUNT` khi tra theo `slugs`. TTL edge của `/api/novels` phụ thuộc chi phí truy vấn. `cachedJsonResponse` có thêm tuỳ chọn `cacheParams` để route có query (bình luận) khai báo tham số nào vào cache key. `/api/stats` trả thêm `translated_novels`, tính chung một lượt quét với `translated_chapters` (cache 6 giờ).

**Thống kê chương (đợt 2).** Số chương và tên chương mới nhất của một truyện chỉ đổi khi có sync, và mọi đường sync đều ghi lại `novels.updated_at`. Worker giờ nhớ kết quả theo cặp `(slug, updated_at)` trong một blob Cache API (24 giờ, tối đa 3.000 truyện): khớp thì dùng lại, lệch thì tính lại đúng truyện đó. Trước đây danh sách "Mới cập nhật" (30 truyện, phần lớn là truyện dài) đếm lại toàn bộ chương của cả 30 truyện mỗi 5 phút. Truyện vừa sync trong 2 phút gần nhất không được nhớ, vì `updated_at` chỉ chính xác tới giây. Cách này không cần migration và không thêm lượt ghi D1.

**Cấu hình (`wrangler.jsonc`, `frontend/public/_headers`).** `run_worker_first` đổi từ `true` sang danh sách `/api/*`, `/sitemap.xml`, `/robots.txt`. File tĩnh có thật được Cloudflare phục vụ thẳng; đường dẫn không có file (`/library`, `/novel/:slug`, asset hash cũ) vẫn rơi về Worker như trước. `_headers` giữ `immutable` cho `/assets/*`.

**Frontend.**
- `publicApi` (axios không gắn token) cho `cachedGet`: admin đã đăng nhập lướt trang khách không còn làm mọi request bỏ qua edge cache. TTL client mặc định 1 phút → 5 phút.
- Kho EPUB: 12 truyện/lần, tìm kiếm từ 2 ký tự và chờ 450 ms, dùng `cachedGet`.
- Trang chủ: `LazyMount` cho thể loại + tất cả truyện, BXH nguồn ngoài, bình luận, thống kê; tìm kiếm từ 2 ký tự, chờ 400 ms, lấy 24 kết quả thay vì 50.
- Quản trị: tổng quan dùng `/api/stats` và tra tên truyện đang dịch bằng `?slugs=`; `usePolling` 15 giây, dừng khi tab ẩn.

## 5. Kiểm chứng

Chạy trên bản sao Linux của repo (`npm ci` riêng, không đụng `node_modules` trên Mac):

| Hạng mục | Kết quả |
|---|---|
| Test Worker | 97/97 (88 cũ + 9 mới trong `tests/worker/resource-usage.test.mjs`) |
| Test frontend | 49/49 |
| pytest | 469/469 |
| `eslint --max-warnings 0`, `vite build` | sạch, thành công |
| `wrangler dev --local` | file tĩnh, SPA fallback, asset thiếu trả 404 `no-store`, các API trả đúng `Cache-Control` và `X-Worker-Cache` MISS → HIT |

Tám test của đợt 1 đều thất bại khi chạy với `src/index.js` cũ, tức là chúng thực sự kiểm tra hành vi mới. Test thứ chín (đợt 2) kiểm tra việc nhớ số chương: chỉ truyện đổi `updated_at` hoặc vừa sync mới bị tính lại, kể cả sau khi đổi isolate.

Ba test cũ phải sửa: hai test khẳng định `Cache-Control` và khoá JSON của `/api/stats`; một test synopsis gọi lại cùng URL sau khi đổi dữ liệu (giờ đã có cache nên gọi lại bằng request có `Authorization`). Test `D1 bootstrap … concurrent` trong `runtime.test.mjs` thỉnh thoảng ném "Body has already been read" trên response 200 khi chạy cả bộ dưới tải (khoảng 6/25 lượt với code mới, 0/16 với code cũ). Tôi chưa tìm ra cơ chế chính xác; sửa test để đọc body ngay trong từng promise thì 11/11 lượt sau đều xanh. Nếu CI còn gặp lại lỗi này thì cần điều tra tiếp.

Chưa kiểm chứng được: hành vi `run_worker_first` dạng danh sách trên Cloudflare thật (mới thử bằng `wrangler dev` 4.89), giao diện trên trình duyệt thật (không chụp được màn hình), và số đo rows_read/request sau deploy.

## 6. Việc bạn cần làm và giới hạn còn lại

Deploy theo quy trình cũ (`git push` từ Mac, rồi `npm run deploy` từ `main` sạch). Sau deploy nên xem lại dashboard Cloudflare sau 24 giờ: Workers → Requests, D1 → Rows read.

Thay đổi hành vi cần biết:
- Tổng số truyện ("N truyện", số trang) có thể trễ tối đa 15 phút sau khi thêm hoặc gỡ truyện.
- Mục lục ở colo khác colo nhận sync có thể trễ tối đa 30 phút (trước là 10 phút); chi tiết truyện 15 phút.
- Admin xem trang khách giờ thấy đúng dữ liệu của khách: truyện đã gỡ trả 404 ở trang khách, vẫn xem được trong khu quản trị.
- Khách thấy bình luận mới của người khác trễ tối đa 60 giây.
- Công cụ sửa hoặc xoá dòng `chapters` trực tiếp mà không ghi lại `novels.updated_at` (ví dụ dedupe thủ công bằng SQL) sẽ thấy số chương cũ tối đa 24 giờ. Chạy `UPDATE novels SET updated_at = datetime('now') WHERE slug = '…'` sau khi sửa để làm mới ngay.
- "BXH Nhiều Chương" và sắp xếp "Nhiều chương nhất" có thể trễ tối đa 1 giờ.

Còn lại sau đợt 3 (xem mục 8 cho lý do từng quyết định):
- **Tìm kiếm** vẫn là `LIKE` trên cả bảng, chưa chuyển FTS5.
- **Ảnh bìa** vẫn là 1 request Worker mỗi ảnh mỗi trình duyệt (30 ngày), chưa chép sang R2 công khai.
- **EPUB trên 20 MB** hoặc Drive không báo kích thước vẫn stream thẳng, không cache.
- `AdminNovels` vẫn gọi `/api/novels` có token (bỏ qua cache), mỗi lần đổi trang là một `COUNT`; đã có lớp nhớ `COUNT` nên chi phí giảm nhưng không về 0.

## 7. Chấm điểm

| Hạng mục | Điểm | Ghi chú |
|---|---|---|
| Giảm request vào Worker | 8.5/10 | File tĩnh về 0, trang chủ 7–8 → 3 API lúc mở; bìa vẫn 1 request/ảnh |
| Giảm rows_read D1 | 8.5/10 | Gỡ nguồn tốn lớn nhất (admin), TTL theo chi phí, BXH Nhiều Chương dùng index (sau migration 014); tìm kiếm còn quét bảng |
| Rate limit | 8.5/10 | Bìa đã cache không tính hạn mức; polling giảm 3 lần |
| Giữ nguyên hành vi | 8.5/10 | Thay đổi độ trễ đã liệt kê ở mục 6 |
| Độ tin cậy đã verify | 7.5/10 | Test và `wrangler dev` xanh; chưa đo trên production, chưa xem trình duyệt thật |
| **Tổng** | **8.3/10** | |

Để đạt điểm tối đa: chạy migration 014 rồi deploy, đo lại trên dashboard sau 24 giờ, và chỉ khi số đo còn cao mới tính tới FTS5 hoặc chép bìa sang R2.

## 8. Đợt 3: quyết định bốn việc còn treo

Nhánh `dev`, chưa push, chưa deploy, không chạm D1/R2 production.

**Cột `chapter_count` — đã làm.** Lo ngại ở đợt 2 hoá ra nhẹ hơn dự kiến. Đường ghi cache Drive (`ENABLE_DRIVE_CACHE_WRITES`) đang tắt trong `wrangler.jsonc`, nên thực tế chỉ còn hai đường. Ở Worker sync, mỗi chunk vốn đã ghi lại dòng `novels` một lần; tôi chuyển lệnh đó thành `INSERT … DO NOTHING` ở đầu batch (bắt buộc vì `chapters` có khoá ngoại tới `novels`) và một lệnh `UPDATE` ở cuối batch ghi cùng lúc `total_chapters`, `updated_at` và `chapter_count`. Truyện đã có vẫn chỉ ghi dòng `novels` một lần mỗi chunk như trước, cộng thêm một mục index mới khi số chương đổi. Dòng `novels` giờ tốn khoảng 1 dòng + 3 mục index, vẫn nằm trong phần `+5` của công thức `4 × số chương + 5`, nên `tools/sync_transport.py` không phải sửa. Đổi lại, mỗi chunk đọc thêm khoảng N dòng index của chính truyện đó (N là số chương) để đếm. `migrate_to_cloudflare.py` chạy thêm một lệnh `UPDATE` sau khi ghi xong chương; lệnh này cũng ghi lại `updated_at`, sửa luôn một lỗ hổng của đợt 2: script ghi `novels` trước rồi mới ghi chương, nên nếu phần ghi chương kéo dài quá 2 phút thì số chương cũ có thể bị nhớ tới 24 giờ.

Worker tự dò cột bằng `SELECT chapter_count FROM novels LIMIT 0` (một lần mỗi isolate, dò lại sau 10 phút nếu chưa có). Chưa có cột thì sync và sắp xếp chạy đúng đường cũ, nên lệch thứ tự migration/deploy không làm hỏng sync. `migrate_to_cloudflare.py` cũng lùi về chỉ ghi `updated_at` nếu thiếu cột. Cột chỉ dùng để sắp xếp; con số hiển thị vẫn lấy từ lớp nhớ `(slug, updated_at)` để khớp trang chi tiết.

Bạn cần chạy (trước `npm run deploy`, vào ngày không có đợt sync lớn vì `CREATE INDEX` ghi khoảng 1 mục/truyện, ~28k lượt):

```
npx wrangler d1 execute hacdao-db --file=migrations/014_novels_chapter_count.sql --remote
```

Workflow `schema_drift_check` sẽ báo lệch cho tới khi migration này lên production. Sửa hoặc xoá dòng `chapters` bằng SQL tay thì chạy thêm `UPDATE novels SET chapter_count = (…), updated_at = datetime('now') WHERE slug = '…'` (công thức trong file migration).

**Cache EPUB ở edge — đã làm, có giới hạn.** Lo ngại bộ nhớ là có thật: `tee()` giữ phần chênh giữa nhánh ghi cache và nhánh trả client trong RAM của isolate (128 MB), tệ nhất bằng cả file nếu client tải chậm. Vì vậy Worker chỉ cache khi Drive báo `Content-Length` không quá 20 MB và không phải trang HTML (Drive trả trang cảnh báo với status 200). Key cache gồm `slug` và `drive_file_id`, nên đổi file trên Drive là có key mới. D1 vẫn được đọc trước (1 dòng) để truyện bị gỡ không bao giờ trả bản đã cache. Cache API là theo từng colo, nên mỗi colo vẫn tải Drive một lần cho mỗi file trong 7 ngày.

**FTS5 — không làm.** D1 hỗ trợ FTS5, nhưng không export được cơ sở dữ liệu có bảng ảo: theo tài liệu Cloudflare phải xoá bảng FTS, export, rồi tạo lại, và có báo cáo export lỗi trên bảng FTS5 làm database tạm không truy cập được. `tools/backup_novels.py` đang export D1 remote, nên FTS5 sẽ làm hỏng sao lưu. Ngoài ra còn ba vấn đề: tokenizer `unicode61` không đổi `đ` thành `d` và coi cả cụm chữ Hán liền nhau là một từ (tìm một phần tên gốc sẽ trượt, `LIKE` hiện tại thì khớp được); trigger đồng bộ phải giới hạn đúng cột, nếu không mỗi lượt tăng `views` sẽ ghi vào FTS; và nạp lần đầu 28k truyện ghi nhiều dòng vào các bảng ẩn của FTS. Tìm kiếm hiện đã cache edge 10 phút và chỉ chạy từ 2 ký tự; nên đo lại sau deploy trước khi quyết định.

**Chép bìa sang R2 công khai — không làm lúc này.** Việc này cần ghi khoảng 28k object vào R2 production, cấu hình domain công khai và đổi `cover_url`, tức là đúng loại thao tác `.agents/AGENTS.md` yêu cầu bạn duyệt. Cầu chì R2 đang là 2.000 lượt ghi/tháng và R2 đã vượt dung lượng gói Free. Sau đợt 1, bìa đã được trả từ edge cache và trình duyệt nhớ 30 ngày, nên phần còn lại chỉ là số request Worker (gói Free 100k/ngày). Nên xem Workers → Requests sau deploy; nếu bìa vẫn chiếm phần lớn thì mới làm, và làm theo lô nhỏ qua GitHub Actions.

**Kiểm chứng đợt 3.** Test Worker 101/101 (4 test mới trong `tests/worker/chapter-count-epub.test.mjs`), pytest 472/472 (3 test mới trong `tests/test_migrate_chapter_count.py`, gồm chạy thật migration 014 trên SQLite và kiểm tra `EXPLAIN QUERY PLAN` dùng `idx_novels_published_chapters` mà không cần sắp tạm). Hai test hành vi mới (ghi cột khi sync, cache EPUB) thất bại khi chạy với `src/index.js` cũ; hai test tương thích (chưa có cột, file EPUB lớn) xanh ở cả hai bản như mong đợi. Chưa kiểm chứng trên D1/Cache API thật của Cloudflare.
