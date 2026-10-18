# Tasks: Multi-Provider Agent Swarm

- [x] T1 Cấu hình `tools/swarm/agents.toml` + `config.py` (provider, model, giá, vai trò, ngân sách)
- [x] T2 `providers.py`: adapter `openai_compat` + `anthropic` + `fake`; chuỗi dự phòng
- [x] T3 `budget.py`: tính chi phí, chặn trước lời gọi vượt ngân sách
- [x] T4 `events.py`: EventBus ghi JSONL + snapshot trạng thái
- [x] T5 `sandbox.py`: công cụ file an toàn, `run_check` cố định, lọc env
- [x] T6 `workspace.py`: git worktree, diff, commit
- [x] T7 `context.py`: đóng gói codebase có giới hạn token
- [x] T8 `pipeline.py` + `prompts.py`: các bước + gate duyệt + vòng QA/heal/converge
- [x] T9 `server.py` + `dashboard/index.html`: API, SSE, token chống CSRF, giao diện live
- [x] T10 `cli.py`: `serve`, `auto`, `demo`, `check`
- [x] T11 Skill `/speckit-auto` cho Antigravity + Claude Code, launcher `speckit-auto.ps1`
- [x] T12 `docs/RUNBOOK_SWARM.md`
- [x] T13 Test `tests/swarm/` (pytest) — xanh
