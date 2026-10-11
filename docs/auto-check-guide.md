# Hướng Dẫn Tự Động Cập Nhật Chương Mới (Auto-Check & Translate)

Tài liệu này hướng dẫn cách kiểm tra, cập nhật chương mới và quản lý danh sách truyện tự động.

---

## 📌 Lệnh tắt nhanh (Shortcut)

Khi chat với AI, bạn chỉ cần gõ:
- `/update-help`: Xem danh sách câu lệnh.
- *"Update lasted chapter"* hoặc *"Cập nhật chương mới"*: Tự động quét và dịch tất cả truyện trong danh sách.
- *"Add truyện <slug> vào list update lasted chapter"*: Tự động cấu hình và thêm truyện vào danh sách.

---

## 💻 Các câu lệnh CLI trực tiếp

### 1. Cập nhật tất cả truyện trong danh sách
Quét trang nguồn, tự động dịch bằng Gemini (xoay vòng key) và đồng bộ lên Cloudflare:
```bash
python -u tools/manage_auto_check.py run
# hoặc:
python -u tools/auto_check_novel.py
```

### 2. Cập nhật 1 truyện cụ thể
```bash
python -u tools/manage_auto_check.py run --slug lanh-chua-cau-sinh-thien-phu-hop-thanh
```

### 3. Xem danh sách truyện đang được theo dõi
```bash
python -u tools/manage_auto_check.py list
```

### 4. Thêm truyện vào danh sách theo dõi
```bash
python -u tools/manage_auto_check.py add <slug> [--url <source_index_url>]
```
- Nếu không truyền `--url`, hệ thống tự lấy `source_url` trong `novel.json`.
- Ví dụ:
  ```bash
  python -u tools/manage_auto_check.py add som-dang-luc-the-gioi-tro-choi-bat-dau-thong-gia-nu-de
  ```

### 5. Hủy hoặc tạm dừng theo dõi một truyện
```bash
python -u tools/manage_auto_check.py remove <slug>
```

---

## 📂 Danh sách truyện hiện tại

1. **Lãnh Chúa Cầu Sinh: Thiên Phú Hợp Thành**
   - Slug: `lanh-chua-cau-sinh-thien-phu-hop-thanh`
   - Nguồn: `https://www.novel543.com/0606657941/`
2. **Sớm Đăng Lục Thế Giới Trò Chơi Bắt Đầu Thông Giai Nữ Đế**
   - Slug: `som-dang-luc-the-gioi-tro-choi-bat-dau-thong-gia-nu-de`
   - Nguồn: `https://www.novel543.com/0906627296/`

---

## 📍 Nơi lưu trữ cấu hình trong dự án

- **Cấu hình từng truyện:** Nằm trong `novels/<slug>/novel.json` (trường `"auto_check"`).
- **Skill AI Antigravity:** Nằm tại `.agents/skills/update-latest-chapters/SKILL.md`.
- **Quy tắc làm việc của Agent:** Nằm tại `.agents/AGENTS.md`.
- **Mã nguồn công cụ:** `tools/manage_auto_check.py` và `tools/auto_check_novel.py`.
