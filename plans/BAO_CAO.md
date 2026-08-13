# Báo cáo review & nâng cấp HacDaoTruyen — 02/07/2026

## 1. Bảo mật — 6 lỗi được phát hiện và xử lý

**Mật khẩu admin hardcode ở client (nghiêm trọng nhất).** Trước đây `LoginPage.jsx` so sánh mật khẩu ngay trong JavaScript — bất kỳ ai mở DevTools đều đọc được, và backend hoàn toàn không kiểm tra quyền. Nay xác thực chuyển hẳn về server: mật khẩu đọc từ `ADMIN_PASSWORD` trong `.env`, so sánh constant-time (chống timing attack), phát session token qua `POST /api/auth/login`. Toàn bộ endpoint ghi/dịch (translate, stop, glossary, tools, cleanup, translate-quick) yêu cầu `Authorization: Bearer <token>`; guest vẫn đọc truyện tự do. Token mặc định hạn 7 ngày (`AUTH_TOKEN_TTL`). File mới: `auth.py`.

**Path traversal (HIGH).** Endpoint `GET /api/novels/{slug}/chapters/{identifier}` trước đây ghép thẳng tham số vào đường dẫn — có thể đọc file tùy ý trên máy (ví dụ `../../.env`). Nay mọi slug được validate bằng regex nghiêm ngặt và mọi filename đi qua `safe_join()` (realpath + kiểm tra nằm trong thư mục gốc). File mới: `security_utils.py`, áp dụng ở tất cả endpoint nhận slug/filename.

**Argument injection ở tool runner (HIGH).** Tham số `chapter_title` truyền vào subprocess có thể chèn cờ như `--force`. Nay được validate (chặn ký tự đầu `-`, null byte, xuống dòng, giới hạn 200 ký tự) và endpoint yêu cầu quyền admin.

**CORS mở toàn bộ (MEDIUM).** `allow_origins=["*"]` kèm credentials — nay giới hạn về localhost dev, mở rộng qua biến `ALLOWED_ORIGINS` khi deploy.

**Race condition ở global state (MEDIUM).** `translation_tasks` và `cancel_flags` được nhiều thread đọc/ghi không khóa — nay bảo vệ bằng `threading.Lock` (module `state.py`), đồng thời chặn chạy 2 phiên dịch song song trên cùng một truyện (trả 409).

**SSRF ở crawl URL (MEDIUM).** Tham số `url` khi bắt đầu dịch có thể trỏ vào mạng nội bộ — nay chỉ chấp nhận http/https và chặn localhost cùng toàn bộ dải IP private/loopback/link-local.

Điểm cộng có sẵn: `.env` và `key_status.json` đã được gitignore đúng, log chỉ in 6 ký tự cuối của API key.

## 2. Tái cấu trúc — dễ trace, dễ bảo trì

Cấu trúc mới tách theo trách nhiệm, các entry point cũ (`uvicorn api:app`, `python main.py translate`, `from translator import NovelTranslator`) giữ nguyên nhờ lớp facade và re-export:

```
├── api.py            # 1183 → 54 dòng: chỉ tạo app + CORS + include routers
├── routers/          # auth_routes, novels, chapters, translate, tools, logs
├── main.py           # 1587 → 530 dòng: CLI + orchestrator
├── pipeline.py       # luồng dịch tách thành ~17 hàm < 120 dòng, docstring tiếng Việt
├── translator.py     # 1181 → 824 dòng: facade NovelTranslator
├── providers/        # gemini, deepseek, groq, ollama, key_manager
├── state.py          # global state + lock dùng chung
├── chapter_utils.py  # util chương dùng chung (hết copy-paste split_chapter_content)
├── auth.py           # xác thực server-side
├── security_utils.py # validate slug/file/URL/argument
└── tools/            # 18 script một-lần-dùng gom về đây, vẫn chạy được từ root
```

Hàm `cmd_translate_async` 615 dòng (trộn crawl + dịch + merge + lưu) giờ là orchestrator ~60 dòng gọi các hàm pipeline đặt tên rõ ràng: `run_catalog_flow`, `flush_batch`, `process_batch_async`, `finalize_session`… Khi cần trace lỗi chỉ cần đọc đúng hàm liên quan. Đã kiểm chứng 19/19 endpoint giữ nguyên path và response shape so với trước refactor.

## 3. Tối ưu logic dịch

Delay cứng 2 giây giữa các lần fetch chương được thay bằng `SCRAPE_DELAY_SECONDS` (cấu hình qua `.env`, mặc định 2) và bỏ hẳn sleep ở lần fetch cuối của vòng lặp — dịch 100 chương tiết kiệm vài phút chờ vô ích. Ước tính token trước đây chạy regex lặp lại nhiều lần trên cùng nội dung, nay cache bằng `lru_cache` và gộp 2 lần quét ký tự Trung thành 1 lần (`count_chinese_chars`). Endpoint health và tool merge trước đây `os.listdir` cùng một thư mục nhiều lần trong 1 request, nay tái sử dụng set đã build. Kết quả dịch đầu ra không đổi — chỉ nhanh và nhẹ hơn.

## 4. UX/UI — ưu tiên mobile

**Nguyên nhân gốc của "chữ nhỏ" đã tìm ra:** `index.html` thiếu thẻ `<meta name="viewport">`, nên trình duyệt mobile render trang ở khổ ảo ~980px rồi thu nhỏ — fontSize 20px thực tế chỉ hiển thị cỡ 8–9px. Đã thêm viewport + theme-color + `lang="vi"`. Đây là thay đổi có tác động lớn nhất toàn bộ đợt này.

**Reader (trang đọc truyện):** fontSize mặc định nâng 20→21px, line-height 1.65→1.7 (chỉ áp cho người dùng mới — cài đặt đã lưu của bạn được giữ nguyên). Thêm: ghi nhớ vị trí cuộn theo từng chương (quay lại đọc tiếp đúng chỗ), thanh tiến độ đọc 3px trên đỉnh màn hình, vùng chạm 2 mép màn hình để lật chương trên mobile (không ảnh hưởng bôi đen text — có kiểm tra cử chỉ cuộn), thanh điều hướng trên tự ẩn khi cuộn xuống và hiện lại khi cuộn lên, hỗ trợ safe-area cho iPhone tai thỏ, khung xem trước font trực tiếp trong bảng cài đặt. Toàn bộ tính năng cũ (5 theme, 5 font, thanh chỉnh độ rộng, phím ← →) giữ nguyên.

**Toàn app:** hiệu ứng hover chỉ-cho-chuột trên card truyện và nút login chuyển sang CSS `:hover`/`:active` có phân biệt thiết bị cảm ứng (chạm có phản hồi, không bị "dính" hover); tab bar ở trang chi tiết truyện cuộn ngang được trên màn hẹp; sidebar 300px co giãn `minmax(260px, 300px)` hết tràn ở tablet; banner "Đọc tiếp" ở Dashboard wrap được khi tiêu đề dài; mọi phần tử tương tác đảm bảo vùng chạm ≥ 44px; LoginPage hiện lỗi sai mật khẩu inline thay vì `alert()`.

## 5. Kiểm chứng đã chạy

`py_compile` pass toàn bộ file Python (kể cả 18 script trong tools/). Smoke test bằng FastAPI TestClient trên dữ liệu thật: đọc danh sách 8 truyện và nội dung chương OK; path traversal bị chặn; endpoint ghi không token trả 401; login sai trả 401, login đúng nhận token và cập nhật glossary thành công (200); URL nội bộ khi dịch bị chặn 400; logout vô hiệu token ngay. Frontend build production bằng Vite thành công, 0 lỗi 0 cảnh báo.

## 6. Việc bạn cần làm

Đổi mật khẩu trong `.env` (dòng `ADMIN_PASSWORD` — tôi tạm giữ mật khẩu cũ để không gián đoạn) vì mật khẩu cũ từng nằm công khai trong source JS. Sau khi pull code, đăng nhập lại trên web để nhận token mới. Chrome Extension nếu còn dùng `translate-quick` sẽ cần gửi kèm Bearer token (endpoint này giờ yêu cầu admin để tránh bị rút quota API). Khi deploy ra domain thật, thêm domain vào `ALLOWED_ORIGINS` trong `.env`.

## 7. Đề xuất tiếp theo (chưa làm)

`NovelDetail.jsx` vẫn là file 2.100+ dòng — nên tách thành các component riêng khi có dịp. Rate-limiting cho endpoint login (chống brute-force) đáng cân nhắc nếu server mở ra internet. Có thể thêm chế độ đọc cuộn vô hạn (tự nạp chương kế) — với hạ tầng tap-zone và scroll-persistence mới, việc này giờ khá dễ.
