# Báo cáo kiểm tra bảo mật, hiệu năng & hiện trạng — HacDaoTruyen
*Ngày kiểm tra: 08/08/2026 — phạm vi: các commit gần nhất trên nhánh main (từ `12d787d` đến `7aeb45d`, tập trung vào tính năng EPUB catalog, đồng bộ Cloudflare, và Worker sản xuất `src/index.js`)*

## Phạm vi và phương pháp

Repo hiện chạy song song hai backend: FastAPI cục bộ (`api.py` + `routers/`, dùng cho việc dịch và quản trị) và Cloudflare Worker (`src/index.js`, dùng D1 + R2, phục vụ trang web thật cho người đọc). Các commit gần nhất chủ yếu thêm tính năng đọc EPUB (`tools/epub_to_chapters.py`), khử trùng lặp chương (`tools/dedupe_chapters.py`), và đồng bộ hai chiều với Cloudflare (`migrate_to_cloudflare.py`, `restore_from_cloudflare.py`). Ba hướng audit được chạy song song rồi hợp nhất: (1) backend Python và các script mới, (2) Worker sản xuất, (3) toàn bộ pipeline crawl — dịch — upload — download — reload. Đây là audit đọc mã tĩnh, không có môi trường chạy thật để kiểm thử xâm nhập hay đo tải thực tế, nên các con số về hiệu năng là ước lượng từ cấu trúc code, không phải benchmark.

## 1. Bảo mật

Bộ khung bảo mật cũ (auth constant-time, whitelist field công khai, CORS giới hạn, khóa race condition, `validate_slug`/`safe_join`/`validate_source_url`) vẫn nguyên vẹn ở phần FastAPI đã audit trước đây và không bị các commit mới đụng vào theo hướng xấu. Vấn đề nằm ở hai chỗ mới.

Thứ nhất, các script mới xử lý EPUB và đồng bộ Cloudflare không đi qua lớp phòng thủ chuẩn của dự án dù về logic vẫn khá an toàn ở trạng thái hiện tại. `tools/epub_to_chapters.py` và `tools/dedupe_chapters.py` ghép slug từ tham số dòng lệnh thẳng vào đường dẫn `novels/<slug>/...` mà không gọi `validate_slug`/`safe_join`; rủi ro thực tế thấp vì hai script này chỉ chạy CLI nội bộ, chưa được gắn vào endpoint HTTP nào, nhưng nếu sau này ai đó bọc chúng thành API mà quên thêm validate thì lỗ path traversal sẽ mở lại ngay. Nghiêm trọng hơn là `restore_from_cloudflare.py`: hàm `run_command` (dòng 19-30) chạy `subprocess.run(..., shell=True)` với chuỗi lệnh ghép từ `r2_key`/`filename` lấy trực tiếp từ D1, không qua validate; đồng thời dòng 107 và 181 ghép `slug`/`filename` vào đường dẫn ghi file mà không qua `safe_join`. Nếu dữ liệu trong D1 từng bị chèn nội dung độc hại — kể cả qua lỗ nhỏ ở `migrate_to_cloudflare.py:56`, nơi một câu SQL nối `slug` trực tiếp vào chuỗi thay vì escape bằng hàm `q()` như các chỗ khác trong cùng file — thì lúc restore sẽ xảy ra command injection và ghi file ra ngoài thư mục gốc. Đây là chuỗi lỗ hổng "thấp + thấp cộng dồn thành trung bình", nên vá theo đúng nguyên tắc cũ của dự án: escape SQL nhất quán, bỏ `shell=True`, thêm `validate_slug`/`safe_join` ở nơi ghi file.

Thứ hai, và đáng lo hơn, là Worker sản xuất `src/index.js` — nơi thực sự phục vụ người dùng cuối. CORS được set cứng `Access-Control-Allow-Origin: '*'` cho mọi response kể cả các route ghi dữ liệu. Route `POST /api/novels/:slug/glossary` (dòng 551-565) ghi thẳng vào R2 và D1 mà không gọi `isAdminRequest` như các route khác — nghĩa là bất kỳ ai biết endpoint đều có thể ghi đè glossary của bất kỳ truyện nào, đây là lỗ ghi dữ liệu nghiêm trọng nhất phát hiện được trong lần audit này. Hai route `trackView`/`rateNovel` cũng không xác thực và không giới hạn tần suất, nên có thể bị spam để thao túng số liệu. Endpoint `proxyCover` nhận `targetUrl` trực tiếp từ query string rồi `fetch` mà không kiểm tra scheme hay chặn IP nội bộ, tạo nguy cơ SSRF/open-proxy. Cuối cùng, `/api/debug/chapter/:slug/:num` là một route debug lộ `r2_key` và nội dung file nội bộ ra công khai không cần đăng nhập — nên gỡ hẳn trước khi để trong bản chạy thật. Điểm sáng là danh sách field công khai (`NOVEL_PUBLIC_FIELDS`) vẫn lọc đúng, không lộ `source_url`/`glossary` cho khách; nhưng toàn bộ cơ chế `isAdminRequest` lại phụ thuộc vào biến `env.BACKEND_URL` — nếu Worker chạy độc lập không có biến này, mọi request sẽ luôn bị coi là khách kể cả chủ trang thật, nghĩa là tính năng quản trị qua Worker gần như vô hiệu trong một số cấu hình triển khai.

## 2. Tương thích

Flag `compatibility_flags: ["nodejs_compat"]` trong `wrangler.jsonc` hiện không cần thiết vì code Worker chỉ dùng Web API chuẩn (`crypto.subtle`, `fetch`, `URL`) chứ không import module Node nào — không gây lỗi nhưng là cấu hình thừa. CI (`ci.yml`) đã kiểm tra syntax toàn bộ Python, build frontend, và `node --check` cho Worker, cộng thêm bước xác nhận không lộ secret — đây là lưới an toàn tối thiểu hợp lý và đã bao phủ đúng các file mới thêm. Không phát hiện xung đột tương thích runtime nào khác giữa các phần Node (FastAPI/tools) và phần Worker.

## 3. Khả năng chịu tải & cache

Đây là điểm yếu rõ nhất về mặt kỹ thuật của Worker. Hàm `getNovels` không dùng `LIMIT/OFFSET` ở tầng SQL mà tải toàn bộ bảng phù hợp điều kiện vào bộ nhớ rồi mới lọc chữ và cắt trang bằng `.slice()` trong code — cách này sẽ chậm dần khi số truyện tăng lên, và mỗi dòng còn kèm ba truy vấn con trên bảng chương nên chi phí tăng theo cả số truyện lẫn số chương. Danh sách chương (`getChapters`) cũng không phân trang. Về cache, không có response JSON nào (`/api/novels`, `/chapters`, `/synopsis`...) set `Cache-Control` tường minh, nên hành vi cache hoàn toàn phụ thuộc cấu hình zone của Cloudflare — nếu ai đó bật "Cache Everything" ở cấp zone, trang có thể trả dữ liệu cũ khi vừa cập nhật chương mới. Cloudflare Cache API (`caches.default`) chưa được dùng ở bất cứ đâu dù đây là cách giảm tải D1 chuẩn nhất cho Worker. Điểm tích cực: file EPUB và ảnh bìa qua `getEpub`/`proxyCover` được stream trực tiếp từ R2 thay vì load hết vào bộ nhớ, và có set thời hạn cache hợp lý (1-7 ngày) dù chưa có ETag để hỗ trợ điều kiện 304.

## 4. Pipeline: crawl, dịch, upload, download, reload

Khâu **crawl** (`scraper.py`) không chặn SSRF khi nhận URL nguồn, nhưng URL này do người vận hành nhập qua `novel.json`/CLI chứ chưa từng lộ qua API công khai nên rủi ro thực tế thấp; xử lý lỗi mạng, timeout, và cơ chế dự phòng qua Jina Reader khi bị chặn được làm khá kỹ, delay giữa các lần fetch (`SCRAPE_DELAY_SECONDS`) cũng hợp lý.

Khâu **dịch** là phần chắc chắn nhất trong toàn bộ hệ thống: có resume đúng theo tiến độ đã lưu trong `catalog.json`, không dịch lại chương đã xong; `TASKS_LOCK` bảo vệ đầy đủ trạng thái dùng chung; batch size tự điều chỉnh theo từng nhà cung cấp (ép về 1 với DeepSeek, không song song với Ollama) để tránh cắt chữ hoặc tràn token.

Khâu **upload** (lên Google Drive và lên Cloudflare) là nơi thiếu chắc chắn nhất: các file trạng thái (`upload_state.json`, `.sync_state.json`) đều ghi đè trực tiếp bằng `write_text()` mà không dùng kỹ thuật ghi tạm-rồi-đổi-tên (atomic write), và không có cơ chế khóa giữa các tiến trình khác nhau — nếu hai lần đồng bộ chạy chồng nhau hoặc tiến trình bị ngắt giữa lúc ghi, file trạng thái có thể hỏng, và vì code đọc file này có bắt lỗi JSON rồi âm thầm trả về rỗng, toàn bộ lịch sử đã đồng bộ có thể mất mà không có cảnh báo rõ ràng. `migrate_to_cloudflare.py` cũng không tự retry khi lệnh `wrangler` gọi D1/R2 thất bại vì lỗi mạng tạm thời.

Khâu **download** (tool tải EPUB đa luồng) làm khá tốt: mỗi tác vụ tải có try/except riêng nên một luồng lỗi không kéo sập cả nhóm, có kiểm tra tính toàn vẹn file (kích thước tối thiểu, magic bytes, CRC) trước khi đánh dấu bỏ qua ở lần chạy sau. Điểm cần lưu ý là số luồng (`--workers`) không bị giới hạn trần trong code, chỉ khuyến nghị 3-5 trong phần trợ giúp, và cơ chế xoay IP qua Tor/WARP khi bị chặn về bản chất là né giới hạn của server nguồn — nên cân nhắc rủi ro với điều khoản sử dụng của nguồn đó.

Khâu **reload** (khởi động lại sau khi tiến trình bị dừng đột ngột) có hai lớp khác nhau: tiến độ dịch thực tế trên đĩa (file `*_VI.md`) không mất nhờ cơ chế resume, nhưng trạng thái hiển thị trên giao diện (`translation_tasks` trong `state.py`) chỉ tồn tại trong bộ nhớ nên sẽ biến mất khi restart server — tác vụ đang chạy sẽ "im lặng" biến mất khỏi dashboard dù dữ liệu chương vẫn an toàn. Cộng với việc các file trạng thái JSON không ghi atomic như đã nêu ở khâu upload, nguy cơ lớn nhất khi reload là mất lịch sử đồng bộ chứ không phải mất bản dịch.

## Bảng chấm điểm

| Hạng mục | Điểm /10 | Ghi chú |
|---|---|---|
| Bảo mật backend Python + script mới | 7 | Khung cũ vững; lỗ SQL/command injection nhỏ trong migrate/restore Cloudflare cần vá |
| Bảo mật Worker sản xuất | 4 | Glossary ghi không xác thực, CORS mở toàn bộ, debug endpoint public, proxyCover có nguy cơ SSRF |
| Tương thích | 8 | Chỉ có 1 flag cấu hình thừa, CI bao phủ tốt |
| Hiệu năng & khả năng chịu tải | 6 | Không phân trang ở tầng SQL cho danh sách truyện/chương, sẽ lộ rõ khi dữ liệu lớn hơn |
| Cache | 5 | Chưa set Cache-Control cho API JSON, chưa dùng Cache API của Cloudflare |
| Độ tin cậy pipeline (crawl/dịch/upload/download/reload) | 6 | Dịch và download làm tốt; upload/reload state thiếu atomic write và khóa liên-tiến-trình |
| **Độ tin cậy đã verify (audit tĩnh, không chạy thật)** | 5 | Chưa kiểm thử xâm nhập thực tế, chưa đo tải/hiệu năng bằng công cụ, chỉ đọc mã |

**Điểm tổng ước lượng: 5.9/10.**

## Việc cần làm ngay, theo thứ tự ưu tiên

Ưu tiên cao nhất là vá lỗ ghi glossary không xác thực trong `src/index.js` (thêm `isAdminRequest` cho route này) và gỡ hoặc khóa endpoint debug lộ dữ liệu nội bộ, vì đây là Worker đang phục vụ người dùng thật chứ không phải môi trường nội bộ. Tiếp theo là giới hạn CORS về danh sách domain thật thay vì `'*'`, thêm validate cho `proxyCover` (chỉ cho phép http/https, chặn IP nội bộ, kiểm tra Content-Type là ảnh). Về phía Python, nên escape SQL nhất quán và bỏ `shell=True` trong hai script đồng bộ Cloudflare. Về hạ tầng dữ liệu, nên chuyển các file trạng thái JSON (`upload_state.json`, `.sync_state.json`, state dịch) sang ghi atomic (ghi ra file tạm rồi `os.replace`) để tránh hỏng file khi tiến trình bị ngắt giữa chừng. Về hiệu năng, nên thêm `LIMIT/OFFSET` thật ở tầng SQL cho danh sách truyện và chương, đồng thời set `Cache-Control` rõ ràng cho các API JSON và cân nhắc dùng Cache API của Cloudflare để giảm tải D1 khi lượng truy cập tăng.

## Giới hạn của lần kiểm tra này

Đây là audit đọc mã tĩnh trong sandbox, không có quyền chạy Worker thật hay gọi trực tiếp D1/R2 sản xuất, nên các đánh giá về SSRF, CORS, và race condition dựa trên phân tích logic code chứ chưa được xác nhận bằng request thực tế. Phần hiệu năng/tải cũng là suy luận từ cấu trúc truy vấn, không phải số đo benchmark thật. Nên coi báo cáo này là danh sách việc cần vá và xác nhận lại, không phải kết luận cuối cùng đã kiểm thử đầy đủ.
