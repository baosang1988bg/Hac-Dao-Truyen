# Báo cáo: học từ đối thủ (truyenon.net, sangtacviet, truyentrung) — 2026-11-26

Nhánh: `feature/competitor-learnings` (tách từ `dev`). KHÔNG chạm production: chưa push, chưa deploy, chưa chạy migration remote.

## 1. Nghiên cứu (REA + quan sát công khai)

Ba agent chạy song song, mỗi agent một site, chỉ quan sát công khai (không đăng nhập, không vượt Cloudflare/CAPTCHA, dưới 30 request/site). Báo cáo chi tiết từng site kèm mức độ chắc chắn ("quan sát trực tiếp" hay "suy luận") nằm ở `plans/research_doi_thu_2026-11-26/`.

**truyentrung.com** là site xem được nhiều nhất và cho nhiều bài học nhất. Đây là Next.js 16 (App Router, Server Actions), ảnh nằm trên Supabase Storage, Cloudflare đứng trước. Điểm đáng học: lượt đọc chỉ tính khi tab hiển thị đủ 30 giây kèm cuộn tới cuối, có token server ký; tiến độ đọc lưu tới từng đoạn văn; cài đặt Reader lưu lên tài khoản; JSON-LD `Book` / `BreadcrumbList` / `WebSite + SearchAction`; BXH reset theo kỳ; TTS edge-tts theo đoạn; mô hình một truyện nhiều bản dịch; hệ thống mở khoá chương VIP có chống trừ tiền hai lần.

**sangtacviet** chặn gần hết (robots cấm `/truyen/`, mirror lỗi). Lấy được gián tiếp từ issue GitHub công khai của WebToEpub: nội dung chương tải qua AJAX `index.php?...sajax=readchapter`, ID chương ánh xạ 1-1 với nguồn. Phần cơ chế convert/name (name cá nhân > name chung > từ điển, sửa name ngay trong Reader, đổi name không cần dịch lại) là **suy luận**, nhưng ý tưởng "name chung do cộng đồng góp" là bài học chính.

**truyenon.net** chặn cứng (403). Phân tích qua Wayback (bản 2024-09) cho thấy khi đó là site truyện tranh WordPress, bài học nhỏ: "Truyện đang đọc" không cần đăng nhập, áp theme trước khi render, thanh điều khiển hiện khi chạm/cuộn cuối.

**Về REA**: REA MCP chưa nạp vào phiên này nên dùng CLI `npx rea-agents@6.7.0`. CLI chạy được, nhưng `analyze-web-bundle` / `capture-browser-scenario` cần sandbox ra mạng tới site và có Chromium — cả hai đều không có. `analyze-javascript-application` chỉ chạy được trên đoạn script lấy từ Wayback (truyenon), giá trị thấp. Phần lớn phát hiện là đọc tay qua `web_fetch` và trình duyệt tích hợp. Muốn REA phân tích thật sangtacviet/truyentrung: mở site bằng Chrome trên máy bạn, lưu HAR + file JS, rồi chạy `npx -y rea-agents@6.7.0 analyze-javascript-application <thư mục JS> --json`.

## 2. Đã triển khai (4 nhóm bạn chọn)

**Lượt đọc thật + BXH Ngày/Tuần/Tháng.** Reader xin token khi mở chương (`POST /api/novels/:slug/read-start`, không ghi D1). Token ký HMAC-SHA256 gồm slug, chương, thời điểm phát, nonce. Chỉ sau ≥ 30 giây tab hiển thị và cuộn ≥ 80% chương, client mới gửi `POST /view` kèm token; server kiểm chữ ký, tuổi token (25 giây – 6 giờ), dùng-một-lần, 1 lượt/IP/chương/10 phút, 1 lượt/IP/truyện/phút, trần 300 lượt/IP/ngày, `read-start` 20/phút/IP. Mỗi lượt thật = 2 dòng ghi (tổng `novels.views` + bảng mới `novel_views_daily` theo ngày giờ VN). `GET /api/rankings/views?period=day|week|month` (edge 15 phút) cấp dữ liệu cho khối "Đọc nhiều" ở trang chủ. Chưa đặt secret `VIEW_TOKEN_SECRET` thì giữ nguyên hành vi đếm cũ; cố ý không dùng chung `SYNC_KEY`. EpubReader dùng cùng cơ chế (30 giây, không xét cuộn).

**Góp ý name từ người đọc.** Trong hộp sửa từ tại chỗ có thêm "Gửi góp ý cho mọi người" (cần đăng nhập, kèm chữ Hán gốc tuỳ chọn). Bảng `glossary_suggestions`, tối đa 20 góp ý chờ/người. Trang admin mới `/admin/glossary-suggestions`: lọc, sửa lại cụm đề xuất, xem trước, cảnh báo cụm quá ngắn, duyệt/từ chối. Duyệt = thêm vào `R2 <slug>/replacements.json` (mọi người đọc thấy ngay, không cần dịch lại chương — đúng tinh thần "name chung" của sangtacviet) và, nếu có chữ gốc, ghi luôn vào glossary R2 cho các chương dịch sau (`migrate_to_cloudflare.py` vốn gộp ba chiều glossary nên thay đổi chảy về local). Ghi R2 có điều kiện etag + thử lại để hai admin duyệt song song không đè nhau; glossary ghi trước, quy tắc công khai sau. Server chặn ký tự markdown/HTML và cụm gốc dưới 2 ký tự vì quy tắc công khai được chèn vào nội dung của mọi người đọc. Người đọc xem trạng thái góp ý của mình ở trang Tài khoản.

**Đồng bộ cài đặt đọc.** `GET/PUT /api/user/prefs` (bảng `user_prefs`, 1 dòng/người, ≤ 48 KB, chỉ nhận khoá `v`, `reader`, `replacements`, chống request cũ ghi đè và kẹp mốc thời gian client ≤ giờ server + 5 phút). Client kéo một lần khi khởi động, đẩy sau 3 giây kể từ thay đổi cuối, bỏ qua nếu không đổi gì, có tín hiệu xoá để quy tắc đã xoá ở máy này không "sống lại" từ máy khác. `ttsVoice` không đồng bộ vì phụ thuộc máy.

**Gói nhanh Reader + SEO.** Chấm sao trên trang truyện (backend đã có; API chi tiết truyện giờ trả `rating`/`rating_count` thật). Tiến độ tới từng đoạn văn: local mỗi giây; server chỉ khi ẩn tab/rời trang/rời truyện hoặc ≥ 60 giây và lệch ≥ 10 đoạn (position dạng `12#p34`, client cũ vẫn gửi `12`). Script trong `index.html` đặt màu nền theo theme Reader trước khi JS tải (hết nháy nền tối). JSON-LD `Book` (kèm `aggregateRating` thật) + `BreadcrumbList` cho trang truyện, title/canonical/breadcrumb riêng cho trang chương dạng số (`/read/12`), `WebSite + SearchAction` tĩnh; trang chủ đọc `?q=` để SearchAction hợp lệ. Mọi chuỗi trong JSON-LD được escape `<`, U+2028, U+2029.

## 3. Kiểm chứng

Tất cả chạy thật trong sandbox Linux (bản sao `npm ci` riêng, không đụng node_modules macOS):

| Bộ | Kết quả |
|---|---|
| Worker (`node --test tests/worker/*.test.mjs`, miniflare) | 113/113 (12 test mới ở `engagement.test.mjs`) |
| Frontend (`node --test frontend/tests/*.test.mjs`) | 109/109 (thêm `engagement.test.mjs`, `reader-engagement.test.mjs`) |
| Python (`pytest -q`) | 476/476 |
| `eslint . --max-warnings 0` | sạch |
| `vite build` | OK |

Một agent review độc lập (chỉ đọc) tìm ra 12 vấn đề, trong đó 3 mức Cao (lượt đọc vẫn bơm được qua nhiều chương, nonce làm đầy bộ đếm rate limit dùng chung, tiến độ đoạn ghi D1 4 giây/lần). Cả 12 đã được sửa và có test, trừ phần "tính lại `novels.views` bằng cron" (không làm, chấp nhận 2 dòng ghi/lượt).

Chưa kiểm chứng: chưa thử trên trình duyệt/điện thoại thật (đếm 30 giây, cuộn tới đoạn, nền khi mở Reader); chưa chạy migration 015 trên D1 thật; giới hạn chống bơm lượt đọc là theo isolate (best-effort), không phải giới hạn cứng.

## 4. Việc bạn cần làm để lên production

1. Review + merge nhánh `feature/competitor-learnings` vào `dev`/`main` và push.
2. `npx wrangler secret put VIEW_TOKEN_SECRET` (chuỗi ngẫu nhiên ≥ 32 ký tự). Bỏ qua bước này thì lượt đọc vẫn đếm kiểu cũ, BXH theo kỳ vẫn có dữ liệu.
3. `npx wrangler d1 execute hacdao-db --file=migrations/015_reader_engagement.sql --remote` — chỉ tạo bảng rỗng, vài dòng ghi. Nhắc lại: migration 013, 014 cũng đang chờ chạy remote theo WORKLOG. Worker chịu được việc migration chưa chạy (route mới trả 503/rỗng, route cũ không đổi).
4. `npm run deploy` từ `main` sạch.

## 5. Chấm điểm độ hoàn thiện đợt này

| Hạng mục | Điểm | Ghi chú |
|---|---|---|
| Nghiên cứu đối thủ | 6/10 | truyentrung tốt; sangtacviet/truyenon bị chặn, REA không chạy được đầy đủ |
| Kiến trúc & tương thích ngược | 9/10 | Không đổi route cũ; chạy được trước/sau migration; client cũ vẫn hoạt động |
| Bảo mật | 8.5/10 | Token HMAC, chặn markdown/HTML trong quy tắc công khai, escape JSON-LD, admin check; chống bơm chỉ best-effort |
| Chi phí D1/R2 | 8/10 | Lượt đọc 2 dòng ghi nhưng có trần/IP; tiến độ đoạn đã giảm mạnh; BXH cache edge |
| UX | 8/10 | Đủ luồng; chưa thử trên máy thật |
| Độ tin cậy đã verify | 8.5/10 | 698 test xanh + review độc lập; thiếu test trình duyệt |
| **Tổng** | **8.0/10** | |

Để đạt 10: chạy thử trên điện thoại thật; lấy HAR sangtacviet để REA phân tích cơ chế name thật; chuyển chống bơm lượt đọc sang Durable Object/Rate Limiting binding riêng; cân nhắc TTS server (edge-tts trên backend Python, cache R2) và mô hình "một truyện nhiều bản dịch" — hai bài học lớn còn lại từ truyentrung.
