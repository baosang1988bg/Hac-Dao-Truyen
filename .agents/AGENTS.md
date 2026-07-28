# Rules for Novel Scraping & Translation (Workspace: HacDaoTruyen)

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
   c. Chạy: `python -u main.py translate --novel <slug> --chapters <N>` (N = số chương mới).
   d. Sau khi dịch xong, chạy sync: `python -u migrate_to_cloudflare.py --slug <slug> --from-chapter <first_new_chapter>`.
   e. Deploy: `cmd.exe /c "npx.cmd wrangler deploy"`.

**Lưu ý**: Không dừng lại giữa chừng để hỏi "có muốn dịch không?". Nếu có chương mới thì dịch luôn.

---

## Command Shortcut: /epub-help
Khi người dùng gõ `/epub-help` hoặc hỏi về câu lệnh tải/upload EPUB, luôn hiển thị ngay lập tức 2 câu lệnh chuẩn sau cho cả macOS và Windows:

### 1. Lệnh Tải EPUB (Downloader - 4 luồng + Tor + Auto-Sync):
- **macOS:**
  ```bash
  python3 tools/download_epubs.py --dir ~/Downloads/epub_library --workers 4 --use-tor --resume --item-timeout 40 --delay 0.2
  ```
- **Windows:**
  ```cmd
  python tools\download_epubs.py --dir D:\epub_library --workers 4 --use-tor --resume --item-timeout 40 --delay 0.2
  ```

### 2. Lệnh Upload Lên Google Drive (Uploader):
- **macOS:**
  ```bash
  python3 tools/gdrive_upload.py --epub-dir ~/Downloads/epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV
  ```
- **Windows:**
  ```cmd
  python tools\gdrive_upload.py --epub-dir D:\epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV
  ```
