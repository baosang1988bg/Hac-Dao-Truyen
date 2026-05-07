# ⚡ Tối Ưu Hóa Tốc Độ Dịch (Đa Luồng / Bất Đồng Bộ)

> Trạng thái: **✅ Đã implement (95%)** | 2 race condition cần fix  
> Nguồn: Plan do Gemini CLI đề xuất — đã verify ngày 2026-05-07

---

## Kết Quả Verify

### ✅ Đã Implement Đầy Đủ

| Tính năng | File | Chi tiết |
|---|---|---|
| `asyncio.to_thread()` wrap translate_batch | `main.py:385` | Đúng như plan |
| `background_tasks = set()` | `main.py:362` | Đúng như plan |
| `MAX_CONCURRENT_BATCHES = 3` | `config.py:72` | Có env var |
| Giới hạn song song với `asyncio.wait` | `main.py:463-465` | `FIRST_COMPLETED` pattern |
| `asyncio.gather()` chờ tất cả ở cuối | `main.py:541` | Đúng |
| Browser reuse (Playwright) | `scraper.py:65-130` | `_browser`, `_context` tái sử dụng |

### ⚠️ Vấn Đề Cần Fix — Race Condition

#### 1. `previous_summary` race condition
**File:** `main.py` — hàm `process_batch_async()`

**Vấn đề:** Biến `previous_summary` là `nonlocal` — nhiều task song song cùng *ghi* vào nó:
```python
# Cuối process_batch_async — NGUY HIỂM khi chạy song song
previous_summary = summary  # Batch nào xong cuối thì overwrite
```
Khi 3 batch chạy song song: Batch 1, 2, 3 đều đọc `previous_summary` lúc bắt đầu (đúng vì `summary_copy` được truyền vào). Nhưng khi xong, batch nào kết thúc cuối cùng sẽ overwrite `previous_summary` → các batch tiếp theo nhận summary từ batch sai thứ tự.

**Fix đề xuất:**
```python
# Thay vì ghi trực tiếp, dùng dict track theo batch index
# Hoặc đơn giản hơn: chấp nhận trade-off, chỉ update previous_summary
# khi batch có chapter_number cao nhất hoàn thành
```

#### 2. `translated_count` race condition
**File:** `main.py` — hàm `process_batch_async()`

**Vấn đề:** `translated_count += 1` chạy trong nhiều coroutines song song → không atomic:
```python
translated_count += 1  # Race condition
report_progress(translated_count, ...)  # Số không chính xác
```

**Fix đề xuất:**
```python
# Dùng asyncio.Lock() để protect
_count_lock = asyncio.Lock()
async with _count_lock:
    translated_count += 1
```

---

## Câu Hỏi Mở Trong Plan Gốc — Đã Có Câu Trả Lời

### Q1: Giới hạn số batch song song tối đa?
**→ Đã chọn: 3** (mặc định trong `config.py`). Có thể tùy chỉnh qua env `MAX_CONCURRENT_BATCHES`.

### Q2: Có tối ưu scraping (reuse browser) không?
**→ Đã implement trong `scraper.py`**: Playwright browser được khởi tạo 1 lần, tái sử dụng context cho tất cả các URL. Tiết kiệm ~2-3s/chương như plan dự đoán.

### Q3: Trade-off về `previous_summary`?
**→ Đã chấp nhận** với giải pháp `summary_copy` (truyền snapshot lúc tạo task). Tuy nhiên có race condition khi *ghi lại* — xem ⚠️ ở trên.

---

## Kết Quả Thực Tế Dự Kiến

| Chế độ | Tốc độ ước tính |
|---|---|
| Trước (serial) | ~1 batch/30s = ~1-2 ch/phút |
| Sau (parallel, `MAX_CONCURRENT_BATCHES=3`) | ~3 batch/30s = ~3-6 ch/phút |
| Tăng tốc | ~3x |

---

## Việc Cần Làm Tiếp

- [ ] Fix race condition `previous_summary` (ưu tiên thấp — ảnh hưởng context chứ không crash)
- [ ] Fix race condition `translated_count` với `asyncio.Lock()` (ưu tiên trung bình — progress bar không chính xác)
- [ ] Test stress: chạy 50 chương với `MAX_CONCURRENT_BATCHES=5` để verify ổn định
