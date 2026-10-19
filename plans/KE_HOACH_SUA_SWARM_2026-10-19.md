# Kế hoạch sửa Swarm sau review commit `14fb9ae` (2026-10-19)

> Người làm: claude-cowork@mac · Phạm vi: `tools/swarm/`, `tests/swarm/`, tài liệu swarm,
> WORKLOG. **KHÔNG chạm production** (không deploy, không D1/R2, không đổi biến `HACDAO_*`).

## Bối cảnh

Commit `14fb9ae` (Antigravity) cho `RunManager` đọc lại lịch sử run từ
`.swarm/runs/*/events.jsonl` để dashboard hiện cả run cũ sau khi tắt server. Ý tưởng đúng,
nhưng không có test, và review đã tái hiện được 6 lỗi (mục A). Cùng lúc, swarm đã vào `main`
nên các tài liệu còn chỉ tới nhánh `feature/speckit-swarm` bị lỗi thời (mục B).

## A. Sửa code

| # | Lỗi | Cách sửa |
|---|---|---|
| A1 | Run bị ngắt giữa chừng (server tắt khi đang `running`/`waiting`) nạp lại vẫn ở trạng thái đó → nút Duyệt trả 409, Huỷ trả `ok` nhưng không làm gì | Run nạp từ đĩa chưa có `run_finished` được đánh dấu `interrupted` (chỉ trong bộ nhớ, không ghi đè log), gate đang mở chuyển `interrupted`. `cancel()` trả `False` với run chỉ-đọc → API trả 409 có thông báo rõ |
| A2 | Đoán run demo sai (`not branch` → demo; `"demo" in run_id` không bao giờ đúng) | Ghi cờ `demo` vào event `run_started` (và một event `run_created` ngay khi tạo run). Khi nạp: đọc cờ này; log cũ không có cờ → coi là **không** demo |
| A3 | `created` = lúc đọc file | Ghi `created` vào `run_created`; log cũ → suy từ `run_id` (`YYYYmmdd-HHMMSS`) |
| A4 | Dòng log hỏng bị bỏ qua làm lệch `seq` so với vị trí trong list → `since()`/SSE sót event | Thêm `EventBus.load()` đánh lại `seq` liên tục 1..n khi nạp |
| A5 | `run_id` từ URL ghép thẳng vào đường dẫn | Kiểm tra regex `^\d{8}-\d{6}-[0-9a-f]{4}$` ở `RunManager.get()` |
| A6 | Truy cập `bus._events`/`_reduce` từ ngoài; `cancel()` không khoá; nạp trùng khi gọi song song; RAM giữ mọi run cũ | Dùng `EventBus.load()`; khoá đúng chỗ (double-check khi chèn); `list()` chỉ đọc tóm tắt nhẹ, không giữ toàn bộ artifact của run cũ trong bộ nhớ |
| A7 | `speckit-auto.ps1` tự đổi cấu hình git **toàn máy** (`--global core.longpaths`) | Đổi thành cấu hình mức repo (`git config core.longpaths true`) — `workspace.git()` đã truyền `-c core.longpaths=true` cho mọi lệnh |

Bổ sung test trong `tests/swarm/test_swarm_core.py` cho A1–A6 (nạp lại run đã xong, run bị
ngắt, run lỗi trước khi tạo nhánh, dòng hỏng, `run_id` không hợp lệ, `created`, API cancel/gate).

## B. Cập nhật tài liệu

- `docs/HUONG_DAN_CHAY_THU_SWARM_WINDOWS.md`, `.agents/tasks/2026-10-18-antigravity-chay-thu-swarm.md`:
  swarm đã ở `main` → bỏ `git checkout feature/speckit-swarm`, ghi trạng thái hiện tại.
- Hai file chưa commit ở thư mục gốc → chuyển vào `docs/` (`docs/CHECKLIST_WINDOWS_SWARM.md`,
  `docs/HUONG_DAN_AP_DUNG_SWARM_DU_AN_KHAC.md`), sửa tham chiếu nhánh.
- `plans/BAO_CAO_TONG_HOP_SPEC_KIT_MULTI_AGENT_2026-10-18.md`: thêm ghi chú trạng thái 2026-10-19.
- `specs/001-speckit-swarm/spec.md` giữ nguyên (ghi lịch sử nhánh lúc đặc tả).
- `.agents/WORKLOG.md`: bổ sung dòng còn thiếu cho `14fb9ae` + dòng của phiên này.

## C. Verify

`pytest tests/swarm -q` xanh (40 test cũ + test mới); chạy lại script tái hiện lỗi;
`py_compile` toàn bộ `tools/swarm`. Commit nhỏ theo từng việc trên `main` **local**
(sandbox không có quyền push) — người dùng `git pull --rebase && git push`.

## D. Việc còn lại sau phiên (cần người dùng quyết)

0. Kiểm tra Cloudflare có tự deploy khi `main` nhận commit swarm hôm 18/10 không (xem mục E).

1. Xác nhận việc merge swarm vào `main` (task gốc yêu cầu chờ lệnh).
2. Antigravity vẫn chưa ghi kết quả Bước 1–4 (pytest trên Windows, demo qua `.ps1`, `check --ping`).
3. Còn treo từ 16/10: migration `012` remote + `npm run deploy` (chạm production, cần duyệt);
   task sửa metadata EPUB của Antigravity.
4. Dọn nhánh local đã merge (`feature/speckit-swarm`, `chore/spec-kit-setup`).

## E. Kết quả thực hiện (2026-10-19)

Đã làm xong A1–A7 và B. Thiết kế chốt: `EventBus.load()` dựng lại bus **chỉ đọc** (log_path
= None) nên mọi đánh dấu khi nạp (`run_finished status=interrupted`) chỉ nằm trong bộ nhớ, file
log giữ nguyên. Khi có `run_finished`, mọi gate còn `open` chuyển sang trạng thái kết thúc — áp
dụng cả ở `EventBus._reduce` lẫn dashboard (`apply()`), nên dashboard không còn hiện nút Duyệt cho
run đã chết. `Pipeline.meta` + `pipe.demo` được ghi vào `run_started` (`demo`, `created`). API
`POST /cancel` trả 409 với run chỉ-đọc hoặc đã kết thúc.

Verify: `pytest tests/swarm` **51/51 xanh** (40 cũ + 11 mới trong `tests/swarm/test_swarm_history.py`;
chạy file test mới trên code cũ thì đỏ), `py_compile tools/swarm/*.py`, cú pháp JS của dashboard.
Chưa verify trên Windows/PowerShell (sandbox Linux) — thuộc bước 1–3 của Antigravity.

Lưu ý thêm: `docs/CHECKLIST_WINDOWS_SWARM.md` ghi "merge vào `main` = Cloudflare tự deploy
production" (Workers Builds cấu hình ở dashboard Cloudflare, không thấy trong repo). Nếu đúng, việc
đưa nhánh lên `main` hôm 18/10 đã kéo theo deploy cả `ScrollToTopButton` (frontend) — người dùng
nên kiểm tra tab Deployments của Worker.
