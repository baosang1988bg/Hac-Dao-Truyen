# Plan 01: Quick Overview + EPUB-to-JSON + Chapter Splitter

> **Gọi nhanh:** `python tools/get-md-plan-01.py`  
> **Trạng thái:** ✅ Đã triển khai tại môi trường chính (2026-08-01)  
> **Repo:** baosang1988bg/Hac-Dao-Truyen

---

## Mục tiêu

| # | Tính năng | Mô tả |
|---|-----------|-------|
| 1 | **Quick Overview** | Hiển thị tóm tắt/giới thiệu truyện (synopsis) trên trang NovelPage mà không cần tải EPUB |
| 2 | **EPUB → Chapters** | Trích xuất từng chương từ EPUB thành file Markdown để đọc online qua Reader |
| 3 | **Synopsis Sync** | Đồng bộ synopsis lên Cloudflare D1 + R2 theo pipeline hiện tại |

---

## Kiến trúc

```
EPUB file (novels/<slug>/book.epub hoặc Google Drive / R2)
        │
        ▼
[tools/epub_to_chapters.py]          ← Python CLI (MỚI)
        │  - Dùng ebooklib để parse EPUB
        │  - Phát hiện synopsis (item ngắn đầu spine)
        │  - Chuyển HTML → Markdown (không cần beautifulsoup)
        │
        ├──► novels/<slug>/synopsis.md
        └──► novels/<slug>/translated/<num>_<slug>_VI.md
                        │
                        ▼
        [migrate_to_cloudflare.py --synopsis]    ← Flag MỚI
                        │
                        ├──► D1: novels.synopsis (2000 ký tự)
                        └──► R2: <slug>/synopsis.md
                                        │
                                        ▼
                [Cloudflare Worker src/index.js]
                        │
                        ├── GET /api/novels/:slug
                        │        └─ trả synopsis (500 ký tự) + has_more_synopsis
                        └── GET /api/novels/:slug/synopsis   ← Route MỚI
                                        │
                                        ▼
                        [Frontend SynopsisPanel.jsx]     ← Component MỚI
                                - 5-line clamp + gradient fade
                                - Lazy load full synopsis khi click "Xem thêm"
```

---

## Checklist Triển Khai (Theo Thứ Tự)

### Bước 1 — Cài dependency Python

```bash
pip install ebooklib
```

### Bước 2 — D1 Migration (chạy 1 lần)

```bash
npx wrangler d1 execute hacdao-db --command="ALTER TABLE novels ADD COLUMN synopsis TEXT DEFAULT ''" --remote
```

> ⚠️ Nếu column đã tồn tại sẽ báo lỗi "duplicate column" — bỏ qua, tiếp tục.

### Bước 3 — Trích synopsis từ EPUB

```bash
# Cho 1 bộ cụ thể
python tools/epub_to_chapters.py --slug <slug> --synopsis-only

# Với file EPUB ở đường dẫn tùy chỉnh
python tools/epub_to_chapters.py --slug <slug> --epub-path D:/epub_library/epubs/<file>.epub --synopsis-only

# Dry run (xem trước không ghi file)
python tools/epub_to_chapters.py --slug <slug> --synopsis-only --dry-run
```

> Kết quả: tạo file `novels/<slug>/synopsis.md`

### Bước 4 — Tách chương từ EPUB (tuỳ chọn)

```bash
# Chỉ tách chương (không ghi đè bản dịch đã có)
python tools/epub_to_chapters.py --slug <slug> --chapters-only

# Ghi đè tất cả
python tools/epub_to_chapters.py --slug <slug> --chapters-only --overwrite

# Tách ra thư mục khác
python tools/epub_to_chapters.py --slug <slug> --chapters-only --out-dir D:/chapters/<slug>
```

### Bước 5 — Sync synopsis lên D1 + R2

```bash
# Sync synopsis cho 1 bộ
python migrate_to_cloudflare.py --slug <slug> --synopsis

# Sync synopsis cho tất cả bộ đã có synopsis.md
python migrate_to_cloudflare.py --synopsis

# Dry run
python migrate_to_cloudflare.py --slug <slug> --synopsis --dry-run
```

### Bước 6 — Sync chương lên R2/D1 (nếu đã tách chương ở Bước 4)

```bash
python migrate_to_cloudflare.py --slug <slug>
```

### Bước 7 — Build + Deploy Frontend

```bash
# Windows
cmd.exe /c "npm run build" && npx.cmd wrangler deploy

# macOS/Linux
npm run build && npx wrangler deploy
```

---

## Files đã tạo / sửa

| File | Loại | Mô tả |
|------|------|-------|
| `tools/epub_to_chapters.py` | **MỚI** | CLI parser: EPUB → synopsis + Markdown chapters |
| `schema.sql` | **SỬA** | Thêm column `synopsis TEXT DEFAULT ''` vào bảng `novels` |
| `src/index.js` | **SỬA** | Route mới `/synopsis`, handler `getSynopsis`, synopsis trong `getNovel` |
| `migrate_to_cloudflare.py` | **SỬA** | Hàm `migrate_synopsis`, flag `--synopsis`, auto-sync trong `migrate_novel` |
| `frontend/src/components/SynopsisPanel.jsx` | **MỚI** | Component hiển thị synopsis với clamp + lazy load |
| `frontend/src/pages/NovelPage.jsx` | **SỬA** | Import và render `SynopsisPanel` sau Hero section |

---

## API Reference

### GET `/api/novels/:slug`
Trả về field `synopsis` (500 ký tự đầu) và `has_more_synopsis` (bool).

```json
{
  "slug": "xich-tam-tuan-thien",
  "title": "...",
  "synopsis": "Đây là phần giới thiệu ngắn...",
  "has_more_synopsis": true,
  ...
}
```

### GET `/api/novels/:slug/synopsis`
Trả về full synopsis text (lazy load từ D1, fallback R2).

```json
{
  "slug": "xich-tam-tuan-thien",
  "synopsis": "Nội dung giới thiệu đầy đủ...\n\nĐoạn 2...",
  "source": "d1"
}
```

---

## D1 Schema (sau migration)

```sql
CREATE TABLE IF NOT EXISTS novels (
  slug              TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  original_title    TEXT DEFAULT '',
  author            TEXT DEFAULT '',
  genre             TEXT DEFAULT '',
  source_url        TEXT DEFAULT '',
  last_translated_url TEXT DEFAULT '',
  last_chapter_number INTEGER DEFAULT 0,
  total_chapters    INTEGER DEFAULT 0,
  glossary          TEXT DEFAULT '{}',
  glossary_count    INTEGER DEFAULT 0,
  translation_style TEXT DEFAULT '',
  notes             TEXT DEFAULT '',
  cover_url         TEXT DEFAULT '',
  status            TEXT DEFAULT 'ongoing',
  synopsis          TEXT DEFAULT '',         -- ← MỚI
  updated_at        TEXT DEFAULT (datetime('now'))
);
```

---

## epub_to_chapters.py — Tham số CLI

```
python tools/epub_to_chapters.py [options]

Bắt buộc:
  --slug <slug>         Slug truyện (tên thư mục trong novels/)

Tuỳ chọn:
  --epub-path <path>    Đường dẫn EPUB (mặc định: novels/<slug>/book.epub)
  --synopsis-only       Chỉ trích synopsis, không tách chương
  --chapters-only       Chỉ tách chương, không lấy synopsis
  --overwrite           Ghi đè file đã tồn tại
  --out-dir <dir>       Thư mục đầu ra chapters (mặc định: novels/<slug>/translated/)
  --dry-run             In kết quả mà không ghi file
```

---

## SynopsisPanel.jsx — Props

```jsx
<SynopsisPanel
  slug="xich-tam-tuan-thien"   // string — để lazy load
  synopsis="Nội dung..."        // string — text ban đầu từ API
  hasMore={true}                // bool — có phần còn lại không
  maxLines={5}                  // number — số dòng clamp (default: 5)
/>
```

---

## Lưu ý quan trọng

> [!WARNING]
> **Conflict với chapters dịch từ pipeline chính**: Nếu `novels/<slug>/translated/` đã có chapters
> từ `main.py`, script sẽ **bỏ qua** (không ghi đè) trừ khi truyền `--overwrite`.
> Dùng `--out-dir` để xuất ra thư mục khác nếu muốn so sánh.

> [!NOTE]
> **Synopsis detection**: Script tự động nhận diện item synopsis dựa trên:
> - Từ khoá trong tiêu đề: `giới thiệu`, `synopsis`, `tóm tắt`, `introduction`...
> - Nội dung ngắn < 5000 ký tự và không có marker `Chương`/`章`/`Chapter`

> [!TIP]
> **Batch synopsis cho thư viện EPUB lớn**: Viết loop ngoài:
> ```bash
> for slug in $(ls novels/); do
>   python tools/epub_to_chapters.py --slug $slug --synopsis-only
> done
> python migrate_to_cloudflare.py --synopsis
> ```

---

## Commits liên quan

```
ecb8d3c  feat(epub): add epub_to_chapters.py parser and synopsis column to D1
9dd8013  feat(worker): add GET /api/novels/:slug/synopsis route and handler
2c75414  feat(migrate): add synopsis sync support to migrate_to_cloudflare.py
5475696  feat(frontend): add SynopsisPanel component and integrate into NovelPage
```
