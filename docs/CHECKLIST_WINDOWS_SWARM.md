# Checklist chạy thử `/speckit-auto` trên Windows

> Đánh dấu `[x]` từng ô, ghi kết quả vào chỗ `…`. Gặp ❌ thì **dừng**, chụp/dán nguyên văn lỗi
> gửi Claude. Hướng dẫn chi tiết: `docs\HUONG_DAN_CHAY_THU_SWARM_WINDOWS.md` (cùng thư mục).
>
> Máy: DESKTOP-BDSL142 · Ngày: … · Người chạy: …

Tất cả lệnh chạy trong **PowerShell** tại thư mục repo (vd `E:\AOO\HacDaoTruyen`).
Nếu chữ tiếng Việt bị lỗi font: chạy `chcp 65001` trước.

---

## A. Chuẩn bị (≈10 phút, không tốn tiền)

- [ ] **A1. Lấy code mới nhất** (swarm đã ở `main` từ 2026-10-19)
  ```powershell
  git status                      # phải sạch
  git fetch origin
  git checkout main
  git pull --rebase
  git config core.longpaths true
  ```
  Đạt: có thư mục `tools\swarm\`. Kết quả: …

- [ ] **A2. Công cụ nền**
  ```powershell
  py -3.12 --version   # ≥ 3.11
  node --version       # v22.x
  git --version
  ollama --version     # tuỳ chọn
  ```
  Kết quả: Python … · Node … · Ollama …

- [ ] **A3. Cài dependency**
  ```powershell
  py -3.12 -m pip install -r tools\swarm\requirements.txt
  npm ci
  npm ci --prefix frontend
  py -3.12 -c "import fastapi, uvicorn, httpx; print('ok')"
  ```
  Đạt: in `ok`. Kết quả: …

- [ ] **A4. Test trên Windows**
  ```powershell
  npm run lint
  npm run test:frontend
  py -3.12 -m pytest tests\swarm -q
  ```
  Đạt: lint sạch, test frontend pass, **40 passed**. Kết quả: …

- [ ] **A5. Model local (tuỳ chọn)**
  ```powershell
  ollama pull qwen2.5-coder:7b
  ollama list
  ```
  Đạt: thấy `qwen2.5-coder:7b`. Kết quả: …

---

## B. Demo — không gọi API, không tốn tiền (≈3 phút)

- [ ] **B1. Chạy launcher**
  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\swarm\speckit-auto.ps1 -Demo
  ```
  Đạt: in dòng `Dashboard: http://127.0.0.1:8765/#token=…` và trình duyệt tự mở.
  Nếu launcher lỗi → thử `py -3.12 -m tools.swarm demo` và ghi lỗi lại. Kết quả: …

- [ ] **B2. Thao tác trên dashboard**
  - [ ] Thẻ **Spec Lead** chuyển `🟢 RUNNING`, rồi khung vàng **Duyệt đặc tả** hiện ra
  - [ ] Bấm **Yêu cầu sửa** (ghi góp ý bất kỳ) → spec được viết lại
  - [ ] Bấm **Duyệt** spec → **Duyệt** plan
  - [ ] Thấy QA yêu cầu sửa 1 vòng (giả lập) → Coder sửa → QA pass
  - [ ] Khung **Kết quả** ghi `✅ Hoàn tất`
  - [ ] Nút ◐ đổi sáng/tối hoạt động

  Kết quả: …

- [ ] **B3.** `Ctrl+C` tắt server. Đạt: `git branch` **không** có nhánh `feature/0xx-…` mới (demo chạy trên bản clone tạm).

---

## C. Kết nối API thật (≈3 phút, tốn < 1 cent)

- [ ] **C1. Điền key** (bạn tự làm — agent không được đụng file này)
  ```powershell
  Copy-Item tools\swarm\env.swarm.example .env.swarm
  notepad .env.swarm
  git check-ignore .env.swarm     # phải in ra .env.swarm
  ```

- [ ] **C2. Kiểm tra cấu hình**
  ```powershell
  py -3.12 -m tools.swarm check
  ```
  Đạt: 4 provider `✅ … đã đặt`, ollama `✅`, git/npm/node `✅`. Kết quả: …

- [ ] **C3. Ping từng model**
  ```powershell
  py -3.12 -m tools.swarm check --ping
  ```
  Đạt: **5 dòng ✅**. Ghi lại:

  | Vai trò | Model | Kết quả |
  |---|---|---|
  | Spec Lead | google/gemini-3.1-pro-preview | … |
  | Architect | anthropic/claude-sonnet-5-5 | … |
  | Coder | anthropic/claude-sonnet-5-5 | … |
  | QA | xai/grok-4.5 | … |
  | Healer | ollama/qwen2.5-coder:7b | … |

  Có `❌ HTTP 404` = tên model sai → ghi tên đúng vào đây, gửi Claude sửa `agents.toml`: …

- [ ] **C4. Đối chiếu giá** trên trang giá chính thức với `tools\swarm\agents.toml` (mục `[models.…]`).
  Lệch: …

---

## D. Chạy thật lần đầu — tính năng nhỏ, ngân sách $1 (≈15 phút)

- [ ] **D1. Khởi chạy**
  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\swarm\speckit-auto.ps1 -Budget 1 "Thêm nút sao chép link chương hiện tại vào thanh công cụ của Reader, hiện thông báo Đã sao chép"
  ```
- [ ] **D2.** Đọc `spec.md` → Duyệt (hoặc Yêu cầu sửa)
- [ ] **D3.** Đọc `plan.md` + `tasks.md`: file sửa đúng chỗ? không thêm thư viện lạ? có task test? → Duyệt
- [ ] **D4.** Theo dõi Coder → QA → Kiểm tra. Lần đầu worktree chạy `npm ci` mất ~1 phút.
- [ ] **D5.** Kết quả cuối

  | Mục | Ghi lại |
  |---|---|
  | Trạng thái | ✅ completed / ⚠️ checks_failed / ❌ failed: … |
  | Nhánh + commit | … |
  | Chi phí thực tế | $… |
  | Model bị chuyển dự phòng | … |
  | Vòng QA / vòng sửa | … |
  | Thời gian tổng | … phút |

- [ ] **D6. Review code trong worktree**
  ```powershell
  cd ..\HacDaoTruyen-swarm\<NNN-ten-tinh-nang>
  git log -1 --stat
  git diff HEAD~1
  npm run dev --prefix frontend    # xem thử nút trên giao diện
  ```
  Code dùng được không? … (chưa push nhánh này nếu chưa hài lòng)

---

## E. Ghi nhận và bàn giao

- [ ] **E1.** Thêm 1 dòng vào `.agents\WORKLOG.md`, ví dụ:
  `2026-10-xx HH:MM | antigravity@DESKTOP-BDSL142 | Chạy thử swarm: pytest 51/51, demo OK, ping 5/5, run thật $0.xx completed | không chạm production; swarm dùng được trên Windows`
- [ ] **E2.** Commit + `git pull --rebase` + push WORKLOG lên `main` (chỉ file WORKLOG)
- [ ] **E3.** Báo Claude kết quả (dán bảng C3 + D5, hoặc lỗi nguyên văn)
- [ ] **E4.** ~~Trả lời Claude "merge"~~ — swarm đã được đưa lên `main` ngày 2026-10-19 (lưu ý: push lên `main` = Cloudflare tự deploy production)

---

## Lỗi hay gặp

| Triệu chứng | Cách xử lý |
|---|---|
| `running scripts is disabled` | Dùng đúng lệnh có `-ExecutionPolicy Bypass` |
| `Cần Python 3.11+` | `winget install Python.Python.3.12`, mở lại PowerShell |
| Dashboard báo Thiếu token | Mở đúng link có `#token=…` trong cửa sổ PowerShell |
| `Filename too long` | `git config core.longpaths true` |
| Thẻ agent ghi "chưa đặt …_API_KEY" | `.env.swarm` phải nằm ở **gốc repo**; chạy lại lệnh |
| Healer luôn chuyển sang Claude | Mở ứng dụng Ollama / `ollama serve` |
| `test_worker` lỗi workerd | `npm ci` ở gốc repo (A3) |
| Log chi tiết | `.swarm\runs\<run-id>\events.jsonl` |
