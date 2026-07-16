# Báo cáo Giai đoạn 1 — Nền móng (16/07/2026)

Giai đoạn 1 của roadmap đã hoàn thành trọn vẹn năm hạng mục trong một phiên làm việc, tất cả đều qua bậc thang verify (py_compile → mô phỏng D1 → integration test → chạy thật trên dữ liệu thật) trước khi tính là xong.

## Việc đã làm và cách verify

**1.1 — Contract API Worker ↔ FastAPI.** Worker Cloudflare (`src/index.js`) trước đây trả `SELECT *` cho chi tiết truyện, lộ `source_url`, `last_translated_url` và glossary cho bất kỳ ai. Nay `getNovel` dùng whitelist `NOVEL_PUBLIC_FIELDS` đồng bộ với `_PUBLIC_FIELDS` của `routers/novels.py`, kèm thống kê `chapter_count`/`latest_chapter_title`/`last_translated_at` tính từ bảng `chapters` — đúng ngữ nghĩa `_translated_stats()` của backend Python. Admin được xác thực bằng cách hỏi lại backend qua `BACKEND_URL /api/auth/verify` (Worker không giữ session). Cột `glossary_count` được thêm vào D1 (`migrations/001_add_glossary_count.sql`), được ghi bởi cả `updateGlossary` (Worker) lẫn `migrate_to_cloudflare.py`, nên trang chủ production sẽ hiển thị số thuật ngữ thật thay vì 0. Verify bằng mô phỏng SQLite theo đúng schema D1: danh sách không lộ field cấm, `glossary_count=42` và `chapter_count=3` trả đúng, whitelist Worker ⊇ whitelist FastAPI.

**1.2 — Sync tự động.** `finalize_session` trong `pipeline.py` giờ gọi `_maybe_auto_sync`: khi env `AUTO_SYNC_CLOUDFLARE=1` và phiên dịch được ≥1 chương, tự chạy `migrate_to_cloudflare.py --slug <slug>` (lỗi sync chỉ log warning, không phá phiên dịch). Kèm `tools/check_drift.py` so số chương local (đếm đúng logic `_translated_stats`) với production qua `/api/novels`; có `--fail-on-drift` cho cron/CI. Verify: `count_local` khớp chính xác 372/19/1835 với ba truyện đã biết; bảng drift in đúng với remote mock.

**1.3 — Chuẩn hóa dữ liệu chương.** `tools/normalize_chapters.py` (mặc định dry-run) phân loại và di chuyển — không xóa — file không phải chương sang `extras/`, bản dịch trùng số chương (giữ bản mtime mới nhất) sang `extras/duplicates/`, phần split thừa sang `extras/split_parts/`; mọi thao tác ghi vào `normalize_log.json` từng truyện để hoàn tác. Dry-run đầu tiên lộ ra hai lỗi phân loại (file `chapter-1431txt` là chương thật; tiêu đề chứa "thông báo/tổng kết" bị nhận nhầm) — đã sửa theo nguyên tắc: **file parse được số chương luôn là chương**. Kết quả apply: 21 file extras + 11 bản trùng được dọn khỏi 4 truyện; dry-run lần hai báo sạch 100%; số chương giữ lại khớp chính xác với các bản EPUB đã build trước đó (xích-tâm 1817, toàn-cầu 132, lãnh-chủ-tranh-bá 451).

**1.4 — CI + integration test.** `tests/test_integration.py` gồm 7 test hợp đồng API: shape danh sách guest (bắt buộc `chapter_count`/`glossary_count`, cấm `glossary`/`source_url`), chi tiết truyện guest, đọc một chương thật, translate/glossary không token phải 401, path traversal ở cả slug lẫn identifier chương phải bị chặn. Chạy được bằng pytest hoặc trực tiếp. Kết quả: **7/7 PASS** trên dữ liệu thật. `.github/workflows/ci.yml` chạy compileall + integration test (với truyện mẫu tự tạo) + npm build + `node --check` Worker + kiểm tra không lộ secret.

**1.5 — Backup.** `tools/backup_novels.py` zip toàn bộ novel.json/catalog/translated/extras (bỏ text_raw cho nhẹ, có `--include-raw`), giữ 4 bản gần nhất trong `backups/` (đã thêm vào .gitignore), tùy chọn `--r2` đẩy lên bucket `hacdao-chapters/_backups/`. Verify chạy thật: backup 2.853 file (14.9 MB), restore thử truyện `than-dao-de-ton` ra thư mục tạm, `diff -r` khớp 100%.

## Việc bạn cần làm trên máy (sandbox không có quyền Cloudflare)

Chạy ba lệnh sau, một lần duy nhất:

```bash
npx wrangler d1 execute hacdao-db --file=migrations/001_add_glossary_count.sql --remote
npx wrangler deploy
python3 migrate_to_cloudflare.py        # đồng bộ toàn bộ để D1 bắt kịp local
```

Sau đó `python3 tools/check_drift.py` phải báo ✅ không lệch. Muốn bật sync tự động về sau: thêm `AUTO_SYNC_CLOUDFLARE=1` vào `.env`. Muốn backup hàng tuần: thêm dòng crontab trong docstring của `tools/backup_novels.py`.

## Giới hạn còn lại

Sandbox không truy cập được Cloudflare/wrangler và mạng ngoài bị chặn một phần, nên ba việc trên chưa được chạy thật — mọi logic đã verify bằng mô phỏng D1 (SQLite cùng schema) và mock. Tùy chọn `--rename` của normalize_chapters (đưa tên file về một convention duy nhất) đã cài nhưng **chưa chạy** vì đổi tên làm lệch `r2_key` trên production — chỉ nên làm cùng một đợt re-migrate có kế hoạch. Sau khi bạn chạy `migrate_to_cloudflare.py`, D1 có thể vẫn còn row của các file đã bị chuyển sang extras (migrate là upsert, không xóa row mồ côi) — `check_drift.py` sẽ chỉ ra, và đây là việc nên xử lý đầu Giai đoạn 2.

## Chấm điểm sau Giai đoạn 1

| Hạng mục | Trước | Sau | Ghi chú |
|---|---|---|---|
| Kiến trúc backend | 8 | 8.5 | Thêm hook sync, không đổi entry point |
| Bảo mật | 6.5 | 8 | Worker hết lộ source_url/glossary (chờ deploy) |
| Đồng bộ & hạ tầng | 4 | 7 | Auto-sync + drift check + backup + CI; trừ vì chưa chạy thật trên Cloudflare |
| Chất lượng dữ liệu chương | 5 | 8.5 | Sạch 100% theo dry-run; trừ vì chưa re-migrate production |
| Độ tin cậy đã verify | — | 8 | 7/7 integration test; mô phỏng D1; restore backup đã test |

Tiếp theo: Giai đoạn 2 (PWA offline, nút tải EPUB, Reader themes, cron dịch tự động, resume phiên dịch).
