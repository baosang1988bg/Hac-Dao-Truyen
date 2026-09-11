# Kế Hoạch Chi Tiết: Nâng Cấp Tổng Thể HacDaoTruyen + Thêm Truyện Tranh — 2026-08-14

> Kế hoạch, CHƯA thực thi. Mục tiêu: nhìn toàn cảnh nền tảng hiện tại, xác
> định hướng nâng cấp tiếp theo, và đánh giá chi tiết việc thêm mảng truyện
> tranh (manga/manhua) — thay đổi lớn nhất được đề xuất trong kế hoạch này.

## Bổ sung 11/09/2026 (F05 — đồng bộ tài liệu sau đợt xử lý review độc lập)

Mục 2.1b/2.5 dưới đây (rủi ro bản quyền, cần cơ chế gỡ nội dung) đến nay đã
có phần HẠ TẦNG KỸ THUẬT tương ứng cho truyện chữ hiện tại (implemented +
tested local, KHÔNG phải verified production):
- Trạng thái xuất bản/gỡ (`published`) tách biệt hoàn toàn khỏi
  `ongoing`/`completed` — cả D1 (Worker) lẫn `novel.json` (local). Gỡ một
  truyện không xóa dữ liệu (admin restore được), và chặn ĐỦ mọi đường đọc
  công khai đã rà: danh sách, chi tiết, danh sách chương, nội dung chương,
  EPUB, catalog, synopsis.
- `POST /api/admin/novels/:slug/takedown|restore` (2 backend) ghi nhật ký
  vào `admin_actions` (D1) / `data/admin_actions.log` (local) — chưa có UI
  admin riêng cho việc này (chỉ có API), và **chưa có "purge cache CDN
  online"** thật — Cloudflare cache purge cần gọi Cloudflare API với token
  zone riêng (ngoài phạm vi Worker tự làm được), CHƯA triển khai; giới hạn
  thực tế: bản đã cache ở Cloudflare edge / trình duyệt người dùng / bản đã
  tải offline (EPUB/chapter cache trong service worker) có thể còn tồn tại
  một thời gian sau khi gỡ cho tới khi cache hết hạn tự nhiên.
- `GET /api/config` trả `contact_email` cấu hình qua biến môi trường (rỗng
  nếu chưa cấu hình) — kênh liên hệ báo cáo bản quyền/takedown, chưa có form
  UI riêng ở frontend, mới có ở tầng API.
- Đây là cơ chế CHUNG cho nền tảng hiện tại (không riêng cho manga) — nếu
  triển khai manga theo mục 2, hạ tầng takedown này đã sẵn sàng tái sử dụng,
  không cần thiết kế lại.

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

### 2.1b. Rủi ro bản quyền — cần đánh giá trước khi làm kỹ thuật

Truyện chữ hiện tại đã có rủi ro tương tự (dịch không phép từ Qidian/69shuba,
xem ghi chú ở `ROADMAP-nang-cap-2026-07.md` mục 4.6), nhưng manga/manhua **rủi
ro cao hơn rõ rệt** vì mấy lý do riêng của loại nội dung này:

1. **Thị trường xuất bản chính thức tại Việt Nam đã tồn tại và chủ động rà
   soát.** Nhiều bộ manga/manhua phổ biến đã được các NXB trong nước mua bản
   quyền chính thức (Kim Đồng, TVM Comics, IPM, Skybooks, Comicola...). Khác
   với truyện chữ dịch từ nguồn Trung Quốc (ít đơn vị Việt Nam theo dõi sát),
   nhóm nắm bản quyền manga tại VN có động lực thương mại trực tiếp để gửi
   khiếu nại/DMCA khi phát hiện bản dịch lậu cạnh tranh với ấn bản họ đang bán.
2. **Ảnh là tác phẩm gốc (artwork), không chỉ là câu chữ.** Vi phạm bản quyền
   hình ảnh thường rõ ràng và dễ chứng minh hơn vi phạm bản quyền văn bản dịch
   — kể cả khi dịch lại bằng AI (Phương án B), ảnh nền/nét vẽ gốc vẫn giữ
   nguyên, không "biến đổi" nội dung như bản dịch text.
3. **Nguồn ảnh raw/scan thường có watermark của nhóm scan gốc** — việc dùng
   lại đồng nghĩa còn dính thêm tranh chấp với chính nhóm scan (dù bản thân
   họ cũng vi phạm bản quyền gốc), phức tạp hơn nguồn dịch text vốn chỉ có 1
   lớp vi phạm (dịch giả gốc → mình dịch lại).
4. **Rủi ro lan sang toàn bộ hạ tầng đang chạy ổn định.** Manga dự kiến vẫn
   dùng chung Cloudflare Worker/R2/D1 với truyện chữ. DMCA gửi tới Cloudflare
   (không phải chỉ gỡ 1 truyện mà có thể tạm khóa cả zone/account) sẽ kéo sập
   luôn phần đọc truyện chữ đang hoạt động ổn định — rủi ro không đối xứng so
   với lợi ích của tính năng manga.

**Đề xuất giảm thiểu (áp dụng trước hoặc song song Giai đoạn 0 của lộ trình
manga ở mục 2.6, không phải làm cho xong hết mới bắt đầu):**

- **Cô lập hạ tầng theo loại nội dung**: R2 bucket/D1 riêng (hoặc ít nhất
  namespace/key prefix tách biệt rõ) cho manga, để một khiếu nại DMCA nhắm vào
  manga không kéo sập được phần truyện chữ. Cân nhắc cả việc dùng Cloudflare
  account/zone phụ nếu ngân sách cho phép, đúng tinh thần cô lập rủi ro.
- **Ưu tiên bộ truyện chưa có bản quyền chính thức tại VN** khi chọn 3-5 bộ
  thử nghiệm (Giai đoạn 0) — cần khảo sát thủ công trước (tra cứu NXB đã công
  bố phát hành hay chưa), không chọn ngẫu nhiên theo độ phổ biến.
- **Không SEO mạnh / không index công khai** cho phần manga ở giai đoạn thử
  nghiệm, giữ định hướng "cộng đồng nhỏ" đã áp dụng cho truyện chữ
  (`ROADMAP-nang-cap-2026-07.md` 4.6) — giảm khả năng bị chủ sở hữu bản quyền
  phát hiện sớm trong lúc còn thử nghiệm kỹ thuật.
- **Có quy trình gỡ truyện theo yêu cầu rõ ràng**, không chỉ ở mức "sẵn sàng
  gỡ khi có yêu cầu" như hiện tại: một kênh liên hệ cụ thể (email/form), cam
  kết thời gian xử lý, và log lại yêu cầu/hành động gỡ để có bằng chứng thiện
  chí tuân thủ nếu bị khiếu nại chính thức (DMCA counter-notice, làm việc với
  Cloudflare).
- **Giữ tư thế "host nội dung có sẵn" (Phương án A) tách bạch rõ khỏi việc tự
  render lại ảnh (Phương án B)** trong tài liệu/điều khoản sử dụng nội bộ —
  nếu sau này có tranh chấp, Phương án A (tổng hợp) và B (tự sinh bản dịch
  mới) có thể được đánh giá pháp lý khác nhau, nên đừng gộp lẫn khi ra quyết
  định phạm vi ở mục 2.1.

Đây là đánh giá rủi ro kỹ thuật, không phải tư vấn pháp lý — nếu tính năng
manga được mở rộng ngoài phạm vi thử nghiệm nhỏ (nhiều bộ truyện, lưu lượng
lớn, công khai rộng rãi), nên tham khảo ý kiến pháp lý thật trước khi triển
khai diện rộng.

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
