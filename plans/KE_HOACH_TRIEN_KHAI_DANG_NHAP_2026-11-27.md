# Kế hoạch triển khai: đăng nhập Google an toàn + quản lý tài khoản — 2026-11-27

Nhánh: `feature/auth-google` (từ `dev` đã gộp đợt học đối thủ). Bối cảnh và lý do: `plans/KE_HOACH_DANG_NHAP_2026-11-27.md`.
Phạm vi đợt này: Giai đoạn 1 + 2. Giai đoạn 3 (email quên mật khẩu/xác minh) chờ chọn dịch vụ gửi mail.
Không chạm production; migration và cấu hình Google do người dùng làm theo mục 6.

## 1. Schema — `migrations/017_auth.sql` (chỉ ADD COLUMN, vài dòng ghi)

| Bảng | Cột mới | Dùng cho |
|---|---|---|
| `users` | `email_verified_at TEXT` | Đặt khi đăng nhập Google (email đã được Google xác minh) |
| `users` | `last_login_at TEXT` | Hiển thị trong trang tài khoản |
| `users` | `deleted_at TEXT` | Tài khoản đã xoá (giữ dòng để bình luận cũ không gãy khoá ngoại) |
| `user_sessions` | `created_at TEXT`, `user_agent TEXT` | Danh sách thiết bị đang đăng nhập |

Worker tự dò cột (`PRAGMA table_info`, nhớ 10 phút như `hasChapterCountColumn`): chưa chạy migration vẫn đăng nhập được, chỉ thiếu thông tin phụ.

## 2. API Worker

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/user/google-nonce` | Nonce ký HMAC (`AUTH_SECRET`), sống 10 phút; client truyền vào `google.accounts.id.initialize({ nonce })` |
| POST | `/api/user/google-login` | Verify JWT RS256 bằng JWKS Google (cache theo `max-age`), kiểm `iss`/`aud`/`exp`/`iat`/`nbf`/`email_verified`/`nonce` (nonce dùng một lần trong isolate). Bỏ `tokeninfo` |
| GET | `/api/user/me` | Thêm `avatar_url`, `has_password`, `has_google`, `email_verified`, `created_at`, `last_login_at` |
| GET | `/api/user/sessions` | `[{ id, created_at, expires_at, user_agent, current }]` — `id` = 12 ký tự đầu SHA-256(token), không lộ token |
| DELETE | `/api/user/sessions/:id` | Đăng xuất một thiết bị |
| POST | `/api/user/logout-all` | Đăng xuất mọi thiết bị (kể cả máy hiện tại) |
| POST | `/api/user/password` | Đặt mật khẩu (tài khoản chỉ có Google) hoặc đổi mật khẩu (bắt buộc `current_password`); đổi xong huỷ các phiên khác |
| DELETE | `/api/user/account` | Body `{ confirm: "<email>" }`. Xoá session, bookmarks, tiến độ, prefs, đánh giá (tính lại điểm truyện); ẩn danh dòng `users` (email `deleted-<id>@invalid`, tên "Người dùng đã xoá", bỏ mật khẩu/google_id/avatar) để bình luận và góp ý cũ còn hiển thị |

**Luật liên kết Google (vá chiếm tài khoản trước):**
1. Có user với `google_id` = `sub` → đăng nhập.
2. Có user cùng email: nếu có mật khẩu mà `email_verified_at` trống → xoá mật khẩu + xoá mọi session cũ rồi mới liên kết; nếu không → liên kết. Đặt `email_verified_at`.
3. Không có → tạo user mới (email đã xác minh).
Tài khoản đã xoá (`deleted_at`) không đăng nhập lại được bằng session cũ; đăng nhập Google mới tạo tài khoản mới.

Biến mới: secret `AUTH_SECRET` (≥ 32 ký tự). Chưa đặt → nonce tuỳ chọn (vẫn verify chữ ký đầy đủ), log cảnh báo.

## 3. Frontend

- `context/AuthContext.jsx`: trạng thái user (từ localStorage + `/user/me`), `requireLogin(reason)` trả Promise — mở **hộp đăng nhập dùng chung** (Google + email/mật khẩu + đăng ký), xong thì chạy tiếp thao tác đang dở.
- Thay các chỗ "chưa đăng nhập → link /account" (theo dõi, bình luận, góp ý name, yêu cầu truyện) bằng `requireLogin`.
- `GoogleLoginButton`: lấy nonce trước khi initialize; xử lý lỗi popup bị chặn/FedCM; One Tap tuỳ chọn ở trang chủ (chỉ khi đã đọc ≥ 2 chương, tắt được, `use_fedcm_for_prompt`).
- Header: avatar + menu (Tài khoản, Đăng xuất).
- Trang Tài khoản: thông tin + phương thức liên kết, đặt/đổi mật khẩu, thiết bị đang đăng nhập (đăng xuất từng máy / tất cả), xoá tài khoản (gõ email để xác nhận).
- Gộp dữ liệu lần đầu đăng nhập trên máy: lịch sử đọc local → `PUT /user/progress` cho truyện chưa có tiến độ server hoặc local mới hơn (tối đa 50 truyện, cờ `authMerged:<userId>` để chỉ chạy 1 lần).
- Trang `/chinh-sach-bao-mat` (link ở footer + hộp đăng nhập).

## 4. Kiểm thử

- Worker (`tests/worker/auth-google.test.mjs`): sinh cặp khoá RSA trong test, JWKS giả qua `outboundService`; token đúng, sai `aud`, sai `iss`, hết hạn, sai chữ ký, `kid` lạ, email chưa xác minh, nonce sai/hết hạn/dùng lại; ba ca liên kết; session list/revoke/logout-all; đổi mật khẩu; xoá tài khoản (bình luận còn, điểm truyện tính lại); chạy trước migration 017.
- Frontend: test thuần cho logic gộp dữ liệu, hàng đợi `requireLogin`.
- E2E: mô phỏng `window.google` bằng init script (không gọi Google thật) — nút Google → đăng nhập → quay lại bình luận; quản lý thiết bị; xoá tài khoản; chạy lại `tests/browser/e2e_engagement.py` + smoke CI.
- Review độc lập trước khi commit.

## 5. Ngoài phạm vi
Quên mật khẩu/xác minh email (Giai đoạn 3), chuyển token sang cookie HttpOnly, đăng nhập admin bằng Google.

## 6. Việc người dùng cần làm
1. Tạo OAuth Client (Web) theo mục Giai đoạn 0 của `KE_HOACH_DANG_NHAP_2026-11-27.md`, gửi Client ID.
2. `npx wrangler secret put AUTH_SECRET`.
3. `npx wrangler d1 execute hacdao-db --file=migrations/017_auth.sql --remote` (sau 013–016).
4. Deploy; thử đăng nhập Google ở chế độ Testing; Publish app trên Google Auth Platform.

## 7. Kết quả triển khai (27/11/2026)

Đã làm đủ Giai đoạn 1 + 2 trên nhánh `feature/auth-google`. Ngoài kế hoạch gốc, review bảo mật độc lập thêm các thay đổi sau (đều có test):

- **Không ghi đè liên kết Google**: email đã gắn `sub` Google khác → 409 `google_conflict`.
- **Chỉ tự liên kết theo email khi Google thật sự quản lý email đó** (`@gmail.com` hoặc tài khoản Workspace có claim `hd`). Email khác trùng tài khoản có sẵn → 409 `link_required`: đăng nhập bằng mật khẩu rồi bấm "Liên kết Google" trong trang Tài khoản (`POST /api/user/link-google`).
- Khi chiếm lại tài khoản Gmail do người khác đăng ký trước: xoá mật khẩu, mọi phiên, tên hiển thị và cài đặt đồng bộ của người đó.
- **Xác thực lại** cho thao tác nhạy cảm: đặt mật khẩu lần đầu / xoá tài khoản cần phiên vừa đăng nhập ≤ 10 phút, hoặc id_token Google mới cùng `sub`, hoặc mật khẩu hiện tại (tài khoản có mật khẩu). Giới hạn 10 lần / 15 phút / tài khoản.
- `aud` dạng mảng chỉ hợp lệ khi `azp` = client; kid lạ chỉ ép tải lại JWKS tối đa 1 lần / 60 giây; cảnh báo log khi thiếu `AUTH_SECRET`.
- Xoá tài khoản cũng xoá yêu cầu truyện / góp ý name đang chờ và xoá trắng ghi chú; trang chính sách bảo mật ghi đúng điều này.

Kiểm chứng: Worker 150/150 (18 test đăng nhập Google: khoá RSA tự sinh + JWKS giả), frontend 172/172, pytest 542, eslint + build OK, smoke CI PASS, E2E thật (wrangler dev local + Chromium) `e2e_auth.py` 10/10 và `e2e_engagement.py` 14/14.

Chưa kiểm được: đăng nhập Google thành công với token Google THẬT (sandbox không ra mạng tới Google; phần verify chữ ký được kiểm bằng khoá tự sinh). Cần thử ở chế độ Testing của Google sau khi có Client ID.
