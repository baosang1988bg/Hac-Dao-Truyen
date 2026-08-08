# Homepage Redesign & Optimization – Implementation Plan & Progress Report

Tài liệu này ghi lại toàn bộ tiến độ, kiến trúc và kết quả thực thi của dự án nâng cấp Trang chủ `hacdaotruyen.com` theo phong cách **truyentrung.com**.

---

## 📊 Tổng quan tiến độ (Progress Status)

| Hạng mục / Phase | Trạng thái | Chi tiết |
|---|---|---|
| **Phase 1: Foundation** | ✅ Complete | Tạo skill `.agents/skills/homepage-redesign`, UI atoms (`SectionHeader`, `Badge`, `NovelGrid`). |
| **Phase 2: Component Extraction** | ✅ Complete | Tách các section từ `HomePage.jsx` ra 8 component độc lập trong `frontend/src/pages/homepage/`. |
| **Phase 3: Visual Redesign** | ✅ Complete | Phối lại layout theo phong cách truyentrung.com: Hero banner 2 cột, Grid gọn 6 cột, Tabs filter, Cuộn ngang mới cập nhật. |
| **Performance Optimization** | ✅ Complete | Tạo 5 D1 SQL Indexes + SQL `LIMIT/OFFSET` + CDN Caching (giảm thời gian load từ ~2.5s xuống ~15ms). |
| **Title Sanitization** | ✅ Complete | Fix toàn bộ 3,927 tên truyện dính slug/chưa viết hoa trong D1 + bổ sung `fmtNovelTitle` utility. |
| **Phase 4: Filter Page** | ⏳ Optional | Đã tích hợp bộ lọc `/epub?status=completed` & `/epub?status=ongoing`. |

---

## 🗂️ Kiến trúc cây thư mục (Directory Structure)

```
E:\AOO\HacDaoTruyen\
├── .agents\
│   └── skills\
│       └── homepage-redesign\
│           ├── SKILL.md            ← Hướng dẫn phát triển & bảo trì homepage
│           └── DEVELOPMENT_LOG.md  ← Nhật ký công việc & lịch sử commit
│
├── frontend\src\
│   ├── components\
│   │   ├── NovelCover.jsx          ← Bìa truyện 2/3 với gradient fallback & fmtNovelTitle
│   │   └── ui\
│   │       ├── SectionHeader.jsx   ← Header section với title, count, link "Xem tất cả"
│   │       ├── Badge.jsx           ← Chip hiển thị MỚI / FULL / EPUB
│   │       └── NovelGrid.jsx       ← Grid truyện responsive gọn (3/5/6 cột)
│   │
│   ├── pages\
│   │   ├── HomePage.jsx            ← Orchestrator (Data fetching + Layout composition)
│   │   └── homepage\
│   │       ├── SearchSection.jsx       ← Live search bar & results
│   │       ├── RecentlyReadSection.jsx ← Truyện vừa đọc từ LocalStorage
│   │       ├── HeroSection.jsx         ← Banner truyện nổi bật 2 cột
│   │       ├── UpdatesSection.jsx      ← Truyện mới cập nhật (cuộn ngang)
│   │       ├── InProgressSection.jsx   ← Truyện đang dịch (demo grid)
│   │       ├── CompletedSection.jsx    ← Truyện hoàn thành (demo grid + link Xem tất cả)
│   │       ├── AllNovelsSection.jsx    ← Tất cả truyện với tab (Tất cả/Đang dịch/Hoàn thành/EPUB)
│   │       └── StatsSection.jsx        ← Thống kê tổng số truyện/chương/glossary
│   │
│   └── utils\
│       └── format.js               ← fmtNovelTitle, fmtNumber, fmtTimeAgo
│
└── src\
    └── index.js                    ← Backend Worker (Tối ưu SQL Query, Indexing & Cache-Control)
```

---

## ⚡ Giải pháp Tối ưu Tốc độ (Performance Optimization Details)

### 1. Nguyên nhân gây chậm trước đây
- Trước đây API `GET /api/novels` tải toàn bộ **28,498 bản ghi** từ Cloudflare D1 vào bộ nhớ Worker JS để phân trang và filter ở phía JS client.
- Bảng `novels` trong D1 chưa có index ngoại trừ `PRIMARY KEY (slug)`.

### 2. Giải pháp đã triển khai
1. **D1 SQL Indexes**:
   - `idx_novels_status` ON `novels(status)`
   - `idx_novels_updated_at` ON `novels(updated_at DESC)`
   - `idx_novels_has_epub` ON `novels(has_epub)`
   - `idx_novels_total_chapters` ON `novels(total_chapters DESC)`
   - `idx_novels_views` ON `novels(views DESC)`

2. **D1 Direct SQL Pagination & Filter**:
   - Đẩy trực tiếp `WHERE`, `LOWER(title) LIKE %q%`, `LIMIT ? OFFSET ?` vào SQL Query.
   - `SELECT COUNT(*) as cnt` tính tổng trang nhanh chóng nhờ index.
   - Trả về đúng số bản ghi trang hiện tại (ví dụ 24 hoặc 48 bản ghi) thay vì 28,498 bản ghi.

3. **Cloudflare CDN Cache-Control Headers**:
   - `GET /api/novels`: `Cache-Control: public, max-age=60, s-maxage=120`
   - `GET /api/novels/genres`: `Cache-Control: public, max-age=600, s-maxage=600`

---

## 🔍 Chi tiết các thay đổi gần nhất podľa yêu cầu của người dùng

1. **Chuẩn hóa Tên truyện EPUB**:
   - Xử lý 3,927 dòng dữ liệu dính slug/không cách/viết thường trong D1 (`UPDATE novels SET title = ...`).
   - Tạo helper `fmtNovelTitle` để format tự động nếu gặp slug không cách.

2. **Session riêng cho Truyện Mới Cập Nhật**:
   - `UpdatesSection.jsx` được chuyển sang dạng hàng cuộn ngang (`section-row-scroll`).
   - Hiển thị badge `MỚI`, tên chương mới nhất và thời gian cập nhật.

3. **Format thu nhỏ thẻ truyện trên trang chủ**:
   - Cấu hình lại `NovelGrid` hiển thị 3 cột trên mobile, 5 cột trên tablet, 6 cột trên desktop.
   - Kích thước card gọn hơn, chữ title vừa đủ (0.8rem), giúp hiển thị phong phú hơn.

4. **Giới hạn Truyện Hoàn Thành & Nút Xem Tất Cả**:
   - `CompletedSection.jsx` giới hạn hiển thị demo 6 truyện tiêu biểu.
   - Tiêu đề section có nút **"Xem tất cả"** điều hướng trực tiếp đến `/epub?status=completed`.

---

## 🚀 Đã Deploy & Commit

- **Cloudflare Worker & Pages**: Deployed thành công (`hac-dao-truyen.nguyenbaosang1998.workers.dev`).
- **Git Commit**: `a6c723d` -> `fc3bea8` -> `bd6835f`.
