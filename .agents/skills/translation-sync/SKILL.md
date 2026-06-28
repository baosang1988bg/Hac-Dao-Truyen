---
name: translation-sync
description: Guide for scraping, translating, and syncing Chinese novels to Cloudflare using Gemini API key rotation, dynamic glossary filtering, title sanitization, and wrangler deployment.
---

# Quy trình Dịch & Đồng bộ Tiểu thuyết lên Cloudflare (Gemini Key Rotation & Sync)

Tài liệu này lưu trữ toàn bộ các kinh nghiệm, kỹ năng và giải pháp kỹ thuật đã học được từ dự án dịch truyện tự động, giúp định hướng hành vi của AI trong các phiên pair-programming sau này.

---

## 1. Cơ chế xoay vòng Key API (Gemini Key Rotation)
Khi sử dụng gói dịch vụ miễn phí (Free Tier) của Gemini, lỗi `429 Resource Exhausted` (hết hạn mức) xảy ra rất thường xuyên.

### Cách triển khai tối ưu:
- **Cấu hình nhiều Key:** Trong file `.env`, cho phép nhập nhiều key ngăn cách bằng dấu phẩy:
  ```env
  GEMINI_API_KEYS=key1,key2,key3
  ```
- **Xoay vòng tự động (Rotation):**
  - Khi một key gặp lỗi `429`, đánh dấu key đó là `quota_exceeded` và lưu thời điểm bị khóa.
  - Tự động chuyển ngay sang key hoạt động tiếp theo trong danh sách mà không làm gián đoạn tiến trình dịch hàng loạt.
- **Thứ tự fallback (Xoay vòng đa Provider):**
  - Thứ tự ưu tiên mặc định: `gemini` → `deepseek` (Cloud API).
  - **Lưu ý quan trọng:** Không sử dụng các mô hình local (Ollama/DeepSeek-R1-14B) để tự động xoay vòng cho các truyện dài tập, vì chất lượng dịch chưa ổn định, dịch chậm và dễ gặp lỗi định dạng (double header, dịch sót hoặc để sót chữ Hán).

---

## 2. Tối ưu hóa Token bằng Bộ lọc Glossary Động
Để tránh tình trạng phình to Context Window và lãng phí token khi prompt chứa hàng ngàn từ khóa glossary không liên quan:

### Quy tắc xử lý:
- Trước khi dịch, quét nội dung raw tiếng Trung của chương truyện.
- Đối chiếu với từ điển Glossary đầy đủ. Chỉ lọc ra các cặp từ khóa Trung-Việt **thực sự xuất hiện** trong nội dung chương đó để gửi kèm vào Prompt.
- Tiết kiệm tới **70% - 90%** số lượng token gửi đi cho mỗi chương.

---

## 3. Làm sạch tiêu đề và Phòng tránh lỗi Tiêu đề kép (Double Header)
Khi crawl từ các trang nguồn (như `novel543.com` hoặc `ixdzs8.com`), tiêu đề thường dính thẻ phân trang dạng `(1/2)` hoặc bị dịch lặp lại.

### Quy tắc xử lý:
- **Loại bỏ phân trang:** Sử dụng regex sau để làm sạch tiêu đề gốc trước khi dịch hoặc đặt tên file:
  ```python
  title = re.sub(r'\s*[\(\（]\s*\d+\s*/\s*\d+\s*[\)\）]\s*$', '', title)
  ```
- **Tránh tiêu đề kép:** Trong hàm lưu bản dịch, định nghĩa tiêu đề sạch `# Chương X: <Tên Tiếng Việt>` làm dòng đầu tiên, sau đó cắt bỏ bất kỳ dòng tiêu đề trùng lặp nào mà AI tự ý lặp lại ở đầu nội dung thân bài (`_body_lines`).

---

## 4. Kiểm tra độ hoàn thiện bản dịch (Truncation Check)
Đôi khi AI có thể dừng sớm hoặc tóm tắt chương. Để kiểm tra tự động:
- Viết một script so sánh tỷ lệ ký tự Việt/Trung (tiêu chuẩn: `0.55 - 1.5`).
- So sánh tỷ lệ số lượng đoạn văn (paragraph count) giữa bản dịch và bản gốc.
- Nếu tỷ lệ nhỏ hơn `0.55` hoặc số đoạn văn giảm quá `50%`, bản dịch bị nghi ngờ lỗi và cần đưa vào danh sách dịch lại thay vì ghi đè trực tiếp làm mất token.

---

## 5. Đồng bộ và Deploy lên Cloudflare trên Windows
Hệ thống sử dụng Cloudflare Pages/Workers kết hợp D1 Database và R2 Storage.

### Quy tắc vận hành:
- **Đồng bộ Dữ liệu:** Chạy `python -u migrate_to_cloudflare.py --smart-sync` (Sử dụng flag `-u` để tránh bị buffer log đầu ra trên Windows, giúp theo dõi tiến độ thời gian thực).
- **Vượt rào cản PowerShell:** Trên các máy Windows bị tắt chính sách thực thi script (`Execution Policies`), lệnh gọi trực tiếp `npx wrangler deploy` sẽ bị chặn. Thay vào đó, hãy chạy thông qua Command Prompt hoặc gọi file batch trực tiếp:
  ```powershell
  cmd.exe /c "npx.cmd wrangler deploy"
  ```
