# Homepage Redesign & Optimization – Implementation Plan & Progress Report

Tài liệu này ghi lại toàn bộ tiến độ, kiến trúc và kết quả thực thi của dự án nâng cấp Trang chủ `hacdaotruyen.com` theo phong cách **truyentrung.com** & **Qidian (起点中文网)**.

---

## 📊 Tổng quan tiến độ (Progress Status)

| Hạng mục / Phase | Trạng thái | Chi tiết |
|---|---|---|
| **Phase 1: Foundation** | ✅ Complete | Tạo skill `.agents/skills/homepage-redesign`, UI atoms (`SectionHeader`, `Badge`, `NovelGrid`, `NovelList`). |
| **Phase 2: Component Extraction** | ✅ Complete | Tách các section từ `HomePage.jsx` ra các component độc lập trong `frontend/src/pages/homepage/`. |
| **Phase 3: Visual & Portal Redesign** | ✅ Complete | Phối lại layout 2 Cột Portal (Main Left + Sidebar Right): Khung thông báo chương mới, Bảng xếp hạng Qidian, Tin tức & thông báo, Thảo luận mới. |
| **Compact List Row View** | ✅ Complete | Chuyển đổi thẻ truyện to thành dạng danh sách dòng compact (`~52px` height) hiển thị 15-20 truyện gọn gàng trên 1 màn hình. |
| **Qidian Rankings System** | ✅ Complete | Xây dựng Bảng Xếp Hạng chuẩn Qidian (Phong Vân Bảng, Đọc Nhiều, Đề Cử Bảng, Tân Thư Bảng) với thứ tự #1, #2, #3 mạ vàng/bạc/đồng. |
| **Performance Optimization** | ✅ Complete | Tạo 5 D1 SQL Indexes + SQL `LIMIT/OFFSET` + CDN Caching (giảm thời gian load từ ~2.5s xuống ~15ms). |
| **Title Sanitization** | ✅ Complete | Fix toàn bộ 3,927 tên truyện dính slug/chưa viết hoa trong D1 + bổ sung `fmtNovelTitle` utility. |

---

## 🗂️ Kiến trúc cây thư mục (Directory Structure)

```
E:\AOO\HacDaoTruyen\
├── .agents\
│   └── skills\
│       └── homepage-redesign\
│           ├── SKILL.md            ← Hướng dẫn phát triển & bảo trì homepage
│           ├── HOMEPAGE_PLAN.md    ← Bản sao lưu plan cho agent khác
│           └── DEVELOPMENT_LOG.md  ← Nhật ký công việc & lịch sử commit
│
├── frontend\src\
│   ├── components\
│   │   ├── NovelCover.jsx          ← Bìa truyện 2/3 với gradient fallback & fmtNovelTitle
│   │   └── ui\
│   │       ├── SectionHeader.jsx   ← Header section với title, count, link "Xem tất cả"
│   │       ├── Badge.jsx           ← Chip hiển thị MỚI / FULL / EPUB
│   │       ├── NovelGrid.jsx       ← Grid truyện responsive gọn (3/5/6 cột)
│   │       └── NovelList.jsx       ← Danh sách truyện dạng Row List Compact (~52px dòng)
│   │
│   ├── pages\
│   │   ├── HomePage.jsx            ← Orchestrator Portal 2 cột (Main Content + Sidebar Right)
│   │   └── homepage\
│   │       ├── SearchSection.jsx           ← Live search bar & results
│   │       ├── GenreChips.jsx              ← Dải chip lọc thể loại nhanh
│   │       ├── RecentlyReadSection.jsx     ← Truyện vừa đọc từ LocalStorage
│   │       ├── HeroSection.jsx             ← Banner truyện nổi bật
│   │       ├── UpdatesSection.jsx          ← Truyện mới cập nhật (dạng List Compact)
│   │       ├── InProgressSection.jsx       ← Truyện đang dịch (grid compact)
│   │       ├── CompletedSection.jsx        ← Truyện hoàn thành (demo grid + link Xem tất cả)
│   │       ├── AllNovelsSection.jsx        ← Tất cả truyện (Chế độ xem List default, Grid, Table)
│   │       ├── NewChapterWidget.jsx        ← Khung thông báo chương mới vừa dịch (nút "Đọc ngay")
│   │       ├── QidianRankingsWidget.jsx    ← Bảng xếp hạng Qidian (Phong Vân/Đọc Nhiều/Đề Cử/Tân Thư)
│   │       ├── NewsAnnouncementsWidget.jsx ← Khung Tin Tức & Thông Báo phong cách truyentrung
│   │       ├── RecentCommentsSection.jsx   ← Bình luận mới nhất toàn site
│   │       └── StatsSection.jsx            ← Thống kê tổng số truyện/chương/glossary
│   │
│   └── utils\
│       └── format.js               ← fmtNovelTitle, fmtNumber, fmtTimeAgo
│
└── src\
    └── index.js                    ← Backend Worker (Tối ưu SQL Query, Indexing & Cache-Control)
```

---

## 🔍 Chi tiết các nâng cấp UX/UI mới nhất

1. **Giao diện Danh sách Compact (`NovelList.jsx`)**:
   - Thay thế các thẻ truyện dọc quá to bằng danh sách hàng ngang gọn gàng.
   - Mỗi hàng gồm: Bìa nhỏ 36x50px, Tên viết hoa đẹp, Chip thể loại, Tác giả, Số chương, Lượt xem và thời gian cập nhật.
   - Giúp người đọc dễ dàng cuộn lướt 15-20 truyện liên tục chỉ trong 1 màn hình.

2. **Bảng Xếp Hạng chuẩn Qidian (`QidianRankingsWidget.jsx`)**:
   - Tích hợp 4 bảng xếp hạng chính của Qidian/Truyentrung:
     - 🌟 **Phong Vân Bảng**: Bảng xếp hạng tổng hợp.
     - 👁️ **Đọc Nhiều**: Top lượt xem cao nhất.
     - ⭐ **Đề Cử Bảng**: Top đánh giá 5 sao.
     - 🆕 **Tân Thư Bảng**: Top sách mới ra mắt/mới cập nhật.
   - Thiết kế huy hiệu thứ tự #1 (Vàng), #2 (Bạc), #3 (Đồng) nổi bật.

3. **Bố cục 2 Cột Portal (Main Left 68% + Sidebar Right 32%)**:
   - Main Left: Dành riêng cho trải nghiệm duyệt và đọc danh sách truyện chính.
   - Sidebar Right: Dành cho các widget thông báo, xếp hạng, tin tức, bình luận mới và thống kê.
