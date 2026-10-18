---
name: "speckit-auto"
description: "Chạy trọn quy trình Spec Kit bằng đội đa tác tử nhiều provider (Gemini viết spec, Claude lập plan + code, Grok phản biện QA, Ollama sửa lint) kèm Live Dashboard và 2 điểm duyệt (sau spec, sau plan)."
argument-hint: "Mô tả tính năng cần làm (tiếng Việt)"
user-invocable: true
disable-model-invocation: true
---

## User Input

```text
$ARGUMENTS
```

## Việc cần làm

1. Nếu `$ARGUMENTS` rỗng: hỏi người dùng mô tả tính năng, rồi dừng.
2. Từ thư mục gốc repo, chạy lệnh sau **ở chế độ nền** (đây là server chạy lâu, không chờ nó kết thúc):
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File tools/swarm/speckit-auto.ps1 "$ARGUMENTS"`
   - macOS/Linux: `python -m tools.swarm auto "$ARGUMENTS"`
3. Đọc output đầu tiên, lấy dòng `Dashboard: http://127.0.0.1:…/#token=…` và đưa nguyên link cho người dùng.
   Nếu có cảnh báo thiếu key, báo lại (vai trò đó sẽ dùng model dự phòng).
4. Nói rõ cho người dùng:
   - Quy trình sẽ DỪNG chờ họ bấm **Duyệt / Yêu cầu sửa / Dừng** trên dashboard sau spec.md và sau plan.md + tasks.md.
   - Ngân sách mặc định $2/run; sắp vượt thì dashboard hỏi tăng thêm hay dừng.
   - Kết quả là commit trên nhánh `feature/NNN-…` trong worktree `../HacDaoTruyen-swarm/NNN-…`; **không tự push**.
5. KHÔNG tự duyệt gate thay người dùng, KHÔNG push, KHÔNG deploy.

Chạy thử không tốn tiền: `python -m tools.swarm demo`. Hướng dẫn đầy đủ: `docs/RUNBOOK_SWARM.md`; chạy thử lần đầu trên Windows: `docs/HUONG_DAN_CHAY_THU_SWARM_WINDOWS.md`.
