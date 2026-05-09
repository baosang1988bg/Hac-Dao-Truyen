---
title: "Novel Translator — Dev Session Log"
date: 2026-05-09
tags:
  - dev-log
  - novel-translator
  - python
  - react
  - fastapi
aliases:
  - "HacDaoTruyen Session 2026-05-09"
status: completed
project: HacDaoTruyen
---

# Novel Translator — Dev Session Log
> **Thời gian:** 2026-05-07 → 2026-05-09  
> **Project:** [[HacDaoTruyen]] — Hệ thống crawl & dịch tiểu thuyết Trung → Việt  
> **Stack:** FastAPI · React/Vite · Python · Gemini/DeepSeek API

---

## Tổng quan thay đổi

```dataview
TABLE issue, status
FROM "session-log-2026-05-09"
```

| # | Hạng mục | Files chính | Trạng thái |
|---|---|---|---|
| 1 | [[#1 Redesign ToolsTab + fix_titles_v2]] | NovelDetail.jsx, api.py | ✅ |
| 2 | [[#2 Fix Lịch sử dịch — Orphan Stats]] | api.py, Logs.jsx | ✅ |
| 3 | [[#3 Nâng cấp Format stats.json]] | main.py, fix_*.py | ✅ |
| 4 | [[#4 Live Admin Dashboard]] | api.py, main.py, NovelDetail.jsx | ✅ |
| 5 | [[#5 Bảo mật — API Key Leak]] | popup.js, api.py, .gitignore | ✅ |
| 6 | [[#6 Auto-Split Chương Lớn]] | main.py | ✅ |
| 7 | [[#7 Fix find_untranslated_raws]] | main.py | ✅ |
| 8 | [[#8 Fix Duplicate Chapters]] | api.py, translated/ | ✅ |
| 9 | [[#9 Update fix_chapters + fix_truncated]] | fix_chapters.py, fix_truncated.py | ✅ |
| 10 | [[#10 Health Check UI — Split Awareness]] | api.py, NovelDetail.jsx | ✅ |

---

## 1. Redesign ToolsTab + fix_titles_v2

> **Files:** `frontend/src/pages/NovelDetail.jsx` · `api.py` · `use.md`

### Vấn đề
Tab "Tính năng" trước đây dùng chung một style `btn primary` cho tất cả tool → không phân biệt được chức năng.

### Thay đổi
- Mỗi card tool có icon riêng với màu sắc: amber / blue / violet / green / sky
- Terminal log tô màu thông minh: lệnh (xanh), lỗi (đỏ), thành công (xanh lá)
- Thêm card **Chuẩn hóa tiêu đề** (`fix_titles_v2`)

```python
# api.py — allowed_tools
"fix_titles_v2": ["python3", "fix_titles_v2.py"],
```

---

## 2. Fix Lịch sử dịch — Orphan Stats

> **Files:** `api.py` · `frontend/src/pages/Logs.jsx`

### Root Cause
- 23/74 sessions bị mất vì không có `.log` file đi kèm (chỉ có `_stats.json`)
- `groupByServerRun()` trong Logs.jsx gộp sessions → hiển thị 50 thay vì 74

### Fix
```python
# api.py — _parse_orphan_stats()
# Đọc sessions chỉ có stats.json, không có .log
# Tìm novel title từ novel.json
# Recover timestamp từ tên file: _20260508_095648_stats.json
```

**Logs.jsx:** Xóa hoàn toàn `groupByServerRun`, limit tăng 200 → 500.

> [!info] Kết quả
> Từ **51 sessions** → **74 sessions** hiển thị

---

## 3. Nâng cấp Format stats.json

> **Files:** `main.py` · `fix_chapters.py` · `fix_one_chapter.py` · `fix_truncated.py`

### Fields mới trong _stats.json

```json
{
  "slug": "xich-tam-tuan-thien",
  "timestamp": "2026-05-08T09:56:48",
  "chapters_done": 30,
  "started_at": "2026-05-08T09:26:03",
  "ended_at": "2026-05-08T09:56:48",
  "duration_sec": 1845,
  "chapters_saved": ["第1033章", "第1034章"],
  "errors": [],
  "total_tokens": 432986,
  "cost_usd": 0.114
}
```

- Backfill **27 file cũ** với timestamp từ tên file
- `fix_truncated.py` sinh stats.json (trước đây không có)

---

## 4. Live Admin Dashboard

> **Files:** `api.py` · `main.py` · `frontend/src/pages/NovelDetail.jsx`

### Realtime fields mới

| Field | Mô tả |
|---|---|
| `crawling_chapter` | Tên chương đang fetch |
| `current_model` | Model AI đang dùng (badge màu) |
| `tokens_used` | Tokens tích lũy live |
| `cost_so_far` | Chi phí live ($) |
| `chapters_ok` | Feed chương thành công |
| `chapters_fail` | Feed chương thất bại |
| `batch_details` | Chi tiết từng batch song song |

### UI sections mới
```
🌐 Đang crawl    → tên chương đang fetch
⚡ Đang dịch     → batch details: model badge + tokens + cost
📄 Kết quả       → live feed 8 chương mới nhất ✓/✗
Stats row        → tốc độ · ETA · tokens · cost
```

---

## 5. Bảo mật — API Key Leak

> [!danger] Tất cả 7 Gemini key bị Google revoke vĩnh viễn

### Root Cause
```javascript
// extension/popup.js — TRƯỚC (NGUY HIỂM)
const url = `...googleapis.com/...?key=${apiKey}`  // key lộ trong Network tab!
```

### Fix
```javascript
// extension/popup.js — SAU (AN TOÀN)
async function callViaBackend(model, text) {
  const resp = await fetch("http://localhost:4444/api/translate-quick", {
    method: "POST",
    body: JSON.stringify({ text, model }),
  })
}
```

```python
# api.py — endpoint mới
@app.post("/api/translate-quick")
async def translate_quick(req: QuickTranslateRequest):
    # Key nằm trong .env server, không bao giờ ra client
    translator = NovelTranslator()
    result, _, usage = await asyncio.to_thread(translator.translate_chapter, ...)
```

### Checklist bảo mật
- [ ] Tạo Gemini key mới tại [aistudio.google.com](https://aistudio.google.com/app/apikey)
- [ ] Cập nhật `.env`: `GOOGLE_API_KEYS="key1, key2, ..."`
- [ ] `rm key_status.json`
- [ ] Chuyển GitHub repo thành Private
- [ ] `git rm -r --cached logs/ novels/ discover_results/`

---

## 6. Auto-Split Chương Lớn

> **Files:** `main.py`

### Threshold
```env
CHAPTER_SPLIT_THRESHOLD=4500  # chars ≈ 6750 tokens
```

### Flow

```
Crawl chapter
    ↓
content > 4500 chars?
    ├── NO  → lưu stem.txt → dịch 1 lần
    └── YES → split tại \n\n hoặc dấu câu
              → lưu stem.txt + stem-1.txt + stem-2.txt...
              → dịch từng phần riêng lẻ
              → merge thành stem_VI.md
```

### Hàm mới

```python
split_chapter_content(content, threshold=4500) → list[str]
save_raw_parts(profile, title, content)         → list[(title, content)]
merge_translated_parts(profile, title, n_parts) → bool
is_split_original(raw_dir, stem)                → bool
get_split_part_count(raw_dir, stem)             → int
```

### Test
> 11 chương > 4500 chars: tất cả split đúng, ratio 0.966–0.988, không mất dữ liệu ✅

---

## 7. Fix find_untranslated_raws

> **Files:** `main.py`

### Vấn đề
File gốc đã split (`第1033章.txt`) bị báo "missing" vì không có `第1033章_VI.md` trực tiếp.

### Fix Logic
```python
def find_untranslated_raws(profile):
    for raw_name in raw_files:
        stem = splitext(raw_name)[0]
        
        # File gốc đã split?
        if f"{stem}-1.txt" in all_raw:
            if merged_vi_exists(stem):  continue  # OK
            elif all_parts_done(stem):  auto_merge()  # merge tự động
            else:                       skip()         # để phần xử lý
            continue
        
        # File phần (xxx-N)?
        if is_part(stem):
            if orig_merged_ok(stem):    continue  # gốc OK → skip
        
        # File thường → check bình thường
```

---

## 8. Fix Duplicate Chapters

> **Files:** `api.py` · translated files

### Vấn đề
Sau khi merge, file `-1_VI.md` và `-2_VI.md` vẫn còn → API trả về cả gốc lẫn phần → duplicate trên UI.

### Fix api.py list_chapters()
```python
# Lọc file phần nếu gốc đã tồn tại
_split_part_re = re.compile(r'^(.+)-(\d+)_VI\.md$')
for f in all_files:
    m = _split_part_re.match(f)
    if m and f"{m.group(1)}_VI.md" in all_files:
        continue  # bỏ qua phần
    filtered.append(f)
```

### Cleanup thực tế
| Chương | P1 | P2 | Merged | Ratio | Action |
|---|---|---|---|---|---|
| 第1060章 | 15.7K | 2.3K | 17.9K | 0.997 | ✅ Xóa parts |
| 第1068章 | 15.6K | 0.3K | 15.8K | 0.995 | ✅ Xóa parts |
| 第1071章 | 15.0K | 6.4K | 21.3K | 0.997 | ✅ Xóa parts |
| 第1072章 | 16.7K | 10.1K | 26.8K | 1.000 | ✅ Xóa parts |
| 第1077章 | 16.1K | 0.9K | 17.0K | 0.999 | ✅ Xóa parts |
| **第1033章** | 12.4K | 13.0K | **14.2K** | **0.560** | ⚠️ Re-merge |

> [!warning] Chương 1033
> Merged file cũ là bản dịch của file gốc trước khi split (14K) — KHÔNG phải merge thật.
> Đã re-merge đúng từ -1 và -2 → 25.3K chars (ratio 0.999) ✅

---

## 9. Update fix_chapters + fix_truncated

> **Files:** `fix_chapters.py` · `fix_truncated.py`

### Prefix Match cho safe_filename mismatch
```python
# Tên raw:   "第1103章  风云（为月票一万二加更！）"
# safe_fn:   "第1103章  风云为月票一万二加更"  (bỏ ký tự đặc biệt)
# Trans file: "第1103章风云为月票一万二加更_VI.md"  (khác vì double space)

# Fix: tìm theo chapter number prefix
_no_part_vi = re.compile(r'-\d+_VI\.md$')
chap_prefix = re.match(r'^(第\d+章)', orig_stem).group(1)  # "第1103章"
for f in all_trans:
    if f.startswith(chap_prefix) and not _no_part_vi.search(f):
        return f  # found!
```

### fix_chapters.py — fix_novel() với split
```python
if is_large:
    chunks = split_chapter_content(content)
    for idx, chunk in enumerate(chunks, 1):
        # Lưu raw phần
        # Dịch từng phần
        # Merge sau khi xong
    merge_translated_parts(profile, stem, len(chunks))
```

---

## 10. Health Check UI — Split Awareness

> **Files:** `api.py` · `frontend/src/pages/NovelDetail.jsx` · `use.md`

### api.py — _find_merged_vi() với 3 tầng
```python
def _find_merged_vi(stem, all_trans):
    # 1. Exact: stem_VI.md
    if f"{stem}_VI.md" in all_trans: return ...
    
    # 2. Chapter number prefix: 第N章...
    chap_prefix = re.match(r'^(第\d+章)', orig_stem)
    if chap_prefix:
        for f in all_trans:
            if f.startswith(chap_prefix) and not is_part(f): return f
    
    # 3. String prefix match
    for f in all_trans:
        if f.startswith(orig_stem): return f
    
    return None
```

### Summary fields mới
```json
{
  "total_raw": 1108,
  "total_raw_all": 1124,
  "split_parts_ok": 16,
  "total_translated": 1107,
  "missing": 1,
  "split_pending": 0
}
```

### Endpoint mới
```
POST /api/novels/{slug}/cleanup-split-parts
→ Verify merge OK → Xóa raw parts + translated parts
```

### HealthTab UI
```
[1108 Raw] [1107 Đã dịch] [1 Còn thiếu] [0 Bị lỗi] [16 Parts OK]

┌─────────────────────────────────────────────┐
│ ✓ 16 file phần split đã có bản merge        │
│ (tổng raw: 1124, hiển thị 1108 chương thực) │
│                          [🗑 Dọn file phần] │
└─────────────────────────────────────────────┘
```

---

## Lệnh nhanh

```bash
# Restart backend
pkill -f "uvicorn api:app" && bash start.sh

# Cleanup split parts
curl -X POST http://localhost:4444/api/novels/<slug>/cleanup-split-parts

# Reset Gemini keys
rm key_status.json
# Cập nhật .env với key mới
python3 check_keys.py

# Untrack data (chạy 1 lần)
git rm -r --cached logs/ novels/ discover_results/
git commit -m "chore: untrack data folders"
git push
```

---

## Liên kết

- [[use.md]] — Hướng dẫn sử dụng đầy đủ
- [[api.py]] — FastAPI backend
- [[main.py]] — Core translation pipeline
- [[fix_chapters.py]] — Fix missing/failed chapters
- [[fix_truncated.py]] — Fix truncated chapters
- [[frontend/src/pages/NovelDetail.jsx]] — Novel detail UI
- [[frontend/src/pages/Logs.jsx]] — Translation history UI
