# Báo cáo Giai đoạn 3 — Cộng đồng nhỏ & chất lượng dịch (16/07/2026)

Hoàn thành 5/6 hạng mục (3.1, 3.2, 3.4, 3.5, 3.6), thực thi bằng bốn luồng song song với hợp đồng API thống nhất viết trước. Hạng mục 3.3 (web push/email cho độc giả) chủ động để lại — cần VAPID key và quyết định về hạ tầng gửi mail, nên làm sau khi hệ thống user chạy thật trên production.

## Kiến trúc đã chọn

Hệ thống tài khoản được triển khai **song song hai nơi cùng một hợp đồng API**: FastAPI dùng SQLite cục bộ (`data/users.db`, qua `user_store.py`) cho dev và test; Worker Cloudflare dùng D1 (`migrations/002_users.sql`) cho production. Mấu chốt để hai bên thay thế được nhau là format băm mật khẩu thống nhất `pbkdf2$100000$<salt>$<hash>` — đã verify chéo: hash tạo bởi Python được code JS của Worker xác thực đúng, và ngược lại. Token người dùng có prefix `u_` để không bao giờ đụng độ token admin (admin vẫn đi qua backend Python như cũ). Đây là bước hiện thực hóa quyết định 4.1 của roadmap: D1 là nguồn sự thật cho dữ liệu người dùng.

## Tính năng cho độc giả

Trang `/account` gộp đăng nhập/đăng ký (validate mật khẩu ≥8 ký tự, thông báo lỗi tiếng Việt), khi đã đăng nhập hiển thị danh sách "Đang theo dõi" với badge "N chương mới" (so `chapter_count` với tiến độ đọc đã sync) và nút đọc tiếp đúng chương đang dở. Nút "♥ Theo dõi" nằm trên trang truyện. Reader tự đồng bộ tiến độ mỗi lần chuyển chương (fire-and-forget, không làm chậm việc đọc) — đọc trên máy tính, mở điện thoại sẽ thấy đúng vị trí sau khi đăng nhập. Bình luận đặt cuối trang đọc theo từng chương: khách xem được, đăng nhập mới viết được, rate limit 20 giây (429 kèm thông báo thân thiện), xóa bởi admin hoặc chính chủ. Header và bottom-tab mobile có lối vào "Tôi"; lối vào admin cũ đổi nhãn để không nhầm.

## Công cụ chất lượng cho admin

`tools/qa_check.py` chấm điểm 0–100 từng chương đã dịch bằng bốn tín hiệu: ký tự Hán còn sót, marker dịch lỗi, tỷ lệ độ dài dịch/gốc, tỷ lệ số đoạn văn — xuất `qa_report.json` per truyện và endpoint admin `GET /api/novels/{slug}/qa` (hỗ trợ `?refresh=1`). Chạy thật trên truyện Bè Gỗ 132 chương: 130 xanh, 2 vàng, 0 đỏ — hai chương vàng đều nghi thiếu nửa sau do nguồn phân trang (1/2), đúng loại lỗi từng gặp thủ công trước đây, chứng tỏ tín hiệu `para_ratio` bắt đúng bệnh. Glossary editor được nâng cấp cho glossary nghìn-entry: tìm kiếm hai chiều Trung/Việt có debounce, phân trang 100/trang, và panel "Kiểm tra mâu thuẫn" phát hiện key lồng nhau có value khác nhau cùng value bị dùng cho quá nhiều key.

## Verify

Toàn bộ qua bậc thang: py_compile, `node --check`, vite build (1992 modules), và bộ integration test mở rộng từ 7 lên **12 test — 12/12 PASS** (thêm: full flow đăng ký→đăng nhập→bookmark→progress, flow bình luận kèm rate limit 429 và phân quyền xóa 401/403/404, validation 400/409, logout hủy token). SQL của Worker được kiểm bằng cách extract 28 câu prepare và chạy trên SQLite in-memory cùng schema D1 — 28/28 OK. Endpoint QA đã test cả 401 lẫn đường admin thật (login bằng ADMIN_PASSWORD trong .env → 200).

## Việc bạn cần làm trên máy để GĐ3 sống trên production

```bash
npx wrangler d1 execute hacdao-db --file=migrations/001_add_glossary_count.sql --remote
npx wrangler d1 execute hacdao-db --file=migrations/002_users.sql --remote
npx wrangler deploy
python3 migrate_to_cloudflare.py
python3 tools/check_drift.py   # kỳ vọng ✅ không lệch
```

Lưu ý: tính năng user trên production chạy hoàn toàn trên D1, không cần backend Python bật; riêng nút xóa bình luận bằng quyền admin trên production cần `BACKEND_URL` được set (Worker hỏi backend xác thực token admin).

## Chấm điểm sau Giai đoạn 3

| Hạng mục | Sau GĐ2 | Sau GĐ3 | Ghi chú |
|---|---|---|---|
| UX guest + Reader | 8.5 | 9 | Account/follow/comments; trừ vì chưa duyệt mắt thường máy thật |
| Quản trị & chất lượng dịch | 7 | 8.5 | QA tự động + glossary editor lớn; còn thiếu nút re-translate 1 chương từ UI |
| Bảo mật | 8 | 8 | User auth chuẩn PBKDF2, rate limit; điểm giữ nguyên chờ kiểm production |
| Độ tin cậy đã verify | 8 | 8.5 | 12 integration test + cross-compat hash + 28 câu SQL Worker |

Còn lại của GĐ3: hạng mục 3.3 (web push VAPID hoặc email digest). Kế tiếp theo roadmap: Giai đoạn 4 (nguồn sự thật dữ liệu, full-text search, SEO share, monitoring) — nên bắt đầu sau khi bạn deploy và cộng đồng dùng thử tính năng user vài tuần.
