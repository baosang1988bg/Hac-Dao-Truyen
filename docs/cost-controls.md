# Kiểm soát thao tác cloud

Mặc định mới không cho phép sync ghi cloud. Cấu hình này chỉ có hiệu lực sau khi triển khai phiên bản tương ứng; chưa thay đổi dịch vụ đang chạy.

| Cấu hình | Mặc định | Phạm vi |
|---|---|---|
| Worker `ALLOW_SYNC_WRITES` | không có / `false` | Sync API trả 503 sau xác thực |
| Worker `ENABLE_DRIVE_CACHE_WRITES` | không có / `false` | Đọc fallback Drive không tự ghi cache R2/D1 |
| Python `HACDAO_ALLOW_CLOUD_WRITES` | `false` | Chặn migrate trực tiếp và migration schema remote `--apply` |
| Repository variable `ALLOW_CLOUD_WRITES` | không bật | Workflow sync/dịch không chạy |
| `HACDAO_R2_WRITE_BUDGET` | `0` | Ước tính thao tác ghi R2 theo tháng UTC |
| `HACDAO_D1_WRITE_BUDGET` | `0` | Ước tính ghi D1 theo ngày UTC |
| `HACDAO_MAX_OPS_PER_RUN` | `0` | Tổng reservation R2 + D1 trong lần chạy |
| `HACDAO_BUDGET_FILE` | `tools/.cloud_sync_budget.json` | Checkpoint dùng chung trên cùng máy |

Hai CLI sync nhận `--r2-budget`, `--d1-budget`, `--max-ops-per-run`; các giá trị CLI mặc định 0. Workflow truyền biến môi trường vào CLI. `HACDAO_SYNC_HOST` chọn host Worker; key là `HACDAO_SYNC_KEY` ở client và `SYNC_KEY` ở Worker. Không đưa key vào commit.

Mỗi lần gửi (kể cả retry) reserve trước: số chương + synopsis cho R2, `4 × số chương + 5` cho D1. Đây là mức dự phòng trong code, không phải công thức billing. File được ghi nguyên tử; lỗi lưu, state hỏng hoặc lock tồn đọng làm dừng trước request. Không hoàn reservation sau timeout vì server có thể đã ghi. Retry hữu hạn, tôn trọng `Retry-After` và dừng khi hết ngân sách.

Chỉ chạy một scheduler với một checkpoint. Lock thư mục chỉ phối hợp cùng filesystem; không bảo vệ nhiều máy độc lập. CI lưu checkpoint/artifact cả khi sync lỗi. Nếu push/artifact lỗi hoặc runner bị hủy trước khi lưu, phải đối chiếu và phục hồi checkpoint trước lần chạy tiếp; không xóa state để tiếp tục. Không chạy writer ở nhiều branch vì checkpoint theo branch.

Migrate trực tiếp qua Wrangler không dùng ngân sách syncer: cờ opt-in chỉ là chặn mặc định. Ngân sách cũng không bao phủ lưu trữ đang tồn tại, lượt đọc website, D1 scan, dịch AI, Google Drive, GitHub Actions hay dịch vụ khác của account. Tắt Drive cache không tắt mọi endpoint có ghi (tài khoản, bookmark, bình luận…). Vì vậy không thể cam kết hóa đơn 0 chỉ từ các cờ này.

## Rate limit

Worker tách public, login/register và sync có key hợp lệ. Header sync giả không được bỏ qua giới hạn. Khi không có binding, Map giới hạn theo isolate (120/10/30 request mỗi 60 giây), tối đa 5.000 khóa, trả 429 và `Retry-After`. Map không phải giới hạn toàn hệ thống.

Có thể cấu hình binding `PUBLIC_RATE_LIMITER`, `AUTH_RATE_LIMITER`, `SYNC_RATE_LIMITER` sau khi kiểm tra account. Chưa thêm binding production. Lỗi binding auth/sync trả 503; public dùng Map dự phòng. Test nhiều isolate hiện dùng binding giả lập, chưa phải bằng chứng môi trường thật.

Cloudflare Rate Limiting binding có phạm vi theo vị trí Cloudflare và tính nhất quán trễ, không dùng để accounting chính xác. Tham khảo [tài liệu binding chính thức](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Điều kiện xác minh production

Chủ dự án cho phép thao tác trực tiếp với điều kiện không phát sinh phí. Đăng nhập đã được xác minh qua `wrangler whoami`. Ngày 09/09/2026, GET API quản lý danh sách subscription trả 403 sau khi kiểm tra lại OAuth; phiên hiện tại không đọc được gói. Chưa có bằng chứng mức sử dụng và khoản phí $9 trước đây. Không suy đoán đó là phí R2 hay Workers. Chưa deploy, chạy migration remote, đọc kho production để đối soát hay bật workflow. Kiểm thử local không cần những thao tác này.
