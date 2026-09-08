# Hắc Đạo Truyện

Hệ thống quản lý, thu thập và dịch truyện chữ Trung → Việt, kèm website đọc truyện React. Pipeline Python chạy trên máy vận hành; Cloudflare Worker phục vụ nội dung từ D1 và R2.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Bắt đầu](docs/getting-started.md) | Cài đặt, cấu hình, chạy local và kiểm tra |
| [Kiến trúc](docs/architecture.md) | Thành phần, dữ liệu, xác thực và giới hạn |
| [Sử dụng](use.md) | Import, dịch, kiểm tra, đồng bộ và phục hồi |
| [Triển khai](deploy.md) | Cloudflare, schema, secrets và checklist phát hành |
| [API](docs/api.md) | Các nhóm endpoint và khác biệt local/cloud |
| [Review tồn đọng](docs/review-2026-09-08.md) | Phát hiện có bằng chứng, ưu tiên và việc chưa xác minh |
| [Kế hoạch sửa lỗi](plans/KE_HOACH_FIX_2026-09-08.md) | Các đợt sửa R01–R07, kiểm thử và phát hành |
| [Lịch sử kế hoạch](plans/README.md) | Báo cáo và đề xuất của các phiên trước |

## Khởi động local

Dùng Python 3.11 và Node.js 20 để khớp cấu hình CI hiện có. Từ thư mục gốc:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
npm ci --prefix frontend
```

Đổi `ADMIN_PASSWORD` trong `.env`; điền key provider nếu cần dịch. Chạy hai terminal:

```sh
# Terminal 1, đã kích hoạt venv
python -m uvicorn api:app --host 127.0.0.1 --port 4444
```

```sh
# Terminal 2
npm run dev --prefix frontend
```

Mở địa chỉ Vite in ra, mặc định `http://localhost:5173`. Chi tiết Windows, Chromium và cấu hình nằm trong [hướng dẫn bắt đầu](docs/getting-started.md).

## Chức năng và trạng thái

Mã nguồn có quản lý truyện/glossary, dịch nhiều provider, đọc chương, EPUB, tài khoản độc giả, bookmark, tiến độ đọc, bình luận và yêu cầu truyện. Duyệt yêu cầu truyện chỉ đổi trạng thái; admin phải import riêng.

Local và cloud chưa tương đương hoàn toàn. Đợt review 08/09/2026 xác nhận lỗi route admin trên Worker và thiếu cột trong schema bootstrap; xem báo cáo trước khi triển khai mới. ADK mới ở mức foundation, mặc định tắt. Truyện tranh là đề xuất trong kế hoạch, chưa phải tính năng sản phẩm.

## Cấu trúc chính

```text
api.py, routers/          FastAPI và REST endpoints
main.py, pipeline.py      CLI và điều phối dịch
scraper.py, translator.py Thu thập và dịch chương
providers/, agents/      Provider AI và foundation ADK
novels/                  Hồ sơ truyện, bản gốc, bản dịch
user_store.py, data/      SQLite cho tài khoản local
frontend/                React + Vite
src/index.js             Cloudflare Worker
schema.sql, migrations/  Schema D1
migrate_to_cloudflare.py  Đồng bộ metadata và nội dung
restore_from_cloudflare.py Phục hồi từ cloud
tools/                  Công cụ vận hành bổ trợ
docs/, plans/            Tài liệu hiện hành và lịch sử
```

Không commit `.env`, `.dev.vars`, key hoặc token. Không có kết quả kiểm tra production trong đợt review này; build thành công không đồng nghĩa mọi luồng đã hoạt động.
