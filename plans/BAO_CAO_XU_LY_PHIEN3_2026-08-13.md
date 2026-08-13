# Báo Cáo Xử Lý Plan — HacDaoTruyen (Phiên 3, tiếp nối 2026-08-13)

> Tiếp nối `plans/BAO_CAO_XU_LY_2026-08-13.md` (phiên 2), xử lý 3 việc còn lại trong
> `plans/TONG_HOP_VAN_DE_2026-08-13.md`: custom UI Truyentrung, Request Novel Feature,
> ADK Multi-Agent Pipeline.

## Bối cảnh và cách tiếp cận

Trước khi bắt tay làm, đã đọc lại các plan cũ liên quan (`KE_HOACH_HOC_HOI_TRUYENTRUNG_2026-08-08.md`,
`plans/adk-agents/README.md`, `HOMEPAGE_PLAN.md`) và đối chiếu với git log để kiểm tra xem còn
đúng hiện trạng không. Phát hiện quan trọng: phần lớn kế hoạch "học hỏi UI Truyentrung"
(bảng xếp hạng, chip thể loại, bình luận mới nhất, khối thông báo) đã được triển khai ở các
commit trước đó — plan gốc ngày 08-08 đã lỗi thời, nên "custom lại theo ý riêng" không thể
suy đoán mà cần xác nhận lại phạm vi với người dùng. Tính năng Request Novel và pipeline ADK
đều là việc lớn, đụng tới bề mặt bảo mật công khai (đăng nhập, spam) hoặc luồng dịch sản xuất
— nên trước khi code, đã hỏi lại 3 câu hỏi ngắn để chốt phạm vi: (1) UI Truyentrung — tự rà
soát và sửa 1-2 vấn đề nhỏ an toàn; (2) Request Novel — bắt buộc đăng nhập + admin duyệt
trước khi vào hàng dịch; (3) ADK — chỉ làm Giai đoạn 1 (Foundation), mặc định tắt.

## Việc đã làm

**Rà soát UI Truyentrung** (commit `b8db3b5`) đọc qua 18 component trong
`frontend/src/pages/homepage/`. Phát hiện quan trọng nhất: `TruyenTrungChatboxWidget.jsx`
hiển thị một khối "BXH Tu Vi & Trực Tuyến" với 4 "thành viên online" — tên, điểm kinh
nghiệm, thời gian online — hoàn toàn hard-code giả, không lấy từ bất kỳ dữ liệu hay API
thật nào, trong khi widget này đang được render thật trên trang chủ. Đây là vi phạm trực
tiếp nguyên tắc "không bịa số liệu trong UI" mà dự án đã tuân thủ nhất quán ở mọi đợt nâng
cấp trước. Đã gỡ bỏ khối này, chỉ giữ lại phần chào mừng/nội quy chat (văn bản tĩnh, không
phải số liệu). Ngoài ra dọn 2 import icon không dùng ở hai widget khác. Không tìm thấy vấn
đề nhỏ, an toàn nào khác đáng sửa nên không mở rộng thêm phạm vi.

**Tính năng Request Novel** (commit `8d43716`) cho phép độc giả đã đăng nhập gửi URL truyện
Trung muốn được dịch, admin xem và duyệt/từ chối tại trang quản trị mới `/admin/requests`.
Vì dự án có hai bản triển khai song song bắt buộc phải khớp nhau — FastAPI backend dùng
SQLite cho phát triển cục bộ, và Cloudflare Worker dùng D1 cho môi trường sản xuất — tính
năng này được xây dựng ở cả hai nơi theo đúng khuôn mẫu đã có sẵn cho bookmark và bình luận,
thay vì tự sáng tạo cách làm mới. Để chống spam, mỗi người dùng chỉ được có tối đa ba yêu
cầu đang chờ duyệt cùng lúc. Quyết định thiết kế quan trọng nhất: hành động duyệt của admin
chỉ đổi trạng thái trong cơ sở dữ liệu, không tự động gọi scraper để crawl — vì scraper hiện
còn lỗi tiềm ẩn chưa được kiểm chứng với site thật (xem phiên 2), tự động hóa việc gọi URL
do người dùng cung cấp cũng tiềm ẩn rủi ro SSRF nếu không được kiểm soát chặt. Admin vẫn cần
tự chạy lệnh nhập truyện có sẵn sau khi duyệt. Về mặt giao diện, nút "Yêu cầu truyện mới"
được gắn thay cho hai nút trang trí cũ "Cửa Hàng"/"Xem bài đăng" vốn không có chức năng thật
— đúng theo tinh thần loại bỏ các yếu tố gamification/tiền ảo giả mà một kế hoạch trước đó
đã khuyến nghị không nên bê nguyên từ truyentrung.com.

**Nền tảng pipeline ADK** (commit `0b176e9`) hoàn thành Giai đoạn 1 theo đúng kế hoạch gốc:
tạo gói `agents/` bọc lại scraper và bộ dịch hiện có thành hai agent, nối tiếp nhau qua một
SequentialAgent của Google ADK, không viết lại logic dịch hay crawl mà chỉ gọi lại các hàm
đã có. Điểm mấu chốt về an toàn: toàn bộ pipeline này được kiểm soát bởi một biến môi trường
duy nhất, mặc định tắt, và khi tắt thì mã nguồn chạy đúng y hệt như trước khi có gói `agents/`
tồn tại — không có dòng hành vi dịch nào bị đổi khi không chủ động bật thử nghiệm. Thư viện
`google-adk` là phụ thuộc hoàn toàn tùy chọn, không được thêm vào danh sách phụ thuộc bắt
buộc của dự án, và mọi việc import nó đều được bọc để nếu thiếu thư viện, ứng dụng vẫn khởi
động bình thường thay vì bị sập.

## Cách verify

Ba phần việc được ba agent làm song song, sau đó tự chạy lại toàn bộ để xác nhận trước khi
commit thay vì chỉ tin báo cáo — thói quen này đã phát hiện lỗi thật ở phiên trước (agent bị
mất kết nối giữa chừng) nên tiếp tục áp dụng. Lần này không phát hiện lỗi tương tự, nhưng có
tự đọc qua các đoạn diff quan trọng nhất (route mới trong Worker, câu lệnh SQL, điểm rẽ nhánh
ADK) để xác nhận không có lỗ hổng SQL injection, route không bị route khác chặn trước, và
điểm rẽ nhánh ADK thực sự bọc bằng try/except đúng cách. Đã chạy `python3 -m py_compile` cho
toàn bộ file Python, `node --check` cho Worker, `npm run build` cho frontend (bundle build
thành công, trang quản trị mới tách chunk riêng), và toàn bộ bộ test tự động — bao gồm hai
bài test mới cho tính năng Request Novel mô phỏng đầy đủ luồng gửi yêu cầu, chặn spam, và
phân quyền admin. Ngoài ra phát hiện và tự sửa một lỗi nhỏ trong chính quá trình làm việc:
ba commit message đầu có dùng dấu backtick trong câu lệnh ví dụ, vô tình bị shell hiểu nhầm
thành lệnh thực thi khiến một phần nội dung bị mất — đã dùng `git rebase` để sửa lại đầy đủ
mà không làm thay đổi nội dung code đã commit.

## Giới hạn còn lại

Tính năng Request Novel chưa được thử trên trình duyệt thật và migration D1 mới chưa được
áp dụng lên Cloudflare sản xuất — cần chạy tay khi deploy. Pipeline ADK mới dừng ở Giai đoạn
1, chưa có Pass 2 cải thiện văn phong hay QC tự động, và chưa từng được chạy dịch thật vì
sandbox không có khóa API Gemini/DeepSeek — phần xác minh sâu nhất chỉ dùng scraper/bộ dịch
giả lập. Việc rà soát UI Truyentrung chỉ giải quyết một vấn đề rõ ràng nhất tìm được; nếu bạn
có ý cụ thể khác muốn tùy biến, vẫn cần nêu rõ để làm tiếp.

## Bảng chấm điểm độ hoàn thiện

| Hạng mục | Điểm (/10) | Ghi chú |
|---|---|---|
| Rà soát UI Truyentrung | 8 | Tìm và sửa đúng 1 vi phạm rõ ràng, không mở rộng phạm vi quá mức |
| Request Novel Feature | 7 | Đầy đủ 2 lớp (FastAPI + Worker) + test, nhưng chưa thử trình duyệt thật, chưa deploy D1 |
| ADK Foundation | 7 | Đúng phạm vi Giai đoạn 1, an toàn tuyệt đối cho production, nhưng chưa test dịch thật |
| Độ an toàn cho production hiện tại | 10 | Cả 3 thay đổi đều không đổi hành vi mặc định đang chạy |
| Kỷ luật verify & tự sửa lỗi | 9 | Tự phát hiện lỗi backtick trong commit message và sửa bằng rebase thay vì bỏ qua |

**Điểm tổng: 8.2/10.** Để đạt điểm tối đa cần: bạn tự mở trình duyệt kiểm tra tính năng
Request Novel, chạy migration D1 khi deploy, và khi có khóa API thật, thử dịch 1 chương qua
`ADK_ENABLED=true` để so sánh kết quả với luồng cũ trước khi cân nhắc dùng rộng rãi.
