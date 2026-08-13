# Kế Hoạch Xử Lý — Audit Toàn Diện (Phiên 4, 2026-08-13)

> Sau khi sửa bug `chapter_count` ở phiên trước, đã chạy 4 agent audit song song
> (data consistency/Worker, frontend, 3 tính năng mới, pipeline/bảo mật) để tìm
> thêm vấn đề. Dưới đây là toàn bộ phát hiện, đã gộp/loại trùng, xếp theo mức độ.

## ⚠️ Phát hiện quan trọng nhất: bug vừa sửa có thể gây tác dụng phụ

Fix `chapter_count` ở commit `22f7278` (đếm thật từ bảng D1 `chapters`) là ĐÚNG cho
đường sync chính đang chạy hàng ngày (`migrate_to_cloudflare.py`, có ghi bảng
`chapters`). NHƯNG có một đường sync khác — `tools/batch_cloud_syncer.py` gọi
endpoint `/api/admin/sync-novel` (`syncNovelBatch()` trong `src/index.js`) — chỉ
ghi R2 + `catalog.json`, KHÔNG ghi bảng `chapters`. Nếu bạn từng dùng
`batch_cloud_syncer.py` để sync thủ công cho truyện nào đó, truyện đó có thể có
`catalog.json` đầy đủ (đọc được thật) nhưng bảng `chapters` D1 rỗng — sau bug fix
vừa rồi, truyện đó sẽ hiện "0 chương" ở trang danh sách dù vẫn đọc được nếu vào
thẳng trang chi tiết. Cần vá `syncNovelBatch()` NGAY để không lặp lại kiểu bug
này, và cần bạn xác nhận có từng dùng `batch_cloud_syncer.py` không để quyết định
có cần chạy lại `migrate_to_cloudflare.py` backfill cho truyện đó không.

## Danh sách vấn đề (đã xếp ưu tiên)

### 🔴 Cao — nên sửa ngay, rủi ro thật/đang ảnh hưởng

1. **`syncNovelBatch()` không ghi bảng `chapters` D1** (`src/index.js:831-905`) — xem
   trên. Sửa: thêm `INSERT INTO chapters` cho từng chương khi sync qua đường này.
2. **Race condition khi bấm dịch 2 lần gần nhau** (`routers/translate.py:88-111`) —
   check "đang chạy" và ghi state "running" không cùng 1 khối lock → có thể dịch
   trùng 1 truyện 2 lần song song, tốn gấp đôi phí API. Sửa: gộp check + ghi state
   vào chung `with TASKS_LOCK`.
3. **Batch-upload R2 ghi đè mất dữ liệu khi chạy incremental** (`migrate_to_cloudflare.py:280-282`) —
   `--batch-upload` kết hợp `--from-chapter` (sync thêm chương mới) sẽ tính lại
   `batch_index` từ 0, ghi đè `bundle-0000.json` cũ. Tính năng này CHƯA dùng cho
   production (opt-in, mặc định tắt) nên chưa gây hại thật, nhưng cần sửa trước
   khi ai đó bật thử.
4. **`getNovels()` và `getNovel()` tính `chapter_count` từ 2 công thức khác nhau**
   (list: đếm D1 `chapters`; detail: đếm `catalog.json`) — không có gì đảm bảo 2
   nguồn này luôn khớp. Cần hợp nhất về 1 công thức.

### 🟡 Trung bình

5. **`EpubCard.jsx:32` dùng `novel.status==='completed'` cho badge FULL**, trong khi
   mọi component khác (`AllNovelsSection`, `UpdatesSection`, `NovelTable`) dùng công
   thức `total_chapters>0 && chapter_count>=total_chapters` — 2 công thức khác nhau
   cho cùng 1 ý nghĩa, hiển thị FULL không nhất quán giữa các trang.
6. **Double-review request truyện** (`routers/users.py`, `src/index.js` — endpoint
   review) — không kiểm tra status hiện tại đã là `pending` chưa trước khi duyệt,
   có thể duyệt/từ chối lại 1 request đã xử lý.
7. **`glossary_count` bị reset về 0** khi 1 truyện được `syncNovelBatch()` tạo mới
   (INSERT hard-code 0, `ON CONFLICT` cũng không cập nhật lại) dù `glossary` thật
   sự có dữ liệu trên R2.
8. **`GeminiBackend` không thread-safe** khi `MAX_CONCURRENT_BATCHES=3` (mặc định)
   chạy nhiều batch song song cùng 1 translator — rotate key có thể đụng độ, ghi
   `key_status.json` mất cập nhật. Rủi ro: lãng phí quota, không mất bản dịch.
9. **Cron `check_lanh_chua.yml` thiếu `concurrency:` guard** — bấm chạy tay đúng
   lúc cron tự chạy có thể tạo 2 tiến trình dịch song song + 2 lần `git push`.
10. **`Reader.jsx` thiếu `.catch()`** khi tải danh sách chương — lỗi mạng khiến nút
    Trước/Tiếp bị vô hiệu vĩnh viễn mà không báo lỗi rõ ràng cho người đọc.
11. **TOCTOU giới hạn 3 request pending** (Request Novel) — race nhỏ, rủi ro thấp
    vì chỉ là chống spam mềm, không phải ranh giới bảo mật.

### 🟢 Thấp

12. **`isAdminRequest()` gọi `fetch(BACKEND_URL)` không timeout** — có thể treo
    request admin nếu backend chậm/deadlock.
13. **Dry-run batch-upload báo sai số liệu preview** (`migrate_to_cloudflare.py:274`).
14. **`safe_novel_dir` thiếu kiểm tra realpath containment** như `safe_join` cùng file.
15. **9 file frontend mồ côi hoàn toàn** (không ai import): `AnnouncementsSection.jsx`,
    `CompletedSection.jsx`, `HeroSection.jsx`, `InProgressSection.jsx`,
    `NewChapterWidget.jsx`, `NewsAnnouncementsWidget.jsx`, `QidianRankingsWidget.jsx`,
    `TopListSection.jsx`, `components/NovelCard.jsx` — tàn dư sau redesign, an toàn
    để xóa nhưng cần xác nhận trước (có thể bạn muốn giữ để tái sử dụng ý tưởng).
16. **`EpubReader.jsx` panel TOC/Settings rộng cố định** (300px/280px) — cắt cụt
    trên màn hình ≤320px, hiếm gặp.
17. **`auth.py` session in-memory** chỉ an toàn khi chạy 1 process — nên thêm
    comment cảnh báo, chưa cần sửa vì hiện chạy đúng 1 process (`start.sh`).

## Đề xuất phạm vi thực thi phiên này

Dự định làm ngay các mục 1-4 (Cao) + 5-11 (Trung bình, đều nhỏ/gọn/an toàn) trong
phiên này. Mục 12-14 (Thấp, code) làm kèm nếu còn thời gian. Mục 15 (xóa dead code)
và mục 8 (sửa GeminiBackend — đụng core pipeline dịch đang chạy production) cần
hỏi ý kiến bạn trước vì rủi ro/phạm vi khác hẳn phần còn lại.

## ✅ Kết quả thực thi

Đã hỏi ý kiến bạn cho 2 mục cần quyết định: **giữ nguyên** 9 file dead code (mục 15,
không xóa), **sửa ngay** GeminiBackend lock (mục 8). Toàn bộ 17 mục đã được xử lý
trong 6 commit riêng biệt:

- `e55e454` — mục 1, 4, 6 (phần Worker), 11 (phần Worker), 12: sửa `syncNovelBatch()`
  ghi bảng `chapters`, hợp nhất công thức `chapter_count`, double-review + TOCTOU +
  timeout ở Worker.
- `74565ec` — mục 2: gộp lock chống dịch trùng.
- `ef22d97` — mục 6, 11 (phần FastAPI): double-review + TOCTOU khớp bản Worker.
- `a8cc247` — mục 3, 13: sửa bundle index + dry-run preview batch-upload.
- `ce97602` — mục 8, 9, 14, 17: GeminiBackend lock, cron guard, security hardening.
- `682e048` — mục 5, 10, 16: badge FULL nhất quán, Reader.jsx catch lỗi, EpubReader responsive.

Xem chi tiết cách verify từng mục và giới hạn còn lại trong
`BAO_CAO_AUDIT_PHIEN4_2026-08-13.md`.
