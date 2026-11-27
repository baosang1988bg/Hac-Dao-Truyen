# Nơi lưu khoá/bí mật cho đăng nhập Google

Repo này **công khai** → tuyệt đối không commit bí mật vào bất kỳ file nào được git theo dõi.

| Giá trị | Bí mật? | Lưu ở đâu |
|---|---|---|
| Google **Client ID** (`…apps.googleusercontent.com`) | Không | Đã có trong `wrangler.jsonc` (`GOOGLE_CLIENT_ID`) và `frontend/.env.production` (`VITE_GOOGLE_CLIENT_ID`) |
| Google **Client secret** (`GOCSPX-…`) | **Có** | (1) Trình quản lý mật khẩu của bạn (1Password/Bitwarden/iCloud Keychain) — bản gốc; (2) Cloudflare: `npx wrangler secret put GOOGLE_CLIENT_SECRET`; (3) máy local khi cần: file `.dev.vars` (đã gitignore, chép từ `.dev.vars.example`) |
| `AUTH_SECRET` | **Có** | `npx wrangler secret put AUTH_SECRET` + trình quản lý mật khẩu |
| `VIEW_TOKEN_SECRET` | **Có** | `npx wrangler secret put VIEW_TOKEN_SECRET` + trình quản lý mật khẩu |

Ghi chú:
- Code hiện tại **không dùng** Client secret: nút "Tiếp tục với Google" (Google Identity Services, dạng popup) chỉ cần Client ID, Worker tự xác minh id_token bằng khoá công khai của Google. Lưu secret vào Cloudflare chỉ để có sẵn nếu sau này chuyển sang luồng server-side.
- Google chỉ hiện Client secret **một lần** khi tạo; mất thì vào Google Auth Platform → Clients → client "Hắc Đạo Truyện" → **Add secret** tạo cái mới rồi xoá cái cũ.
- Lỡ lộ secret (dán vào chat, commit nhầm, ảnh chụp màn hình): tạo secret mới, xoá secret cũ trên Google, chạy lại `wrangler secret put`. Commit nhầm thì xoá khỏi lịch sử git không đủ vì repo công khai — luôn coi là đã lộ và đổi ngay.
- Xem danh sách secret đã đặt trên Cloudflare (chỉ tên, không xem được giá trị): `npx wrangler secret list`.
