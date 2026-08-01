#!/usr/bin/env bash
# run_epub_synopsis_rollout.sh
# Chạy TRÊN MÁY THẬT (có Cloudflare login), KHÔNG chạy trong sandbox.
# Thực thi đúng thứ tự Bước 1-7 của plan 01, dừng ngay nếu bước nào lỗi.
# Xem chi tiết + lệnh rollback từng bước tại:
#   docs/plans/epub-quick-overview-plan-01-ban-giao.md
#
# Cách dùng:
#   chmod +x tools/run_epub_synopsis_rollout.sh
#   ./tools/run_epub_synopsis_rollout.sh <slug1> [slug2] [...]
#
# Ví dụ:
#   ./tools/run_epub_synopsis_rollout.sh than-dao-de-ton xich-tam-tuan-thien

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Dùng: $0 <slug1> [slug2] ..."
  echo "  (mỗi slug phải có sẵn novels/<slug>/book.epub)"
  exit 1
fi

echo "=== [0/7] Kiểm tra đang ở nhánh exec/epub-quick-overview-01 ==="
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "exec/epub-quick-overview-01" ]; then
  echo "  [WARN] Đang ở nhánh '$BRANCH', không phải exec/epub-quick-overview-01."
  read -p "  Tiếp tục vẫn chạy trên nhánh này? (y/N) " ans
  [ "$ans" = "y" ] || exit 1
fi

echo "=== [1/7] Cài dependency ==="
pip install -r requirements.txt
python -c "import ebooklib; print('  OK: ebooklib sẵn sàng')"

echo "=== [2/7] D1 migration (thêm cột synopsis, an toàn nếu đã tồn tại) ==="
npx wrangler d1 execute hacdao-db --command="ALTER TABLE novels ADD COLUMN synopsis TEXT DEFAULT ''" --remote \
  || echo "  [INFO] Nếu lỗi 'duplicate column' -> bỏ qua an toàn, đã có cột rồi."

for slug in "$@"; do
  echo "=== [3/7] Trích synopsis: $slug ==="
  if [ ! -f "novels/$slug/book.epub" ]; then
    echo "  [SKIP] Không có novels/$slug/book.epub"
    continue
  fi
  python tools/epub_to_chapters.py --slug "$slug" --synopsis-only --dry-run
  python tools/epub_to_chapters.py --slug "$slug" --synopsis-only

  echo "=== [5/7] Sync synopsis lên D1 + R2: $slug (bỏ qua nếu không có synopsis.md) ==="
  if [ -f "novels/$slug/synopsis.md" ]; then
    python migrate_to_cloudflare.py --slug "$slug" --synopsis --dry-run
    python migrate_to_cloudflare.py --slug "$slug" --synopsis
  else
    echo "  [SKIP] $slug không có synopsis.md (EPUB không có mục giới thiệu)."
  fi
done

echo "=== [6/7] Build frontend ==="
(cd frontend && npm install && npm run build)

echo "=== [7/7] Deploy — bước DUY NHẤT chạm production, xác nhận trước khi tiếp tục ==="
read -p "Deploy lên production ngay bây giờ? (y/N) " confirm
if [ "$confirm" = "y" ]; then
  npm run deploy
  echo "  Rollback nếu cần: npx wrangler deployments list && npx wrangler rollback <id>"
else
  echo "  Đã bỏ qua deploy. Chạy 'npm run deploy' thủ công khi sẵn sàng."
fi

echo "=== XONG. Kiểm tra lại: curl https://<domain>/api/novels/<slug>/synopsis ==="
