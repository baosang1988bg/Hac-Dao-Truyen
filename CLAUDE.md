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

Dự án sử dụng quy trình Spec-Driven Development (Spec Kit) tại thư mục `.specify/`:
- `/speckit-constitution`: Kiểm tra hiến pháp và quy ước dự án (`.specify/memory/constitution.md`).
- `/speckit-specify <mô tả>`: Phân tích yêu cầu và tạo đặc tả tính năng trong `specs/<feature>/spec.md`.
- `/speckit-plan`: Nghiên cứu kỹ thuật và lập kế hoạch triển khai.
- `/speckit-tasks`: Chia nhỏ danh sách công việc có thể kiểm thử.
- `/speckit-implement`: Triển khai code theo từng task.
- `/speckit-converge`: Chạy test (`npm test`), tự sửa lỗi và đối chiếu kết quả với spec.

