# Technical Implementation Plan: Reusable Scroll-to-Top Button

## 1. Kiến trúc Component
- **File:** `frontend/src/components/ui/ScrollToTopButton.jsx`
- **Props:**
  - `threshold?: number` (Mặc định `400`): Khoảng cách cuộn tính bằng pixel trước khi hiện nút.
  - `ariaLabel?: string` (Mặc định `"Cuộn lên đầu trang"`): Nhãn trợ năng cho screen readers.
  - `bottomOffset?: string` (Mặc định `'calc(1.5rem + env(safe-area-inset-bottom, 0px))'`): Vị trí cách đáy màn hình, tính cả safe area.
  - `rightOffset?: string` (Mặc định `'calc(1.5rem + env(safe-area-inset-right, 0px))'`): Vị trí cách mép phải màn hình.
- **State & Hooks:**
  - `visible`: boolean, khởi tạo `false`.
  - `useEffect`: Đăng ký `window.addEventListener('scroll', handleScroll, { passive: true })` và hàm dọn dẹp `removeEventListener`.
  - `scrollToTop`: Gọi `window.scrollTo({ top: 0, behavior: 'smooth' })`.

## 2. Tích hợp Trang
- **File:** `frontend/src/pages/NovelPage.jsx`
- Import `ScrollToTopButton` và đặt ở cuối component (trước thẻ đóng container).

## 3. Kiểm thử (Testing Strategy)
- **File:** `frontend/tests/scroll-to-top.test.mjs`
- Chạy với Node native test runner (`node --test`).
- Kiểm tra các case:
  - Logic tính toán hiển thị theo ngưỡng `threshold`.
  - Logic xử lý `scrollTo` an toàn (kể cả khi `window.scrollTo` có hoặc không có trong môi trường test).

## 4. Quality Gates
- `npm run lint` sạch (0 error, 0 warning).
- `node --test frontend/tests/scroll-to-top.test.mjs` pass.
- `npm run build:frontend` tạo bundle thành công.
