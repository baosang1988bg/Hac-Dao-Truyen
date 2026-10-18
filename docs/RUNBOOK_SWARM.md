# Runbook: Multi-Provider Agent Swarm (`/speckit-auto`) + Live Dashboard

> Một lệnh chạy trọn quy trình Spec Kit bằng đội đa tác tử nhiều provider:
> **Gemini** viết spec → *bạn duyệt* → **Claude** lập plan + tasks → *bạn duyệt* →
> **Claude** code → **Grok** phản biện → **Ollama (RTX 4060)** sửa lint → cổng chất lượng → commit cục bộ.
> Đặc tả và thiết kế: `specs/001-speckit-swarm/`. Code: `tools/swarm/`.

---

## 1. Cài đặt (một lần, trên máy Windows)

1. **Python 3.11+** và **Node 22**, **git** có trong PATH.
2. Dependency (đã có trong `requirements.txt` gốc, nên thường không cần cài thêm):
   ```powershell
   py -3.12 -m pip install -r tools/swarm/requirements.txt
   ```
3. **Ollama** cho vai trò Local Healer (tuỳ chọn — không có thì dùng Claude dự phòng):
   ```powershell
   ollama pull qwen2.5-coder:7b
   ```
4. **API key** — sao chép `tools/swarm/env.swarm.example` thành `.env.swarm` ở gốc repo (đã gitignore):
   ```
   ANTHROPIC_API_KEY=...
   GEMINI_API_KEY=...
   XAI_API_KEY=...
   OPENAI_API_KEY=...
   ```
   Swarm **chỉ đọc `.env.swarm`**, không đọc `.env` gốc (file đó có secret production).
   Nên tạo key riêng cho swarm và đặt hạn mức chi tiêu ở trang quản lý của từng hãng.
5. **Xác minh tên model + giá** trong `tools/swarm/agents.toml` (lấy từ nguồn thứ ba ngày
   2026-10-18). Ngân sách mỗi run được tính từ bảng giá này.
6. Kiểm tra:
   ```powershell
   py -3.12 -m tools.swarm check          # key, Ollama, git/npm, cấu hình
   py -3.12 -m tools.swarm check --ping   # gọi thử từng model chính (tốn < 1 cent)
   ```

## 2. Chạy

| Cách | Lệnh |
|---|---|
| Trong Antigravity / Claude Code | `/speckit-auto Thêm nút chia sẻ chương lên Zalo ở cuối Reader` |
| PowerShell | `powershell -ExecutionPolicy Bypass -File tools/swarm/speckit-auto.ps1 "Mô tả tính năng"` |
| Python trực tiếp | `py -3.12 -m tools.swarm auto "Mô tả tính năng" [--budget 3]` |
| Chỉ mở dashboard, tạo run trên giao diện | `py -3.12 -m tools.swarm serve` |
| Không có trình duyệt (duyệt trong terminal) | `py -3.12 -m tools.swarm run "Mô tả"` |
| **Chạy thử miễn phí** (provider giả lập) | `py -3.12 -m tools.swarm demo` hoặc `speckit-auto.ps1 -Demo` |

Lệnh in ra `Dashboard: http://127.0.0.1:8765/#token=…` và tự mở trình duyệt. Link có token —
**không chia sẻ link này**. Ctrl+C để tắt server (run đang chạy dở sẽ dừng).

## 3. Dashboard

- **Thẻ agent**: vai trò, provider, model đang dùng, trạng thái
  (`🟢 RUNNING`, `🟡 REVIEWING`, `⏸ CHỜ DUYỆT`, `🔵 COMPLETED`, `💤 IDLE`, `🔴 FAILED`), số lượt gọi, token, chi phí.
- **Thanh ngân sách** ở đầu trang: chi phí tích luỹ / ngân sách, đỏ khi > 85%.
- **Khung duyệt** (viền vàng) hiện khi tới gate:
  - **Duyệt** → chạy bước tiếp.
  - **Yêu cầu sửa** → ghi góp ý, agent viết lại (tối đa 3 lần mỗi gate).
  - **Dừng** → kết thúc run, worktree giữ nguyên để xem.
  - Gate **Ngân sách**: Duyệt = tăng thêm $1 (hoặc số tiền ghi trong ô góp ý).
- **Tài liệu & thay đổi**: spec.md, plan.md, tasks.md, diff (tô màu), báo cáo QA.
- **Luồng hội thoại**: bàn giao giữa agent (nền vàng), lượt gọi model (token, $, thời gian), công cụ agent dùng.

## 4. Sau khi run xong

Kết quả là **một commit trên nhánh `feature/NNN-slug`** trong worktree
`..\HacDaoTruyen-swarm\NNN-slug`. Swarm **không push, không deploy**.
```powershell
cd ..\HacDaoTruyen-swarm\NNN-slug
git log -1 --stat; git diff HEAD~1          # review kỹ
git push -u origin feature/NNN-slug         # bạn tự push → mở PR → CI
git worktree remove ..\HacDaoTruyen-swarm\NNN-slug   # dọn sau khi merge
```
Run có trạng thái `checks_failed` vẫn được commit (gắn `[WIP: checks failed]`) để bạn sửa tiếp.

## 5. An toàn — cái gì chặn cái gì

| Rủi ro | Rào chắn |
|---|---|
| Đụng working tree đang làm dở | Mỗi run một **git worktree** riêng |
| Lộ secret production | Worktree chỉ có file đã track → **không có `.env`**; công cụ agent chặn đọc/ghi `.env*`, `credentials.json`, `key_status.json`, `.dev.vars`, `.git/` |
| Agent chạy lệnh deploy | **Không có shell tuỳ ý** — chỉ 5 cổng kiểm tra cố định (lint, test_frontend, test_worker, test_python, build_frontend) |
| Code do agent viết đọc phiên `wrangler`/`gh` khi chạy test | Tiến trình test nhận env đã lọc (không API key/token) và `HOME`/`APPDATA` trỏ vào thư mục tạm |
| Agent tự sửa rào chắn | Cấm ghi `tools/swarm/`, `.github/workflows/`, `.openhands/`, `wrangler.jsonc`, `deploy.bat` |
| Trang web lạ gọi API localhost (CSRF) | Server chỉ bind `127.0.0.1`, kiểm Host header, mọi API cần token ngẫu nhiên |
| Chi phí vượt dự kiến | Mỗi lời gọi được ước lượng trước (tính cả `max_output_tokens`); vượt ngân sách → dừng hỏi |
| Supply chain | Không dùng LiteLLM (từng bị chèn mã độc trên PyPI 03/2026); chỉ dùng `httpx` + FastAPI đã có |

**Giới hạn còn lại:** chạy test = chạy code agent viết, với quyền user Windows của bạn. Rào chắn
trên giảm rủi ro chứ không loại bỏ — luôn review diff trước khi push.

## 6. Tuỳ chỉnh (`tools/swarm/agents.toml`)

- `[run] budget_usd` — ngân sách mặc định; `max_coder_steps`, `max_qa_rounds`, `max_fix_rounds`.
- `[roles.<vai trò>] models` — chuỗi dự phòng, model đầu tiên là chính. Ví dụ để QA dùng Claude:
  `models = ["anthropic/claude-sonnet-5-5"]`.
- `context_budget_tokens` của Spec Lead (mặc định 80k) — tăng thì spec hiểu codebase rộng hơn nhưng tốn hơn;
  Gemini tính giá cao hơn khi prompt > 200k token.
- Thêm model mới: khai báo giá trong `[models."provider/model"]`, rồi đưa vào `models` của vai trò.

Chi phí ước tính một run tính năng nhỏ: **~$0.3–0.8** (spec ~$0.18, plan ~$0.15, phần còn lại tuỳ
số lượt Coder đọc/sửa file).

## 7. Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Dashboard báo "Thiếu token" | Mở đúng link có `#token=…` mà lệnh in ra |
| Thẻ agent ghi "Bỏ qua … chưa đặt …_API_KEY" | Điền key trong `.env.swarm`, khởi động lại |
| Healer luôn chuyển sang Claude | `ollama serve` chưa chạy hoặc chưa `ollama pull qwen2.5-coder:7b` |
| `HTTP 404 … model` | Tên model đã đổi — sửa trong `agents.toml` (`check --ping` để thử) |
| Cổng `test_worker` lỗi workerd | Chạy `npm ci` ở gốc repo một lần trên Windows |
| Log chi tiết | `.swarm/runs/<run-id>/events.jsonl` (đã gitignore) |
