# Việc cho Antigravity (máy Windows DESKTOP-BDSL142) — đồng bộ với Claude Code

> Người dùng yêu cầu Antigravity **tự làm theo file này từ đầu đến cuối**, không
> cần hỏi lại. Chạy tại thư mục gốc repo HacDaoTruyen. Lệnh viết cho Windows
> (PowerShell/cmd); đường dẫn dùng `\`.

## Bối cảnh (đọc để hiểu vì sao)

- Repo được sửa song song bởi Claude Code (macOS) và Antigravity (Windows) +
  GitHub Actions. Ngày 2026-10-11, việc chạy `migrate_to_cloudflare.py` và
  `wrangler deploy` từ máy local đã **đè mục lục truyện Sớm Đăng Lục trên R2**
  (mất tên chương, chương ảo 404). Đã sửa và thêm quy tắc phối hợp.
- Quy tắc chung ở `.agents/AGENTS.md`, mục **"Phối hợp nhiều agent"** (đọc kỹ
  quy tắc 1–9). Nhật ký chung: `.agents/WORKLOG.md`.

## Bước 1 — Đồng bộ repo và đọc quy tắc

```cmd
git pull --rebase
```

- Đọc `.agents/AGENTS.md` mục "Phối hợp nhiều agent".
- Đọc ~20 dòng cuối `.agents/WORKLOG.md`.
- Nếu `git pull` báo có thay đổi local chưa commit: KHÔNG xoá; `git stash`,
  pull, rồi `git stash pop`, xử lý conflict nếu có.

## Bước 2 — Cài công cụ private (sao lưu + giải mã MTC)

Công cụ MTC KHÔNG còn nằm trong repo chính (repo chính public). Chúng ở repo
PRIVATE `baosang1988bg/hacdao-private-tools`, clone vào `tools\private\`
(đã được `.gitignore` của repo chính bỏ qua):

```cmd
gh auth status
gh repo clone baosang1988bg/hacdao-private-tools tools\private
pip install -r tools\private\requirements.txt
```

- `gh auth status` phải đăng nhập tài khoản `baosang1988bg`. Nếu chưa: `gh auth login`.
- Nếu `tools\private` đã tồn tại: `git -C tools\private pull --rebase` thay cho clone.
- Nếu trong repo chính còn file cũ `tools\backup_mtc_api.py`,
  `tools\decrypt_mtc_backup.py`, `tests\test_backup_mtc_api.py`,
  `tests\test_decrypt_mtc_backup.py` (bản chưa commit trên máy này): so với bản
  trong `tools\private\`; nếu máy này có sửa đổi mới hơn thì đưa sửa đổi đó vào
  `tools\private` (commit + push trong repo private), rồi xoá bản cũ khỏi repo chính.

## Bước 3 — Kiểm tra

```cmd
cd tools\private
python -m pytest -q
cd ..\..
python -m pytest -q
```

Cả hai phải pass (repo private: 6 test). Cách dùng tool: `tools\private\README.md`, ví dụ:

```cmd
python tools\private\decrypt_mtc_backup.py backups\mtc-api\<slug> --book-id <id>
```

## Bước 3b — Đưa bản dịch 1711–1714 (Sớm Đăng Lục) lên repo

Máy này đã dịch chương 1711–1714 nhưng KHÔNG commit thư mục `translated/`
(bị `.gitignore` chặn, phải `git add -f`). Trên web vẫn đọc được, nhưng repo
thiếu file nên CI không đẩy lại được khi cần.

```cmd
git add -f "novels\som-dang-luc-the-gioi-tro-choi-bat-dau-thong-gia-nu-de\translated"
git status --short
git commit -m "chore: thêm bản dịch 1711-1714 Sớm Đăng Lục (dịch local trên Antigravity)"
git pull --rebase
git push
```

- `git status --short` chỉ nên có các file `Chương 1711…1714 …_VI.md` (và có thể
  chương mới hơn nếu đã dịch thêm). KHÔNG thêm file ngoài thư mục đó.
- Nếu không còn file nào (đã xoá) thì ghi vào WORKLOG là thiếu, Claude Code sẽ dịch lại qua CI.

## Bước 4 — Quy tắc làm việc từ giờ (tóm tắt, chi tiết ở AGENTS.md)

1. Đầu phiên: `git pull --rebase` + đọc cuối `.agents/WORKLOG.md`.
2. Chương mới: ưu tiên `gh workflow run auto_translate_novels.yml` (CI tự dịch,
   sync, commit) thay vì chạy local. Chỉ chạy 1 workflow nhóm cloud-sync mỗi lần.
3. **KHÔNG** `wrangler deploy` sau khi cập nhật chương (chương là dữ liệu D1/R2).
   Chỉ deploy khi đổi code, từ `main` sạch: `npm run deploy`.
4. **KHÔNG** tự đẩy `novels\<slug>\catalog.json` lên R2 (migrate đã tự chặn).
5. Chạy dịch local (khi người dùng yêu cầu) → `git add -f novels\<slug>\translated`
   + commit + `git pull --rebase` + push ngay.
6. Mọi việc chạm production → thêm 1 dòng vào `.agents/WORKLOG.md`.

## Bước 5 — Báo cáo

Thêm vào cuối `.agents/WORKLOG.md` một dòng dạng:

```
2026-10-1x HH:MM | antigravity@DESKTOP-BDSL142 | Đã làm .agents/tasks/2026-10-11-antigravity-dong-bo.md: clone tools\private, test pass | không chạm production
```

rồi:

```cmd
git add .agents\WORKLOG.md
git commit -m "docs(worklog): Antigravity đã đồng bộ theo task 2026-10-11"
git pull --rebase
git push
```

Báo lại người dùng kết quả từng bước (bước nào lỗi thì ghi rõ lỗi, không tự
"sửa" bằng cách bỏ qua quy tắc).
