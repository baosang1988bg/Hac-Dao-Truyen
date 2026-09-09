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

## Phase 4 — Frontend và CI

Đã xử lý baseline lint: import/biến thừa, prop contracts, JSX text, hook dependencies; tách helper khỏi file component. Reader giữ callback điều hướng đúng slug; EPUB init không tải lại khi đổi theme và gỡ keyboard listener/hủy fetch khi unmount. CI chạy pytest cô lập, Worker Miniflare, lint không warning, build và browser smoke.

Verify: lint 0 lỗi/0 cảnh báo, build pass; Chrome smoke pass cả API array local và object phân trang cloud (trang chủ, đọc/chuyển chương, login/detail admin, EPUB và unmount). Toàn bộ API/asset ngoài được giả lập, không gọi production. Node baseline CI là 22; Python 3.11.

## Phase 5 — Workflow và kết quả sync

Bỏ nuốt lỗi commit/push, bỏ vòng retry vô hạn khi một truyện thất bại; sync không thành công không công bố announcement. Helper checkpoint phân biệt không có diff với lỗi commit/push. CI writer dùng cùng concurrency group, đúng đường dẫn checkpoint; lưu artifact kể cả khi sync fail. Google Drive dependency chỉ nạp khi cần gọi Drive.

Theo ràng buộc không phát sinh phí: workflow dịch/sync chỉ chạy nếu repository variable `ALLOW_CLOUD_WRITES=true`; chưa bật biến này hay chạy workflow remote. Verify: 3 test pass (không thay đổi, push tới bare repo local, push bị từ chối và sync failure exit 1). Chưa có bằng chứng workflow_dispatch remote.

## Phase 6 — Ngân sách, giới hạn và dependency

Hai syncer dùng chung reservation bền vững trước mỗi attempt, retry hữu hạn, mặc định ngân sách 0. Ghi trực tiếp cần opt-in; Worker sync và Drive cache write tắt mặc định. Workflow lưu ngân sách kể cả khi lỗi. Rate limit phân nhóm, hỗ trợ binding chia sẻ và Map dự phòng có giới hạn kích thước; chưa cấu hình binding production. Health gộp filename D1/catalog để không đếm thiếu chương sync mới.

Khóa dependency runtime/dev/Drive riêng và dùng lock trong CI. Verify: cài offline vào venv Python 3.11 sạch thành công; 42 Python tests pass (1 cảnh báo deprecation), 12 Worker tests pass. Tests bao gồm retry 429, budget đồng thời/restart/lỗi đĩa, cờ ghi mặc định và giới hạn giữa hai isolate bằng stub. `git diff --check` pass. Chưa thể đóng phần xác minh rate limit môi trường thật; xem [phạm vi ngân sách](cost-controls.md).


## Phase 7 — Nghiệm thu local, chưa phát hành

Phase 6 commit `a0fb2ab`, verify lại 42 Python/12 Worker tests pass trước khi bổ sung bài test phase 7. Thêm đối soát snapshot offline (không gọi cloud), sửa restore giữ checkpoint truyện lỗi, sửa admin nhận response phân trang và tải đủ các trang. Browser smoke chờ admin render và kiểm tra hai trang cloud; sửa fixture logs về array theo FastAPI. `npm run preview` dùng local, build dùng `npm ci`.

Verify cuối trước commit: 46 Python tests pass (1 deprecation), 12 Worker tests pass, lint 0 lỗi/cảnh báo, build pass, Chrome smoke local/cloud pass, Worker deploy dry-run pass; liên kết docs local và diff-check pass. Docs đã cập nhật theo code, giữ review cũ làm baseline lịch sử.

Cloudflare: chỉ gọi API quản lý. Sau xác minh OAuth, GET subscriptions trả 403; chưa đọc được gói/billing để bảo đảm điều kiện không phát sinh phí. Đã hỏi người dùng thông tin Dashboard. Chưa deploy/push, đọc/ghi D1/R2 remote, bật workflow hay backfill. Phase 7 production và rate limit môi trường thật còn mở; chi tiết ở [nghiệm thu](release-verification.md).
