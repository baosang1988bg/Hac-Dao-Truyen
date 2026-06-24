# Quản lý Mục lục Truyện (Novels Directory)

Thư mục này chứa mục lục các bộ truyện được Agent tự động tìm kiếm, tải và cập nhật từ các nguồn web truyện lớn (Qidian, 69shuba, ixdzs8, novel543, truyendich.ai).

## Cấu trúc thư mục
Mục lục các truyện được tổ chức phân cấp theo tên nền tảng nguồn:
```
novel/
├── README.md         <- File hướng dẫn này
├── truyendich/       <- Thư mục chứa truyện dịch tiếng Việt từ truyendich.ai
├── novel543/         <- Thư mục chứa truyện từ novel543.com
├── ixdzs/            <- Thư mục chứa truyện từ ixdzs8.com
├── qidian/           <- Thư mục chứa truyện từ qidian.com
└── 69shuba/          <- Thư mục chứa truyện từ 69shuba.tw
```

## Các lệnh sử dụng nhanh

### 1. Tìm kiếm và tự động chọn nguồn tốt nhất (Khuyên dùng)
Bạn không cần phải tự tìm URL nữa, chỉ cần chạy lệnh sau và hệ thống sẽ tự động quét, chọn nguồn có nhiều chương miễn phí nhất:

```bash
# Tải/Cập nhật truyện phiên bản dịch Tiếng Việt (Ưu tiên truyendich.ai)
python3 scripts/novel_catalog.py fetch --name "Tên Truyện" --best --lang vi

# Tải/Cập nhật truyện phiên bản Tiếng Trung gốc (Ưu tiên novel543/ixdzs/69shu)
python3 scripts/novel_catalog.py fetch --name "Tên Truyện" --best --lang cn
```

### 2. Xem các nguồn truyện trực tuyến khả dụng và số chương
Nếu muốn kiểm tra xem truyện có ở những trang nào và trang nào nhiều chương nhất:
```bash
python3 scripts/novel_catalog.py search-online --name "Tên Truyện"
```

### 3. Tải/Cập nhật với một URL cụ thể
Nếu muốn cố định tải từ một URL bạn đã chọn trước:
```bash
python3 scripts/novel_catalog.py fetch --name "Tên Truyện" --url "URL_CỦA_TRUYỆN"
```

## Logic hoạt động
1.  **Tìm kiếm chủ động (Proactive Search)**: Sử dụng DuckDuckGo Lite để tìm kiếm nhanh các nguồn liên kết truyện dựa trên tên bạn cung cấp, giúp giải quyết việc phải đi tìm link thủ công.
2.  **Hỗ trợ API truyện dịch Việt Nam**: Hỗ trợ đầy đủ trang `truyendich.ai` với cơ chế phân trang API cực nhanh, tải toàn bộ hàng nghìn chương dịch tiếng Việt chỉ trong vài giây.
3.  **Tự động cập nhật nối tiếp (Incremental Update)**: Nếu file mục lục của truyện đã tồn tại cục bộ ở thư mục `novel/...`, script sẽ đọc file đó để xem chương cuối cùng đang có là chương mấy. Sau đó so sánh với danh sách online và chỉ tải/cập nhật thêm các chương mới xuất hiện, giữ nguyên các thông tin cũ.
4.  **Phản đối VIP (Lọc VIP)**: Đối với các nguồn có chương tính phí như Qidian, hệ thống tự động loại bỏ các chương bắt buộc trả phí (VIP), chỉ thu thập các chương hoàn toàn miễn phí mà người dùng có thể đọc được ngay.
5.  **Phân nhóm chương**: Mục lục được chia thành các nhóm 100 chương dưới dạng thẻ đóng/mở `<details><summary>` trong Markdown giúp danh sách luôn gọn gàng và dễ tra cứu.
