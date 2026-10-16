# Việc cho Antigravity (máy Windows DESKTOP-BDSL142) — sửa metadata ~28.500 truyện EPUB trên D1

> Chạy tại thư mục gốc repo HacDaoTruyen, lệnh viết cho **cmd** (không dùng
> PowerShell cho bước `>` ghi file; nếu buộc dùng PowerShell thì tool vẫn đọc được
> file UTF-16 nhưng cmd an toàn hơn). Đường dẫn dùng `\`.
> Việc này **GHI PRODUCTION (D1)** → làm đúng thứ tự, dừng ở bước 4 chờ người
> dùng duyệt, mỗi lượt apply ghi 1 dòng WORKLOG.

## Bối cảnh (đọc để hiểu vì sao)

- ~28.500 truyện import từ kho audiotruyenfull lên bảng `novels` có:
  `title` = slug không dấu, `author` rỗng/`Unknown`, `genre` =
  `"Tiên Hiệp, Huyền Huyễn, Đô Thị"` cho MỌI truyện (bug `fetch_genres` trong
  `tools/download_epubs.py` lấy cả link menu `/the-loai/`), synopsis còn dòng
  `Epub tạo bởi: audiotruyenfull.org` + khối "Tác giả / Thể loại / Trạng thái".
- Tên/tác giả thật nằm trong OPF (`dc:title`, `dc:creator`) của từng EPUB ở
  `D:\epub_library\epubs`; thể loại + giới thiệu nằm ở trang `info.xhtml` trong EPUB.
- Worker `syncNovelBatch` ON CONFLICT chỉ cập nhật `total_chapters` → sync lại
  KHÔNG sửa được. Dùng tool mới `tools\fix_epub_metadata.py`: sinh câu
  `UPDATE … WHERE slug=… AND <cột> IS <giá trị cũ>` (chạy lại = không làm gì,
  không đè chỗ người khác vừa sửa tay) + file `rollback_*.sql` khôi phục giá trị cũ.
- Tool **không bao giờ đụng**: slug có thư mục trong `novels\` của repo (truyện
  đang dịch: Sớm Đăng Lục, Lãnh Chúa Cầu Sinh, …) và truyện có `source_url`.
  Title chỉ đổi khi title hiện tại trống/toàn không dấu VÀ tên OPF bỏ dấu khớp
  title cũ hoặc ≈ slug; lệch thì vào mục "cần duyệt tay" trong `report.json`.
- Gốc lỗi đã sửa trong code (`epub_to_chapters.py` trả title/author/subjects từ
  OPF, `batch_epub_processor.py` dùng chúng, `download_epubs.py` chỉ lấy thể loại
  trong vùng thông tin truyện) → các lần import sau không lặp lại lỗi.

## Bước 1 — Đồng bộ repo, đọc quy tắc, chạy test

```cmd
git pull --rebase
python -m pytest -q tests\test_fix_epub_metadata.py test_epub_to_chapters.py
```

- Đọc `.agents\AGENTS.md` mục "Phối hợp nhiều agent" và ~20 dòng cuối `.agents\WORKLOG.md`.
- Test phải xanh. Nếu đỏ: dừng, ghi WORKLOG, báo người dùng.

## Bước 2 — Lấy trạng thái hiện tại D1 (CHỈ ĐỌC)

```cmd
mkdir out\fix_meta 2>nul
npx wrangler d1 execute hacdao-db --remote --json --command "SELECT slug,title,author,genre,source_url,synopsis FROM novels" > out\current.json
```

- Lệnh này chỉ SELECT (~28.500 dòng đọc, không tốn dòng ghi).
- Tương đương: thêm `--fetch-current` thay cho `--current-json out\current.json` ở bước 3.

## Bước 3 — Dry-run (mặc định, KHÔNG ghi cloud)

```cmd
python tools\fix_epub_metadata.py ^
  --epub-dir D:\epub_library\epubs ^
  --meta-dir D:\epub_library\meta ^
  --catalog D:\epub_library\catalog_full.jsonl ^
  --current-json out\current.json ^
  --out-sql out\fix_meta ^
  --fix-synopsis
```

Kết quả trong `out\fix_meta\`:
- `update_0001.sql …` (500 câu/lô, đổi bằng `--batch-size`), `rollback_0001.sql …` cùng lô.
- `report.csv` (slug, field, old, new, reason — mở bằng Excel được) và
  `report.json` (thống kê, danh sách bỏ qua + lý do, danh sách "cần duyệt tay").
- Màn hình in thống kê + 20 dòng mẫu + ước tính số dòng ghi D1.

## Bước 4 — GỬI NGƯỜI DÙNG DUYỆT (bắt buộc, dừng ở đây chờ trả lời)

Gửi cho người dùng:
1. Phần thống kê in ra (số cần UPDATE theo cột, số bỏ qua theo lý do, số cần duyệt tay).
2. **20 dòng mẫu** (màn hình in sẵn; hoặc lấy 20 dòng đầu `report.csv`).
3. 5 mục đầu của `"review"` trong `report.json`.
4. Ước tính dòng ghi D1 và số ngày cần chạy (bước 6).

Chỉ sang bước 5 khi người dùng trả lời đồng ý. Nếu người dùng muốn đổi luật
(vd thể loại mặc định khác `Khác` → `--unknown-genre`), sửa tham số rồi chạy lại bước 3.

## Bước 5 — Xem ngân sách

```cmd
python tools\budget_status.py
```

- Mỗi UPDATE được tính **2 dòng ghi D1** (thực tế ~1 — các cột đổi không có
  index; tính dư để an toàn). ~28.500 truyện ≈ 57.000 dòng ước tính.
- Cầu chì repo hiện `HACDAO_D1_WRITE_BUDGET` = 6000/ngày **dùng chung với CI**
  (auto-translate, publish). Mặc định mỗi lượt chạy tối đa 2500 dòng → ~1 lượt/ngày,
  ~23 ngày. Muốn nhanh hơn phải HỎI người dùng nâng cầu chì (không tự `gh variable set`).
- Tool tự dừng nếu số liệu THẬT Cloudflare sắp chạm 80% gói Free (100.000 dòng ghi/ngày).

## Bước 6 — Apply theo ngày (mỗi ngày 1 lượt)

```cmd
git pull --rebase
set HACDAO_ALLOW_CLOUD_WRITES=true
set HACDAO_D1_WRITE_BUDGET=6000
set HACDAO_R2_WRITE_BUDGET=0
set HACDAO_MAX_OPS_PER_RUN=2500
python tools\fix_epub_metadata.py --out-sql out\fix_meta --apply --max-rows-per-run 2500
set HACDAO_ALLOW_CLOUD_WRITES=
```

- Giá trị `HACDAO_*` lấy theo `gh variable list` (người dùng đã duyệt); không tự nâng.
- Thiếu `HACDAO_ALLOW_CLOUD_WRITES=true` → tool từ chối, không gửi gì.
- Mỗi file chạy bằng `npx wrangler d1 execute hacdao-db --remote --yes --json --file …`;
  ngân sách được trừ TRƯỚC khi gửi vào `tools\.cloud_sync_budget.json` (cùng bộ đếm
  với các script sync khác, qua `tools/sync_budget.py`).
- Tiến độ lưu ở `tools\.fix_epub_metadata_state.json` (theo sha256 từng file).
  Hôm sau chạy lại ĐÚNG lệnh trên là tự chạy tiếp các lô còn lại. Đừng xoá
  `out\fix_meta` giữa chừng; nếu sinh lại SQL (bước 3) thì lô đã chạy vẫn an toàn
  vì câu UPDATE có điều kiện giá trị cũ.
- Tool in "Dừng: chạm --max-rows-per-run …" là bình thường (hết hạn mức hôm nay).
  "wrangler lỗi …" → dừng, KHÔNG chạy lại liên tục, ghi WORKLOG và báo người dùng.
- Sau lượt apply: commit bộ đếm ngân sách để CI thấy (KHÔNG commit `out\`):

```cmd
git add tools\.cloud_sync_budget.json .agents\WORKLOG.md
git commit -m "chore: fix_epub_metadata lượt <ngày> (+ bộ đếm ngân sách D1)"
git pull --rebase
git push
```

## Bước 7 — Ghi WORKLOG mỗi lượt (bắt buộc)

Thêm 1 dòng cuối `.agents\WORKLOG.md`, ví dụ:

```
2026-10-17 21:00 | antigravity@DESKTOP-BDSL142 | fix_epub_metadata lượt 1: update_0001–0002 (~2.000 dòng ghi D1 ước tính) | còn 55 lô; mai chạy tiếp
```

## Bước 8 — Kiểm tra sau mỗi lượt

```cmd
npx wrangler d1 execute hacdao-db --remote --command "SELECT slug,title,author,genre FROM novels WHERE slug IN (SELECT slug FROM novels ORDER BY random() LIMIT 5)"
```

Mở 2–3 truyện vừa sửa trên web xem tên/tác giả/thể loại hiển thị đúng dấu.

## Hoàn tác (rollback)

- Mỗi `update_NNNN.sql` có `rollback_NNNN.sql` khôi phục đúng giá trị cũ (chỉ
  áp dụng cho dòng vẫn đang mang giá trị mới — không đè chỗ đã sửa tay sau đó).
- Hoàn tác toàn bộ những lô đã chạy (cùng cầu chì ngân sách):

```cmd
set HACDAO_ALLOW_CLOUD_WRITES=true
python tools\fix_epub_metadata.py --out-sql out\fix_meta --apply --rollback --max-rows-per-run 2500
```

- Hoàn tác 1 lô cụ thể: `npx wrangler d1 execute hacdao-db --remote --yes --file out\fix_meta\rollback_0003.sql`
  (tự cộng số dòng vào bộ đếm ngân sách và ghi WORKLOG).
- GIỮ thư mục `out\fix_meta` (hoặc nén lại) đến khi người dùng xác nhận xong
  toàn bộ — đó là bản sao lưu giá trị cũ duy nhất.

## Không được làm

- Không sửa tay `update_*.sql` để "ép" cập nhật truyện bị bỏ qua/cần duyệt tay — báo người dùng.
- Không chạy apply khi chưa qua bước 4. Không chạy nhiều lượt/ngày vượt cầu chì.
- Không chạy `tools\import_epub_library.py` lại để "sửa" — nó ghi đè title/genre bằng dữ liệu meta cũ.
