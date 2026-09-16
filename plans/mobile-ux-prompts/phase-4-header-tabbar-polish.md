# Prompt Codex — Phase 4: Header, Bottom Tab Bar & rà soát toàn site

## Bối cảnh

Frontend React (Vite) của web đọc truyện "Hắc Đạo Truyện" tại `frontend/`.
Đa số người dùng truy cập bằng điện thoại. Đây là phase cuối: hoàn thiện
điều hướng chung (header + bottom tab bar) và quét lại các trang còn lại
chưa được audit riêng ở phase trước (`AccountPage.jsx`, `LoginPage.jsx`,
`EpubCatalogPage.jsx`, `RequestNovelModal.jsx`, `ChapterComments.jsx`).

Các phase trước (nếu đã chạy) đã xử lý: Reader + ReaderSettingsPanel
(Phase 1), Trang chủ (Phase 2), NovelPage + LibraryPage (Phase 3). Phase
này KHÔNG cần đọc lại các file đó trừ khi có liên quan trực tiếp đến
header/tab-bar.

## Hiện trạng đã đúng, không cần đổi cấu trúc

- `frontend/src/components/BottomTabBar.jsx` + CSS `.bottom-tab-bar`
  (`frontend/src/index.css`): `position: fixed; bottom:0; z-index:110`,
  có `padding-bottom: env(safe-area-inset-bottom, 0px)`, ẩn trên desktop
  qua media query (breakpoint 768/769px, có thể đã đổi ở Phase 0). Mỗi
  `.tab-item` có `min-height: 56px` — đã đạt tap-target.
- Nội dung trang có class `.guest-main.has-tab-bar` với
  `padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px))` để tránh
  bị tab bar che — pattern đúng.
- `SiteHeader.jsx`: không sticky/fixed, cuộn theo trang; trên mobile ẩn
  `.site-header__nav` và `.site-header__right`, chỉ hiện logo — điều hướng
  dồn hết vào BottomTabBar (không có hamburger menu, đây là lựa chọn thiết
  kế hợp lý, KHÔNG cần thêm hamburger menu).

## Việc cần làm

### 1. Audit `.guest-main.has-tab-bar` được áp dụng đúng chỗ

- Grep toàn bộ nơi dùng class `has-tab-bar` (hoặc layout tương đương trong
  `frontend/src/layouts/GuestLayout.jsx`) — xác nhận MỌI route hiển thị
  BottomTabBar đều có nội dung page được bọc trong container có class này
  (hoặc padding-bottom tương đương). Nếu phát hiện route nào hiện
  BottomTabBar nhưng nội dung cuối trang bị che khuất (vd nút "Đọc tiếp"
  ở cuối NovelPage bị tab bar đè lên), thêm padding-bottom phù hợp cho
  đúng container đó (không đổi giá trị `calc(64px + safe-area)` đã đúng ở
  chỗ khác, chỉ áp dụng đúng class có sẵn hoặc thêm class tương tự).

### 2. Kiểm tra route đọc truyện có ẩn đúng BottomTabBar

- Theo comment trong `BottomTabBar.jsx`: "GuestLayout không render component
  này trên route đọc truyện" — xác nhận điều này đúng trong
  `GuestLayout.jsx` (route `/read/...` hoặc tương tự không render
  BottomTabBar, vì Reader đã có NavBar riêng ở Phase 1). Nếu logic ẩn/hiện
  dựa vào so khớp path bằng chuỗi cứng dễ vỡ khi thêm route mới, có thể
  đề xuất cải thiện nhưng KHÔNG bắt buộc sửa nếu rủi ro phá luồng hiện tại
  — nêu trong báo cáo nếu không sửa.

### 3. `AccountPage.jsx`, `LoginPage.jsx`

- Form đăng nhập/tài khoản: input và nút submit đủ lớn (≥44px chiều cao),
  khoảng cách giữa các trường ≥16px trên mobile để dễ phân biệt khi
  focus.
- `LoginPage.jsx` dùng `maxWidth: '400px'` cho form kèm `width: 100%` —
  đã an toàn, không cần đổi, chỉ kiểm tra padding 2 bên đủ (≥16px) để form
  không dính sát mép màn hình ở 320px.
- Input password/email cần `inputMode`/`autoComplete` phù hợp nếu chưa có
  (`autoComplete="email"`, `autoComplete="current-password"`) — cải thiện
  nhỏ, an toàn để thêm.

### 4. `EpubCatalogPage.jsx`, `RequestNovelModal.jsx`

- `RequestNovelModal.jsx` dùng `maxWidth: '440px'` — kiểm tra tương tự
  LoginPage, đảm bảo có padding trong modal đủ (≥16px), nút đóng modal
  (X) đủ lớn (≥44px) và dễ bấm bằng ngón cái (góc trên phải hoặc trái đều
  chấp nhận được, ưu tiên vị trí hiện có nếu đã hợp lý).
- `EpubCatalogPage.jsx`: nếu hiển thị danh sách/lưới EPUB tương tự
  NovelGrid, áp dụng checklist tap-target/spacing giống Phase 2/3.

### 5. `ChapterComments.jsx`

- Form nhập bình luận: textarea đủ lớn để gõ thoải mái trên mobile
  (không giới hạn height quá nhỏ), nút gửi đủ lớn (≥44px), khoảng cách
  với các bình luận khác đủ để không bấm nhầm nút like/reply của người
  khác.

### 6. Quét toàn site lần cuối

- Chạy lại nhanh checklist tổng ở tất cả các trang còn lại chưa được liệt
  kê tên riêng ở trên (nếu có trang nào bị bỏ sót): không scroll ngang ở
  320-768px, tap-target ≥44px cho hành động chính, font-size ≥12px mọi
  nơi, ≥16px cho nội dung chính.

## Ràng buộc (non-negotiable)

- KHÔNG thêm hamburger menu cho SiteHeader — điều hướng mobile đã dồn vào
  BottomTabBar theo chủ đích thiết kế hiện tại.
- KHÔNG đổi `z-index`/`position` của BottomTabBar (đã đúng: fixed, bottom,
  z-index 110).
- Không dùng Tailwind, không thêm thư viện mới, giữ theme dark
  glassmorphism đỏ-vàng đồng.
- Chỉ sửa CSS/layout/thuộc tính HTML (autoComplete, inputMode...), không
  đổi logic nghiệp vụ (auth flow, comment API, request novel flow).

## Cách test

1. `cd frontend && npm run dev`.
2. Test lần lượt: đăng nhập (LoginPage), trang tài khoản (AccountPage), mở
   modal yêu cầu truyện (RequestNovelModal), catalog EPUB
   (EpubCatalogPage), bình luận trong 1 chương (ChapterComments) — ở
   320/375/414/768px.
3. Xác nhận cuộn xuống cuối bất kỳ trang nào có BottomTabBar, nội dung
   cuối cùng (nút, text) không bị tab bar che khuất.
4. Xác nhận vào trang đọc chương, BottomTabBar biến mất đúng như thiết kế.
5. Báo cáo cuối: liệt kê file:line đã sửa theo từng mục 1-6 ở trên, và
   tổng kết ngắn gọn toàn bộ chuỗi 5 phase đã hoàn thành những gì (vì đây
   là phase cuối cùng của kế hoạch mobile UX).
