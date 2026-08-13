# Báo Cáo Xử Lý Plan — HacDaoTruyen (Phiên 2026-08-13)

> Dựa trên commit mới nhất `a2b25ad` và file `plans/TONG_HOP_VAN_DE_2026-08-13.md`.

## Bối cảnh và cách tiếp cận

File `TONG_HOP_VAN_DE_2026-08-13.md` liệt kê 6 việc còn tồn đọng, chia theo ưu tiên
Cao/Trung bình/Thấp. Trước khi thực thi, phiên này đã khảo sát lại từng việc bằng một
agent đọc code độc lập, và phát hiện ra rằng mô tả rủi ro trong plan gốc chưa đầy đủ ở
hai điểm quan trọng: script tối ưu R2 (`migrate_to_cloudflare.py`) thực ra vẫn đang chạy
sản xuất hàng ngày qua cron dịch tự động (plan gốc ghi nhầm là "an toàn vì cron đã tắt"),
và việc gộp batch upload sẽ phải sửa cả Cloudflare Worker chứ không chỉ riêng script di
trú. Đồng thời, sandbox làm việc không có tài khoản Cloudflare đăng nhập và không có kết
nối mạng ra ngoài tới các trang truyện nguồn, nên hai việc ưu tiên Cao không thể được xác
minh bằng chạy thật — chỉ có thể xác minh tĩnh (dry-run, review code, unit test bằng dữ
liệu giả lập).

Với các giới hạn đó, người dùng đã được hỏi và xác nhận phạm vi thực thi: làm cả ba việc
kỹ thuật cụ thể (tối ưu R2, sửa bug scraper, code splitting frontend), còn ba việc còn
lại (custom UI Truyentrung theo ý riêng, ADK Multi-Agent Pipeline, tính năng Request
Novel) là việc lớn cần thiết kế/phạm vi riêng nên được gác lại, chỉ ghi nhận trong báo
cáo.

## Việc đã làm

**Code splitting frontend** (commit `c12a9aa`) chuyển các trang ít dùng — ba trang Admin,
EpubReader, EpubCatalogPage, AccountPage, LoginPage, Logs — sang `React.lazy()`, bọc bằng
một `<Suspense>` dùng chung, đồng thời tách component `EpubCard` ra file riêng để trang
chủ (luôn tải ngay) không kéo theo code của trang đọc EPUB (chỉ tải khi cần). Các trang
cốt lõi mà đa số người dùng cần ngay — trang chủ, trang truyện, thư viện, trang đọc
thường — vẫn giữ import tĩnh để tránh nháy loading không cần thiết. Việc này đã được
verify bằng một lần build thật (`npm run build`, né lỗi quyền ghi của sandbox bằng cách
build ra thư mục tạm): chunk JavaScript chính giảm từ khoảng 543KB xuống còn khoảng
424KB, và tám trang phụ giờ nằm trong các chunk riêng biệt (từ 0.3KB đến 62KB) chỉ được
tải khi người dùng thực sự vào các trang đó. Rủi ro của thay đổi này thấp vì không đụng
tới backend hay logic xác thực, và có thể rollback dễ dàng nếu cần.

**Sửa bug scraper novel543** (commit `baf9588`) khắc phục một lỗi logic thật trong
`scraper.py`: biến `is_blocked` từng bị gán cứng thành `True` cho mọi URL thuộc
novel543.com bất kể trang có thực sự bị chặn hay không, khiến hàm luôn bỏ qua HTML lấy
được để dùng đường fallback Jina Reader — và HTML dựng lại từ Jina không có thẻ `<a>` nên
bước lấy mục lục chương luôn trả về kết quả rỗng. Vì vậy tính năng nhập truyện từ
novel543.com gần như không hoạt động dù giao diện có vẻ chạy được. Bản sửa thay việc gán
cứng bằng một hàm phát hiện chặn dựa trên tín hiệu thật (mã trạng thái 403/503, từ khóa
chặn phổ biến trong nội dung, độ dài phản hồi bất thường), đồng thời cải thiện đường
fallback Jina để vẫn cố trích xuất được link chương dạng markdown nếu thực sự rơi vào
trường hợp bị chặn. Năm bài test mới dùng dữ liệu HTML giả lập tĩnh (không gọi mạng thật)
đều pass, xác nhận parser giờ lấy đúng số chương kỳ vọng thay vì luôn trả về không.

**Tối ưu batch upload R2** (commit `4271105`) thêm một chế độ mới hoàn toàn tùy chọn cho
`migrate_to_cloudflare.py`: cờ `--batch-upload` (mặc định tắt) gộp nhiều chương liên tiếp
thành một object JSON duy nhất trên R2 thay vì mỗi chương một lượt ghi riêng, giúp giảm
đáng kể số lượt thao tác R2 khi đồng bộ một truyện dài hàng nghìn chương. Vì cờ này mặc
định tắt và job cron sản xuất hiện tại không truyền cờ mới, hành vi đồng bộ hàng ngày
không thay đổi. Phía Cloudflare Worker (`src/index.js`) được bổ sung một đường đọc dữ
liệu từ bundle JSON, nhưng đường này chỉ được thử sau khi hai cách đọc cũ (theo khóa R2
lưu trong D1, và theo catalog.json) đã thất bại, nên dữ liệu hàng nghìn chương đã upload
theo cách cũ không bị ảnh hưởng. Đây là thay đổi có rủi ro cao nhất trong ba việc vì đụng
tới hạ tầng lưu trữ dữ liệu thật, nên toàn bộ phần xác minh chỉ dừng ở review code, chạy
thử bằng `--dry-run` trên dữ liệu mẫu tự tạo, và một bài kiểm tra chéo xác nhận cách mã
hóa tên file bằng base64 giữa Python và JavaScript cho ra kết quả khớp tuyệt đối — đây là
điểm dễ sai nhất nếu muốn dùng thật vì hai bên phải tính ra cùng một khóa tra cứu.

## Cách verify

Sau khi ba agent làm việc song song hoàn tất, đã tự chạy lại toàn bộ để xác nhận trước
khi commit thay vì chỉ tin báo cáo của agent: phát hiện agent phụ trách frontend bị mất
kết nối giữa chừng, để lại một import bị đứt (`SearchSection.jsx` vẫn import `EpubCard`
từ đường dẫn cũ) khiến build thất bại — đã tự sửa lại trước khi verify tiếp. Sau khi sửa,
đã chạy `npm run build` thật cho phần frontend, `python3 -m py_compile` cho toàn bộ file
Python đã sửa lẫn toàn bộ repo, `node --check` cho `src/index.js`, chạy lại 5 bài test
mới của scraper cùng toàn bộ bộ test có sẵn (8 bài pass, không tính `test_integration.py`
vốn cần dữ liệu truyện thật không có trong sandbox này), và tự tay dựng một novel mẫu để
chạy dry-run xác nhận chế độ batch-upload mới hoạt động đúng còn hành vi mặc định (không
truyền cờ mới) chạy y hệt như trước khi sửa.

## Giới hạn còn lại

Hai việc ưu tiên Cao (tối ưu R2, sửa scraper) chỉ được xác minh tĩnh, chưa chạy được với
Cloudflare hay các trang truyện nguồn thật do giới hạn của sandbox — trước khi coi là
hoàn thiện, cần người có quyền truy cập Cloudflare thật chạy thử `--batch-upload` trên
một truyện nhỏ rồi kiểm tra qua endpoint debug sẵn có, và người có kết nối mạng ngoài
chạy thử `main.py import --url` thật với novel543.com. Ba việc còn lại của plan gốc — tùy
biến giao diện theo phong cách Truyentrung, triển khai pipeline đa agent ADK, và tính
năng cho phép độc giả gửi yêu cầu dịch truyện — chưa được động tới vì đều là việc lớn cần
quyết định thiết kế/phạm vi cụ thể từ người dùng trước khi bắt tay vào làm.

## Bảng chấm điểm độ hoàn thiện

| Hạng mục | Điểm (/10) | Ghi chú |
|---|---|---|
| Code splitting frontend | 9 | Đã verify bằng build thật, giảm bundle rõ rệt. Trừ 1 điểm vì chưa đo further (vd Lighthouse) |
| Sửa bug scraper novel543 | 6 | Bug logic đã sửa đúng và có test, nhưng chưa xác nhận được với site thật |
| Batch upload R2 | 5 | Thiết kế an toàn, backward-compatible, nhưng hoàn toàn chưa test với hạ tầng thật |
| Độ an toàn cho production hiện tại | 10 | Cả 3 thay đổi đều không đổi hành vi mặc định/entry point đang chạy |
| Tổ chức & tài liệu hóa | 9 | Đã cập nhật plan gốc + báo cáo riêng, commit message đầy đủ |

**Điểm tổng: 7.8/10.** Để đạt điểm tối đa cần: chạy thử thật `--batch-upload` trên
Cloudflare + xác nhận qua endpoint debug, chạy thử thật scraper với novel543.com, và xử
lý ba việc còn lại của plan gốc sau khi có thêm quyết định từ người dùng.
