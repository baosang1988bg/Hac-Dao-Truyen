# Kế Hoạch: Nâng Cấp UI & Bảo Vệ Nội Dung Tránh Download/Copy — 2026-08-14

> Kế hoạch, CHƯA thực thi. Viết trong lúc kiểm tra bug auto-translate Lãnh Chúa
> (xem commit `379ad31`) để bạn xem xét trước khi quyết định làm phần nào.

## Phần 1 — Nâng cấp UI

### Hiện trạng
Các đợt trước đã hoàn thành: redesign trang chủ theo phong cách truyentrung.com
(BXH, chip thể loại, bảng xếp hạng, bình luận mới nhất, thông báo cập nhật —
`KE_HOACH_HOC_HOI_TRUYENTRUNG_2026-08-08.md`), code-splitting frontend, badge
FULL nhất quán, EPUB reader responsive trên màn hình nhỏ, thông báo lỗi khi
không tải được danh sách chương. `HOMEPAGE_PLAN.md`/`ROADMAP-nang-cap-2026-07.md`
không còn mục nào ghi trạng thái "chưa xong" — phần lớn nền tảng UI cơ bản đã
ổn định.

### Đề xuất hạng mục tiếp theo (ưu tiên theo mức ảnh hưởng/chi phí)

**Ưu tiên cao — ảnh hưởng trải nghiệm đọc trực tiếp:**
1. **Đồng bộ tiến độ đọc & cài đặt Reader giữa các thiết bị** — hiện font
   size/theme/vị trí đọc dở có thể chỉ lưu local (localStorage), khiến người
   dùng đăng nhập trên điện thoại rồi mở máy tính bị mất tiến độ. Nên lưu
   `reading_position` theo user (đã có bảng user cho bookmarks/comments, có
   thể mở rộng tương tự).
2. **Skeleton loading / trạng thái tải rõ ràng hơn** — trang danh mục, trang
   chi tiết truyện, trang đọc hiện dùng spinner đơn giản hoặc không có gì khi
   chờ API; thêm skeleton screen giúp cảm giác nhanh hơn, đặc biệt trên mạng
   chậm (nhiều độc giả vào từ điện thoại 3G/4G).
3. **Rà soát dark mode toàn site** — kiểm tra lại các trang admin, modal
   (Request Novel, comment) đã đúng theme tối/sáng nhất quán chưa, vì các
   trang này được thêm ở nhiều đợt khác nhau, dễ bị lệch màu nền/chữ.

**Ưu tiên trung bình — khám phá & giữ chân độc giả:**
4. **Trang "Gợi ý cho bạn" dựa trên lịch sử đọc** — đơn giản nhất là "cùng thể
   loại + đang được đọc nhiều", chưa cần machine learning phức tạp.
5. **Bộ lọc/tìm kiếm nâng cao** — lọc theo trạng thái dịch (đang dịch/hoàn
   thành), số chương tối thiểu, ngày cập nhật gần đây.
6. **Trang cá nhân người dùng** — lịch sử đọc, truyện đã đánh giá, request đã
   gửi — gộp lại 1 chỗ thay vì rải rác.

**Ưu tiên thấp — hoàn thiện/polish:**
7. **Audit accessibility (WCAG)** — độ tương phản màu, kích thước vùng bấm
   trên mobile, điều hướng bàn phím cho Reader. Có thể dùng skill
   `design:accessibility-review` khi bạn muốn làm phần này.
8. **Trang 404/lỗi mạng có thiết kế riêng** thay vì trang trắng mặc định.

### Cách triển khai đề xuất
Làm theo từng nhóm nhỏ (1-2 mục ưu tiên cao trước), mỗi nhóm 1 commit riêng,
verify bằng `npm run build` + tự kiểm tra giao diện qua ảnh chụp màn hình
trước khi coi là xong — đúng kỷ luật đã áp dụng xuyên suốt các đợt trước.

---

## Phần 2 — Bảo vệ nội dung tránh download & copy

### Giới hạn cần hiểu trước khi làm (nói thẳng, không hứa suông)

Không có cách nào ngăn chặn TUYỆT ĐỐI việc sao chép nội dung hiển thị trên
trình duyệt: nếu trình duyệt hiển thị được chữ, người dùng đủ quyết tâm luôn
có thể chụp màn hình, OCR ảnh chụp, dùng DevTools đọc DOM, hoặc chặn network
request để lấy dữ liệu thô. Mọi giải pháp kỹ thuật dưới đây chỉ có tác dụng
"nâng rào cản" (ngăn số đông sao chép/tải hàng loạt bằng công cụ tự động,
ngăn copy-paste thông thường) và "truy vết" (biết ai đã tải nếu nội dung bị
phát tán) — không phải "khóa cứng" 100%. Nên đặt mục tiêu thực tế: giảm việc
tải hàng loạt tự động (nguy cơ lớn nhất, vì 1 script có thể lấy hết cả bộ
truyện trong vài phút) hơn là cố chặn 1 người đọc chép tay từng đoạn.

### Phát hiện quan trọng khi rà soát: endpoint tải cả cuốn EPUB đang mở hoàn toàn

`GET /api/novels/:slug/epub` (`getEpub()`, `src/index.js:555`) trả về file
EPUB đầy đủ của TOÀN BỘ truyện, **không yêu cầu đăng nhập, không giới hạn tốc
độ gọi**. Đây hiện là điểm hở lớn nhất — không cần "hack" gì, ai cũng có thể
viết 1 dòng lệnh tải toàn bộ 28.477 truyện dưới dạng EPUB. Nếu mục tiêu là
chống phát tán hàng loạt, đây là việc cần quyết định ĐẦU TIÊN, quan trọng hơn
nhiều so với việc chặn click-chuột-phải trên trang đọc.

### Các lớp phòng vệ đề xuất (theo thứ tự ưu tiên/hiệu quả thực tế)

**1. Giới hạn EPUB download (ưu tiên cao nhất):**
- Yêu cầu đăng nhập mới tải được EPUB (đã có hệ thống user/session sẵn).
- Giới hạn tốc độ tải theo tài khoản (vd tối đa 10 EPUB/giờ) để chặn script
  tải hàng loạt, không ảnh hưởng người đọc bình thường.
- Cân nhắc: có nên gắn watermark ẩn vào EPUB (vd 1 dòng comment trong file
  chứa email/user_id, không hiển thị khi đọc bình thường) để nếu phát hiện
  file bị phát tán nơi khác, biết được tài khoản nào đã tải — đây là "truy
  vết", không phải "ngăn chặn", nhưng có tác dụng răn đe rõ rệt.
- **Cần bạn quyết định trước:** EPUB hiện là tính năng tiện lợi cho người đọc
  offline hợp pháp. Việc thêm rào cản (đăng nhập + giới hạn) sẽ làm giảm tiện
  lợi một chút để đổi lấy an toàn hơn — đây là đánh đổi sản phẩm, không phải
  thuần kỹ thuật.

**2. Giới hạn tốc độ gọi API đọc chương (`/api/novels/:slug/chapters/:id`):**
- Áp dụng rate-limit theo IP/tài khoản tương tự EPUB — 1 người đọc thật không
  bao giờ gọi hàng trăm chương/phút, chỉ có script cào mới làm vậy. Đây là
  phòng vệ hiệu quả nhất cho việc tải hàng loạt qua API, vì API vốn thiết kế
  để máy đọc được (JSON), dễ viết script hơn nhiều so với "chép" trang HTML.

**3. Cản trở thao tác thủ công cơ bản trên trang đọc (hiệu quả thấp, nhưng rẻ):**
- CSS `user-select: none` cho vùng nội dung chương (vẫn cho phép chọn ở
  tiêu đề/UI khác để không phá trải nghiệm).
- Chặn menu chuột phải + một số phím tắt (Ctrl+C/Ctrl+S) trên vùng đọc.
- CSS `@media print` ẩn nội dung khi in/xuất PDF từ trình duyệt.
- Lưu ý: tất cả đều bypass được dễ dàng qua DevTools — chỉ nên làm nếu chấp
  nhận đây là "rào cản cho số đông", không kỳ vọng chặn người rành kỹ thuật.

**4. Watermark hiển thị nhẹ trên trang đọc (tùy chọn, cân nhắc kỹ trải nghiệm):**
- Chèn watermark mờ (vd email/id user, hoặc tên site) lặp lại rất nhạt trong
  nội dung — nếu ai chụp màn hình/copy nguyên trang thì watermark đi theo.
  Đánh đổi: có thể gây khó chịu thị giác nếu làm không khéo, cần thử nghiệm
  A/B trước khi áp dụng toàn site.

**5. KHÔNG khuyến nghị (chi phí/rủi ro cao hơn lợi ích cho web novel dạng text):**
- Render nội dung chương thành ảnh/canvas thay vì text: chặn được copy-paste
  văn bản và xem mã nguồn, nhưng phá hỏng SEO, khả năng tiếp cận cho người
  khiếm thị (screen reader), tìm kiếm trong trang (Ctrl+F), và tăng đáng kể
  dung lượng tải mỗi trang. Không phù hợp cho 1 site đọc truyện chữ.
- DRM thực sự (mã hóa nội dung, ràng buộc thiết bị): phức tạp, tốn kém, và
  vẫn bị vượt qua bởi chụp màn hình — không đáng đầu tư cho quy mô hiện tại.

### Đề xuất phạm vi thực thi khi bạn sẵn sàng
Làm mục 1 và 2 trước (rate-limit EPUB + rate-limit API chương) — đây là 2
việc có tác dụng thực chất nhất, chi phí kỹ thuật thấp (tận dụng session/user
đã có sẵn), rủi ro thấp. Mục 3 làm kèm nếu muốn (rẻ, nhanh). Mục 4 cân nhắc
sau, cần bạn duyệt qua UI thử nghiệm trước vì ảnh hưởng trực tiếp thẩm mỹ
trang đọc.
