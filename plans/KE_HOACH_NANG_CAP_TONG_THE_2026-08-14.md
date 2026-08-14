# Kế Hoạch Chi Tiết: Nâng Cấp Tổng Thể HacDaoTruyen + Thêm Truyện Tranh — 2026-08-14

> Kế hoạch, CHƯA thực thi. Mục tiêu: nhìn toàn cảnh nền tảng hiện tại, xác
> định hướng nâng cấp tiếp theo, và đánh giá chi tiết việc thêm mảng truyện
> tranh (manga/manhua) — thay đổi lớn nhất được đề xuất trong kế hoạch này.

## 1. Bức tranh hiện tại (tóm tắt để làm nền so sánh)

Hệ thống hiện gồm: FastAPI + SQLite chạy dịch cục bộ (Gemini/DeepSeek/Groq/
Ollama xoay vòng key), Cloudflare Worker + D1 + R2 phục vụ độc giả, frontend
React/Vite. Nội dung 100% dạng văn bản (truyện chữ dịch Trung→Việt), lưu dưới
dạng markdown. Đã có: đọc trực tuyến, EPUB, bookmark/comment/rating, yêu cầu
truyện mới (có duyệt admin), fallback đọc từ Google Drive cho kho 28.477
truyện chưa đồng bộ hết vào R2, và nền tảng ADK multi-agent (giai đoạn
Foundation, đang tắt mặc định). Tất cả pipeline dịch, lưu trữ, và giao diện
đọc đều được thiết kế RIÊNG cho nội dung dạng chữ.

## 2. Thêm truyện tranh (manga/manhua) — thay đổi kiến trúc lớn nhất

### 2.1. Quyết định cần làm rõ trước tiên: phạm vi dịch thuật

Đây là câu hỏi quan trọng nhất, ảnh hưởng toàn bộ độ phức tạp và chi phí của
tính năng — cần bạn quyết định trước khi thiết kế kỹ thuật chi tiết hơn:

- **Phương án A — chỉ tổng hợp/host truyện tranh ĐÃ được dịch sẵn** (từ nguồn
  ngoài, tương tự cách EPUB/Drive fallback hiện tại lấy dữ liệu có sẵn): đơn
  giản hơn nhiều, chỉ cần xây kho lưu ảnh + giao diện đọc, không đụng vào
  pipeline dịch AI. Rủi ro bản quyền tương tự truyện chữ hiện tại (tùy nguồn).
- **Phương án B — tự động dịch truyện tranh bằng AI** (OCR nhận diện chữ
  trong bong bóng thoại → dịch → tái tạo lại ảnh với chữ Việt): đây là bài
  toán KHÁC HẲN so với dịch văn bản thuần. Cần thêm: mô hình nhận diện vùng
  bong bóng thoại + OCR tiếng Trung/Nhật/Hàn viết tay/in trong ảnh (có thể
  dùng PaddleOCR, manga-image-translator — dự án mã nguồn mở tương tự), xóa
  chữ gốc và "vẽ lại" nền (inpainting) chỗ vừa xóa, rồi chèn chữ Việt đã dịch
  đúng vị trí/font phù hợp. Phức tạp hơn dịch văn bản rất nhiều lần, chi phí
  tính toán (GPU cho OCR/inpainting) và thời gian phát triển cao hơn hẳn.

Khuyến nghị: bắt đầu bằng **Phương án A** làm MVP (tối thiểu khả thi) để có
tính năng đọc truyện tranh sớm, ổn định luồng lưu trữ/giao diện trước, rồi
mới tính đến Phương án B như một giai đoạn mở rộng riêng biệt (có thể mất
nhiều tháng nghiên cứu/tinh chỉnh mô hình).

### 2.2. Thiết kế dữ liệu & lưu trữ

Khác biệt cốt lõi: 1 "chương" truyện chữ là 1 file markdown (vài KB), còn 1
"chương" truyện tranh là hàng chục ảnh (mỗi ảnh vài trăm KB). Đề xuất:
- Bảng D1 mới `manga_chapters` (hoặc mở rộng bảng `chapters` hiện tại thêm cột
  `content_type` = `'text'`/`'image'`) lưu `novel_slug, chapter_number, title,
  page_count`, KHÔNG lưu nội dung ảnh trực tiếp trong D1 (D1 có giới hạn kích
  thước dòng).
- R2 key pattern riêng: `<slug>/manga/<chapter_number>/page-001.jpg`,
  `page-002.jpg`... — tương tự cách chương chữ dùng `<slug>/b64_<filename>`
  hiện tại nhưng theo thư mục trang.
- Bảng `novels` thêm cột `content_type` (`'novel'`/`'manga'`) để phân biệt ở
  trang danh mục, tránh 2 loại nội dung lẫn lộn trong cùng 1 danh sách không
  phân loại.

### 2.3. Chi phí lưu trữ — điểm cần tính kỹ (liên quan trực tiếp lo ngại phí Cloudflare của bạn)

Ảnh nặng hơn văn bản rất nhiều. R2 free tier: 10GB lưu trữ, 1 triệu lượt ghi/
tháng, 10 triệu lượt đọc/tháng. Một chương manga ~20-30 ảnh, mỗi ảnh nếu nén
tốt (WebP, chất lượng vừa phải) khoảng 150-300KB → 1 chương ~4-9MB. Một bộ
truyện tranh dài (200+ chương) có thể chiếm 1-2GB riêng bộ đó. Cần:
- Bắt buộc nén ảnh sang WebP + resize về độ phân giải đọc hợp lý (không cần
  giữ ảnh gốc độ phân giải in ấn) trước khi upload lên R2.
- Cân nhắc giới hạn số lượng truyện tranh ban đầu (vd 20-30 bộ để thử nghiệm)
  thay vì nhập hàng loạt như kho truyện chữ 28.477 cuốn — quy mô nhỏ hơn
  nhiều để kiểm soát chi phí trong giai đoạn đầu.
- Lượt đọc (Class B) mỗi trang ảnh = 1 lượt đọc R2 riêng — 1 chương 20 ảnh =
  20 lượt đọc/lần xem, so với 1 lượt đọc cho cả chương văn bản. Free tier đọc
  vẫn rất rộng rãi (10 triệu/tháng) nên đây không phải rủi ro lớn bằng lượt
  ghi, nhưng vẫn nên tính khi ước lượng.

### 2.4. Giao diện đọc riêng cho truyện tranh

Không thể dùng lại Reader chữ hiện tại. Cần xây mới:
- Chế độ đọc dạng cuộn dọc liên tục (webtoon-style, phổ biến cho manhua/
  manhwa) VÀ chế độ lật từng trang (phù hợp manga Nhật đọc phải-sang-trái) —
  nên hỏi ý kiến bạn về việc có cần hỗ trợ cả 2 chế độ đọc phải-sang-trái hay
  chỉ cần cuộn dọc đơn giản trước.
- Lazy-load ảnh (chỉ tải trang đang xem + vài trang kế tiếp), không tải hết
  cả chương cùng lúc — vừa nhanh vừa tiết kiệm băng thông đọc.
- Zoom/pinch trên mobile, đặc biệt quan trọng vì chữ trong bong bóng thoại
  nhỏ, người đọc thường cần phóng to.

### 2.5. Bảo vệ nội dung cho truyện tranh (liên kết với Phần 2 của kế hoạch UI/bảo vệ)

Ảnh thực ra DỄ bảo vệ hơn văn bản một chút: watermark hình ảnh (mờ, lặp lại)
khó xóa hơn watermark ẩn trong text, và không thể "chọn & copy" như văn bản
thuần. Nhưng đồng thời dễ bị tải hàng loạt qua rate cào ảnh nếu API không giới
hạn tốc độ — áp dụng đúng nguyên tắc rate-limit đã đề xuất ở
`KE_HOACH_UI_VA_BAO_VE_NOI_DUNG_2026-08-14.md`.

### 2.6. Lộ trình đề xuất (các giai đoạn tách biệt, mỗi giai đoạn tự đứng được)

| Giai đoạn | Nội dung | Ước lượng độ phức tạp |
|---|---|---|
| 0 | Quyết định phạm vi (Phương án A/B ở mục 2.1), chọn 3-5 bộ truyện tranh mẫu để thử nghiệm | Quyết định sản phẩm, không phải code |
| 1 | Thiết kế dữ liệu D1/R2 cho manga, API `GET /api/novels/:slug/manga/:chapter` trả danh sách URL ảnh | Trung bình |
| 2 | Giao diện đọc manga (cuộn dọc, lazy-load, zoom) | Trung bình-Cao |
| 3 | Trang danh mục phân loại Novel/Manga, tìm kiếm/lọc theo loại | Thấp |
| 4 | (Nếu chọn Phương án B) Nghiên cứu + thử nghiệm pipeline OCR-dịch-inpaint trên 1 chương mẫu trước khi tự động hóa hàng loạt | Cao, nhiều rủi ro kỹ thuật |
| 5 | Bảo vệ nội dung ảnh (watermark, rate-limit) | Thấp-Trung bình |

## 3. Các hạng mục nâng cấp tổng thể khác (ngoài manga)

Rà soát các kế hoạch cũ (`ROADMAP-nang-cap-2026-07.md`, `HOMEPAGE_PLAN.md`)
không còn mục nào ghi "chưa xong" — nền tảng hiện đã ổn định ở các mảng đó.
Đề xuất hướng nâng cấp tiếp theo cho phần còn lại của hệ thống, tách biệt với
manga:

1. **Hoàn thiện ADK Giai đoạn 2** (đã có Foundation, mặc định tắt) — thêm
   Pass 2 (dịch lại/kiểm tra chất lượng tự động) và QC tự động, đúng lộ trình
   đã vạch từ trước, chỉ bật khi bạn xác nhận Foundation chạy ổn định.
2. **Xác nhận & dọn dữ liệu cũ bị ảnh hưởng bởi bug `syncNovelBatch`** (đã
   sửa ở phiên trước) — nếu bạn từng dùng `batch_cloud_syncer.py` sync thủ
   công, nên chạy lại `migrate_to_cloudflare.py` cho các truyện đó để backfill
   bảng `chapters` D1, tránh vẫn còn truyện hiện "0 chương" dù đọc được.
3. **Giám sát chi phí Cloudflare chủ động** — hiện đã có `SyncBudget` cho
   `cloud_to_cloud_syncer.py`; nên cân nhắc thêm 1 trang admin nhỏ hiển thị
   ước lượng lượt dùng R2/D1 tổng hợp (không chỉ riêng script sync) để không
   phải tự vào dashboard Cloudflare kiểm tra thủ công.
4. **`tools/batch_cloud_syncer.py`** — như đã ghi chú ở đợt trước, script này
   dùng chung endpoint sync-novel và cùng rủi ro chi phí như
   `cloud_to_cloud_syncer.py` nhưng chưa có `SyncBudget`. Nếu vẫn đang dùng,
   nên áp dụng cơ chế tương tự.

## 4. Thứ tự ưu tiên đề xuất tổng thể

Vì thêm truyện tranh là thay đổi lớn (dữ liệu, lưu trữ, giao diện, có thể cả
pipeline dịch), khuyến nghị: xử lý dứt điểm các việc bảo vệ nội dung/rate-limit
ở kế hoạch song song trước (chi phí thấp, giá trị cao, không phụ thuộc quyết
định về manga), sau đó quyết định phạm vi manga (mục 2.1) rồi mới bắt tay vào
Giai đoạn 0-1 của lộ trình manga. Mục 3 (các hạng mục nâng cấp khác) có thể
làm xen kẽ bất cứ lúc nào, độc lập với 2 việc lớn còn lại.
