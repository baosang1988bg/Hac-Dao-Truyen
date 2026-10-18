# Tasks: Reusable Scroll-to-Top Button

- [x] **Task 1: Tạo Component `ScrollToTopButton.jsx`**
  - Tạo `frontend/src/components/ui/ScrollToTopButton.jsx` và `frontend/src/utils/scroll.js`.
  - Thêm `PropTypes` và default values.
  - Tối ưu CSS inline + animation nhẹ nhàng với kính mờ (backdrop-filter) hợp chuẩn dark mode của HacDaoTruyen.

- [x] **Task 2: Viết Unit Test `scroll-to-top.test.mjs`**
  - Tạo `frontend/tests/scroll-to-top.test.mjs`.
  - Chạy `node --test frontend/tests/scroll-to-top.test.mjs` xác nhận 4/4 assertions pass.

- [x] **Task 3: Tích hợp vào `NovelPage.jsx`**
  - Chèn `ScrollToTopButton` vào `frontend/src/pages/NovelPage.jsx`.

- [x] **Task 4: Chạy Quality Gates**
  - Chạy `npm run lint` xác nhận ESLint 9 + node check syntax không có cảnh báo.
  - Chạy `npm run test:frontend` xác nhận toàn bộ 34/34 unit test frontend pass.
  - Chạy `npm run build:frontend` xác nhận Vite bundle thành công (2.12s).
