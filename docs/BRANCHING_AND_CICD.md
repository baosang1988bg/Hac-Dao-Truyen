# Kiến trúc nhánh & CI/CD (HacDaoTruyen)

## 1. Mô hình nhánh

- **`prod`** *(Production)*:
  - Nhánh chứa mã nguồn & dữ liệu đang chạy thực tế trên Cloudflare Workers (`hacdaotruyen.com`).
  - Không commit/push trực tiếp lên `prod`. Mọi thay đổi code đi qua PR từ `dev` → `prod` sau khi CI xanh.
  - Các cron tự động (`auto_translate_novels.yml`, `schema_drift_check.yml`, `fetch_rankings.yml`) chạy trên nhánh mặc định của GitHub (`prod`) và tự commit dữ liệu chương mới (`novels/`, `announcements.json`, `.cloud_sync_budget.json`) về `prod`.
- **`dev`** *(Development / Integration)*:
  - Nhánh tích hợp chính. Mọi nhánh `feature/*`, `fix/*`, `chore/*` sau khi hoàn thành sẽ merge về `dev` (qua PR hoặc merge sạch sau khi pass lint/test/build).
  - Sau khi kiểm thử ổn định trên `dev`, mở PR từ `dev` → `prod`.
- **`feature/*`, `fix/*`, `chore/*`**:
  - Nhánh phát triển ngắn hạn rẽ từ `dev` (hoặc `prod` nếu hotfix khẩn cấp, rồi merge lại cả `prod` và `dev`).

## 2. Kiến trúc CI/CD

### Continuous Integration (`.github/workflows/ci.yml`)
- **Trigger**: `push` vào `prod` hoặc `dev`, và `pull_request` nhắm vào `prod` hoặc `dev`.
- **Runner**: `ubuntu-latest` (Python 3.11 + Node 22).
- **3 Jobs song song**:
  1. `backend`: cài `requirements-dev.lock`, chạy `python -m pytest -q`, kiểm tra không theo dõi file secret.
  2. `worker`: `npm ci`, `node --check src/index.js`, `npm run test:worker` (Miniflare + D1/R2 local).
  3. `frontend`: `npm ci --prefix frontend`, `npm run lint`, `npm run build --prefix frontend`, chạy Playwright smoke test (`tests/browser/smoke.py`).

### Continuous Deployment (`.github/workflows/deploy_prod.yml`)
- **Trigger**: `workflow_dispatch` (chạy thủ công trên GitHub Actions, **chỉ chạy khi ref là `refs/heads/prod`** và `vars.ALLOW_CLOUD_WRITES == 'true'`).
- **Lý do tách khỏi `ci.yml`**:
  - `auto_translate_novels.yml` commit dữ liệu chương mới mỗi ngày 2 lần; dữ liệu chương nằm trên D1/R2 nên không cần deploy lại Worker.
  - Một số đợt nâng cấp cần chạy D1 migration (`wrangler d1 execute ... --remote`) **trước** khi `wrangler deploy`.
- **Pipeline**: `npm ci` → `npm run lint` → `npm run build --prefix frontend` → `npx wrangler deploy`.

## 3. Cấu hình trên GitHub & Cloudflare Dashboard (chỉ cần làm 1 lần)

1. **GitHub → Settings → Branches**:
   - Đổi **Default branch** từ `main` sang `prod`.
   - (Khuyến nghị) Bật **Branch protection rules** cho `prod` (yêu cầu PR + pass CI `backend`, `worker`, `frontend` trước khi merge; cho phép GitHub Actions bot commit dữ liệu `auto_translate_novels.yml`).
2. **GitHub → Settings → Environments**:
   - Tạo environment `production` (nếu chưa có) để bảo vệ `deploy_prod.yml`.
3. **Cloudflare Dashboard → Workers & Pages → `hac-dao-truyen` → Settings → Build**:
   - Nếu đang bật Cloudflare Workers Builds (Git integration), đổi **Production branch** từ `main` sang `prod`.
