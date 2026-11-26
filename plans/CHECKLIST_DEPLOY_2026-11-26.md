# Checklist đưa nhánh `feature/competitor-learnings` lên production — 2026-11-26

Mô hình nhánh: `docs/BRANCHING_AND_CICD.md` (feature → PR vào `dev` → PR `dev` → `prod`
→ chạy tay `deploy_prod.yml`). Người dùng tự làm từng bước; agent KHÔNG push/deploy/`--remote`.

**Cảnh báo trước khi bắt đầu:** `origin/prod` hiện đã chứa đủ commit của `origin/dev`
(gồm lỗi modal luôn phủ Reader, fc8a881) nhưng Worker đang chạy là bản cũ hơn nên site
thật CHƯA dính. **Không chạy `deploy_prod.yml` từ `prod` cho tới khi bước 2 xong.**

## A. Hotfix modal (làm trước, độc lập với nhánh lớn)

1. Push `hotfix/reader-modal-overlay` (1 commit 1960581, rẽ từ `origin/dev` fc8a881) → mở
   PR vào `dev`, chờ CI xanh (`backend`, `worker`, `frontend` + smoke) → merge.
2. PR `dev` → `prod`, CI xanh → merge. Muốn đưa riêng hotfix lên ngay: Actions →
   `Deploy Production` → `dry_run=true` trước, rồi chạy thật trên ref `prod`
   (cần `vars.ALLOW_CLOUD_WRITES == 'true'`). Kiểm: mở 1 chương, chạm được nội dung,
   bôi đen từ → hộp sửa từ mở/đóng bình thường.

## B. Đưa nhánh lớn vào `dev`

3. Trên `feature/competitor-learnings`: `git pull --rebase` rồi merge `origin/dev` (đã có
   hotfix). Xung đột chắc chắn ở `frontend/src/components/InlineGlossaryModal.jsx` và
   `ReplacementsManagerModal.jsx` → **giữ bản của nhánh feature** (đã tự có
   `if (!isOpen) return null`, viết lại lớn hơn hotfix). Chạy lại toàn bộ test
   (worker, frontend, pytest, eslint + build, smoke, E2E `tests/browser/e2e_engagement.py` 14/14).
4. Push nhánh → PR vào `dev`, CI xanh → merge.

## C. Chuẩn bị Cloudflare (TRƯỚC khi deploy nhánh lớn)

5. Xem ngân sách: `python tools/budget_status.py`. Chọn **ngày không có đợt sync lớn**
   (gói Free 100k dòng ghi D1/ngày; `auto_translate_novels.yml` chạy 2 lần/ngày — nên
   chạy migration ngay sau một lượt cron, hoặc tạm tắt cron trong lúc chạy).
6. Secret lượt đọc thật (≥ 16 ký tự ngẫu nhiên, KHÔNG dùng lại `SYNC_KEY`):
   `npx wrangler secret put VIEW_TOKEN_SECRET`
   (chưa đặt → Worker giữ cách đếm view cũ, không lỗi, nhưng BXH Ngày/Tuần/Tháng không có số liệu thật).
7. Migration D1, **đúng thứ tự, từng lệnh một, xem kết quả rồi mới chạy lệnh sau**:
   1. `npx wrangler d1 execute hacdao-db --file=migrations/013_idx_chapters_created.sql --remote`
      — index `chapters(created_at)` cho `/api/updates`. Header không ghi chi phí một lần:
      CREATE INDEX trên bảng có sẵn ghi ≈ 1 mục/dòng `chapters` (hàng chục nghìn) → đây là
      bước tốn ghi nhất; sau đó mỗi chương mới +1 lượt ghi index. Chạy lại an toàn (IF NOT EXISTS).
   2. `npx wrangler d1 execute hacdao-db --file=migrations/014_novels_chapter_count.sql --remote`
      — cột `novels.chapter_count` + UPDATE vài trăm truyện + CREATE INDEX ~28k mục.
      ALTER không có IF NOT EXISTS: chạy lần 2 báo "duplicate column" ở dòng đầu → chỉ chạy
      lại phần UPDATE/CREATE INDEX trong file. Worker tự dò cột nên chạy trước/sau deploy đều được.
   3. `npx wrangler d1 execute hacdao-db --file=migrations/015_reader_engagement.sql --remote`
      — bảng `novel_views_daily`, `glossary_suggestions`, `user_prefs` (bảng rỗng → vài dòng ghi).
      Chạy lại an toàn.
   4. `npx wrangler d1 execute hacdao-db --file=migrations/016_editions.sql --remote`
      — bảng `editions`, `edition_chapters`, cột `novels.edition_count` (ALTER chỉ sửa schema,
      ~0 dòng ghi). Chạy lần 2 báo "duplicate column" ở lệnh ALTER cuối → bỏ qua.
   Kiểm nhanh: `npx wrangler d1 execute hacdao-db --remote --command "SELECT name FROM sqlite_master WHERE name IN ('idx_chapters_created','novel_views_daily','glossary_suggestions','user_prefs','editions','edition_chapters')"` → đủ 6 tên.
8. (Tuỳ chọn) Tắt API name công khai `/api/novels/:slug/names`: đặt `PUBLIC_NAMES=off`.
   Lưu ý `wrangler deploy` ghi đè biến thường đặt trên Dashboard bằng khối `vars` trong
   `wrangler.jsonc` → hoặc thêm `"PUBLIC_NAMES": "off"` vào `vars` qua PR, hoặc
   `npx wrangler secret put PUBLIC_NAMES` (nhập `off`; secret không bị deploy ghi đè).

## D. Deploy

9. PR `dev` → `prod`, CI xanh → merge.
10. Actions → `Deploy Production` trên ref `prod`: chạy `dry_run=true` trước, xanh thì chạy thật.
    Ghi lại version ID trong log `wrangler deploy` (cần cho rollback).

## E. Kiểm tra sau deploy (mở trình duyệt ẩn danh + 1 tài khoản đọc thử)

11. API (mong đợi 200, JSON hợp lệ):
    - `https://hacdaotruyen.com/api/server-info`, `/api/stats`, `/api/updates`
    - `/api/novels?page=1&sort=chapter_count` (BXH Nhiều Chương, dùng cột 014)
    - `/api/rankings/views?period=day` (và `week`, `month`)
    - `/api/novels/<slug>` (có `edition_count`), `/api/novels/<slug>/editions` (có `he-thong`)
    - `/api/novels/<slug>/replacements`, `/api/novels/<slug>/names` (hoặc tắt nếu `PUBLIC_NAMES=off`)
    - `/api/novels/<slug>/chapters`, `/api/novels/<slug>/chapters/1` (route cũ không đổi)
12. Trang: `/` (Đọc nhiều Ngày/Tuần/Tháng, Vừa đọc gần đây), `/cap-nhat`, `/novel/<slug>`
    (JSON-LD Book trong view-source), `/novel/<slug>/read/1` (chạm được nội dung, hộp sửa từ
    mở/đóng, TTS, cài đặt đọc), `/library`, `/account` (đăng nhập → đọc → tiến độ "N#pM"),
    `/novel/<slug>/read/1?ban=khong-co` (404 → mời đọc bản mặc định, có `noindex`).
13. Admin: `/admin/glossary-suggestions`, `/admin/editions` (bảng rỗng là bình thường khi
    chưa sync bản dịch phụ nào).
14. Lượt đọc thật: đọc 1 chương ≥ 30 giây tới cuối → `POST /api/novels/<slug>/view` trả
    `counted: true`; hôm sau `/api/rankings/views?period=day` có truyện đó.
15. Theo dõi 24 giờ: Cloudflare Dashboard (lỗi 5xx Worker, D1 rows read/written) +
    `python tools/budget_status.py`.

## F. Rollback

16. Code: `npx wrangler deployments list` → `npx wrangler rollback <version-id-trước>` (hoặc
    revert PR trên `prod` rồi chạy lại `deploy_prod.yml`). Rollback Worker gồm cả frontend
    tĩnh của version đó.
17. DB: **không cần rollback** — migration 013–016 chỉ thêm bảng/cột/index; Worker cũ bỏ qua
    chúng. Không DROP gì trên production. (`VIEW_TOKEN_SECRET` để nguyên cũng vô hại.)

## G. Ghi WORKLOG (sau mỗi bước chạm production: secret, migration, deploy, rollback)

18. Thêm 1 dòng vào `.agents/WORKLOG.md`, ví dụ:
    `2026-MM-DD HH:MM | <tên>@<máy> | Deploy feature/competitor-learnings lên prod (version <id>): hotfix modal, VIEW_TOKEN_SECRET, migration 013→014→015→016 --remote, [PUBLIC_NAMES=off] | Đã kiểm mục E 11–14; D1 rows written hôm nay ≈ <số> (budget_status) | Rollback: wrangler rollback <id-trước>`
