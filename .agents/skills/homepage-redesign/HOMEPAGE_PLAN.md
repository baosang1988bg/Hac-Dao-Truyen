# Kế Hoạch Nghiên Cứu Nguồn Dữ Liệu Truyentrung.com & Nâng Cấp Hắc Đạo Truyện

Tài liệu này tổng hợp kết quả nghiên cứu cách thức **truyentrung.com** thu thập dữ liệu và đề xuất kế hoạch nâng cấp toàn diện cho hệ thống cào/dịch truyện của **HacDaoTruyen**.

---

## 🔍 Kết Quả Nghiên Cứu Nguồn Dữ Liệu Của Truyentrung.com

Truyentrung.com quản lý hơn **86,222+ bộ truyện**. Hệ thống của họ lấy dữ liệu từ 5 nguồn chính:

### 1. Nguồn Dữ Liệu Gốc (Data Sources)
- **Qidian (起点中文网 - qidian.com)**: Nguồn metadata chính (Tiêu đề, Tác giả, Ảnh bìa Yuewen `bookcover.yuewen.com`, Thể loại, Tóm tắt, Mục lục gốc).
- **69shuba (69书吧 - 69shuba.cx / 69shu.me)**: Nguồn crawl văn bản thô (raw Chinese text) miễn phí tốc độ cao nhất (thường có chương mới chỉ sau 5-10 phút so với Qidian).
- **Fanqie (番茄小说 - fanqienovel.com)**: Nguồn truyện Đô thị, Hệ thống, Giải trí từ ByteDance.
- **Faloo (飞卢小说网 - b.faloo.com)**: Nguồn truyện Đồng nhân, Sảng văn, Vô địch lưu.
- **Novel543 / Biquge (novel543.com, biquge.biz)**: Nguồn dự phòng (fallback) khi 69shuba bị chặn Cloudflare hoặc gián đoạn.

---

## 🚀 Kế Hoạch Nâng Cấp Hệ Thống Cho Hắc Đạo Truyện

Chúng ta sẽ nâng cấp HacDaoTruyen thành **Hệ thống Cào & Dịch Tự Động Đa Nguồn (Multi-Source Automated Novel Engine)** theo 4 giai đoạn:

- **Giai Đoạn 1 — Đa Nguồn Crawl (`scraper.py`)**: Nhận diện & cào 5 nguồn (Qidian, 69shuba, Novel543, Fanqie, Faloo).
- **Giai Đoạn 2 — CLI Import 1-Click (`main.py import --url <URL>`)**: Tự động bóc tách thông tin, tạo `novel.json`, `catalog.json` và lưu ảnh bìa lên R2.
- **Giai Đoạn 3 — Auto Multi-Novel Watcher (`cloud_to_cloud_syncer.py`)**: Tự động theo dõi và cập nhật tất cả truyện đang ra trên đám mây.
- **Giai Đoạn 4 — Yêu Cầu Truyện Mới (`RequestNovelModal.jsx`)**: Cho phép độc giả gửi URL truyện bên Trung để tự động đưa vào hàng chờ dịch.
