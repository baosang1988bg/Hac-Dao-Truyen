# Kế hoạch nâng cấp bảo mật & quy trình — HacDaoTruyen
*Dựa trên `BAO_CAO_KIEM_TRA_LAI_SAU_MERGE_2026-08-08.md` — ưu tiên theo mức độ nghiêm trọng, đảm bảo không làm gián đoạn pipeline đang đồng bộ 28.477 truyện*

## Nguyên tắc khi thực hiện

Pipeline sync hiện chạy 24/7 qua GitHub Actions và có thể đang xử lý dữ liệu bất cứ lúc nào, nên mọi thay đổi đụng tới `sync-novel`/secret phải làm theo đúng trình tự: cập nhật Worker trước (chấp nhận cả secret cũ và mới trong một khoảng thời gian ngắn nếu cần), rồi mới cập nhật script Python, để tránh khoảng trống mà script cũ gọi vào Worker mới và bị từ chối giữa chừng một batch. Mỗi giai đoạn dưới đây nên là một commit riêng, verify xong mới chuyển giai đoạn tiếp theo, đúng kỷ luật đã áp dụng ở đợt vá trước.

## Giai đoạn 0 — Khẩn cấp, nên làm trong ngày

Đây là hành động duy nhất mình đề xuất làm ngay dù bạn chỉ yêu cầu lên kế hoạch, vì mức độ rủi ro (repo public + secret ghi dữ liệu đã lộ) không nên chờ đến khi lên lịch làm việc bình thường.

Đổi giá trị secret `hacdao-secret-2026` đang chạy thật trên Cloudflare bằng `wrangler secret put SYNC_KEY` với một chuỗi ngẫu nhiên mới (ví dụ tạo bằng `openssl rand -hex 32`), đồng thời sửa `src/index.js` đọc từ `env.SYNC_KEY` thay vì so sánh với chuỗi hardcode, dùng hàm `timingSafeEqualStr` đã có sẵn trong file thay vì `!==` thường. Việc đổi giá trị thật là bắt buộc — sửa code không đủ vì giá trị cũ đã nằm vĩnh viễn trong lịch sử git public. Ngay sau khi đổi, cập nhật secret mới vào biến môi trường trên máy chạy `cloud_to_cloud_syncer.py`/`batch_cloud_syncer.py` (đọc qua `os.environ["HACDAO_SYNC_KEY"]` thay vì hardcode) và vào GitHub Secrets cho workflow `cloud_sync.yml`, deploy Worker trước, cập nhật 2 script sau, để tránh cửa sổ gián đoạn dài.

## Giai đoạn 1 — Siết chặt endpoint sync-novel

Sau khi secret đã an toàn, bổ sung các lớp phòng thủ còn thiếu cho chính endpoint này để nó không còn là điểm yếu nhất của hệ thống: thêm `SLUG_RE.test(slug)` giống các route khác trước khi ghi D1/R2, giới hạn số lượng `chapters` mỗi request (ví dụ tối đa 200) và giới hạn độ dài `content` mỗi chương, thêm rate-limit nhẹ theo IP hoặc theo secret dùng lại `checkRateLimit` đã có sẵn trong file để một lần gọi lỗi/độc hại không thể xả liên tục. Việc này không ảnh hưởng script sync hợp lệ vì batch hiện tại của các script đã nằm trong ngưỡng hợp lý.

## Giai đoạn 2 — An toàn dữ liệu vận hành

Sửa `tools/clean_raw_chapters.py` theo ba lớp: đổi tên hàm/biến cho đúng bản chất (đây là xoá bản dịch thành phẩm, không phải "raw"), thêm bước xác minh thật — đọc `upload_state.json`/`remote_state.json` để chỉ xoá những slug đã xác nhận đồng bộ thành công, và thêm cờ `--dry-run` mặc định bật (phải gõ thêm `--yes-i-am-sure` mới xoá thật) cùng log rõ ràng khi gặp lỗi thay vì nuốt lặng lẽ. Song song, gộp tất cả các chỗ ghi file trạng thái JSON (`upload_state.json`, `.sync_state.json`, `remote_state.json`, `.cloud_sync_state.json`) về dùng chung một hàm ghi atomic (ghi ra file tạm cùng thư mục rồi `os.replace`), tránh hỏng file nếu tiến trình bị ngắt giữa chừng — sửa một chỗ, áp dụng lại cho tất cả các script đang tự ghi riêng lẻ.

## Giai đoạn 3 — Quy trình CI/CD

Trong `cloud_sync.yml`, bỏ `|| true` ở bước chạy sync và bước push, thay bằng xử lý lỗi tường minh: nếu script sync thất bại, để job đỏ (fail) và cân nhắc thêm bước gửi thông báo (ví dụ ghi vào một issue GitHub tự động, hoặc đơn giản là để trạng thái đỏ hiển thị trên tab Actions) thay vì im lặng; thêm khối `concurrency: group: cloud-sync, cancel-in-progress: false` để job cron mới không chạy song song đè lên job cũ chưa xong. Trong `ci.yml`, thêm một bước quét secret hardcode bằng công cụ như gitleaks (chạy nhanh, miễn phí cho public repo) để lần sau nếu ai vô tình hardcode một secret khác, CI sẽ chặn trước khi merge. Việc bật branch protection cho nhánh `main` (yêu cầu PR + status check trước khi merge) cần làm thủ công trong GitHub Settings vì không thể cấu hình qua code — khuyến nghị bật ít nhất yêu cầu CI phải xanh trước khi merge, có thể giữ ngoại lệ cho bot `cloud_sync.yml` nếu cần tự động hoàn toàn.

## Giai đoạn 4 — Dọn dẹp & tài liệu hoá

Cập nhật `schema.sql` để phản ánh đúng hiện trạng production (bảng `chapters` đã bỏ, dữ liệu chương giờ nằm trong `catalog.json` trên R2), tránh gây nhầm lẫn khi có ai dựng lại môi trường mới từ file này. Bọc try/catch quanh câu query bảng `chapters` trong route debug (`/api/debug/chapter/:slug/:num`) để trả lỗi rõ ràng ("bảng đã ngừng dùng") thay vì 500 khó hiểu — hoặc đơn giản là xoá hẳn route này nếu không còn cần debug theo cách cũ. Ghi chú rõ trong `README.md` rằng thư mục `novels/` không còn nằm trong git kể từ commit `1395681`, và dữ liệu thật nằm trên Cloudflare R2/D1 + Google Drive, để người sau (kể cả bạn sau vài tháng) không hoang mang khi clone repo mới thấy `novels/` trống.

## Giai đoạn 5 — Tối ưu, không khẩn cấp

Thêm sleep giữa các chunk trong `cloud_to_cloud_syncer.py` (theo đúng thông số `batch_cloud_syncer.py` đã rút ra được từ chuỗi commit vá lỗi rate-limit trước đó: chunk nhỏ hơn + sleep ~0.3-0.35 giây) để tránh tái phát lỗi 429/503 đã từng gặp nhiều lần. Các mục còn tồn đọng từ báo cáo bảo mật đầu tiên (phân trang thật ở tầng SQL cho danh sách truyện/chương, `Cache-Control` cho API JSON) vẫn còn nguyên giá trị và có thể làm ở giai đoạn này khi đã ổn định các vấn đề khẩn cấp hơn.

## Tổng hợp thứ tự ưu tiên

| Giai đoạn | Mức độ | Rủi ro nếu trì hoãn | Rủi ro khi thực hiện |
|---|---|---|---|
| 0 — Rotate secret sync-novel | Khẩn cấp | Bất kỳ ai cũng ghi/phá được dữ liệu 28.477 truyện ngay bây giờ | Thấp nếu deploy Worker trước, cập nhật script sau |
| 1 — Validate + giới hạn sync-novel | Cao | Vẫn có thể bị lạm dụng dù đổi secret (nếu secret mới lại lộ theo cách khác) | Thấp, không đổi hành vi với dữ liệu hợp lệ |
| 2 — An toàn dữ liệu (clean script, atomic write) | Cao | Có thể mất vĩnh viễn bản dịch chưa kịp sync khi chạy nhầm script dọn dẹp | Thấp, chỉ thêm bước xác minh/an toàn |
| 3 — CI/CD (bỏ \|\| true, concurrency, secret-scan) | Trung bình | Sync có thể âm thầm hỏng nhiều ngày không ai biết | Thấp |
| 4 — Dọn dẹp tài liệu | Thấp | Gây nhầm lẫn khi vận hành/onboarding sau này | Không |
| 5 — Tối ưu hiệu năng/throughput | Thấp | Tái phát rate-limit đã từng vá, tốn thời gian chờ | Thấp |

Nếu muốn, mình có thể bắt đầu thực thi ngay từ Giai đoạn 0 — đây là phần duy nhất mình cho là không nên chờ.
