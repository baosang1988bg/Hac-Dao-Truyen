# Hướng dẫn chạy thử `/speckit-auto` trên Windows (máy RTX 4060)

> Dành cho lần chạy đầu tiên của Multi-Provider Agent Swarm. Làm theo thứ tự; mỗi bước có
> cách kiểm tra "đạt" trước khi sang bước sau. Tài liệu chi tiết: `docs/RUNBOOK_SWARM.md`.
>
> Ước lượng thời gian: cài đặt 20–30 phút, chạy demo 2 phút, chạy thật đầu tiên 10–20 phút.

---

## Bước 0 — Lấy code về máy Windows

Mở **PowerShell** tại thư mục repo (vd `E:\AOO\HacDaoTruyen`):

```powershell
git status                       # phải sạch; nếu đang dở việc thì commit/stash trước
git fetch origin
git checkout feature/speckit-swarm
git pull --rebase
git config core.longpaths true   # tránh lỗi đường dẫn dài của worktree trên Windows
```

**Đạt khi:** có thư mục `tools\swarm\` và file `docs\RUNBOOK_SWARM.md`.

---

## Bước 1 — Kiểm tra công cụ nền

```powershell
py -3.12 --version     # cần Python 3.11+ (thiếu: winget install Python.Python.3.12)
node --version         # cần v22.x (giống CI)
git --version
ollama --version       # tuỳ chọn — cho vai trò Local Healer
```

Cài dependency của swarm (thường đã có sẵn vì trùng `requirements.txt`):

```powershell
py -3.12 -m pip install -r tools\swarm\requirements.txt
```

Cài dependency Node một lần ở repo chính (để cổng `test_worker` dùng được `workerd` bản Windows):

```powershell
npm ci
npm ci --prefix frontend
```

**Đạt khi:** `py -3.12 -c "import fastapi, uvicorn, httpx; print('ok')"` in ra `ok`.

---

## Bước 2 — Model local cho Healer (RTX 4060)

```powershell
ollama pull qwen2.5-coder:7b
ollama list            # phải thấy qwen2.5-coder:7b
```

Ollama chạy nền sau khi cài (biểu tượng ở khay hệ thống). Bỏ qua bước này cũng được — Healer sẽ
dùng Claude dự phòng.

---

## Bước 3 — API key

1. Sao chép file mẫu:
   ```powershell
   Copy-Item tools\swarm\env.swarm.example .env.swarm
   notepad .env.swarm
   ```
2. Điền 4 key (mỗi dòng `TEN=giá_trị`, không ngoặc kép):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   GEMINI_API_KEY=...
   XAI_API_KEY=xai-...
   OPENAI_API_KEY=sk-...
   ```
3. Khuyến nghị: tạo **key riêng** cho swarm và đặt **hạn mức chi tiêu tháng** (vd $20) trên trang
   quản lý của từng hãng. `.env.swarm` đã nằm trong `.gitignore` — kiểm tra lại:
   ```powershell
   git check-ignore .env.swarm     # phải in ra: .env.swarm
   ```

---

## Bước 4 — Kiểm tra cấu hình và tên model

```powershell
py -3.12 -m tools.swarm check
```

**Đạt khi:** 4 provider đều `✅ … đã đặt`, Ollama `✅ … (n model …)`, git/npm/node `✅`.

Tiếp theo gọi thử từng model chính (tốn chưa tới 1 cent):

```powershell
py -3.12 -m tools.swarm check --ping
```

**Đạt khi:** 5 dòng `✅`. Nếu có dòng `❌ … HTTP 404` → tên model đã đổi: mở
`tools\swarm\agents.toml`, sửa tên trong `[models."…"]` **và** trong `models = [...]` của vai trò,
rồi chạy lại `check --ping`. Đồng thời đối chiếu **giá** trong `agents.toml` với trang giá chính
thức (ngân sách $2/run được tính từ các con số này).

---

## Bước 5 — Chạy demo (miễn phí, không gọi API)

```powershell
powershell -ExecutionPolicy Bypass -File tools\swarm\speckit-auto.ps1 -Demo
```

Trình duyệt tự mở `http://127.0.0.1:8765/#token=…`. Bạn sẽ thấy:

1. Thẻ **Spec Lead** chuyển `🟢 RUNNING` → khung vàng **"Duyệt đặc tả"** hiện ra.
2. Thử bấm **Yêu cầu sửa** (ghi góp ý bất kỳ) → spec được viết lại → bấm **Duyệt**.
3. Duyệt tiếp **plan + tasks** → Coder chạy → QA yêu cầu sửa 1 vòng (giả lập) → kiểm tra → **Kết quả**.

Demo chạy trên bản clone tạm nên **không tạo nhánh nào trong repo thật**. `Ctrl+C` để tắt server.

**Đạt khi:** khung Kết quả ghi `✅ Hoàn tất`.

---

## Bước 6 — Chạy thật lần đầu (tính năng nhỏ, ngân sách $1)

Chọn tính năng **nhỏ và an toàn**, ví dụ:

```powershell
powershell -ExecutionPolicy Bypass -File tools\swarm\speckit-auto.ps1 -Budget 1 "Thêm nút sao chép link chương hiện tại vào thanh công cụ của Reader, hiện thông báo Đã sao chép"
```

Hoặc trong Antigravity / Claude Code:

```
/speckit-auto Thêm nút sao chép link chương hiện tại vào thanh công cụ của Reader, hiện thông báo Đã sao chép
```

Trong lúc chạy:

| Thời điểm | Bạn làm gì |
|---|---|
| Gate **Duyệt đặc tả** | Đọc spec.md: đúng ý chưa, tiêu chí chấp nhận có đo được không. Sai → **Yêu cầu sửa** + góp ý cụ thể |
| Gate **Duyệt kế hoạch** | Đọc plan.md + tasks.md: file sửa có đúng chỗ, có thêm thư viện lạ không, có task viết test không |
| Gate **Ngân sách** (nếu hiện) | Duyệt = tăng thêm $1 (hoặc ghi số tiền vào ô góp ý); Dừng = kết thúc |
| Coder / QA / Kiểm tra | Chỉ theo dõi. Lần đầu worktree chạy `npm ci` mất ~1 phút |

**Đạt khi:** Kết quả ghi `✅ Hoàn tất`, có commit trên nhánh `feature/NNN-…`.

---

## Bước 7 — Review và đưa code lên

Worktree nằm cạnh repo: `..\HacDaoTruyen-swarm\NNN-…` (đường dẫn chính xác có trong khung Kết quả).

```powershell
cd ..\HacDaoTruyen-swarm\NNN-ten-tinh-nang
git log -1 --stat
git diff HEAD~1                  # đọc kỹ từng thay đổi
npm run dev --prefix frontend    # (tuỳ chọn) xem thử giao diện
git push -u origin feature/NNN-ten-tinh-nang
```

Mở PR trên GitHub → chờ CI xanh → merge. **Deploy vẫn do bạn làm** theo quy tắc 4 trong
`.agents/AGENTS.md`. Sau khi merge, dọn worktree:

```powershell
cd E:\AOO\HacDaoTruyen
git worktree remove ..\HacDaoTruyen-swarm\NNN-ten-tinh-nang
```

Nếu kết quả là `checks_failed`: commit vẫn được tạo (gắn `[WIP: checks failed]`) — mở worktree,
xem log cổng kiểm tra trong dashboard, sửa tay hoặc chạy `/speckit-auto` lại với mô tả rõ hơn.

---

## Bước 8 — Ghi nhận

Sau lần chạy thật đầu tiên, thêm 1 dòng vào `.agents/WORKLOG.md` (chi phí thực tế, model nào bị
chuyển dự phòng, vấn đề gặp phải) để Claude Code bên Mac điều chỉnh `agents.toml` nếu cần.

---

## Xử lý sự cố trên Windows

| Triệu chứng | Cách xử lý |
|---|---|
| `running scripts is disabled on this system` | Dùng đúng lệnh có `-ExecutionPolicy Bypass` như trên |
| `Cần Python 3.11+` | `winget install Python.Python.3.12`, mở lại PowerShell |
| Dashboard báo **Thiếu token** | Dùng đúng link có `#token=…` in trong cửa sổ PowerShell |
| Cổng 8765 bận | Launcher tự thử 8766, 8767…; hoặc thêm `-Port 9000` |
| Chữ tiếng Việt lỗi font trong console | Chạy `chcp 65001` trước, hoặc dùng Windows Terminal |
| `Filename too long` khi tạo worktree | `git config core.longpaths true` (Bước 0) |
| Thẻ agent ghi "Bỏ qua … chưa đặt …_API_KEY" | Kiểm tra `.env.swarm` ở **gốc repo**, khởi động lại lệnh |
| Healer luôn chuyển sang Claude | Mở ứng dụng Ollama hoặc chạy `ollama serve` |
| `test_worker` lỗi `workerd` | Chạy `npm ci` ở gốc repo chính (Bước 1) |
| Muốn xem log chi tiết | `.swarm\runs\<run-id>\events.jsonl` |
| Muốn dừng ngay | Nút **Huỷ run** trên dashboard, hoặc `Ctrl+C` |

---

## Nhắc lại về an toàn

- Swarm **không push, không deploy**, chỉ commit trong worktree riêng.
- Agent không có shell tuỳ ý, không đọc được `.env` / `credentials.json` / `key_status.json`.
- Nhưng bước kiểm tra **chạy test do agent viết** bằng tài khoản Windows của bạn → luôn review diff
  trước khi push.
