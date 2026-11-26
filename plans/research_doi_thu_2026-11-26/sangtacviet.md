# Nghiên cứu sangtacviet (STV): cơ chế và tính năng đáng học cho HacDaoTruyen

Ngày khảo sát: 2026-11-26. Phương pháp: chỉ quan sát công khai, không đăng nhập, không vượt CAPTCHA/Cloudflare, không vượt robots.txt hay blocklist. Tổng cộng khoảng 12 request tới các domain STV.

> **Cảnh báo về độ tin cậy:** lần này chỉ quan sát trực tiếp được rất ít (xem mục 0). Phần lớn các mục từ 3 trở đi là **suy luận**, dựa trên URL/tham số quan sát được, một issue GitHub công khai và hiểu biết chung về hệ sinh thái convert VietPhrase. Mỗi ý đều được gắn nhãn. Cần kiểm chứng lại bằng trình duyệt thật (DevTools) trước khi dùng làm căn cứ kỹ thuật.

---

## 0. Truy cập được gì / bị chặn ở đâu (quan sát trực tiếp)

| URL / hành động | Kết quả |
|---|---|
| `web_fetch https://sangtacviet.vip/` | OK, chỉ lấy được text (giao diện tiếng Anh: "Recently reads", "Quick translate", "Lasted update", "Chatbox", "Kênh chính / Kênh 18+", "App", "Extension"); footer ghi "sangtacviet.com là trang web cung cấp dịch vụ dịch tự động dịch truyện chữ trung" |
| `web_fetch https://sangtacviet.com/` | OK, giao diện tiếng Việt ("Truyện vừa đọc", "Dịch nhanh", "Mới cập nhật", "Chuyện thiên hạ", "Hỗ trợ tự dịch ảnh từ các nguồn truyện") |
| `https://sangtacviet.app/` | lỗi client (4xx) |
| `sangtacviet.vip/truyen/...`, `/robots.txt`, `/manifest.json`, endpoint `index.php?...sajax=readchapter` | 4xx (có thể do lớp chống bot hoặc thiếu Referer/cookie) |
| `sangtacviet.com/truyen/...`, `/robots.txt` | **ROBOTS_DISALLOWED**, nên đã dừng, không vượt |
| Browser pane (`Claude_Browser`) với .vip và .com | đã được cấp quyền "once" nhưng điều hướng đều thất bại ("denied or failed") |
| Wayback Machine | công cụ fetch báo nằm trong blocklist nên không dùng |
| Sandbox Linux `curl` | proxy chặn mọi host ngoài allowlist (`403 host is not on the allow list`) |
| REA `rea-agents@6.7.0` | cài được, có các lệnh `analyze-web-bundle`, `capture-browser-scenario`, `export-web-scripts`, `analyze-javascript-application`, nhưng **không chạy được** vì sandbox không có mạng tới site, không có Playwright/Chromium, và không tải được file JS nào để phân tích tĩnh |

=> Domain hoạt động: **sangtacviet.com** (bản chính, tiếng Việt) và **sangtacviet.vip** (mirror, bản tiếng Anh/đa ngôn ngữ, có nút "Chọn ngôn ngữ"). Theo maintainer WebToEpub, .vip là mirror của .com.

---

## 1. Cấu trúc URL và endpoint chương (quan sát gián tiếp, nguồn công khai)

Nguồn: issue công khai dteviot/WebToEpub #1479 (09/2024), trong đó cộng tác viên mô tả lại request mạng mà họ tự quan sát:

```
Trang truyện : https://sangtacviet.vip/truyen/qidian/1/1041491430/
Trang chương : https://sangtacviet.vip/truyen/qidian/1/1041491430/804134403/
Nội dung     : https://sangtacviet.vip/index.php?bookid=1041491430&h=qidian
               &c=804134403&ngmar=readc&sajax=readchapter&sty=1&exts=
Ví dụ khác   : https://sangtacviet.vip/truyen/faloo/1/1433830/1/
```

Các điểm rút ra từ nguồn này:
- URL theo mẫu `/truyen/{host}/{type}/{bookid}/{chapterid}/`. `host` là **tên site nguồn** (qidian, faloo...). `bookid` và `chapterid` là **ID gốc của site nguồn** (1041491430 đúng dạng ID sách Qidian). Như vậy STV không đánh ID riêng mà ánh xạ 1-1 với nguồn.
- HTML trang chương **không chứa nội dung**. Nội dung tải bằng XHR tới `index.php?...sajax=readchapter`, server trả **JSON**.
- Request này trả rỗng nếu thiếu header `Referer` của chính domain, và cần cookie lấy từ trang truyện trước đó. Đây là lớp chống crawl đơn giản: kiểm tra Referer cộng session cookie.
- `sty=1` và `exts=` là tham số chưa rõ nghĩa. **Suy luận:** `sty` là kiểu hiển thị/kiểu dịch, `exts` là danh sách extension/tùy chọn bổ sung.
- Backend là **PHP** (front controller `index.php` với tham số `ngmar`/`sajax`). Đây là suy luận mạnh từ URL.

---

## 2. Tech stack

| Thành phần | Nhận định | Loại |
|---|---|---|
| Backend PHP, router dạng query string (`index.php?ngmar=...&sajax=...`) | từ URL endpoint | suy luận mạnh |
| Render trang bằng server (homepage có sẵn text "Mới cập nhật" khi fetch tĩnh) cộng AJAX cho nội dung chương | homepage fetch tĩnh vẫn ra danh sách truyện | quan sát trực tiếp (homepage) + suy luận |
| Không phải SPA (React/Vue): homepage trả nội dung dạng text, không phải shell JS rỗng | quan sát trực tiếp | quan sát |
| Nhiều domain mirror (.com/.vip/.app) để chống chặn | quan sát (.com và .vip chạy, .app 4xx) | quan sát |
| Có App và Extension trình duyệt (link ở footer) | quan sát text footer | quan sát |
| Chống bot: robots.txt chặn `/truyen/`, Referer check, trả 4xx với client lạ | quan sát | quan sát |

---

## 3. Cơ chế lấy chương nguồn (chủ yếu suy luận)

- **(Suy luận mạnh)** STV **không lưu sẵn toàn bộ truyện**. Khi người đọc mở chương, server gọi site nguồn tương ứng với `h` (qidian, faloo, và theo cộng đồng còn có uukanshu, 69shu, ciweimao, sfacg, zongheng, fanqie...), lấy raw tiếng Trung rồi convert. Căn cứ: ID trong URL trùng ID nguồn; homepage "Mới cập nhật" ghi "0 phút trước" liên tục với rất nhiều truyện (bao gồm cả "truyện tranh"), tức là cập nhật bám theo nguồn.
- **(Suy luận)** Có cache phía server cho raw/bản convert (chương đã đọc thì lần sau nhanh). Chương VIP/khóa của nguồn có thể bị giới hạn. Không quan sát được TTL hay cơ chế invalidation.
- **(Quan sát text)** "Hỗ trợ tự dịch ảnh từ các nguồn truyện": có OCR/dịch ảnh cho truyện tranh. Homepage liệt kê nhiều mục "truyện tranh".
- **(Quan sát text)** "Dịch nhanh / Quick translate": công cụ dán văn bản Trung để convert tức thì.

## 4. Cơ chế convert và hệ thống name (suy luận, CHƯA xác minh được bằng mạng)

Không lấy được JS hay JSON của chương nên **không xác minh được** convert diễn ra ở client hay server. Dưới đây là mô hình khả dĩ nhất, ghép từ URL quan sát được và kiến trúc chuẩn của hệ VietPhrase (QuickTranslate/TQT):

1. **Từ điển nhiều tầng** (chuẩn VietPhrase, suy luận): `Names` (tên riêng) > `VietPhrase` (cụm từ) > `ChinesePhienAmWords` (Hán Việt từng chữ). Thuật toán là **longest-match** quét trái sang phải: ở mỗi vị trí, thử cụm dài nhất có trong Names, rồi VietPhrase, rồi fallback Hán Việt từng chữ. Name có ưu tiên cao nhất.
2. **Vị trí convert (suy luận):** endpoint trả JSON từ server cho thấy **convert chủ yếu ở server** (PHP, trả text đã dịch), vì từ điển VietPhrase cỡ chục MB quá nặng để tải về mobile mỗi lần. Tuy nhiên tính năng "sửa name ngay trong Reader và thấy kết quả tức thì" gợi ý server trả kèm **token song song** (mỗi từ kèm chữ Hán gốc). Điều này cho phép client re-render cục bộ phần name vừa sửa mà không cần tải lại chương. Chưa thấy payload thực nên đây là giả thuyết cần kiểm chứng.
3. **Name theo phạm vi (suy luận, theo mô tả cộng đồng):**
   - *Name chung của truyện:* bộ name gắn với `bookid` + `host`, do người đóng góp/biên tập chia sẻ, áp dụng cho mọi người đọc truyện đó.
   - *Name cá nhân:* người dùng tự thêm, chỉ áp dụng cho mình (lưu theo tài khoản hoặc localStorage), ưu tiên **cao hơn** name chung.
   - *Từ điển toàn cục:* VietPhrase/Hán Việt dùng cho mọi truyện.
   - Thứ tự ưu tiên hợp lý: name cá nhân > name truyện (chung) > VietPhrase toàn cục > Hán Việt.
4. **UI sửa name trong Reader (suy luận):** chạm hoặc bôi đen một từ thì mở popup hiển thị chữ Hán gốc, âm Hán Việt và nghĩa VietPhrase. Người dùng nhập nghĩa mới, chọn phạm vi (riêng/chung), lưu xong chương re-render. Cộng đồng (voz.vn) phàn nàn ở chương xa (~1800) tên bị dịch sai nhiều. Điều này cho thấy chất lượng phụ thuộc mạnh vào việc name được bảo trì.

## 5. Reader, cộng đồng, sáng tác, kiếm tiền, SEO (từ text homepage và suy luận)

| Tính năng | Bằng chứng | Loại |
|---|---|---|
| "Truyện vừa đọc" (lịch sử đọc, có khi không đăng nhập) | text homepage | quan sát |
| "Mới cập nhật" realtime ("x phút trước") | text homepage | quan sát |
| Chatbox realtime trên trang chủ, chia **Kênh chính / Kênh 18+**, đếm "Đang online" | text homepage | quan sát |
| "Chuyện thiên hạ" (mục tin tức/thảo luận) và "Bài viết" | text homepage | quan sát |
| "Hướng dẫn tân thủ" | text homepage | quan sát |
| Đa ngôn ngữ giao diện ("Chọn ngôn ngữ", bản .vip tiếng Anh) | text homepage .vip | quan sát |
| App di động và Extension trình duyệt | footer | quan sát |
| Dịch ảnh truyện tranh | text .com | quan sát |
| Tên site "Sáng tác Việt": cho user đăng truyện sáng tác | tên miền | suy luận |
| Tủ truyện, đề cử, bình luận chương, theme/font, TTS | không quan sát được | suy luận (tính năng phổ biến) |
| SEO: robots.txt **chặn** `/truyen/` trên .com, nên SEO trang truyện yếu (có thể cố ý để tránh khiếu nại bản quyền) | ROBOTS_DISALLOWED | quan sát |
| Kiếm tiền: không quan sát được quảng cáo hay VIP | — | không rõ |

---

## 6. TOP 8 tính năng/cơ chế đáng học cho HacDaoTruyen

Stack đích: Cloudflare Worker + D1 + R2, React/Vite, backend dịch Python (Gemini/DeepSeek + glossary).

### 1. Name 3 tầng có ưu tiên: cá nhân > truyện (chung) > toàn cục
- **Vì sao hay:** đây là lõi giá trị của STV. Người đọc tự sửa lỗi tên, và chất lượng tăng theo cộng đồng. HacDaoTruyen đã có glossary theo truyện; thêm tầng **name cá nhân** và tầng **đề xuất chung** là bước tự nhiên.
- **Độ khó:** Trung bình. Bảng D1 `glossary_entries(book_id, zh, vi, scope ENUM('global','book','user'), user_id NULL, votes, status)`. Worker merge theo ưu tiên khi phục vụ chương.
- **Rủi ro:** spam hoặc phá hoại name chung, nên cần kiểm duyệt (vote, quyền editor, lịch sử để rollback).

### 2. Sửa name ngay trong Reader: chọn từ, xem gốc Hán, sửa nghĩa
- **Vì sao hay:** vòng phản hồi rất ngắn, người đọc là người hiệu đính.
- **Độ khó:** Trung bình–Cao. Với bản dịch AI không có ánh xạ từng từ, cần lưu **alignment tối thiểu cho tên riêng**: khi dịch, yêu cầu LLM hoặc bước hậu xử lý đánh dấu `<n zh="林动">Lâm Động</n>`. Reader hiển thị popup; sửa xong thì thay chuỗi phía client ngay và đẩy lên glossary.
- **Rủi ro:** LLM có thể biến tấu tên (đổi cách xưng hô), nên thay chuỗi đơn thuần không đủ. Nên dùng placeholder `⟦N12⟧` trong prompt rồi thế sau, tách tên khỏi dịch.

### 3. Re-render cục bộ khi đổi name, không dịch lại chương
- **Vì sao hay:** đổi name không tốn token LLM. STV làm được nhờ token song song (suy luận).
- **Độ khó:** Trung bình. Lưu bản dịch trong R2 dưới dạng **template có placeholder tên** cộng map tên, và áp glossary lúc phục vụ (Worker hoặc client).
- **Rủi ro:** thấp. Cần versioning cache theo `glossary_version` của truyện.

### 4. Dịch theo yêu cầu (lazy) kèm cache, ID ánh xạ nguồn
- **Vì sao hay:** STV phục vụ một catalog khổng lồ mà không dịch trước. Chỉ chương được đọc mới tốn tài nguyên.
- **Độ khó:** Trung bình. Worker kiểm tra R2, nếu miss thì đưa vào hàng đợi dịch (Queue → Python), trong lúc chờ client hiện raw/Hán Việt tạm.
- **Rủi ro:** **pháp lý cao** nếu tự crawl qidian/faloo... (vi phạm bản quyền và ToS nguồn). Chỉ nên áp dụng cho nguồn được phép hoặc nội dung người dùng tự tải lên.

### 5. Chế độ "Hán Việt / bản thô" tức thì làm fallback trong lúc AI dịch
- **Vì sao hay:** người đọc không phải chờ. Một convert VietPhrase rẻ (thuần CPU, longest-match) chạy được trong Worker hoặc client.
- **Độ khó:** Trung bình. Bảng Hán Việt (~20k chữ) nhỏ, có thể đóng gói cho client. VietPhrase đầy đủ thì lớn (chục MB) nên để trong Worker và R2, hoặc dùng trie nén.
- **Rủi ro:** giấy phép của các bộ từ điển VietPhrase cộng đồng chưa rõ ràng. Bảng Hán Việt thuần có nguồn mở (Unihan, kVietnamese).

### 6. "Dịch nhanh" (dán văn bản → dịch) và dịch ảnh truyện tranh
- **Vì sao hay:** thu hút người dùng có raw riêng, là công cụ mang lại traffic.
- **Độ khó:** Dịch nhanh: thấp (tái dùng pipeline và glossary, có rate-limit). Dịch ảnh: cao (OCR + inpainting).
- **Rủi ro:** chi phí LLM bị lạm dụng, nên cần rate-limit theo IP/user trong Worker và Turnstile.

### 7. Trang chủ "sống": Mới cập nhật realtime, Truyện vừa đọc, chatbox kênh
- **Vì sao hay:** tạo cảm giác cộng đồng đông đúc và giữ chân người dùng. "Truyện vừa đọc" hoạt động cả khi không đăng nhập (localStorage).
- **Độ khó:** Lịch sử đọc: thấp. Chatbox realtime: trung bình (Durable Objects + WebSocket).
- **Rủi ro:** kiểm duyệt nội dung chat, và tách kênh 18+ cần xác thực tuổi.

### 8. Chống crawl nhẹ cho API chương (Referer + session cookie) và nhiều domain mirror
- **Vì sao hay:** bảo vệ chi phí dịch AI (bản dịch là tài sản) mà không phá UX.
- **Độ khó:** Thấp. Worker kiểm tra Origin/Referer, token ký HMAC ngắn hạn gắn với trang truyện, Cloudflare Bot Management/Turnstile.
- **Rủi ro:** chặn nhầm extension đọc offline. Lưu ý Referer dễ giả mạo, nên đây chỉ là lớp mỏng.

---

## 7. Giới hạn và việc cần làm tiếp

- **Không quan sát được:** payload JSON của chương, file JS của Reader, cấu trúc lưu name, API sửa/chia sẻ name, convert ở client hay server, cơ chế cache. Mọi khẳng định về name/convert ở mục 4 là **suy luận**.
- **REA:** cài và liệt kê lệnh được, nhưng không phân tích được gì: không có mạng tới site từ sandbox, không có Chromium/Playwright, không có bundle JS.
- **Đề xuất kiểm chứng (người dùng tự làm trên máy):** mở sangtacviet.com bằng Chrome, vào một chương, mở DevTools → Network và lưu HAR. Ghi lại (a) response `sajax=readchapter`, (b) request khi sửa name, (c) các file `.js` được tải. Sau đó chạy `npx -y rea-agents@6.7.0 analyze-javascript-application <thư mục chứa JS đã lưu> --json` trên máy có mạng để dựng lại hàm convert.

## Nguồn
- https://sangtacviet.com/ và https://sangtacviet.vip/ (text homepage, fetch 2026-11-26)
- WebToEpub issue #1479 (mirror): https://githubrp.bychv-a.workers.dev/dteviot/WebToEpub/issues/1479
- Thảo luận người đọc: https://voz.vn/p/43094205/
