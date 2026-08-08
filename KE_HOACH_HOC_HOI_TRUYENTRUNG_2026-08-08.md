# Kế hoạch học hỏi trang chủ truyentrung.com cho HacDaoTruyen
*Tham khảo logic, bố cục, cách trình bày dữ liệu — không sao chép nguyên văn nội dung/thiết kế, chỉ học ý tưởng chức năng để áp dụng phù hợp quy mô HacDaoTruyen*

## Hiện trạng trang chủ HacDaoTruyen

Trang chủ hiện đã được tách thành 8 section độc lập trong `frontend/src/pages/homepage/`, điều phối bởi `HomePage.jsx`: tìm kiếm, vừa đọc gần đây, banner truyện nổi bật, truyện mới cập nhật (cuộn ngang), đang dịch, hoàn thành, tất cả truyện (có tab lọc), và thống kê tổng. Kiến trúc này đã khá tốt — mỗi section là 1 file riêng, dễ sửa mà không ảnh hưởng phần khác, và đã có sẵn một phần lấy cảm hứng từ truyentrung.com (comment trong `AllNovelsSection.jsx` ghi rõ "dùng kiểu tab giống truyentrung.com"). Dữ liệu hiện tại hoàn toàn thật — không có số liệu giả, đúng nguyên tắc đã thống nhất trước đó cho dự án.

Điểm thuận lợi: sau đợt merge gần đây, D1 đã có sẵn cột `views` và `rating`/`rating_count` (từ tính năng trackView/rateNovel), và Worker đã hỗ trợ sort theo `views`, `rating`, `chapter_count`, `title`, `updated_at` qua tham số `sort`/`order` của `/api/novels`. Nghĩa là nhiều ý tưởng "bảng xếp hạng" học từ truyentrung giờ có thể làm bằng dữ liệu thật, không còn là "giả tạo" như nhận định trong lần audit UX trước.

## Những gì đáng học từ truyentrung.com

Truyentrung.com là một nền tảng cộng đồng quy mô lớn (hàng nghìn truyện, hệ thống thành viên, tiền ảo, gamification), nên không phải mọi thứ đều phù hợp để bê nguyên sang một site tự host cá nhân như HacDaoTruyen. Dưới đây là các ý tưởng logic/bố cục đáng học, tách theo mức độ phù hợp.

**Đa dạng hoá cách xếp hạng thay vì chỉ 1 danh sách.** Thay vì gộp chung "tất cả truyện" vào một khối, trang chủ của họ tách thành nhiều bảng nhỏ theo tiêu chí khác nhau: mới cập nhật, lượt đọc nhiều, được đánh giá cao, sách mới nhất, đang thảo luận sôi nổi... mỗi bảng chỉ hiện top 5 kèm nút "Xem thêm". Cách này giúp người đọc lướt nhanh mà không bị choáng ngợp bởi 1 danh sách dài, và tận dụng đúng loại dữ liệu đã có sẵn cho từng góc nhìn.

**Bố cục dạng bảng (table) cho danh sách dài trên desktop.** Khi số lượng truyện tăng, hiển thị dạng bảng với các cột thể loại / tên truyện / tác giả / tình trạng / số chương giúp quét thông tin nhanh hơn nhiều so với grid card thuần, đặc biệt hữu ích khi người dùng đang tìm theo tiêu chí cụ thể (ví dụ lọc theo thể loại). Grid card vẫn nên giữ cho mobile vì bảng khó dùng trên màn hình nhỏ.

**Khu vực "tin tức/thông báo" nhỏ trên trang chủ.** Một khối ngắn thông báo tính năng mới, sự kiện, hoặc lưu ý vận hành — giúp người đọc quay lại biết trang có đang được chăm sóc, không cần xây hẳn hệ thống CMS phức tạp.

**Tận dụng dữ liệu cộng đồng đã có** (bình luận, đánh giá) để hiển thị "đang được bàn luận" hoặc bình luận mới nhất toàn site trên trang chủ — HacDaoTruyen đã có hệ thống comment/rating từ đợt merge trước, chỉ cần thêm 1 endpoint đọc tổng hợp thay vì xây mới.

**Phân loại theo thể loại rõ ràng ở trang chủ**, không chỉ trong trang thư viện — endpoint `/api/novels/genres` đã có sẵn, có thể thêm dải chip thể loại ngay dưới phần tìm kiếm để lọc nhanh.

## Những gì KHÔNG nên bê nguyên (không phù hợp quy mô/định hướng hiện tại)

Hệ thống gamification (điểm kinh nghiệm, cấp độ thành viên), tiền ảo mua tính năng ("Truy Thư Lệnh" để treo yêu cầu tìm truyện), và ứng dụng di động riêng trên App Store/Google Play đều là đầu tư cho một nền tảng thương mại hoá quy mô lớn với đội ngũ vận hành — không phù hợp với một site dịch truyện tự host cá nhân. Tab phân loại theo NGUỒN gốc truyện (Qidian/Fanqie/Faloo...) cũng cần tránh làm y hệt: dự án đã có quy tắc bảo mật cố ý không lộ `source_url` cho khách (tránh lộ nguồn crawl), nên nếu muốn phân loại kiểu này chỉ nên làm theo THỂ LOẠI, không theo nguồn crawl gốc.

## Kế hoạch cụ thể theo giai đoạn

**Giai đoạn A — Thêm 1-2 bảng xếp hạng bằng dữ liệu thật đã có (effort thấp, giá trị cao).** Thêm section mới `TopViewsSection`/`TopRatedSection` cạnh `StatsSection` hiện tại, gọi `/api/novels?sort=views&order=desc&limit=5` và `sort=rating`, hiển thị dạng danh sách gọn (số thứ tự + bìa nhỏ + tên + số liệu) thay vì card lớn. Không cần đổi API, không cần thêm cột D1 — chỉ thêm 1 component React mới theo đúng khuôn mẫu các section hiện có.

**Giai đoạn B — Thêm dải chip thể loại dưới ô tìm kiếm.** Gọi `/api/novels/genres` (đã có), hiển thị dạng chip cuộn ngang, bấm vào lọc `AllNovelsSection` theo thể loại đó (thêm state `activeGenre` bên cạnh `activeTab` hiện có). Việc lọc client-side vì toàn bộ 200 truyện đã tải sẵn ở `HomePage.jsx`.

**Giai đoạn C — Chế độ xem bảng (table) cho AllNovelsSection trên desktop.** Thêm nút chuyển "Dạng lưới / Dạng bảng" (chỉ hiện nút này khi màn hình đủ rộng, ẩn trên mobile), bảng gồm cột thể loại/tên/tác giả/tình trạng/số chương — tái dùng dữ liệu `filtered` đã có trong component, không cần gọi API thêm.

**Giai đoạn D — Khối "Bình luận mới nhất" trên trang chủ.** Cần 1 endpoint mới `GET /api/comments/recent?limit=5` ở Worker (hiện `commentsList` chỉ lọc theo 1 truyện/chương cụ thể), trả về comment mới nhất kèm tên truyện — hiển thị dưới `RecentlyReadSection` hoặc cạnh `StatsSection`. Việc này cần sửa Worker nên nên làm sau khi các phần thuần frontend ở giai đoạn A-C đã ổn.

**Giai đoạn E — Khối "Cập nhật/Thông báo" thủ công.** Đơn giản nhất: 1 file JSON tĩnh (`frontend/src/data/announcements.json`) admin tự sửa tay khi có thông báo, hiển thị 2-3 dòng mới nhất trên trang chủ — không cần bảng D1 mới, không cần trang quản trị riêng, phù hợp quy mô hiện tại. Nếu sau này cần nhiều hơn mới cân nhắc xây bảng `announcements` trong D1.

## Thứ tự ưu tiên đề xuất

A → B → C trước (đều là thay đổi frontend thuần, dùng lại API/dữ liệu sẵn có, rủi ro thấp, có thể làm và verify từng cái độc lập theo đúng kỷ luật commit-riêng-từng-phần đã áp dụng ở các đợt trước). D và E làm sau vì D cần sửa Worker, E cần quyết định thêm về việc có muốn duy trì thói quen cập nhật thủ công hay không.

Cho mình biết muốn bắt đầu thực thi từ giai đoạn nào — có thể làm A trước để thấy hiệu quả nhanh rồi quyết tiếp.
