# Báo cáo dựng lại trang chủ & tách Admin board — 04/07/2026

## 1. Quy trình đã theo (đúng yêu cầu của bạn)

Nghiên cứu 2 trang tham khảo (webnovel.vn, truyendich.ai) → 2 agent lập kế hoạch song song (một cho trang chủ guest, một cho admin board) → so sánh và hợp nhất → thực thi → verify từng bước → chấm điểm → báo cáo. Điểm hai bản kế hoạch thống nhất và bổ trợ nhau: agent trang chủ cảnh báo `/api/novels` cũ trả về cả glossary (hàng trăm KB, có truyện 4.245 mục) và số "chương" hiển thị sai (đang lấy `last_chapter_number` của nguồn crawl chứ không phải số chương đã dịch); agent admin board đưa ra sơ đồ tách `NovelDetail.jsx` 2.196 dòng. Cả hai được gộp thành kế hoạch cuối.

## 2. Học được gì từ 2 trang tham khảo

Từ webnovel.vn: header có nav thể loại, khu "Bảng xếp hạng" theo tab, "Mới lên chương" dạng dòng (tên + tác giả + chương mới nhất + thời gian). Từ truyendich.ai: thanh tab dưới cùng cho mobile (Trang chủ / Tủ truyện / Tài khoản), card có badge HOT/FULL/AI, dải số liệu thật. Tôi lấy các pattern phù hợp với quy mô thật của bạn (8 truyện) và **bỏ những thứ sẽ thành giả tạo**: không làm bảng xếp hạng theo lượt xem (không có dữ liệu view), không carousel, không "tốc độ AI realtime". Thay vào đó dùng số liệu thật: tổng chương đã dịch, tổng truyện, tổng thuật ngữ glossary.

## 3. Trang chủ guest mới

Trang chủ (`HomePage`) gồm các khối tự ẩn khi rỗng: "Đọc tiếp" (nếu có lịch sử đọc), truyện nổi bật (truyện nhiều chương nhất), hàng "Đang dịch" cuộn ngang kiểu snap, "Mới lên chương" (5 truyện theo thời điểm dịch gần nhất — lấy từ mtime file thật), "Hoàn thành" (badge FULL), và dải 3 chỉ số thật. Truyện 0 chương bị ẩn khỏi mọi khu để trang không trông trống rỗng. Vì không có ảnh bìa, tôi làm component `NovelCover` sinh bìa gradient tất định từ hash của slug + chữ cái đầu tên truyện mờ phía sau — 8 bìa trông có chủ đích thay vì trống. Khi nào bạn thêm `cover_url` vào `novel.json`, bìa ảnh thật sẽ tự thay thế.

Có thêm trang `NovelPage` công khai (thông tin + danh sách chương có tìm kiếm, sắp xếp, phân trang "Tải thêm 100" vì có truyện 1.835 chương), trang `LibraryPage` (Tủ truyện = lịch sử đọc từ localStorage), điều hướng gồm header desktop và **thanh tab dưới cho mobile** (Trang chủ / Tủ truyện / Tài khoản), tự ẩn khi đang đọc truyện.

## 4. Sửa vị trí nút mà bạn phàn nàn

Nguyên nhân cụ thể: trong Reader cũ có **hai nút tròn nổi 58px ở góc phải dưới** (cuộn-lên + cài đặt) đè đúng lên vùng chạm phải để lật chương, và nút cài đặt bị lặp (đã có sẵn trong cả hai thanh điều hướng). Đã xử lý: xóa nút cài đặt nổi (giữ trong nav), dời nút cuộn-lên sang **góc trái dưới** kèm safe-area, thu về 44px, giảm độ đậm — giờ vùng chạm phải để lật chương không còn bị nút nào che.

## 5. Admin board riêng biệt

Toàn bộ khu quản trị chuyển sang `/admin/*`, **không dùng chung layout với guest**: có `AdminLayout` với sidebar trái cố định trên desktop (Tổng quan / Truyện / Nhật ký / Xem trang guest) và drawer trượt trên mobile (không phải thanh tab dưới của guest), topbar có nút đăng xuất và badge ADMIN. Có cổng bảo vệ `RequireAdmin` gọi `/api/auth/verify` khi vào. File `NovelDetail.jsx` 2.196 dòng được tách thành: hook `useTranslationStatus` (polling dịch), các component `TranslationPanel`, `GlossaryEditor`, `HealthPanel`, `ToolsPanel`, `CatalogBrowser`, `ChapterListAdmin`, `ui.jsx` dùng chung — dễ trace, dễ sửa. Ba trang admin mới: `AdminDashboard` (3 chỉ số thật + khu "Đang dịch" cập nhật trực tiếp + phiên gần nhất từ `/api/logs`), `AdminNovels`, `AdminNovelDetail`. Guest giờ **không gọi bất kỳ endpoint admin nào** (đã verify).

Backend thêm tối thiểu: `/api/novels` được làm gọn (whitelist field + số liệu thật `chapter_count`, `last_translated_at`, `latest_chapter_title`, `glossary_count`), `/api/novels/{slug}` trả glossary chỉ khi có token admin, và endpoint mới `/api/translate/active` cho dashboard poll một lần thay vì N lần.

## 6. Verify — đã kiểm chứng từng bước

Build production sạch (1.989 module, 0 lỗi). Bộ test tích hợp backend **13/13 pass**: luồng guest (danh sách gọn không lộ glossary/nguồn crawl, đọc được nội dung chương), bảo mật còn nguyên (translate không token → 401, path traversal → chặn, guest không thấy glossary còn admin thì có), luồng admin (login → token → verify → dashboard logs). Kiểm tra cấu trúc: route map đúng, file cũ đã xóa và không còn import mồ côi, FAB đã dời, HomePage không có số liệu giả, `userRole==='admin'` chỉ xuất hiện ở nơi hợp lệ.

Một giới hạn cần nói thẳng: **tôi không chụp được screenshot bằng trình duyệt thật** vì môi trường sandbox thiếu thư viện hệ thống cho Chromium (`libXdamage.so.1`) và không có quyền root để cài. Tôi đã thử render SPA bằng jsdom nhưng bundle 475KB eval quá chậm. Do đó phần "nhìn tận mắt" bạn nên tự mở `npm run dev` trên máy để duyệt qua các trang — đây là khoảng trống verify duy nhất tôi không tự làm được.

## 7. Chấm điểm độ hoàn thiện

| Hạng mục | Điểm | Ghi chú |
|---|---|---|
| Kiến trúc & tách guest/admin | 9.5/10 | Board admin tách hẳn, code module hóa rõ ràng |
| Trang chủ (guest) | 9/10 | Đủ khu, bìa sinh tự động, số liệu thật; thiếu ảnh bìa thật (cần bạn thêm) |
| UX/UI mobile | 9/10 | Tab bar, safe-area, FAB đã sửa, touch target ≥44px |
| Bảo mật | 9.5/10 | Auth server-side, không lộ glossary/nguồn; nên thêm rate-limit login |
| Hiệu năng | 8.5/10 | Payload nhẹ đi ~100 lần; JS bundle 142KB gzip còn gộp 1 file, có thể code-split |
| Độ tin cậy đã verify | 8/10 | Build + 13/13 integration pass; **trừ điểm vì chưa có screenshot trình duyệt thật** |
| **Tổng** | **8.9/10** | Sẵn sàng chạy; còn vài việc nhỏ để đạt 10 |

## 8. Việc còn lại để đạt 10

Bạn tự mở `npm run dev` duyệt mắt thường trên điện thoại + desktop (verify tôi chưa làm được). Thêm `cover_url` cho các truyện vào `novel.json` để có ảnh bìa thật. Cân nhắc: rate-limit endpoint login, code-split bundle React (lazy-load khu admin để guest tải nhẹ hơn), và làm sạch tiêu đề vài truyện demo (`demo-51265`, `truyen-69shuba`). Nếu triển khai lên Cloudflare Worker (`src/index.js`), nhớ đồng bộ logic auth mới sang Worker vì phần auth đang nằm ở backend FastAPI.
