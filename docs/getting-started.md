# Cài đặt và phát triển

## Điều kiện

Baseline theo `.github/workflows/ci.yml`: Python 3.11, Node.js 22 và npm. Chạy lệnh Python từ thư mục gốc vì nhiều đường dẫn dữ liệu là tương đối. Các dependency Python được khóa trong `requirements.lock` (runtime), `requirements-dev.lock` (test) và `requirements-cloud.lock` (thêm Google Drive).

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.lock
npm ci
npm ci --prefix frontend
cp .env.example .env
```

Windows PowerShell: tạo venv bằng `py -3.11 -m venv .venv`, kích hoạt bằng `.venv\Scripts\Activate.ps1`, sao chép cấu hình bằng `Copy-Item .env.example .env`. Những lệnh `python`/`npm` còn lại giống nhau.

Nếu scraper cần trình duyệt:

```sh
python -m playwright install chromium
```

## Cấu hình local

Điền key thật trong `.env`, bỏ giá trị key mẫu của provider không sử dụng. Các mặc định dưới đây lấy từ mã nguồn, không phải cam kết về model/quota của nhà cung cấp.

| Biến | Ý nghĩa / mặc định trong code |
|---|---|
| `ADMIN_PASSWORD` | Bắt buộc để đăng nhập admin; thiếu trả 503 |
| `AUTH_TOKEN_TTL` | Phiên admin, 604800 giây |
| `GOOGLE_API_KEYS` | Nhiều key cách nhau dấu phẩy; ưu tiên hơn các alias bên dưới |
| `GOOGLE_API_KEY`, `GEMINI_API_KEYS`, `GEMINI_API_KEY` | Alias, theo đúng thứ tự ưu tiên này sau `GOOGLE_API_KEYS` |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `TRANSLATION_PROVIDER` | `auto`; cũng hỗ trợ `gemini`, `deepseek`, `groq`, `ollama` |
| `FALLBACK_ORDER` | `gemini,deepseek` |
| `DEEPSEEK_API_KEY`, `GROQ_API_KEY` | Key cho provider tương ứng |
| `OLLAMA_ENABLED` | `false`; bật khi đã có server/model local |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | `http://localhost:11434`, `hunyuan-mt` |
| `OLLAMA_TIMEOUT` | 600 giây |
| `BATCH_SIZE` | 2; auto với DeepSeek đứng đầu ép về 1 |
| `REQUEST_DELAY_SECONDS` | 4 giây |
| `SCRAPE_DELAY_SECONDS` | 2 giây |
| `HEADLESS` | Chế độ trình duyệt ẩn của scraper |
| `ALLOWED_ORIGINS` | Origin bổ sung cho CORS FastAPI, cách nhau dấu phẩy |
| `ADK_ENABLED` | Tắt mặc định; thử nghiệm riêng, cần dependency bổ sung |

Template `.env.example` đã đồng bộ mặc định code. Ghi cloud và ngân sách mặc định tắt/0; xem [kiểm soát chi phí](cost-controls.md).

## Chạy ứng dụng

```sh
python -m uvicorn api:app --host 127.0.0.1 --port 4444
```

Terminal khác:

```sh
npm run dev --prefix frontend
```

Vite proxy `/api` đến `127.0.0.1:4444`. Swagger local: `http://127.0.0.1:4444/docs`; OpenAPI: `/openapi.json`. Chỉ chạy một process backend vì phiên admin và trạng thái job nằm trong bộ nhớ. Khởi động lại làm mất phiên admin/job state.

`start.sh` hiện kill cưỡng bức tiến trình trên port 4444/5173; ưu tiên hai terminal khi phát triển để kiểm soát đúng tiến trình.

## Kiểm tra trước PR

```sh
npm run build --prefix frontend
npm run lint --prefix frontend
node --check src/index.js
python -m pytest test_novel_manager.py tests/ -v
```

Pytest tự tạo dữ liệu và SQLite tạm, không cần truyện thật. `npm test` chạy toàn bộ Python và Worker; cần kích hoạt venv trước. Worker dùng Miniflare D1/R2 local, không cần đăng nhập Cloudflare.

Browser smoke: `python tests/browser/smoke.py` sau khi cài Chromium; có thể đặt `HACDAO_BROWSER_PATH` tới Chrome hệ thống. API/asset ngoài được giả lập. Kết quả và giới hạn production: [nhật ký triển khai](implementation-log.md).
