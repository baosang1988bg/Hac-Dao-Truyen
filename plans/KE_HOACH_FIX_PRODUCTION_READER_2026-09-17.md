# Kế hoạch sửa lỗi luồng tìm và đọc truyện trên production

Ngày lập: 2026-09-17  
Phạm vi kiểm tra: `https://hacdaotruyen.com`, desktop 1440×784 và mobile 390×844.

## 1. Hiện trạng đã tái hiện

### P1 — Mục lục công khai bị lẫn và trùng chương

- Truyện `lanh-chua-cau-sinh-thien-phu-hop-thanh` trả về 1.669 mục trong khi tổng chương nguồn là 1.513.
- Mục đầu tiên có `chapter_number = 0` và nội dung thuộc truyện khác, nên nút **Đọc từ đầu** mở sai truyện.
- Nhiều số chương có hơn một bản ghi; API hiện chỉ loại trùng theo `filename`, vì vậy không loại được các bản ghi khác tên nhưng cùng số chương.
- Các truy vấn thống kê dùng `COUNT(*)`, làm `chapter_count` bị phóng đại và có thể chọn sai tiêu đề chương mới nhất.

### P2 — Thời gian cập nhật hiển thị `NaN ngày trước`

- `fmtTimeAgo` chỉ xử lý epoch giây.
- Danh sách truyện ưu tiên `updated_at`, nhưng API trả trường này ở dạng chuỗi ngày giờ SQL/ISO.

### P2 — Trạng thái `FULL/Hoàn thành` không khớp dữ liệu

- API trả `status = ongoing`, nhưng một số component tự suy ra hoàn thành khi `chapter_count >= total_chapters`.
- `chapter_count` đang bị dữ liệu trùng làm tăng, nên UI hiển thị `FULL/Hoàn thành` sai.

### P3 — Vùng bấm tiêu đề card trên mobile quá thấp

- Link tiêu đề trong `EpubCard` chỉ có `min-height: 24px`, thấp hơn chuẩn vùng chạm 44px đang dùng ở các nút còn lại.

## 2. Mục tiêu và nguyên tắc sửa

1. Người dùng luôn vào đúng chương đầu tiên hợp lệ khi bấm **Đọc từ đầu**.
2. Một số chương dương chỉ xuất hiện một lần trong mục lục công khai.
3. Mục không có số (lời tác giả/phụ chương hợp lệ) vẫn được giữ, nhưng xếp sau các chương có số để không chiếm vị trí chương đầu.
4. Khi có nhiều bản ghi cùng số chương, ưu tiên bản có dấu hiệu định danh chương rõ ràng (`Chương N`, `Chapter N`, `第N章`, hoặc filename bắt đầu bằng số).
5. `chapter_count` công khai đếm số chương dương khác nhau, không đếm dòng dữ liệu thô.
6. Trạng thái do backend khai báo là nguồn sự thật; chỉ suy luận theo số chương nếu trường `status` bị thiếu.
7. Hàm thời gian chấp nhận epoch giây, epoch mili-giây và chuỗi SQL/ISO; dữ liệu không hợp lệ trả chuỗi rỗng thay vì `NaN`.
8. Không tự động xoá dữ liệu production trong lần sửa này. Lớp phòng vệ phải làm luồng đọc an toàn trước; việc dọn D1 cần audit và backup riêng.

## 3. Thay đổi dự kiến

### Worker/API

- Nâng cấp `sortAndDeduplicateCatalog`:
  - chuẩn hoá số chương;
  - loại trùng filename;
  - gom theo số chương dương và chọn bản canonical theo điểm tin cậy;
  - xếp mục không số sau toàn bộ chương được đánh số.
- Đổi `chapter_count` ở API danh sách và chi tiết sang số `chapter_number > 0` khác nhau.
- Khi lấy `latest_chapter_title`, chỉ xét chương dương và ưu tiên tiêu đề/filename có định dạng chương rõ ràng.
- Giữ nguyên dữ liệu thô trong D1/R2 để tránh xoá nhầm và cho phép điều tra sau.

### Frontend

- Làm `fmtTimeAgo` chịu được cả timestamp và date string.
- Tạo helper trạng thái dùng chung, ưu tiên `novel.status`.
- Áp dụng helper cho `NovelTable`, badge lưới trang chủ và `EpubCard`.
- Chuẩn hoá catalog thêm một lần ở `NovelPage` và `Reader` để frontend vẫn an toàn trong thời gian cache/API cũ chưa hết hạn.
- Nâng vùng bấm link tiêu đề card lên tối thiểu 44px.

## 4. Kiểm thử bắt buộc

- Worker regression test với dữ liệu mô phỏng production:
  - chương 0 lẫn truyện khác;
  - hai filename cùng `chapter_number`;
  - bản canonical được giữ;
  - chương không số nằm cuối;
  - `chapter_count` bằng số chương dương khác nhau;
  - `latest_chapter_title` lấy bản canonical.
- Unit test helper frontend:
  - epoch giây, epoch mili-giây, chuỗi SQL/ISO và giá trị sai;
  - `status = ongoing` không bị biến thành hoàn thành dù count vượt tổng;
  - `status = completed` luôn hoàn thành;
  - fallback theo count chỉ khi thiếu status;
  - catalog lẫn/trùng được chuẩn hoá đúng.
- Chạy `npm run test:worker`, frontend helper tests, `npm run lint --prefix frontend` và `npm run build --prefix frontend`.

## 5. Tiêu chí hoàn tất

- Không còn `NaN ngày trước`.
- Truyện đang `ongoing` không hiển thị `FULL/Hoàn thành` chỉ vì count bất thường.
- **Đọc từ đầu** trỏ đến chương 1 canonical; next/previous không đi qua bản trùng cùng số.
- Mobile title link đạt vùng chạm tối thiểu 44px.
- Toàn bộ regression test, lint và build liên quan đều đạt.

## 6. Rollout sau khi duyệt

1. Deploy Worker/frontend.
2. Purge cache API/CDN cho các endpoint novel/chapter liên quan nếu cần.
3. Chạy lại smoke test desktop/mobile trên production.
4. Lập bản sao D1 rồi audit các bản ghi trùng; chỉ tạo migration dọn dữ liệu khi đã có tiêu chí nhận diện chắc chắn.

