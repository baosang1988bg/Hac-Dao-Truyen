# Frontend Hắc Đạo Truyện

React 18, React Router 6, Vite 5, Axios và epubjs. Entry `src/main.jsx`, routes/layouts trong `src/App.jsx`; các trang admin và EPUB được lazy-load.

```sh
npm ci
npm run dev
npm run build
npm run lint
```

Chạy từ `frontend/`. Vite proxy `/api` đến FastAPI `http://127.0.0.1:4444`. Bản build nằm ở `dist/`, được Cloudflare Worker phục vụ qua binding `ASSETS`.

`src/api.js` gắn token admin `authToken`; `src/userApi.js` dùng token độc giả `userToken`. Hai loại phiên có cách xử lý 401 khác nhau. Local và Worker có response danh sách truyện khác shape; xem [API](../docs/api.md).

Xem [cài đặt dự án](../docs/getting-started.md), [kiến trúc](../docs/architecture.md) và [review](../docs/review-2026-09-08.md). Lint 0 lỗi/0 cảnh báo và build pass. Browser smoke giả lập API local/cloud kiểm tra trang chủ, reader, admin và EPUB; xem nhật ký triển khai để biết phạm vi xác minh production.
