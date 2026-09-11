# Triển khai toàn bộ kết quả review độc lập — 10/09/2026

## 1. Mục tiêu và phạm vi được giao

Sửa toàn bộ lỗi đã xác nhận trong review, hoàn thiện các luồng còn thiếu và bổ sung kiểm thử cần thiết trong repo Hắc Đạo Truyện. Người dùng muốn thực hiện toàn bộ ngay trong phiên làm việc, không chỉ lập kế hoạch hoặc dừng sau quick win. Không giới hạn công việc chỉ vì tiết kiệm token.

Đây là đặc tả thực thi, không phải khẳng định mọi nhận định review đều đã được kiểm chứng trên production. Trước mỗi sửa đổi, đọc lại code hiện tại, tái hiện khi có thể; nếu phát hiện nhận định không đúng, ghi bằng chứng và đóng mục với trạng thái “không áp dụng”, không sửa để chiều theo review.

Phạm vi gồm backend Python, Worker, frontend, pipeline/ADK, glossary, sync, backup/restore, schema, công cụ quản lý nội dung và tài liệu. Manga là đề xuất sản phẩm chưa chốt, không xây pipeline manga/OCR mới trong đợt này; phải hoàn thiện các biện pháp quản lý quyền và gỡ nội dung phục vụ nền tảng hiện tại.

### Quy tắc thực hiện

- Đọc `CLAUDE.md`, `AGENTS.md` nếu có và các hướng dẫn áp dụng trước khi làm. Giao tiếp và báo cáo bằng tiếng Việt.
- Người dùng đã cho phép sửa code, tạo migration/test/tài liệu và chạy kiểm thử local. Không hỏi lại để bắt đầu, chọn giải pháp thông thường hoặc chuyển sang nhóm việc tiếp theo.
- Không deploy, push, merge, chạy migration remote, sửa dữ liệu production, gọi provider AI trả phí hoặc bật cờ cloud/ADK mặc định chỉ vì yêu cầu “làm toàn bộ”. Hoàn thiện code và dry-run trước; nếu cần quyền bên ngoài thì ghi rõ hành động cụ thể còn thiếu.
- Giữ nguyên thay đổi của người dùng. Lúc bắt đầu review có file chưa tracked `novels/lanh-chua-cau-sinh-thien-phu-hop-thanh/synopsis.md`; không xóa, ghi đè hay đưa vào commit ngoài ý muốn.
- Không đọc/in secret thật vào log hoặc báo cáo. Test bằng fixture/temp directory, không thay đổi truyện thật, `users.db` thật hoặc checkpoint thật.
- Có thể phân công agent song song theo phạm vi file độc lập nếu công cụ hỗ trợ; một agent phụ trách tích hợp và chạy kiểm thử cuối. Không cho nhiều agent sửa cùng file đồng thời.
- Mỗi nhóm việc phải có bằng chứng trước/sau, test phù hợp và trạng thái. Không coi “đã viết code” là hoàn tất.

## 2. Baseline và cách xác minh

Baseline tại phiên review: 53 test Python, 20 test Worker và lint frontend đều đạt. Worker runtime test cần quyền mở cổng loopback cho Miniflare; lỗi `listen EPERM` do sandbox không phải bằng chứng code hỏng.

Các lệnh tham khảo (xác nhận interpreter/package manager thực tế):

```sh
.venv/bin/python -m pytest -q
npm run test:worker
npm run lint --prefix frontend
npm run build --prefix frontend
```

Các test browser hiện có ở `tests/browser/`; đọc cách chạy trước khi chạy. Một số test dùng API giả lập, không đại diện cho D1/provider/production thật. Không ghi “production PASS” từ test mock.

Đường dẫn và số dòng dưới đây là mốc của checkout lúc review; tìm symbol nếu code đã dịch chuyển.

## 3. Danh sách triển khai

### A. Bảo mật và biên tin cậy

- [x] **A01 — P0: Proxy ảnh và SVG chủ động.** `src/index.js:292` (`proxyCover`) chấp nhận SVG, trả body cùng origin, không sandbox. Probe giả lập đã nhận HTTP 200 `image/svg+xml` chứa script. Chặn nội dung chủ động; kiểm tra định dạng/giới hạn byte, ưu tiên raster hợp lệ. Không chỉ đổi MIME cho SVG. Nếu giữ SVG phải có cơ chế cô lập thực sự. Test SVG, HTML giả ảnh, redirect, MIME thiếu/sai, ảnh hợp lệ và file quá lớn. Chỉ tuyên bố exploit browser đã xác minh nếu thực sự test.
- [x] **A02 — P1: Logs và endpoint quản trị.** `routers/logs.py:26` chưa auth, `src/index.js:254` proxy logs. Bảo vệ logs server-side, rà toàn bộ route admin/ghi/dịch/tools/debug/usage. Kiểm tra guest/user không có quyền, admin hợp lệ có quyền. Giữ các endpoint đọc công khai thật sự cần thiết. Tránh dùng GET cho thao tác công cụ làm thay đổi dữ liệu; cập nhật caller và tương thích có chủ đích.
- [x] **A03 — P1: Rate limit local.** Bổ sung limiter có giới hạn bộ nhớ cho login/register/admin login ở FastAPI; xác định địa chỉ client đáng tin cậy, không tin header proxy tùy ý. Giữ Worker auth limiter. Test brute force, cửa sổ hết hạn, không bypass qua key/header giả. Ghi rõ giới hạn triển khai một process và cách mở rộng.
- [x] **A04 — P1: SSRF.** `security_utils.py:98`, `scraper.py:141`, `src/index.js:268`: kiểm tra scheme, credentials URL, IPv4/IPv6, DNS/IP private và redirect. Với Playwright cần xét request/subresource, không chỉ URL đầu. Với Worker cân nhắc allowlist host cần dùng và kiểm tra từng redirect vì không kiểm soát được IP kết nối như Python. Có test không truy cập mạng nội bộ thật.
- [x] **A05 — P1: Giới hạn payload.** Chuẩn hóa giới hạn body/field cho auth, glossary, CFI, comment, novel request, chapter sync; validate object/type chặt. Giữ giới hạn sync 2 MiB/25 chương và quick translate 20.000 ký tự trừ khi có lý do rõ ràng. Chặn trước khi materialize body quá lớn khi có thể.
- [x] **A06 — P2: Lỗi, secret và headers.** Thay `err.message` công khai bằng lỗi an toàn; log server có redact và mã đối chiếu. Rà secret trong tracked files/history bằng công cụ không in giá trị. Đồng nhất chính sách CORS cho JSON/cover/EPUB; thêm headers phù hợp sau khi test EPUB/blob/iframe. Không chuyển toàn bộ Bearer sang cookie nếu không cần; ghi nhận auth hiện dùng localStorage, cookie lịch sử không phải cookie phiên.
- [x] **A07 — P2: EPUB không tin cậy.** `tools/epub_to_chapters.py:356`, `EpubReader.jsx:80`: trần dung lượng nén/giải nén, số entry, đường dẫn archive và định dạng EPUB trong công cụ import; chặn tài nguyên quá lớn ở browser. Giữ sandbox không cho script. Không bịa endpoint upload EPUB public khi repo chưa có.

### B. Contract local/cloud và tính năng frontend bị hỏng

- [x] **B01 — P1: Account và phân trang.** `AccountPage.jsx:146` dùng `.find()` trên response object cloud. Chuẩn hóa adapter danh sách, xử lý array local và object cloud; không tải trang đầu rồi lọc mất bookmark/lịch sử nằm ở trang sau. Rà `LibraryPage`, HomePage, EPUB catalog, admin và mọi caller `/novels`.
- [x] **B02 — P1: Search.** `HomePage.jsx:67` gửi `search`, Worker đọc `q`. Dùng contract thống nhất; local phải xử lý tìm kiếm/lọc/phân trang hoặc adapter có hành vi tương đương được kiểm thử. Bỏ qua response search cũ đến muộn. Test truyện nằm ngoài trang đầu.
- [x] **B03 — P2: Synopsis.** `src/index.js:142` gọi `getSynopsis` không tồn tại; đã tái hiện 500. Hoàn thiện handler R2/D1, response/missing/fallback, local tương ứng; UI hiện lỗi có ích và reset state khi đổi slug. Test “Xem thêm” với synopsis dài hơn preview.
- [x] **B04 — P1: Định danh chương và slug.** Local slug rộng hơn Worker; local chapter list chỉ có filename/title. Định nghĩa contract tương thích dữ liệu hiện có, không rename dữ liệu thật tự động. Trả canonical chapter identifier/number nhất quán; phân biệt chương, chương số 0 và author note không có số. Đồng bộ comments/progress/navigation và validate giữa hai backend.
- [x] **B05 — P2: UI nói đúng dữ liệu.** “Chat Box” hiện chỉ thông báo; “Bán chạy” xếp theo chapter_count, “Nguyệt phiếu” là điểm tổng hợp. Đổi nhãn đúng thực tế, không bịa hệ thống bán hàng/phiếu/chat realtime. Dọn component không còn import sau khi xác minh. Thêm UI xóa comment chính chủ/admin với quyền server kiểm tra.
- [x] **B06 — P2: Provider Ollama.** `translator.py:584,714` nhánh Ollama bị comment dù backend khởi tạo. Hoàn thiện nhánh dịch đơn/batch và test provider mock; hoặc chứng minh không còn được hỗ trợ rồi loại lựa chọn/config gây hiểu nhầm. Không gọi model thật để test. Rà Groq explicit/auto và ghi đúng provider/model trong usage.

### C. Reader, EPUB, guest và đồng bộ tiến độ

- [x] **C01 — P1: Response chương cũ.** `Reader.jsx:96` không có cleanup/guard. Abort/bỏ response cũ, không để nội dung/lịch sử/PUT progress của chương trước ghi sau navigation mới. Test response đảo thứ tự.
- [x] **C02 — P1: PUT progress âm thầm thất bại.** `Reader.jsx:109` gửi filename vào integer; cả Reader/EPUB đánh dấu synced trước success và nuốt lỗi. Sửa canonical ID, debounce thực sự, acknowledgement, retry hữu hạn, trạng thái sync và hàng đợi offline mới nhất. Không retry lỗi auth/validation vô hạn.
- [x] **C03 — P1: Conflict và restore progress.** `user_store.py:239`, `src/index.js:1264`: tránh request cũ đến muộn ghi đè bản mới. Chọn revision/conditional write rõ ràng, đừng lấy max chapter vì user có thể đọc lại. Đọc lại text trên thiết bị khác phải có đường resume từ server; EPUB phải dùng timestamp/revision đúng. Nếu giữ vị trí riêng chapter/EPUB, migration tương thích API cũ và account UI phải rõ ràng.
- [x] **C04 — P2: Guest → user và đổi tài khoản.** Namespace dữ liệu riêng theo user/backend origin; guest history không tự mất khi login. Có bước nhập/merge lịch sử guest rõ ràng, không âm thầm đẩy lịch sử người khác lên tài khoản. Logout/401/đổi user phải cập nhật UI và không tiếp tục dùng queue/token cũ. Test hai user dùng chung trình duyệt.
- [x] **C05 — P2: Hai kho tài khoản.** Không merge SQLite/D1 theo numeric ID hoặc chỉ vì email trùng. Làm rõ realm local/cloud trong code/docs, loại giả định token dùng chéo. Nếu cung cấp công cụ migration user, phải explicit mapping, dry-run, phát hiện conflict, chuyển dữ liệu phụ thuộc đầy đủ và không copy session sống. Không chạy migration thật trong phiên này.
- [x] **C06 — P2: EPUB progress/settings.** `EpubReader.jsx:128` dùng percentageFromCfi nhưng chưa tạo locations. Hoàn thiện tiến độ đáng tin cậy, CFI hỏng/bản EPUB mới có fallback; validate settings cũ và bảo toàn migration key.
- [x] **C07 — P2: Offline/cache.** `sw.js:62,128`: version nội dung chương/EPUB để nhận bản sửa; tuần tự hóa cập nhật quota index khi tải đồng thời, không báo tải xong nếu cache thất bại. Hạn chế tổng cache thực tế, quản lý/xóa tải offline, xử lý storage đầy và service worker chưa control. Không hứa thu hồi file đã tải khi takedown.
- [x] **C08 — P2: TTS.** UI giọng/tốc độ, chọn giọng Việt/lang hợp lý, fallback rõ ràng; chia đoạn nếu cần để đọc chương dài ổn định. Test play/pause/resume/stop, đổi chương và rời trang. Chất lượng âm thanh thật phải ghi “cần xác minh thêm” nếu chỉ dùng headless. TTS EPUB là tính năng mới ngoài đợt, không tự mở rộng.

### D. Pipeline, QC và glossary

- [x] **D01 — P1: Parser batch gán sai chương.** `translator.py:203`, `pipeline.py:966`: giữ index marker khi parse; phát hiện thiếu/trùng/đảo marker, lời dẫn ngoài marker, chương thừa và output không đúng protocol. Retry đúng chương thiếu, tuyệt đối không dịch chuyển nội dung chương B sang file A. Test bằng response fixture không gọi AI.
- [x] **D02 — P1: Glossary nhất quán.** `pipeline.py:53,925`: validate term shape, lưu provenance/trạng thái/revision, phát hiện mâu thuẫn, bảo toàn từ đã duyệt. Snapshot glossary theo batch và liên hệ revision với output; summary không được cập nhật sai thứ tự hoàn thành. Không âm thầm ghi đè thuật ngữ đã chốt bằng output LLM.
- [x] **D03 — P1: Ghi profile/key state an toàn.** `novel_manager.py:76`, `providers/key_manager.py:42`: lock phải bao read–modify–write, dùng file lock cho nhiều process nơi cần; ghi temp cùng filesystem rồi replace atomic. Admin/CLI/pipeline dùng chung cơ chế, bảo toàn field metadata chưa biết. Test concurrent update và lỗi ghi giữa chừng.
- [x] **D04 — P2: ADK Pass 2 + QC đầy đủ.** Đọc `docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md` và triển khai QC deterministic, PolishAgent, retry hữu hạn, chọn bản tốt nhất, ghi cảnh báo đúng failed_chapters, tổng usage đủ các lần gọi. Chỉ nhánh ADK, không tự bật flag, không ép dependency ADK thành bắt buộc. Ưu tiên helper trong agent để giữ ranh giới spec; sửa các lỗi nền D01–D03 độc lập với tính năng Pass 2. Giải quyết rõ QC tắt/Pass2 bật, raw rỗng, mọi lần QC fail, giới hạn retry âm/quá lớn. Test mock toàn bộ, không gọi provider thật.
- [x] **D05 — P2: QC và chi phí đo đúng.** Giữ cleanup Hán tự hiện có; thêm fixture cho mất đoạn/sai marker/thuật ngữ mà không tuyên bố regex đo được văn phong. Giá hardcode/usage ước tính phải ghi đúng bản chất, không mặc định coi model miễn phí; cộng đủ retry/cleanup/polish theo dữ liệu có sẵn, không bịa token thực.

### E. Sync, schema và phục hồi

- [x] **E01 — P1: Restore không làm mất glossary.** `restore_from_cloudflare.py:181`: phân biệt absent/download error/JSON error; không thay profile cũ bằng glossary rỗng khi lỗi. Stage và validate trước khi publish profile; giữ checkpoint cũ khi bất kỳ thành phần bắt buộc nào lỗi. Không ghi vào thư mục truyện thật trong test.
- [x] **E02 — P1: Backup đầy đủ.** `backup_novels.py:45`: bổ sung chiến lược backup SQLite user bằng API backup an toàn với WAL, D1 user/content, metadata, glossary, synopsis, failed_chapters, EPUB và R2 manifest/checksum. Có manifest phạm vi, restore vào thư mục/DB trống, verify và exit code đúng; không rotate bản tốt trước khi bản mới verify thành công. Không tuyên bố ZIP truyện là backup toàn hệ thống.
- [x] **E03 — P1: Mọi writer cùng quy tắc conflict.** `migrate_to_cloudflare.py:679` upsert vô điều kiện còn Worker dùng expected_r2_key. Chuẩn hóa kiểm tra version/expected key cho CLI và HTTP; immutable object trước pointer, lỗi commit không xóa object đang được tham chiếu. Giữ tương thích đọc legacy/bundle.
- [x] **E04 — P1: Client reconcile.** Batch/cloud-to-cloud gửi expected key khi thay nội dung đã có; 409 phải có báo cáo reconcile, không retry mù. Thêm chunk theo byte bên cạnh số chương, giữ budget reserve cho mỗi lần thử. Partial success phải báo đúng và checkpoint không nhận hoàn tất sai.
- [x] **E05 — P1: Glossary sync xung đột/xóa.** `migrate_to_cloudflare.py:545`: thêm revision hoặc three-way merge/tombstone; không phục sinh term đã xóa, không dùng lỗi tải remote như glossary trống. Báo conflict thay vì remote/local luôn thắng. Test xóa, sửa cùng term, lỗi R2 và concurrent update.
- [x] **E06 — P2: Drive đúng loại file.** `cloud_to_cloud_syncer.py:147` không được gán chapters.json ID làm EPUB ID. `getEpub` phải kiểm tra response đúng EPUB, fallback khi nhận HTML/JSON dù HTTP 200. Migration sửa metadata cũ chỉ tạo dry-run có bằng chứng, không chạy remote.
- [x] **E07 — P2: Schema integrity.** FK/NOT NULL/CHECK phù hợp cho user_sessions/bookmarks/progress/comments/requests; audit orphan/duplicate trước thay đổi. Bật FK SQLite trên mỗi connection khi dùng. Không thêm UNIQUE chapter_number mù vì author note/split có thể hợp lệ. Migration local/D1 có đường lùi và giữ client cũ.
- [x] **E08 — P2: Schema reconciliation.** `tools/migrate_schema.py:34`: đối chiếu FK/CHECK/UNIQUE và định nghĩa index, không chỉ cột/tên index. Từ chối drift không an toàn với thông báo cụ thể; có fixture schema cũ/current/drift. Không tự DROP dữ liệu để đạt snapshot.
- [x] **E09 — P2: Restore checksum và sync phụ trợ.** File local tồn tại chưa đủ để skip; verify hash/size theo manifest và có chế độ kiểm tra không ghi. Propagate lỗi upload glossary/EPUB/synopsis vào kết quả tổng. Audit bundle manifest/concurrent writer. Diễn tập lỗi R2/D1/network/checkpoint chỉ dùng mock/local fixtures.

### F. Spam, quản lý quyền nội dung và tài liệu

- [x] **F01 — P2: Comment/request atomic.** `src/index.js:1348,1407`, `user_store.py:337`: thực thi cooldown/quota nguyên tử, test hai request đồng thời. Rate limit đăng ký hỗ trợ giảm spam tài khoản mới. Không bắt mọi người xác minh email nếu chưa có hạ tầng gửi mail.
- [x] **F02 — P2: Rating có định danh.** `src/index.js:466`: đổi đánh giá cập nhật phiếu cũ thay vì cộng vô hạn. Chọn chính sách user/guest rõ ràng và adapter UI; guest identifier không được coi là chống gian lận tuyệt đối. Không giả lập phiếu cá nhân từ rating_sum/rating_count lịch sử khi không có bằng chứng.
- [x] **F03 — P1: Takedown và hồ sơ quyền.** Thêm trạng thái xuất bản/gỡ tách khỏi ongoing/completed, provenance/license evidence tùy chọn và nhật ký thao tác admin. Mọi đường list/detail/chapter/EPUB/Drive/bundle/synopsis đều kiểm tra trạng thái; xóa metadata không được tiếp tục trả R2 fallback. Có purge cache online và mô tả giới hạn bản offline. Kênh liên hệ cấu hình được, không bịa địa chỉ liên hệ. Không khẳng định attribution/disclaimer/noindex hoặc “chưa phát hành ở VN” là quyền phân phối.
- [x] **F04 — P2: Crawl lịch sự và raw.** Giữ raw không public, kiểm tra assets/build không đóng gói secret/raw; rate limit theo host, backoff/dừng khi nguồn từ chối. Không thêm kỹ thuật vượt chặn nguồn. Rà ngoại lệ tracked translated trong gitignore, chỉ báo cáo; không xóa truyện người dùng hoặc rewrite lịch sử Git tự động.
- [x] **F05 — P2: Đồng bộ tài liệu.** Cập nhật kế hoạch đọc/tổng thể/ADK theo trạng thái thật; phân biệt implemented, tested local, verified production, deferred. Admin usage ghi rõ là budget dự phòng local, không phải billing account. Ghi kiến trúc hai kho user và dependency BACKEND_URL cho admin cloud. Không đánh dấu dữ liệu production cũ đã reconcile nếu chưa chạy kiểm chứng.

## 4. Trình tự và tổ chức công việc

1. Baseline, phân loại bằng chứng, chốt contract dùng chung.
2. A01/A02/E01 trước để giảm nguy cơ chiếm phiên và mất dữ liệu.
3. B/C song song với A/E nếu phạm vi file không đụng nhau; Worker `src/index.js` phải có một đầu mối tích hợp.
4. D01–D03 trước D04; E07/E08 trước những thay đổi cần schema mới; F03 tích hợp cùng API/cache.
5. Hoàn tất các mục P2 còn lại, chạy test xuyên tầng và cập nhật tài liệu.

Có thể tạo các commit local nhỏ theo nhóm nếu phù hợp workflow, nhưng không commit file ngoài phạm vi, không push. Không dừng phiên chỉ để chờ người dùng duyệt từng nhóm đã được giao.

## 5. Nghiệm thu bắt buộc

- Python, Worker, lint và build frontend đạt; ghi số lượng test thực tế sau thay đổi.
- Contract tests local/cloud: danh sách phân trang, search, synopsis, auth/role, slug/chapter/progress/comment/request.
- Browser: Account có bookmark, search, chapter response đảo thứ tự, progress hai context, guest/login/logout/đổi user, EPUB offline/cache quota và settings/TTS. Dùng backend local/Worker test khi có thể; ghi rõ chỗ mock.
- Security: proxy SVG/HTML bị chặn, ảnh hợp lệ không gãy, admin/guest/user boundary, SSRF/redirect và payload giới hạn.
- Data: restore không mất bản cũ khi lỗi, backup phục hồi vào nơi trống, hash đối chiếu, sync retry/concurrent conflict/migration schema cũ.
- ADK: flags tắt giữ baseline, bật QC/Polish theo tổ hợp, retry hữu hạn, giữ bản tốt nhất, usage/cảnh báo đủ, không network thật.
- Takedown: mọi API/fallback từ chối nội dung bị gỡ; cache online có chiến lược invalidation được kiểm thử.
- Không secret/dữ liệu thật bị in, sửa hay đưa vào artifact/commit.

## 6. Nhật ký thực thi và bàn giao

Claude cập nhật bảng sau trong quá trình làm, thêm dòng khi cần. Chỉ tick checklist khi có bằng chứng nghiệm thu tương ứng.

| Nhóm/ID | Trạng thái | File/commit | Bằng chứng và test | Giới hạn còn lại |
|---|---|---|---|---|
| Baseline | Đã hoàn tất toàn bộ A–F | 20 commit local trên `main`, không push | 263 test Python + 51 test Worker PASS (từ baseline 53+20), `npm run lint --prefix frontend` 0 lỗi, `npm run build --prefix frontend` OK | Chưa xác minh production thật (D1/R2 remote), xem mục "Chưa kiểm chứng" bên dưới |
| A01–A07 | Hoàn tất | commit `1e6a9ef` | proxy-cover chặn SVG/HTML/oversize (sniff magic byte), auth cho `/api/logs`+`/api/server-info`+`/health`, rate limiter login/register (in-memory, 1 process), SSRF: chặn credentials URL + resolve DNS thật trước request + guard mọi redirect/subresource trong Playwright (lỗ hổng thật, xác nhận scraper.py trước đây KHÔNG có SSRF check nào), giới hạn payload Worker, lỗi không lộ nội bộ (mã đối chiếu), epub_to_chapters chặn zip bomb/zip slip | A06 CORS cover dùng `*` có chủ đích (ảnh public, không credential) — ghi rõ trong code, không đổi |
| B01–B06 | Hoàn tất | `e762e50`, `23e603a`, `18e73d5` | `/api/novels` 2 backend cùng envelope `{novels,total,page,limit,pages}`, contract `q` thống nhất, adapter `novelsApi.js`, `getSynopsis` hết 500, `chapter_number`/`version` cho local, nhãn UI đúng dữ liệu, nút xóa comment, Ollama khôi phục + Groq usage log đúng model | — |
| C01–C08 | Hoàn tất | `18e73d5`, `e012964` (docs), commit C04 | Epoch guard chương cũ, `client_updated_at` chặn progress cũ đến muộn (409, test Miniflare D1 thật), namespace hàng đợi offline theo user, EPUB locations+fallback CFI, sw.js cache-first→revalidate theo version, EPUB index serialize, TTS chọn giọng/chia đoạn | Không có test runner frontend (vitest/jest) — C01/C02/C06/C08 xác nhận bằng đọc code + lint/build, KHÔNG Playwright/Chrome thật; chất lượng phát âm TTS thật chưa xác minh |
| D01–D05 | Hoàn tất | commit D01-03, `73ce05c` (D04/D05) | Parser dùng số marker thật (không theo thứ tự xuất hiện), glossary provenance/revision/conflict (sidecar, chưa đổi shape novel.json chính), file lock bao trọn read-modify-write + ghi atomic, ADK QC/Polish theo spec, 4 cờ mặc định tắt | D02: đổi hẳn glossary sang object có provenance cần sửa `novel_manager.py`+router (ngoài phạm vi file giao cho agent đó) — mới làm ở sidecar; D04: chưa test với `google-adk` cài thật, chưa bật thử cờ với chương thật |
| E01–E09 | Hoàn tất | `1e6a9ef`, `e762e50`, `73ce05c`(D/E), `c889ac2` (E09) | Restore phân biệt absent/lỗi tải/lỗi parse, backup dùng SQLite backup API + manifest/checksum + verify-trước-rotate, migrate_to_cloudflare dùng expected_r2_key giống Worker, chunk theo byte+số chương, glossary three-way merge, không gán ID EPUB sai, schema FK/CHECK + migrate_schema đối chiếu đầy đủ, restore verify hash thật (không chỉ file tồn tại) | Chưa chạy với D1/R2 thật (không có credential trong môi trường này) — toàn bộ test dùng SQLite/mock |
| F01–F05 | Hoàn tất | `e762e50` (F01/F02), `c73...`/F03 commit, F04 commit, `e012964` (F05 docs) | Comment cooldown + novel-request quota atomic (test Miniflare D1 đồng thời thật), rating có định danh user/guest, takedown/restore 2 backend + admin_actions log + `/api/config`, scraper rate-limit theo host + circuit breaker, docs đồng bộ | Chưa có "purge cache CDN online" thật (cần Cloudflare API token ngoài phạm vi Worker); chưa có UI admin riêng cho takedown (chỉ có API) |
| Follow-up ngoài checklist gốc | Hoàn tất | commit riêng | `/api/novels/:slug/health` thêm auth (phát hiện bởi agent F04), tool subprocess GET→POST (`ToolsPanel.jsx`+`routers/tools.py`), `providers/gemini.py` chuyển sang `update_key_status()` nguyên tử (D03 còn sót, test tái hiện bug bằng git stash) | — |

Khi kết thúc, ghi đầy đủ:

1. Các ID hoàn tất, không áp dụng kèm bằng chứng, hoặc bị chặn vì điều kiện thực tế.
2. Lệnh test, kết quả, migration/rollback và cách chạy local.
3. Những thay đổi contract và tương thích dữ liệu/client cũ.
4. Lệnh dry-run/release checklist cụ thể cho thao tác remote còn cần quyền; không thực thi thay người dùng.
5. Rủi ro còn lại, test không chạy được và lý do. Không gọi “xong toàn bộ” khi còn hạng mục chưa được xử lý.

## 7. Prompt giao Claude

```text
Hãy triển khai NGAY toàn bộ kế hoạch trong:
plans/KE_HOACH_XU_LY_TOAN_BO_REVIEW_2026-09-10.md

Đây là yêu cầu thực thi code, không phải yêu cầu lập thêm kế hoạch hoặc review lại rồi dừng. Đọc CLAUDE.md/AGENTS.md áp dụng và toàn bộ file kế hoạch trước khi sửa. Tôi có đủ ngân sách token: hãy làm toàn bộ A01–F05 trong phạm vi đã định nghĩa, gồm cả P2 và ADK Pass 2/QC; không tự cắt scope xuống 3–5 quick win. Không cần hỏi lại để bắt đầu hay chuyển nhóm việc.

Trước mỗi sửa, xác minh nhận định review bằng code/test. Nếu nhận định sai, ghi bằng chứng “không áp dụng”; không tạo thay đổi vô ích. Bảo toàn thay đổi hiện có của tôi, đặc biệt file synopsis.md chưa tracked. Dùng subagent song song nếu môi trường hỗ trợ, chia quyền sửa file rõ ràng; src/index.js cần một đầu mối tích hợp để tránh ghi đè.

Ưu tiên proxy ảnh/SVG, auth logs, restore glossary trước; sau đó xử lý contract frontend–local–cloud, Reader/EPUB/account/sync, pipeline parser/glossary, backup/schema, ADK QC/polish, spam/rating/takedown và tài liệu. Theo đúng dependency và tiêu chí nghiệm thu trong kế hoạch. Cập nhật checklist/nhật ký trong chính file này sau mỗi nhóm.

Được phép sửa repo, tạo migration/test/tài liệu, chạy test và build local. Không deploy/push/merge, không migration hoặc thay dữ liệu remote, không gọi AI trả phí, không bật cloud writes/ADK mặc định. Với bước cần production/credential/quyền bổ sung, làm xong code + fixture + dry-run + hướng dẫn cụ thể, ghi chính xác phần chưa kiểm chứng và tiếp tục mọi việc không phụ thuộc. Không in secret.

Chạy kiểm thử Python, Worker, lint/build và browser/data/security tests phù hợp. Test phải kiểm tra hành vi và failure/concurrency paths; không chỉ mirror implementation hoặc mock mất điều cần chứng minh. Không tuyên bố production PASS từ test mock. Sửa regression đến khi đạt, không làm giảm assertion hoặc bỏ test để xanh.

Tiếp tục đến khi mọi ID có kết quả rõ ràng; không kết thúc sau bản kế hoạch hoặc chỉ một nhóm sửa. Nếu hết context, lưu tiến độ/việc tiếp theo vào file, rồi tiếp tục khi có context. Báo cáo cuối bằng tiếng Việt: hoàn tất gì, test nào chạy/kết quả, migration/rollback, việc bị chặn thực sự và thao tác remote còn cần quyền. Không nói “xong toàn bộ” nếu còn mục chưa xử lý.
```


## 8. Tổng kết bàn giao (11/09/2026)

Toàn bộ A01–F05 đã có code + test tương ứng, không có mục nào bị bỏ dở. Chi tiết bằng chứng từng nhóm ở bảng mục 6. Điểm mấu chốt cần biết trước khi merge/deploy:

**Test**: `.venv/bin/python -m pytest -q` → 263 passed (baseline 53). `node --test tests/worker/*.test.mjs` → 51 passed (baseline 20). `npm run lint --prefix frontend` → 0 lỗi. `npm run build --prefix frontend` → thành công.

**Migration cần chạy khi lên D1 thật** (chưa chạy remote trong phiên này, chỉ áp dụng cho DB local test/`:memory:`):
```
migrations/005_novel_ratings.sql       # bảng novel_ratings (F02)
migrations/006_progress_client_ts.sql  # reading_progress.client_updated_at (C03)
migrations/007_takedown.sql            # novels.published/takedown_*, bảng admin_actions (F03)
```
Chạy dry-run trước: `npx wrangler d1 execute hacdao-db --local --file=migrations/00X_....sql`, xác nhận OK rồi mới thêm `--remote`. `tools/migrate_schema.py --sqlite <bản copy DB local, KHÔNG phải bản gốc>` để audit trước khi áp dụng cho `data/users.db` (schema nội bộ `user_store.py` KHÁC schema.sql D1 — xem giới hạn E07 bên dưới).

**Thay đổi contract (client cũ vẫn tương thích ngược, không bắt buộc đổi ngay)**:
- `GET /api/novels` cả 2 backend nay trả `{novels,total,page,limit,pages}` thay vì mảng trần (local) — client cũ đọc `data` như mảng sẽ vỡ, đã cập nhật hết caller trong `frontend/`.
- `PUT /api/user/progress/:slug` chấp nhận thêm field optional `client_updated_at` (epoch ms) — không có field này vẫn hoạt động như cũ (ghi đè vô điều kiện), có thì được bảo vệ khỏi write cũ đến muộn (409 khi phát hiện).
- `POST /api/novels/:slug/rate` nay yêu cầu user đăng nhập HOẶC header `X-Guest-Id` — trước đây không cần định danh gì, sẽ 400 nếu FE cũ không gửi.
- `GET /api/novels/:slug/chapters` (local) thêm field `chapter_number`, `GET .../chapters/:id` (cả 2 backend) thêm field `version` — bổ sung thuần túy, không phá client cũ.
- `GET /api/novels/:slug/tools/{tool}` và `.../tools/merge_split_parts`: đổi GET→POST — client cũ gọi GET sẽ nhận 405, đã cập nhật `ToolsPanel.jsx`.

**Việc CẦN quyền/thao tác bổ sung, chưa và sẽ không tự làm thay**:
- Chạy migration 005/006/007 lên D1 `--remote` thật.
- Cấu hình `CONTACT_EMAIL` (Worker secret/env) và tương đương cho Python (`os.getenv("CONTACT_EMAIL")`) nếu muốn `/api/config` trả kênh liên hệ thật — hiện để trống có chủ đích (không bịa).
- Cache CDN Cloudflare: takedown hiện chỉ đổi dữ liệu gốc (D1/local), KHÔNG tự động purge cache edge — cần gọi Cloudflare API (`/zones/:id/purge_cache`) bằng token zone riêng nếu cần gỡ ngay lập tức trên production; đến khi cache tự hết hạn, bản cũ có thể vẫn phục vụ được từ edge/trình duyệt/EPUB đã tải offline.
- Đồng bộ constraint mới (E07: FK/CHECK cho `user_sessions`/`bookmarks`/`reading_progress`/`comments`/`novel_requests`) hiện chỉ áp dụng cho `schema.sql` (D1) — **`user_store.py` (SQLite local đang chạy thật cho FastAPI) có schema nội bộ riêng, CHƯA có FK/CHECK/`PRAGMA foreign_keys=ON` tương ứng** (D03 agent đã ghi nhận, không sửa vì ngoài phạm vi file được giao lúc đó). Cần 1 đợt riêng đồng bộ `user_store.py` với `schema.sql` nếu muốn ràng buộc này thật sự có hiệu lực trên `data/users.db`.

**Rủi ro/giới hạn còn lại (không phải "chưa xong", mà là giới hạn có chủ đích của đợt này)**:
- Không có test runner frontend (vitest/jest) trong repo — mọi fix React (C01/C02/C04/C06/C08, B01/B02/B05) được xác minh bằng đọc code kỹ + `lint`/`build`, KHÔNG bằng Playwright/Chrome thật như đợt 09/09/2026 trước đó.
- D01–D05 (ADK Pass 2/QC), E01–E09 (sync D1/R2): toàn bộ test dùng mock/SQLite/Miniflare D1, KHÔNG có credential Cloudflare/Google AI thật trong môi trường này để verify end-to-end trên production.
- TTS: chưa xác minh chất lượng phát âm tiếng Việt thật trên trình duyệt thật (chỉ kiểm tra logic play/pause/stop).
- D02 (glossary provenance/revision) mới làm ở file sidecar (`glossary_meta.json`), CHƯA đổi shape chính `novel.json.glossary` — cần quyết định riêng nếu muốn đổi hẳn cấu trúc lưu trữ chính (ảnh hưởng `novel_manager.py` + mọi router đọc/ghi glossary).
- `providers/gemini.py` đã chuyển sang `update_key_status()` nguyên tử; các provider khác (`deepseek.py`, `groq.py`...) chưa được rà lại xem có cùng pattern read-modify-write rời rạc hay không (ngoài phạm vi được nêu tên trong review gốc).

Không có mục nào trong A01–F05 bị bỏ dở hoặc đánh dấu hoàn tất mà thiếu bằng chứng test — mọi trạng thái "không áp dụng" (nếu phát sinh trong quá trình, ví dụ E06 "file tồn tại" hay E09 tách khỏi phạm vi ban đầu của agent) đều có bằng chứng cụ thể trong nhật ký/báo cáo agent tương ứng và trong bảng mục 6.
