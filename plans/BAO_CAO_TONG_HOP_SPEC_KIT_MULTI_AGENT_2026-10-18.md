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
   - Bổ sung lệnh lint tập trung vào root [package.json](file:///e:/AOO/HacDaoTruyen/package.json):
     ```json
     "lint": "npm run lint --prefix frontend && node --check src/index.js"
     ```
   - Tạo nhánh làm việc cô lập: `chore/spec-kit-setup`.

2. **Cài đặt & Khởi tạo GitHub Spec Kit:**
   - Cài đặt `specify-cli` v1.2.2.dev0 thông qua công cụ quản lý gói tốc độ cao `uv`.
   - Khởi tạo Spec Kit với integration chuẩn dành cho Antigravity (`agy`), đồng bộ 10 skills Spec Kit vào thư mục [`.agents/skills/`](file:///e:/AOO/HacDaoTruyen/.agents/skills) (gồm `speckit-constitution`, `speckit-specify`, `speckit-plan`, `speckit-tasks`, `speckit-implement`, `speckit-converge`,...).
   - Soạn thảo và ban hành Hiến pháp dự án tại [`.specify/memory/constitution.md`](file:///e:/AOO/HacDaoTruyen/.specify/memory/constitution.md):
     - Rào chắn an toàn: Cấm tuyệt đối chạy deploy production (`wrangler deploy`, `npm run deploy`) từ agent sandbox; cấm commit secret (`.env`, `credentials.json`, `key_status.json`); cấm đẩy catalog nguồn lên Cloudflare R2.
     - Quy chuẩn chất lượng (Definition of Done): Lint 0 lỗi (`--max-warnings 0`), syntax Worker hợp lệ (`node --check`), 100% unit tests pass, bundle Vite thành công.

3. **Cấu hình OpenHands Sandbox & Runbook Vận Hành:**
   - Tạo file [`.openhands_instructions`](file:///e:/AOO/HacDaoTruyen/.openhands_instructions) ở thư mục gốc để rào chắn an toàn khi OpenHands chạy container.
   - Soạn thảo Runbook chi tiết tại [`docs/RUNBOOK_OPENHANDS.md`](file:///e:/AOO/HacDaoTruyen/docs/RUNBOOK_OPENHANDS.md) hướng dẫn khởi động OpenHands qua Docker Desktop (WSL2) mount thư mục `E:\AOO\HacDaoTruyen`.

4. **Thử Nghiệm Pilot Hoàn Chỉnh Theo Chu Trình Spec Kit:**
   - Tính năng thử nghiệm: **Nút cuộn lên đầu trang (Back to Top Button) mượt mà** trên trang chi tiết tiểu thuyết [`NovelPage.jsx`](file:///e:/AOO/HacDaoTruyen/frontend/src/pages/NovelPage.jsx).
   - Đã sinh đầy đủ tài liệu chuẩn Spec Kit tại [`specs/scroll-to-top/`](file:///e:/AOO/HacDaoTruyen/specs/scroll-to-top/):
     - `spec.md`: Đặc tả yêu cầu, hành vi người dùng, tiêu chuẩn A11y (phím Tab, aria-label).
     - `plan.md`: Thiết kế kiến trúc component, props, hooks, chiến lược kiểm thử.
     - `tasks.md`: Phân rã 4 tasks chi tiết có dependency rõ ràng.
   - Triển khai mã nguồn:
     - Tạo component tái sử dụng [`frontend/src/components/ui/ScrollToTopButton.jsx`](file:///e:/AOO/HacDaoTruyen/frontend/src/components/ui/ScrollToTopButton.jsx).
     - Tạo module tiện ích [`frontend/src/utils/scroll.js`](file:///e:/AOO/HacDaoTruyen/frontend/src/utils/scroll.js) (`shouldShowScrollToTop`, `scrollToTop`).
     - Tích hợp vào cuối trang [`frontend/src/pages/NovelPage.jsx`](file:///e:/AOO/HacDaoTruyen/frontend/src/pages/NovelPage.jsx).
     - Viết bộ unit test mới [`frontend/tests/scroll-to-top.test.mjs`](file:///e:/AOO/HacDaoTruyen/frontend/tests/scroll-to-top.test.mjs) (4/4 test cases pass).

5. **Nghiệm Thu Cổng Chất Lượng (Quality Gates) & WORKLOG:**
   - `npm run lint`: **PASS 100%** (0 errors, 0 warnings).
   - `npm run test:frontend`: **PASS 34/34 tests** (bao gồm 4 tests mới).
   - `npm run build:frontend`: **PASS 100%** (Vite build thành công trong 2.12s, kích thước chunk tối ưu).
   - Cập nhật nhật ký phối hợp tại [`.agents/WORKLOG.md`](file:///e:/AOO/HacDaoTruyen/.agents/WORKLOG.md).

---

## 2. DANH MỤC FILE THAY ĐỔI & THÊM MỚI TRÊN NHÁNH `chore/spec-kit-setup`

### A. Cấu hình & Tài liệu quy trình
- [x] [package.json](file:///e:/AOO/HacDaoTruyen/package.json): Thêm script `"lint": "npm run lint --prefix frontend && node --check src/index.js"`.
- [x] [CLAUDE.md](file:///e:/AOO/HacDaoTruyen/CLAUDE.md): Bổ sung mục "Quy trình phát triển tính năng mới (GitHub Spec Kit)".
- [x] [plans/KE_HOACH_TRIEN_KHAI_OPENHANDS_SPEC_KIT.md](file:///e:/AOO/HacDaoTruyen/plans/KE_HOACH_TRIEN_KHAI_OPENHANDS_SPEC_KIT.md): Kế hoạch 5 giai đoạn chi tiết.
- [x] [.openhands_instructions](file:///e:/AOO/HacDaoTruyen/.openhands_instructions): Hướng dẫn bối cảnh và cấm deploy dành cho OpenHands Docker container.
- [x] [docs/RUNBOOK_OPENHANDS.md](file:///e:/AOO/HacDaoTruyen/docs/RUNBOOK_OPENHANDS.md): Lệnh chạy Docker và kết nối model cho OpenHands.
- [x] [.agents/WORKLOG.md](file:///e:/AOO/HacDaoTruyen/.agents/WORKLOG.md): Dòng ghi nhận nhật ký bàn giao.

### B. Hạ tầng GitHub Spec Kit
- [x] [.specify/memory/constitution.md](file:///e:/AOO/HacDaoTruyen/.specify/memory/constitution.md): Bản Hiến pháp dự án chuẩn hóa.
- [x] [.specify/](file:///e:/AOO/HacDaoTruyen/.specify): Chứa templates, scripts (`ps`), workflows của Spec Kit.
- [x] `.agents/skills/speckit-*/SKILL.md`: 10 skills tích hợp tự động cho Antigravity / Claude Code:
  - `speckit-constitution`, `speckit-specify`, `speckit-plan`, `speckit-tasks`, `speckit-implement`, `speckit-converge`, `speckit-clarify`, `speckit-analyze`, `speckit-checklist`, `speckit-taskstoissues`.

### C. Mã nguồn tính năng Pilot (`ScrollToTopButton`)
- [x] [specs/scroll-to-top/spec.md](file:///e:/AOO/HacDaoTruyen/specs/scroll-to-top/spec.md): Tài liệu đặc tả.
- [x] [specs/scroll-to-top/plan.md](file:///e:/AOO/HacDaoTruyen/specs/scroll-to-top/plan.md): Kế hoạch kỹ thuật.
- [x] [specs/scroll-to-top/tasks.md](file:///e:/AOO/HacDaoTruyen/specs/scroll-to-top/tasks.md): Danh sách tasks (4/4 hoàn thành).
- [x] [frontend/src/components/ui/ScrollToTopButton.jsx](file:///e:/AOO/HacDaoTruyen/frontend/src/components/ui/ScrollToTopButton.jsx): UI component với safe area, backdrop-filter, ChevronUp icon.
- [x] [frontend/src/utils/scroll.js](file:///e:/AOO/HacDaoTruyen/frontend/src/utils/scroll.js): Logic kiểm tra threshold và cuộn trang an toàn.
- [x] [frontend/src/pages/NovelPage.jsx](file:///e:/AOO/HacDaoTruyen/frontend/src/pages/NovelPage.jsx): Gắn component vào cuối trang chi tiết truyện.
- [x] [frontend/tests/scroll-to-top.test.mjs](file:///e:/AOO/HacDaoTruyen/frontend/tests/scroll-to-top.test.mjs): Unit test Node native runner.

---

## 3. THIẾT KẾ KIẾN TRÚC GIAI ĐOẠN TIẾP THEO: MULTI-PROVIDER AGENT SWARM

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
│ Model: Gemini 1.5 Pro │       │ Model: Claude 3.5     │       │ Model: xAI Grok-2     │
│ Context: 2M tokens    │       │ Sonnet                │       │ Nhiệm vụ: Phản biện,  │
│ Nhiệm vụ: Nuốt toàn bộ│       │ Nhiệm vụ: Thiết kế    │       │ bẻ gãy code, tìm edge │
│ codebase HacDaoTruyen │       │ React/Worker, viết    │       │ cases & kiểm tra bảo  │
│ và lập Spec chuẩn xác │       │ code logic chính xác  │       │ mật SSRF              │
└───────────────────────┘       └───────────┬───────────┘       └───────────────────────┘
                                            │
                                            ▼
                                ┌───────────────────────┐
                                │ 🔧 LOCAL QUICK-FIXER  │
                                │ Model: Qwen 2.5 Coder │
                                │ (Ollama trên RTX 4060)│
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
  spec_agent:
    model: gemini/gemini-1.5-pro
    temperature: 0.2
    description: "Khảo sát toàn bộ context codebase và tạo spec.md"

  architect_agent:
    model: claude-3-5-sonnet-20241022
    temperature: 0.1
    description: "Lập kế hoạch kỹ thuật plan.md và chia tasks.md"

  coder_agent:
    model: claude-3-5-sonnet-20241022
    temperature: 0.1
    description: "Triển khai mã nguồn chính xác theo tasks.md"

  tester_agent:
    model: xai/grok-2
    temperature: 0.3
    description: "Soi lỗi phản biện, edge cases, bảo mật và test suite"

  local_healer:
    model: ollama/qwen2.5:7b
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
   - Script `"lint"` mới trong root `package.json` hoàn toàn an toàn và chạy tốt trong môi trường CI Linux (`node --check` + `eslint`).
2. **Kiểm tra tính cô lập:**
   - Không có file secret nào bị theo dõi (`git status --ignored` bảo đảm `.env`, `credentials.json`, `key_status.json` được ignore).
   - Component `ScrollToTopButton` được cô lập trong `frontend/src/components/ui/`, không làm ảnh hưởng đến luồng đọc hay API của `NovelPage.jsx`.
3. **Kế hoạch merge nhánh `chore/spec-kit-setup`:**
   - Sau khi Claude Code / Codex review xong, có thể tạo PR hoặc merge trực tiếp nhánh này vào `main` khi người dùng đồng ý.
   - Khi đã merge vào `main`, các skill `/speckit-*` sẽ trở thành chuẩn phát triển mặc định của repository `HacDaoTruyen`.
