# Bàn giao thực thi — Plan 01: EPUB Quick Overview

> Nhánh làm việc: `exec/epub-quick-overview-01` (tách từ `main` tại commit `9cd3971`)
> Ngày thực thi thử trong sandbox: 2026-08-01

## Vì sao có file này

Code của plan 01 đã có sẵn trên `main` (đã merge), nhưng **chưa từng được chạy thật**.
Khi thực thi thử trong sandbox, phát hiện 1 bug chặn hoàn toàn tính năng và đã sửa.
Sandbox không có Cloudflare API token nên không thể chạy các bước chạm production thật
(D1 remote, R2, deploy) — dưới đây là đúng bộ lệnh để bạn tự chạy trên máy có
credentials thật, theo thứ tự, kèm lệnh rollback cho từng bước.

## Trước khi bắt đầu

```bash
git fetch
git checkout exec/epub-quick-overview-01   # đã có sẵn fix bug + demo, hoặc merge vào main trước:
# git checkout main && git merge exec/epub-quick-overview-01
```

Rollback toàn bộ nhánh này (nếu chưa merge vào main): main không hề bị đụng, chỉ cần
`git checkout main` là xong, không cần làm gì thêm.

## Bước 0 — Dọn 4 file rác do sandbox không xoá được (an toàn, không phải bug code)

Sandbox có giới hạn quyền xoá file trên thư mục mount, để lại rác không được commit:

```bash
rm -rf novels/_demo_verify_slug novels/_verify_synopsis_demo
rm -f frontend/vite.config.js.timestamp-*.mjs
```

## Bước 1 — Cài dependency

```bash
pip install -r requirements.txt      # đã thêm ebooklib
python -c "import ebooklib; print('OK')"
```

Rollback: `pip uninstall ebooklib -y`

## Bước 2 — D1 migration (chạy 1 lần, đã verify an toàn qua SQLite mô phỏng)

```bash
npx wrangler d1 execute hacdao-db --command="ALTER TABLE novels ADD COLUMN synopsis TEXT DEFAULT ''" --remote
```

Đã test: nếu lỡ chạy 2 lần sẽ báo lỗi `duplicate column name: synopsis` — bỏ qua an
toàn, không có tác dụng phụ. Migration chỉ thêm cột mới với giá trị mặc định rỗng,
không đụng dữ liệu cũ.

Rollback: không cần thiết (cột mới không ảnh hưởng chức năng cũ). Nếu bắt buộc phải
gỡ: SQLite/D1 không hỗ trợ `DROP COLUMN` trực tiếp dễ dàng, phải tạo bảng mới không
có cột này rồi copy dữ liệu — khuyến nghị **không rollback bước này** trừ khi thật sự
cần, rủi ro cao hơn lợi ích.

## Bước 3 — Trích synopsis cho từng truyện có file `book.epub`

```bash
python tools/epub_to_chapters.py --slug <slug> --synopsis-only --dry-run   # xem trước
python tools/epub_to_chapters.py --slug <slug> --synopsis-only             # chạy thật
```

Lưu ý đã verify trong sandbox: nếu EPUB không có mục giới thiệu/synopsis rõ ràng,
script in `[WARN] Không tìm thấy synopsis` và **không tạo file** — đây là hành vi
đúng (không bịa dữ liệu), không phải lỗi. Batch cho nhiều truyện:

```bash
for slug in $(ls novels/); do
  python tools/epub_to_chapters.py --slug "$slug" --synopsis-only
done
```

Rollback: xoá `novels/<slug>/synopsis.md` vừa tạo — không ảnh hưởng gì khác.

## Bước 4 (tuỳ chọn) — Tách chapters từ EPUB

```bash
python tools/epub_to_chapters.py --slug <slug> --chapters-only --dry-run
python tools/epub_to_chapters.py --slug <slug> --chapters-only
```

Mặc định ghi vào `novels/<slug>/translated/` nhưng **bỏ qua file đã tồn tại** (an
toàn với chapters đã dịch từ pipeline chính) — chỉ dùng `--overwrite` nếu chắc chắn
muốn ghi đè. Muốn so sánh trước, dùng `--out-dir` riêng như đã demo:

```bash
python tools/epub_to_chapters.py --slug <slug> --chapters-only --out-dir /tmp/<slug>_demo
```

Rollback: xoá các file `.md` mới tạo trong `translated/` (dùng `git status` để biết
file nào mới, `git checkout -- ...` nếu đã lỡ commit).

## Bước 5 — Sync synopsis lên D1 + R2

> Bug đã sửa trong nhánh này: `migrate_synopsis()` trước đó dùng
> `f"{'✅' if ok ...}"` — cú pháp này **gây SyntaxError trên Python 3.10/3.11**
> (chỉ hợp lệ từ Python 3.12+). CI của repo dùng Python 3.11 nên **tính năng
> `--synopsis` sẽ crash ngay khi gọi**, chưa từng chạy được. Đã sửa bằng cách tách
> biến `ok_icon` ra khỏi f-string. Đã verify dry-run chạy sạch sau khi sửa.

```bash
python migrate_to_cloudflare.py --slug <slug> --synopsis --dry-run   # xem trước, an toàn 100%
python migrate_to_cloudflare.py --slug <slug> --synopsis             # chạy thật
# hoặc cho tất cả truyện đã có synopsis.md:
python migrate_to_cloudflare.py --synopsis
```

Rollback:
```bash
echo "UPDATE novels SET synopsis = '' WHERE slug = '<slug>';" > /tmp/rb.sql
npx wrangler d1 execute hacdao-db --remote --file=/tmp/rb.sql
npx wrangler r2 object delete hacdao-chapters/<slug>/synopsis.md --remote
```

## Bước 6 — Build frontend (đã verify build sạch trong sandbox, SynopsisPanel có trong bundle)

```bash
cd frontend && npm install && npm run build
```

Rollback: `git checkout <commit-trước> -- frontend/src && npm run build` rồi deploy lại.

## Bước 7 — Deploy (bước DUY NHẤT chạm thẳng production)

```bash
npm run deploy       # = npm run build:frontend && wrangler deploy
```

Khuyến nghị: deploy giờ thấp điểm, theo dõi log ngay sau khi deploy
(`npx wrangler tail`).

Rollback tức thời (Cloudflare giữ lịch sử deploy, không cần build lại):
```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

## Sau khi xác nhận ổn định trên production

```bash
git checkout main
git merge exec/epub-quick-overview-01
git push
```

Nếu muốn review trước khi merge: mở Pull Request từ nhánh `exec/epub-quick-overview-01`
thay vì merge thẳng.
