# Prompt Codex — Phase 2: Tối ưu mobile cho Trang chủ

## Bối cảnh

Frontend React (Vite) của web đọc truyện "Hắc Đạo Truyện" tại `frontend/`.
Đa số người dùng truy cập bằng điện thoại. Trang chủ gồm nhiều section xếp
theo thứ tự trong `frontend/src/pages/HomePage.jsx`:

1. `SearchSection`
2. `MonthlyPopularSection`
3. `TruyThuNoticeSection`
4. Cột trái (mobile: xếp trước theo DOM order): `UpdatesSection`,
   `ExternalRankingsSection`, `GenreChips`, `AllNovelsSection`
5. Cột phải: `RecentlyReadSection`, `TruyenTrungRankings`,
   `AnnouncementsSection`, `TruyenTrungChatboxWidget`,
   `RecentCommentsSection`, `StatsSection`

Tất cả nằm trong `frontend/src/pages/homepage/`. Layout tổng dùng class
`.hp-portal-layout` (CSS Grid, `frontend/src/index.css`): mobile là 1 cột
(`grid-template-columns: 1fr`), chỉ chuyển 2 cột ở màn hình rộng
(`min-width: 992px` hoặc `1200px` tuỳ giá trị hiện tại sau Phase 0). Pattern
2 cột → 1 cột này ĐÃ ĐÚNG, không cần đổi.

`NovelGrid` (`frontend/src/components/ui/NovelGrid.jsx`) đã responsive:
mobile mặc định 3 cột, đổi cột qua breakpoint `520px`/`900px` (có thể đã
được Phase 0 đổi thành `600px`/`1024px`). Không cần đổi cấu trúc grid này,
chỉ audit chi tiết spacing/tap-target bên trong từng card.

Đây là phase **audit + polish theo checklist**, không phải viết lại từ
đầu — đa số section đã responsive cơ bản, nhiệm vụ là rà từng section theo
danh sách dưới và sửa các điểm chưa đạt.

## Checklist áp dụng cho TỪNG section (`SearchSection`, `MonthlyPopularSection`,
`TruyThuNoticeSection`, `UpdatesSection`, `ExternalRankingsSection`,
`GenreChips`, `AllNovelsSection`, `RecentlyReadSection`, `TruyenTrungRankings`,
`AnnouncementsSection`, `TruyenTrungChatboxWidget`, `RecentCommentsSection`,
`StatsSection`)

Với mỗi file, kiểm tra và sửa nếu vi phạm:

1. **Tap target**: mọi nút, link, chip (vd `GenreChips`), icon-button có
   vùng chạm ≥44×44px (hoặc tối thiểu 24×24px theo WCAG nếu là phần tử phụ
   không phải hành động chính), khoảng cách giữa 2 target liền kề ≥8px.
2. **Không tràn ngang**: không phần tử nào dùng `width` cố định lớn (vd
   `width: '300px'` không kèm `max-width`/responsive) gây tràn ở 320-375px.
   Ưu tiên `max-width` + `width: 100%`, hoặc CSS Grid/Flexbox với
   `minmax()`/`flex-wrap`.
3. **Line-clamp cho text dài**: tiêu đề truyện, mô tả, tên section trong
   card/list phải có `overflow: hidden; text-overflow: ellipsis` (1 dòng)
   hoặc `-webkit-line-clamp` (nhiều dòng) thay vì để tràn hoặc đẩy layout.
4. **Khoảng cách (spacing) nhất quán**: dùng token spacing nếu Phase 0 đã
   thêm (`--space-2` = 8px, `--space-4` = 16px...) trong `index.css`; nếu
   Phase 0 chưa chạy, dùng giá trị bội số của 4px tương đương, không để
   margin/padding lẻ tuỳ hứng (vd `13px`, `7px`).
5. **Font-size tối thiểu 12px** cho mọi text (kể cả label phụ, timestamp),
   16px cho nội dung chính cần đọc.
6. **Ảnh bìa truyện** (nếu section có cover): đảm bảo có `aspect-ratio` cố
   định hoặc kích thước container cố định để tránh Cumulative Layout Shift
   (CLS) khi ảnh load — không bắt buộc thêm lazy-loading mới nếu đã có,
   chỉ đảm bảo không bị giật layout khi ảnh load xong.
7. **Horizontal scroll có chủ đích** (vd `MonthlyPopularSection`,
   `TruyenTrungRankings` nếu hiển thị dạng carousel ngang): nếu có, đảm bảo
   có đủ padding 2 bên để card cuối không bị dính sát mép màn hình, và có
   chỉ báo scroll (không bắt buộc thêm mới nếu chưa có, nhưng nếu dễ thêm
   `scroll-snap-type` thì làm để trải nghiệm mượt hơn).

## Ưu tiên đặc biệt

- `SearchSection`: ô tìm kiếm phải đủ rộng, dễ bấm, bàn phím mobile hiện
  đúng loại (nếu có input riêng cho số/lọc, cân nhắc `inputMode` phù hợp).
- `GenreChips`: các chip thể loại thường bị dồn dày đặc — đảm bảo đủ
  padding trong mỗi chip và gap giữa các chip ≥8px, có thể cho phép
  horizontal scroll nếu số lượng chip nhiều thay vì để wrap lộn xộn nhiều
  hàng.
- `AllNovelsSection` / danh sách truyện dài: nếu dùng phân trang hoặc
  "xem thêm", nút đó phải đủ lớn và có khoảng cách với nội dung phía trên.

## Ràng buộc (non-negotiable)

- Không đổi cấu trúc `.hp-portal-layout` (grid 2 cột → 1 cột đã đúng).
- Không đổi thứ tự section, không đổi data/props/API call.
- Không dùng Tailwind, không thêm thư viện mới.
- Giữ theme dark glassmorphism, tông đỏ-vàng đồng.
- Không có scroll ngang KHÔNG CHỦ ĐÍCH ở bất kỳ đâu (carousel cố ý có
  scroll ngang thì OK, phần còn lại của trang thì không).

## Cách test

1. `cd frontend && npm run dev`, mở trang chủ.
2. DevTools responsive mode: 320, 375, 414, 768, 1024px.
3. Với mỗi section, kiểm tra qua checklist ở trên — có thể tick từng mục
   trong báo cáo cuối.
4. Đặc biệt kiểm tra: cuộn hết trang chủ trên mobile không bị giật, không
   có phần tử nào bị cắt chữ giữa chừng không có ellipsis.
5. Báo cáo cuối: liệt kê theo từng section — đã sửa gì / không cần sửa gì
   (kèm lý do ngắn), và file:line cụ thể cho các thay đổi.
