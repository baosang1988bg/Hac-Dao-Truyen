# Rules for Novel Scraping & Translation (Workspace: HacDaoTruyen)

## ⚠️ Phối hợp nhiều agent (Claude Code ↔ Antigravity) — ĐỌC TRƯỚC TIÊN

Repo này được sửa song song bởi nhiều agent trên nhiều máy (Claude Code trên
macOS, Antigravity trên Windows) và GitHub Actions. Mỗi bên có working tree
riêng; production (Worker, D1, R2) thì chỉ có MỘT. Quy tắc bắt buộc:

1. **Đầu phiên**: `git pull --rebase` rồi đọc 20 dòng cuối `.agents/WORKLOG.md`
   để biết bên kia vừa làm gì, việc gì đang dở.
2. **Trước khi push**: `git pull --rebase` lại; commit nhỏ theo từng việc,
   không `git push --force`, không commit hộ thay đổi dở của người dùng nếu
   chưa được yêu cầu.
3. **Ghi production chỉ qua GitHub Actions** (đã có concurrency group
   `cloud-sync` nên các lượt không đè nhau):
   - Chương mới cho truyện bật auto_check: `gh workflow run auto_translate_novels.yml`
     (cron cũng tự chạy ~00:07 và ~11:53 giờ VN).
   - Dịch 1 khoảng từ URL bất kỳ: `gh workflow run translate_range.yml -f slug=… -f url=… -f chapters=N`.
   - Công bố chương đã có bản dịch / đẩy lại chương đã sửa:
     `gh workflow run publish_range.yml -f slug=… -f from=… -f to=…`.
   - Chỉ chạy MỘT workflow nhóm `cloud-sync` mỗi lần, chờ xong mới chạy tiếp
     (GitHub chỉ giữ 1 run chờ/nhóm — run chờ cũ bị huỷ).
   Chạy dịch/sync **local** chỉ khi người dùng yêu cầu rõ, và phải pull trước,
   push ngay sau (kể cả `novels/<slug>/translated/` bằng `git add -f`).
4. **Không deploy từ working tree dở dang.** Cập nhật chương là dữ liệu D1/R2,
   KHÔNG cần deploy. Chỉ deploy khi đổi code `src/`/`frontend/`/`wrangler.jsonc`,
   từ bản `main` đã push và sạch: `npm run deploy` (build frontend + wrangler).
   `tools/auto_check_novel.py` mặc định bỏ qua deploy; chỉ deploy khi
   `HACDAO_AUTO_DEPLOY=1` và code sạch, trùng `origin/main`.
5. **Không đẩy catalog nguồn lên R2.** `novels/<slug>/catalog.json` (có `url`)
   là danh sách để crawl, không phải chỉ mục hiển thị; `migrate_to_cloudflare.py`
   đã tự bỏ qua. Không tự `wrangler r2 object put …/catalog.json`.
6. **Sau mọi việc chạm production** (sync, deploy, migration D1, đổi biến
   ngân sách `HACDAO_*`, sửa R2) → thêm 1 dòng vào `.agents/WORKLOG.md`.
7. **Glossary là chuẩn chung**: `novels/<slug>/novel.json` → `glossary`. Không
   đổi mục đã có nếu không có căn cứ (vd đối chiếu bản MTC); sửa thì ghi WORKLOG.

8. **Công cụ nội bộ (private) nằm ở `tools/private/`** — clone từ repo PRIVATE
   `baosang1988bg/hacdao-private-tools` (repo chính ignore thư mục này, KHÔNG
   copy các tool đó vào repo chính vì repo chính đang public):
   - Lần đầu (tại thư mục gốc HacDaoTruyen):
     macOS `gh repo clone baosang1988bg/hacdao-private-tools tools/private`;
     Windows `gh repo clone baosang1988bg/hacdao-private-tools tools\private`;
     rồi `pip install -r tools/private/requirements.txt`.
   - Đầu phiên: `git -C tools/private pull --rebase`. Sửa tool → commit/push
     trong `tools/private` (repo riêng).
   - Gồm `backup_mtc_api.py` (sao lưu MTC) và `decrypt_mtc_backup.py` (giải mã ra
     `plaintext/`); cách dùng xem `tools/private/README.md`. Dữ liệu ra `backups/` (đã ignore).

---

## Handling Paginated Chapters on novel543.com
When scraping chapters from `novel543.com`, keep the following constraints and behaviors in mind:
1. **Cloudflare Blocking & Jina Reader Fallback**: 
   - `novel543.com` frequently blocks normal browser automation (Playwright/Chromium), which automatically triggers a fallback to Jina Reader (`r.jina.ai`).
   - Jina Reader returns clean Markdown text but strips out navigation HTML elements, meaning standard `next` and `prev` link selectors will fail.
2. **Programmatic Pagination URL Suffixes**:
   - Chapters on `novel543.com` are often paginated (indicated by `(1/N)` or `（1/N）` in the title).
   - If Jina Reader fallback is active and `next_url` is not found in the HTML, you must programmatically construct the URLs for subsequent pages:
     - Page 1 base: `.../8096_1477.html`
     - Page 2 constructed: `.../8096_1477_2.html`
     - Page 3 constructed: `.../8096_1477_3.html`
   - **URL Rule**: If the URL already ends with `_\d+_\d+\.html`, replace the last `_\d+` with `_{page_num}`; otherwise, replace `.html` with `_{page_num}.html`.
3. **Clean Chapter Titles**:
   - Always strip the pagination suffix (e.g. `(1/2)`, `(2/2)`) from the chapter title using the regex `\s*[\(\（]\s*\d+\s*/\s*\d+\s*[\)\）]\s*$` before saving the raw content or translating it. This prevents corrupted filenames (e.g., saving as `... 12_VI.md` instead of `..._VI.md`) and ensures they match the clean catalog structure.

---

## Workflow: Kiểm tra và dịch chương mới

Khi người dùng hỏi "có chương mới không?" hoặc tương tự cho bất kỳ bộ truyện nào, luôn thực hiện **toàn bộ quy trình sau trong một lần** mà **không cần hỏi lại**:

1. **Kiểm tra chương mới**: Đọc `last_chapter_number` trong `novel.json` của truyện đó, sau đó fetch trang catalog nguồn (dùng `read_url_content` hoặc Jina Reader) để đếm số chương mới nhất.
2. **Nếu có chương mới**:
   a. Cập nhật `catalog.json` với các entry chương mới. **Phải dùng đúng format đầy đủ**:
      ```json
      {"number": 1483, "title": "Chương 1483", "original_title": "第1483章 新任務", "url": "https://...", "original_chapter_number": 1483}
      ```
      Thiếu field `"number"` sẽ gây lỗi `KeyError: 'number'` khi dịch.
   b. Cập nhật `total_chapters` trong `novel.json` (không thay đổi `last_chapter_number` - pipeline tự cập nhật sau khi dịch).
   c. Ưu tiên: `gh workflow run auto_translate_novels.yml` (truyện có auto_check) hoặc
      `translate_range.yml` rồi chờ xong — CI tự dịch, sync, commit (xem mục Phối hợp).
   d. Chỉ khi người dùng yêu cầu chạy local: `git pull --rebase` →
      `python -u tools/auto_check_novel.py --slug <slug>` → `git add -f novels/<slug>/translated`
      → commit → `git pull --rebase` → push. KHÔNG chạy `wrangler deploy` (chương mới không cần deploy).
   e. Ghi 1 dòng vào `.agents/WORKLOG.md`.

**Lưu ý**: Không dừng lại giữa chừng để hỏi "có muốn dịch không?". Nếu có chương mới thì dịch luôn.

---

## Command Shortcut: /epub-help
Khi người dùng gõ `/epub-help` hoặc hỏi về câu lệnh tải/upload EPUB, luôn hiển thị ngay lập tức 2 câu lệnh chuẩn sau cho cả macOS và Windows:

### 1. Lệnh Tải EPUB (Downloader - 4 luồng + Tor + Auto-Sync):
- **macOS:**
  ```bash
  python3 tools/download_epubs.py \
    --dir ~/Downloads/epub_library \
    --workers 4 \
    --use-tor \
    --resume \
    --item-timeout 40 \
    --delay 0.2
  ```
- **Windows:**
  ```cmd
  python tools\download_epubs.py ^
    --dir D:\epub_library ^
    --workers 4 ^
    --use-tor ^
    --resume ^
    --item-timeout 40 ^
    --delay 0.2
  ```

### 2. Lệnh Upload Lên Google Drive (Uploader):
- **macOS:**
  ```bash
  python3 tools/gdrive_upload.py \
    --epub-dir ~/Downloads/epub_library \
    --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV
  ```
- **Windows:**
  ```cmd
  python tools\gdrive_upload.py ^
    --epub-dir D:\epub_library ^
    --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV
  ```

---

## Command Shortcut: /update-help (Tự Động Cập Nhật Chương Mới)
Khi người dùng gõ `/update-help` hoặc hỏi về cách quản lý danh sách auto-check / cập nhật chương mới, hiển thị các lệnh:

1. **Cập nhật tất cả truyện trong danh sách:**
   ```cmd
   python -u tools/manage_auto_check.py run
   ```
2. **Cập nhật 1 truyện cụ thể:**
   ```cmd
   python -u tools/manage_auto_check.py run --slug <slug>
   ```
3. **Xem danh sách truyện đang theo dõi:**
   ```cmd
   python -u tools/manage_auto_check.py list
   ```
4. **Thêm truyện vào danh sách theo dõi:**
   ```cmd
   python -u tools/manage_auto_check.py add <slug> [--url <source_index_url>]
   ```
5. **Hủy theo dõi một truyện:**
   ```cmd
   python -u tools/manage_auto_check.py remove <slug>
   ```

---

## Quy tắc Tiêu đề Truyện & Báo Cáo Tiến Trình Deploy
1. **Luôn giữ tên truyện là Tiếng Việt**:
   - Trường `"title"` trong `novel.json`, thông báo `announcements.json`, và cơ sở dữ liệu D1 **bắt buộc luôn luôn là Tiếng Việt**.
   - Tên gốc tiếng Trung chỉ được lưu tại trường `"original_title"`. Tuyệt đối không ghi đè `"title"` thành tiếng Trung trong bất kỳ công cụ hay tác vụ crawl nào.
2. **Minh bạch Thời gian & Tiến trình**:
   - Khi có chương mới, pipeline phải tự động cập nhật trường `"last_updated_at"` (`YYYY-MM-DD HH:MM:SS`) vào `novel.json`.
   - In báo cáo các mốc thời gian (check, dịch, sync D1/R2, tổng thời lượng). Deploy Cloudflare
     KHÔNG chạy kèm cập nhật chương (xem mục Phối hợp, quy tắc 4) — báo cáo ghi "bỏ qua deploy".

