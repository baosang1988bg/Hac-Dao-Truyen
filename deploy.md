# Triển khai Cloudflare

## Trạng thái trước phát hành

Đợt review 08/09/2026 chỉ kiểm tra local. Hai blocker cần xử lý: Worker thiếu route auth admin và schema bootstrap thiếu `drive_file_id`. Hướng dẫn này mô tả cấu hình hiện có và điều kiện triển khai, không xác nhận production đã được migrate hay đã chạy đúng.

## Build và bindings

Từ root:

```sh
npm ci
npm ci --prefix frontend
npm run build --prefix frontend
node --check src/index.js
```

`wrangler.jsonc` cấu hình Worker `hac-dao-truyen`, entry `src/index.js`, assets `frontend/dist`, D1 binding `DB` và R2 binding `CHAPTERS`. Nếu triển khai sang account khác, thay database ID, database name và bucket tương ứng; script migrate/restore cũng có tên tài nguyên riêng cần đối chiếu.

## Schema

Không chạy toàn bộ migration một cách mù quáng: `schema.sql` đã có `glossary_count`, còn migration 001 thêm lại cột này. Migration `add_epub_catalog_fields.sql` dùng `ALTER TABLE` không idempotent.

Với database mới, thứ tự cơ sở là `schema.sql` → `002_users.sql` → `003_novel_requests.sql` → `add_epub_catalog_fields.sql`. Bộ file này vẫn thiếu `drive_file_id`; phải bổ sung migration đã review trước khi coi bootstrap hoàn tất. Không dùng migration 001 trên schema mới.

Với database tồn tại, kiểm tra cột/bảng thực tế và snapshot trước khi chọn migration:

```sh
npx wrangler d1 execute hacdao-db --remote --command 'PRAGMA table_info(novels);'
npx wrangler d1 execute hacdao-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Lệnh áp dụng một file đã được chọn:

```sh
npx wrangler d1 execute hacdao-db --remote --file=migrations/003_novel_requests.sql
```

Đây là thao tác ghi production. Chỉ chạy sau khi xác nhận đúng account/database và có phương án phục hồi. Review này chưa chạy lệnh remote nào.

## Secrets

| Biến | Nơi dùng |
|---|---|
| `SYNC_KEY` | Worker xác thực endpoint sync; bắt buộc nếu dùng endpoint này |
| `BACKEND_URL` | Worker truy cập FastAPI để proxy dịch và verify admin |
| `ALLOWED_ORIGINS` | Worker: thay thế allowlist mặc định nếu được khai báo |
| `ADMIN_PASSWORD` | `.env` của Python, không phải secret đăng nhập trực tiếp của Worker |
| `HACDAO_SYNC_KEY` | Máy sync/Actions; cùng giá trị với `SYNC_KEY` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Máy vận hành/CI dùng Wrangler |

Dùng prompt nhập secret, không đặt giá trị thật trong docs:

```sh
npx wrangler secret put SYNC_KEY
npx wrangler secret put BACKEND_URL
```

Các lệnh trên cập nhật cấu hình remote. Cho môi trường Worker local, dùng `.dev.vars` không commit. `.env` Python không tự trở thành Worker secrets.

## Phát hành và xác nhận

Sau khi xử lý blocker và chuẩn bị schema:

```sh
npx wrangler deploy
```

Script `npm run deploy` cũng có sẵn nhưng chạy `npm install` frontend trước build. Quy trình tách `npm ci`/build/deploy phía trên giúp kiểm soát dependency theo lockfile.

Kiểm tra sau phát hành:

1. Trang chủ và URL sâu của SPA tải được.
2. Danh sách, chi tiết, mục lục và nội dung một chương khớp nhau.
3. Đăng ký/đăng nhập/logout độc giả; bookmark và tiến độ được lưu.
4. Admin login/verify, thao tác glossary và duyệt request đúng quyền.
5. Một truyện thử sync lên có đủ D1, object R2 và catalog; EPUB/bundle kiểm tra riêng nếu dùng.
6. Request không xác thực bị chặn đúng, không có lỗi schema trong logs.

Rollback code không rollback D1/R2. Ghi lại phiên bản Worker, snapshot schema/data và phạm vi sync trước phát hành; phục hồi dữ liệu là thao tác riêng cần thử trên môi trường tách biệt.

## GitHub Actions

CI hiện kiểm tra syntax Python, integration FastAPI, build frontend và syntax Worker; chưa chạy lint, toàn bộ pytest hoặc Worker runtime tests. Workflow dịch tự động chạy cron `0 17 * * *` (00:00 giờ Việt Nam), có trigger thủ công. Workflow cloud-to-cloud chỉ chạy thủ công. Một số bước dùng `|| true`, nên trạng thái xanh chưa đủ chứng minh sync/push thành công; xem R05 trong review.
