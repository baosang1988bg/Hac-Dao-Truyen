# Prompt Codex — Phase 3: Tối ưu mobile cho Trang chi tiết truyện & Tủ truyện

## Bối cảnh

Frontend React (Vite) của web đọc truyện "Hắc Đạo Truyện" tại `frontend/`.
Đa số người dùng truy cập bằng điện thoại. Phase này tập trung vào:

- `frontend/src/pages/NovelPage.jsx` — trang chi tiết 1 truyện: thông tin
  truyện, `SynopsisPanel`, và danh sách chương (ChapterList) có toolbar
  tìm kiếm/sắp xếp.
- `frontend/src/pages/LibraryPage.jsx` — trang "Tủ truyện" (danh sách
  truyện người dùng đang theo dõi/đã lưu).
- `frontend/src/components/SynopsisPanel.jsx`, `EpubCard.jsx`.
- `frontend/src/components/ui/NovelGrid.jsx`, `NovelList.jsx`,
  `NovelTable.jsx` — 3 kiểu hiển thị danh sách truyện dùng chung nhiều nơi.

**Đã đúng, không cần đổi:**
- `NovelTable.jsx` là bảng `<table>` HTML thật, đã tự ẩn hoàn toàn dưới
  768px (class `.hp-only-desktop-table`/`.hp-only-mobile-grid` trong
  `index.css`) và fallback sang `NovelGrid` — pattern này an toàn, giữ
  nguyên.
- `NovelList.jsx` dùng flex row, không cột cứng — mobile-friendly sẵn.
- Toolbar tìm kiếm/sắp xếp trong `NovelPage.jsx` (ChapterList) đã dùng
  `flexWrap: 'wrap'` và `flex: '1 1 170px'` cho input — responsive ổn.
- Danh sách chương dùng `overflow: hidden` + `textOverflow: 'ellipsis'` để
  tránh tràn ngang tên chương dài — đã đúng.

## Việc cần làm (audit + polish)

### 1. `NovelPage.jsx`

- Kiểm tra khu vực đầu trang (ảnh bìa + thông tin truyện: tên, tác giả,
  trạng thái, thể loại, nút "Đọc từ đầu"/"Đọc tiếp"): trên mobile các nút
  hành động chính (đọc, theo dõi, tải EPUB...) phải xếp dễ bấm, không dồn
  chật, mỗi nút ≥44px chiều cao, khoảng cách ≥8px.
- `SynopsisPanel` (mô tả truyện): nếu mô tả dài, đảm bảo có cơ chế
  "xem thêm/thu gọn" (nếu đã có thì giữ nguyên, chỉ kiểm tra nút toggle đủ
  lớn để bấm) thay vì để tràn cả màn hình.
- Danh sách chương (ChapterList): kiểm tra mỗi dòng chương có đủ chiều cao
  để bấm chính xác (khuyến nghị ≥48px/dòng trên mobile vì đây là action
  lặp lại nhiều lần — người dùng bấm chọn chương liên tục), có `active
  state`/hover rõ ràng khi đang đọc dở chương nào.
- Toolbar tìm kiếm/sắp xếp: xác nhận trên màn hình ≤360px các control vẫn
  đủ chỗ, không bị ép quá nhỏ đến mức khó đọc placeholder.

### 2. `LibraryPage.jsx`

- Kiểm tra card truyện trong tủ (`.library-card` hoặc tương đương): tên
  truyện, tiến độ đọc, nút xoá khỏi tủ/đánh dấu — nút xoá đặc biệt cần đủ
  lớn và có khoảng cách an toàn với nội dung khác để tránh bấm nhầm (xoá
  nhầm truyện là lỗi UX nghiêm trọng trên mobile do ngón tay to hơn con
  trỏ chuột).
- Nếu có empty state (chưa lưu truyện nào), đảm bảo hiển thị đẹp, dễ đọc
  trên mobile, có call-to-action rõ ràng (vd nút "Khám phá truyện" dẫn về
  trang chủ).
- Nếu LibraryPage cho phép chuyển đổi giữa các view (grid/list), đảm bảo
  nút chuyển view đủ lớn để bấm.

### 3. `EpubCard.jsx` (nếu được dùng trong các trang này)

- Đảm bảo card responsive tương tự `NovelGrid` card, không có width cố
  định gây tràn ở 320-375px.

## Ràng buộc (non-negotiable)

- KHÔNG đổi `NovelTable.jsx`/pattern ẩn bảng dưới 768px — đã đúng.
- KHÔNG đổi cấu trúc component, không đổi API/data flow, chỉ CSS/layout.
- Với mọi hành động "phá huỷ" (xoá khỏi tủ truyện, huỷ theo dõi...): nếu
  hiện tại chưa có confirm dialog và bạn thấy nút xoá quá dễ bấm nhầm trên
  mobile (nằm sát các nút khác, không có bước xác nhận), hãy tăng khoảng
  cách/kích thước để giảm rủi ro bấm nhầm — nhưng KHÔNG tự ý thêm modal
  xác nhận mới nếu điều đó đổi luồng nghiệp vụ hiện có; chỉ nêu đề xuất
  này trong báo cáo cuối nếu bạn không sửa.
- Không dùng Tailwind, không thêm thư viện mới, giữ theme hiện tại.
- Không có scroll ngang không chủ đích ở bất kỳ viewport nào từ 320px.

## Cách test

1. `cd frontend && npm run dev`, mở 1 truyện bất kỳ → NovelPage; mở
   LibraryPage (cần đăng nhập nếu route yêu cầu — dùng tài khoản test có
   sẵn hoặc mock nếu cần).
2. DevTools responsive mode: 320, 375, 414, 768px.
3. Thử bấm vào từng chương trong danh sách dài (≥30 chương nếu có) để
   kiểm tra độ chính xác chạm ở kích thước dòng mới.
4. Thử luồng thêm/xoá truyện khỏi tủ truyện trên mobile, xác nhận không
   dễ bấm nhầm.
5. Báo cáo cuối: liệt kê file:line đã sửa, và mọi đề xuất chưa thực hiện
   (vd đề xuất thêm confirm dialog cho nút xoá) kèm lý do tại sao chưa
   làm trong phase này.
