# Runbook: Chạy OpenHands an toàn cho HacDaoTruyen (Windows + WSL2)

> **Mục đích:** Dùng OpenHands làm runtime agent chạy dài hơi (unattended) theo quy trình
> Spec Kit, mà **không** cho agent khả năng chạm production (Worker, D1, R2).
>
> **Đối chiếu:** tài liệu chính thức OpenHands (docs.openhands.dev — *Local Setup*, *Docker Sandbox*,
> *Repository Customization*, *Hooks*), kiểm tra ngày 2026-10-18. Phiên bản trong runbook:
> app `openhands:1.8`, agent-server `1.26.0-python`. Trước khi chạy, xem lại trang *Local Setup*
> vì OpenHands ra bản mới thường xuyên.

---

## 0. Nguyên tắc an toàn (đọc trước)

1. **Agent không có secret thì không thể deploy.** Lời dặn trong prompt hay trong `AGENTS.md`
   không phải là rào chắn. Vì vậy:
   - Agent chỉ làm việc trên **một bản clone sạch riêng**, KHÔNG mount thư mục làm việc chính
     `E:\AOO\HacDaoTruyen` (thư mục đó có `.env`, `credentials.json`, `key_status.json`,
     `.dev.vars`, phiên đăng nhập `wrangler`).
   - KHÔNG truyền `CLOUDFLARE_API_TOKEN`, `HACDAO_*`, token GitHub có quyền ghi vào container.
   - Agent không push được → bạn tự review diff rồi push từ bản clone.
2. **Lớp chặn thứ hai** (đã có trong repo): `.openhands/hooks/block_dangerous.sh` chặn cứng
   `npm run deploy`, `wrangler deploy`, `wrangler d1 … --remote`, `wrangler r2 object put/delete`,
   `migrate_to_cloudflare.py`, `gh workflow run`, push lên `main`/`--force`, và đọc file secret.
   Hook quét cả nội dung file agent định ghi, nên nếu agent sửa tài liệu có chứa chuỗi
   `npm run deploy` thì cũng bị chặn — khi đó tự sửa tay đoạn đó.
3. **Cổng chất lượng** (`.openhands/hooks/quality_gate.sh`): agent không được kết thúc khi
   `npm run lint` hoặc `npm run test:frontend` còn đỏ.
4. **Docker socket:** OpenHands cần `/var/run/docker.sock` để tự tạo container sandbox cho
   agent — đây là kiến trúc bắt buộc của OpenHands, không bỏ được. Hệ quả: container *app*
   OpenHands có quyền điều khiển Docker trên máy. Chỉ chạy image chính thức, ghim phiên bản,
   và chỉ mở cổng trên `127.0.0.1`.

---

## 1. Chuẩn bị (một lần)

1. Docker Desktop: `Settings > General > Use the WSL 2 based engine` bật;
   `Resources > WSL Integration` bật cho distro Ubuntu.
2. Cài Ubuntu cho WSL (PowerShell quyền Admin): `wsl --install -d Ubuntu`.
   **Mọi lệnh bên dưới chạy trong terminal Ubuntu (WSL)**, không chạy trong PowerShell —
   docs OpenHands yêu cầu vậy trên Windows.
3. (Tuỳ chọn) Giới hạn tài nguyên WSL — `C:\Users\<user>\.wslconfig`:
   ```ini
   [wsl2]
   memory=12GB
   processors=8
   ```
4. Tạo bản clone sạch cho agent, đặt **trong filesystem WSL** (nhanh hơn nhiều so với `/mnt/e`):
   ```bash
   mkdir -p ~/oh && cd ~/oh
   git clone https://github.com/baosang1988bg/Hac-Dao-Truyen.git HacDaoTruyen
   cd HacDaoTruyen
   git checkout -b feature/<ten-tinh-nang>
   # Kiểm tra KHÔNG có secret trong bản clone:
   ls -a | grep -E '^\.env$|credentials\.json|key_status\.json|\.dev\.vars$' && echo "CÓ SECRET — XOÁ TRƯỚC KHI CHẠY" || echo "Sạch"
   ```

---

## 2. Khởi động OpenHands

```bash
export SANDBOX_VOLUMES="$HOME/oh/HacDaoTruyen:/workspace:rw"

docker run -it --rm --pull=always \
  -e AGENT_SERVER_IMAGE_REPOSITORY=ghcr.io/openhands/agent-server \
  -e AGENT_SERVER_IMAGE_TAG=1.26.0-python \
  -e SANDBOX_VOLUMES \
  -e LOG_ALL_EVENTS=true \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.openhands:/.openhands \
  -p 127.0.0.1:3000:3000 \
  --add-host host.docker.internal:host-gateway \
  --name openhands-app \
  docker.openhands.dev/openhands/openhands:1.8
```

Khác với bản runbook cũ:

| Bản cũ | Bản mới | Lý do |
|---|---|---|
| `-v "E:\AOO\HacDaoTruyen:/workspace"` | `SANDBOX_VOLUMES` trỏ bản clone sạch trong WSL | Không lộ `.env`, `credentials.json`, phiên `wrangler` |
| `-p 3000:3000` | `-p 127.0.0.1:3000:3000` | Không mở UI OpenHands ra mạng LAN |
| `\\.\pipe\docker_engine` (named pipe Windows) | `/var/run/docker.sock` trong WSL | Cách chính thức trên Windows là chạy trong WSL |
| `all-hands-ai/openhands:0.14` | `openhands/openhands:1.8` | Bản 0.14 rất cũ, registry đã đổi |
| `-e GEMINI_API_KEY="..."` trên dòng lệnh | Nhập key trong UI Settings | Key không nằm trong lịch sử shell |

Mở trình duyệt: <http://localhost:3000>.

---

## 3. Chọn model (LLM)

Vào `Settings > LLM`. Model nào không có trong danh sách thì bật `Advanced` và gõ vào
`Custom Model` kèm prefix provider.

| Vai trò (theo báo cáo Spec Kit) | Gợi ý | Ghi chú |
|---|---|---|
| Spec / Plan / Code chính | `anthropic/claude-sonnet-5-5` | Model Claude hiện hành |
| Spec cần context rất dài | `gemini/gemini-3.1-pro-preview` | Theo nguồn thứ ba tháng 10/2026 — **kiểm tra lại** trên ai.google.dev/models |
| Phản biện / QA | Grok 4.x mới nhất (`xai/…`) | **Kiểm tra tên model** trên trang models của xAI |
| Sửa lint nhỏ, miễn phí | `ollama/qwen2.5-coder:7b` | Base URL `http://host.docker.internal:11434`; vừa 8 GB VRAM của RTX 4060 |

Ghi chú:
- Các model `gemini-1.5-pro`, `claude-3-5-sonnet-20241022`, `grok-2` trong bản cũ là đời cũ,
  không nên dùng nữa.
- Docs OpenHands lưu ý model local 7B thường yếu với tác vụ agent nhiều bước — chỉ nên giao
  việc nhỏ (sửa lint, format).
- Đặt giới hạn chi tiêu (usage limit) ở trang quản lý của từng provider.

---

## 4. Kiểm tra rào chắn trước khi giao việc thật

Trong cuộc hội thoại đầu tiên, yêu cầu agent:

1. *"Chạy `bash .openhands/hooks/test_block_dangerous.sh`"* → phải in
   `block_dangerous.sh: tất cả test pass`.
2. *"Chạy `npm run deploy`"* → log hội thoại phải hiện hook **deny**
   ("Cấm deploy production từ agent"). Nếu lệnh chạy thật (lỗi thiếu token cũng tính là
   *chạy*) nghĩa là hook chưa được nạp — dừng lại, kiểm tra `.openhands/hooks.json` có nằm ở
   thư mục làm việc của agent (docs: hook chỉ nạp từ đúng working folder, không tìm thư mục cha).

---

## 5. Làm việc theo Spec Kit

Ví dụ prompt:
- *"Đọc AGENTS.md và .specify/memory/constitution.md, rồi tạo spec cho tính năng … vào specs/<feature>/spec.md theo template .specify/templates/spec-template.md."*
- *"Thực hiện specs/<feature>/tasks.md, chạy npm run lint và npm run test:frontend sau mỗi task."*

OpenHands không có slash command `/speckit-*`; agent đọc trực tiếp file template trong `.specify/`.

---

## 6. Kết thúc và đưa code về repo chính

```bash
cd ~/oh/HacDaoTruyen
git status && git diff          # tự review
git add -A && git commit -m "feat: ..."
git push -u origin feature/<ten-tinh-nang>   # bạn push, không phải agent
```

Dừng OpenHands: `Ctrl+C` hoặc `docker stop openhands-app`.
Mở PR → CI (`.github/workflows/ci.yml`) xanh → merge. Deploy vẫn theo quy tắc 4 trong
`.agents/AGENTS.md` (chỉ từ `main` sạch, do người làm).
