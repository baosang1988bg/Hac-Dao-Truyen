# Triển khai Cloudflare

## Trạng thái trước phát hành

Route admin/health đã sửa và có runtime tests. Bootstrap schema hiện đầy đủ;
upgrade dùng preflight dưới đây. Trạng thái staging/production xem
[nhật ký triển khai](docs/implementation-log.md).

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

`schema.sql` là snapshot đầy đủ cho DB mới. Với DB cũ, runner so sánh schema
thực tế, thêm cột/bảng/index còn thiếu và ghi lịch sử snapshot; không chạy mù
quáng tất cả migration cũ. Schema không tương thích sẽ bị từ chối.

```sh
# Remote chỉ đọc schema nhưng vẫn tạo D1 requests; kiểm tra chi phí trước
python tools/migrate_schema.py --database hacdao-db --remote
# Chỉ áp dụng khi đã kiểm tra kế hoạch và backup đúng database
HACDAO_ALLOW_CLOUD_WRITES=true python tools/migrate_schema.py --database hacdao-db --remote --apply
```

Chọn `--config` riêng cho staging. Bỏ `--remote` để chạy D1 local; dùng
`--sqlite /tmp/hacdao-test.db --apply` để thử trên SQLite rời. Runner không
DROP cột/bảng hoặc xóa dữ liệu. Kiểm tra thủ công schema được thêm cột khác
kiểu/default; không tự coi mọi lỗi duplicate column là thành công.

Các migration 001–004 được giữ làm lịch sử; không áp dụng lại chúng sau
bootstrap snapshot. D1/R2 production chưa được thay đổi trong phiên này.

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

`npm run deploy` dùng `npm ci` trước build rồi deploy. `npm run preview` chạy Wrangler local; không còn mặc định `--remote`. Chỉ lệnh deploy thực sự phát hành; kiểm tra điều kiện chi phí trước khi dùng.

Kiểm tra sau phát hành:

1. Trang chủ và URL sâu của SPA tải được.
2. Danh sách, chi tiết, mục lục và nội dung một chương khớp nhau.
3. Đăng ký/đăng nhập/logout độc giả; bookmark và tiến độ được lưu.
4. Admin login/verify, thao tác glossary và duyệt request đúng quyền.
5. Một truyện thử sync lên có đủ D1, object R2 và mục lục gộp (không cần tạo catalog mới); EPUB/bundle kiểm tra riêng nếu dùng.
6. Request không xác thực bị chặn đúng, không có lỗi schema trong logs.

Rollback code không rollback D1/R2. Ghi lại phiên bản Worker, snapshot schema/data và phạm vi sync trước phát hành; phục hồi dữ liệu là thao tác riêng cần thử trên môi trường tách biệt.

## GitHub Actions

CI chạy pytest cô lập, Worker Miniflare, lint không warning, frontend build và browser smoke. Workflow dịch có lịch `0 17 * * *` nhưng chỉ chạy khi repository variable `ALLOW_CLOUD_WRITES=true`; cloud-to-cloud chỉ chạy thủ công và có cùng gate. Sync/push lỗi làm job thất bại; checkpoint ngân sách được lưu kể cả khi lỗi.

Đọc [kiểm soát chi phí](docs/cost-controls.md) trước khi bật workflow/Worker sync. Chuẩn bị bản build bằng `npx wrangler deploy --dry-run --outdir /tmp/hacdao-release` không phát hành. Checklist đối soát và trạng thái thực tế: [nghiệm thu](docs/release-verification.md).
