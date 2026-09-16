# Prompt Codex — Phase 1: Tối ưu mobile cho trang Đọc truyện (Reader)

## Bối cảnh

Frontend React (Vite) của web đọc truyện "Hắc Đạo Truyện" tại `frontend/`.
Đây là **trang quan trọng nhất** vì là nơi giữ chân người đọc, và đa số
người dùng đọc bằng điện thoại. File chính:
- `frontend/src/pages/Reader.jsx` — trang đọc chương, có NavBar điều khiển
  (Home/Prev/chỉ số trang/Next/TTS/Settings) và nội dung markdown.
- `frontend/src/components/ReaderSettingsPanel.jsx` — panel cài đặt đọc
  (font size, content width, theme, TTS), hiện đã mở dưới dạng
  `<Modal>` bottom-sheet mobile-first (căn `alignItems:'flex-end'`, bo góc
  trên, `maxHeight:'85dvh'`) — pattern này ĐÃ ĐÚNG, không cần đổi kiểu
  drawer, chỉ cần polish nội dung bên trong cho ngón tay.
- CSS liên quan nằm trong `frontend/src/index.css` (biến `--reader-*`,
  class `.reader-*`).

Nếu Phase 0 (chuẩn hoá breakpoint + token spacing/font trong
`frontend/src/index.css`, biến `--space-*`/`--font-*`/`--tap-target-min`)
đã chạy trước, hãy dùng các token đó thay vì tự chế giá trị mới. Nếu chưa
có, cứ dùng giá trị px hợp lý tương đương (44px cho tap target, 16px cho
font-size base) và không phụ thuộc vào việc Phase 0 đã chạy hay chưa.

## Vấn đề cụ thể cần sửa

### 1. NavBar dùng kích thước cố định, dễ vỡ trên màn hình hẹp

Trong `Reader.jsx`, các nút điều khiển (Home, Prev, ô hiển thị số
trang/chương, Next, nút TTS, nút Stop, nút Settings) đang dùng
`width: '58px'`, `height: '58px'` cố định (nhiều vị trí trong hàm render
NavBar), xếp trong một hàng `flexWrap: 'wrap'`. Với ~6-7 phần tử × 58px +
gap, tổng chiều rộng có thể vượt quá viewport ở màn hình nhỏ (iPhone SE
375px, hoặc màn Android 360px), khiến nút bị wrap xuống dòng 2 một cách
không kiểm soát, đôi khi chồng lên nội dung hoặc lệch căn giữa xấu.

**Yêu cầu sửa:**
- Giữ nguyên toàn bộ hành vi/logic (không đổi onClick, không đổi thứ tự
  chức năng).
- Đổi kích thước nút từ px cố định sang co giãn theo viewport nhưng có
  min/max hợp lý, ví dụ dùng `clamp()`: kích thước nút trong khoảng
  44px (tối thiểu, đúng tap-target) đến 58px (giữ nguyên trên desktop),
  ví dụ `width: 'clamp(44px, 12vw, 58px)'` (điều chỉnh hệ số `vw` cho vừa
  đẹp qua test thực tế) — áp dụng đồng bộ cho width và height để nút vẫn
  vuông.
- Đảm bảo khoảng cách (`gap`) giữa các nút tối thiểu 8px, không bị nút này
  đè nút kia ở bất kỳ viewport nào từ 320px trở lên.
- Nếu sau khi co giãn tối thiểu (44px × số nút + gap) vẫn không vừa 1 hàng
  ở 320-360px, chủ động chia NavBar thành 2 nhóm rõ ràng bằng flexbox (ví
  dụ: nhóm điều hướng Prev/chỉ số/Next ở giữa, nhóm hành động phụ
  Home/TTS/Settings tách riêng — có thể xuống hàng 2 một cách CÓ CHỦ ĐÍCH
  bằng `flex-wrap` + `justify-content:center` thay vì để trình duyệt tự
  quyết định điểm gãy dòng lộn xộn).
- Test kỹ ở 320px (iPhone SE cũ / Android nhỏ), 375px, 414px, 768px.

### 2. Cỡ chữ dùng px thay vì đơn vị scale được

`fontSize` của nội dung đọc và trong `ReaderSettingsPanel` (range 12-36px)
hiện dùng `px` thuần. Điều này khiến cỡ chữ không tôn trọng cài đặt cỡ chữ
mặc định của trình duyệt/hệ điều hành người dùng (accessibility).

**Yêu cầu sửa:**
- KHÔNG bắt buộc đổi toàn bộ sang `rem` nếu điều đó phá vỡ logic lưu
  `settings.fontSize` hiện tại (giá trị số nguyên px được lưu vào
  localStorage/user settings) — ưu tiên AN TOÀN, giữ đơn vị lưu trữ là số
  px như cũ để tương thích ngược với dữ liệu đã lưu của người dùng hiện
  tại.
- Thay vào đó, đảm bảo: (a) cỡ chữ mặc định khi user chưa từng chỉnh
  không được nhỏ hơn 16px trên mobile, (b) `line-height` nội dung đọc tối
  thiểu 1.5 để dễ đọc trên màn hình nhỏ, (c) nếu có bất kỳ đoạn text UI
  nào (label, caption) đang < 12px, tăng lên tối thiểu 12px.

### 3. Polish ReaderSettingsPanel cho thao tác bằng ngón tay

Trong `ReaderSettingsPanel.jsx`:
- Đảm bảo mọi nút bấm (chọn theme, +/- font size, nút TTS...) có
  `min-height`/`min-width` ít nhất 44px và khoảng cách ≥8px giữa các nút
  cạnh nhau.
- `<input type="range">` (nếu có cho font size/content width) cần đủ vùng
  chạm cho thumb — kiểm tra CSS không giới hạn `height` của track quá nhỏ.
- Panel bottom-sheet cần có vùng "kéo xuống để đóng" hoặc ít nhất nút đóng
  (X) rõ ràng, kích thước ≥44px, nằm ở vị trí dễ bấm bằng ngón cái (góc
  trên phải của sheet là hợp lý cho tay thuận phải/trái đều chấp nhận
  được).
- Không cho phép nội dung panel bị tràn ra ngoài `maxHeight: '85dvh'` mà
  không có scroll nội bộ — nếu danh sách option dài, đảm bảo phần thân
  panel có `overflow-y: auto` riêng, còn thanh action cố định (nếu có) vẫn
  hiển thị.

## Ràng buộc (non-negotiable)

- Không đổi cấu trúc component thành component khác (không tách file mới
  trừ khi thực sự cần thiết để giữ file không quá dài — nếu tách, giữ
  nguyên props/behavior, chỉ là refactor thuần UI).
- Không đổi logic TTS, lưu settings, điều hướng chương — chỉ đổi
  CSS/layout/kích thước.
- Không phá pattern bottom-sheet hiện tại của Settings (đã đúng, chỉ cần
  polish nội dung bên trong).
- Giữ nguyên theme dark glassmorphism, tông đỏ-vàng đồng.
- Tuyệt đối không có scroll ngang ở bất kỳ viewport nào từ 320px trở lên.

## Cách test

1. `cd frontend && npm run dev`, mở 1 truyện bất kỳ, vào trang đọc chương.
2. DevTools responsive mode, test ở 320, 360, 375, 414, 768px:
   - NavBar không vỡ dòng lộn xộn, mọi nút bấm được, không chồng lấn.
   - Mở Settings panel (bottom-sheet), thử đổi font size, content width,
     theme — mọi control bấm/kéo dễ dàng bằng chuột giả lập ngón tay
     (không cần độ chính xác pixel cao).
   - Không có thanh scroll ngang ở bất kỳ đâu trên trang.
3. Kiểm tra cỡ chữ mặc định (chưa chỉnh gì) trên mobile ≥16px.
4. Báo cáo cuối: liệt kê file đã sửa, giá trị `clamp()`/kích thước cụ thể
   đã chọn cho NavBar, và bất kỳ trade-off nào bạn phải chọn (vd nếu phải
   chia NavBar 2 hàng ở 320px, nêu rõ layout 2 hàng đó là gì).
