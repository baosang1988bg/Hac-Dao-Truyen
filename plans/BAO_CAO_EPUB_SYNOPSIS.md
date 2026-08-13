# Báo cáo thực thi — Plan 01: EPUB Quick Overview + Chapter Splitter

Nhánh làm việc: `exec/epub-quick-overview-01` (tách từ `main` tại commit `9cd3971`, không đụng `main`).

## Bối cảnh

File `docs/plans/epub-quick-overview-plan-01.md` ghi trạng thái "✅ Đã triển khai",
nhưng đó chỉ phản ánh việc code đã được viết và merge vào `main`, không có nghĩa là
đã được chạy thử thật. Mục tiêu của lần thực thi này là chạy từng bước trong plan,
verify bằng dữ liệu thật (1 truyện có sẵn `book.epub`: `than-dao-de-ton`), và chuẩn
bị mọi thứ an toàn để bạn triển khai lên production ở môi trường có Cloudflare
credentials thật.

## Việc đã làm và đã verify

Cài `ebooklib` — thư viện bắt buộc để `tools/epub_to_chapters.py` chạy được nhưng
trước đó chưa có trong `requirements.txt`. Đã cài, verify import thành công, và bổ
sung vào `requirements.txt` để môi trường thật cài đúng khi chạy `pip install -r
requirements.txt`.

Chạy thử trích synopsis từ `book.epub` của `than-dao-de-ton`: script chạy đúng logic,
phát hiện EPUB này không có mục giới thiệu rõ ràng nên in cảnh báo và không tạo file
— đây là hành vi an toàn (không bịa dữ liệu), không phải lỗi. Muốn thấy nội dung
synopsis thật cần thử với EPUB có trang giới thiệu (đa số 8 truyện còn lại chưa có
`book.epub` trong máy này).

Chạy thử tách chapters từ EPUB ra thư mục riêng (`epub_demo_chapters/`, tránh đè lên
`translated/` đã có 2 file dịch sẵn): 2 chương được tách đúng, tiếng Việt hiển thị
sạch, không lỗi encoding. File demo này đã được commit vào nhánh riêng làm bằng
chứng, không ảnh hưởng thư mục `translated/` thật.

Phát hiện và sửa 1 bug chặn hoàn toàn tính năng: hàm `migrate_synopsis()` trong
`migrate_to_cloudflare.py` dùng cú pháp `f"{'✅' if ok else '❌'}"` viết bằng escape
`✅`/`❌` ngay trong biểu thức f-string — cú pháp này chỉ hợp lệ từ Python
3.12 trở lên, còn CI của repo và hầu hết máy chạy Python 3.10/3.11 sẽ báo
`SyntaxError` ngay khi gọi `--synopsis`. Nói cách khác, tính năng sync synopsis lên
D1/R2 chưa từng chạy được ở dạng đã merge. Đã sửa bằng cách tách icon ra biến riêng,
verify lại bằng dry-run và bằng `py_compile` — chạy sạch.

Verify migration SQL an toàn bằng SQLite mô phỏng schema D1 thật: chạy
`ALTER TABLE novels ADD COLUMN synopsis` thành công, dữ liệu tiếng Việt lưu và đọc
lại đúng, và xác nhận nếu lỡ chạy migration 2 lần sẽ báo lỗi "duplicate column" như
ghi chú trong plan — an toàn để bỏ qua.

Build frontend thật (`npm install && npm run build`, build ra thư mục tạm để né một
giới hạn xoá file của sandbox): 2130 module transform thành công, `SynopsisPanel`
được xác nhận có mặt trong bundle JS cuối cùng.

Verify backend không bị vỡ: `python -m compileall` toàn bộ module Python liên quan
không lỗi; dùng FastAPI `TestClient` gọi thật `GET /api/novels` và
`GET /api/novels/than-dao-de-ton` — cả hai trả về `200`.

## Rollback & cô lập

Toàn bộ thay đổi nằm trên nhánh `exec/epub-quick-overview-01`, `main` không bị đụng
cho tới khi bạn chủ động merge. Mọi file mới (bug fix, `requirements.txt`, demo
chapters) được `git add` theo đường dẫn cụ thể, kiểm tra lại bằng `git diff --cached
--name-only` trước khi commit để không lẫn file khác. Bộ lệnh triển khai thật + lệnh
rollback cho từng bước (D1, R2, deploy) nằm trong file
`docs/plans/epub-quick-overview-plan-01-ban-giao.md`.

## Giới hạn còn lại (nói thẳng, không né tránh)

Sandbox này không có Cloudflare API token nên các bước chạm production thật (D1
migration `--remote`, upload R2, `wrangler deploy`) chưa được chạy thật — cần bạn tự
chạy theo file bàn giao ở trên, trên máy có credentials thật.

`.venv` có sẵn trong repo trỏ tới đường dẫn Python tuyệt đối trên máy Mac của bạn,
không dùng được trong sandbox Linux — mọi lệnh Python ở trên chạy bằng `python3` hệ
thống của sandbox, bạn cần dùng `.venv` thật khi chạy trên máy mình.

Sandbox có một giới hạn quyền xoá file trên thư mục mount (không phải lỗi của
project): 2 thư mục demo dùng để verify (`novels/_demo_verify_slug`,
`novels/_verify_synopsis_demo`) và 2 file tạm do Vite sinh ra
(`frontend/vite.config.js.timestamp-*.mjs`) không xoá được từ sandbox — không được
commit, chỉ nằm rác trên máy bạn, xoá thủ công bằng lệnh ở đầu file bàn giao.

Chỉ verify được với 1/9 truyện (truyện duy nhất có sẵn `book.epub` cục bộ). 8 truyện
còn lại cần bạn copy file EPUB vào `novels/<slug>/` trước khi chạy Bước 3–4 thật.

## Bảng chấm điểm độ hoàn thiện

| Hạng mục | Điểm (/10) | Ghi chú |
|---|---|---|
| Code & kiến trúc | 9 | Đúng cấu trúc plan, đã sửa bug chặn tính năng |
| Verify tự động (compile, build, TestClient) | 9 | Chạy sạch, có bằng chứng cụ thể |
| Verify dữ liệu thật | 6 | Chỉ 1/9 truyện có epub để test; synopsis chưa thấy nội dung thật (epub demo không có mục giới thiệu) |
| An toàn triển khai & rollback | 9 | Nhánh riêng, lệnh rollback rõ cho từng bước |
| Triển khai production thật | 0 | Chưa chạy — cần bạn tự chạy, không có credentials trong sandbox |

**Điểm tổng: 6.6/10.** Phần "làm được trong sandbox" đã hoàn thiện và verify kỹ;
phần còn lại để đạt điểm tối đa là bạn chạy đúng 7 bước trong file bàn giao trên môi
trường thật rồi báo lại để mình verify tiếp (ví dụ xem log `wrangler tail` sau khi
deploy, hoặc kiểm tra `/api/novels/<slug>/synopsis` trả đúng dữ liệu).
