# Nhật ký triển khai các phase

## Chuẩn bị

- Commit docs/kế hoạch nền: `6b4c308`.
- Đã tra Skills Directory và nguồn chính thức Cloudflare: `workers-best-practices` phù hợp tham khảo nhưng không cần cài thêm skill/agent để sửa lỗi hiện tại. Không thêm agent runtime vào sản phẩm.
- Mỗi phase commit riêng sau test; kiểm tra lại test và diff của commit trước khi tiếp tục.

## Phase 0 — Test cô lập

Thêm pytest fixture truyện 2 chương và SQLite tạm, reset session/task giữa test. `HACDAO_DATA_DIR` cho phép tách DB trước import; không thay mặc định production. Test novel manager dùng thư mục tạm. Thêm Node Worker harness và lệnh test thống nhất.

Verify: 27 Python tests pass; 1 Worker test pass. Một cảnh báo deprecation từ Starlette/AnyIO, không phải lỗi test. Không gọi API dịch hay ghi Cloudflare. Các phase tiếp theo chưa hoàn tất.
