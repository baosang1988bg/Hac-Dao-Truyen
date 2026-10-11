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
