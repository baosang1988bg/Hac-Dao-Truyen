# Nghiệm thu và chuẩn bị phát hành — 09/09/2026

## Trạng thái

Đã triển khai phase 0–6 và hoàn thiện công cụ/kiểm thử local của phase 7. Chưa deploy, áp dụng schema remote, chạy workflow_dispatch, đối soát dữ liệu thật hoặc backfill. Không coi kết quả local là bằng chứng production.

| Kiểm tra | Kết quả |
|---|---|
| Cài mới Python 3.11 từ `requirements-dev.lock` | Pass trong venv sạch, cài offline từ cache |
| `python -m pytest -q` | 46 pass, 1 cảnh báo Starlette/AnyIO deprecation |
| `npm run test:worker` | 12 pass, gồm Miniflare D1/R2, lỗi một phần, đồng thời và rate limit |
| `npm run lint --prefix frontend` | 0 lỗi / 0 cảnh báo |
| `npm run build --prefix frontend` | Pass |
| Chrome smoke local/cloud | Trang chủ, đọc/chuyển chương, admin login/dashboard/danh sách/chi tiết, EPUB và unmount; API giả lập |
| `wrangler deploy --dry-run` | Pass, bundle local; không upload/deploy |
| Cloudflare management | `whoami` pass; subscription GET trả 403 sau kiểm tra lại OAuth |

Browser smoke đã phát hiện lỗi admin dùng `.filter`/`.map` trực tiếp trên response phân trang. Sửa adapter admin tải đủ các trang; fixture cloud có hai trang và kiểm tra truyện trang thứ hai. Kiểm thử trước đó chỉ chuyển qua dashboard rất nhanh nên chưa luôn bắt được lỗi này. Log API giả lập đã sửa về array đúng contract FastAPI.

Restore đã sửa thêm lỗi báo thành công khi tải thiếu chương: giữ checkpoint cũ của truyện lỗi và exit 1. Các file chương tải thành công vẫn được giữ để lần sau tiếp tục; file đã tồn tại được bỏ qua, chưa chứng minh checksum.

## Đối soát offline

`tools/reconcile_exports.py` chỉ đọc snapshot JSON local, không kết nối cloud, không xóa hoặc sửa dữ liệu. Input một slug:

```json
{
  "slug": "demo",
  "chapters": [{"filename":"1.md","chapter_number":1,"r2_key":"demo/content/hash.md"}],
  "catalog": [{"filename":"1.md","chapter_number":1}],
  "object_keys": ["demo/content/hash.md"],
  "manifest": {},
  "bundles": {}
}
```

`chapters` là hàng chỉ mục D1, `catalog` là mục lục legacy. `object_keys` phải là inventory đầy đủ của slug tại cùng thời điểm; tool không tự lấy inventory. Nếu có bundle, `manifest` ánh xạ filename → bundle key, `bundles` ánh xạ bundle key → nội dung JSON đã tải (khóa chương base64url như reader).

```sh
python tools/reconcile_exports.py /path/to/snapshot.json > /tmp/reconciliation.json
```

Exit 1 khi có thiếu index, thiếu nội dung, số chương khác nhau, filename D1 trùng hoặc bundle chưa kiểm tra. Thiếu catalog đơn thuần không phải lỗi vì sync mới không tạo catalog. Object riêng chỉ được kiểm tra tồn tại trong inventory, chưa xác minh hash/body. Key không được tham chiếu chỉ là ứng viên kiểm tra, không phải danh sách được phép xóa. Nguồn Drive không được xác minh bởi công cụ này.

Báo cáo fixture là bằng chứng thuật toán, không phải kết quả đối soát production. Sau khi được phép lấy snapshot thật, lập danh sách slug và phạm vi cần bổ sung chỉ mục/nội dung từ báo cáo; không chạy lại toàn kho theo suy đoán.

## Quy trình rollout còn lại

1. Xác minh billing/gói/mức sử dụng để đáp ứng điều kiện không phát sinh phí. OAuth hiện không đọc được subscription; cần thông tin từ Dashboard hoặc quyền đọc phù hợp. Chưa xác định nguồn khoản $9 trước đây.
2. Ghi nhận Worker version đang chạy; dừng writer, lấy snapshot schema/data/state đúng tài nguyên và bảo toàn R2. D1 read/export, R2 inventory/get cũng là thao tác cloud, cần xem chi phí trước.
3. Chạy schema preflight, xem diff; chỉ apply bổ sung tương thích sau backup. Cờ `HACDAO_ALLOW_CLOUD_WRITES=true` cần đặt rõ cho remote apply.
4. Deploy reader/Worker, mặc định sync và Drive cache write vẫn tắt. Kiểm tra admin/độc giả, schema và binding rate limit thật trong phạm vi được phép.
5. Cấu hình key/budget và opt-in cho một slug fixture, gửi các chunk/retry, đối chiếu nội dung và chỉ mục. Giữ một writer, không bật nhiều branch/máy dùng budget độc lập.
6. Thử workflow success/no-change/failure rồi mới bật lịch. Chỉ backfill theo báo cáo đối soát đã kiểm tra.

Rollback: dừng syncer trước; chỉ quay về Worker tương thích schema mới. Code rollback không khôi phục D1/R2. Giữ key cũ và snapshot, không tự prune object.

## Giới hạn còn mở

- Phiên admin/job Python vẫn ở bộ nhớ, một process, mất khi restart.
- Rate limit binding thật chưa cấu hình/xác minh; Map và ngân sách local không phải giới hạn billing toàn account.
- Bundle/migrate trực tiếp cần một writer mỗi slug; legacy muốn thay key qua API phải dùng `expected_r2_key` phù hợp.
- Chưa kiểm thử trực tiếp provider dịch, Drive OAuth và hành vi dữ liệu production.
- Chưa có báo cáo security audit dependency mới; không suy ra dependency an toàn chỉ vì đã khóa phiên bản.
