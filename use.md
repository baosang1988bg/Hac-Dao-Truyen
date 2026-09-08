# Hướng dẫn vận hành

Hoàn tất [cài đặt local](docs/getting-started.md) trước. Chạy CLI từ thư mục gốc, trong venv. Các lệnh dịch gọi provider và có thể phát sinh sử dụng API.

## Quản lý và dịch truyện

```sh
python main.py --help
python main.py list
python main.py new
python main.py import --url '<URL_TRUYEN>' --slug demo
python main.py info --novel demo
python main.py glossary --novel demo
python main.py translate --novel demo --chapters 1
```

Import lấy metadata/mục lục từ nguồn; mức hỗ trợ phụ thuộc site và cơ chế chống bot. Dịch một chương rồi kiểm tra `novels/demo/translated/` trước khi tăng số lượng. CLI tiếp tục từ tiến độ đã lưu; `--url` ghi đè URL bắt đầu, `--force` cho phép dịch lại file tồn tại. Dùng `python main.py retranslate --help` để xem cú pháp chọn chương dịch lại.

Trong web local, admin quản lý truyện, glossary, dịch và logs. Yêu cầu truyện của độc giả được duyệt riêng; trạng thái approved không tự khởi chạy scraper.

## Đồng bộ lên Cloudflare

Chuẩn bị theo [deploy.md](deploy.md), đặc biệt schema và secrets. Chạy kiểm tra trước:

```sh
python migrate_to_cloudflare.py --help
python migrate_to_cloudflare.py --slug demo --dry-run
python migrate_to_cloudflare.py --status
```

Khi đích và dữ liệu đã được xác nhận:

```sh
python migrate_to_cloudflare.py --slug demo --limit 1
```

Đối chiếu metadata, mục lục và nội dung chương trên cloud trước khi sync toàn truyện. `--resume` dùng trạng thái sync; `--smart-sync` và `--from-chapter` hỗ trợ phạm vi đồng bộ. `--skip-r2`/`--skip-d1` chỉ dùng khi biết rõ kho nào đã đúng, vì có thể tạo metadata trỏ tới object thiếu. `--set-synced` đổi state, không phải bằng chứng object đã tồn tại.

`--batch-upload --bundle-size 50` là chế độ opt-in cần thử trên truyện nhỏ. Chưa xác minh phục hồi bundle end-to-end trong đợt review này. Không chạy nhiều sync job cùng slug. `tools/batch_cloud_syncer.py` chưa có `SyncBudget` như cloud-to-cloud syncer.

## Sao lưu và phục hồi

Sao lưu `novels/`, `data/users.db`, các file state sync và cấu hình cần thiết vào nơi riêng; giữ secrets ngoài bản sao chia sẻ. Dừng tiến trình ghi khi sao chép SQLite hoặc dùng SQLite backup API để có snapshot nhất quán. D1 và R2 cần được sao lưu riêng; bản sao mã nguồn không chứa đủ nội dung.

`restore_from_cloudflare.py` đọc D1/R2 remote và ghi local. Chạy trên bản sao/thư mục phục hồi riêng, đã cài dependency và Wrangler, sau khi đọc script; không coi đây là lệnh dry-run. Nó không thay thế backup tài khoản và chưa được kiểm thử phục hồi toàn bộ dữ liệu trong review này.

## Chẩn đoán

| Triệu chứng | Kiểm tra |
|---|---|
| Local `/api` không kết nối | Backend port 4444, venv, proxy Vite |
| Đăng nhập admin trả 503 local | `ADMIN_PASSWORD`, restart backend sau đổi `.env` |
| Admin cloud trả 404 | Lỗi route Worker R01 trong review |
| Danh sách cloud báo thiếu cột | Schema/migration R02 |
| Có mục lục nhưng không đọc được | D1 `r2_key`, object R2, manifest bundle và nguồn Drive |
| Restart bị logout admin | Session in-memory, hiện là giới hạn thiết kế |
| Sync key bị từ chối | `HACDAO_SYNC_KEY` ở script phải khớp `SYNC_KEY` Worker |
| Job Actions xanh nhưng không có dữ liệu mới | Kiểm tra log sync và bước commit/push bị che lỗi bằng `|| true` |

Xem [review tồn đọng](docs/review-2026-09-08.md) trước khi dùng báo cáo lịch sử để quyết định trạng thái hoàn tất.
