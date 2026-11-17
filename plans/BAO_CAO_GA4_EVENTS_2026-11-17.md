# Báo cáo: Mở rộng event GA4 + đề xuất giữ chân người đọc

Ngày: 2026-11-17 · Nhánh: `dev` · Người thực hiện: claude-cowork@mac · **Không chạm production**

## 1. Bối cảnh và việc đã làm

Trước đợt này, GA4 (`G-V8FYCECLZ8`) đã được gắn nhưng chỉ gửi đúng một loại event là `page_view`. Như vậy chỉ biết người đọc vào trang nào, còn những câu hỏi quan trọng cho việc giữ chân thì chưa trả lời được: họ có đọc hết chương không, bỏ dở ở đoạn nào, có theo dõi truyện không, tìm truyện gì mà không thấy, khối nào trên trang chủ thực sự kéo được người đọc vào, và có quay lại hay không.

Khi rà lại code cũ, tôi phát hiện thêm **một lỗi âm thầm**: `AnalyticsTracker` là component con của `App`, nên effect của nó chạy trước effect `initAnalytics()` của `App`. Ở lần tải đầu, `window.gtag` chưa tồn tại nên `page_view` của **trang đích (landing page)** bị bỏ mất. Hệ quả là báo cáo landing page và nguồn truy cập theo trang bị lệch. Giờ `initAnalytics()` đã idempotent và được `trackEvent()` tự gọi, nên event phát ra sớm cũng không còn bị mất. Smoke test giả lập trình duyệt đã xác nhận `page_view` nằm trong `dataLayer` ngay sau `config`.

Toàn bộ logic nằm trong `frontend/src/utils/analytics.js`. Các component chỉ gọi `trackEvent(...)` hoặc khai báo `data-track-section` trong JSX. Riêng phần đo đọc chương (`createChapterTracker`) được viết thành logic thuần, nhận đồng hồ và hàm `emit` từ ngoài vào, nên unit-test được mà không cần trình duyệt.

Về quyền riêng tư, theo lựa chọn của anh, tôi không làm banner đồng ý cookie mà tối giản dữ liệu. Cụ thể: không gửi email, tên, nội dung bình luận hay URL người dùng dán vào form yêu cầu truyện (chỉ gửi tên miền). `user_id` là SHA-256 của `hacdao:<id>` cắt 32 ký tự hex. Site tôn trọng Do-Not-Track và Global Privacy Control, có `setAnalyticsOptOut()` để sau này gắn nút "Tắt thống kê", và tắt Google Signals cũng như cá nhân hoá quảng cáo. Admin vẫn được đo, để còn dùng DebugView, nhưng mọi event của admin đều gắn `traffic_type=internal`.

## 2. Tracking plan

| Event | Khi nào bắn | Tham số chính | Câu hỏi trả lời được |
|---|---|---|---|
| `page_view` | Đổi route SPA (đã có, nay không mất trang đích) | `page_type` (home/novel/reader/…) | Phễu trang → trang |
| `chapter_start` | Nội dung chương hiển thị | `novel_slug`, `novel_title`, `chapter_number`, `content_type` | Truyện/chương nào được mở |
| `chapter_progress` | Cuộn qua mốc 25/50/75% (mỗi mốc 1 lần) | + `percent` | Người đọc bỏ dở ở đâu |
| `chapter_complete` ★ | Cuộn ≥ 90% **và** đọc thực ≥ 15s (chỉ tính lúc tab hiển thị) | + `read_time_sec` | Đọc thật hay chỉ lướt; thời gian đọc mỗi chương |
| `chapter_navigate` | Lật chương | `direction`, `method` (button/key/tap) | Tap-zone mobile có được dùng không |
| `reading_milestone` | Đọc xong tổng 1/3/5/10/25/50/100… chương (cộng dồn trên máy) | `chapters_completed` | "Aha moment": sau bao nhiêu chương thì người đọc ở lại |
| `novel_caught_up` | Đọc xong chương **mới nhất** của truyện | `novel_slug` | Ai đang chờ chương mới → đối tượng của thông báo đẩy |
| `novel_follow` ★ / `novel_unfollow` | Theo dõi/bỏ theo dõi thành công | `novel_slug`, `source` | Tỉ lệ theo dõi theo truyện |
| `login_prompt` | Bấm Theo dõi khi chưa đăng nhập | `feature`, `novel_slug` | Phễu muốn theo dõi → đăng ký |
| `sign_up` ★ / `login` / `logout` | Đăng ký/đăng nhập/đăng xuất (GA4 recommended) | `method` (password/google) | Kênh đăng nhập nào hiệu quả |
| `auth_error` | Đăng nhập/đăng ký lỗi | `auth_mode`, `method`, `status` | Form có làm rơi người dùng không |
| `search` | Có kết quả tìm kiếm (debounce 1,5s, chỉ từ khoá cuối) | `search_term`, `search_location`, `results_count`, `has_results` | **Truyện người đọc tìm mà chưa có** |
| `filter_apply` / `load_more` | Kho EPUB lọc/sắp xếp, tải thêm trang | `filter_genre`, `filter_status`, `sort`… | Thể loại được quan tâm |
| `select_content` | Click link truyện/chương trong vùng có `data-track-section` | `section`, `content_type`, `item_id`, `action` (continue_reading/start_reading) | **Khối nào trên trang chủ kéo người đọc vào** |
| `synopsis_expand` | Mở giới thiệu đầy đủ | `novel_slug` | Tín hiệu đang cân nhắc truyện |
| `tts_start` | Bắt đầu nghe đọc | `tts_rate`, `has_custom_voice` | Mức dùng TTS |
| `reader_setting_change` | Đổi theme/font/cỡ chữ… (debounce theo khoá) | `setting`, `setting_value` | Chọn mặc định tốt hơn |
| `offline_download` ★ | Tải 10 chương offline / tải EPUB | `download_type`, `chapter_count` | Nhu cầu đọc offline |
| `epub_open` / `epub_progress` / `epub_load_error` | Mở EPUB, qua mốc 25/50/75/100% trong phiên, lỗi tải | `resumed`, `percent` | Chất lượng trải nghiệm EPUB |
| `comment_post` | Gửi bình luận thành công (chỉ độ dài, không nội dung) | `comment_length` | Mức tương tác cộng đồng |
| `novel_request_submit` | Gửi yêu cầu truyện | `source_domain`, `has_note` | Nguồn truyện được xin nhiều |
| `reader_error` / `exception` | Lỗi tải chương / AppErrorBoundary | `status`, `description` | Lỗi làm rơi người đọc |
| `pwa_install` | Sự kiện `appinstalled` | — | Lượt cài app |

★ = nên đánh dấu là **Key event** trong GA4.

Vùng `data-track-section` đã gắn gồm: 12 khối trang chủ (`home_hero`, `home_recent`, `home_latest`, `home_updates`, `home_rankings`, `home_all`…), `home_search_results`, `novel_action_bar`, `novel_sticky_cta`, `novel_chapter_list`, `library`, `updates_feed`, `epub_catalog` và `account_following`. Muốn đo thêm vùng nào thì chỉ cần thêm attribute này vào JSX, không phải sửa logic.

User properties: `logged_in` (yes/no) và `display_mode` (standalone = đang chạy dạng PWA đã cài).

## 3. Việc anh cần làm trong GA4 Admin (5–10 phút)

Đây là các bước làm bằng tay, code không tự làm được:

1. **Custom definitions → Create custom dimension** (scope Event): `novel_slug`, `novel_title`, `page_type`, `section`, `action`, `method`, `direction`, `search_location`, `download_type`, `setting`, `setting_value`, `content_type`, `source`. Thêm custom **metric** cho `read_time_sec` (đơn vị giây), `percent`, `chapter_number`, `chapters_completed`, `results_count`. Scope User cho `logged_in` và `display_mode`. Nếu không đăng ký thì tham số vẫn được thu, nhưng không hiện trong báo cáo chuẩn.
2. **Events → Mark as key event**: `chapter_complete`, `novel_follow`, `sign_up`, `offline_download`.
3. **Data streams → Configure tag settings → Define internal traffic**, rồi vào **Data filters** và chuyển filter "Internal Traffic" từ *Testing* sang *Active* để loại event của admin.
4. **Data retention → 14 months** (mặc định chỉ 2 tháng, quá ngắn để phân tích cohort).
5. (Nên làm) **BigQuery Links**: export hằng ngày miễn phí, để sau này tự viết SQL retention theo truyện.
6. Kiểm tra bằng cách mở site với `?ga_debug=1` → **Admin → DebugView**.

## 4. Báo cáo / Exploration nên dựng

Có 5 báo cáo nên dựng trước. Thứ nhất là **phễu đọc** (Funnel exploration): `page_view(novel)` → `chapter_start` → `chapter_complete` → `chapter_start` của chương kế, chia theo `novel_title`, cho biết truyện nào giữ được người đọc qua chương 1. Thứ hai là **cohort retention** (Cohort exploration) với điều kiện là `chapter_complete`, so sánh theo `logged_in` và `display_mode`; theo kinh nghiệm chung của ngành, người đã cài PWA hoặc đã theo dõi truyện thường quay lại nhiều hơn hẳn, nhưng con số thật cần lấy từ dữ liệu này. Thứ ba là **hiệu quả khối trang chủ**: `select_content` theo `section`, chia cho số `page_view` trang chủ. Thứ tư là **từ khoá không có kết quả**: `search` với `has_results = no`, sắp theo số lượt, đây là danh sách ưu tiên dịch tiếp. Thứ năm là **điểm bỏ dở**: tỉ lệ `chapter_progress` 25→50→75→complete theo truyện; nếu tụt mạnh ở 25% thì thường là chất lượng bản dịch đầu chương có vấn đề.

## 5. Đề xuất nâng cấp giữ chân (xếp theo tác động dự kiến)

Mỗi đề xuất đều gắn với event đã có, để đo trước và sau khi triển khai.

**(1) Thông báo đẩy khi có chương mới cho truyện đang theo dõi.** Đây là đòn bẩy mạnh nhất với web đọc truyện ra chương đều. Hạ tầng đã có đủ: bookmark, `/api/updates`, service worker. Còn thiếu Web Push (VAPID) ở Worker. Đối tượng chính là những người vừa bắn `novel_caught_up`. Đo bằng cohort retention ngày 7 và ngày 30 của nhóm bật thông báo.

**(2) Màn hình "Bạn đã đọc tới chương mới nhất".** Khi `novel_caught_up`, cuối chương hiện CTA "Theo dõi để biết khi có chương mới" (nếu chưa theo dõi) cùng 3–4 truyện cùng thể loại. Hiện tại người đọc đến cuối thì gặp ngõ cụt. Đo bằng tỉ lệ `novel_caught_up` → `novel_follow` hoặc `select_content`.

**(3) Gợi ý cài PWA đúng thời điểm.** Bắt `beforeinstallprompt` và chỉ hiện gợi ý sau khi `reading_milestone` ≥ 3, không hiện ngay lúc vừa vào. Đo bằng `pwa_install` và retention theo `display_mode`.

**(4) Tìm không thấy → mời yêu cầu truyện.** Khi `search` không có kết quả, hiện nút "Yêu cầu dịch truyện này" mở sẵn `RequestNovelModal`. Đo bằng tỉ lệ `has_results=no` → `novel_request_submit`. Danh sách từ khoá này cũng là roadmap dịch thuật miễn phí.

**(5) Tối ưu phễu đăng ký.** `login_prompt` hiện đẩy thẳng sang `/account`, khiến người đọc mất ngữ cảnh. Nên đổi thành modal nhỏ có nút Google một chạm, kèm lợi ích cụ thể ("đồng bộ tiến độ giữa điện thoại và máy tính"), rồi quay lại đúng trang. Đo bằng `login_prompt` → `sign_up/login`.

**(6) Sắp xếp lại trang chủ theo dữ liệu.** Sau 2–4 tuần, xếp các khối theo tỉ lệ click (`select_content.section`). Khối nào gần như không ai bấm thì thu gọn, để "Đọc tiếp" và "Chương mới lên" lên đầu cho người quay lại.

**(7) Chuỗi ngày đọc / huy hiệu nhẹ.** Dùng bộ đếm `hd_chapters_completed` và mốc `reading_milestone` để hiện tiến độ ("Bạn đã đọc 50 chương") ở trang Tủ truyện. Cách này rẻ, không cần backend.

**(8) Mặc định đọc tốt hơn.** Nếu `reader_setting_change` cho thấy đa số đổi sang theme tối hoặc cỡ chữ lớn hơn ngay lần đầu, đổi luôn giá trị mặc định để người mới không phải chỉnh.

## 6. Cách đã verify

- `node --test frontend/tests/*.test.mjs`: **59/59 pass**, gồm 10 test mới trong `frontend/tests/analytics.test.mjs`. Các test này phủ DNT/GPC/opt-out, chuẩn hoá tham số (giới hạn 100 ký tự và 25 tham số của GA4), phân loại trang, phân tích link, các mốc tiến độ không lặp, lướt nhanh không tính hoàn thành, thời gian tab ẩn không được cộng, và các mốc cộng dồn.
- `eslint . --max-warnings 0`: sạch. `vite build`: OK, bundle chứa `G-V8FYCECLZ8` và các event mới. Hai lệnh này chạy trên bản sao Linux với `npm ci` riêng, vì `node_modules` trong repo là bản build cho macOS.
- Smoke test giả lập `window`/`dataLayer`, chạy với bản sao `analytics.js` có ID giả: xác nhận thứ tự `js → config → set → page_view → event`; `config` giữ boolean thật (`allow_google_signals: false`); DNT=1 thì không tải gì; admin được gắn `traffic_type: internal`; đường dẫn `/admin` không gửi event.
- **Chưa verify trên trình duyệt thật hoặc trong GA4 DebugView.** Sandbox không có trình duyệt và site chưa deploy. Việc còn nợ: sau `npm run deploy`, mở `?ga_debug=1`, đọc 1 chương trên điện thoại và kiểm tra trong DebugView rằng có `chapter_start → chapter_progress → chapter_complete`.
- Không chạy pytest/worker test vì đợt này không chạm backend.

## 7. Giới hạn đã biết

- Google login không phân biệt được tài khoản mới hay cũ (API không trả cờ), nên luôn ghi là `login` với method google. Nếu muốn đếm đúng `sign_up` qua Google, cần Worker trả thêm `created: true`.
- `reading_milestone` đếm theo trình duyệt (localStorage), không theo tài khoản. Đổi máy thì đếm lại.
- Nếu cuộn vượt 90% trước 15 giây, chương sẽ được tính hoàn thành ở lượt kiểm tra 5 giây kế tiếp hoặc khi rời chương. Rời chương bằng cách đóng tab trước khi tới lượt đó thì sẽ không được tính. Đây là lựa chọn có chủ đích (ưu tiên số liệu chặt hơn là đếm dư).
- Người dùng bật DNT/GPC hoặc trình chặn quảng cáo sẽ không được đo. Đây là hành vi mong muốn, nhưng cần nhớ khi đọc số tuyệt đối.

## 8. Chấm điểm độ hoàn thiện

| Hạng mục | Điểm | Ghi chú |
|---|---|---|
| Độ phủ hành vi quan trọng | 9/10 | Đủ phễu đọc, theo dõi, auth, tìm kiếm, EPUB, offline. Chưa đo LibraryPage/Updates ở mức thao tác riêng, chỉ có click vùng |
| Chất lượng dữ liệu | 8.5/10 | Sửa lỗi mất landing page_view, chống đếm lướt, debounce, lọc admin. Còn thiếu cờ sign_up Google |
| Quyền riêng tư | 8.5/10 | Không PII, hash ID, DNT/GPC, tắt Signals. Chưa có nút opt-out trên UI |
| Kiến trúc / bảo trì | 9/10 | Một module, logic thuần test được, gắn vùng bằng data-attribute |
| Độ tin cậy đã verify | 6.5/10 | Unit + smoke + lint + build xanh; **chưa thấy event thật trong DebugView** |
| **Tổng** | **8.3/10** | |

Để đạt điểm tối đa: deploy rồi kiểm tra DebugView; làm 6 bước cấu hình GA4 ở mục 3; Worker trả `created` cho Google login; thêm nút "Tắt thống kê" ở trang Tài khoản; sau 2–4 tuần có dữ liệu thì triển khai đề xuất (1) và (2) ở mục 5.
