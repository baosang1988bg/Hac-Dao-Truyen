# External rankings

## Vận hành

1. Áp dụng migration trước khi deploy Worker:
   `npx wrangler d1 migrations apply hacdao-db --remote`
   (Tên database phải khớp binding DB trong `wrangler.jsonc`.)
2. Build và deploy bằng quy trình hiện có (`npm run deploy`).
3. Workflow `.github/workflows/fetch_rankings.yml` dùng secret `HACDAO_SYNC_KEY`
   trùng với `SYNC_KEY` của Worker, chạy 00:30 giờ Việt Nam hoặc chạy tay bằng
   `workflow_dispatch`. Không cần Playwright hay commit dữ liệu. Có dùng secret
   `GEMINI_API_KEY` (đã có sẵn, dùng chung với pipeline dịch chương) để dịch
   title/author sang tiếng Việt — thiếu key hoặc lỗi gọi API chỉ tắt bước dịch,
   không chặn sync (fallback giữ nguyên văn gốc).
4. Kiểm tra không ghi dữ liệu: `python tools/fetch_rankings.py --dry-run`.
   Khi chạy local, có thể đặt `HACDAO_SYNC_HOST` thành hostname Worker thử nghiệm.

Endpoint rankings độc lập với cờ/ngân sách sync chương theo thiết kế. Nó vẫn dùng
xác thực timing-safe và rate limiter `sync` hiện có.

## Nguồn đã xác minh ngày 2026-09-15

| Nguồn | Tổ hợp bật | URL |
| --- | --- | --- |
| Qidian | Đề cử / tháng (phiếu tháng, 月票) | https://www.qidian.com/rank/yuepiao/ |
| Qidian | Đề cử / tuần (推荐票) | https://www.qidian.com/rank/recom/ |
| Qidian | Theo dõi / toàn thời gian (总收藏, 收藏榜) | https://www.qidian.com/rank/collect/ |
| Qidian | Lượt đọc / ngày (畅销榜, "本日作品销量排行") | https://www.qidian.com/rank/hotsales/ |
| Faloo | Lượt đọc / tuần | https://b.faloo.com/y_0_0_0_0_0_1_1.html |
| Faloo | Lượt đọc / tháng | https://b.faloo.com/y_0_0_0_0_0_2_1.html |

Mỗi trang trên đã trả được 20 mục qua Jina. Qidian mã hóa chữ số bằng font riêng:
số không đọc được được bỏ trống, không đoán giá trị (áp dụng cả cho `收藏榜`/
`畅销榜` — 2 trang này thường không lộ số liệu qua Jina nên `stat_label` có thể
rỗng). Phiếu tháng được xếp loại `recommend`, không phải lượt đọc. `收藏榜` là
tổng lũy kế từ trước đến nay (không tách được theo tuần/tháng) nên dùng
`window="all_time"` thay vì đoán một khung thời gian không có thật. Faloo dùng
bộ lọc trạng thái 0 (tất cả), không dùng 8 (truyện được đề cử).

`title`/`author` được dịch sang tiếng Việt bằng Gemini (`providers/gemini.py`,
tái dùng key rotation có sẵn) ngay trước khi sync — không giữ song song bản gốc.
`stat_label` giữ nguyên văn gốc (số liệu + đơn vị, không cần dịch).

## Nguồn chưa bật

- **69shuba:** https://www.69shuba.com/novels/hot có danh sách click với 20 mục
  parse được, nhưng Jina không công bố khung ngày/tuần/tháng/quý; HTML trực tiếp
  trả trang kiểm tra trình duyệt. Không gán nhãn ngày chỉ vì script chạy hằng ngày.
- **Novel543:** https://www.novel543.com/ trả truyện mới, không phải BXH;
  https://www.novel543.com/top/ trả 404. Chưa xác minh được URL BXH.
- **Fanqie:** https://fanqienovel.com/rank trả bảng theo giới/thể loại, có chữ mã
  hóa và thiếu link trang truyện trong output Jina; chưa đủ dữ liệu hợp lệ để sync.

Parser riêng và fixture kiểm tra được đặt sẵn cho cả năm nguồn. Parser của
Novel543/Fanqie có kiểm tra từ chối output hiện tại; nhánh thành công dự phòng
chưa được xác minh với một trang BXH thật. Muốn bật nguồn mới, cần xác minh URL,
khung thời gian, phạm vi bảng và fixture trước khi thêm vào `RANKING_SOURCES`.
Không khai báo bảng quý/ngày khi chưa xác minh nguồn thực sự công bố.

## Snapshot và lỗi

- Upsert theo `(source, category, window, rank)`, không giữ lịch sử.
- Fetch/parse lỗi, rỗng, trùng truyện hoặc thiếu thứ hạng: bỏ qua tổ hợp đó;
  các tổ hợp khác tiếp tục sync. Nguồn chưa bật được log rõ lý do.
- GET chỉ lấy các slot có ngày mới nhất của mỗi tổ hợp để không trộn phần đuôi
  của snapshot cũ nếu snapshot mới ngắn hơn. Slot cũ vẫn nằm trong bảng theo
  yêu cầu upsert, không tăng lịch sử theo ngày.
- UI hiển thị ngày snapshot. Không có dữ liệu hoặc API lỗi thì tự ẩn section.
- Retry tối đa 5 lần với backoff và `Retry-After` cho 429/5xx và lỗi kết nối.
  Lỗi sync một nguồn không chặn gửi nguồn khác; script trả mã lỗi nếu không nguồn
  nào scrape được hoặc có nguồn sync thất bại.
- API cache public 3 giờ, nên dữ liệu mới có thể xuất hiện chậm tối đa 3 giờ.

## Kiểm tra

```sh
python -m pytest -q tests/test_fetch_rankings.py tests/test_sync_budget.py
npm run test:worker
npm run build --prefix frontend
npm run lint --prefix frontend
```

Fixture là đoạn cấu trúc Jina đã rút gọn, bỏ mô tả truyện dài. Số `1234 月票`
trong fixture Qidian là giá trị giả lập để test trường hợp chữ số đọc được.
Fixture Novel543/Fanqie kiểm tra từ chối trang chưa đủ điều kiện, không chứng minh
khả năng lấy BXH thành công. Unit test không gọi mạng ngoài.
