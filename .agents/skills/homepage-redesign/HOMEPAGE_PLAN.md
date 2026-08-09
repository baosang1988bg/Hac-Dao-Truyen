# Kế Hoạch Giai Đoạn 1: Sao Chép Toàn Bộ UI/UX & Component Của Truyentrung.com

Dự án nâng cấp Trang chủ `hacdaotruyen.com` tái hiện **100% cấu trúc giao diện (UI Layout)** và **trải nghiệm người dùng (UX)** của `https://truyentrung.com/`. Sau khi hoàn thành bản chuẩn của Truyentrung, người dùng sẽ tự điều chỉnh/custom lại sau theo ý muốn.

---

## 🔍 Đánh Giá Độ Khả Thi (Feasibility Assessment)

- **Kết luận**: **100% HOÀN TOÀN KHẢ THI**.
- **Kiến trúc Hiện Tại**: HacDaoTruyen đã được mô-đun hóa thành các section React riêng biệt trong `frontend/src/pages/homepage/`, rất thuận tiện để ghép/thay đổi layout theo đúng Truyentrung.
- **Dữ liệu D1**: Cơ sở dữ liệu D1 đã hỗ trợ đầy đủ các trường `views`, `rating`, `rating_count`, `chapter_count`, `updated_at`, `genre`, `status` để nạp dữ liệu thật vào các Bảng Xếp Hạng.
- **Flexibility**: Sử dụng React + Vanilla CSS chuẩn (không bị giới hạn bởi framework UI phụ thuộc).

---

## 📐 Danh Sách Các Section & Component Cần Thiết Của Truyentrung.com

```
┌────────────────────────────────────────────────────────────────────────┐
│  1. Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện          │
├────────────────────────────────────────────────────────────────────────┤
│  2. Monthly Popular Hero: Section "Nhân Khí Tháng" (Card nổi bật lớn)  │
├──────────────────────────────┬─────────────────────────────────────────┤
│  3. Recently Updated Table   │  4. Multi-Ranking Widgets (Sidebar)     │
│     (Bảng Mới Cập Nhật dạng  │     - BXH Nguyệt Phiếu / Phong Vân     │
│      bảng Table chuẩn)       │     - BXH Bán Chạy / Lượt Đọc           │
│                              │     - BXH Sách Mới                      │
│                              │     - BXH Tu Vi / Đánh Giá              │
├──────────────────────────────┼─────────────────────────────────────────┤
│  5. All Novels Tabbed List   │  6. Live Chatbox & Online Ranking       │
│     (Tất cả truyện dạng Tab) │     (Khung chat & thành viên online)    │
└──────────────────────────────┴─────────────────────────────────────────┘
```

---

## 🛠️ Danh Sách Công Việc Chi Tiết Cho Các Component

### 1. `index.css`
- Định nghĩa lại Design Tokens & Color Palette chuẩn theo Truyentrung (`#0f172a`, `#1e293b`, `#3b82f6`, `#10b981`).
- Styling cho Bảng Table `Truyện Mới Cập Nhật` (Thể loại | Tên truyện | Tác giả | Tình trạng | Số chương).

### 2. `TruyThuNoticeSection.jsx`
- Khung bài đăng tìm truyện / Truy thư lệnh ở vị trí trên cùng.

### 3. `MonthlyPopularSection.jsx`
- Section *"Nhân Khí Tháng"* (Card truyện hot nhất tháng với bìa 180px, tóm tắt, lượt đọc).

### 4. `UpdatesSection.jsx`
- Chuyển đổi thành Bảng Table chuẩn 5 cột của Truyentrung + link *"Xem thêm truyện nguồn Qidian →"*.

### 5. `TruyenTrungRankings.jsx`
- Khối 5 Bảng Xếp Hạng: *Nguyệt Phiếu, Bán Chạy, Lượt Đọc, Sách Mới, Đánh Giá & Bình Luận*.

### 6. `TruyenTrungChatboxWidget.jsx`
- Khung Chatbox trực tuyến & BXH Thành viên Tu Vi / Online.

### 7. `HomePage.jsx`
- Điều phối tổng thể các section theo đúng thứ tự 1 ➔ 6 của Truyentrung.com.
