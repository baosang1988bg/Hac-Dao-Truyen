# Báo cáo Giai đoạn 2 — Trải nghiệm đọc & pipeline tự động (16/07/2026)

Giai đoạn 2 hoàn thành cả năm hạng mục, thực thi bằng hai luồng song song (frontend và backend, phạm vi file tách biệt) rồi kiểm tra tích hợp chung: integration test 7/7 PASS, Worker `node --check` sạch, frontend build thành công kèm đủ file PWA, endpoint EPUB trả file hợp lệ.

## Việc đã làm

**2.1 — PWA + đọc offline.** Thêm `manifest.webmanifest` (standalone, theme #0f172a, icon SVG chữ 黑), service worker viết tay không thêm dependency: network-first cho trang và danh sách truyện (dữ liệu cần tươi), cache-first cho assets có hash và **nội dung chương** (cache `hacdao-chapters-v1`) — chương đã mở một lần sẽ đọc được khi mất mạng. SW chỉ đăng ký ở bản production build. Trong panel Settings của Reader có mục "ĐỌC OFFLINE" với nút **Tải 10 chương tiếp**: fetch tuần tự để service worker giữ lại, hiện tiến độ từng chương, dùng đúng định danh URL để trùng khớp cache.

**2.2 — Tải EPUB.** Backend FastAPI thêm endpoint public `GET /api/novels/{slug}/epub`: build EPUB từ translated/ (dùng `tools/build_epub.py` — bản repo-hóa của script epub-builder, truyện >800 chương dùng ebooklib), cache tại `novels/<slug>/book.epub`, tự rebuild khi có chương mới hơn file cache. Worker production thêm cùng route, đọc `<slug>/book.epub` từ R2; file này được `migrate_to_cloudflare.py` upload trong bước sync. Đo thực tế: lần đầu build 0.05s (truyện nhỏ), lần hai cache hit 0.006s; file trả về đúng magic bytes PK, mở được bằng zipfile, tên file đẹp có dấu.

**2.3 — Reader.** Khảo sát cho thấy Reader đã có sẵn 5 theme (trắng/sepia/xanh lá/tối/xanh dương) và 5 font — vượt yêu cầu 3 theme/2 font, nên không làm trùng: refactor cơ chế theme từ inline sang CSS class `reader--<id>` với biến `--reader-*` scoped trong `.reader-root` (không ảnh hưởng theme toàn site), bổ sung sẵn class `reader--light`. Đánh dấu ✓ chương đã đọc được chuẩn hóa qua helper chung `markChapterRead`/`getReadChapters` trong `readingHistory.js`, tái sử dụng key localStorage cũ để không mất dữ liệu người dùng hiện có. Các nguyên tắc UX cũ (tap-zone, FAB trái-dưới 44px) được grep xác nhận còn nguyên.

**2.4 — Cron tự động.** `tools/auto_update.py` là orchestrator chạy từ crontab máy local (nguồn crawl chặn IP datacenter nên không đặt trên Cloudflare được): lock file chống chạy chồng (nhận diện lock chết theo PID), quét truyện còn chương chưa dịch (`total_chapters > last_chapter_number`), dịch tuần tự qua `main.py translate --chapters 0` với timeout 2 giờ, xong thì build EPUB → sync Cloudflare → gửi tóm tắt qua Discord webhook (`NOTIFY_WEBHOOK_URL`), log ngày vào `logs/`. Đã xử lý chống sync đôi (ép `AUTO_SYNC_CLOUDFLARE=0` trong tiến trình con). Dry-run trên dữ liệu thật chọn đúng: chỉ `huyen-giam-tien-toc` còn ~760 chương nguồn chưa dịch.

**2.5 — Phiên dịch bền.** Pipeline vốn đã resume theo file (chương dịch rồi thì bỏ qua); phần thiếu là truy vết chương lỗi: thêm `_record_failed_chapter` (thread-safe, dedup, không bao giờ phá phiên dịch) ghi `novels/<slug>/failed_chapters.json` tại điểm phát hiện `[Translation failed`, và `tools/retry_failed.py` dịch lại từng entry qua `--url`, xác nhận thành công bằng file mới xuất hiện rồi mới xóa entry.

## Cách verify

Từng hạng mục được verify ngay khi làm: py_compile 6 file Python, `node --check` Worker, `npx vite build` (1989 modules, ~3s), integration test 7/7 PASS chạy lại sau khi cả hai luồng gộp, endpoint EPUB test bằng TestClient trên truyện thật (status/magic bytes/zipfile/cache-hit/chặn traversal), auto_update dry-run, mô phỏng ghi-đọc-dedup failed_chapters.json. Không có test nào fail.

## Giới hạn

Chưa chạy được trên hạ tầng thật từ sandbox: upload R2, Worker route EPUB, cron dịch thật (nguồn novel543 chặn IP), và service worker chỉ kích hoạt ở bản build production — cần bạn duyệt mắt thường trên điện thoại sau khi deploy. ESLint còn các cảnh báo có từ trước (unused React import, prop-types), không phải do đợt này.

## Việc bạn cần làm trên máy

```bash
# một lần (nếu chưa làm theo báo cáo GĐ1):
npx wrangler d1 execute hacdao-db --file=migrations/001_add_glossary_count.sql --remote
npx wrangler deploy
python3 migrate_to_cloudflare.py        # sync D1/R2 + upload book.epub

# bật cron dịch tự động hằng ngày 6h sáng:
crontab -e
# 0 6 * * * cd /Users/sangpls/Documents/AI00/HacDaoTruyen && python3 tools/auto_update.py >> logs/cron.log 2>&1
# (tùy chọn) export NOTIFY_WEBHOOK_URL=<discord webhook> trong .env để nhận thông báo
```

## Chấm điểm sau Giai đoạn 2

| Hạng mục | Sau GĐ1 | Sau GĐ2 | Ghi chú |
|---|---|---|---|
| UX guest + Reader | 7 | 8.5 | Offline + EPUB + theme class hóa; trừ vì chưa duyệt mắt thường trên máy thật |
| Pipeline dịch | 7 | 8.5 | Tự động theo lịch + retry chương lỗi; trừ vì chưa chạy chu trình thật |
| Đồng bộ & hạ tầng | 7 | 7.5 | EPUB vào chu trình sync; điểm sẽ tăng khi deploy + check_drift sạch |
| Độ tin cậy đã verify | 8 | 8 | Mọi logic test được đều đã test; phần hạ tầng thật còn nợ |

Tiếp theo: Giai đoạn 3 (tài khoản người dùng, theo dõi truyện, thông báo, bình luận, QA dịch) — bắt đầu bằng 3.1 sau khi bạn đã deploy và xác nhận GĐ1+2 chạy tốt trên production.
