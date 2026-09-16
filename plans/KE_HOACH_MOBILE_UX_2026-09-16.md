# Kế hoạch tối ưu UX/UI mobile — HacDaoTruyen frontend

Ngày lập: 2026-09-16
Bối cảnh: đa số người dùng truy cập bằng điện thoại; codebase React + CSS thuần
(không Tailwind), dark mode glassmorphism, tông đỏ trầm/vàng đồng (tiên hiệp).

## 1. Kết quả audit hiện trạng

Codebase **đã có nền mobile khá tốt sẵn**: viewport meta chuẩn
(`frontend/index.html:5`), bottom tab bar an toàn (`safe-area-inset-bottom`),
bảng `NovelTable` tự ẩn dưới 768px và fallback sang `NovelGrid`, layout 2 cột
trang chủ đã stack 1 cột trên mobile. Không cần đập đi làm lại — chỉ cần vá
đúng chỗ và chuẩn hoá.

3 vấn đề cốt lõi cần xử lý trước:

1. **Breakpoint không nhất quán**: `frontend/src/index.css` dùng lẫn lộn
   `600 / 768 / 769 / 900 / 992 / 1000 / 1200px` ở các chỗ khác nhau — dễ tạo
   khoảng "gap" layout vỡ giữa hai breakpoint liền kề, khó bảo trì.
2. **Reader NavBar dùng kích thước cố định**: các nút điều khiển (Home, Prev,
   chỉ số trang, Next, TTS, Stop, Settings) trong `frontend/src/pages/Reader.jsx`
   dùng `width/height: '58px'` tuyệt đối (dòng 442, 460-461, 504, 520, 535),
   xếp `flexWrap` trên 1 hàng (dòng 432-436) — trên màn hình ≤360px dễ vỡ
   dòng/chồng nút. Đây là trang quan trọng nhất (giữ chân người đọc).
3. **Không có design token spacing/font-size**: chỉ có biến màu
   (`--bg-dark`, `--accent`...) và 1 biến `--hp-max-width` (index.css:1185).
   Toàn bộ spacing/font-size là inline style rải rác px/rem tuỳ hứng trong
   .jsx — khó đảm bảo tap-target ≥44px và dòng chữ ≥16px đồng bộ toàn site.

Tham khảo UX guideline áp dụng (từ skill `ui-ux-pro-max`):
- Touch target: tối thiểu 24×24 CSS px theo WCAG 2.2 AA (khuyến nghị thực tế
  44px cho nút chính trên mobile), khoảng cách tối thiểu 8px giữa các target.
- Text không bị cắt/tràn ở màn hình hẹp: dùng `max-width` + `width:100%`,
  tránh `width` cố định lớn; `line-height` ≥1.5 cho nội dung đọc.
- Sticky nav không được che nội dung: content cần padding bù đúng bằng chiều
  cao nav (đã làm đúng ở `.guest-main.has-tab-bar`, cần audit các trang khác
  có dùng đúng class này không).
- Test tại các viewport chuẩn: 320, 375, 414, 768px.

## 2. Cấu trúc thực thi — 5 phase, mỗi phase 1 prompt Codex độc lập

Mỗi phase có file prompt riêng trong `plans/mobile-ux-prompts/`, tự chứa đủ
ngữ cảnh (không phụ thuộc phase trước phải merge xong mới đọc hiểu được).
Chạy tuần tự, review/test sau mỗi phase trước khi sang phase kế.

| Phase | File prompt | Nội dung | Rủi ro |
|---|---|---|---|
| 0 | `phase-0-tokens-breakpoints.md` | Chuẩn hoá breakpoint (600/768/1024px) + thêm design token spacing/font-size vào `index.css`. Không đổi giao diện nhìn thấy được. | Thấp |
| 1 | `phase-1-reader.md` | Sửa Reader NavBar + ReaderSettingsPanel cho mobile (ưu tiên cao nhất). | Trung bình |
| 2 | `phase-2-homepage.md` | Rà từng section trang chủ theo checklist tap-target/tràn ngang/spacing. | Thấp |
| 3 | `phase-3-novel-library.md` | Rà NovelPage (chi tiết truyện, danh sách chương) + LibraryPage (tủ truyện). | Thấp |
| 4 | `phase-4-header-tabbar-polish.md` | SiteHeader, BottomTabBar, AccountPage, EpubCatalogPage + audit toàn site còn sót. | Thấp |

Nguyên tắc chung áp dụng cho mọi phase (đã ghi trong từng prompt):
- **Ưu tiên responsive, hạn chế đổi cấu trúc component/logic** — chỉ sửa
  CSS, class, layout, không đổi hành vi nghiệp vụ.
- Không dùng Tailwind hay thư viện UI mới — giữ CSS thuần theo pattern hiện
  tại của project (biến CSS trong `:root`, class BEM-ish như `.hp-*`,
  `.tab-item`, `.reader-*`).
- Giữ dark mode glassmorphism + tông màu đỏ-vàng đồng hiện tại, không đổi
  theme.
- Test tại 320/375/414/768px, không được có scroll ngang ở bất kỳ mức nào.
- Tap target chính (nút bấm, tab, icon-button) ≥44×44px, khoảng cách ≥8px.

## 3. Cách dùng

1. Mở Codex, dán nguyên nội dung file `phase-0-tokens-breakpoints.md` làm
   prompt đầu tiên.
2. Review diff, chạy `npm run dev` trong `frontend/`, test bằng DevTools
   responsive mode ở các viewport 320/375/414/768.
3. Nếu ổn, commit, rồi chuyển sang phase 1, lặp lại.
4. Sau phase 4, chạy lại toàn bộ checklist một lượt cuối trên thiết bị thật
   (hoặc BrowserStack/Chrome remote debugging) trước khi coi là xong.
