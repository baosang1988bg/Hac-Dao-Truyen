# Feature Specification: Multi-Provider Agent Swarm (`/speckit-auto`) + Live Dashboard

**Feature Branch**: `feature/speckit-swarm`
**Created**: 2026-10-18
**Status**: Implemented (v1)
**Input**: Báo cáo `plans/BAO_CAO_TONG_HOP_SPEC_KIT_MULTI_AGENT_2026-10-18.md` mục 3 — "chỉ cần 1 lệnh `/speckit-auto`, hệ thống tự kích hoạt đội đa tác tử với dashboard theo dõi live, chia cho nhiều provider".

## Quyết định của người dùng (2026-10-18)
- Máy chạy chính: **Windows + RTX 4060** (Ollama local).
- Có API key: **Gemini, Claude, Grok, OpenAI**.
- Mức tự động: **dừng chờ duyệt sau Spec và sau Plan/Tasks**; phần Code → QA → sửa → kiểm thử chạy tự động.
- Ngân sách: **$2 / lần chạy** — vượt thì dừng và hỏi.

## User Scenarios

### US1 — Một lệnh chạy cả quy trình (P1)
Người dùng gõ `/speckit-auto <mô tả>` (Antigravity hoặc Claude Code) hoặc
`python -m tools.swarm auto "<mô tả>"`. Hệ thống tạo nhánh + worktree riêng, mở dashboard,
chạy Spec (Gemini) → **duyệt** → Plan + Tasks (Claude) → **duyệt** → Code (Claude) → QA (Grok)
→ sửa lỗi nhỏ (Ollama) → cổng chất lượng → commit cục bộ.

**Acceptance**
1. Given key hợp lệ, When chạy lệnh, Then dashboard mở và thẻ Spec Lead chuyển `RUNNING`.
2. Given spec.md đã sinh, When người dùng bấm *Yêu cầu sửa* kèm góp ý, Then Spec Lead chạy lại với góp ý đó.
3. Given cổng chất lượng xanh, Then có commit trên nhánh `feature/NNN-slug` trong worktree; **không push**.

### US2 — Theo dõi live (P1)
Dashboard hiển thị thẻ từng agent (vai trò, provider, model, trạng thái
`RUNNING/REVIEWING/COMPLETED/IDLE/WAITING/FAILED`), token + chi phí tích luỹ so với ngân sách,
luồng log bàn giao giữa agent, nội dung spec/plan/tasks/diff.

### US3 — An toàn chi phí và production (P1)
1. Given chi phí dự kiến của lời gọi tiếp theo vượt ngân sách, Then run dừng ở gate *Ngân sách*; người dùng chọn tăng thêm hoặc dừng.
2. Agent không chạy được lệnh shell tuỳ ý: chỉ các cổng kiểm tra cố định (lint, test, build).
3. Agent không đọc/ghi được file secret, `.git/`, `.github/workflows/`, `tools/swarm/`.
4. Lệnh kiểm tra chạy với biến môi trường đã lọc (không có API key, token Cloudflare).

### US4 — Provider dự phòng (P2)
Mỗi vai trò có chuỗi model dự phòng; thiếu key / lỗi mạng / Ollama tắt → chuyển model kế tiếp và ghi log.

### US5 — Chạy thử miễn phí (P2)
`python -m tools.swarm demo` chạy toàn bộ quy trình bằng provider giả lập để xem dashboard, không tốn tiền.

## Ngoài phạm vi (v1)
- Tự push / tạo PR / deploy (cố ý không làm).
- Chạy song song nhiều coder trên nhiều task.
