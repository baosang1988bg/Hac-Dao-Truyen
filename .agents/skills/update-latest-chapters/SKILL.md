---
name: update-latest-chapters
description: Automatically checks, translates, and syncs the latest chapters for tracked novels (such as 'Lãnh Chúa Cầu Sinh', 'Sớm Đăng Lục Thế Giới Trò Chơi') or manages the list of auto-updated novels. Use when the user asks to update latest chapters ('update lasted chapter', 'update latest chapters', 'cập nhật chương mới', 'có chương mới không') or add a novel to the auto-check list.
---

# Quy trình Tự động Cập nhật Chương Mới & Quản lý Danh Sách Truyện (Auto-Check & Translate)

Skill này cung cấp quy trình và công cụ tự động để:
1. **Kiểm tra và tự động dịch, đồng bộ chương mới** cho tất cả các truyện trong danh sách theo dõi (hoặc một truyện chỉ định).
2. **Quản lý danh sách truyện theo dõi**: xem danh sách, thêm truyện mới vào danh sách auto-check, hoặc tạm dừng theo dõi.

---

## 1. Danh sách truyện theo dõi mặc định

Hệ thống theo dõi các truyện có cấu hình `auto_check.enabled: true` trong file `novels/<slug>/novel.json`:

1. **Lãnh Chúa Cầu Sinh: Thiên Phú Hợp Thành**
   - **Slug:** `lanh-chua-cau-sinh-thien-phu-hop-thanh`
   - **Source Index:** `https://www.novel543.com/0606657941/`
2. **Sớm Đăng Lục Thế Giới Trò Chơi Bắt Đầu Thông Giai Nữ Đế**
   - **Slug:** `som-dang-luc-the-gioi-tro-choi-bat-dau-thong-gia-nu-de`
   - **Source Index:** `https://www.novel543.com/0906627296/`

---

## 2. Lệnh Cập nhật Chương Mới (Update Latest Chapters)

Khi người dùng yêu cầu **"update latest chapter"**, **"update lasted chapter"**, **"cập nhật chương mới"**, hoặc **"có chương mới không?"**:

### A. Cập nhật tất cả truyện trong danh sách:
Chạy lệnh tự động (quét và dịch tất cả truyện có `auto_check.enabled: true`):
```bash
python -u tools/manage_auto_check.py run
# hoặc:
python -u tools/auto_check_novel.py
```

### B. Cập nhật một truyện cụ thể:
```bash
python -u tools/manage_auto_check.py run --slug <slug>
# hoặc:
python -u tools/auto_check_novel.py --slug <slug>
```

### Quy trình tự động diễn ra:
1. **Kiểm tra & Sửa lỗi cũ (Self-Healing):** Quét các file dịch bị lỗi từ lần trước (`[Translation failed...]`), tự động dịch lại và chuẩn bị thay thế trên Cloudflare.
2. **Kiểm tra chương mới:** Đọc mục lục nguồn qua Jina Reader (`https://r.jina.ai/<source_index_url>`).
3. **Cập nhật catalog:** Tự động append các chương mới vào `novels/<slug>/catalog.json` và cập nhật `total_chapters` trong `novel.json`.
4. **Dịch tự động:** Chạy `main.py translate --novel <slug> --chapters <N>` với cơ chế xoay vòng key Gemini API.
5. **Đồng bộ Cloudflare:** Tự động đồng bộ lên Cloudflare D1 + R2 qua Worker API hoặc `migrate_to_cloudflare.py`.
6. **Deploy Cloudflare Workers:** Tự động thực thi lệnh deploy (`npx wrangler deploy`).
7. **Tạo thông báo & Ghi nhận thời gian:** Cập nhật `last_updated_at` trong `novel.json`, thông báo trong `announcements.json`, và in báo cáo chi tiết thời gian (dịch, sync, deploy, tổng thời lượng).

> [!IMPORTANT]
> 1. **Luôn giữ tên truyện là Tiếng Việt**: Thuộc tính `"title"` trong `novel.json` và mọi nơi hiển thị luôn luôn phải là tiếng Việt (tên gốc Trung chỉ nằm trong `"original_title"`).
> 2. **Chạy trọn gói**: Thực hiện toàn bộ quy trình trong một lần, không dừng lại giữa chừng để hỏi người dùng. Báo cáo rõ ràng thời điểm hoàn thành và tiến trình deploy.

---

## 3. Lệnh Quản lý Danh Sách (Manage Auto-Check List)

### A. Xem danh sách các truyện đang theo dõi:
```bash
python -u tools/manage_auto_check.py list
```
Lệnh này hiển thị:
- Tên truyện & slug.
- Số chương hiện có trong hệ thống.
- URL trang nguồn mục lục.
- Các truyện khác có trong thư mục `novels/` nhưng chưa bật auto-check.

### B. Thêm truyện vào danh sách theo dõi (Add Novel):
Khi người dùng muốn **"add truyện vào list update lasted chapter"**:
```bash
python -u tools/manage_auto_check.py add <slug> [--url <source_index_url>]
```
- Nếu không truyền `--url`, công cụ sẽ tự động chuẩn hóa từ `source_url` sẵn có trong `novel.json`.
- Hoặc chỉnh sửa trực tiếp `novels/<slug>/novel.json`, thêm:
  ```json
  "auto_check": {
    "enabled": true,
    "source_index_url": "https://www.novel543.com/<book_id>/"
  }
  ```

### C. Hủy/tạm dừng theo dõi một truyện:
```bash
python -u tools/manage_auto_check.py remove <slug>
```

---

## 4. Kiểm tra & Xử lý sự cố

- **Nếu gặp lỗi Unicode cp1252 trên Windows PowerShell/CMD:**
  Tất cả công cụ (`tools/auto_check_novel.py`, `tools/manage_auto_check.py`) đã tích hợp tự động cấu hình `sys.stdout.reconfigure(encoding='utf-8')`. Khi chạy lệnh, luôn kèm cờ `-u` (unbuffered) để theo dõi tiến trình trực tiếp.
- **Nếu Cloudflare chặn bot:**
  Hệ thống sử dụng Jina Reader proxy (`r.jina.ai`) với headers `X-No-Cache: true` để luôn lấy mục lục mới nhất mà không bị chặn.
