# Kiểm tra lại bảo mật, quy trình & độ an toàn — HacDaoTruyen
*Sau khi merge 5 bản vá bảo mật cũ với 37 commit upstream (kiến trúc mở rộng cho 28.477 truyện, Google Drive 5TB, sync tốc độ cao lên Cloudflare)*

## Phạm vi lần kiểm tra này

Sau khi pull và merge, dự án đã thay đổi quy mô lớn: chuyển từ lưu chương trong bảng D1 `chapters` sang `catalog.json` trên R2 (để tránh giới hạn dung lượng D1), thêm Google Drive làm kho lưu trữ phụ, thêm endpoint đồng bộ hàng loạt `/api/admin/sync-novel`, thêm GitHub Actions chạy nền 24/7, và bỏ theo dõi git cho thư mục `novels/`. Ba hướng audit chạy song song: Worker + kiến trúc dữ liệu mới, script Python sync/batch mới, và quy trình CI/CD + vệ sinh git. Trước tiên, xác nhận 5 bản vá bảo mật đã làm trước đó vẫn còn nguyên vẹn sau merge — đã kiểm bằng grep trực tiếp trong `src/index.js`: `isAdminRequest` vẫn gate đúng glossary/debug endpoint, `isSafeCoverUrl` vẫn chặn SSRF cho proxyCover, allowlist CORS vẫn còn, `checkRateLimit` vẫn còn cho view/rate. Không có gì bị mất trong lúc merge.

## Phát hiện nghiêm trọng nhất: secret ghi dữ liệu production đã lộ công khai

Endpoint mới `POST /api/admin/sync-novel` (`src/index.js:730`) — dùng để đồng bộ hàng loạt 28.477 truyện lên Cloudflare — xác thực bằng cách so sánh header `x-sync-key` với chuỗi hardcode `'hacdao-secret-2026'` ngay trong mã nguồn. Chuỗi này lặp lại y hệt trong hai script `tools/cloud_to_cloud_syncer.py` và `tools/batch_cloud_syncer.py`. Repository trên GitHub (`baosang1988bg/Hac-Dao-Truyen`) là **repo public**, xác nhận qua API GitHub. Nghĩa là bất kỳ ai cũng có sẵn cả URL production lẫn "chìa khoá" để ghi dữ liệu, không cần đăng nhập, không cần đoán hay brute-force gì cả.

Mức độ nghiêm trọng vượt xa ba lỗ hổng đã vá trước đó (glossary không xác thực, debug endpoint public, SSRF ở proxyCover), vì phạm vi ảnh hưởng là toàn bộ 28.477 truyện chứ không giới hạn ở một field: endpoint này cho phép tạo/ghi đè bất kỳ slug nào, ghi đè `catalog.json`, `synopsis.md`, và nội dung từng chương trên R2, đồng thời không giới hạn kích thước payload hay số chương mỗi lần gọi — một request duy nhất có thể làm hỏng dữ liệu hàng loạt hoặc gây tốn chi phí R2 write ngoài kiểm soát. Điều đáng lưu ý là secret này đã nằm trong lịch sử git từ commit `76e7a6e` và đã được push lên GitHub từ lâu — sửa code mới không xoá được nó khỏi lịch sử; ai đã từng xem hoặc lỡ clone repo vẫn đọc lại được giá trị cũ bằng `git log -p`. Vì vậy đây không phải lỗi "quên thêm auth" mà là "auth giả, chìa khoá đã public" — bắt buộc phải đổi hẳn giá trị secret đang chạy thật trên Cloudflare, không chỉ sửa cách lưu.

Một góc liên quan được kiểm tra kỹ: cột `drive_file_id` (dùng để Worker fetch ngược về Google Drive khi R2 chưa có dữ liệu) hiện KHÔNG nằm trong danh sách cột mà `sync-novel` được phép ghi, nên chưa thể lợi dụng chính lỗ hổng trên để biến endpoint Google-Drive-fallback thành SSRF — nhưng đây là thiết kế mong manh, cần nhớ giữ nguyên giới hạn này nếu sau này mở rộng thêm quyền ghi cho endpoint.

## Các phát hiện khác

Vì bảng `chapters` trong D1 đã bị xoá thủ công trên production (không qua migration commit vào git) để giải quyết giới hạn dung lượng, hầu hết các hàm đọc chương đã có try/catch nên fallback êm sang R2/Drive. Ngoại lệ là route debug `GET /api/debug/chapter/:slug/:num` — vẫn query thẳng bảng `chapters` không bọc try/catch, nên từ khi bảng bị xoá, route này luôn trả lỗi 500 thay vì lỗi rõ ràng. Đây không phải lỗ hổng bảo mật nhưng là một điểm vỡ âm thầm nên dọn. `schema.sql` cũng đã lỗi thời — vẫn định nghĩa bảng `chapters` không còn tồn tại trên production, dễ gây nhầm lẫn nếu ai đó dựng lại môi trường mới từ file này.

Về an toàn dữ liệu, `tools/clean_raw_chapters.py` có tên gọi gây hiểu lầm nghiêm trọng: nó xoá toàn bộ thư mục `translated/` — tức là **bản dịch thành phẩm**, không phải văn bản thô (thư mục raw thật sự của dự án là `text_raw/`). Script xoá vô điều kiện, không dry-run, không xác nhận, không kiểm tra thực tế xem novel đã sync an toàn lên Drive/Cloudflare hay chưa (chỉ dựa vào giả định trong comment), và nuốt lặng lẽ mọi lỗi xảy ra khi xoá file. Nếu chạy nhầm trên một máy có novel chưa kịp đồng bộ, bản dịch sẽ mất vĩnh viễn, chỉ còn cách dịch lại từ đầu.

Về vận hành đa luồng, `cloud_to_cloud_syncer.py` dùng `CHUNK_SIZE=150` và không có độ trễ (sleep) giữa các chunk khi gửi dữ liệu, khác với `batch_cloud_syncer.py` đã tinh chỉnh `CHUNK_SIZE=25` kèm sleep 0.35 giây sau một chuỗi dài các commit vá lỗi rate-limit 503/429 trước đó — nguy cơ tái phát đúng lỗi đã từng vá là hiện hữu. Các file trạng thái đồng bộ mới (`remote_state.json`, `.cloud_sync_state.json`) vẫn ghi đè trực tiếp không atomic, giống vấn đề đã ghi nhận ở lần audit trước với `upload_state.json`/`.sync_state.json` — chưa được xử lý, giờ lan ra thêm các file mới.

Về quy trình CI/CD, workflow `cloud_sync.yml` chạy cron 30 phút/lần nhưng dùng `|| true` ở cả bước chạy sync lẫn bước commit/push — nghĩa là workflow luôn báo "thành công" (dấu tick xanh) dù script bên trong lỗi hoàn toàn, không có cảnh báo nào khi việc đồng bộ âm thầm ngừng hoạt động. Workflow cũng không có khối `concurrency:` để khoá chồng lấn — nếu một lần chạy xử lý 28.477 truyện mất hơn 30 phút (nhiều khả năng), lần cron kế tiếp sẽ khởi động job mới song song, hai job cùng push về `main` gây tranh chấp, và tiến độ của job thua sẽ bị `|| true` nuốt mất trong im lặng (không mất dữ liệu đã đồng bộ, nhưng sổ sách theo dõi tiến độ sai). Ở góc độ vệ sinh git, không có file `.env`/`credentials.json`/`token.json` nào bị lọt vào git — điểm tốt. Nhưng `.gitignore` cho thư mục `novels/` đã bị bật/tắt qua lại nhiều lần trong lịch sử dự án, và quyết định gần nhất (`1395681`) đã gỡ theo dõi 6.324 file/884.619 dòng — nghĩa là ai clone repo mới từ bây giờ sẽ không có bất kỳ dữ liệu truyện nào trong `novels/`, phải phụ thuộc hoàn toàn vào khả năng phục hồi từ R2/Google Drive. CI hiện tại (`ci.yml`) không có bước quét secret hardcode trong code (kiểu gitleaks/trufflehog), nên sự cố `hacdao-secret-2026` lọt qua dễ dàng và có thể tái diễn với secret khác trong tương lai nếu không thêm lưới chặn này.

## Bảng chấm điểm cập nhật

| Hạng mục | Điểm /10 | Ghi chú |
|---|---|---|
| Bảo mật endpoint ghi dữ liệu (Worker) | 3 | `sync-novel` dùng secret hardcode đã public — nghiêm trọng hơn mọi lỗ hổng đã vá trước đó. Các route khác (glossary, debug, comment, bookmark) đều đã xác thực đúng. |
| Bảo mật đọc dữ liệu (Worker) | 8 | Không đổi so với lần trước — proxyCover, CORS, rate-limit view/rate vẫn tốt. |
| An toàn dữ liệu (script vận hành) | 4 | `clean_raw_chapters.py` có thể xoá vĩnh viễn bản dịch thành phẩm không cách phục hồi; state file vẫn ghi không atomic. |
| Quy trình CI/CD | 4 | `|| true` che giấu lỗi, thiếu `concurrency:`, bot push thẳng main không PR, CI không quét secret hardcode. |
| Vệ sinh git & quản lý secret | 3 | Secret đã nằm trong lịch sử git public, chưa rotate; `.gitignore` cho `novels/` thay đổi qua lại gây rủi ro vận hành. |
| Độ tin cậy đã verify | 6 | Audit tĩnh, xác nhận bằng grep/diff/API GitHub thật (repo public), nhưng chưa verify runtime thật trên Cloudflare. |

**Điểm tổng ước lượng: khoảng 4.7/10** — thấp hơn hẳn lần trước (8.5/10 cho riêng phần bảo mật đã vá), vì 37 commit mới mở ra một lỗ hổng nghiêm trọng hơn tất cả những gì đã xử lý trước đó.

## Giới hạn của lần kiểm tra này

Vẫn là audit tĩnh trong sandbox, không có quyền mạng tới Cloudflare/GitHub Settings, nên không xác nhận được liệu GitHub có bật branch protection cho nhánh `main` hay không, và không kiểm thử được endpoint `sync-novel` bằng request thật. Việc xác nhận repo là "public" dựa trên gọi API công khai của GitHub (đáng tin cậy), nhưng mức độ secret đã bị khai thác trong thực tế (nếu có) thì không thể biết được từ đây — cần xem log truy cập/Cloudflare Analytics thật.
