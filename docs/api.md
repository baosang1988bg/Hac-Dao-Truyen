# API hiện hành

Frontend gọi `/api` cùng origin bằng Axios. FastAPI là nguồn OpenAPI local tại `/openapi.json`; Worker dùng router thủ công trong `src/index.js`, không tự sinh từ OpenAPI.

## Nhóm endpoint

| Endpoint | Quyền | Local / Cloud |
|---|---|---|
| `GET /api/novels` | Công khai | Local trả array; Worker trả `{novels,total,page,limit,pages}` |
| `GET /api/novels/:slug` | Công khai, admin có thể thấy thêm dữ liệu | Cả hai |
| `GET /api/novels/:slug/chapters` | Công khai | Cả hai |
| `GET /api/novels/:slug/chapters/:identifier` | Công khai | Cả hai; encode filename khi đưa vào URL |
| `GET /api/novels/:slug/epub` | Công khai | Cả hai, phụ thuộc dữ liệu EPUB |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/verify` | Mật khẩu hoặc Bearer admin | FastAPI có; Worker hiện trả 404 |
| `POST /api/novels/:slug/glossary` | Bearer admin | Cả hai; cloud cần backend để verify |
| `POST /api/novels/:slug/translate` | Bearer admin | Local; Worker proxy đến backend |
| `GET /api/novels/:slug/health` | Công khai ở local | Worker có handler nhưng thiếu route |
| `POST /api/user/register`, `/api/user/login`, `/api/user/logout` | Theo thao tác | Cả hai, kho user riêng |
| `GET /api/user/me` | Bearer độc giả | Cả hai |
| `GET /api/user/bookmarks`, `PUT/DELETE /api/user/bookmarks/:slug` | Bearer độc giả | Cả hai |
| `GET /api/user/progress`, `PUT /api/user/progress/:slug` | Bearer độc giả | Cả hai |
| `GET/POST /api/novels/:slug/comments` | GET công khai, POST độc giả | Cả hai |
| `DELETE /api/comments/:id` | Chủ bình luận hoặc admin | Cả hai |
| `POST /api/novel-requests`, `GET /api/novel-requests/mine` | Bearer độc giả | Cả hai |
| `GET /api/admin/novel-requests`, `POST /api/admin/novel-requests/:id/review` | Bearer admin | Cả hai; cloud cần backend verify |
| `POST /api/admin/sync-novel` | `x-sync-key` | Worker |

Đây là bản đồ các luồng chính; các route công cụ chi tiết nằm trong `routers/tools.py` và `routers/translate.py`.

## Ví dụ local

```sh
curl http://127.0.0.1:4444/api/novels
curl http://127.0.0.1:4444/api/novels/demo/chapters
```

Login admin nhận JSON `{"password":"..."}` và trả token. Request quản trị tiếp theo dùng `Authorization: Bearer <token>`. Đăng ký độc giả nhận `email`, `password`, `name`; phiên độc giả có tiền tố `u_`.

Worker hỗ trợ query danh sách `q`, `sort`, `order`, `genre`, `status`, `has_epub`, `page`, `limit`; mặc định page 1, limit 48, tối đa 200. Không coi bộ test FastAPI hiện tại là bằng chứng contract Worker: test chỉ khởi tạo `TestClient(api.app)`.

## Mã lỗi cần xử lý

`400/422`: đầu vào không hợp lệ; `401`: thiếu hoặc hết hạn phiên; `403`: không đủ quyền; `404`: route hoặc dữ liệu không có; `409`: xung đột; `429`: giới hạn tần suất; `502/503`: backend proxy lỗi/chưa cấu hình. FastAPI thường trả `detail`, Worker thường trả `error`; client phải xử lý cả hai.
