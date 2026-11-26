# Phân tích truyenon.net — báo cáo nghiên cứu sản phẩm/kỹ thuật

Ngày thực hiện: 2026-11-26. Phạm vi: chỉ quan sát công khai, không đăng nhập, không nhập dữ liệu cá nhân, không vượt Cloudflare.

## 0. Giới hạn quan trọng (đọc trước)

| Kênh | Kết quả |
|---|---|
| `web_fetch https://truyenon.net` | Lỗi CLIENT_ERROR, không lấy được nội dung |
| `curl` trong sandbox | `403 host is not on the allow list` (proxy sandbox chặn domain) — không vượt |
| Trình duyệt tích hợp → `https://truyenon.net/` và `/robots.txt` | **HTTP 403 Cloudflare "Sorry, you have been blocked"** (WAF block, Ray ID a6089b0ca859095c). Đây là chặn cứng chứ không phải challenge → không thử vượt |
| `web_fetch web.archive.org` | Bị blocklist của công cụ |
| Trình duyệt → Wayback Machine (`id_` raw snapshot) | **Thành công.** Snapshot mới nhất trong CDX: **2024-09-05**. Mọi quan sát kỹ thuật bên dưới là của phiên bản 2024 |
| WebSearch | Có snippet gợi ý site hiện tại có trang `truyenon.net/nguyen-ton` (229 chương, "Hoàn thành", tác giả Thiên Tàm Thổ Đậu), có "lịch sử đọc", "tủ truyện", đăng nhập theo dõi. **Không kiểm chứng được** — có thể site đã đổi giao diện/nội dung sau 2024-09 |

=> Kết luận về phiên bản **hiện tại (2026)** chỉ có: site sau Cloudflare (quan sát trực tiếp qua trang lỗi WAF). Mọi thứ khác là phiên bản 2024 trong Wayback.

Số request: ~3 tới truyenon.net (đều 403), ~8 tới web.archive.org.

Ghi chú vận hành: trong lúc làm, tab Browser pane `tab-4` bị điều hướng sang `truyentrung.com` (không phải do agent này — có thể agent khác dùng chung pane). Dữ liệu từ origin đó **không** được dùng trong báo cáo.

## 1. Tech stack (bản 2024)

- **WordPress + theme tùy biến "datdora"** — quan sát trực tiếp: `wp-content/themes/datdora/js/main.js`, `.../css/datdora.css`, `.../stylechap/assets/bootstrap.css`, `xmlrpc.php` pingback, form `wp-login.php`.
- **jQuery 3.7.1 + jquery-migrate**, thêm `code.jquery.com/jquery-3.6.0.min.js` ở trang chương (nạp 2 bản jQuery — quan sát trực tiếp), Bootstrap 3 (glyphicon, `col-xs-*`), Font Awesome 4.7 từ cdnjs.
- **Plugin WP** (quan sát trực tiếp qua đường dẫn script/css):
  - `wp-favorite-posts` 1.6.8 → "Add to favorites" / trang `/favorites/`
  - `wp-postratings` 1.91.1 → chấm sao 1–5 qua `admin-ajax.php`
  - `wpdiscuz` 7.6.14 → bình luận (bubble, thông báo comment mới)
  - **Rank Math PRO** → SEO meta + JSON-LD
- **Ảnh truyện tranh trên AWS S3**: `https://truyenon.s3.ap-southeast-1.amazonaws.com/{slug}-chap-{n}-{storyId}-{page}.jpg` (quan sát trực tiếp, 270 thẻ `img` trên 1 trang chương, có `data-src` + class `loaded` → có lazy-load bằng JS, suy luận).
- **SSR thuần PHP**, không phải SPA; không thấy API JSON riêng.
- **CDN/WAF**: Cloudflare (quan sát trực tiếp trang block 2026). Năm 2024 không thấy dấu hiệu Cloudflare trong HTML lưu (không kết luận được).
- **Đăng nhập Google** qua domain bên thứ ba `https://datdora.com/login/google` (quan sát trực tiếp href) — tức vendor theme làm cầu OAuth. Đăng nhập thường qua `wp-login.php` (log/pwd).
- **Kiếm tiền**: Google AdSense `adsbygoogle.js?client=ca-pub-3089979393145528` (quan sát trực tiếp ở trang chủ & trang truyện). Trang chương không có `ins.adsbygoogle` trong snapshot. Không thấy VIP/xu/paywall.

## 2. Loại nội dung & mô hình dữ liệu

- Bản 2024 là **site truyện tranh** (manga/manhwa/manhua), title "Đọc Truyện Tranh Online Miễn Phí - TruyenOn.net" — **không phải truyện chữ/convert**. Vì vậy **không có cơ chế dịch/convert/name/từ điển** để quan sát.
- Mô hình (suy luận từ WP + URL):
  - Truyện = WP `post` (id ví dụ `36876`), slug ở gốc: `/ac-quy-tro-lai-hoc-duong/`
  - Thể loại = WP `category` trộn cả thể loại lẫn định dạng: `/category/action/`, `/category/manhwa/`, `/category/truyen-mau/`, `/category/tu-tien/`… (~40 mục)
  - Chương = bản ghi con có id riêng (`chapter.id: '36889'`), URL `/{slug}/chap-{n}[-{sub}]-{storyId}.html` — hỗ trợ chương lẻ: `chap-12-1-1-46605.html`, `chap-9-5-...`
  - Trường meta: Tác giả, Tình trạng (Đang tiến hành/Hoàn thành), Cập nhật, Lượt xem (ví dụ `Lượt xem:538`), rating.
- Danh sách: `/completed/` (Truyện Full), `/trending/` (Hot), `/newest/`, `/favorites/`, `/history/`, `/?m_orderby=trending`, phân trang `/page/2/`, tìm kiếm `/?s=`.

## 3. Cơ chế đọc chương (bản 2024)

- Quan sát trực tiếp (trang `chap-13-36876.html`):
  - Toàn bộ ảnh của chương render 1 trang dọc (cuộn liên tục), không phân trang.
  - Nút `#prev_chap` / `#next_chap` là link tĩnh SSR; popup "List Chapter" (`.chapters.popup`, `openChap()`) liệt kê mọi chương.
  - **Không có chống copy**: `user-select: auto`, không `oncontextmenu`; ảnh S3 có tên đoán được → dễ hotlink/crawl.
  - **Không mã hoá nội dung.**
  - Mỗi chương có đoạn text SEO lặp mẫu: "Đọc truyện tranh {X} Chap 13 tiếng việt, … tập 13 …".
- Không thấy prefetch chương kế (không có `<link rel=prefetch/next>` cho chương — suy luận từ DOM; trang chủ có `rel=next` cho phân trang).

## 4. Reader settings (quan sát trực tiếp từ inline script)

- `changeTheme(name)` → class `theme-01..05` trên `body.chap-view` (5 theme màu, `theme-05` = ban đêm).
- `changeNight()`, `boxTheme()` (bật/tắt hộp cài đặt `.box-read`), `changeFont()` set `font-size` px cho `.chap-content .chap-c` (nút A-/A+).
- `saveSetting()` lưu vào **localStorage** khóa `nightMode`, `boxTheme`, `bodyTheme`; `loadSettings()` khi `document.ready`.
- Thanh điều khiển dưới `.footter-fix`: tự hiện khi cuộn gần cuối trang (`scrollTop + height >= docHeight - 100`) hoặc chạm vào nội dung; ẩn khi cuộn.
- Trang ngoài reader: dark mode riêng bằng localStorage `color-switch`, cookie `bgcolor-cookie` (`#232323` → `dark-theme`). → **2 hệ thống theme song song, không thống nhất** (quan sát trực tiếp).
- Mobile: rút gọn nhãn "Chapter " → "C", "Volume " → "V" bằng regex UA `iPhone|iPad|iPod|Android` (quan sát trực tiếp `reShowChapterText`). Viewport `maximum-scale=1.0` (chặn zoom — xấu cho a11y). Nút back-to-top.
- Không thấy: TTS, chế độ trang/lật trang, đồng bộ tiến độ lên server.

## 5. Lịch sử đọc (cơ chế hay nhất, quan sát trực tiếp)

```js
var novel = { id: 36876, name: '…', url: '…/', chapter: { id: '36889', name: 'Chapter 13', url: '…/chap-13-36876.html' } };
// cookie "novels_history": JSON mảng, MRU, tối đa 10, dedupe theo novel.id, hết hạn 7 ngày, path '/'
```
Trang chủ đọc cookie, cắt 5 mục, render khối "Truyện Đang Đọc" ở cả main (`#novel-history-main`) và sidebar (`#novel-history-sidebar`) với link "đọc tiếp" thẳng tới chương cuối. Không cần đăng nhập, không tốn request server.
Nhược điểm: cookie gửi kèm mọi request (tăng header, phá cache CDN nếu cache theo cookie), giới hạn ~4KB, 7 ngày là ngắn.

## 6. Cộng đồng

- Bình luận wpDiscuz (bubble đếm comment, thông báo comment mới, reply) — quan sát trực tiếp qua `#wpd-bubble-*`.
- Đánh giá sao 1–5 (`wp-postratings`, "1 votes, average: 5,00 out of 5") — quan sát trực tiếp.
- Yêu thích (`wpfp-link`) → `/favorites/` — quan sát trực tiếp.
- Bảng xếp hạng: chỉ "Hot/trending" (`?m_orderby=trending`) và lượt xem; không thấy BXH theo tuần/tháng, đề cử, thông báo chương mới, tủ truyện server-side (snippet search 2026 có nhắc "tủ truyện" — không kiểm chứng).

## 7. SEO

- Rank Math PRO: `robots: index, follow, max-snippet:-1, max-image-preview:large`, canonical, OG/Twitter card, `og:locale vi_VN`.
- JSON-LD: `WebSite` + **`SearchAction`** (`https://truyenon.net/?s={search_term_string}` → sitelinks searchbox), `CollectionPage` trang chủ, `BlogPosting` + `ImageObject` (bìa) + `articleSection` (thể loại) cho trang truyện. **Dùng `BlogPosting` thay vì `Book`/`ComicSeries`** — chưa tối ưu (quan sát trực tiếp).
- URL slug tiếng Việt không dấu, ngắn ở gốc domain; chương `.html`. Có lỗi trùng URL có/không dấu `/` cuối (`chap-13-36876.html` vs `chap-13-36876.html/`, cả hai đều 200 trong CDX) → nguy cơ duplicate content (canonical đã trỏ bản không `/`).
- Text SEO template mỗi chương (thin/duplicate content — rủi ro với Google).
- Sitemap: không quan sát được (robots.txt bị 403).

## 8. Hiệu năng (suy luận)

- Trang chương nặng: 270 `<img>`, 2 bản jQuery, Bootstrap 3 + jquery-ui css, FA 4.7 — nhiều tài nguyên chặn render.
- Ảnh ở S3 Singapore trực tiếp (không thấy CDN ảnh riêng trong snapshot), có lazy-load.
- Trang SSR WordPress dễ cache toàn trang (đặc biệt khi Cloudflare đứng trước).

## 9. REA (Reverse Engineer Anything) — chạy tới đâu

- `npx -y rea-agents@6.7.0 --help` chạy OK trong sandbox.
- `analyze-web-bundle` / `capture-browser-scenario` **không dùng được**: sandbox không ra mạng tới truyenon.net (allowlist proxy) và site đã 403 Cloudflare.
- Theme JS (`datdora/js/main.js`, `custom.js`) **không có trong Wayback** (404) → không tải được bundle.
- Phương án dự phòng: chép inline scripts từ snapshot Wayback (trang chủ + trang chương) vào `/tmp/rea_truyenon/bundle/` (2 file), chạy `analyze-javascript-application --json` → exit 0, graph: 3 node `storage` (localStorage `color-switch`, get/setItem), 1 `endpoint` route `/`, 2 module. REA **không** nhận diện `$.cookie("novels_history")` (thư viện jQuery cookie) → giá trị thấp, phần lớn phân tích là đọc tay.
- Evidence JSON: `outputs/research/truyenon_rea_evidence.json`.

## 10. TOP 8 tính năng/cơ chế đáng học cho HacDaoTruyen

(Độ khó cho stack Cloudflare Worker + D1 + R2 + React/Vite)

1. **"Truyện đang đọc" không cần đăng nhập** (MRU 10 truyện, dedupe theo id, link thẳng chương cuối, hiện ở trang chủ + sidebar).
   - Vì sao hay: tăng quay lại/đọc tiếp, zero server cost.
   - Độ khó: Thấp. Làm bằng **localStorage** (không dùng cookie như họ để khỏi phá cache CDN), đồng bộ lên D1 khi user đăng nhập.
   - Rủi ro: mất khi xoá dữ liệu trình duyệt; xung đột merge khi đồng bộ đa thiết bị.
2. **Reader settings lưu cục bộ + preset theme (5 theme, night, cỡ chữ A-/A+)**.
   - Vì sao hay: cá nhân hoá tức thì, không cần tài khoản.
   - Độ khó: Thấp. Nên gộp thành 1 object JSON `readerPrefs` + CSS variables, áp trước khi paint (script inline trong `<head>`) để tránh nháy theme — điểm họ làm chưa tốt (2 hệ theme song song).
   - Rủi ro: FOUC nếu áp sau hydrate.
3. **Thanh điều khiển tự hiện khi chạm nội dung / khi cuộn tới cuối chương** (`.footter-fix`).
   - Vì sao hay: reader toàn màn hình, công cụ xuất hiện đúng lúc cần "chương sau".
   - Độ khó: Thấp (IntersectionObserver sentinel cuối chương thay cho scroll handler).
   - Rủi ro: gây khó chịu nếu che chữ; cần debounce.
4. **Schema.org `SearchAction` + JSON-LD cho từng truyện** (họ dùng BlogPosting; mình nên dùng `Book`/`CreativeWorkSeries` + `Chapter`, `BreadcrumbList`, `aggregateRating`).
   - Vì sao hay: sitelinks searchbox, rich result, CTR tốt.
   - Độ khó: Thấp–Trung bình. Cần SSR/edge-render meta trong Worker (HTMLRewriter chèn `<head>` cho SPA React).
   - Rủi ro: `aggregateRating` tự host có thể bị Google coi là self-serving; nội dung sai schema bị bỏ qua.
5. **URL chương ổn định, ngắn, chứa id truyện + hỗ trợ chương lẻ** (`chap-12-1`, `chap-9-5`).
   - Vì sao hay: SEO + chịu được truyện có chương bổ sung/phiên ngoại.
   - Độ khó: Trung bình (đổi route + 301 từ URL cũ trong Worker; khóa chương dạng `chapter_no TEXT`/sort key thập phân trong D1).
   - Rủi ro: tránh lỗi trùng URL có/không `/` như họ — chuẩn hoá + canonical + 301.
6. **Đánh giá sao + yêu thích + lượt xem hiển thị ngay trang truyện**, kèm danh sách Hot/Full/Mới.
   - Vì sao hay: tín hiệu xã hội rẻ, tạo trang danh mục cho SEO.
   - Độ khó: Trung bình. Lượt xem nên đếm qua Durable Object/Analytics Engine hoặc batch ghi D1 (tránh ghi D1 mỗi view); rating 1 phiếu/user.
   - Rủi ro: spam/vote ảo; chi phí ghi D1.
7. **Bình luận theo truyện/chương có thông báo comment mới** (wpDiscuz).
   - Vì sao hay: giữ chân, tạo nội dung UGC cho SEO.
   - Độ khó: Trung bình–Cao (D1 bảng comments, moderation, rate-limit Turnstile, chống spam).
   - Rủi ro: kiểm duyệt nội dung, spam, pháp lý.
8. **Đặt Cloudflare WAF/bot-management trước site + tên file tài nguyên có tổ chức** (ở đây lesson ngược: họ chặn bot mạnh nhưng ảnh S3 tên đoán được, không chống hotlink).
   - Vì sao hay: site dịch AI là tài sản tốn tiền (token) → cần chống crawl nội dung chương.
   - Độ khó: Thấp–Trung bình: WAF rules + rate limiting + Turnstile cho API chương; R2 qua Worker với khóa không đoán được / signed URL; Hotlink protection.
   - Rủi ro: chặn nhầm Googlebot/người dùng thật (họ chặn cả trình duyệt bình thường của agent này) → phải whitelist verified bots và đo tỷ lệ false-positive.

### Điều KHÔNG nên học
- 2 bản jQuery, 2 hệ dark mode, `maximum-scale=1.0` (chặn zoom), text SEO lặp mẫu mỗi chương, lịch sử đọc trong cookie, Google login qua domain vendor bên thứ ba (rủi ro bảo mật/riêng tư).

## 11. Những gì KHÔNG quan sát được
- Giao diện/tính năng hiện tại (2026): bị Cloudflare chặn; có dấu hiệu từ search snippet là site đã có truyện chữ (Nguyên Tôn — tác giả Thiên Tàm Thổ Đậu), lịch sử đọc, tủ truyện — chưa kiểm chứng.
- Cơ chế dịch/convert, name/từ điển, TTS, VIP/xu, thông báo chương mới, sitemap, robots, header cache: không thấy.
- API `admin-ajax.php` (rating, wpDiscuz) chỉ thấy URL, không gọi thử.
