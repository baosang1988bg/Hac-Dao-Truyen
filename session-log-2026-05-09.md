# Session Log — Novel Translator Dev (2026-05-07 → 2026-05-09)

Ghi chép toàn bộ các thay đổi trong phiên làm việc với Claude trên codebase **HacDaoTruyen** (Novel Translator).

---

## 1. Redesign Tab "Tính năng" (ToolsTab) + Thêm fix_titles_v2

**Files:** `frontend/src/pages/NovelDetail.jsx`, `api.py`, `use.md`

### Thay đổi
- Redesign `ToolsTab`: mỗi card tool có icon riêng màu sắc (amber/blue/violet/green), button style tương ứng, terminal log có màu thông minh
- Thêm card **Chuẩn hóa tiêu đề** dùng `fix_titles_v2.py`
- `api.py`: thêm `fix_titles_v2` vào `allowed_tools`
- `use.md`: thêm section `fix_titles_v2.py`

---

## 2. Fix Lịch sử dịch — Orphan Stats Sessions

**Files:** `api.py`, `frontend/src/pages/Logs.jsx`

### Vấn đề
- 23 file `_stats.json` không có `.log` đi kèm → bị bỏ qua hoàn toàn
- UI dùng `groupByServerRun` → gộp sessions, hiển thị 50 thay vì 74

### Fix
- `api.py` `/api/logs`: thêm `_parse_orphan_stats()` để đọc orphan stats
- `Logs.jsx`: xóa `groupByServerRun`, hiển thị từng session riêng lẻ (limit 500)
- Thêm badge "stats only" cho orphan sessions, nút toggle ẩn/hiện
- `start.sh`: thêm `--reload` flag cho uvicorn

---

## 3. Nâng cấp Format _stats.json

**Files:** `main.py`, `fix_chapters.py`, `fix_one_chapter.py`, `fix_truncated.py`

### Thay đổi
- Thêm fields: `started_at`, `ended_at`, `duration_sec`, `chapters_saved`, `errors` vào tất cả stats.json
- Backfill 27 file stats.json cũ (timestamp từ tên file)
- `_parse_orphan_stats` trong `api.py` đọc đầy đủ fields mới
- `fix_truncated.py` sinh `_stats.json` (trước đây không có)

---

## 4. Live Admin Dashboard — TranslationPanel

**Files:** `api.py`, `main.py`, `frontend/src/pages/NovelDetail.jsx`

### Thêm 7 realtime fields vào progress_callback
| Field | Mô tả |
|---|---|
| `current_chapter` | Tên chương vừa lưu |
| `crawling_chapter` | Tên chương đang crawl |
| `current_model` | Model AI đang active |
| `tokens_used` | Tổng tokens tích lũy live |
| `cost_so_far` | Tổng cost live ($) |
| `chapters_ok` | Danh sách chương thành công |
| `chapters_fail` | Danh sách chương thất bại |
| `batch_details` | Chi tiết từng batch đang chạy |

### UI Redesign
- 🌐 **Đang crawl**: hiển thị tên chương đang fetch
- ⚡ **Đang dịch**: mỗi batch với model badge (Gemini=xanh/DeepSeek=tím/Ollama=lá), tokens, cost
- 📄 **Kết quả chương**: live feed 8 chương mới nhất ✓/✗
- **Stats row**: tốc độ, ETA, tokens, cost real-time

---

## 5. Bảo mật — API Key Leak Investigation

### Nguyên nhân key bị Google revoke
1. **Chrome Extension** gọi Gemini API trực tiếp từ browser với key trong URL → lộ qua DevTools Network tab
2. **Repo GitHub public** có thể push file logs/novels → Google Secret Scanner phát hiện

### Fix
- `extension/popup.js`: xóa call Gemini trực tiếp, thay bằng `callViaBackend()` qua `localhost:4444`
- `api.py`: thêm endpoint `POST /api/translate-quick` — key nằm trong `.env` server
- `.gitignore`: bỏ comment để chặn `novels/`, `logs/`, `discover_results/`

### Hướng dẫn cleanup
```bash
git rm -r --cached logs/ novels/ discover_results/
git commit -m "chore: untrack data folders"
# Tạo Gemini key mới tại aistudio.google.com/app/apikey
# Chuyển repo thành Private trên GitHub
```

---

## 6. Auto-Split Chương Lớn

**Files:** `main.py`, `fix_chapters.py`, `fix_truncated.py`

### Cơ chế
- **Threshold**: `CHAPTER_SPLIT_THRESHOLD=4500` chars (≈6750 tokens, an toàn cho mọi model)
- Chương > 4500 chars → split tại ranh giới đoạn văn (`\n\n`) hoặc dấu câu (`。！？`)
- Lưu `第N章.txt` (gốc) + `第N章-1.txt`, `第N章-2.txt`...
- Sau khi dịch xong → auto-merge thành `第N章_VI.md` duy nhất

### Hàm mới trong main.py
| Hàm | Chức năng |
|---|---|
| `split_chapter_content()` | Tách content tại ranh giới đoạn văn |
| `_split_at_sentence()` | Tách tại dấu câu nếu đoạn đơn quá dài |
| `save_raw_parts()` | Lưu file gốc + các phần raw |
| `merge_translated_parts()` | Ghép các phần đã dịch |
| `is_split_original()` | Kiểm tra file có bị split không |
| `get_split_part_count()` | Đếm số phần split |

### Test kết quả
11 chương > 4500 chars đều split đúng, max part ≤ 4500 chars, không mất dữ liệu (ratio 0.966–0.988).

---

## 7. Fix find_untranslated_raws — False Positive

**Files:** `main.py`

### Vấn đề
`find_untranslated_raws` không biết về split → báo file gốc đã split là "missing"

### Fix
- Nhận biết file gốc đã split (có `stem-1.txt`) → kiểm tra merged file
- Nhận biết file phần (`stem-N`) → bỏ qua nếu gốc đã merge OK
- Auto-merge khi phát hiện tất cả phần đã dịch xong

---

## 8. Fix Duplicate Chapters trên UI

**Files:** `api.py`, translated files

### Vấn đề
- 5 chương split đã merge nhưng file phần `-N_VI.md` vẫn còn → hiển thị duplicate trên UI
- Chương 1033 có merged file cũ (bản dịch trước khi split, 14K chars) thay vì merge thực sự (25K chars)

### Fix
- `api.py` `list_chapters()`: lọc file `-N_VI.md` nếu file gốc đã tồn tại
- Verify 9-point sampling cho 5 chương (ratio 0.995–1.000) → xóa 10 file phần thừa
- Re-merge `第1033章` đúng từ `-1_VI.md` + `-2_VI.md` (ratio 0.999)

---

## 9. Update fix_chapters.py + fix_truncated.py với Split Logic

**Files:** `fix_chapters.py`, `fix_truncated.py`

### fix_chapters.py
- `scan_novel`: nhận biết file gốc split, file phần split, dùng prefix match tìm merged file
- `fix_novel`: tự động split chương > 4500 chars trước khi dịch lại, merge sau khi xong

### fix_truncated.py
- `scan_novel`: cùng logic nhận biết split
- `fix_chapter`: khi chương bị truncated mà lớn → split và dịch từng phần, rồi merge

### Xử lý safe_filename mismatch
Dùng **prefix match** theo chapter number (`第N章`) thay vì exact string match — xử lý trường hợp tên file có ký tự đặc biệt bị `safe_filename()` filter ra khác nhau.

---

## 10. Health Check UI — Split Awareness

**Files:** `api.py`, `frontend/src/pages/NovelDetail.jsx`, `use.md`

### api.py
- `_find_merged_vi()`: tìm merged file bằng 3 tầng (exact → chapter number prefix → string prefix)
- `health_check()`: không count file phần đã merge vào `total_raw`
- Fields mới trong summary: `split_parts_ok`, `total_raw_all`, `split_pending`
- Issue type mới: `split_pending` (phần đã dịch nhưng chưa merge)
- Endpoint mới: `POST /api/novels/{slug}/cleanup-split-parts`

### NovelDetail.jsx — HealthTab
- Badge **Parts OK** (màu tím)
- Banner với nút **Dọn file phần** → gọi cleanup endpoint sau khi verify
- 4 màu issue: lỗi dịch (đỏ), chưa dịch (cam), nghi vấn (vàng), chờ merge (tím)

### Kết quả verify
```
total_raw (effective): 1108   ← không đếm file phần
split_parts_ok:        16     ← file phần đã merge
total_translated:      1107
missing:               1      ← chỉ còn 第1099章
```

---

## Files Đã Thay Đổi (Tổng kết)

| File | Thay đổi |
|---|---|
| `api.py` | health_check split-aware, _find_merged_vi, cleanup endpoint, translate-quick, _parse_orphan_stats, orphan stats in /logs |
| `main.py` | split_chapter_content, save_raw_parts, merge_translated_parts, find_untranslated_raws fix, progress_callback realtime fields |
| `fix_chapters.py` | scan_novel + fix_novel split-aware |
| `fix_truncated.py` | scan_novel + fix_chapter split-aware, stats tracking |
| `fix_titles_v2.py` | (đã có sẵn, thêm vào API + use.md) |
| `frontend/src/pages/NovelDetail.jsx` | ToolsTab redesign, TranslationPanel live dashboard, HealthTab split-aware |
| `frontend/src/pages/Logs.jsx` | Bỏ groupByServerRun, hiển thị đủ sessions, orphan badge |
| `extension/popup.js` | Bỏ direct Gemini call, dùng callViaBackend() |
| `start.sh` | Thêm --reload cho uvicorn |
| `.gitignore` | Chặn novels/, logs/, discover_results/ |
| `use.md` | Thêm fix_titles_v2, auto-split docs |

---

## Lệnh Quan Trọng

```bash
# Restart backend (cần sau mỗi lần sửa api.py)
pkill -f "uvicorn api:app" && bash start.sh

# Cleanup file phần sau merge
curl -X POST http://localhost:4444/api/novels/<slug>/cleanup-split-parts

# Tạo Gemini key mới
# https://aistudio.google.com/app/apikey
# Cập nhật .env: GOOGLE_API_KEYS="key1, key2, ..."
# Reset status: rm key_status.json

# Untrack data folders (chạy 1 lần)
git rm -r --cached logs/ novels/ discover_results/
git commit -m "chore: untrack data folders"
```
