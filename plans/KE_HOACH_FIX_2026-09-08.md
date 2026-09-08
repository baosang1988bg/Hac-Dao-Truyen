# Kế hoạch sửa lỗi hiện tại — 08/09/2026

Trạng thái: **đã lập kế hoạch, chưa triển khai code**. Căn cứ: [review 08/09/2026](../docs/review-2026-09-08.md). Phạm vi là R01–R07 và xác minh dữ liệu liên quan; ADK nâng cao, manga/OCR và redesign không thuộc đợt này.

## 1. Thứ tự thực hiện

| Đợt / PR | Công việc | Phụ thuộc | Ước lượng ngày công |
|---|---|---|---|
| 0 | Môi trường test và fixture cô lập | Không | 0,5–1 |
| 1 | R01: route admin và health | 0 | 0,5–1 |
| 2 | R02: bootstrap và migration D1 | 0 | 1–1,5 |
| 3 | R03: tính nhất quán sync, đọc và restore | 1, 2 | 2–4 |
| 4 | R04: frontend lint và CI đầy đủ | 0, 1, 2; gate sync sau 3 | 1,5–3 |
| 5 | R05: workflow không che lỗi | 0; rollout sau 3 | 0,5–1 |
| 6 | R06/R07: ngân sách, rate limit, cấu hình và dependency | 3, 5 | 1,5–3 |
| 7 | Staging, đối soát và phát hành | Các đợt liên quan đã đạt | 1–2 |

Tổng dự kiến **8,5–16,5 ngày công**, chưa tính thời gian chờ quyền truy cập hoặc backfill dữ liệu lớn. Đây là ước lượng để chia việc, không phải cam kết thời gian. Mỗi PR giữ phạm vi riêng, cập nhật test và docs cùng thay đổi. Đợt 1/2 có thể phát hành trước phần ổn định mở rộng khi đạt kiểm tra staging tương ứng.

## 2. Đợt 0 — Tạo nền kiểm thử an toàn

**File:** `tests/conftest.py` (mới), `tests/test_integration.py`, `tests/test_novel_requests.py`, `test_novel_manager.py`, `user_store.py`, `novel_manager.py`, `requirements-dev.txt` (mới), `package.json`.

- Tạo môi trường Python 3.11 mới; ghi lại lỗi dependency thực tế trước khi sửa. Khai báo pytest là dependency phát triển.
- Dùng thư mục tạm cho novels và SQLite. Kiểm tra mọi alias/import giữ đường dẫn cũ, mọi bước khởi tạo DB lúc import; fixture phải đặt đường dẫn trước khi ứng dụng truy cập dữ liệu.
- Tạo truyện `ci-demo` với 2 chương và glossary ngay trong fixture. Reset session admin, task state và đóng kết nối sau test.
- Bỏ phụ thuộc truyện thật và việc ghi vào `data/users.db`. Giữ kiểm tra contract, không giảm assertion để làm xanh.
- Thêm harness Worker dùng Node test runner và stub DB/R2/fetch; dùng module loader phù hợp với root hiện chưa khai báo ESM, không đổi module mode toàn repo chỉ để chạy test.
- Thêm lệnh riêng `test:python`, `test:worker`; thống nhất `npm test` chạy các bộ test đã khai báo.

**Nghiệm thu:** chạy test 2 lần liên tiếp trong checkout sạch không cần `novels/` thật, không đổi dữ liệu vận hành; test Worker không gọi mạng. Nếu baseline còn fail, ghi lỗi độc lập và đưa vào PR xử lý tương ứng.

## 3. Đợt 1 — Khôi phục route admin và health (R01)

**File:** `src/index.js`, `tests/worker/routes.test.mjs` (mới), `docs/api.md`.

1. Thêm dispatch chính xác: POST `/api/auth/login`, POST `/api/auth/logout`, GET `/api/auth/verify` → `proxyToBackend`.
2. Thêm GET `/api/novels/:slug/health` → `getHealth`. So sánh response với frontend HealthPanel và FastAPI trước khi chốt shape.
3. Bảo toàn Authorization, method, body, query và status từ backend. Không đưa auth vào điều kiện `path.includes(...)` rộng hơn.
4. Xóa nhánh proxy-cover trùng nếu vẫn tồn tại, giữ nguyên hành vi handler.
5. Giữ 503 khi không có backend, 502 khi không kết nối được. Method sai không được proxy như method đúng.

**Test bắt buộc:** login thành công/sai mật khẩu; verify token hợp lệ/không hợp lệ; logout rồi verify thất bại qua backend stub có session; thiếu BACKEND_URL; backend lỗi; health truyện có/không có dữ liệu; route gần giống hoặc method sai không match nhầm. Test handler health với DB/R2 stub riêng, không chỉ kiểm tra status dispatch.

**Nghiệm thu:** test tái hiện 404 cũ chuyển xanh; login–verify–logout và HealthPanel chạy được trên staging. Không thay đổi public/admin field filtering.

## 4. Đợt 2 — Chuẩn hóa schema D1 (R02)

**File:** `schema.sql`, migration mới sau 003, `tools/migrate_schema.py` (mới), `tests/test_schema.py` (mới), `deploy.md`.

**Phương án:** giữ migration cũ làm lịch sử; dùng runner có preflight và bảng lịch sử migration. `schema.sql` trở thành snapshot bootstrap đầy đủ cho phiên bản hiện tại; upgrade database cũ dùng runner, không chạy lại snapshot để thay cho nâng cấp.

- Kiểm kê toàn bộ cột/bảng được Worker và script truy vấn, không chỉ `drive_file_id`: views, rating, EPUB, glossary, users, novel_requests và các index.
- Bổ sung `drive_file_id` kiểu TEXT với giá trị mặc định phù hợp nhánh kiểm tra hiện tại; xác minh cách `getEpub` xử lý null/rỗng trước khi chốt.
- Preflight đọc `PRAGMA table_info` và bảng hiện có. DB đã thêm cột thủ công phải được đối chiếu kiểu/default trước khi ghi nhận baseline; không nuốt mọi lỗi duplicate column.
- Runner có chế độ plan/dry-run, chọn local/remote rõ ràng, in danh sách migration và chỉ ghi lịch sử khi thao tác thành công. Nếu gặp schema không nhận diện được, dừng và báo khác biệt.
- Bootstrap DB mới ghi nhận baseline tương ứng để lần chạy sau không áp dụng lại ALTER cũ.

**Ma trận test:** DB trống; chỉ schema cũ; schema có glossary_count; DB có EPUB fields; DB có drive_file_id thêm thủ công; chạy runner lần 2; lỗi giữa migration rồi chạy lại. Kiểm tra dữ liệu truyện/user mẫu được giữ nguyên.

**Nghiệm thu:** bootstrap/upgrade đều chạy lại an toàn; SQL của danh sách truyện và EPUB thực thi được. Sau unit SQLite, chạy cùng migration và API trên D1 local/staging để kiểm tra khác biệt runtime.

## 5. Đợt 3 — Sửa đồng bộ và đọc dữ liệu (R03)

**File:** `src/index.js` (`syncNovelBatch`, `getChapters`, các fallback), `migrate_to_cloudflare.py`, `restore_from_cloudflare.py`, `tools/cloud_to_cloud_syncer.py`, `tools/batch_cloud_syncer.py`, tests sync/restore mới; migration bổ sung nếu cần trạng thái nguồn mục lục.

### 5.1. Chốt quy tắc dữ liệu trước khi sửa

- Chunk upload là **upsert tăng dần**. `is_first_chunk` chỉ khởi tạo/cập nhật metadata, không có nghĩa xóa mục lục hoặc chương cũ.
- D1 là nguồn mục lục cho truyện đã đồng bộ đầy đủ vào chỉ mục D1. Catalog R2/Drive tiếp tục phục vụ truyện legacy chưa có chỉ mục hoàn chỉnh.
- Không dùng điều kiện “D1 có ít nhất một chương” để kết luận đã index đủ: Drive fallback hiện có thể cache từng chương. Thêm trạng thái index rõ ràng, mặc định legacy; chỉ chuyển sau đối soát hoàn tất.
- R2 catalog là dữ liệu dẫn xuất khi index đầy đủ. Không dùng bản catalog cũ để che mất chương đã commit ở D1.
- Chưa hỗ trợ xóa chương bằng upload chunk. Luồng replace/delete nếu cần phải tách riêng và có đối soát.

### 5.2. Thứ tự ghi và retry

1. Validate toàn bộ payload trước khi ghi: slug, mảng chapters, filename/title/content, số chương, số lượng và tổng kích thước. Chốt ngưỡng từ fixture và giới hạn runtime đã xác minh khi triển khai; không nhận batch không giới hạn.
2. Ghi nội dung R2 trước, sau đó mới cập nhật dòng D1 trỏ đến nội dung đã tồn tại. Dùng object key có version/hash để ghi lại chương không làm thay đổi object đang được bản index cũ tham chiếu.
3. Upsert D1 theo khóa truyện/filename. Retry cùng payload giữ cùng key/hash và không tạo bản ghi chương trùng.
4. Tránh read–merge–write catalog làm nguồn chính. Với index đầy đủ, dựng mục lục từ D1; nếu vẫn xuất catalog, gắn version và coi đó là cache, không dùng cache không xác minh được độ mới.
5. Client gửi chunk cùng slug tuần tự; cho phép nhiều slug độc lập. Server vẫn phải đúng khi nhiều client gửi đồng thời, không dựa vào `Map`/lock trong một isolate để bảo đảm nhất quán.
6. Xác định xung đột hai bản nội dung khác nhau cho cùng filename bằng version kỳ vọng; trả 409 cho bản stale thay vì âm thầm ghi đè. Hai chunk chứa chương khác nhau phải hợp nhất được.
7. R2 thành công nhưng D1 lỗi: giữ object mồ côi để retry; chưa tự xóa trong request. Công cụ đối soát liệt kê object mồ côi và pointer hỏng ở chế độ read-only trước.
8. Chỉ cập nhật state thành công ở script khi server xác nhận cả nội dung và index; retry/backoff hữu hạn cho lỗi tạm thời, tôn trọng 429.

### 5.3. Phục hồi và dữ liệu cũ

- Công cụ đối soát so sánh filename/số chương/key giữa D1, catalog và R2; phân biệt thiếu index với thiếu nội dung. Không chỉ so số lượng tổng.
- Tạo kế hoạch backfill theo slug, không ghi production ngay khi scan.
- Restore phải đọc được object riêng và bundle qua manifest; xác minh checksum hoặc nội dung chuẩn hóa sau round-trip.
- Giữ tương thích key cũ; chưa dọn object/version cũ cho đến khi bản reader/restore mới được xác nhận.

**Test bắt buộc:** lỗi R2 trước D1; lỗi D1 sau R2; timeout rồi retry; hai chunk đồng thời; hai client cùng filename; first chunk trên truyện có chương cũ; metadata có partial index do Drive; bundle round-trip; catalog stale; key thiếu; payload lỗi không ghi gì.

**Nghiệm thu:** retry không nhân đôi, không mất chương khi đồng thời, D1 không công bố pointer mới trước khi nội dung tồn tại; cả legacy và index đầy đủ đọc đúng. Kết quả fault-injection local và truyện thử staging được lưu vào báo cáo PR.

## 6. Đợt 4 — Frontend và quality gate (R04)

**File:** `frontend/src/`, `frontend/eslint.config.js`, `package.json`, `.github/workflows/ci.yml`, tests contract Worker/FastAPI.

- Xuất lint theo rule/file để xử lý từng nhóm: unused import/vars, props validation, escaped text, hook dependencies, fast refresh.
- Xóa React default import khi JSX runtime không cần; giữ import được tham chiếu thật. Bổ sung validation cho props theo kiểu dữ liệu thực tế; không chuyển toàn dự án sang TypeScript trong PR này.
- Với hook dependencies, kiểm tra stale closure, vòng gọi API và cleanup request; chỉ dùng useCallback khi cần ổn định dependency, không thêm dependency máy móc.
- Giữ contract danh sách hiện hành: FastAPI array, Worker object phân trang. Đặt test frontend cho adapter của hai shape thay vì thay API hàng loạt trong PR lint.
- CI chạy Python tests cô lập, Worker runtime/contract tests, migration tests, lint và build. Bỏ tạo fixture thủ công trong YAML khi pytest fixture đã thay thế.
- Thiết lập lint không còn warning (`--max-warnings 0`) sau khi xử lý hết baseline. Không bỏ qua thư mục hoặc tắt hàng loạt rule để đạt gate.

**Nghiệm thu:** lint 0 lỗi/0 cảnh báo, build pass; smoke browser trang chủ/tìm kiếm, reader/chuyển chương, admin/glossary/translation polling, EPUB và login. Các bài test có thể bắt lại R01/R02; không chỉ syntax check Worker.

## 7. Đợt 5 — Workflow phản ánh đúng kết quả (R05)

**File:** `.github/workflows/cloud_sync.yml`, `.github/workflows/check_lanh_chua.yml`, các script entrypoint tương ứng.

- Bỏ `|| true` khỏi sync, git add và git push. Script phải trả exit code khác 0 khi công việc thất bại; kiểm tra cả trường hợp exception đang bị catch rồi return thành công.
- Dùng `git diff --cached --quiet` để phân biệt không có thay đổi với lỗi commit. Chỉ commit khi có diff; lỗi commit thật phải fail.
- Khai báo `permissions: contents: write` ở job có push. Đồng bộ concurrency group giữa các workflow cùng ghi branch/state khi cần; không dùng force push.
- Kiểm tra Node/npm và cài root dependency bằng lockfile cho job thực sự gọi Wrangler; không dựa vào npx tự tải phiên bản bất kỳ.
- Nếu cần lưu checkpoint khi sync lỗi, dùng bước tách rõ chạy cả khi thất bại; lưu artifact/checkpoint nhưng giữ trạng thái job fail. Không commit “đã hoàn tất” cho phần chưa sync.
- Tổng kết số truyện/chương thành công, thất bại, bỏ qua và lý do dừng; không in secrets.

**Test:** script sync exit 1 → job fail; không thay đổi → không commit và vẫn success; push bị từ chối → fail; hai lần chạy không mất state; lỗi một truyện không được báo cả batch hoàn thành.

**Nghiệm thu:** thử `workflow_dispatch` trên nhánh/môi trường thử, kiểm tra cả case thành công và lỗi chủ động trước khi bật lịch production.

## 8. Đợt 6 — Ngân sách, rate limit và cấu hình (R06/R07)

**File:** `tools/cloud_to_cloud_syncer.py`, `tools/batch_cloud_syncer.py`, module budget dùng chung mới, `src/index.js`, `.env.example`, requirements/lockfiles, docs.

### Ngân sách sync

- Tách `SyncBudget` thành module dùng chung; hai syncer có cùng tùy chọn ngân sách và state. Ghi rõ chi phí ước tính theo thao tác, không gọi đó là số billing thực tế.
- Reserve ngân sách trước request; retry cũng tiêu ngân sách vì phía server có thể đã ghi. Ghi state nguyên tử và kiểm tra qua restart.
- Lock theo process/thread chưa đủ nếu chạy nhiều máy: trước mắt định nghĩa một nơi chạy scheduler cho mỗi budget state và chặn chạy trùng ở CI. Nếu nhiều máy là nhu cầu thực tế, chuyển reservation về một kho chung trước khi bật chúng.
- Đặt ngân sách theo cấu hình của chủ dự án, không dùng quota/giá cũ làm mặc định ngầm. Đo riêng ghi phát sinh từ Drive fallback, vì budget client không bao phủ lượt đọc website.

### Rate limit

- Sửa mô tả hiện tại: Map chỉ là best-effort theo isolate.
- Khi triển khai, kiểm tra năng lực account/runtime rồi chọn cơ chế chia sẻ phù hợp (binding/platform rule hoặc kho điều phối). Đây là điểm quyết định kỹ thuật của đợt 6, không phải điều kiện trì hoãn R01–R05.
- Tách giới hạn login, đọc truyện và sync có xác thực. Không để sync bị tính như traffic đọc chung mà không có retry rõ ràng; không mở bypass chỉ vì có header chưa được verify.
- Kiểm thử vượt ngưỡng, reset window, nhiều isolate và hành vi khi hệ thống limit lỗi; ghi chính sách fail-open/fail-closed cho từng nhóm endpoint.

### Dependency và template

- Đồng bộ `.env.example` với mặc định code: model, batch, timeout, FALLBACK_ORDER; bỏ cam kết giá/quota chưa xác minh.
- Tách dependency runtime/dev và tạo lock phù hợp Python 3.11 sau khi suite xanh; dùng cùng lock trong CI. Giữ optional ADK/Drive dependency tách khỏi cài đặt tối thiểu.
- Cập nhật docs bằng kết quả thật; ghi rõ giới hạn multi-process admin session còn tồn tại, không gọi là đã giải quyết bởi rate limit.

**Nghiệm thu:** budget không vượt reservation trong các test đồng thời/restart; mọi retry có accounting; giới hạn platform được xác minh đúng phạm vi cam kết; cài mới từ lock chạy được suite. Phần rate limit chia sẻ chỉ đóng khi có test môi trường thật, không đóng bằng thay comment.

## 9. Đợt 7 — Staging, đối soát và phát hành

1. Tạo cấu hình staging riêng cho Worker, D1, R2 và backend; kiểm tra script không còn trỏ cứng production trước khi chạy. Dùng truyện fixture, không sao chép tài khoản thật để test.
2. Áp dụng migration trên DB mới và bản schema mô phỏng DB đang chạy; kiểm tra request/review với migration 003.
3. Chạy smoke luồng độc giả và admin; upload 2–3 chunk, retry, đọc từng chương; thử EPUB và bundle restore nếu dùng.
4. Trước production: chuẩn bị diff/schema plan, kết quả test, backup/restore procedure và báo cáo đối soát read-only. Phê duyệt phát hành trên kết quả cụ thể này.
5. Khi phát hành được cho phép: tạm dừng writer cùng dữ liệu; snapshot D1 và bảo toàn R2/state; áp dụng migration mở rộng tương thích trước, deploy reader/Worker rồi cập nhật syncer. Chưa xóa cột/key cũ.
6. Sync một slug thử và theo dõi 4xx/5xx, chương thiếu, catalog stale, số retry và thao tác storage. Chỉ tăng phạm vi sau khi đối chiếu thành công.
7. Backfill dữ liệu cũ bằng danh sách slug đã đối soát. Nếu phát hiện pointer hỏng hoặc mất chương mới, dừng writer và rollout; không tiếp tục batch để “thử lại toàn bộ”.

**Rollback:** quay về phiên bản Worker đã ghi nhận chỉ khi tương thích schema mới; dừng syncer mới trước rollback. Code rollback không tự phục hồi D1/R2. Giữ object cũ và state snapshot; phục hồi dữ liệu theo phạm vi đã xác định, không ghi đè toàn kho theo suy đoán.

## 10. Theo dõi hoàn tất

Mỗi mục dùng trạng thái: `Chưa làm` → `Đang làm` → `Đạt local` → `Đạt staging` → `Đã phát hành`. Không chuyển từ “code đã sửa” thẳng thành “production đã ổn”.

| Mã | Bằng chứng cần lưu | Trạng thái ban đầu |
|---|---|---|
| R01 | Route tests + admin/health staging | Chưa làm |
| R02 | Ma trận bootstrap/upgrade + D1 staging | Chưa làm |
| R03 | Fault-injection, concurrent sync, legacy/bundle round-trip | Chưa làm |
| R04 | Lint sạch, CI đầy đủ, browser smoke | Chưa làm |
| R05 | Workflow success/no-change/failure cases | Chưa làm |
| R06 | Budget/retry/restart tests + rate limit môi trường thật | Chưa làm |
| R07 | Cài mới bằng lock + tests không chạm dữ liệu thật | Docs đã cập nhật; code chưa làm |

Điều kiện kết thúc đợt ổn định: các lỗi P1 đã đạt staging và được xác nhận sau phát hành; quality gates hoạt động; dữ liệu chịu ảnh hưởng đã có kết quả đối soát hoặc danh sách ngoại lệ cụ thể có người phụ trách. Mọi hạn chế chưa xử lý được giữ trong review hiện hành.
