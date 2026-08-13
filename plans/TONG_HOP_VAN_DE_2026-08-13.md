# 📋 Kế Hoạch Tổng Hợp: Các Vấn Đề Tồn Đọng & Hướng Xử Lý — HacDaoTruyen
> Ngày tạo: 2026-08-13 | Trạng thái: Đang triển khai

---

## 🔍 Tổng Quan Kiểm Tra

Đã kiểm tra toàn diện 3 mảng chính:
- **Frontend**: 19 components homepage, 9 trang, router, build
- **Backend**: Cloudflare Worker, scripts, workflows, R2/D1
- **Tổ chức**: 29 file .md kế hoạch/báo cáo nằm rải rác

---

## 🐛 Các Vấn Đề Đã Phát Hiện & Trạng Thái Xử Lý

### Vấn đề 1 — `auto_check_lanh_chua.py` dùng `cmd.exe` (Crash trên Linux)
- **Mức độ**: 🔴 **Nghiêm trọng** (Khiến job tự động dịch chương mới 100% THẤT BẠI trên GitHub Actions)
- **Mô tả**: Dòng 148 gọi `subprocess.run(["cmd.exe", "/c", "npm run build"])` — lệnh `cmd.exe` không tồn tại trên Ubuntu Linux runner.
- **Trạng thái**: ✅ **ĐÃ SỬA** — Thay bằng `subprocess.run([npm_cmd, "run", "build"])` với `npm_cmd = "npm.cmd" if os.name == 'nt' else "npm"`.

### Vấn đề 2 — GitHub Actions thiếu Node.js setup
- **Mức độ**: 🔴 **Nghiêm trọng** (Workflow không thể chạy `npm run build` và `npx wrangler deploy`)
- **Mô tả**: File `check_lanh_chua.yml` thiếu step `actions/setup-node@v4` và `npm ci` cho frontend dependencies.
- **Trạng thái**: ✅ **ĐÃ SỬA** — Đã thêm Node.js 20 setup, `npm ci`, và bỏ `|| true` che lỗi.

### Vấn đề 3 — Cloud-to-Cloud Sync tiêu tốn $9/tháng R2 Class A Operations
- **Mức độ**: 🟡 **Đã xử lý trước đó**
- **Mô tả**: Script `cloud_to_cloud_syncer.py` chạy cron 30 phút/lần tạo 1.4M lượt PUT, vượt mốc 1M free.
- **Trạng thái**: ✅ **ĐÃ TẮT** — Cron đã xóa, chỉ còn `workflow_dispatch` thủ công.

### Vấn đề 4 — R2 PUT chưa được tối ưu (migrate_to_cloudflare.py)
- **Mức độ**: 🟡 **Trung bình** (Có thể gây lại phí R2 nếu chạy sync cho nhiều truyện)
- **Mô tả**: Hàm `r2_put()` upload từng file chương riêng lẻ (1 PUT/chương). 3000 chương = 3000 lượt PUT.
- **Đề xuất**: Gộp chapters thành 1 file JSON duy nhất hoặc dùng batch upload qua Worker API thay vì `wrangler r2 object put`.
- **Trạng thái**: 📋 **CHƯA SỬA** — Cần refactor `migrate_to_cloudflare.py` (Ưu tiên Trung bình, an toàn vì cron đã tắt).

### Vấn đề 5 — Bundle size cảnh báo > 500KB
- **Mức độ**: 🟢 **Thấp** (Không ảnh hưởng chức năng, chỉ ảnh hưởng tốc độ tải lần đầu)
- **Mô tả**: `index-CtPgjQW5.js` = 547KB (vite cảnh báo). Do chưa code-split.
- **Đề xuất**: Dùng `React.lazy()` + `Suspense` cho các trang admin, epub reader.
- **Trạng thái**: 📋 **CHƯA SỬA** — Ưu tiên Thấp. Web vẫn hoạt động tốt.

### Vấn đề 6 — File NUL 189KB trong project root
- **Mức độ**: 🟢 **Thấp** (Tệp rác từ Windows redirect output)
- **Mô tả**: File `NUL` là Windows reserved device name, không thể xóa bằng `del`.
- **Trạng thái**: ✅ **ĐÃ XỬ LÝ** — Đã thêm `NUL` vào `.gitignore`.

### Vấn đề 7 — 29 file .md kế hoạch/báo cáo nằm rải rác khắp project
- **Mức độ**: 🟡 **Trung bình** (Khó theo dõi tiến độ và quản lý)
- **Mô tả**: Các file BAO_CAO, KE_HOACH, session-log nằm ở root, docs/plans/, .agents/skills/
- **Trạng thái**: ✅ **ĐÃ SỬA** — Di chuyển 15 file .md vào thư mục `plans/` tập trung.

---

## 📁 Cấu Trúc Thư Mục `plans/` Sau Khi Tổ Chức Lại

```
plans/
├── README.md                                    # Mục lục chính
├── TONG_HOP_VAN_DE_2026-08-13.md               # ← File này
├── ROADMAP-nang-cap-2026-07.md                  # Roadmap tổng thể tháng 7
├── HOMEPAGE_PLAN.md                              # Kế hoạch nghiên cứu nguồn dữ liệu
├── KE_HOACH_NANG_CAP_2026-08-08.md              # Kế hoạch nâng cấp bảo mật
├── KE_HOACH_HOC_HOI_TRUYENTRUNG_2026-08-08.md   # Kế hoạch học hỏi truyentrung.com
├── BAO_CAO.md                                    # Báo cáo bảo mật tháng 7
├── BAO_CAO_BAN_GIAO_NANG_CAP_BAO_MAT_2026-08-08.md
├── BAO_CAO_EPUB_SYNOPSIS.md
├── BAO_CAO_KIEM_TRA_2026-08-08.md
├── BAO_CAO_KIEM_TRA_LAI_SAU_MERGE_2026-08-08.md
├── BAO_CAO_UI.md
├── BAO_CAO-giai-doan-1.md                        # Báo cáo Phase 1
├── BAO_CAO-giai-doan-2.md                        # Báo cáo Phase 2
├── BAO_CAO-giai-doan-3.md                        # Báo cáo Phase 3
├── epub-quick-overview-plan-01.md
├── epub-quick-overview-plan-01-RUNBOOK.md
├── epub-quick-overview-plan-01-ban-giao.md
├── session-log-2026-05-09.md
├── session-log-2026-05-09.obsidian.md
├── session-log-2026-05-10.md
├── adk-agents/                                   # Kế hoạch ADK multi-agent
│   ├── README.md
│   └── research-notes.md
└── concurrency-optimization/                     # Kế hoạch tối ưu đa luồng
    └── README.md
```

---

## 🚀 Các Bước Tiếp Theo (Chưa Thực Thi — Chờ Phê Duyệt)

### Ưu Tiên Cao
1. **Tối ưu R2 Operations** — Refactor `migrate_to_cloudflare.py` để gộp chapters thành batch upload qua Worker API, giảm 99% lượt PUT.
2. **Hoàn thiện Multi-Source Scraper** — Kiểm tra `main.py import --url` hoạt động thực tế với 69shuba và novel543.

### Ưu Tiên Trung Bình
3. **Code Splitting Frontend** — Dùng `React.lazy()` cho EpubReader, Admin pages giảm bundle từ 547KB xuống ~300KB.
4. **Hoàn thiện Truyentrung UI** — Custom lại các section Truyentrung theo ý người dùng.

### Ưu Tiên Thấp
5. **ADK Multi-Agent Pipeline** — Triển khai Google ADK cho pipeline dịch tự đánh giá chất lượng.
6. **Request Novel Feature** — Cho phép độc giả gửi URL truyện Trung để tự động thêm vào hàng chờ.
