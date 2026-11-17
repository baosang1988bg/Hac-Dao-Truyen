# Báo cáo: nâng cấp mobile, animation và Nhật ký cập nhật (2026-10-21)

## Quy trình đã theo

Đầu phiên tôi đọc `.agents/AGENTS.md`, 20 dòng cuối `WORKLOG.md` và chạy baseline. `git pull --rebase` thất bại vì sandbox không có SSH key, nên local `main` vẫn ahead 3 / behind 4 so với `origin/main` (4 commit phía origin chỉ là commit tự động `auto(translate)`/`auto(sync)`). Hai agent khảo sát song song (frontend mobile/animation; dữ liệu cho feed trên Worker + D1), sau đó người dùng chốt bốn lựa chọn: feed công khai cho độc giả dựa trên dữ liệu D1 sẵn có, nâng cấp mobile toàn bộ các trang guest, animation bằng CSS thuần + View Transitions (không thêm thư viện), commit local để người dùng tự push/deploy.

Phần nền (hệ thống chuyển động, khung header/tab bar) và toàn bộ tính năng feed do tôi làm trực tiếp. Sau đó ba agent chạy song song, mỗi agent sở hữu một nhóm file tách biệt và một file CSS riêng để không giẫm lên nhau: trang chủ (`styles/home.css`), trang truyện + Reader (`styles/novel-reader.css`), tủ truyện + EPUB + tài khoản + Modal (`styles/library-epub.css`). Cuối cùng một agent reviewer độc lập đọc toàn bộ diff và tôi đã sửa các vấn đề nó nêu.

## Việc đã làm

**Nhật ký cập nhật.** Worker có route mới `GET /api/updates`: gom các chương lên site trong 7 ngày theo từng truyện và từng ngày giờ Việt Nam, trả về khoảng chương, số chương, tiêu đề chương mới nhất, thời điểm và cờ "Truyện mới" (lô bắt đầu đúng từ chương 1). Nguồn sự thật là `chapters.created_at`, vốn chỉ được đóng dấu một lần khi chương được chèn vào D1, nên không cần bảng log và không phát sinh thêm lượt ghi nào ngoài một index mới (`migrations/013_idx_chapters_created.sql`). Phản hồi được cache edge 5 phút, truyện bị gỡ bị loại khỏi feed và takedown sẽ purge luôn `/api/updates`. Phía frontend có trang `/cap-nhat` dạng timeline theo ngày (Hôm nay / Hôm qua / Thứ…), bộ lọc Tất cả / Đang đọc / Truyện mới, ô lọc theo tên, nút làm mới. Tab "Mới" trên bottom tab bar hiện chấm đỏ khi có chương mới chưa xem. Widget "Chương mới lên" ở trang chủ thay cho `AnnouncementsSection` cũ (đọc `announcements.json` tĩnh, chỉ đổi sau mỗi lần deploy). `/cap-nhat` được thêm vào sitemap.

**Animation.** `styles/motion.css` định nghĩa token thời lượng/easing, keyframes, lớp `.hd-reveal` (hiện dần khi cuộn tới, so le qua `--i`), `.hd-stagger`, `.hd-press`, animation modal/bottom sheet, chấm "live" và cấu hình View Transitions. `utils/motion.js` theo dõi phần tử `.hd-reveal` bằng IntersectionObserver + MutationObserver, và có `withViewTransition()` cho các thao tác đổi tab/bộ lọc/đảo thứ tự. Chuyển trang mờ dần (chỉ opacity, để không "nhốt" modal `position:fixed`). Mọi hiệu ứng tắt khi bật "Giảm chuyển động".

**Mobile.** Header giờ sticky, tự ẩn khi cuộn xuống và hiện khi cuộn lên, có nút tìm kiếm (đưa về trang chủ và focus ô tìm kiếm) và lối vào quản trị cho admin. Bottom tab bar có chỉ báo dạng viên thuốc nở ra khi chọn. Đã sửa lỗi đáy trang trống gấp đôi, nút cuộn-lên bị tab bar che, các biến CSS chưa từng được định nghĩa (`--glass-bg`, `--border`, `--border-color`) và `100vh` → `100dvh`. Trang chủ trên mobile được sắp xếp lại để nội dung cá nhân và chương mới lên gần đầu, bảng cập nhật thành danh sách thẻ. Trang truyện có thanh "Đọc tiếp" dính đáy và danh sách chương dễ chạm hơn. Reader bỏ thẻ `<style>` nội tuyến, thay hai vùng chạm `fixed` phủ lên chữ bằng xử lý chạm ngắn ở cấp document (không lật nhầm khi cuộn hay bôi đen). Modal có animation vào/ra và khoá cuộn nền. Tủ truyện, Kho EPUB, tài khoản và đăng nhập được làm lại cho mobile (input ≥16px để iOS không zoom, nút ≥44–48px).

## Cách verify và kết quả

Worker: 88 test (82 cũ + 5 test D1 thật qua Miniflare cho `/api/updates`, gồm kiểm tra query plan dùng đúng `idx_chapters_created`, + 1 assertion sitemap) đều xanh ở lần chạy gần nhất. Frontend: 48/48 test `node --test` (thêm 13 test cho `updatesFeed`, `motion`, `nextHiddenState`). `tests/test_schema.py` và `tests/test_migrate_schema.py` 17/17 xanh. `vite build` thành công, `eslint --max-warnings 0` sạch. Mỗi agent cũng tự build/lint/test trong thư mục build riêng.

Giới hạn quan trọng: giữa phiên, sandbox hết dung lượng đĩa và shell không khởi động lại được. Các sửa theo review dưới đây được làm SAU lần chạy test cuối cùng, nên **chưa được build/test lại**: cờ "Truyện mới" bỏ qua chương số 0 (kèm 1 test mới), purge `/api/updates` khi takedown, `flushSync` cho bộ lọc feed, mốc "đã xem" theo bản feed vừa làm mới, `unobserve` phần tử bị tháo khỏi DOM, `min-height` cố định cho `.guest-main`, `overflow-x: clip` cho `.reader-root` (để thanh nav sticky dính đúng), animation đóng của sheet cài đặt Reader và nút ✕ dùng `requestClose`. Tôi cũng không chụp được màn hình trình duyệt thật (không tải được Chromium), nên chưa có kiểm tra bằng mắt.

## Việc người dùng cần làm

Chạy trên máy Mac, tại thư mục repo:

```bash
npm run test:worker && npm run test:frontend && npm run lint && npm run build --prefix frontend
git add -A frontend/src frontend/tests src/index.js tests/worker .agents/WORKLOG.md plans/BAO_CAO_MOBILE_ANIMATION_FEED_2026-10-21.md
git diff --cached --name-only   # kiểm tra không lẫn file lạ
git commit -m "feat(ui): mobile + animation cac trang guest, sua sau review"
git pull --rebase && git push
npx wrangler d1 execute hacdao-db --file=migrations/013_idx_chapters_created.sql --remote
npm run deploy
```

Nên chạy migration 013 trước khi deploy. Không có index, feed vẫn chạy đúng nhưng mỗi lần cache hết hạn sẽ quét toàn bảng `chapters`, tốn rows_read của D1. Sau khi deploy, hãy mở thử trên điện thoại: trang chủ, `/cap-nhat`, một trang truyện, Reader (chạm hai mép để lật chương, bôi đen chữ, mở/đóng cài đặt), Tủ truyện, Kho EPUB.

## Giới hạn còn lại

Nếu bật `ENABLE_DRIVE_CACHE_WRITES` (mặc định tắt), chương cũ được tự ghi cache từ Drive khi có người đọc cũng mang `created_at` mới và sẽ hiện trong feed. Muốn phân biệt cần thêm cột nguồn cho chương. Trang chủ chọn bố cục bằng `matchMedia`, nên khi xoay iPad qua mốc 1024px các section được mount lại (mất tab đang chọn của "Tất cả truyện", thể loại đã chọn vẫn giữ). `styles/home.css` nạp cùng trang chủ (eager), nên vài rule chung như `.novel-grid__card` cũng áp dụng ở trang khác. Lời gọi `focus()` sau khi điều hướng có thể không bật bàn phím trên iOS. Tổng số trong ô thống kê của feed có thể thiếu nếu chạm trần 80 nhóm; khi đó trang ghi chú rõ.

## Chấm điểm độ hoàn thiện

| Hạng mục | Điểm | Ghi chú |
|---|---|---|
| Kiến trúc | 8.5/10 | Feed không thêm bảng hay lượt ghi; CSS tách theo khu vực; còn trùng lặp nhỏ giữa index.css và file mới |
| UX mobile | 8.5/10 | Khung, trang chủ, trang truyện, Reader, tủ truyện, EPUB đều được làm lại; chưa thử trên máy thật |
| Animation | 8.5/10 | Hệ thống thống nhất, tôn trọng reduced-motion, không thêm thư viện; View Transitions chỉ dùng trong trang |
| Tính năng feed | 9/10 | Dữ liệu thật, cache, lọc, chấm báo; giới hạn Drive cache đã nêu |
| Hiệu năng | 8.5/10 | Không thêm dependency; feed dùng chung 1 request; cần migration 013 để rẻ rows_read |
| Độ tin cậy đã verify | 6.5/10 | Test/build/lint xanh trước đợt sửa cuối; đợt sửa cuối và giao diện thật chưa verify |
| **Tổng** | **8.2/10** | |

Để đạt điểm tối đa, cần: chạy lại toàn bộ test/build sau đợt sửa cuối, thử trên iOS và Android thật (nhất là cử chỉ lật chương và header tự ẩn), giữ state tab trang chủ khi đổi bố cục, và xoá phần CSS cũ còn trùng trong `index.css`.
