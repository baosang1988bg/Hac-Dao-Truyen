# Bàn giao nâng cấp bảo mật — HacDaoTruyen
*Ngày thực hiện: 08/08/2026 — dựa trên `BAO_CAO_KIEM_TRA_2026-08-08.md`*

## Đã làm gì

Toàn bộ việc ưu tiên cao nhất trong báo cáo kiểm tra trước đó đã được vá và commit thành 5 commit riêng biệt trên nhánh `main`, mỗi commit chỉ chạm một nhóm thay đổi để dễ xác minh và dễ revert nếu cần:

`937ef7e` gate hai endpoint ghi/lộ dữ liệu bằng xác thực admin — `POST /api/novels/:slug/glossary` trước đây ai cũng ghi đè được, và `GET /api/debug/chapter/:slug/:num` trước đây công khai lộ tên file nội bộ. Cả hai giờ dùng lại đúng cơ chế `isAdminRequest` đã có sẵn trong file, không phát minh cơ chế mới.

`242f846` chặn SSRF cho `proxyCover` — thêm hàm `isSafeCoverUrl` chỉ cho phép scheme http/https và chặn IP loopback/private/link-local (bao gồm địa chỉ metadata cloud 169.254.169.254), cộng thêm kiểm tra Content-Type để không dùng endpoint này làm proxy đọc dữ liệu text tùy ý. Đã cân nhắc để không chặn nhầm ảnh bìa hợp lệ đang chạy tốt.

`841e122` giới hạn CORS từ `'*'` về danh sách domain thật (`hacdaotruyen.com`, `www.hacdaotruyen.com`, `nguyenbaosang1998.workers.dev`), có thể đổi qua secret `ALLOWED_ORIGINS` mà không cần sửa code. Vì frontend gọi API bằng đường dẫn tương đối nên đây là same-origin, thay đổi này không ảnh hưởng luồng dùng chính của site.

`53296b4` thêm rate-limit nhẹ cho hai route tăng lượt xem và đánh giá sao, theo IP, lưu trong bộ nhớ tạm của Worker — không cần thêm KV hay D1 mới nên không phát sinh bước hạ tầng khi deploy.

`7c5e69a` vá hai script đồng bộ Cloudflare phía Python: `migrate_to_cloudflare.py` sửa một câu SQL ghép slug không escape; `restore_from_cloudflare.py` bỏ hẳn `shell=True`/`cmd /c` (nguồn command injection nếu dữ liệu D1 bị thao túng) và thêm `validate_slug`/`safe_join` trước khi ghi file từ dữ liệu tải về, tránh path traversal.

## Cách đã verify

Mỗi commit đều chạy `node --check src/index.js` (cú pháp Worker) hoặc `python3 -m py_compile` (cú pháp Python) trước khi commit. Với các hàm logic mới (`isSafeCoverUrl`, `checkRateLimit`, `q()`, `validate_slug`/`safe_join` trong ngữ cảnh mới), đã viết test độc lập bằng `node -e` và `python3 -c` để xác nhận: chặn đúng các input độc hại (IP nội bộ, traversal, SQL injection) và không chặn nhầm input hợp lệ. Sau khi xong toàn bộ, chạy lại `tests/test_integration.py` — bộ 12 test contract của FastAPI backend — kết quả 12/12 PASS, xác nhận các thay đổi không đụng vào phần backend đang chạy ổn định.

**Giới hạn của việc verify này**: đây đều là kiểm thử tĩnh/logic trong sandbox, chưa chạy được `wrangler dev` thật (binary `workerd` trong `node_modules` build cho macOS, sandbox chạy Linux nên không thực thi được) và không có quyền mạng tới Cloudflare API từ sandbox này. Nghĩa là **chưa có lần chạy thử thật nào chống lại D1/R2 sản xuất** — bước kiểm tra thật sự phải làm sau khi bạn deploy, xem checklist bên dưới.

## Bạn cần tự deploy — checklist từng bước

Sandbox này không có thông tin đăng nhập Cloudflare và mạng ra ngoài bị chặn, nên tôi chỉ commit được code, không thể chạy `wrangler deploy` thay bạn. Trên máy của bạn (nơi `wrangler` đã đăng nhập sẵn):

1. `git pull` để lấy 5 commit mới.
2. `cd frontend && npm run build` (không bắt buộc vì lần này không đổi frontend, nhưng nên chạy để chắc chắn `frontend/dist` khớp với commit mới nhất trước khi deploy).
3. `wrangler deploy` từ thư mục gốc.
4. Kiểm tra ngay sau khi deploy, theo đúng thứ tự để phát hiện sớm nếu có gì gãy:
   - Mở trang chủ ở chế độ ẩn danh, xác nhận trang tải bình thường, không có lỗi CORS trong Console (F12).
   - Mở một trang truyện, xác nhận bìa ảnh vẫn hiển thị bình thường (kiểm tra `proxyCover` không chặn nhầm).
   - Đọc một chương, xác nhận lượt xem của truyện vẫn tăng như trước (view vẫn +1 ở lần đọc đầu).
   - Bấm đánh giá sao, xác nhận vẫn lưu được; bấm nhanh lần 2 trong vòng 5 giây để xác nhận nhận được thông báo "thử lại sau" thay vì lỗi.
   - Đăng nhập admin, mở một truyện, thử sửa và lưu glossary — phải thành công như trước (vì admin đã có Bearer token).
   - Mở tab ẩn danh khác (chưa đăng nhập), thử gọi `curl -X POST https://hacdaotruyen.com/api/novels/<slug>/glossary -d '{"glossary":{}}'` — phải trả về 401 thay vì ghi thành công.
   - Gọi `curl https://hacdaotruyen.com/api/debug/chapter/<slug>/1` không kèm token — phải trả về 401 thay vì lộ dữ liệu.
5. Nếu site đang có domain/ứng dụng khác gọi thẳng vào API mà không nằm trong danh sách `hacdaotruyen.com`, `www.hacdaotruyen.com`, `nguyenbaosang1998.workers.dev`, các cuộc gọi đó sẽ bị chặn CORS — nếu có trường hợp này, chạy `wrangler secret put ALLOWED_ORIGINS` và nhập danh sách domain cách nhau bởi dấu phẩy.
6. Nếu bất kỳ bước nào ở trên gãy, có thể revert đúng commit gây lỗi (`git revert <hash>`) rồi deploy lại — mỗi commit độc lập nên không cần revert cả 5.

Hai script Python (`migrate_to_cloudflare.py`, `restore_from_cloudflare.py`) không cần bước deploy riêng — lần chạy tiếp theo trên máy bạn sẽ tự dùng bản đã vá.

## Việc chưa làm trong đợt này

Theo đúng phạm vi "nâng cấp bảo mật" bạn yêu cầu, tôi chưa đụng tới các mục thuộc hiệu năng/cache trong báo cáo gốc (phân trang SQL thật cho danh sách truyện/chương, `Cache-Control` cho API JSON, atomic write cho các file trạng thái JSON) vì đó là vấn đề độ tin cậy/hiệu năng chứ không phải lỗ hổng bảo mật trực tiếp. Nếu muốn, tôi có thể làm tiếp thành một đợt riêng. Về SSRF của `proxyCover`, đã nói ở trên: chặn được IP literal nội bộ nhưng không giải quyết được DNS rebinding (miền hợp lệ nhưng DNS trỏ về IP nội bộ tại thời điểm fetch) — đây là giới hạn của Workers runtime, chấp nhận như rủi ro tồn dư.

## Bảng chấm điểm cập nhật (so với 5.9/10 ban đầu)

| Hạng mục | Trước | Sau | Ghi chú |
|---|---|---|---|
| Bảo mật Worker sản xuất | 4 | 8 | Glossary/debug đã gate admin, CORS đã giới hạn, proxyCover đã chặn SSRF cơ bản, view/rate đã rate-limit. Còn giới hạn DNS rebinding đã biết. |
| Bảo mật backend Python + script Cloudflare | 7 | 9 | SQL escape nhất quán, bỏ shell=True, thêm safe_join/validate_slug khi restore. |
| Hiệu năng & cache | 6 / 5 | 6 / 5 | Chưa đụng tới trong đợt này — nằm ngoài phạm vi "bảo mật". |
| Độ tin cậy đã verify | 5 | 6 | Đã test logic độc lập + 12/12 integration test PASS, nhưng vẫn chưa test được trên môi trường Cloudflare thật (do giới hạn sandbox). |

**Điểm bảo mật tổng ước lượng sau đợt vá: khoảng 8.5/10** cho hai hạng mục bảo mật, với điều kiện bạn hoàn tất checklist deploy + kiểm tra thật ở trên.
