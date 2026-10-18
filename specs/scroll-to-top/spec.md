# Feature Specification: Reusable Scroll-to-Top Button

## 1. Bối cảnh & Lý do (Context & Problem Statement)
Trên trang chi tiết tiểu thuyết (`NovelPage.jsx`), danh sách chương có thể lên đến hàng ngàn chương. Khi người dùng cuộn xuống sâu để duyệt chương, hiện tại không có nút hỗ trợ quay nhanh lại đầu trang, khiến trải nghiệm duyệt trên cả mobile lẫn desktop bị gián đoạn.

## 2. Mục tiêu (Goals)
- Xây dựng component tái sử dụng `ScrollToTopButton` tại `frontend/src/components/ui/ScrollToTopButton.jsx`.
- Nút chỉ hiển thị khi vị trí cuộn trang vượt qua một ngưỡng nhất định (mặc định: `threshold = 400px`).
- Khi nhấn nút, trang cuộn mượt (`behavior: 'smooth'`) về vị trí đỉnh (`top: 0`).
- Tích hợp component vào `NovelPage.jsx`.
- Bảo đảm tiêu chuẩn Accessibility (A11y): có `aria-label`, phím Tab focus được, icon ẩn với screen reader (`aria-hidden="true"`).

## 3. Ràng buộc Kỹ thuật (Technical Constraints)
- Framework: React 18, JSX thuần, không thêm CSS framework ngoài.
- Dùng icon `ChevronUp` từ `lucide-react`.
- Gắn và gỡ event listener `scroll` đúng quy chuẩn trong `useEffect` (passive scroll listener).
- Viết unit test độc lập kiểm tra logic hiển thị / ẩn và trigger cuộn trang tại `frontend/tests/scroll-to-top.test.mjs`.
- Tuân thủ cổng chất lượng: `npm run lint` đạt 0 warning, 0 error.
