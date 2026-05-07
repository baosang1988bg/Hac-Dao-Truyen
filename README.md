# 📖 Novel Translator — Hệ Thống Dịch Tiểu Thuyết Tự Động

> Tự động crawl & dịch tiểu thuyết Trung Quốc sang tiếng Việt bằng AI đa provider.  
> **Gemini** (primary, free) → **DeepSeek** (fallback) → **Groq** → **Ollama** (local, optional)

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite)](https://vitejs.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## ✨ Tính Năng Chính

- **Crawl tự động** từ nhiều nguồn (69shuba.com, novel543.com, và các site khác)
- **Dịch AI đa provider**: Gemini → DeepSeek → Groq → Ollama (local GPU)
- **Quản lý nhiều truyện** song song với glossary riêng cho từng tác phẩm
- **Batch translation** thông minh — tự điều chỉnh kích thước batch theo token limit
- **Auto-rotate API keys** khi bị rate-limit, tự phục hồi sau cooldown
- **Web UI** hiện đại (React + Vite) với progress bar, ETA, nút dừng graceful
- **REST API** (FastAPI) cho tích hợp bên ngoài
- **Chrome Extension** để thêm truyện nhanh từ trình duyệt
- **Token tracking** & cost breakdown theo từng model sau mỗi phiên dịch

---

## 🗂 Cấu Trúc Project

```
novel-translator/
├── main.py               # CLI chính — dịch, quản lý truyện
├── translator.py         # Engine dịch (Gemini / DeepSeek / Groq / Ollama)
├── scraper.py            # Crawl nội dung từ website (Playwright + BS4)
├── novel_manager.py      # Quản lý profile truyện (JSON)
├── config.py             # Cấu hình toàn cục (load từ .env)
├── api.py                # REST API backend (FastAPI)
├── discover.py           # Khám phá & gợi ý truyện mới
│
├── fix_chapters.py       # Fix chương missing / failed
├── fix_truncated.py      # Fix chương bị cắt giữa chừng
├── fix_one_chapter.py    # Dịch lại đúng 1 chương cụ thể
├── fix_batch_mismatch.py # Fix chương batch mismatch
│
├── check_keys.py         # Kiểm tra & quản lý Gemini API keys
├── check_models.py       # Test Gemini model nào đang hoạt động
├── verify.py             # Kiểm tra pipeline đầu cuối
├── verify_translation.py # Kiểm tra chất lượng bản dịch
├── inspect_site.py       # Debug cấu trúc HTML site mới
│
├── start.sh              # Khởi động backend + frontend cùng lúc
├── requirements.txt      # Thư viện Python
├── .env                  # ⚠️ API keys & config — KHÔNG commit
├── .env.example          # Template .env (an toàn để commit)
│
├── novels/               # Thư mục chứa tất cả truyện
│   └── <slug>/
│       ├── novel.json    # Profile + glossary + tiến độ
│       ├── text_raw/     # File .txt gốc tiếng Trung
│       └── translated/   # File _VI.md đã dịch
├── logs/                 # Log + stats JSON từng phiên
├── discover_results/     # Kết quả gợi ý truyện
├── frontend/             # React Web UI (Vite)
└── extension/            # Chrome Extension
```

---

## 🚀 Cài Đặt & Khởi Động

### Yêu Cầu Hệ Thống

- Python 3.10+
- Node.js 18+ & npm
- (Tùy chọn) GPU + [Ollama](https://ollama.com) để dùng local model

### 1. Clone & Cài Thư Viện

```bash
git clone <repo-url>
cd novel-translator

# Backend Python
pip install -r requirements.txt
playwright install chromium

# Frontend React
cd frontend && npm install && cd ..
```

### 2. Cấu Hình API Keys

```bash
cp .env.example .env
# Mở .env và điền API keys của bạn
```

Xem hướng dẫn chi tiết trong `.env.example`.

### 3. Khởi Động

```bash
# Khởi động cả backend lẫn frontend cùng lúc
bash start.sh

# Hoặc chạy riêng lẻ:
uvicorn api:app --host 127.0.0.1 --port 4444 --reload   # Backend
cd frontend && npm run dev                                 # Frontend → http://localhost:5173
```

---

## 📌 CLI — Các Lệnh Chính

```bash
python main.py new                                        # Tạo truyện mới (interactive)
python main.py list                                       # Danh sách tất cả truyện
python main.py info   --novel <slug>                      # Chi tiết 1 truyện

python main.py translate --novel <slug>                   # Dịch tiếp từ chỗ đã dừng
python main.py translate --novel <slug> --chapters 10     # Dịch 10 chương tiếp theo
python main.py translate --novel <slug> --url <URL>       # Từ URL cụ thể
python main.py translate --novel <slug> --force           # Dịch lại dù đã có file

python main.py retranslate --novel <slug>                 # Dịch lại từ raw (không crawl)
python main.py retranslate --novel <slug> --force         # Dịch lại tất cả raw

python main.py glossary --novel <slug>                    # Xem / thêm glossary
```

---

## 🔑 Quản Lý Gemini API Keys

Mỗi Gmail = 1 key miễn phí tại [Google AI Studio](https://aistudio.google.com/app/apikey).  
Cấu hình nhiều key trong `.env` để rotate tự động:

```env
GOOGLE_API_KEYS="key1, key2, key3, key4, key5"
```

5 key × 1500 req/ngày = **7500 req/ngày ≈ 22500 chương/ngày miễn phí**.

```bash
python check_keys.py           # Kiểm tra tất cả key
python check_keys.py --show    # Xem trạng thái (không gọi API)
python check_keys.py --reset   # Reset key về working sau 24h
```

### Trạng Thái Key

| Status | TTL | Ý Nghĩa |
|---|---|---|
| `working` | — | Đang hoạt động bình thường |
| `rate_limited` | 1h | Bị per-minute 429 liên tục |
| `quota_exceeded` | 24h | Hết daily quota |
| `invalid` | ∞ | Key sai hoặc bị thu hồi |

---

## 🔧 Fix Chương Lỗi

```bash
# Fix chương missing / failed / suspicious
python fix_chapters.py --novel <slug> --report   # Báo cáo lỗi
python fix_chapters.py --novel <slug>             # Tự động fix
python fix_chapters.py --all                      # Fix tất cả truyện

# Fix chương bị cắt giữa chừng (Gemini free tier output cap ~8192 tokens)
python fix_truncated.py --novel <slug> --report
python fix_truncated.py --novel <slug>

# Dịch lại đúng 1 chương cụ thể
python fix_one_chapter.py --novel <slug> --chapter "第127章 ..."
```

---

## 🔍 Khám Phá Truyện

```bash
python discover.py                          # Top 10 truyện hot
python discover.py --genre cultivation      # Tu tiên / võ đạo
python discover.py --genre romance          # Ngôn tình
python discover.py --genre isekai           # Xuyên không / trọng sinh
python discover.py --like "mô tả ngắn"     # Tìm truyện tương tự
python discover.py --top 20 --save          # Lưu kết quả ra Markdown
```

---

## 🌐 Web UI

Mở trình duyệt tại `http://localhost:5173`

| Trang | Tính Năng |
|---|---|
| **Dashboard** `/` | Danh sách truyện, tổng quan tiến độ |
| **Novel Detail** `/novel/:slug` | Dịch, glossary, health check |
| **Translation Panel** | Progress bar, %, tốc độ ch/phút, ETA, **nút Dừng** |
| **Reader** `/novel/:slug/read/:file` | Đọc chương, phím ← → chuyển chương |
| **Logs** `/logs` | Lịch sử phiên dịch, token/cost breakdown |

### REST API (`http://localhost:4444`)

```
GET    /api/novels
GET    /api/novels/{slug}
POST   /api/novels/{slug}/translate          # Bắt đầu dịch
POST   /api/novels/{slug}/translate/stop     # Dừng gracefully
GET    /api/novels/{slug}/translate/status
GET    /api/novels/{slug}/chapters
GET    /api/novels/{slug}/chapters/{file}
GET    /api/novels/{slug}/health
GET    /api/logs
```

---

## 🖥️ Ollama — Local Model (Tùy Chọn)

Chạy model dịch cục bộ, không cần internet. Khuyên dùng RTX 4060 8GB trở lên.

```bash
# 1. Tải Ollama: https://ollama.com/download
# 2. Tạo Modelfile cho Hunyuan-MT:
#    FROM ./Hunyuan-MT-7B-Instruct-Q4_K_M.gguf
#    PARAMETER temperature 0.3
#    PARAMETER num_ctx 8192
#    PARAMETER num_gpu 99
ollama create hunyuan-mt -f Modelfile

# 3. Bật trong .env:
#    OLLAMA_ENABLED=true
#    OLLAMA_MODEL=hunyuan-mt
```

---

## ⚙️ Cấu Hình (.env)

Xem file `.env.example` để biết toàn bộ các biến môi trường có sẵn.  
Các biến quan trọng nhất:

| Biến | Mặc Định | Mô Tả |
|---|---|---|
| `GOOGLE_API_KEYS` | — | Danh sách Gemini key, cách nhau bằng dấu phẩy |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Model Gemini chính |
| `TRANSLATION_PROVIDER` | `auto` | `auto` / `gemini` / `deepseek` / `ollama` / `groq` |
| `BATCH_SIZE` | `3` | Số chương gộp trong 1 lần gọi AI |
| `BATCH_MAX_CHARS` | `8000` | Giới hạn ký tự mỗi batch |
| `REQUEST_DELAY_SECONDS` | `4` | Delay giữa các request (free tier: 4s) |
| `HEADLESS` | `false` | Ẩn cửa sổ trình duyệt khi crawl |

---

## ⚠️ Xử Lý Lỗi Thường Gặp

| Lỗi | Nguyên Nhân | Giải Pháp |
|---|---|---|
| `[Translation failed]` | API lỗi tạm thời | `python fix_chapters.py --novel <slug>` |
| `[Batch output mismatch]` | Output bị cắt | `python fix_truncated.py --novel <slug>` |
| Gemini 429 per-minute | Rate limit | Hệ thống tự chờ & rotate key |
| Gemini 429 daily | Hết quota ngày | Rotate key, fallback DeepSeek |
| Key `invalid` | Key sai/bị thu hồi | Xóa key lỗi khỏi `.env` |
| Site block scraper | Bot detection | Đặt `HEADLESS=false` để debug |
| Còn chữ Hán sau dịch | Model sót ký tự | Hệ thống tự chạy cleanup pass |

---

## 🔄 Quy Trình Đề Xuất

```
1. Kiểm tra key:  python check_keys.py
2. Khám phá:      python discover.py --genre <thể_loại>
3. Tạo truyện:    python main.py new
4. Dịch thử:      python main.py translate --novel <slug> --chapters 4
5. Kiểm tra lỗi:  python fix_chapters.py --novel <slug> --report
6. Fix nếu cần:   python fix_truncated.py --novel <slug>
7. Dịch tiếp:     python main.py translate --novel <slug> --chapters 50
8. Đọc truyện:    http://localhost:5173
```

---

## 🤝 Đóng Góp

Pull requests và issues đều được chào đón!  
Nếu bạn muốn thêm hỗ trợ cho site mới, hãy chỉnh `SITE_SELECTORS` trong `config.py`.

---

## 📄 License

[MIT](LICENSE)
