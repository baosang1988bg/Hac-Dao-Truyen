# Quy tắc ngôn ngữ dự án

- Luôn trả lời và giao tiếp bằng **tiếng Việt** trong toàn bộ dự án này (HacDaoTruyen), kể cả tin nhắn giải thích, tóm tắt, commit message giải thích, và nội dung trao đổi với người dùng.
- Chỉ giữ nguyên tiếng Anh cho: tên biến/hàm, log kỹ thuật, mã lệnh, tên thư viện/công cụ, và các đoạn trích dẫn nguyên văn từ code hoặc tài liệu bên thứ ba.
- Không cần dịch code, nhưng phần giải thích đi kèm code phải bằng tiếng Việt.

# Phối hợp với agent khác

Repo được sửa song song bởi Antigravity (máy Windows) và GitHub Actions. Quy tắc
chung cho MỌI agent nằm ở file dưới — tuân thủ y như quy tắc của file này:

@.agents/AGENTS.md

Đầu phiên: `git pull --rebase` và đọc ~20 dòng cuối `.agents/WORKLOG.md`. Sau mọi
việc chạm production: thêm 1 dòng vào `.agents/WORKLOG.md`.

# Quy trình phát triển tính năng mới (GitHub Spec Kit)

Spec Kit (v1.2.2.dev0) cài cho 2 runtime, dùng chung `.specify/` (template, hiến pháp):
- **Claude Code (Mac/Linux):** skill ở `.claude/skills/speckit-*`, gọi script bash `.specify/scripts/bash/`.
- **Antigravity (Windows):** skill ở `.agents/skills/speckit-*`, gọi script PowerShell `.specify/scripts/powershell/`.
Sửa skill thì sửa CẢ HAI bản (hoặc chạy lại `specify integration upgrade`), không để lệch nhau.

Thứ tự lệnh: `/speckit-constitution` → `/speckit-specify <mô tả>` → (`/speckit-clarify`) →
`/speckit-plan` → `/speckit-tasks` → (`/speckit-analyze`) → `/speckit-implement` → `/speckit-converge`.
Hiến pháp: `.specify/memory/constitution.md`. Đặc tả lưu ở `specs/<feature>/`.
Spec Kit chỉ là quy trình — mọi quy tắc an toàn ở `.agents/AGENTS.md` vẫn áp dụng (không deploy, không đụng D1/R2 khi chưa được duyệt).
