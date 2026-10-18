# HacDaoTruyen Project Constitution

## Core Principles

### I. Multi-tier Architecture Integrity
- **Frontend (`frontend/`):** React 18 SPA với Vite và React Router v6. Sử dụng Functional Components + Hooks. Không tự ý thêm thư viện ngoài (như Tailwind, Redux, Zustand) khi chưa có sự đồng thuận. Quản lý state tập trung tại custom hooks / context.
- **Edge API (`src/index.js`):** Cloudflare Worker thuần JavaScript ESM. Tương tác D1 Database qua `env.DB`, R2 Bucket qua `env.CHAPTERS`.
- **Automation & Tools (`tools/`, `pipeline.py`):** Python 3.11+, tuân thủ kiểm tra an toàn SSRF (`security_utils.py`) và quy chuẩn crawl politeness.

### II. Production Safety First (NON-NEGOTIABLE)
- **Tuyệt đối không rò rỉ Secret:** Không commit hoặc in các giá trị từ `.env`, `credentials.json`, `key_status.json`, API tokens.
- **Cấm tự động Deploy:** Sandbox / Agent Loop **TUYỆT ĐỐI KHÔNG** được chạy lệnh `wrangler deploy` hoặc `npm run deploy`. Mọi thay đổi production phải qua review con người và pipeline GitHub Actions.
- **Rào chắn phải là kỹ thuật, không chỉ là lời dặn:** agent tự động (OpenHands) chạy trên bản clone không có secret/token ghi production; lệnh nguy hiểm bị chặn bởi `.openhands/hooks/block_dangerous.sh` (xem `docs/RUNBOOK_OPENHANDS.md`).
- **Bảo vệ R2 & D1:** Không bao giờ đẩy catalog nguồn (`novels/<slug>/catalog.json` có link crawl) lên Cloudflare R2. Mọi thay đổi schema D1 phải qua file migration.

### III. Strict Quality Gates (Definition of Done)
Mọi tính năng/sửa lỗi hoàn thành bắt buộc phải vượt qua toàn bộ các cổng kiểm tra sau:
1. **Lint Clean:** `npm run lint` chạy thành công không có lỗi và không có warning (`--max-warnings 0` trên ESLint 9 + `node --check src/index.js`).
2. **Unit Tests 100% Pass:** `npm test` (hoặc từng tầng tương ứng: `npm run test:frontend`, `npm run test:worker`, `npm run test:python`) phải pass toàn bộ.
3. **Build Success:** `npm run build:frontend` tạo bundle web `dist/` thành công.

### IV. Content & Naming Standards
- Tên truyện hiển thị (`"title"`) trong `novel.json`, D1 Database và UI bắt buộc luôn luôn là **Tiếng Việt**.
- Tên tiếng Trung gốc chỉ được lưu tại `"original_title"`. Tuyệt đối không ghi đè `"title"` thành tiếng Trung.
- Tiêu đề chương crawl về phải lọc sạch hậu tố phân trang (ví dụ `(1/2)`) trước khi lưu.

### V. Traceability & Agent Coordination
- Tuân thủ quy tắc phối hợp đa agent tại `.agents/AGENTS.md`.
- Mọi thay đổi kiến trúc hoặc chạm cấu hình production phải được ghi 1 dòng vào `.agents/WORKLOG.md`.

## Governance

- Bản Hiến pháp này là kim chỉ nam tối cao cho mọi agent (Antigravity, Claude Code, OpenHands) khi làm việc trên repo `HacDaoTruyen`.
- Mọi đề xuất thêm dependency mới (npm hoặc pip) phải được lý giải rõ ràng trong tài liệu `research.md` / `plan.md`.

**Version**: 1.1.0 | **Ratified**: 2026-10-18 | **Last Amended**: 2026-10-18
