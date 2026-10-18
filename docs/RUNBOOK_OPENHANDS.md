# Runbook: Triển Khai OpenHands Trên Windows Với Docker Desktop

> **Mục đích:** Hướng dẫn khởi động OpenHands làm runtime agent trong môi trường sandbox Docker cô lập, phục vụ các tác vụ tự động dài hơi trên repository `HacDaoTruyen`.

---

## 1. Yêu cầu Tiền đề (Prerequisites)

1. **Docker Desktop:** Đã cài đặt trên Windows 11 với WSL2 backend.
   - Bật Docker Desktop trước khi chạy lệnh.
   - Kiểm tra trạng thái:
     ```powershell
     docker ps
     ```
2. **Cấu hình tài nguyên khuyến nghị cho Docker Desktop:**
   - Trong Docker Desktop > Settings > Resources > WSL integration: Bật phân vùng WSL2.
   - (Tùy chọn) Tạo file `C:\Users\<user>\.wslconfig` để giới hạn RAM:
     ```ini
     [wsl2]
     memory=8GB
     processors=8
     ```

---

## 2. Lệnh Khởi Động OpenHands

Chạy lệnh PowerShell sau để khởi động OpenHands container:

```powershell
docker run -it --rm `
  -e SANDBOX_USER_ID=1000 `
  -e WORKSPACE_BASE="E:\AOO\HacDaoTruyen" `
  -v "E:\AOO\HacDaoTruyen:/workspace" `
  -v "\\.\pipe\docker_engine:\\.\pipe\docker_engine" `
  -p 3000:3000 `
  --name openhands-app `
  docker.all-hands.dev/all-hands-ai/openhands:0.14
```

> **Ghi chú về biến môi trường LLM:**
> Bạn có thể truyền API key trực tiếp qua `-e GEMINI_API_KEY="..."` hoặc cấu hình trực tiếp trên Web UI tại bước đăng nhập đầu tiên.

---

## 3. Tích hợp Mô hình AI (LLM Routing)

### A. Sử dụng Cloud LLM (Khuyến nghị cho Spec & Plan)
- **Model:** `gemini/gemini-1.5-pro` hoặc `anthropic/claude-3-5-sonnet-20241022`
- Cung cấp API Key tương ứng trong giao diện Settings của OpenHands.

### B. Sử dụng Local Ollama trên GPU RTX 4060 (Miễn phí token)
Máy hiện đã cài sẵn Ollama với model `qwen2.5:7b` và `deepseek-r1:14b`.
- Địa chỉ kết nối từ trong Docker: `http://host.docker.internal:11434`
- Cấu hình provider trong OpenHands:
  - **Base URL:** `http://host.docker.internal:11434`
  - **Model:** `ollama/qwen2.5:7b`

---

## 4. Truy Cập & Sử Dụng Quy Trình Spec Kit Trong OpenHands

1. Mở trình duyệt tại: `http://localhost:3000`.
2. Workspace sẽ hiển thị toàn bộ code của `HacDaoTruyen`.
3. OpenHands sẽ tự động đọc file [.openhands_instructions](file:///e:/AOO/HacDaoTruyen/.openhands_instructions) để áp dụng các giới hạn an toàn:
   - **Cấm hoàn toàn:** Không chạy lệnh `wrangler deploy` hay `npm run deploy`.
   - **Luôn làm việc trên branch riêng:** Không commit đè lên `main`.
4. Nhập prompt theo quy trình Spec Kit:
   - *"Đọc .specify/memory/constitution.md và tạo spec cho tính năng..."*
   - *"Thực hiện task theo specs/<feature>/tasks.md và chạy npm run lint để kiểm tra..."*

---

## 5. Dừng OpenHands

Khi hoàn tất công việc, nhấn `Ctrl+C` tại terminal PowerShell hoặc chạy:
```powershell
docker stop openhands-app
```
Toàn bộ mã nguồn và file markdown tạo ra trong `/workspace` sẽ được lưu đồng bộ trực tiếp trên ổ `E:\AOO\HacDaoTruyen`.
