# Kế hoạch: đăng nhập người đọc + Google — 2026-11-27

## 1. Hiện trạng (đã kiểm tra trên code và site thật)

Hệ thống đăng nhập **đã có phần lớn code**, chỉ chưa bật đủ:

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Đăng ký / đăng nhập email + mật khẩu | **Đang chạy trên production** | `/account` có form; Worker `userRegister`/`userLogin` (PBKDF2 100k vòng, session `u_<64 hex>` sống 30 ngày, bảng `users`, `user_sessions`) |
| Đăng nhập Google | **Code có, CHƯA cấu hình** | `POST /api/user/google-login` trên production trả `503 "Đăng nhập Google chưa được cấu hình trên server"`; `wrangler.jsonc` có `GOOGLE_CLIENT_ID: ""`; frontend thiếu `VITE_GOOGLE_CLIENT_ID` nên nút Google tự ẩn |
| Tính năng dùng tài khoản | Có | Theo dõi truyện, tiến độ đọc server, bình luận, góp ý name, đồng bộ cài đặt, yêu cầu truyện |
| Quên mật khẩu / xác minh email | **Chưa có** | Không có dịch vụ gửi email |
| Trang chính sách bảo mật | **Chưa có** | Google yêu cầu khi đưa màn hình đồng ý OAuth ra công khai |
| Quản lý phiên, xoá tài khoản | **Chưa có** | |
| Admin | Tách riêng (token do backend Python cấp) | Ngoài phạm vi kế hoạch này |

## 2. Lỗ hổng cần vá TRƯỚC khi bật Google

1. **Chiếm tài khoản trước (pre-account hijacking)** — `userGoogleLogin` tự liên kết Google vào tài khoản email/mật khẩu có cùng email. Vì đăng ký email không xác minh, kẻ xấu có thể đăng ký trước bằng email của nạn nhân (tự đặt mật khẩu); khi nạn nhân đăng nhập Google lần đầu, Google bị gắn vào tài khoản đó và kẻ xấu vẫn đăng nhập bằng mật khẩu, đọc được dữ liệu của nạn nhân. **Sửa:** khi liên kết theo email mà tài khoản có mật khẩu chưa từng xác minh → xoá `password_hash`, xoá mọi session cũ, ghi `email_verified_at`; người dùng đặt lại mật khẩu sau khi đã đăng nhập Google nếu muốn.
2. **Xác minh id_token qua `tokeninfo`** — Google khuyến nghị endpoint này chỉ để debug; mỗi lần đăng nhập thêm một request ra ngoài. **Sửa:** tự verify JWT RS256 bằng WebCrypto với khoá công khai JWKS `https://www.googleapis.com/oauth2/v3/certs` (cache theo `max-age`), kiểm `iss`, `aud`, `exp`, `iat`, `email_verified`, và `nonce` chống replay.
3. **Đăng ký email không giới hạn** — đã có rate limit 10/phút/IP (best-effort). Bổ sung Cloudflare Turnstile cho form đăng ký (miễn phí, không tracking) khi bật quảng bá rộng.

## 3. Các giai đoạn

### Giai đoạn 0 — Cấu hình Google (bạn làm, ~30 phút, không cần code)
1. Google Cloud Console → tạo project "Hac Dao Truyen".
2. **Google Auth Platform → Branding (màn hình đồng ý):** loại External; tên ứng dụng "Hắc Đạo Truyện"; email hỗ trợ; logo (tuỳ chọn); Authorized domains: `hacdaotruyen.com`; trang chủ `https://hacdaotruyen.com`; chính sách bảo mật `https://hacdaotruyen.com/chinh-sach-bao-mat` (trang tạo ở giai đoạn 1).
3. **Data access / scopes:** chỉ `openid`, `email`, `profile` (không nhạy cảm → không cần Google thẩm định bảo mật).
4. **Clients → Create client → Web application.** Authorized JavaScript origins: `https://hacdaotruyen.com`, `http://localhost:5173`, `http://localhost:8787`. KHÔNG cần redirect URI (dùng nút Google Identity Services dạng popup).
5. **Audience:** để "Testing" + thêm vài email thử; khi xong giai đoạn 1 thì bấm "Publish app".
6. Gửi mình Client ID (dạng `xxxx.apps.googleusercontent.com` — không phải bí mật). Mình đặt vào `wrangler.jsonc` (`GOOGLE_CLIENT_ID`) và `frontend/.env.production` (`VITE_GOOGLE_CLIENT_ID`). Client secret KHÔNG cần và KHÔNG được đưa vào repo.

### Giai đoạn 1 — Bật Google an toàn (mình làm, ~1 ngày)
- Worker: verify JWT bằng JWKS + nonce; sửa luật liên kết (mục 2.1); migration `017_auth.sql`: `users.email_verified_at`, `users.last_login_at`, `user_sessions.created_at/last_seen_at/user_agent` (chỉ ADD COLUMN, rẻ).
- `/api/user/me` trả thêm `avatar_url`, `has_password`, `has_google`.
- Frontend: nút Google (đã có) + **hộp đăng nhập dùng chung** mở tại chỗ khi người đọc bấm hành động cần tài khoản (theo dõi, bình luận, góp ý name, chấm sao lưu theo tài khoản…) rồi quay lại đúng thao tác, thay vì chuyển sang `/account`. Header hiện avatar khi đã đăng nhập.
- **Gộp dữ liệu khi đăng nhập lần đầu:** lịch sử đọc trên máy → tiến độ server (chỉ khi mới hơn); cài đặt đọc/quy tắc tên đã có cơ chế đồng bộ.
- Trang `/chinh-sach-bao-mat` (dữ liệu thu thập: email, tên, avatar Google, tiến độ đọc, bình luận; GA4; cách xoá tài khoản).
- Test: Worker test với cặp khoá RSA tự sinh + JWKS giả (đúng token, sai `aud`, hết hạn, sai chữ ký, sai nonce, email chưa xác minh, các ca liên kết tài khoản); E2E mô phỏng `window.google` để kiểm luồng nút → đăng nhập → quay lại thao tác.

### Giai đoạn 2 — Quản lý tài khoản (~0,5–1 ngày)
- Trang Tài khoản: avatar, phương thức đăng nhập đang liên kết, đặt/đổi mật khẩu (khi đã đăng nhập), danh sách thiết bị đang đăng nhập + đăng xuất từng máy / tất cả.
- `DELETE /api/user/account`: xoá session, bookmarks, tiến độ, prefs, đánh giá, góp ý; bình luận chuyển thành "Người dùng đã xoá" (giữ mạch thảo luận). Google cũng khuyến nghị có lối xoá tài khoản.
- Google One Tap (tuỳ chọn, bật FedCM) ở trang chủ cho khách quay lại — chỉ hiện khi đã đọc ≥ 2 chương, không làm phiền lần đầu.

### Giai đoạn 3 — Email (tuỳ chọn, cần chọn dịch vụ gửi mail)
- Quên mật khẩu + xác minh email bằng link ký HMAC hết hạn 30 phút.
- Dịch vụ: Resend (miễn phí ~3.000 mail/tháng, cần thêm bản ghi DNS cho domain) hoặc tương đương. Workers gọi bằng `fetch`, khoá API đặt bằng `wrangler secret`.
- Nếu không muốn quản lý email: cân nhắc chỉ giữ Google cho tài khoản mới và ẩn form đăng ký email (tài khoản email cũ vẫn đăng nhập được).

## 4. Chi phí và rủi ro
- D1: đăng nhập ~2–3 dòng ghi/lượt (session + last_login); không đáng kể so với hạn mức.
- Không thêm hạ tầng; JWKS cache ở edge.
- Rủi ro: người dùng chặn cookie bên thứ ba/popup → nút Google lỗi im lặng (đã có fallback email); Safari ITP với One Tap (dùng FedCM). Thông báo lỗi rõ ràng trong UI.

## 5. Thứ tự đề xuất
Giai đoạn 0 (bạn) song song Giai đoạn 1 (mình, trên nhánh `feature/auth-google`) → kiểm E2E → deploy cùng đợt migration đang chờ → Publish app trên Google → Giai đoạn 2 → Giai đoạn 3 khi bạn chọn dịch vụ email.
