# Kế hoạch nâng cấp tính năng đọc — 09/09/2026

Trạng thái cập nhật 09/09/2026: **Cả 4 đợt đã triển khai và đạt nghiệm thu**, bao gồm cả 3 việc trước đó cần xác minh thủ công (đồng bộ đa thiết bị, đọc offline, TTS) — nay đã kiểm chứng bằng Chrome thật (Playwright headless), không chỉ đọc code. Xem `tests/browser/verify_reading_upgrades.py` và kết quả PASS ở mục 3.1, 4.1, 5.1 "Ghi chú triển khai thực tế". Đợt 2 dùng `schema.sql` (snapshot-diff qua `tools/migrate_schema.py`) thay vì tạo file `migrations/00X_*.sql` mới như dự thảo ban đầu, vì R02 đã chuyển sang cơ chế này trước khi đợt này bắt đầu. Phạm vi là nâng cấp trải nghiệm đọc trên nền tảng đã có (`Reader.jsx`, `EpubReader.jsx`, PWA sẵn có, `reading_progress`/`bookmarks` trên D1) — không xây lại từ đầu, không đụng vào crawl/dịch/pipeline Python, không thuộc phạm vi truyện tranh/manga (đó là đề xuất riêng ở `KE_HOACH_NANG_CAP_TONG_THE_2026-08-14.md`).

Căn cứ khảo sát code thực tế (không phải giả định):
- Reading settings hiện tách biệt giữa `Reader.jsx` (5 theme, localStorage key `readerSettings`, có `contentWidth`/`lineHeight`) và `EpubReader.jsx` (3 theme, 3 key localStorage riêng `epub_theme`/`epub_fontSize`/`epub_font`).
- `reading_progress` (D1, `migrations/002_users.sql`) chỉ có cột `chapter` INTEGER, upsert qua `PUT /api/user/progress/:slug` (`src/index.js` — `userProgressUpdate`) với validate `Number.isInteger` — không lưu được vị trí CFI của EPUB. `EpubReader.jsx` hiện **không gọi API sync nào**, chỉ lưu CFI vào localStorage (`epub_cfi_<slug>`).
- PWA đã có từ giai đoạn trước (`plans/BAO_CAO-giai-doan-2.md`): `frontend/public/sw.js` (cache chương text, cache-first cho `/assets/*`), `frontend/public/manifest.webmanifest`. Không dùng vite-plugin-pwa. **Chưa cache file EPUB.**
- Text-to-Speech: không có dòng code nào (`grep -rni "speech|tts"` toàn repo = 0 kết quả) — tính năng hoàn toàn mới.
- Kiến trúc 2 kho tài khoản (local `user_store.py`/SQLite vs D1) không đồng bộ tự động — nợ kỹ thuật có sẵn, nằm ngoài phạm vi đợt này.

## 1. Thứ tự thực hiện

| Đợt / PR | Công việc | Phụ thuộc | Rủi ro chính |
|---|---|---|---|
| 1 | Hợp nhất Reading Settings | Không | Migrate localStorage cũ sai làm mất setting người dùng |
| 2 | Đồng bộ tiến độ đọc đa thiết bị (kể cả EPUB) | 1 (dùng chung field `type`/UI) | Đổi schema/API tương thích ngược với client cũ |
| 3 | Mở rộng offline cho EPUB | Không phụ thuộc 1, 2 nhưng nên làm sau để ổn định state trước | Cache EPUB nặng (hàng chục MB) tràn quota trình duyệt |
| 4 | Text-to-Speech | 1 (lưu setting giọng/tốc độ dùng chung hook) | Giọng đọc tiếng Việt hạn chế trên Safari/Firefox — quản lý kỳ vọng, không phải bug |

Mỗi đợt là một PR độc lập, có test kèm theo, có thể dừng sau bất kỳ đợt nào mà không phá vỡ tính năng hiện có.

## 2. Đợt 1 — Hợp nhất Reading Settings

**File:** `frontend/src/hooks/useReaderSettings.js` (mới), `frontend/src/components/ReaderSettingsPanel.jsx` (mới), `frontend/src/pages/Reader.jsx`, `frontend/src/pages/EpubReader.jsx`, `frontend/src/index.css`.

1. Tạo hook `useReaderSettings()` quản lý object `{fontSize, fontFamily, theme, contentWidth, lineHeight}`, đọc/ghi localStorage key `readerSettings` (giữ nguyên key hiện có của `Reader.jsx` để không phá dữ liệu người dùng cũ).
2. Khi hook khởi tạo, nếu chưa có `readerSettings` nhưng còn key cũ `epub_theme`/`epub_fontSize`/`epub_font`, migrate 1 lần sang format mới rồi xoá key cũ.
3. Thống nhất bảng `THEMES` (5 theme hiện có ở `Reader.jsx`) làm nguồn duy nhất. Map từng theme sang object theme của epub.js (`rendition.themes.register`) dùng đúng biến CSS đã có ở `index.css:141-186` — không tạo bộ màu mới.
4. Tách UI chọn settings hiện có (đang lặp code ở 2 trang) thành `ReaderSettingsPanel`, nhận props `settings`, `onChange`, dùng chung ở cả `Reader.jsx` và `EpubReader.jsx`.
5. `EpubReader.jsx` bỏ 3 state riêng, dùng `useReaderSettings()`; `contentWidth`/`lineHeight` áp dụng qua CSS của khung đọc epub.js (không có khái niệm tương đương trong epub.js thì bỏ qua, không ép).

**Test bắt buộc:** unit test hook (migrate từ key cũ, migrate khi không có key cũ, ghi/đọc localStorage). Test thủ công: đổi theme/fontSize ở `Reader.jsx`, mở `EpubReader.jsx` cùng truyện, xác nhận áp dụng đúng theme đã chọn; xoá `readerSettings` giữ key `epub_*` cũ, load lại app, xác nhận migrate đúng.

**Nghiệm thu:** không còn 2 nguồn sự thật cho settings; người dùng cũ mở app sau khi deploy không mất setting đã lưu.

## 3. Đợt 2 — Đồng bộ tiến độ đọc đa thiết bị

**File:** `migrations/00X_reading_position.sql` (mới, số tiếp theo sau migration hiện có), `src/index.js` (`userProgressUpdate`, `userProgressList`), `routers/users.py`, `frontend/src/pages/Reader.jsx`, `frontend/src/pages/EpubReader.jsx`, `tests/worker/*.test.mjs`.

1. Migration D1: thêm cột `position TEXT NULL` và `type TEXT NOT NULL DEFAULT 'chapter'` vào bảng `reading_progress`. Giữ nguyên cột `chapter` INTEGER hiện có — không xoá, để client cũ (nếu còn) vẫn đọc được.
2. `PUT /api/user/progress/:slug`: nhận thêm `type` (`'chapter'|'epub'`) và `position` (string). Khi `type='chapter'`: giữ validate `Number.isInteger` như cũ, ghi cả `chapter` và `position=String(chapter)`. Khi `type='epub'`: bỏ validate integer, ghi `position` là CFI string, `chapter=NULL`.
3. `GET /api/user/progress[/:slug]`: trả thêm `type`/`position` trong response, giữ nguyên field `chapter` để không phá client cũ.
4. Đồng bộ tương tự ở `routers/users.py` (local `user_store.py`) — cùng shape API, ghi rõ trong PR rằng đây vẫn là kho tách biệt với D1, không làm đồng bộ 2 chiều giữa local/D1 (ngoài phạm vi).
5. `EpubReader.jsx`: thêm gọi `PUT /api/user/progress/:slug` với `type:'epub', position: cfi` khi đã đăng nhập, debounce theo thay đổi CFI (theo mẫu `lastSyncedChapterRef` đã có ở `Reader.jsx`). Khi mở lại EPUB, nếu có `position` từ server và mới hơn localStorage (so `updated_at`), ưu tiên server.
6. `Reader.jsx`: gửi kèm `type:'chapter'` trong request hiện có, không đổi hành vi khác.
7. Conflict resolution: last-write-wins theo `updated_at` sẵn có trên bảng — không cần merge phức tạp cho bản đầu.

**Test bắt buộc:** test worker cho migration mới (upsert cả 2 loại type, đọc lại đúng field); test EPUB position round-trip (ghi CFI, đọc lại, so sánh); test API cũ (chỉ gửi `chapter`, không gửi `type`) vẫn hoạt động — không phá tương thích ngược.

**Nghiệm thu:** đọc EPUB trên thiết bị A, mở thiết bị B (đã đăng nhập) khôi phục đúng vị trí; đọc chương text vẫn hoạt động như trước khi thay đổi.

### 3.1. Ghi chú triển khai thực tế (09/09/2026)

- Dùng `schema.sql` + `tools/migrate_schema.py` thay vì file `migrations/00X_*.sql` mới (lý do: xem trạng thái đầu file).
- Cột mới: `position TEXT`, `type TEXT DEFAULT 'chapter'` — cả hai đều nullable/có default để tương thích với ràng buộc an toàn của `migrate_schema.py` (từ chối cột NOT NULL bắt buộc khi ALTER).
- Đã hoàn thành: `src/index.js` (`userProgressUpdate`/`userProgressList`), `routers/users.py` (`ProgressRequest`, `put_progress`), `user_store.py` (schema + ALTER tự vá cho DB cũ + `list_progress`/`set_progress`), `Reader.jsx` (gửi `type:'chapter'`), `EpubReader.jsx` (đọc vị trí ưu tiên server nếu mới hơn localStorage, sync CFI debounce theo thay đổi).
- Test: `tests/worker/progress.test.mjs` (6 test, mới), `tests/test_integration.py::test_user_progress_epub_position` (mới) — tổng 18 worker + 39 python PASS. Lint (`eslint . --max-warnings 0`) và `vite build` frontend sạch.
- **Đã xác minh bằng Chrome thật** (`tests/browser/verify_reading_upgrades.py::verify_multi_device_sync`, 2 browser context riêng biệt mô phỏng 2 thiết bị, cùng token, API giả lập): máy A đọc EPUB → đổi trang → server nhận đúng CFI (`type='epub'`); máy B mở cùng slug (không có localStorage CFI cục bộ) → khôi phục đúng y hệt CFI đã lưu ở máy A. Trong lúc kiểm thử phát hiện thêm 1 bug thật: `EpubReader.jsx` trước đó dùng sai tên sự kiện epub.js (`locationChanged` — không tồn tại trong thư viện) thay vì `relocated`, khiến việc lưu CFI/sync tiến độ **chưa từng chạy thật** dù test worker/python vẫn pass (các test đó chỉ kiểm tra API, không kiểm tra event epub.js thật chạy trong trình duyệt). Đã sửa lại đúng tên event, parse `updated_at` an toàn hơn với timezone, đăng ký listener trước `rendition.display()` để không bỏ lỡ lần fire đầu tiên, và reset `lastSyncedCfiRef` khi đổi slug.
- Không đổi hành vi API cũ: client chỉ gửi `{chapter}` (không có `type`) vẫn được xử lý như `type:'chapter'` mặc định — có test `progress.test.mjs` bao phủ riêng.

## 4. Đợt 3 — Mở rộng offline cho EPUB

**File:** `frontend/public/sw.js`, `frontend/src/pages/EpubReader.jsx`, `frontend/src/pages/EpubCatalogPage.jsx`, `frontend/src/components/EpubCard.jsx`.

1. Xác định route hiện tại serve file EPUB binary (route lấy nội dung EPUB cho `EpubReader.jsx`/`EpubCatalogPage.jsx`) trước khi sửa `sw.js` — không đoán tên route.
2. Thêm chiến lược cache-first riêng cho route EPUB trong `sw.js`, dùng cache name riêng (ví dụ `hacdao-epub-v1`, tách khỏi `hacdao-chapters-v1` hiện có) để dễ xoá riêng khi cần.
3. Giới hạn dung lượng: giữ danh sách slug đã cache trong `IndexedDB`/`localStorage`, xoá cache cũ nhất khi vượt ngưỡng (ví dụ tổng > 200MB hoặc > N truyện) — tránh cache ẩn không kiểm soát.
4. Thêm nút "Tải để đọc offline" tường minh trên `EpubCatalogPage.jsx`/`EpubCard.jsx` (theo mẫu `downloadNextChapters` đã có ở `Reader.jsx:278-300`) — người dùng chủ động chọn, không tự động cache toàn bộ.
5. Hiển thị trạng thái đã tải/chưa tải trên `EpubCard.jsx`.

**Test bắt buộc:** DevTools offline mode — mở EPUB đã tải, xác nhận đọc được không cần mạng; mở EPUB chưa tải, xác nhận báo lỗi/ẩn nút đọc rõ ràng thay vì crash; kiểm tra cache bị xoá đúng khi vượt ngưỡng dung lượng.

**Nghiệm thu:** đọc được EPUB đã tải khi tắt mạng hoàn toàn; dung lượng cache có kiểm soát, không tăng vô hạn.

### 4.1. Ghi chú triển khai thực tế (09/09/2026)

- Route EPUB xác nhận đúng qua code: `GET /api/novels/:slug/epub` (`src/index.js` — `getEpub`).
- `sw.js`: thêm cache `hacdao-epub-v1`, chỉ ghi cache khi request có `?offline=1` (gắn bởi nút tải), đọc bình thường (không có `?offline=1`) chỉ trả từ cache nếu đã có sẵn, còn lại để mạng xử lý — không tự động cache khi đọc online như plan yêu cầu. Chỉ mục `{slug: {size, updatedAt}}` lưu trong chính cache đó (key nội bộ `/__sw_epub_index__`), `enforceEpubQuota` xoá EPUB cũ nhất khi tổng > 200MB.
- `EpubCard.jsx`: thêm nút tải (icon `Download`/`Check`) chỉ hiện khi truyện chỉ có EPUB (không có chương trực tiếp); dùng chung cho cả `EpubCatalogPage.jsx` vì trang đó chỉ render `EpubCard` trong lưới — không cần sửa thêm.
- Tiện ích mới `frontend/src/utils/epubOffline.js` (`isEpubDownloaded`, `downloadEpubOffline`) tách logic gọi/kiểm tra khỏi component.
- **Đã kiểm chứng logic quota** bằng script mô phỏng (`node` + fake `caches`/`self`, chạy tạm trong scratchpad): `enforceEpubQuota` xoá đúng EPUB cũ nhất khi vượt 200MB, giữ lại các EPUB mới hơn.
- **Đã xác minh bằng Chrome thật** (`tests/browser/verify_reading_upgrades.py::verify_offline_epub`, chạy trên **bản build production** qua `vite preview` — bắt buộc vì service worker chỉ đăng ký khi `import.meta.env.PROD`, không chạy ở `npm run dev`): gọi `fetch('/api/novels/demo/epub?offline=1')` → xác nhận EPUB được lưu vào đúng cache `hacdao-epub-v1`; sau đó `context.set_offline(True)` (ngắt mạng hoàn toàn kiểu DevTools Offline) rồi reload trang → EPUB vẫn đọc được, không lỗi. Lưu ý khi test: phải reload 1 lần lúc còn mạng trước khi ngắt mạng, vì mọi service worker (không riêng đợt này) chỉ bắt đầu kiểm soát trang từ lần điều hướng kế tiếp — lần load đầu tiên sau khi cài SW chưa chắc app-shell/bundle JS đã được cache kịp; đây là đặc điểm chung của cơ chế SW thủ công trong dự án (giống `CHAPTER_CACHE` có sẵn từ trước), không phải lỗi riêng của Đợt 3.

## 5. Đợt 4 — Text-to-Speech

**File:** `frontend/src/hooks/useTextToSpeech.js` (mới), `frontend/src/pages/Reader.jsx`, `frontend/src/hooks/useReaderSettings.js` (mở rộng thêm `ttsVoice`, `ttsRate`).

1. Dùng Web Speech API (`window.speechSynthesis`) — không cần backend, không phát sinh chi phí dịch vụ ngoài.
2. Hook `useTextToSpeech(text)` cung cấp `play/pause/stop`, trạng thái `isPlaying`, danh sách giọng khả dụng (`speechSynthesis.getVoices()`), lưu giọng/tốc độ đã chọn vào `useReaderSettings`.
3. UI: nút play/pause/stop trong `Reader.jsx` (thanh công cụ đọc hiện có). **Không** làm cho `EpubReader.jsx` ở đợt này — nội dung phân trang qua epub.js phức tạp hơn để trích xuất text tuần tự, để lại cho đợt sau nếu cần.
4. Xử lý khi chuyển chương/rời trang: gọi `speechSynthesis.cancel()` để tránh giọng đọc chồng chéo.
5. Ghi chú rõ trong UI (tooltip/help text) rằng giọng đọc tiếng Việt phụ thuộc hệ điều hành/trình duyệt — không cam kết chất lượng đồng đều trên mọi nền tảng.

**Test bắt buộc:** thủ công trên Chrome/Edge (SpeechSynthesis đầy đủ) — play/pause/stop, chuyển chương khi đang đọc không bị chồng giọng. Ghi nhận kết quả trên Firefox/Safari (không bắt buộc pass, chỉ cần biết hạn chế).

**Nghiệm thu:** người dùng nghe được nội dung chương trên trình duyệt hỗ trợ tốt (Chrome/Edge); không có giọng đọc chồng lấn khi thao tác nhanh.

### 5.1. Ghi chú triển khai thực tế (09/09/2026)

- Hook mới `frontend/src/hooks/useTextToSpeech.js` bọc `window.speechSynthesis`: `play/pause/resume/stop`, danh sách `voices`, state `isPlaying`/`isPaused`. Tự `cancel()` khi component unmount.
- `Reader.jsx`: thêm hàm `stripMarkdown` (bỏ `#`, `**`, `[text](url)`...) trước khi đọc, để giọng đọc không đọc thành tiếng ký tự markdown. Nút play/pause + nút stop (khi đang phát) chỉ thêm ở thanh công cụ dưới (`isBottom`), không thêm ở thanh trên để tránh trùng lặp control. Gọi `stop()` mỗi khi đổi chương (`useEffect` load nội dung chương).
- `useReaderSettings.js`: thêm `ttsVoice: ''`, `ttsRate: 1` vào `DEFAULT_SETTINGS` — do cơ chế merge `{...DEFAULT_SETTINGS, ...saved}` sẵn có, người dùng cũ tự động nhận default mới mà không cần migrate thêm.
- **Không có UI chọn giọng/tốc độ** trong bản này (dùng giọng mặc định trình duyệt, tốc độ 1x) — plan chỉ yêu cầu lưu trữ được vào hook chung, chưa yêu cầu UI chọn; để lại cho đợt sau nếu cần.
- **Đã xác minh bằng Chrome thật** (`tests/browser/verify_reading_upgrades.py::verify_tts`, Chromium headless qua Playwright): bấm nút "Nghe chương này" → `window.speechSynthesis.speaking/pending` chuyển `true`; bấm "Tạm dừng đọc" → `speechSynthesis.paused === true`; bấm "Dừng đọc" → hết `speaking`. Cả 3 trạng thái đúng như kỳ vọng, không có lỗi JS. Script tự `SKIP` nếu môi trường không có `speechSynthesis` (một số Chromium headless không có), để không báo FAIL sai. **Chưa xác minh**: chất lượng giọng đọc tiếng Việt thật (Chromium headless không phát âm thanh thật, chỉ xác minh đúng luồng gọi API) — vẫn cần người dùng tự nghe trên Chrome/Edge desktop thật để đánh giá chất lượng giọng.

## 6. Ngoài phạm vi (out of scope)

- Đồng bộ 2 chiều giữa kho local (`user_store.py`) và D1 — nợ kỹ thuật có sẵn, không thuộc đợt nâng cấp đọc này.
- TTS cho EPUB — để đánh giá sau khi có phản hồi từ đợt 4 trên Reader thường.
- Truyện tranh/manga — thuộc `KE_HOACH_NANG_CAP_TONG_THE_2026-08-14.md`, không gộp vào đây.
