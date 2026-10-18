# Việc cho Antigravity (máy Windows DESKTOP-BDSL142) — chạy thử /speckit-auto trước khi merge

> Nhánh `feature/speckit-swarm` (Claude Cowork viết trên Mac, chưa từng chạy trên Windows
> và chưa gọi API thật). Việc này **KHÔNG chạm production**. Làm đủ bước 1–5, ghi WORKLOG,
> rồi **dừng chờ người dùng** quyết định merge. Hướng dẫn chi tiết:
> `docs\HUONG_DAN_CHAY_THU_SWARM_WINDOWS.md`.

## Bước 1 — Lấy nhánh, chạy test

```powershell
git fetch origin
git checkout feature/speckit-swarm
git pull --rebase
git config core.longpaths true
py -3.12 -m pip install -r tools\swarm\requirements.txt
npm ci; npm ci --prefix frontend
npm run lint
npm run test:frontend
py -3.12 -m pytest tests\swarm -q
```

Tất cả phải xanh. `tests\swarm` đỏ trên Windows (đường dẫn, encoding, `git worktree`…) →
ghi lỗi nguyên văn vào WORKLOG, **không tự sửa `tools\swarm\`** (người dùng sẽ chuyển cho Claude).

## Bước 2 — Kiểm tra cấu hình (không tốn tiền)

```powershell
py -3.12 -m tools.swarm check
```

Nếu chưa có `.env.swarm`: **dừng, nhắc người dùng** tự tạo từ `tools\swarm\env.swarm.example`
và tự điền key (agent không đọc/ghi file key). Ollama chưa có `qwen2.5-coder:7b` → `ollama pull qwen2.5-coder:7b`.

## Bước 3 — Thử launcher PowerShell ở chế độ demo (không tốn tiền)

```powershell
powershell -ExecutionPolicy Bypass -File tools\swarm\speckit-auto.ps1 -Demo -Budget 1
```

- Launcher phải tìm được Python 3.11+, mở dashboard `http://127.0.0.1:8765/#token=…`.
- Đưa link cho người dùng; người dùng bấm Duyệt 2 lần → kết quả `✅ Hoàn tất`.
- Launcher lỗi → ghi lỗi nguyên văn vào WORKLOG, thử lệnh tương đương `py -3.12 -m tools.swarm demo`.

## Bước 4 — Ping model thật (tốn < 1 cent, chỉ khi người dùng đã điền key)

```powershell
py -3.12 -m tools.swarm check --ping
```

Dòng `❌ … HTTP 404` = tên model sai → ghi vào WORKLOG tên model đúng (xem `ollama list` /
trang models của hãng), không tự sửa `agents.toml` khi người dùng chưa đồng ý.

## Bước 5 — Ghi WORKLOG

1 dòng: kết quả bước 1–4 (pass/fail, lỗi nếu có), ví dụ
`… | antigravity@DESKTOP-BDSL142 | Chạy thử swarm: pytest 40/40, demo OK qua ps1, ping 5/5 | không chạm production; sẵn sàng merge`.
Commit + push lên `feature/speckit-swarm` (chỉ file WORKLOG).

## Không làm

- Không merge vào `main` khi người dùng chưa ra lệnh.
- Không chạy run thật tốn tiền (`auto` không có `--demo`) khi người dùng chưa yêu cầu.
- Không deploy.
