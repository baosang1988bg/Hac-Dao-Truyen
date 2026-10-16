# Báo cáo nâng cấp HacDaoTruyen — 16/10/2026

## Bối cảnh

Phiên này bắt đầu bằng việc đồng bộ repo về commit mới nhất trên GitHub (`7a96648`, các lượt dịch tự động tới chương 1724 Sớm Đăng Lục), đọc WORKLOG và quy tắc phối hợp, rồi kiểm tra trực tiếp trang hacdaotruyen.com trên Chrome trước khi đụng vào code. Sandbox không push được lên GitHub (thiếu SSH key) và không có quyền `wrangler deploy`, nên toàn bộ thay đổi nằm ở dạng commit local, chưa lên production.

## Hiện trạng production trước khi sửa

Trang chạy ổn định: không có lỗi JavaScript nào từ ứng dụng (chỉ lỗi của extension chặn quảng cáo), API phản hồi trong 6–33 ms. Vấn đề nằm ở chất lượng dữ liệu, nội dung chữ và hiệu năng tải. Khoảng 28.500 truyện EPUB nhập từ audiotruyenfull có tên lấy từ slug nên không dấu ("Cuc Pham Lao Ba"), có trang chi tiết còn in nguyên slug ("cuc-dao-kiem-ton"). Tác giả trống, và mọi truyện đều bị gán thể loại "Tiên Hiệp, Huyền Huyễn, Đô Thị" do crawler cũ lấy nhầm link menu điều hướng. Khối hero trang chủ ghi "TOP 1 HOTTEST NOVEL" bằng tiếng Anh, kèm câu mô tả bịa và nhãn "Nhân Khí Tháng" trong khi thực ra sắp theo tổng lượt xem; lượt xem gần như không tăng vì Reader không ghi nhận. Bảng xếp hạng nguồn Trung in thô "月点击：462859" và sai thứ tự. Mục thống kê ghi "15.551.343 chương đã dịch", nhưng đó là tổng chương nguồn. Về hiệu năng, file JS hash vẫn bị gửi kèm `max-age=0` nên trình duyệt phải hỏi lại mỗi lần, bundle chính 450 KB nạp cả thư viện markdown dù khách chỉ vào trang chủ, trang chi tiết truyện trắng khoảng 2 giây, và mỗi lần đọc chương EPUB thì Worker phải tải và parse lại file `upload_state.json` 15 MB từ R2.

## Việc đã làm

Công việc được chia cho bốn agent chạy song song, mỗi agent giữ một nhóm file riêng để không giẫm chân nhau. Sau đó mình tích hợp, cho chạy smoke test, và cho một agent độc lập review toàn bộ diff.

**Worker (`src/index.js`).**
- File `/assets/*` giờ được cache bất biến một năm. Asset thiếu trả 404 thật thay vì trả nhầm `index.html`.
- Nội dung chương có Cache-Control và được purge khi sync hoặc takedown.
- Chỉ mục Drive được giữ trong bộ nhớ isolate thay vì parse lại 15 MB mỗi request. Slug lạ trả 404 ngay, không gọi Drive.
- Endpoint thể loại tách chuỗi gộp và Việt hoá mã thô; bộ lọc hiểu cả nhãn tiếng Việt lẫn mã thô.
- `/api/novels` có thêm `slugs=` để lấy nhiều truyện trong một request, và `synopsis_short`.
- Chi tiết truyện có cờ `title_is_slug` và lọc dòng ghi công "Epub tạo bởi…".
- `/api/stats` có thêm `translated_chapters` là số chương thật trong D1.
- Lượt xem, đánh giá và bình luận chỉ nhận cho truyện đang công khai. Token độc giả không còn bị chuyển sang backend admin. Proxy backend khớp đúng prefix.
- Worker sinh `robots.txt` và `sitemap.xml`, đồng thời dùng HTMLRewriter chèn title, meta, Open Graph và canonical cho từng trang `/novel/:slug`.
- Thêm migration 012 tạo index `novels(published, updated_at)`.

**Trang chủ và kho EPUB.**
- Bỏ chữ tiếng Anh và đoạn mô tả bịa; khối hero dùng giới thiệu thật, không có thì ẩn.
- Việt hoá nhãn bảng xếp hạng nguồn Trung. Tác giả trống thì ẩn hoặc ghi "Chưa rõ" thay vì "Tác giả".
- Thể loại đi qua `genreLabels` và ẩn chuỗi đang bị gán sai hàng loạt.
- Có lớp cache GET dùng chung, nên số request khi mở trang chủ giảm từ hơn 13 (cộng thêm một request cho mỗi truyện trong mục "Vừa đọc") xuống còn 6.
- Ảnh bìa luôn có lớp nền gradient phía dưới, hết hiện tượng ô bìa trống.
- Truy cập bằng bàn phím và trình đọc màn hình: thêm focus-visible toàn cục, skip-link và ARIA cho tab, sửa tương phản footer.

**Trang đọc.**
- NovelPage, Reader và LibraryPage tải lazy, thư viện tách thành các chunk vendor riêng. JS tải ban đầu giảm từ 450 KB xuống khoảng 313 KB; markdown (118 KB) chỉ tải khi mở trang đọc.
- `index.html` có skeleton tĩnh nên không còn màn hình trắng khi chờ JS.
- NovelPage hiện phần hero ngay, mục lục có skeleton riêng.
- Reader hết render lại toàn bộ chương mỗi lần cuộn. Chương kế được tải trước, phím tắt không còn xung đột với Alt+← của trình duyệt, vị trí cuộn được nhớ, chương lỗi có nút "Thử lại", và có thêm font đọc Literata/Noto Serif hỗ trợ tiếng Việt.
- Lượt xem được ghi một lần mỗi phiên cho mỗi truyện.

**Công cụ dữ liệu.**
- `tools/fix_epub_metadata.py` đọc tên và tác giả thật từ OPF và `info.xhtml` của từng EPUB, rồi sinh câu UPDATE theo lô.
  - Câu UPDATE idempotent, kèm file rollback.
  - Mặc định chỉ chạy thử (dry-run). Ghi thật cần `HACDAO_ALLOW_CLOUD_WRITES` và đi qua cầu chì ngân sách D1, có thể chạy tiếp qua nhiều ngày.
  - Không bao giờ đụng các truyện đang dịch trong `novels/`.
- Đã sửa tận gốc để những lần import sau lấy đúng dữ liệu: `epub_to_chapters`, `batch_epub_processor` và `download_epubs` (thể loại không còn lấy nhầm menu).
- `fetch_rankings` dịch nhãn sang tiếng Việt và sắp lại thứ hạng.
- Đã viết sẵn task cho Antigravity chạy trên máy Windows, nơi có thư viện EPUB.

## Cách verify

Mọi bước đều chạy trên một bản sao Linux có `node_modules` riêng, vì `node_modules` trong repo là bản macOS (rollup/workerd native) nên không chạy được trong sandbox. Kết quả của bốn commit:

| Bộ kiểm tra | Trước | Sau |
|---|---|---|
| Test Worker (Miniflare) | 59/59 | 74/74 |
| Pytest | 358/358 | 414/414 |
| Unit test frontend | 5/5 | 22/22 |
| ESLint (0 warning) | Đạt | Đạt |
| Vite build | Đạt | Đạt |

Mình cũng build thử commit frontend trung gian để chắc từng commit đều build được.

Smoke test Playwright của CI không chạy được vì sandbox thiếu thư viện hệ thống `libxdamage1` và apt bị chặn. Thay vào đó, mình viết smoke test dùng jsdom và Vite SSR loader: render `<App/>` thật ở 8 route (trang chủ, `/epub`, `/library`, truyện có tên thật, truyện có tên là slug, Reader, truyện không tồn tại, tài khoản). API giả lập lại đúng các bất thường đang có trên production, và test kiểm tra không còn chuỗi xấu như "TOP 1 HOTTEST", "月点击", slug thô, "Epub tạo bởi", "Unknown", "NaN" hay "undefined". Lượt chạy đầu bắt được lỗi NovelPage vẫn hiện "Unknown" và thể loại thô; mình đã sửa, và lượt sau cả 8 route đều đạt.

## Review độc lập và phần CHƯA verify

Agent review không thấy lỗi nào làm sập production ngay khi deploy, nhưng chỉ ra ba lỗi nên sửa trước khi deploy:

1. Tab đang mở sẽ trắng trang sau mỗi lần deploy, vì chunk lazy cũ trả 404 mà app không có ErrorBoundary.
2. LRU chứa `chapters.json` của Drive có thể vượt giới hạn 128 MB RAM của Worker.
3. `sitemap.xml` có thể bị lách cache bằng request HEAD hoặc header Authorization, mỗi lượt như vậy đọc 5000 dòng D1.

Ngoài ra có bốn lỗi mức trung bình hoặc nhỏ:
- Chip thể loại dạng slug lọc ra 0 kết quả.
- Token admin có xác suất khoảng 1/4096 bắt đầu bằng `u_` và bị nhận nhầm là độc giả.
- Việc đổi tên cache API trong service worker làm mất mục lục đã lưu để đọc offline.
- Tool metadata không cập nhật được cột có giá trị NULL.

Cả bảy lỗi đã được sửa trong code, kèm 8 test Worker mới (`tests/worker/review-fixes.test.mjs`), 8 test frontend mới (`frontend/tests/chunk-reload-cache.test.mjs`) và 4 test pytest mới. Phía frontend có thêm `lazyWithReload` (tự tải lại trang đúng một lần khi gặp chunk cũ) và `AppErrorBoundary`.

**Cập nhật:** lúc đầu phần sửa này chưa chạy được test vì đĩa sandbox đầy làm shell treo. Sau khi dựng lại môi trường, toàn bộ đã chạy xanh: worker 82/82, frontend 30/30, pytest 418/418, ESLint 0 warning, Vite build đạt, smoke jsdom 8/8 route. Phần sửa đã được commit thành `24fbf6c`.

## Việc bạn cần làm trên Mac

Chạy theo thứ tự sau (repo đang ở nhánh `main`, đi trước `origin/main` 4 commit, cộng thêm các file sửa chưa commit):

```bash
cd ~/Documents/AI00/HacDaoTruyen
npm test                                   # pytest + worker + frontend
npm run lint --prefix frontend && npm run build --prefix frontend
git add -- src/index.js tests/worker frontend/src frontend/public/sw.js frontend/tests \
  tools/fix_epub_metadata.py tests/test_fix_epub_metadata.py plans/BAO_CAO_NANG_CAP_2026-10-16.md .agents/WORKLOG.md
git diff --cached --name-only              # kiểm tra không lẫn file khác
git commit -m "fix: xử lý các điểm review (chunk reload, RAM Drive LRU, sitemap cache, genre, token, sw cache, NULL)"
git pull --rebase && git push
npx wrangler d1 execute hacdao-db --remote --file=migrations/012_idx_novels_published_updated.sql
npm run deploy
```

Sau khi deploy, nhờ mình kiểm tra lại production bằng Chrome:
- Header cache của `/assets/*`.
- `og:title` trên một trang `/novel/...`.
- `/sitemap.xml` và `/robots.txt`.
- Trang chủ không còn chuỗi xấu.

Bước sửa 28.500 tên truyện thì giao cho Antigravity theo file `.agents/tasks/2026-10-16-antigravity-sua-metadata-epub.md`. Quy trình là chạy thử trước, gửi 20 dòng mẫu cho bạn duyệt rồi mới ghi thật. Ước tính khoảng 57.000 lượt ghi D1: với cầu chì hiện tại (6.000/ngày, dùng chung với CI) sẽ mất khoảng 3 tuần, trừ khi bạn duyệt nâng cầu chì.

## Chấm điểm độ hoàn thiện

| Hạng mục | Trước | Sau (khi bản sửa review chạy xanh) | Ghi chú |
|---|---|---|---|
| Kiến trúc | 7,5 | 8,5 | Tách bundle, cache dùng chung, Worker vẫn là một file 2.600 dòng |
| Bảo mật | 7,5 | 8,5 | Siết validate, không forward token độc giả, chống lách cache sitemap |
| UX/UI | 6,5 | 8,5 | Hết nội dung bịa và chữ Trung/Anh, skeleton, Reader mượt, a11y |
| Hiệu năng | 6,5 | 8,5 | Asset immutable, JS ban đầu −30 %, request trang chủ −55 %, hết parse 15 MB/request |
| Chất lượng dữ liệu | 4 | 5 (→ 8,5 sau khi chạy tool) | Tên, tác giả, thể loại của 28k truyện chỉ đúng sau khi Antigravity áp tool |
| SEO | 3 | 7,5 | Có sitemap, robots, meta theo truyện; vẫn là SPA nên bot chỉ thấy nội dung đã chèn |
| Độ tin cậy đã verify | 7 | 7,5 | Bốn commit đã xanh; bản sửa review chưa chạy test |
| **Tổng** | **6,0** | **7,7** | |

Để đạt mức tối đa còn cần:
- Chạy xanh và deploy bản sửa review.
- Áp tool metadata cho 28k truyện.
- Chạy smoke Playwright thật trên CI hoặc máy có Chromium.
- Tách `src/index.js` thành module.
- Thêm UI admin cho takedown (hiện mới có API).
- Xử lý mức dùng R2 25 GB đang vượt gói Free 10 GB.
- Thêm số liệu Core Web Vitals thật (RUM của Cloudflare đã bật) để đo hiệu quả.
