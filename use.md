# 📖 NOVEL TRANSLATOR — HƯỚNG DẪN SỬ DỤNG

> Hệ thống tự động crawl & dịch tiểu thuyết Trung Quốc sang tiếng Việt.
> **Gemini AI** (primary, free) → **DeepSeek** (fallback) → **Ollama** (local, optional)

---

## 🗂 CẤU TRÚC PROJECT

```
NOVEL/
├── main.py               # CLI chính — dịch, quản lý truyện
├── translator.py         # Engine dịch (Gemini + DeepSeek + Ollama)
├── scraper.py            # Crawl nội dung từ website
├── novel_manager.py      # Quản lý profile truyện
├── config.py             # Cấu hình API keys, batch, model
├── api.py                # REST API backend (FastAPI)
├── discover.py           # Khám phá & gợi ý truyện mới
│
├── fix_chapters.py       # Fix chương missing / failed ⭐
├── fix_truncated.py      # Fix chương bị cắt giữa chừng ⭐
├── fix_one_chapter.py    # Dịch lại đúng 1 chương cụ thể ⭐
├── fix_titles_v2.py      # Chuẩn hóa tiêu đề tất cả chương ⭐
├── fix_batch_mismatch.py # Fix chương batch mismatch
├── fix_116.py            # Fix script mẫu (chỉnh tên chương)
│
├── check_keys.py         # Kiểm tra & quản lý Gemini API keys ⭐
├── check_models.py       # Test Gemini model nào đang hoạt động
├── verify.py             # Kiểm tra toàn bộ pipeline
├── verify_translation.py # Kiểm tra chất lượng bản dịch
├── inspect_site.py       # Debug cấu trúc HTML site mới
│
├── start.sh              # Khởi động backend + frontend
├── .env                  # API keys & config (không commit)
├── key_status.json       # Trạng thái từng Gemini key (tự động)
├── requirements.txt      # Thư viện Python
│
├── novels/               # Thư mục chứa tất cả truyện
│   └── <slug>/
│       ├── novel.json    # Profile + glossary + tiến độ
│       ├── text_raw/     # File .txt gốc tiếng Trung
│       └── translated/   # File _VI.md đã dịch
├── logs/                 # Log file + stats JSON từng phiên
├── discover_results/     # Kết quả gợi ý truyện
├── frontend/             # React Web UI (Vite)
└── extension/            # Chrome Extension
```

---

## 🚀 KHỞI ĐỘNG

```bash
bash start.sh
# Hoặc riêng lẻ:
uvicorn api:app --host 127.0.0.1 --port 4444 --reload
cd frontend && npm run dev    # → http://localhost:5173
```

---

## 📌 CLI — LỆNH CHÍNH (`main.py`)

```bash
python main.py new                                      # Tạo truyện mới (interactive)
python main.py list                                     # Danh sách tất cả truyện
python main.py info   --novel <slug>                    # Chi tiết 1 truyện
python main.py glossary --novel <slug>                  # Xem/thêm glossary

python main.py translate --novel <slug>                 # Dịch tiếp từ chỗ dừng
python main.py translate --novel <slug> --chapters 10   # Dịch 10 chương
python main.py translate --novel <slug> --url https://... # Từ URL cụ thể
python main.py translate --novel <slug> --force         # Dịch lại dù đã có file

python main.py retranslate --novel <slug>               # Dịch lại từ raw (không crawl)
python main.py retranslate --novel <slug> --force       # Dịch lại tất cả raw
```

> **Batch:** tự gom 2 chương/lần gọi AI (an toàn với Gemini free tier output limit 8192 tokens).
> **Auto-retry:** chương bị cắt giữa chừng tự retry đơn lẻ.
> **Stop:** nhấn nút **Dừng** trong Web UI để dừng gracefully sau batch hiện tại.

---

## 🔧 FIX CHƯƠNG LỖI

### fix_chapters.py — fix missing + failed
```bash
python fix_chapters.py --novel <slug> --report   # Báo cáo không dịch
python fix_chapters.py --novel <slug>             # Fix tự động
python fix_chapters.py --novel <slug> --force     # Cả chương nghi vấn
python fix_chapters.py --all                      # Tất cả truyện
```
Phát hiện: **missing** (chưa có file), **failed** ([Translation failed]), **suspicious** (ratio bất thường).

### fix_truncated.py — fix chương bị cắt giữa chừng ⭐
```bash
python fix_truncated.py --novel <slug> --report
python fix_truncated.py --novel <slug>
python fix_truncated.py --all
```
Nguyên nhân: Gemini free tier hard cap ~8,192 tokens output. Dịch lại đơn lẻ (không batch).

### fix_one_chapter.py — dịch lại đúng 1 chương ⭐
```bash
python fix_one_chapter.py --novel <slug> --chapter "第127章 我心如月钩折"
python fix_one_chapter.py --novel <slug> --chapter "第127章 我心如月钩折" --dry-run
```
Dịch đơn lẻ, không bao giờ bị cắt.

### fix_titles_v2.py — chuẩn hóa tiêu đề chương ⭐
```bash
python fix_titles_v2.py         # Chạy trên toàn bộ truyện
```
Tự động dò tìm và chuẩn hóa tiêu đề tất cả chương về dạng `# Chương N: Tên chương`.
Phát hiện tiêu đề bất kỳ trong 15 dòng đầu của file, làm sạch prefix thừa, đảm bảo blank line sau tiêu đề.

### fix_batch_mismatch.py — fix danh sách chỉ định
```bash
python fix_batch_mismatch.py    # Chỉnh TO_FIX trong file trước khi chạy
```

---

## 🔑 GEMINI API KEY MANAGEMENT

```bash
python check_keys.py           # Test tất cả key, cập nhật key_status.json
python check_keys.py --show    # Xem status hiện tại (không gọi API)
python check_keys.py --reset   # Reset tất cả về working (sau 24h)
```

### 4 trạng thái key

| Status | TTL | Ý nghĩa | Xử lý tự động |
|---|---|---|---|
| `working` | — | Đang hoạt động | Dùng bình thường |
| `rate_limited` | **1h** | Bị per-minute 429 liên tục | Skip 1h → tự recover |
| `quota_exceeded` | **24h** | Hết daily quota | Skip 24h → tự recover |
| `invalid` | ∞ | Sai key / bị thu hồi | Không retry — xóa khỏi `.env` |

### Thêm key miễn phí
Mỗi Gmail = 1 key tại https://aistudio.google.com/app/apikey:
```env
GOOGLE_API_KEYS="key1, key2, key3, key4, key5"
```
5 key × 1500 req/ngày = 7500 req/ngày = ~22500 chương/ngày miễn phí.

---

## 🔍 KHÁM PHÁ TRUYỆN (`discover.py`)

```bash
python discover.py                           # top 10 hot
python discover.py --genre cultivation       # tu tiên / võ đạo
python discover.py --genre romance           # ngôn tình
python discover.py --genre modern            # đô thị
python discover.py --genre isekai            # xuyên không / trọng sinh
python discover.py --genre game              # game / hệ thống
python discover.py --genre military          # quân sự
python discover.py --genre historical        # cổ đại / lịch sử
python discover.py --genre scifi             # khoa học viễn tưởng
python discover.py --genre horror            # kinh dị
python discover.py --genre beast             # ngự thú / dị thú
python discover.py --genre farming           # điền văn
python discover.py --genre esports           # thể thao điện tử
python discover.py --like "mô tả"           # tương tự
python discover.py --top 20 --save           # lưu ra Markdown
python discover.py --search                  # tìm URL truyện cụ thể
```

---

## ✅ KIỂM TRA & DEBUG

```bash
python verify.py                # Pipeline đầu cuối (config → translator → dịch thử)
python verify_translation.py    # Chất lượng bản dịch (tỷ lệ ký tự, số đoạn)
python check_models.py          # Test Gemini model nào hoạt động + latency
python inspect_site.py          # Debug HTML khi thêm site mới
```

---

## ⚙️ CẤU HÌNH (`.env`)

```env
# ── Gemini (PRIMARY — FREE) ────────────────────────────────
GOOGLE_API_KEYS="key1, key2, key3, key4, key5"
GEMINI_MODEL=gemini-2.5-flash

# Fallback models — FREE, rotate trước khi dùng DeepSeek
GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash,gemini-flash-lite-latest

# ── DeepSeek (FALLBACK — ~$0.002/chương) ──────────────────
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat

# ── Ollama (OPTIONAL — local GPU) ─────────────────────────
OLLAMA_ENABLED=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=hunyuan-mt
OLLAMA_TIMEOUT=120

# ── Provider ──────────────────────────────────────────────
# auto = Gemini → DeepSeek → Ollama | gemini | deepseek | ollama
TRANSLATION_PROVIDER=auto

# ── Batch ─────────────────────────────────────────────────
# BATCH_SIZE=2: Gemini free tier output ~8192 tokens hard cap
# 2 × ~3000 tokens/chương = ~6000 tokens → an toàn ✅
BATCH_SIZE=2
BATCH_MAX_CHARS=10000

# ── Rate limit ────────────────────────────────────────────
REQUEST_DELAY_SECONDS=4

# ── Scraper ───────────────────────────────────────────────
HEADLESS=true
```

---

## 🌐 WEB UI (`http://localhost:5173`)

| Trang | Tính năng |
|---|---|
| **Dashboard** `/` | Danh sách truyện, tiến độ |
| **Novel Detail** `/novel/:slug` | Dịch, glossary, health check |
| **Translation Panel** | Progress bar, %, tốc độ ch/phút, ETA, **nút Dừng** |
| **Reader** `/novel/:slug/read/:file` | Đọc chương, phím ← → chuyển chương |
| **Logs** `/logs` | Lịch sử phiên dịch, token breakdown theo model |

**Nút Dừng:** dừng gracefully sau batch hiện tại — không mất dữ liệu.

**REST API** (`http://localhost:4444`):
```
GET    /api/novels
GET    /api/novels/{slug}
POST   /api/novels/{slug}/glossary
POST   /api/novels/{slug}/translate        # bắt đầu dịch
POST   /api/novels/{slug}/translate/stop   # dừng gracefully ⭐
GET    /api/novels/{slug}/translate/status
GET    /api/novels/{slug}/chapters
GET    /api/novels/{slug}/chapters/{file}
GET    /api/novels/{slug}/health
GET    /api/logs                           # lịch sử phiên ⭐
```

---

## 📊 TOKEN TRACKING

Sau mỗi phiên dịch, hệ thống tự lưu:
- `logs/<slug>_<ts>.log` — log text với dòng `[💰]` chi phí từng batch
- `logs/<slug>_<ts>_stats.json` — structured token/cost data

Trang **Logs** hiển thị breakdown theo model:
- 🔵 Gemini (free tier)
- 🟣 DeepSeek (~$0.07/1M input, $1.10/1M output)
- 🟢 Ollama/local (free)

---

## 🖥️ OLLAMA — LOCAL MODEL (optional)

RTX 4060 8GB: chạy Hunyuan-MT-7B Q4_K_M (~4.5GB VRAM).

```bash
# 1. Tải Ollama: https://ollama.com/download
# 2. Tạo Modelfile:
#    FROM ./Hunyuan-MT-7B-Instruct-Q4_K_M.gguf
#    PARAMETER temperature 0.3
#    PARAMETER num_ctx 8192
#    PARAMETER num_gpu 99
ollama create hunyuan-mt -f Modelfile
ollama run hunyuan-mt "Dịch: 他走向远方"
# 3. Bật: OLLAMA_ENABLED=true trong .env
```

---

## ⚠️ XỬ LÝ LỖI THƯỜNG GẶP

| Lỗi | Nguyên nhân | Giải pháp |
|---|---|---|
| `[Translation failed]` | API lỗi tạm thời | `python fix_chapters.py --novel <slug>` |
| `[Batch output mismatch]` | Gemini output bị cắt | `python fix_truncated.py --novel <slug>` |
| Chương ngắn bất thường | Model gộp chương | `python fix_truncated.py --novel <slug>` |
| Gemini 429 per-minute | Rate limit | Hệ thống tự chờ, sau `max_retries` → đánh dấu key `rate_limited` 1h |
| Gemini 429 daily | Key hết quota ngày | Rotate key → fallback DeepSeek, tự recover sau 24h |
| Key `rate_limited` 1h | Per-minute 429 liên tục | Tự recover sau 1h, hoặc `check_keys.py --reset` |
| Key `invalid` | Key sai/bị thu hồi | `python check_keys.py` → xóa key lỗi khỏi `.env` |
| Process bị kẹt | Batch đang chạy | Nhấn nút **Dừng** trong Web UI |
| Site block scraper | Bot detection | `HEADLESS=false` để debug |
| Còn chữ Hán | Model sót ký tự | Hệ thống tự cleanup pass |

---

## 🔄 QUY TRÌNH ĐỀ XUẤT

```
1. Kiểm tra key:  python check_keys.py
2. Khám phá:      python discover.py --genre <thể_loại>
3. Tạo truyện:    python main.py new
4. Dịch thử:      python main.py translate --novel <slug> --chapters 4
5. Kiểm tra lỗi:  python fix_chapters.py --novel <slug> --report
6. Fix nếu cần:   python fix_truncated.py --novel <slug>
7. Dịch tiếp:     python main.py translate --novel <slug> --chapters 50
8. Đọc:           http://localhost:5173
9. Xem logs:      http://localhost:5173/logs
```

---

## 📂 NOVEL PROFILE (`novel.json`)

```json
{
  "slug":                 "xich-tam-tuan-thien",
  "title":               "Xích Tâm Tuần Thiên",
  "original_title":      "赤心巡天",
  "author":              "Vong Ngữ",
  "source_url":          "https://www.69shuba.com/txt/...",
  "genre":               "cultivation",
  "last_translated_url": "https://...",
  "last_chapter_number": 145,
  "total_chapters":      0,
  "glossary":            { "姜望": "Khương Vọng" },
  "translation_style":   "Văn phong võ hiệp cổ điển...",
  "notes":               "Ghi chú"
}
```

---

## 🛠 SITE HỖ TRỢ

| Domain | Ghi chú |
|---|---|
| 69shuba.com | Đầy đủ (GBK encoding) |
| novel543.com | Cơ bản |
| Khác | Dùng selector mặc định — chỉnh `SITE_SELECTORS` trong `config.py` |
