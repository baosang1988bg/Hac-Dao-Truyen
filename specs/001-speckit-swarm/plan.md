# Implementation Plan: Multi-Provider Agent Swarm

## Kiến trúc
```
CLI (python -m tools.swarm) ──► RunManager ──► Pipeline (thread) ──► Providers (httpx)
        │                           │                │                  ├─ anthropic (Messages API)
        ▼                           ▼                ▼                  └─ openai_compat (Gemini, xAI, OpenAI, Ollama)
  FastAPI server ◄── EventBus (JSONL) ◄── Budget / Sandbox tools / Git worktree
        │
        ▼
  dashboard/index.html (SSE)
```

## Quyết định kỹ thuật và lý giải dependency (Hiến pháp mục Governance)
| Quyết định | Lý do |
|---|---|
| **Không dùng LiteLLM** (báo cáo gốc đề xuất) | Gemini, xAI, OpenAI, Ollama đều có endpoint tương thích OpenAI; chỉ Anthropic cần adapter riêng. Tự viết ~200 dòng bằng `httpx` (đã có trong `requirements.txt`) thay vì kéo cả gói lớn. LiteLLM từng bị chèn mã độc trên PyPI (1.82.7/1.82.8, 24/03/2026) đánh cắp `.env` — đúng loại dữ liệu nhạy cảm của repo này. Adapter có giao diện chung nên thay bằng LiteLLM sau này vẫn dễ. |
| Cấu hình **TOML** (`agents.toml`) thay YAML | `tomllib` có sẵn trong Python 3.11 → không thêm dependency. |
| FastAPI + uvicorn + SSE | Đã có trong `requirements.txt`; SSE đủ cho luồng một chiều, không cần WebSocket. |
| Dashboard 1 file HTML, JS thuần | Không đụng build Vite của frontend chính; không cần npm. |
| Git worktree riêng cho mỗi run | Không chạm working tree người dùng; worktree chỉ chứa file đã track nên **không có `.env`**. |
| Công cụ agent là danh sách cố định (đọc/ghi/sửa file, tìm kiếm, `run_check`) | Không có shell tuỳ ý → không thể deploy hay đọc secret qua lệnh. |
| Giới hạn context Spec ~80k token (Architect 40k) | Gemini tính giá cao hơn khi prompt >200k token; ngân sách $2/run. |

## Vai trò và model (sửa trong `tools/swarm/agents.toml`)
| Vai trò | Model chính | Dự phòng |
|---|---|---|
| Spec Lead | `google/gemini-3.1-pro-preview` | `anthropic/claude-sonnet-5-5` |
| Architect (plan + tasks) | `anthropic/claude-sonnet-5-5` | `openai/gpt-5.6-terra` |
| Coder | `anthropic/claude-sonnet-5-5` | `openai/gpt-5.6-terra` |
| Adversarial QA | `xai/grok-4.5` | `openai/gpt-5.6-terra` |
| Local Healer | `ollama/qwen2.5-coder:7b` | `anthropic/claude-sonnet-5-5` |

Tên model và bảng giá lấy từ nguồn thứ ba ngày 2026-10-18 → **phải xác minh** trước khi dùng thật.

## Luồng
1. `prepare`: tạo `feature/NNN-slug` + worktree ở `../HacDaoTruyen-swarm/NNN-slug`.
2. `specify` → `specs/NNN-slug/spec.md` → **gate spec**.
3. `plan` → `plan.md` + `tasks.md` → **gate plan**.
4. `implement`: vòng tool-calling của Coder.
5. `qa`: Grok đọc spec + diff, trả JSON `verdict/findings`; finding `high/critical` → Coder sửa (tối đa 2 vòng).
6. `heal`: lint đỏ → Healer (Ollama) sửa; thất bại → model dự phòng.
7. `converge`: chạy lint, test frontend, (test worker nếu sửa `src/`), (pytest nếu sửa `.py`), build; đỏ → Coder sửa (tối đa 2 vòng).
8. `finish`: `git commit` trong worktree; báo nhánh, đường dẫn, chi phí. Không push.

## Kiểm thử
`tests/swarm/` — provider giả lập, chạy end-to-end trên repo git tạm; kiểm tra ngân sách, sandbox đường dẫn, lọc env, chuyển provider dự phòng, API server.
