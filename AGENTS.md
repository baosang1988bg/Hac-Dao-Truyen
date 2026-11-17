# HacDaoTruyen — hướng dẫn cho agent (OpenHands, Codex, …)

File này được OpenHands và Codex tự nạp. Quy tắc đầy đủ nằm ở `.agents/AGENTS.md`
(phối hợp nhiều agent, ghi production chỉ qua GitHub Actions) — ĐỌC TRƯỚC TIÊN.
Hiến pháp Spec Kit: `.specify/memory/constitution.md`.

## Repo gồm gì
- `frontend/`: React 18 SPA (Vite, React Router v6).
- `src/index.js`: Cloudflare Worker ESM (D1 = `env.DB`, R2 = `env.CHAPTERS`).
- Python 3.11 ở gốc và `tools/`: crawl + dịch truyện Trung → Việt.
- `specs/<feature>/`: đặc tả theo GitHub Spec Kit (`spec.md`, `plan.md`, `tasks.md`).
- `tools/swarm/`: Multi-Provider Agent Swarm (`/speckit-auto`) + Live Dashboard — xem `docs/RUNBOOK_SWARM.md`.

## Cấm tuyệt đối (agent tự động)
- Deploy hoặc ghi production: `npm run deploy`, `wrangler deploy`, `deploy.bat`,
  `migrate_to_cloudflare.py`, `wrangler d1 … --remote`, `wrangler r2 object put/delete`,
  `gh workflow run`, `gh variable set`, `gh secret set`.
- Đọc, in hoặc commit secret: `.env`, `.dev.vars`, `credentials.json`, `key_status.json`.
- Commit/push thẳng lên `main`, `git push --force`. Chỉ làm trên nhánh `feature/…` hoặc `chore/…`.
- Đổi `"title"` trong `novel.json` sang tiếng Trung (tên Trung chỉ ở `"original_title"`).

Khi chạy trong OpenHands, các lệnh trên còn bị chặn cứng bởi `.openhands/hooks/block_dangerous.sh`.

## Công cụ dịch ngược REA (MCP)
- MCP server `rea` khai báo ở `.mcp.json` (`npx -y rea-agents@6.7.0 mcp`, cần Node >=22.19);
  skill đi kèm ở `.claude/skills/reverse-engineer-anything/` và `.agents/skills/reverse-engineer-anything/` (giữ 2 bản giống nhau).
- Chỉ dùng để phân tích artifact đã phát hành mà mình có quyền (web/app đối thủ, APK, HAR capture…),
  KHÔNG dùng để phân tích source của chính repo này. Antigravity (Windows) không đọc `.mcp.json`:
  chạy `npx rea-agents@6.7.0 setup --client antigravity` trên máy đó.

## Cổng chất lượng (giống CI `.github/workflows/ci.yml`)
1. `npm run lint` — ESLint frontend `--max-warnings 0` + `node --check src/index.js`.
2. `npm run test:frontend`, `npm run test:worker`, `npm run test:python` (hoặc `npm test`).
3. `npm run build --prefix frontend`.

Ngôn ngữ trao đổi và tài liệu: tiếng Việt; tên biến/hàm, log, lệnh giữ tiếng Anh.
