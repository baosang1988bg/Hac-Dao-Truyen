# Kế hoạch: nâng cấp hệ thống name theo bài học sangtacviet — 2026-11-26

Nhánh: `feature/competitor-learnings` (nối tiếp đợt lượt đọc/góp ý name). Không chạm production.

## Bối cảnh

sangtacviet giữ chữ Hán cho từng từ ngay trong nội dung (`<i t= h= v= p=>`), nên người đọc sửa name đúng theo khoá gốc. Bản dịch AI của HacDaoTruyen chỉ có tiếng Việt, nhưng pipeline dịch ĐÃ trả `new_glossary` (zh → vi) cho mỗi batch và gộp vào `glossary.json` (R2). Vì vậy không cần đổi prompt AI: **đảo ngược glossary (vi → zh) là đủ** để Reader biết chữ Hán của phần lớn tên riêng. Đổi prompt để AI xuất danh sách tên theo từng chương bị loại khỏi đợt này: tốn token, đụng parser + sync, trong khi glossary đã chứa đúng thông tin đó.

## Hạng mục (xếp theo giá trị / độ khó)

| # | Hạng mục | Nơi làm | Độ khó |
|---|---|---|---|
| 1 | `GET /api/novels/:slug/names` — chỉ mục vi → zh từ glossary R2 (edge cache 1 giờ) | Worker | Thấp |
| 2 | Hộp sửa name: tự tra chữ Hán của cụm đang chọn, tự điền "chữ gốc" khi góp ý → duyệt là ghi thẳng glossary | Frontend | Thấp |
| 3 | Chọn nhanh kiểu viết hoa (5 kiểu như STV) + nút mở rộng cụm sang trái/phải một từ | Frontend | Trung bình |
| 4 | Quy tắc thay thế khớp nguyên từ (ranh giới chữ Unicode), cờ `whole`; quy tắc cũ giữ khớp chuỗi con | Frontend + Worker | Thấp |
| 5 | Xuất/nhập gói name cá nhân theo truyện (JSON) | Frontend | Thấp |
| 6 | Công cụ kiểm tra tên nhất quán: thuật ngữ glossary có trong bản gốc nhưng bản dịch không dùng đúng tên → báo cáo | Python `tools/name_consistency.py` | Trung bình |

Không làm đợt này: gợi ý âm Hán Việt (máy Mac không có `tools/converter/data/chinese_phienam.txt`; cần quyết nguồn dữ liệu + giấy phép), áp quy tắc bằng `eval` như STV (rủi ro bảo mật), tự sync báo cáo nhất quán lên R2 (ghi production).

## Quyết định cần biết

Endpoint #1 công khai toàn bộ cặp vi → zh của glossary (trước đây glossary chỉ admin xem). Nội dung này không bí mật (STV cũng công khai name) nhưng người khác có thể tải glossary của bạn. Muốn tắt: đặt biến Worker `PUBLIC_NAMES=off`.

## Verify

Worker test (miniflare), frontend `node --test`, pytest cho công cụ #6, eslint + vite build; review độc lập sau khi xong; báo cáo + WORKLOG.
