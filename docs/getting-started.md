# Cài đặt và phát triển

## Điều kiện

Baseline theo `.github/workflows/ci.yml`: Python 3.11, Node.js 20 và npm. Chạy lệnh Python từ thư mục gốc vì nhiều đường dẫn dữ liệu là tương đối. `requirements.txt` chưa khóa phiên bản; `pytest` chưa được khai báo trong đó.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install pytest
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

`.env.example` còn một số giá trị khác mặc định code: Gemini 2.0, batch 3, Ollama timeout 120. Giá trị được khai báo trong `.env` sẽ ghi đè mặc định. Các ghi chú quota/giá cũ trong template chưa được xác minh; không dùng để lập ngân sách.

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

Chạy test Python trên bản sao làm việc dành riêng cho kiểm thử: integration test yêu cầu ít nhất một truyện có bản dịch trên 50 ký tự và ghi tài khoản/bình luận vào `data/users.db`. Có thể tạo fixture `novels/ci-demo/novel.json` và chương trong `translated/` theo CI. Không chạy trên dữ liệu người dùng đang phục vụ. `npm test` ở root chỉ chọn `test_novel_manager.py`, không bao gồm `tests/`.

Đợt review hiện tại: build và syntax pass; lint fail. Chưa chạy test Python vì môi trường không có pytest và venv không có `bin/python`. Xem [kết quả chi tiết](review-2026-09-08.md).
