# Báo Cáo Xử Lý — Phiên 5 (2026-08-13)

> Tiếp nối phiên 4 (audit toàn diện, 17 mục, đã xử lý 100%). Yêu cầu phiên này:
> "hãy xử lí các vấn đề trong danh sách" (xác nhận lại toàn bộ audit phiên 4 đã
> xong) + "edit lại cloud-to-cloud đảm bảo chỉ chạy trong giới hạn để cập nhật
> truyện, không muốn trả phí cho Cloudflare".

## 1. Xác nhận danh sách audit phiên 4

Toàn bộ 17 mục trong `KE_HOACH_AUDIT_PHIEN4_2026-08-13.md` đã được xử lý xong
trong 6 commit ở phiên 4 (`e55e454`, `74565ec`, `ef22d97`, `a8cc247`, `ce97602`,
`682e048`) — không có mục nào còn tồn đọng, ngoại trừ 9 file frontend dead code
mà bạn đã chọn **giữ nguyên** (không phải bug, chỉ là dead code an toàn). Không
có việc mới nào cần làm thêm cho danh sách này.

## 2. Cloud-to-Cloud Sync — thêm ngân sách tự giới hạn (commit `1337e52`)

### Bối cảnh chi phí

Script `tools/cloud_to_cloud_syncer.py` từng bị gỡ khỏi cron tự động (30
phút/lần) vì tạo ra 1.4 triệu lượt ghi R2 trong 1 tháng, vượt free tier và
phát sinh khoảng 9 USD phí (đã ghi nhận ở Vấn đề 3, `TONG_HOP_VAN_DE_2026-08-13.md`).
Cron đã bị xóa từ trước, giờ chỉ chạy qua `workflow_dispatch` (bấm tay). Tuy
nhiên bản thân script vẫn **không có cơ chế tự giới hạn** — nếu chạy tay với
backlog lớn (nhiều truyện, nhiều chương mới cùng lúc), vẫn có thể tiêu tốn hết
ngân sách free tier chỉ trong một lần chạy.

### Đã tra cứu lại hạn mức free tier Cloudflare (2026)

- **R2**: 1.000.000 lượt Class A (ghi/PUT)/tháng miễn phí, 10.000.000 lượt
  Class B (đọc)/tháng miễn phí, 10GB lưu trữ miễn phí.
- **D1**: 5.000.000 hàng đọc/ngày, 100.000 hàng ghi/ngày, 5GB lưu trữ miễn phí,
  reset lúc 00:00 UTC.
- **Workers subrequests**: gói Free giới hạn 50 subrequest ra ngoài/lần gọi;
  gói Paid mặc định 10.000 (có thể tăng tới 10 triệu) — không ảnh hưởng trực
  tiếp tới script này nhưng liên quan tới endpoint `/api/admin/sync-novel` mà
  script gọi.

### Giải pháp: class `SyncBudget`

Thêm vào `tools/cloud_to_cloud_syncer.py`:

- **Đếm và giới hạn 3 tầng**: (1) tối đa mỗi lần chạy (`--max-ops-per-run`,
  mặc định 20.000) — tránh 1 lần chạy nuốt hết ngân sách cả tháng khi backfill
  lần đầu; (2) ngân sách R2 hàng tháng (`--r2-budget`, mặc định 800.000, tức
  80% của 1 triệu free); (3) ngân sách D1 hàng ngày (`--d1-budget`, mặc định
  80.000, tức 80% của 100.000 free).
- **Bền vững qua file JSON** (`--budget-file`, mặc định
  `.cloud_sync_budget.json` cạnh state file) — nhiều lần chạy tay trong cùng
  tháng/ngày vẫn cộng dồn đúng, không reset về 0 mỗi lần chạy.
- **Tự động rollover** theo đúng chu kỳ billing thật của Cloudflare: reset bộ
  đếm R2 khi sang tháng UTC mới, reset bộ đếm D1 khi sang ngày UTC mới.
- **Thread-safe**: `sync_novel_from_drive()` chạy song song trong
  `ThreadPoolExecutor`, mọi lượt đăng ký ngân sách đều qua `threading.Lock()`.
- **Kiểm tra TRƯỚC khi gửi**: mỗi chunk chương được ước lượng đúng số lượt ghi
  R2/D1 mà `syncNovelBatch()` phía Worker sẽ tạo ra, gọi `budget.try_reserve()`
  trước khi gửi — nếu sẽ vượt ngưỡng, KHÔNG gửi request, trả về
  `budget_exceeded=True` thay vì cứ gửi rồi mới biết đã vượt.
- **Dừng an toàn**: vòng lặp chính trong `main()` dừng toàn bộ ngay khi phát
  hiện `budget_exceeded` (không thử truyện khác), in rõ lý do dừng + ngân sách
  còn lại, giữ nguyên tiến độ đã lưu — chạy lại sau sẽ tiếp tục đúng chỗ dừng,
  không mất dữ liệu.

### Giới hạn đã ghi rõ trong docstring

Ngân sách này chỉ đếm lượt ghi do **chính script `cloud_to_cloud_syncer.py`**
tạo ra — KHÔNG tính `migrate_to_cloudflare.py` (cron hàng ngày dịch chương
mới) hay traffic đọc thật từ độc giả, cả hai đều dùng chung tài nguyên
R2/D1. Đây là lý do để dư 20% thay vì dùng sát 100% free tier. Khuyến nghị
bạn thỉnh thoảng tự kiểm tra dashboard Cloudflare thật để đối chiếu.

### Cách verify

- `python3 -m py_compile tools/cloud_to_cloud_syncer.py` — pass.
- Unit test độc lập cho `SyncBudget` (5 kịch bản: đăng ký trong hạn mức; vượt
  `max-ops-per-run`; vượt ngân sách tháng; ngân sách bền vững qua nhiều
  instance mô phỏng nhiều lần chạy script; rollover đúng theo tháng/ngày UTC)
  — tất cả pass.
- Test tích hợp `sync_novel_from_drive()` với Google Drive/Cloudflare giả lập
  (monkeypatch, không gọi mạng thật): ngân sách rộng rãi gửi đủ 3/3 chunk của
  1 truyện 350 chương; ngân sách chỉ đủ 1 chunk đầu thì dừng đúng ngay sau
  chunk đó — cả hai case pass.
- `python3 -m pytest tests/ -q --ignore=tests/test_integration.py` — 7/7 pass,
  không ảnh hưởng gì tới phần còn lại của project.
- `git status --short` — chỉ 1 file thay đổi (`tools/cloud_to_cloud_syncer.py`).

### Chưa test được / khuyến nghị tiếp theo

- Chưa chạy thử với Cloudflare/Google Drive thật (sandbox không có
  `credentials.json` + `SYNC_KEY` thật) — nên chạy thử tay 1 lần với 1 truyện
  nhỏ trước khi tin tưởng hoàn toàn.
- `tools/batch_cloud_syncer.py` dùng chung endpoint `/api/admin/sync-novel` và
  có cùng rủi ro chi phí, nhưng CHƯA được áp dụng cơ chế ngân sách này (yêu
  cầu lần này chỉ nói "cloud-to-cloud"). Nếu bạn vẫn dùng script đó để đồng bộ
  thủ công, nên cho biết để áp dụng cơ chế tương tự.

## 3. Fix bug: truyện Lãnh Chúa có mục lục nhưng không đọc được (commit `be79d6c`)

Bạn báo lỗi cụ thể: truyện `pokemon-chi-tu-lam-lanh-chua-bat-dau` có mục lục
chương nhưng bấm vào chương thì không tải được nội dung. Kiểm tra `src/index.js`
phát hiện `getChapters()` (mục lục) có 3 tầng dự phòng D1/R2/Drive, nhưng
`getChapterContent()` (nội dung 1 chương) chỉ có D1/R2 — thiếu hẳn tầng Drive.
Với truyện nhập hàng loạt từ Google Drive (28.477 truyện, commit `7c49ac7`)
chưa từng được đồng bộ nội dung thật vào R2, mục lục tự cache được nhờ đọc
Drive, nhưng nội dung từng chương thì không, dẫn tới 404 khi đọc.

Đã thêm `getChapterContentFromDrive()`: khi D1/R2 miss, tải lại `chapters.json`
từ Drive, lấy đúng nội dung chương, trả về ngay cho người đọc, đồng thời tự
ghi cache vào R2 + D1 để lần đọc sau không cần gọi lại Drive. Verify bằng
harness Node mô phỏng toàn bộ R2/D1/Drive, gọi thẳng `default.fetch()` (entrypoint
Worker thật) — 6 kịch bản đều pass, bao gồm xác nhận Drive KHÔNG bị gọi lại ở
lần đọc thứ 2. Chưa test được với Cloudflare/Drive thật — cần bạn tự kiểm tra
lại đúng truyện `pokemon-chi-tu-lam-lanh-chua-bat-dau` sau khi deploy.
