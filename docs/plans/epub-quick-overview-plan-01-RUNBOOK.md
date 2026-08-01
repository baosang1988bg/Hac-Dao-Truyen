# Runbook thực thi — Plan 01: EPUB Quick Overview + Chapter Splitter

> Dùng file này làm checklist duy nhất khi chạy trên máy thật. Kèm 2 file liên quan:
> - `docs/plans/epub-quick-overview-plan-01-ban-giao.md` — giải thích chi tiết + rollback từng bước
> - `tools/run_epub_synopsis_rollout.sh` — script tự động hoá cho 1 hoặc nhiều truyện

## 1. Trình tự đã thực thi trong phiên làm việc (đã commit vào `main`)

```
4f7c96a fix(tools): script rollout tự phát hiện python3/pip3 thay vì python (macOS không có alias python)
809eb1b docs: báo cáo, bàn giao và script rollout plan 01
14e96c8 fix(migrate): sửa lỗi SyntaxError f-string backslash trong migrate_synopsis (Python <3.12); thêm ebooklib vào requirements.txt; kèm demo chapters đã tách từ book.epub (than-dao-de-ton)
9cd3971 docs(plans): add epub-quick-overview-plan-01 and get-md-plan-01 quick-access
```

Tất cả nằm trên `main`, đã merge từ nhánh `exec/epub-quick-overview-01`. Không còn gì
cần commit thêm — `git status` chỉ còn 2 file rác không liên quan (1 file
`AgentReach/*.md` có từ trước, 1 file tạm `.timestamp-*.mjs` do Vite sinh ra, xoá
bằng `rm -f frontend/vite.config.js.timestamp-*.mjs` nếu còn sót).

Đã verify trong phiên: bug f-string chặn tính năng `--synopsis` (đã sửa), migration
SQL an toàn (test qua SQLite mô phỏng D1), pipeline trích synopsis/chapters chạy
đúng và an toàn (không bịa dữ liệu, không đè file đã dịch), frontend build sạch có
SynopsisPanel trong bundle, backend không vỡ (FastAPI TestClient 200 OK). Chưa verify
được: chạy thật D1 remote / R2 / deploy (sandbox sai nền tảng binary + không có
Cloudflare token).

## 2. Điều kiện tiên quyết trên máy thật (kiểm tra 1 lần trước khi chạy)

```bash
cd /Users/sangpls/Documents/AI00/HacDaoTruyen
git status                 # phải sạch, đang ở main
python3 --version           # cần Python 3.10+
node --version               # cần Node đã cài (đi kèm project)
npx wrangler whoami          # PHẢI thấy email/account thật, không lỗi
```

Nếu `wrangler whoami` báo chưa đăng nhập: `npx wrangler login`, xác nhận trên trình
duyệt, chạy lại `whoami` cho tới khi thấy tài khoản thật.

## 3. Chạy cho 1 truyện (kiểm tra trước khi làm hàng loạt)

```bash
chmod +x tools/run_epub_synopsis_rollout.sh
./tools/run_epub_synopsis_rollout.sh than-dao-de-ton
```

Trả lời `n` ở câu hỏi deploy cuối để dừng lại kiểm tra trước.

**Xác nhận từng bước đã "thực thi thành công" (không chỉ chạy xong mà không lỗi):**

| Bước | Lệnh kiểm tra | Kết quả mong đợi |
|---|---|---|
| Deps | `python3 -c "import ebooklib"` | Không lỗi |
| D1 migration | `npx wrangler d1 execute hacdao-db --command="PRAGMA table_info(novels)" --remote` | Thấy cột `synopsis` trong danh sách |
| Trích synopsis | `cat novels/<slug>/synopsis.md` | Có nội dung tiếng Việt hợp lý (nếu EPUB có trang giới thiệu) |
| Sync D1/R2 | `npx wrangler d1 execute hacdao-db --command="SELECT slug, synopsis FROM novels WHERE slug='<slug>'" --remote` | Thấy đúng nội dung đã sync |
| Build | `ls frontend/dist/assets/*.js` | Có file mới, timestamp vừa build |
| Deploy | `curl https://<domain>/api/novels/<slug>/synopsis` | Trả JSON có `synopsis` và `source` |

Chỉ đánh dấu bước "xong" khi bảng trên khớp — không suy đoán từ việc lệnh không báo lỗi.

## 4. Lệnh chạy hàng loạt (batch) cho tất cả truyện

### 4a. Chỉ những truyện đã có sẵn `book.epub`

```bash
SLUGS=$(for d in novels/*/; do
  slug=$(basename "$d")
  [ -f "novels/$slug/book.epub" ] && echo "$slug"
done)
echo "Sẽ chạy cho: $SLUGS"
./tools/run_epub_synopsis_rollout.sh $SLUGS
```

### 4b. Batch thủ công từng lệnh (nếu muốn kiểm soát từng bước thay vì chạy script)

```bash
# 1) Trích synopsis cho tất cả truyện có epub
for slug in $(ls novels/); do
  [ -f "novels/$slug/book.epub" ] || continue
  echo "== $slug =="
  python3 tools/epub_to_chapters.py --slug "$slug" --synopsis-only --dry-run
  python3 tools/epub_to_chapters.py --slug "$slug" --synopsis-only
done

# 2) Kiểm tra tổng số synopsis.md tạo được
find novels -iname "synopsis.md"

# 3) Sync toàn bộ 1 lần (script tự quét thư mục có synopsis.md)
python3 migrate_to_cloudflare.py --synopsis --dry-run   # xem trước
python3 migrate_to_cloudflare.py --synopsis              # chạy thật

# 4) Build + deploy 1 lần cho toàn bộ
npm run deploy
```

### 4c. Xác nhận hàng loạt đã thành công

```bash
# Đếm số truyện đã có synopsis trên D1
npx wrangler d1 execute hacdao-db --command="SELECT slug FROM novels WHERE synopsis != ''" --remote
```

Số dòng trả về phải khớp với số `synopsis.md` tìm được ở bước 4b.2. Nếu thiếu, xem
lại log của truyện đó — nhiều khả năng EPUB không có trang giới thiệu (không phải lỗi,
script tự bỏ qua an toàn).

## 5. Nếu 8 truyện còn lại chưa có `book.epub`

Copy file EPUB vào đúng vị trí trước khi chạy Bước 3/4:

```bash
cp /đường/dẫn/tới/<ten-file>.epub novels/<slug>/book.epub
```

## 6. Rollback nhanh (chi tiết đầy đủ trong file ban-giao)

```bash
# Huỷ 1 lần sync synopsis của 1 truyện
echo "UPDATE novels SET synopsis = '' WHERE slug = '<slug>';" > /tmp/rb.sql
npx wrangler d1 execute hacdao-db --remote --file=/tmp/rb.sql
npx wrangler r2 object delete hacdao-chapters/<slug>/synopsis.md --remote

# Rollback deploy về bản trước
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

## 7. Báo cáo lại

Sau khi chạy xong (1 truyện hoặc hàng loạt), gửi lại output của bảng kiểm tra ở mục 3
và mục 4c để cập nhật bảng chấm điểm trong `BAO_CAO_EPUB_SYNOPSIS.md`.
