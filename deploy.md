# Deploy runbook — HacDaoTruyen

File này là checklist deploy sống — mỗi lần chuẩn bị deploy hoặc vừa deploy xong, cập nhật lại phần "Cần làm trước lần deploy tiếp theo" và ghi thêm 1 dòng vào "Lịch sử deploy" bên dưới. Khi bạn nói "deploy", đây là file được tra cứu/cập nhật trước tiên.

## Cần làm trước lần deploy tiếp theo

- [ ] **Rotate `SYNC_KEY`** (chưa xác nhận đã làm): `wrangler secret put SYNC_KEY` với giá trị ngẫu nhiên mới (ví dụ `openssl rand -hex 32`). Bắt buộc vì secret cũ `hacdao-secret-2026` đã lộ công khai trong lịch sử git (repo public). Xem chi tiết `BAO_CAO_KIEM_TRA_LAI_SAU_MERGE_2026-08-08.md`.
- [ ] Sau khi rotate, thêm secret `HACDAO_SYNC_KEY` (giá trị **giống hệt** bước trên) vào GitHub repo → Settings → Secrets and variables → Actions, để workflow `cloud_sync.yml` không bị 401.
- [ ] Nếu chạy `tools/cloud_to_cloud_syncer.py` / `tools/batch_cloud_syncer.py` thủ công trên máy: `export HACDAO_SYNC_KEY="<giá-trị-mới>"` trước khi chạy — thiếu biến này script tự dừng ngay với thông báo rõ.
- [ ] Nếu có domain nào khác ngoài `hacdaotruyen.com` / `www.hacdaotruyen.com` / `nguyenbaosang1998.workers.dev` gọi thẳng API: `wrangler secret put ALLOWED_ORIGINS` (danh sách domain cách nhau bởi dấu phẩy).

## Quy trình deploy chuẩn

Chạy trên máy đã đăng nhập `wrangler` (không chạy được từ sandbox Claude — không có SSH key GitHub / credential Cloudflare / mạng ra ngoài bị chặn):

```bash
git pull

cd frontend
npm install
npm run build
cd ..

wrangler deploy
```

Nếu chưa đăng nhập: `wrangler login` trước.

## Kiểm tra ngay sau khi deploy

```bash
# Glossary phải bị chặn khi không có token admin
curl -X POST https://hacdaotruyen.com/api/novels/<slug>/glossary -d '{"glossary":{}}'
# → phải trả 401

# Debug endpoint phải bị chặn
curl https://hacdaotruyen.com/api/debug/chapter/<slug>/1
# → phải trả 401

# sync-novel phải từ chối secret CŨ đã lộ (nếu đã rotate SYNC_KEY)
curl -X POST https://hacdaotruyen.com/api/admin/sync-novel \
  -H "x-sync-key: hacdao-secret-2026" -d '{"slug":"test","chapters":[]}'
# → phải trả 401 (nếu vẫn trả thành công nghĩa là CHƯA rotate SYNC_KEY)
```

Kiểm tra bằng mắt: trang chủ tải bình thường (không lỗi CORS trong Console), bìa ảnh hiển thị bình thường, đọc 1 chương thấy lượt xem vẫn +1, đánh giá sao vẫn lưu được, admin sửa glossary vẫn thành công (vì đã có Bearer token), pipeline sync 24/7 (`cloud_sync.yml`) chạy job thủ công (workflow_dispatch) một lần để xác nhận không bị 401 sau khi đổi secret.

Thay `<slug>` bằng slug một truyện thật đang có trên site. PowerShell trên Windows dùng `curl.exe` thay vì `curl` (alias mặc định trỏ `Invoke-WebRequest`, cú pháp khác).

## Nếu có gì gãy sau deploy

Mỗi phần vá là 1 commit riêng nên có thể revert đúng chỗ mà không cần revert tất cả:

```bash
git log --oneline    # tìm hash commit gây lỗi
git revert <hash>
wrangler deploy
```

## Tài liệu liên quan

- `BAO_CAO_KIEM_TRA_2026-08-08.md` — audit bảo mật lần đầu
- `BAO_CAO_BAN_GIAO_NANG_CAP_BAO_MAT_2026-08-08.md` — bàn giao đợt vá đầu
- `BAO_CAO_KIEM_TRA_LAI_SAU_MERGE_2026-08-08.md` — audit lại sau khi merge 37 commit upstream (phát hiện secret `hacdao-secret-2026`)
- `KE_HOACH_NANG_CAP_2026-08-08.md` — kế hoạch nâng cấp 5 giai đoạn (giai đoạn 0 đã thực thi, 1-5 còn lại)

## Lịch sử deploy

| Ngày | Commit tới (HEAD) | Đã deploy? | Ghi chú |
|---|---|---|---|
| 2026-08-08 | `7d0000f` | Chưa xác nhận | 6 commit vá bảo mật Worker + Python + rotate SYNC_KEY (code xong, secret thật trên Cloudflare chưa xác nhận đã đổi) |
