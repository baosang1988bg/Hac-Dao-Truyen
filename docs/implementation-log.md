# Nhật ký triển khai các phase

## Chuẩn bị

- Commit docs/kế hoạch nền: `6b4c308`.
- Đã tra Skills Directory và nguồn chính thức Cloudflare: `workers-best-practices` phù hợp tham khảo nhưng không cần cài thêm skill/agent để sửa lỗi hiện tại. Không thêm agent runtime vào sản phẩm.
- Mỗi phase commit riêng sau test; kiểm tra lại test và diff của commit trước khi tiếp tục.

## Phase 0 — Test cô lập

Thêm pytest fixture truyện 2 chương và SQLite tạm, reset session/task giữa test. `HACDAO_DATA_DIR` cho phép tách DB trước import; không thay mặc định production. Test novel manager dùng thư mục tạm. Thêm Node Worker harness và lệnh test thống nhất.

Verify: 27 Python tests pass; 1 Worker test pass. Một cảnh báo deprecation từ Starlette/AnyIO, không phải lỗi test. Không gọi API dịch hay ghi Cloudflare. Các phase tiếp theo chưa hoàn tất.

## Phase 1 — Route admin/health

Dispatch chính xác login/logout/verify, thêm health và 404 cho truyện không tồn tại; bỏ route cover trùng. Proxy dùng Request clone để giữ body/header/method. Verify: 4 Worker tests pass, bao gồm vòng đời phiên, lỗi backend, method/path sai và health dữ liệu/missing. Staging chưa chạy.

## Phase 2 — Schema bootstrap và nâng cấp

Snapshot có đủ bảng user/request và cột EPUB/Drive. Runner mặc định read-only, preflight kiểu/default/PK, thêm schema thiếu, ghi snapshot history và chạy lại được sau lỗi một phần. Verify: 33 Python tests pass (DB trống/cũ/EPUB/manual/current, rerun, partial và incompatible). Chưa áp dụng remote.

## Phase 3 — Sync, catalog và restore

- Worker validate chunk tối đa 25 chương/2 MiB; ghi object theo SHA-256 trước, rồi D1 batch. Retry cùng nội dung idempotent; thay nội dung cũ phải gửi `expected_r2_key`, stale writer nhận 409.
- Điều chỉnh thiết kế: gộp catalog legacy với D1 theo filename (D1 ưu tiên), không suy đoán index đầy đủ từ số dòng và không ghi đè catalog từ chunk. Chưa hỗ trợ prune/xóa qua sync.
- Migrate trực tiếp bỏ DELETE trước sync, ghi R2 trước D1, resume vẫn bổ sung index, không tăng state khi batch lỗi. Bundle lỗi không công bố manifest mới.
- Restore tải vào file tạm, hỗ trợ fallback bundle; lỗi tải không ghi file chương dở.
- Verify: 35 Python tests và 8 Worker tests pass, gồm Miniflare D1/R2, concurrent/retry/conflict, payload validation và fault injection. Khóa Miniflare cùng runtime với Wrangler để test tương thích. Không gọi cloud production.
- Giới hạn: công cụ migrate trực tiếp và upload bundle vẫn phải chạy một writer cho mỗi slug; backfill legacy chưa thực hiện. Kiểm tra production chỉ được thực hiện khi đáp ứng điều kiện không phát sinh phí của người dùng.
