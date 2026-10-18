# BÁO CÁO TỔNG HỢP: KHỞI TẠO GITHUB SPEC KIT, RUNTIME OPENHANDS & ĐỊNH HƯỚNG MULTI-PROVIDER AGENT SWARM

> **Dành cho:** Codex & Claude Code review và tiếp quản phối hợp  
> **Repository:** `HacDaoTruyen`  
> **Nhánh làm việc:** `chore/spec-kit-setup` (tách từ `main`, chưa merge, KHÔNG chạm production)  
> **Ngày thực hiện:** 2026-10-18  
> **Môi trường thực thi:** Windows 11 Pro, Intel Core i5-14600K (14C/20T), 32GB RAM, NVIDIA GeForce RTX 4060 (8GB VRAM), SSD ổ E:.

---

## 1. TỔNG QUAN PHẠM VI CÔNG VIỆC ĐÃ HOÀN THÀNH

Trong phiên làm việc này, Antigravity Agent đã hoàn thành 5 nhóm nhiệm vụ cốt lõi:

1. **Khảo sát & Xử lý Blocker Repository:**
   - Đánh giá 10 tiêu chuẩn pilot của GitHub Spec Kit đối với `HacDaoTruyen`.
   - Bổ sung lệnh lint tập trung vào root [package.json](../package.json):
     ```json
     "lint": "npm run lint --prefix frontend && node --check src/index.js"
     ```
   - Tạo nhánh làm việc cô lập: `chore/spec-kit-setup`.

2. **Cài đặt & Khởi tạo GitHub Spec Kit:**
   - Cài đặt `specify-cli` v1.2.2.dev0 thông qua công cụ quản lý gói tốc độ cao `uv`.
   - Khởi tạo Spec Kit với integration chuẩn dành cho Antigravity (`agy`), đồng bộ 10 skills Spec Kit vào thư mục [`.agents/skills/`](../.agents/skills) (gồm `speckit-constitution`, `speckit-specify`, `speckit-plan`, `speckit-tasks`, `speckit-implement`, `speckit-converge`,...).
   - Soạn thảo và ban hành Hiến pháp dự án tại [`.specify/memory/constitution.md`](../.specify/memory/constitution.md):
     - Rào chắn an toàn: Cấm tuyệt đối chạy deploy production (`wrangler deploy`, `npm run deploy`) từ agent sandbox; cấm commit secret (`.env`, `credentials.json`, `key_status.json`); cấm đẩy catalog nguồn lên Cloudflare R2.
     - Quy chuẩn chất lượng (Definition of Done): Lint 0 lỗi (`--max-warnings 0`), syntax Worker hợp lệ (`node --check`), 100% unit tests pass, bundle Vite thành công.

3. **Cấu hình OpenHands Sandbox & Runbook Vận Hành** *(đã sửa sau review — xem mục 5)*:
   - [`AGENTS.md`](../AGENTS.md) ở gốc repo (OpenHands V1 và Codex tự nạp) thay cho `.openhands_instructions` (OpenHands V1 không đọc file này).
   - [`.openhands/hooks.json`](../.openhands/hooks.json): hook `PreToolUse` chặn cứng lệnh deploy/ghi D1-R2/đọc secret; hook `Stop` bắt `npm run lint` + `npm run test:frontend` xanh.
   - Runbook [`docs/RUNBOOK_OPENHANDS.md`](../docs/RUNBOOK_OPENHANDS.md): OpenHands 1.8 chạy trong WSL, mount **bản clone sạch** (không có secret), UI chỉ mở trên `127.0.0.1`.

4. **Thử Nghiệm Pilot Hoàn Chỉnh Theo Chu Trình Spec Kit:**
   - Tính năng thử nghiệm: **Nút cuộn lên đầu trang (Back to Top Button) mượt mà** trên trang chi tiết tiểu thuyết [`NovelPage.jsx`](../frontend/src/pages/NovelPage.jsx).
   - Đã sinh đầy đủ tài liệu chuẩn Spec Kit tại [`specs/scroll-to-top/`](../specs/scroll-to-top/):
     - `spec.md`: Đặc tả yêu cầu, hành vi người dùng, tiêu chuẩn A11y (phím Tab, aria-label).
     - `plan.md`: Thiết kế kiến trúc component, props, hooks, chiến lược kiểm thử.
     - `tasks.md`: Phân rã 4 tasks chi tiết có dependency rõ ràng.
   - Triển khai mã nguồn:
     - Tạo component tái sử dụng [`frontend/src/components/ui/ScrollToTopButton.jsx`](../frontend/src/components/ui/ScrollToTopButton.jsx).
     - Tạo module tiện ích [`frontend/src/utils/scroll.js`](../frontend/src/utils/scroll.js) (`shouldShowScrollToTop`, `scrollToTop`).
     - Tích hợp vào cuối trang [`frontend/src/pages/NovelPage.jsx`](../frontend/src/pages/NovelPage.jsx).
     - Viết bộ unit test mới [`frontend/tests/scroll-to-top.test.mjs`](../frontend/tests/scroll-to-top.test.mjs) (4/4 test cases pass).

5. **Nghiệm Thu Cổng Chất Lượng (Quality Gates) & WORKLOG:**
   - `npm run lint`: **PASS 100%** (0 errors, 0 warnings).
   - `npm run test:frontend`: **PASS 34/34 tests** (bao gồm 4 tests mới; sau review: 35/35).
   - `npm run build:frontend`: **PASS 100%** (Vite build thành công trong 2.12s, kích thước chunk tối ưu).
   - Cập nhật nhật ký phối hợp tại [`.agents/WORKLOG.md`](../.agents/WORKLOG.md).

---

## 2. DANH MỤC FILE THAY ĐỔI & THÊM MỚI TRÊN NHÁNH `chore/spec-kit-setup`

### A. Cấu hình & Tài liệu quy trình
- [x] [package.json](../package.json): Thêm script `"lint": "npm run lint --prefix frontend && node --check src/index.js"`.
- [x] [CLAUDE.md](../CLAUDE.md): Bổ sung mục "Quy trình phát triển tính năng mới (GitHub Spec Kit)".
- [x] [plans/KE_HOACH_TRIEN_KHAI_OPENHANDS_SPEC_KIT.md](../plans/KE_HOACH_TRIEN_KHAI_OPENHANDS_SPEC_KIT.md): Kế hoạch 5 giai đoạn chi tiết.
- [x] [AGENTS.md](../AGENTS.md) + [.openhands/](../.openhands/hooks.json) (hooks, setup.sh): bối cảnh repo và rào chắn kỹ thuật cho OpenHands (thay `.openhands_instructions`).
- [x] [docs/RUNBOOK_OPENHANDS.md](../docs/RUNBOOK_OPENHANDS.md): Lệnh chạy Docker và kết nối model cho OpenHands.
- [x] [.agents/WORKLOG.md](../.agents/WORKLOG.md): Dòng ghi nhận nhật ký bàn giao.

### B. Hạ tầng GitHub Spec Kit
- [x] [.specify/memory/constitution.md](../.specify/memory/constitution.md): Bản Hiến pháp dự án chuẩn hóa.
- [x] [.specify/](../.specify): Chứa templates, scripts (`ps`), workflows của Spec Kit.
- [x] `.agents/skills/speckit-*/SKILL.md` (Antigravity, script PowerShell) và `.claude/skills/speckit-*/SKILL.md` (Claude Code, script bash `.specify/scripts/bash/` — bổ sung sau review): 10 skills:
  - `speckit-constitution`, `speckit-specify`, `speckit-plan`, `speckit-tasks`, `speckit-implement`, `speckit-converge`, `speckit-clarify`, `speckit-analyze`, `speckit-checklist`, `speckit-taskstoissues`.

### C. Mã nguồn tính năng Pilot (`ScrollToTopButton`)
- [x] [specs/scroll-to-top/spec.md](../specs/scroll-to-top/spec.md): Tài liệu đặc tả.
- [x] [specs/scroll-to-top/plan.md](../specs/scroll-to-top/plan.md): Kế hoạch kỹ thuật.
- [x] [specs/scroll-to-top/tasks.md](../specs/scroll-to-top/tasks.md): Danh sách tasks (4/4 hoàn thành).
- [x] [frontend/src/components/ui/ScrollToTopButton.jsx](../frontend/src/components/ui/ScrollToTopButton.jsx): UI component với safe area, backdrop-filter, ChevronUp icon.
- [x] [frontend/src/utils/scroll.js](../frontend/src/utils/scroll.js): Logic kiểm tra threshold và cuộn trang an toàn.
- [x] [frontend/src/pages/NovelPage.jsx](../frontend/src/pages/NovelPage.jsx): Gắn component vào cuối trang chi tiết truyện.
- [x] [frontend/tests/scroll-to-top.test.mjs](../frontend/tests/scroll-to-top.test.mjs): Unit test Node native runner.

---

## 3. THIẾT KẾ KIẾN TRÚC GIAI ĐOẠN TIẾP THEO: MULTI-PROVIDER AGENT SWARM

> **Trạng thái (2026-10-18, tối):** đã triển khai v1 tại `tools/swarm/` (nhánh `feature/speckit-swarm`) —
> xem `specs/001-speckit-swarm/` và `docs/RUNBOOK_SWARM.md`. Khác thiết kế dưới đây: không dùng LiteLLM
> (tự viết adapter bằng `httpx`), cấu hình là `tools/swarm/agents.toml` thay cho `agents.yml`.

Người dùng đã định hướng rõ giai đoạn kế tiếp: **Chỉ cần 1 lệnh duy nhất (`/speckit-auto`), hệ thống tự kích hoạt một đội ngũ Đa tác tử (Multi-Agent Swarm) với giao diện Dashboard trực quan theo dõi Live Status từng Agent, phân chia cho nhiều Provider khác nhau**.

### 3.1. Phân bổ chuyên biệt theo sở trường của từng Provider

```
                     ┌──────────────────────────────────────────────┐
                     │ 👤 USER REQUEST (1 Lệnh: /speckit-auto)      │
                     └──────────────────────┬───────────────────────┘
                                            ▼
                     ┌──────────────────────────────────────────────┐
                     │ 👑 ORCHESTRATOR / SWARM LEAD                 │
                     │ (Điều phối tổng thể, cập nhật Live Dashboard)│
                     └──────┬───────────────┬───────────────┬───────┘
                            │               │               │
       ┌────────────────────┘               │               └────────────────────┐
       ▼                                    ▼                                    ▼
┌───────────────────────┐       ┌───────────────────────┐       ┌───────────────────────┐
│ 🎯 SPEC LEAD AGENT     │       │ 🏗️ ARCH & CODER AGENT │       │ 🧪 ADVERSARIAL QA     │
│ Model: Gemini 3.x Pro │       │ Model: Claude Sonnet  │       │ Model: xAI Grok 4.x   │
│ Context: ~1M tokens   │       │ 5.5                   │       │ Nhiệm vụ: Phản biện,  │
│ Nhiệm vụ: Nuốt toàn bộ│       │ Nhiệm vụ: Thiết kế    │       │ bẻ gãy code, tìm edge │
│ codebase HacDaoTruyen │       │ React/Worker, viết    │       │ cases & kiểm tra bảo  │
│ và lập Spec chuẩn xác │       │ code logic chính xác  │       │ mật SSRF              │
└───────────────────────┘       └───────────┬───────────┘       └───────────────────────┘
                                            │
                                            ▼
                                ┌───────────────────────┐
                                │ 🔧 LOCAL QUICK-FIXER  │
                                │ Model: Qwen2.5-Coder  │
                                │ 7B (Ollama, RTX 4060) │
                                │ Nhiệm vụ: Sửa lỗi     │
                                │ ESLint/formatting     │
                                │ miễn phí 100% token   │
                                └───────────────────────┘
```

### 3.2. Cấu trúc cấu hình Đa Provider qua LiteLLM Gateway (`agents.yml`)
Để gọi linh hoạt **Claude, Gemini, Grok, OpenAI, Ollama** trong cùng một runtime, kiến trúc sử dụng **LiteLLM** làm Unified Gateway:

```yaml
version: '1.0'
providers:
  google:
    api_key_env: GEMINI_API_KEY
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
  xai:
    api_key_env: XAI_API_KEY
  openai:
    api_key_env: OPENAI_API_KEY
  ollama:
    api_base: http://localhost:11434

roles:
  # Tên model kiểm tra ngày 2026-10-18 — xác minh lại trên trang models của từng provider
  # trước khi dùng (Gemini/xAI đổi tên thường xuyên). Bản cũ dùng gemini-1.5-pro,
  # claude-3-5-sonnet-20241022, grok-2 — đều là đời cũ, không dùng nữa.
  spec_agent:
    model: gemini/gemini-3.1-pro-preview
    temperature: 0.2
    description: "Khảo sát toàn bộ context codebase và tạo spec.md"

  architect_agent:
    model: anthropic/claude-sonnet-5-5
    temperature: 0.1
    description: "Lập kế hoạch kỹ thuật plan.md và chia tasks.md"

  coder_agent:
    model: anthropic/claude-sonnet-5-5
    temperature: 0.1
    description: "Triển khai mã nguồn chính xác theo tasks.md"

  tester_agent:
    model: xai/grok-4.5          # xác minh tên chính xác trên docs.x.ai
    temperature: 0.3
    description: "Soi lỗi phản biện, edge cases, bảo mật và test suite"

  local_healer:
    model: ollama/qwen2.5-coder:7b
    temperature: 0.0
    description: "Chạy trên GPU RTX 4060 để auto-fix lỗi lint/cú pháp nhỏ"
```

### 3.3. Thiết kế Live Dashboard UI (Trực quan hóa thời gian thực)
Giao diện trực quan tương tác (Generative UI / Live Panel) sẽ hiển thị:
- **Từng thẻ Agent (Cards):** Có avatar, tên vai trò, logo nhà cung cấp (Google, Anthropic, xAI, Local GPU).
- **Trạng thái động (Status Badges):** `🟢 RUNNING`, `🟡 REVIEWING`, `🔵 COMPLETED`, `💤 IDLE`.
- **Thanh đo Token & Chi phí tích lũy:** Giúp người dùng theo dõi chi phí theo thời gian thực.
- **Log Streaming Box:** Xem được hội thoại chuyển giao task giữa các Agent.

---

## 4. KHUYẾN NGHỊ CHO CLAUDE CODE VÀ CODEX KHI REVIEW

1. **Kiểm tra tính tương thích:**
   - Toàn bộ thay đổi mã nguồn nằm gọn trong nhánh `chore/spec-kit-setup`.
   - Script `"lint"` mới trong root `package.json` chạy tốt trên Linux; CI (`ci.yml`, job frontend) đã chuyển sang gọi `npm run lint` để kiểm thêm `node --check src/index.js`.
2. **Kiểm tra tính cô lập:**
   - Không có file secret nào bị theo dõi (`git status --ignored` bảo đảm `.env`, `credentials.json`, `key_status.json` được ignore).
   - Component `ScrollToTopButton` được cô lập trong `frontend/src/components/ui/`, không làm ảnh hưởng đến luồng đọc hay API của `NovelPage.jsx`.
3. **Kế hoạch merge nhánh `chore/spec-kit-setup`:**
   - Sau khi Claude Code / Codex review xong, có thể tạo PR hoặc merge trực tiếp nhánh này vào `main` khi người dùng đồng ý.
   - Khi đã merge vào `main`, `/speckit-*` dùng được trên cả Antigravity (Windows, PowerShell) và Claude Code (Mac/Linux, bash). OpenHands không có slash command — agent đọc template trong `.specify/` theo runbook.

---

## 5. SỬA SAU REVIEW (Claude Cowork, 2026-10-18)

| # | Vấn đề phát hiện | Đã sửa |
|---|---|---|
| 1 | Runbook mount nguyên `E:\AOO\HacDaoTruyen` (có `.env`, `credentials.json`, `key_status.json`, phiên `wrangler`) vào container — "cấm deploy" chỉ là lời dặn | Mount bản clone sạch qua `SANDBOX_VOLUMES`; không đưa token ghi production vào sandbox; agent không push |
| 2 | Không có rào chắn kỹ thuật | `.openhands/hooks/block_dangerous.sh` (PreToolUse, exit 2 = chặn) + test `test_block_dangerous.sh` |
| 3 | `-p 3000:3000` mở UI ra LAN; image `openhands:0.14` rất cũ; dùng named pipe Windows | `-p 127.0.0.1:3000:3000`, `openhands:1.8` chạy trong WSL theo docs chính thức |
| 4 | `.openhands_instructions` không được OpenHands V1 đọc | `AGENTS.md` ở gốc + `.openhands/setup.sh` (cài Node 22) + Stop hook cổng chất lượng |
| 5 | Model cũ (`gemini-1.5-pro`, `claude-3-5-sonnet-20241022`, `grok-2`) | Cập nhật mục 3.2 và runbook, kèm ghi chú xác minh |
| 6 | `/speckit-*` chỉ có cho Antigravity + script PowerShell, nhưng CLAUDE.md quảng cáo cho Claude Code | Thêm `.claude/skills/speckit-*` + `.specify/scripts/bash/` (cùng bản spec-kit 1.2.2.dev0), cập nhật `integration.json` |
| 7 | `ScrollToTopButton` hard-code màu tối, `transition` không có hover | Class `.scroll-to-top-btn` dùng biến theme, có hover/active/focus-visible, tôn trọng `prefers-reduced-motion` (+1 test) |
| 8 | CI chỉ lint frontend | `ci.yml` gọi `npm run lint` (gồm `node --check src/index.js`) |
| 9 | Link `file:///e:/...` chỉ mở được trên máy Windows | Đổi thành link tương đối |

Kiểm tra: `npm run lint` sạch, `npm run test:frontend` 35/35, `vite build` thành công, hook chặn 28/28 case.
