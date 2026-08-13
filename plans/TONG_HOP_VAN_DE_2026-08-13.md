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

## 🚀 Các Bước Tiếp Theo

> Cập nhật 2026-08-13 (phiên 2): đã khảo sát kỹ và triển khai 3/6 việc bên dưới.
> Chi tiết đầy đủ (thiết kế, cách verify, giới hạn) xem
> `BAO_CAO_XU_LY_2026-08-13.md`.

### Ưu Tiên Cao
1. **Tối ưu R2 Operations** — ⚠️ **Đã triển khai một phần** (commit `4271105`). Thêm chế độ
   `--batch-upload` (opt-in, mặc định TẮT) gộp nhiều chương thành 1 object JSON thay vì
   PUT từng chương, cùng phần đọc fallback tương ứng trong Worker. Hành vi mặc định của
   job cron hàng ngày KHÔNG đổi. Khác với dự tính ban đầu, việc gộp batch bắt buộc phải
   sửa cả Worker (`src/index.js`), không chỉ riêng script migrate. **Chưa test với R2/D1/
   Worker thật** (sandbox không có quyền Cloudflare) — cần chạy thử thủ công trên 1 novel
   nhỏ trước khi bật cho production.
2. **Hoàn thiện Multi-Source Scraper** — ⚠️ **Đã sửa 1 bug cụ thể** (commit `baf9588`):
   `is_blocked=True` bị set cứng cho novel543.com khiến mục lục chương luôn trả về 0 kết
   quả. Đã sửa bằng phát hiện chặn dựa trên tín hiệu thật + parse link từ Jina fallback.
   Có test tĩnh (fixture HTML, không gọi mạng thật) 5/5 pass. **Chưa xác minh được với
   site thật** (sandbox không có egress internet tới novel543.com/69shuba.com) — cần
   người có mạng ngoài chạy thử `main.py import --url` thật trước khi coi là "hoàn thiện".

### Ưu Tiên Trung Bình
3. **Code Splitting Frontend** — ✅ **Đã xong** (commit `c12a9aa`). React.lazy() cho Admin/
   EpubReader/EpubCatalogPage/Account/Login/Logs. Verify bằng `npm run build` thật: chunk
   chính giảm từ ~543KB xuống ~424KB, 8 trang phụ tách thành chunk riêng tải khi cần.
4. **Hoàn thiện Truyentrung UI** — 📋 Chưa làm, cần bạn nêu cụ thể custom theo ý muốn (đã hỏi
   trong phiên 2, được chọn "bỏ qua trong phiên này").

### Ưu Tiên Thấp
5. **ADK Multi-Agent Pipeline** — 📋 Chưa làm, việc lớn cần lên kế hoạch riêng.
6. **Request Novel Feature** — 📋 Chưa làm, tính năng mới cần thiết kế UX/backend riêng.
