# Prompt Codex — Phase 0: Chuẩn hoá breakpoint & design token

## Bối cảnh

Đây là frontend React (Vite) của web đọc truyện "Hắc Đạo Truyện", nằm ở
`frontend/`. Styling dùng CSS thuần trong `frontend/src/index.css` (không
Tailwind, không CSS-in-JS framework), kết hợp inline style trong các file
`.jsx`. Theme là dark mode glassmorphism, tông màu đỏ trầm/vàng đồng
(`--accent: #c9932e`, `--accent-gradient` đỏ→vàng).

Đa số người dùng truy cập bằng điện thoại, nên đang có một chuỗi việc tối ưu
mobile UX chia làm nhiều phase. Đây là **Phase 0 — nền tảng**: chuẩn hoá
breakpoint và thêm design token, KHÔNG được thay đổi giao diện nhìn thấy
được (visual regression phải bằng 0).

## Vấn đề hiện tại

Trong `frontend/src/index.css`, các media query dùng breakpoint không nhất
quán, ví dụ (số dòng có thể lệch nhẹ do các thay đổi trước đó, hãy tự grep
lại `@media` để xác nhận):
- `max-width: 768px` và `min-width: 769px` (cặp đôi cho header/tab-bar)
- `max-width: 900px`, `min-width: 900px` / `max-width: 899px`
- `min-width: 600px`, `min-width: 1000px`
- `max-width: 520px`, `min-width: 520px`
- `min-width: 768px`, `min-width: 992px`, `min-width: 1200px`

Việc này khiến có những khoảng viewport (vd 900-991px) rơi vào trạng thái
không được test kỹ, dễ vỡ layout. Ngoài ra, `:root` trong `index.css` chỉ có
biến màu (`--bg-dark`, `--accent`, `--text-muted`...) và một biến kích thước
duy nhất `--hp-max-width: 1100px`. Không có token chuẩn cho spacing hay
font-size — mọi khoảng cách/cỡ chữ được viết tay (px hoặc rem tuỳ hứng)
rải rác trong file `.jsx`.

## Việc cần làm

### 1. Chuẩn hoá bộ breakpoint dùng chung

Định nghĩa và áp dụng nhất quán 3 breakpoint sau trên toàn bộ
`frontend/src/index.css` và các CSS import khác (`ExternalRankingsSection.css`
nếu có):

- `--bp-sm: 600px` — mobile nhỏ / lớn (một số layout 2 cột nhẹ ở đây)
- `--bp-md: 768px` — ranh giới mobile/tablet chính (bottom tab bar, header,
  bảng → grid fallback đều dùng mốc này)
- `--bp-lg: 1024px` — ranh giới tablet/desktop (sidebar 2 cột trang chủ...)

CSS custom property không dùng được trực tiếp trong `@media`, nên **không**
cần (và không thể) viết `@media (min-width: var(--bp-md))`. Thay vào đó:
- Thêm comment ở đầu file liệt kê rõ 3 mốc này là "breakpoint chuẩn của dự
  án — mọi @media mới phải dùng 1 trong 3 mốc này, không tự chế mốc khác".
- Rà toàn bộ `@media` hiện có trong `index.css` (và mọi `.css` khác trong
  `frontend/src`), quy các mốc gần nhau về đúng 1 trong 3 mốc chuẩn:
  - `520px` → `600px`
  - `769px`/`900px`/`899px` → `768px` (giữ đúng cặp min/max liền kề: nếu có
    `max-width:768px` thì cặp bật lại phải là `min-width:769px`, tuyệt đối
    không để cả hai cùng dùng `768px` gây chồng breakpoint ở đúng 768px)
  - `992px`/`1000px` → `1024px`
  - `1200px`: giữ nguyên nếu là mốc desktop rộng riêng (>lg), đổi tên biến
    liên quan nếu cần nhưng không bắt buộc gộp vào 3 mốc trên.
- Sau khi đổi mốc, **kiểm tra kỹ từng chỗ** để không làm lệch hành vi hiện
  tại (vd nếu đổi `900px` → `1024px` mà layout đó vốn nhắm tablet ngang thì
  phải cân nhắc có đổi đúng ý nghĩa không — ưu tiên an toàn, có thể giữ
  nguyên mốc cũ nếu đổi sẽ gây thay đổi hành vi rõ rệt, và ghi chú lại trong
  báo cáo cuối).

### 2. Thêm design token spacing & typography vào `:root`

Bổ sung vào khối `:root` đầu `index.css` (cạnh các biến màu hiện có),
KHÔNG xoá biến nào đang có:

```css
/* Spacing scale (mobile-first, dùng thay cho margin/padding hard-code) */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-8: 48px;

/* Typography scale — base 16px, line-height 1.5 cho nội dung đọc */
--font-xs: 0.75rem;   /* 12px — label phụ */
--font-sm: 0.875rem;  /* 14px */
--font-base: 1rem;    /* 16px — body mặc định, KHÔNG để body nhỏ hơn */
--font-lg: 1.125rem;  /* 18px */
--font-xl: 1.25rem;   /* 20px */
--font-2xl: 1.5rem;   /* 24px */

/* Touch target tối thiểu (WCAG 2.2 AA / thực tế mobile) */
--tap-target-min: 44px;
```

Chỉ thêm token, **không** đi sửa từng nơi dùng inline style sang dùng token
này trong Phase 0 (việc đó làm dần ở Phase 1-4 khi đụng tới từng file, để
tránh 1 PR khổng lồ không review được). Phase 0 chỉ chuẩn bị hạ tầng.

### 3. Rà `min-height`/kích thước tap target hiện có

Trong `.tab-item` (bottom tab bar) đang có `min-height: 56px` — giữ nguyên
(đã tốt hơn mức tối thiểu). Chỉ cần xác nhận không có nút/link chính nào
trong `index.css` có `min-height`/`height` < 44px trên mobile; nếu có, note
lại trong báo cáo để Phase sau xử lý (không tự sửa ở đây nếu việc sửa đụng
vào cấu trúc component).

## Ràng buộc (non-negotiable)

- KHÔNG đổi cấu trúc component `.jsx`, không đổi tên class đang được JS
  tham chiếu (`className={...}` trong các file .jsx) trừ khi bạn cập nhật
  đồng bộ cả hai phía.
- KHÔNG dùng Tailwind, KHÔNG thêm thư viện CSS mới.
- KHÔNG thay đổi màu sắc, theme, hiệu ứng glassmorphism hiện tại.
- Giao diện phải giữ nguyên 100% ở cả desktop và mobile sau khi xong Phase
  0 (đây là refactor hạ tầng, không phải thay đổi UI).

## Cách test

1. `cd frontend && npm run dev`.
2. Mở DevTools responsive mode, so sánh trước/sau ở các viewport
   320/375/414/768/1024/1440px cho: Trang chủ, Trang đọc truyện, Trang chi
   tiết truyện, Tủ truyện — không có gì lệch layout so với trước khi sửa.
3. `npm run lint` (nếu có) phải pass.
4. Ghi báo cáo ngắn gọn (cuối phản hồi) liệt kê: các breakpoint đã đổi
   (cũ → mới, kèm số dòng), token mới đã thêm, và bất kỳ chỗ nào bạn quyết
   định KHÔNG đổi vì rủi ro thay đổi hành vi (kèm lý do).
