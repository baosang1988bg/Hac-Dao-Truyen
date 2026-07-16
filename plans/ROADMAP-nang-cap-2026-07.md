# Roadmap nâng cấp HacDaoTruyen — 07/2026

> **Cách dùng file này:** đây là nguồn sự thật về tiến độ nâng cấp. Khi muốn tiếp tục,
> chỉ cần yêu cầu Claude: *"đọc plans/ROADMAP-nang-cap-2026-07.md và tiếp tục hạng mục
> tiếp theo"*. Bảng trạng thái dưới đây được cập nhật sau mỗi hạng mục hoàn thành;
> báo cáo chi tiết từng giai đoạn nằm trong `plans/BAO_CAO-giai-doan-*.md`.

## Bảng trạng thái thực thi

| Hạng mục | Trạng thái | Ngày | Ghi chú |
|---|---|---|---|
| 1.1 Contract API Worker↔FastAPI | ✅ Xong | 16/07 | getNovel whitelist + glossary_count D1; cần `wrangler deploy` + chạy `migrations/001` |
| 1.2 Sync tự động + check_drift | ✅ Xong | 16/07 | Bật bằng env `AUTO_SYNC_CLOUDFLARE=1`; `tools/check_drift.py` |
| 1.3 Chuẩn hóa dữ liệu chương | ✅ Xong | 16/07 | Đã apply: 21 extras + 11 trùng → `extras/`, log hoàn tác trong từng truyện |
| 1.4 CI + integration test | ✅ Xong | 16/07 | `tests/test_integration.py` 7/7 PASS; `.github/workflows/ci.yml` |
| 1.5 Backup định kỳ | ✅ Xong | 16/07 | `tools/backup_novels.py`, giữ 4 bản, restore đã test |
| 2.1 PWA + offline | ✅ Xong | 16/07 | manifest + sw.js thủ công; nút "Tải 10 chương tiếp" trong Settings Reader |
| 2.2 Nút tải EPUB | ✅ Xong | 16/07 | `GET /api/novels/{slug}/epub` (FastAPI build+cache; Worker đọc R2); migrate upload book.epub |
| 2.3 Reader hoàn thiện | ✅ Xong | 16/07 | Đã có sẵn 5 theme/5 font — refactor sang CSS class; ✓ chương đã đọc qua helper chung |
| 2.4 Cron crawl+dịch tự động | ✅ Xong | 16/07 | `tools/auto_update.py` (lock, notify webhook, log); cần đặt crontab trên máy |
| 2.5 Phiên dịch bền + resume | ✅ Xong | 16/07 | `failed_chapters.json` + `tools/retry_failed.py`; skip chương đã dịch có sẵn từ trước |
| 3.x / 4.x | ⬜ Chưa mở | | Mở sau khi GĐ2 xong |

Định hướng đã chốt: mở cho **cộng đồng nhỏ** trong 6–12 tháng tới, ưu tiên đồng đều cả bốn mảng: trải nghiệm đọc, pipeline dịch tự động, quản trị & chất lượng dịch, hạ tầng & đồng bộ. Tài liệu này là kế hoạch hành động, sắp theo thứ tự nên làm; mỗi hạng mục có lý do, độ khó (S/M/L) và tiêu chí verify để biết khi nào được tính là xong.

## Hiện trạng (chấm điểm nền, 07/2026)

Kiến trúc backend đã tách module sạch (routers/providers/pipeline), auth server-side, chống path traversal và SSRF — mảng bảo mật local ở mức tốt. Frontend đã tách guest/admin, mobile-first, trang chủ dùng số liệu thật. Điểm yếu lớn nhất hiện nay là **đồng bộ dữ liệu local ↔ Cloudflare**: hai bên lệch schema (vừa vá `getNovels`, còn `getNovel` lộ `source_url` và trả glossary không cần token), D1 cũ hơn local cả chục ngày, và việc sync là thao tác thủ công dễ quên. Dữ liệu chương cũng chưa sạch: nhiều convention tên file lẫn lộn (Chương N / 第N章 / NN_chuong-n), file cảm ngôn tác giả nằm chung translated/, chương split 1-1/2-2 chưa merge.

| Hạng mục | Điểm /10 | Ghi chú |
|---|---|---|
| Kiến trúc backend | 8 | Sạch sau refactor; thiếu test tự động |
| UX guest + Reader | 7 | Nền tốt; chưa offline, chưa sync vị trí đọc |
| Bảo mật | 6.5 | Local tốt (8); Worker còn lệch chuẩn (5) |
| Pipeline dịch | 7 | Chạy ổn; chưa tự động theo lịch, chưa resume |
| Đồng bộ & hạ tầng | 4 | Thủ công, lệch dữ liệu, không backup định kỳ |
| Chất lượng dữ liệu chương | 5 | Tên file hỗn loạn, split/dupe/author-notes lẫn lộn |

## Giai đoạn 1 — Nền móng (tuần 1–3)

Làm trước vì mọi tính năng phía sau đều đứng trên lớp này.

**1.1. Đồng bộ contract API Worker ↔ FastAPI** (M). `src/index.js` phải trả đúng shape như `routers/novels.py`: `getNovel` gate glossary theo Bearer token, bỏ `source_url`/`last_translated_url` khỏi response guest, thêm cột `glossary_count` vào D1 (cập nhật trong `updateGlossary` và migration). Verify: script so sánh JSON `/api/novels` và `/api/novels/{slug}` giữa local và production — mọi field guest phải trùng tên và ngữ nghĩa.

**1.2. Sync tự động sau mỗi phiên dịch** (M). Gọi `migrate_to_cloudflare.py --slug <slug>` trong `finalize_session` của pipeline (hoặc hook sau commit translation-sync), kèm script `tools/check_drift.py` đếm chương D1 vs `translated/` local cho từng truyện và in bảng lệch. Verify: dịch 1 chương mới → trong 1 phút chương xuất hiện trên production; `check_drift` trả 0 lệch.

**1.3. Chuẩn hóa dữ liệu chương** (M). Tool `tools/normalize_chapters.py`: đổi toàn bộ tên file về một convention duy nhất (`Chương NNNN - Tiêu đề_VI.md`), merge các cặp split `1-1`/`2-2`, chuyển file không phải chương (cảm ngôn, tổng kết quyển, xin nghỉ) sang `extras/`. Chạy dry-run trước, có log hoàn tác. Verify: build EPUB từng truyện báo 0 duplicates, 0 skipped bất thường; `check_drift` vẫn 0.

**1.4. CI tối thiểu** (S). GitHub Actions (hoặc script pre-push local): `py_compile` toàn bộ .py, `npm run build`, và bộ integration test TestClient (guest không lộ glossary, translate không token → 401, path traversal → 400). Verify: PR/commit làm hỏng contract sẽ fail CI.

**1.5. Backup định kỳ** (S). Script zip `novels/*/novel.json + translated/` đẩy lên R2 (bucket riêng) theo tuần, giữ 4 bản gần nhất. Verify: restore thử 1 truyện từ backup ra thư mục tạm, diff khớp.

## Giai đoạn 2 — Trải nghiệm đọc & pipeline tự động (tuần 3–8)

**2.1. PWA + đọc offline** (M). Thêm manifest + service worker (Workbox): cache app shell, cache chương đã mở, nút "tải N chương tiếp theo" trong Reader. Độc giả mobile mất mạng vẫn đọc tiếp được. Verify: bật airplane mode, mở lại chương đã cache và đọc bình thường.

**2.2. Nút "Tải EPUB" trên trang truyện** (M). Tận dụng script epub-builder: sau mỗi lần sync, pipeline build EPUB trọn bộ upload lên R2 (`<slug>/book.epub`), Worker thêm route `GET /api/novels/{slug}/epub` redirect sang R2. Truyện >800 chương dùng ebooklib. Verify: tải từ production, mở bằng Apple Books, đủ số chương như web.

**2.3. Reader hoàn thiện** (S–M). Theme sáng/tối/sepia, chọn font serif/sans, đánh dấu ✓ chương đã đọc trong mục lục, giữ nguyên các nguyên tắc đã có (tap-zone lật chương, FAB góc trái-dưới, touch ≥44px). Verify: duyệt tay trên điện thoại thật (sandbox không chụp được screenshot — giới hạn đã biết).

**2.4. Crawl + dịch theo lịch** (L). Cron local (launchd/cron trên máy chạy backend) hoặc Cloudflare Cron Trigger gọi `BACKEND_URL`: mỗi ngày kiểm catalog từng truyện đang theo (novel543 chặn datacenter IP → chạy từ máy local là hợp lý), có chương mới thì dịch → sync → build lại EPUB → gửi thông báo Discord/Telegram webhook. Verify: giả lập catalog có thêm 1 chương, toàn chuỗi chạy không cần tay người, nhận được notification.

**2.5. Phiên dịch bền + resume** (M). Persist trạng thái phiên dịch (chương nào xong/lỗi) ra file JSON trong thư mục truyện; restart backend đọc lại và tiếp tục; retry riêng chương lỗi. Verify: kill giữa phiên dịch 10 chương → start lại → chỉ dịch phần còn thiếu.

## Giai đoạn 3 — Cộng đồng nhỏ & chất lượng dịch (tháng 2–4)

**3.1. Tài khoản người dùng** (L). Đăng ký/đăng nhập (email + mật khẩu, lưu D1, session token như auth admin hiện có; cân nhắc chỉ dùng magic-link cho nhẹ), role `user`/`admin`. Đây là điều kiện cho các mục sau. Verify: TestClient suite cho flow đăng ký/đăng nhập/verify/401.

**3.2. Theo dõi truyện + đồng bộ vị trí đọc** (M). Bookmark truyện, lưu `last_read` lên D1 theo user; Reader sync mỗi lần chuyển chương; trang "Đang theo dõi" có badge số chương chưa đọc. Verify: đọc trên máy tính, mở điện thoại thấy đúng vị trí.

**3.3. Thông báo chương mới** (M). Web Push (VAPID, đăng ký per truyện) và/hoặc email digest tuần. Gắn vào cuối chuỗi cron 2.4. Verify: chương mới → push đến thiết bị đã đăng ký.

**3.4. Bình luận theo chương** (M). Bảng comments trong D1, guest đọc, user đăng, admin xóa; rate-limit theo IP+user. Cộng đồng nhỏ chưa cần moderation phức tạp. Verify: TestClient CRUD + rate limit 429.

**3.5. QA chất lượng dịch** (M). Pass tự động sau dịch: đếm ký tự Hán sót, so số đoạn raw vs dịch (thiếu đoạn), phát hiện tên riêng không khớp glossary → điểm health per chương lưu vào catalog; admin dashboard hiển thị chương đỏ, nút re-translate 1 chương. Verify: chạy trên 1 truyện đã biết có chương lỗi (vd chương từng thiếu trang 2) — QA phải bắt được.

**3.6. Glossary editor nâng cấp** (S). Glossary vài nghìn entry (Huyền Giám ~1000+) cần tìm kiếm, phân trang, phát hiện entry trùng/mâu thuẫn (một từ Trung → nhiều bản dịch). Verify: mở glossary lớn không lag, tìm kiếm ra kết quả tức thì.

## Giai đoạn 4 — Dài hạn (tháng 4–12)

**4.1. Chốt một nguồn sự thật dữ liệu.** Hiện metadata sống ở cả novel.json (local) lẫn D1. Dài hạn nên chọn: D1 là chuẩn, local chỉ là công cụ dịch đẩy lên — hoặc ngược lại local là chuẩn và D1 chỉ là bản chiếu. Quyết định này ảnh hưởng mọi tính năng user (bookmark, comment phải ở D1). Đề xuất: **D1 làm chuẩn cho dữ liệu người dùng, local làm chuẩn cho nội dung dịch**, ranh giới rõ ràng.

**4.2. Tìm kiếm toàn văn** (M). D1 hỗ trợ FTS5: index tiêu đề chương + nội dung; guest tìm "tên nhân vật" ra chương liên quan. Với catalog nhỏ có thể bắt đầu bằng tìm client-side trên tiêu đề.

**4.3. SEO/share cơ bản** (M). Worker render meta og:title/description cho `/novel/:slug` (SPA hiện trả index.html trống meta) để link share lên Discord/Facebook có preview đẹp. Không cần SSR full.

**4.4. Trang khám phá theo tag/genre thật** (S). Khi số truyện tăng, thêm tags do admin gán — tiếp tục nguyên tắc không số liệu giả, không ranking view ảo.

**4.5. Monitoring & chi phí** (S). Cloudflare analytics + alert lỗi 5xx qua webhook; theo dõi usage API dịch (đã có key_status.json — đưa lên dashboard). Cân nhắc trang donate nếu chi phí API tăng.

**4.6. Lưu ý pháp lý.** Mở cộng đồng đồng nghĩa phân phối bản dịch không có bản quyền gốc rộng hơn — rủi ro DMCA với Qidian/69shuba tăng theo độ public. Nên giữ cộng đồng dạng private/invite (đúng định hướng "cộng đồng nhỏ"), không chạy SEO mạnh cho nội dung chương, và sẵn sàng gỡ truyện khi có yêu cầu.

## Thứ tự thực thi đề xuất

Tuần 1–3 làm trọn Giai đoạn 1 (1.1 → 1.5 tuần tự; 1.4/1.5 có thể song song). Tuần 3–8 làm 2.1 → 2.5, trong đó 2.4 (cron tự động) là hạng mục giá trị nhất của cả roadmap — nó biến web từ "kho lưu bản dịch" thành "trang truyện tự cập nhật". Giai đoạn 3 bắt đầu bằng 3.1 vì là móng của 3.2–3.4; 3.5–3.6 độc lập, chen được bất cứ lúc nào. Mỗi hạng mục xong phải qua bậc thang verify (py_compile → npm build → TestClient → duyệt tay) trước khi sang mục kế — không dồn verify về cuối.

## Việc còn nợ từ phiên trước (làm ngay được)

Deploy Worker fix `getNovels` (`npx wrangler deploy`) và chạy `migrate_to_cloudflare.py` để D1 bắt kịp local. Dịch nốt 5 chương cuối Lãnh Chủ Cầu Sinh (1486–1490, truyện đã hoàn kết) rồi build lại EPUB trọn bộ. Hai việc này nên xong trước khi bắt đầu Giai đoạn 1.
