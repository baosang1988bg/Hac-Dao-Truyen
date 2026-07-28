# 🪟 Hướng Dẫn Chạy EPUB Downloader Trên Windows

Tài liệu này hướng dẫn cách chuyển toàn bộ tiến trình Tải & Upload EPUB sang máy **Windows** mà không cần tải lại từ đầu (tận dụng Resume).

---

## 📋 Bước 1: Chuẩn bị môi trường Python & Git trên Windows

1. Tải và cài đặt **Python 3.11+**:
   - Tải tại: [python.org/downloads](https://www.python.org/downloads/)
   - ⚠️ **Lưu ý quan trọng:** Khi cài nhớ tích chọn **"Add python.exe to PATH"**.

2. Tải và cài đặt **Git for Windows**:
   - Tải tại: [git-scm.com/download/win](https://git-scm.com/download/win)

3. Cài đặt các thư viện Python cần thiết (Mở CMD hoặc PowerShell):
   ```cmd
   pip install PySocks requests google-api-python-client google-auth-oauthlib google-auth-httplib2
   ```

---

## 🧅 Bước 2: Cài đặt Tor Expert / Tor Browser trên Windows

Để chạy ẩn danh đổi IP tự động trên Windows:

- **Cách đơn giản nhất:** Tải **Tor Browser** tại [torproject.org](https://www.torproject.org/download/).
- Mở **Tor Browser** lên và để nó kết nối. Mặc định Tor Browser sẽ lắng nghe SOCKS5 Proxy ở cổng `127.0.0.1:9150`.
- Nếu dùng cổng 9150 của Tor Browser, khi chạy script bạn thêm cờ `--use-tor` hoặc bật dịch vụ Tor Expert.

*(Hoặc tải Tor Expert Bundle / `winget install TorProject.Tor` để chạy `tor.exe` ngầm).*

---

## 📂 Bước 3: Clone Code & Copy File Cấu Hình sang Windows

1. Clone thư viện HacDaoTruyen về máy Windows:
   ```cmd
   git clone https://github.com/baosang1988bg/Hac-Dao-Truyen.git
   cd Hac-Dao-Truyen
   ```

2. Copy 2 file OAuth từ máy Mac (nếu muốn giữ nguyên xác thực Google Drive):
   - `tools/credentials.json`
   - `tools/token.json`

3. **Chuyển thư mục `epub_library` từ Mac sang Windows (Nếu muốn giữ file đã tải):**
   - Copy toàn bộ folder `epub_library` (chứa `catalog_full.jsonl`, `state.json`, `upload_state.json`, `epubs/`) sang ổ đĩa bất kỳ trên Windows (Ví dụ `D:\epub_library`).

---

## 🚀 Bước 4: Chạy Download & Upload Trên Windows

Mở **PowerShell** hoặc **Command Prompt (CMD)**:

### 1. Chạy Download EPUB (Tự động ưu tiên truyện > 500ch & Hoàn Thành, đổi IP Tor tự động):
```cmd
python tools\download_epubs.py --dir D:\epub_library --use-tor --resume --delay 0.4
```

### 2. Chạy Upload Lên Google Drive (Chạy song song ở 1 cửa sổ CMD khác):
```cmd
python tools\gdrive_upload.py --epub-dir D:\epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV
```

---

### 💡 Lưu ý về tính tương thích trên Windows:
- File `state.json` và `upload_state.json` có tính tương thích 100% giữa Mac và Windows.
- Khi chạy trên Windows, script sẽ tự động bỏ qua toàn bộ 330+ truyện đã tải/đã upload trước đó.
