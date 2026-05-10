# Session Log — 2026-05-10
**Project:** HacDaoTruyen — Website đọc truyện cá nhân  
**Developer:** PongSa (Sangcarmd)  
**Stack:** React/Vite frontend · FastAPI Python backend · Cloudflare Worker/D1/R2

---

## 🎯 Mục tiêu session này

Deploy website đọc truyện lên Cloudflare hoàn toàn miễn phí, không cần VPS, để demo với bạn bè tại `hacdaotruyen.com`.

---

## ✅ Những gì đã hoàn thành

### 1. Cấu hình Cloudflare deployment
- Fix `frontend/src/api.js`: đổi `baseURL` từ `http://127.0.0.1:4444/api` → `/api` (relative URL)
- Fix `frontend/vite.config.js`: thêm `build.outDir: 'dist'` + Vite proxy `/api` → `127.0.0.1:4444`
- Tạo `frontend/public/_redirects` cho SPA routing (sau đó bỏ vì Worker đã handle)
- Cập nhật `wrangler.jsonc`: trỏ `assets.directory` → `frontend/dist`, thêm `main: src/index.js`
- Tạo `src/index.js`: Cloudflare Worker làm API proxy + serve static assets

### 2. Cloudflare D1 + R2 setup
- Tạo D1 database: `hacdao-db` (ID: `284ebf75-a325-49b7-a065-818188a76b7b`)
- Tạo R2 bucket: `hacdao-chapters`
- Tạo `schema.sql` với 2 bảng: `novels` (metadata) và `chapters` (filename, title, chapter_number, r2_key)
- Cập nhật `wrangler.jsonc` với D1 + R2 bindings

### 3. Viết Worker API (`src/index.js`)
Các endpoints đã implement:
- `GET /api/novels` — danh sách truyện từ D1
- `GET /api/novels/:slug` — chi tiết novel + glossary
- `GET /api/novels/:slug/chapters` — danh sách chapters từ D1
- `GET /api/novels/:slug/chapters/:identifier` — nội dung từ R2 (nhận số hoặc filename)
- `POST /api/novels/:slug/glossary` — update glossary trong D1
- `GET /api/novels/:slug/health` — health check
- `GET /api/debug/chapter/:slug/:num` — debug endpoint kiểm tra D1 + R2
- Proxy `/translate`, `/tools`, `/logs` → Python backend (nếu có `BACKEND_URL`)

### 4. Migration script (`migrate_to_cloudflare.py`) — v5
Các tính năng:
- R2 key dùng `base64(filename)` để tránh collision với ký tự tiếng Trung
- `chapter_number` extract từ **title** (không phải filename)
- Bỏ split parts (`-N_VI.md`) nếu đã có merged version
- Filename tiếng Trung không có `第N章` pattern → author note (num=0)
- Batch D1: 10 chapters/lần để tránh `SQLITE_TOOBIG`
- Glossary lưu riêng trên R2 (`slug/glossary.json`) không nhét vào D1 row

**Flags:**
```bash
python3 migrate_to_cloudflare.py --slug <slug> --smart-sync   # ⭐ dùng hàng ngày
python3 migrate_to_cloudflare.py --status                      # xem trạng thái
python3 migrate_to_cloudflare.py --slug <slug> --set-synced    # fix state thủ công
python3 migrate_to_cloudflare.py --slug <slug> --from-chapter N
python3 migrate_to_cloudflare.py --slug <slug> --skip-d1       # chỉ upload R2
python3 migrate_to_cloudflare.py --slug <slug> --skip-r2       # chỉ update D1
python3 migrate_to_cloudflare.py --slug <slug> --resume        # skip files đã có
python3 migrate_to_cloudflare.py --slug <slug> --limit N       # test N files đầu
```

### 5. Fix `api.py` (local Python backend)
- Endpoint `GET /api/novels/:slug/chapters/:identifier` giờ nhận cả **số chương** lẫn **filename đầy đủ**
- Trước đây chỉ nhận filename → 404 khi frontend gọi `/chapters/1497`

### 6. Fix `NovelDetail.jsx`
- 2 chỗ hardcode `http://localhost:4444/api/...` → đổi thành `/api/...`
- Endpoints: `cleanup-split-parts` và `tools/:toolId`

### 7. Sync state (`migrate_to_cloudflare.py`)
- Lưu vào `.sync_state.json` sau mỗi lần sync thành công
- `--smart-sync`: tự đọc state, query D1 để detect author notes mới, sync đúng phần cần thiết
- `.sync_state.json` đã thêm vào `.gitignore`

### 8. Custom domain
- Mua `hacdaotruyen.com` trên Cloudflare Registrar
- Gắn vào Worker: Dashboard → Workers & Pages → Settings → Domains & Routes

---

## 🐛 Các bug đã fix

| Bug | Nguyên nhân | Fix |
|---|---|---|
| `_redirects` infinite loop | Linter đổi thành `/* / 200` | Worker handle SPA fallback, xóa file |
| `SQLITE_TOOBIG` | Glossary 3000+ terms nhét vào D1 row | Lưu glossary lên R2 riêng |
| R2 upload không lên cloud | Thiếu `--remote` flag | Thêm `--remote` vào `r2 object put` |
| Chapter 404 trên local | `api.py` chỉ nhận filename, không nhận số | Fix endpoint nhận cả hai |
| R2 key collision | Sanitize filename → `ch_0_____VI.md` trùng nhau | Dùng `base64(filename)` |
| Duplicate chapter_number | Split parts `-1, -2` có cùng số | Filter: bỏ split nếu đã có merged |
| Author note bị coi là chapter | Filename tiếng Trung `从六十订...-1` có "Chương 1" trong title | Check: filename tiếng Trung không phải `第N章` → num=0 |
| `--smart-sync` re-sync 13 author notes | `from_chapter` giữ lại author notes | Bỏ author notes khỏi filter khi có `from_chapter` |
| `get_synced_filenames` trả về set rỗng | Wrangler in warning trước JSON, parse lỗi | Scan từng dòng tìm `[` để parse JSON |

---

## 📁 Files đã thay đổi / tạo mới

| File | Thay đổi |
|---|---|
| `frontend/src/api.js` | baseURL → `/api` |
| `frontend/vite.config.js` | Thêm build config + Vite proxy |
| `frontend/src/pages/NovelDetail.jsx` | Fix 2 hardcode localhost |
| `frontend/src/pages/Reader.jsx` | Không thay đổi (đã đúng) |
| `api.py` | Fix endpoint chapters nhận số chương |
| `src/index.js` | **Tạo mới** — Cloudflare Worker API |
| `schema.sql` | **Tạo mới** — D1 schema |
| `migrate_to_cloudflare.py` | **Tạo mới** — migration + sync script |
| `wrangler.jsonc` | Thêm D1/R2 bindings, main entry |
| `package.json` | Thêm `build:frontend` script |
| `.gitignore` | Thêm `.sync_state.json` |
| `use.md` | Thêm section Cloudflare |

---

## 🔮 Việc còn dở / cần làm tiếp

### `get_synced_filenames` query D1 vẫn lỗi
- Triệu chứng: `⚠️ Không query được D1, bỏ qua check author notes`
- Đã fix parse JSON nhiều lần nhưng vẫn fail
- **Hướng fix tiếp:** Thử thêm `--no-json` và parse text output thay vì `--json`; hoặc dùng Cloudflare REST API trực tiếp thay vì wrangler CLI
- **Impact:** Thấp — smart-sync vẫn hoạt động, chỉ bỏ qua check author notes mới

### Chưa implement
- Auto-sync sau khi dịch xong (chạy migrate tự động sau `main.py translate`)
- Notification khi có chapters mới
- Search full-text trong truyện
- Chrome Extension sync với Cloudflare

---

## 🏗 Architecture hiện tại

```
User browser
    ↓
hacdaotruyen.com (Cloudflare)
    ├── Static files (React SPA) ← Cloudflare Assets
    └── /api/* → Cloudflare Worker (src/index.js)
                    ├── GET /api/novels/*     → D1 (metadata)
                    ├── GET /api/*/chapters/* → D1 + R2 (content)
                    └── /translate, /tools    → Python backend (optional)

Local development (./start.sh):
    ├── Vite dev server :5173 (proxy /api → :4444)
    └── FastAPI :4444 (reads from novels/ folder directly)

Migration:
    novels/ (local files)
        → python3 migrate_to_cloudflare.py --smart-sync
        → D1 (chapter metadata) + R2 (chapter content)
```

---

## 💡 Lệnh hay dùng nhất

```bash
# Khởi động local
./start.sh

# Dịch truyện
python3 main.py translate --novel xich-tam-tuan-thien --chapters 20

# Sync lên Cloudflare sau khi dịch
python3 migrate_to_cloudflare.py --slug xich-tam-tuan-thien --smart-sync

# Deploy code mới
npm run deploy

# Kiểm tra trạng thái sync
python3 migrate_to_cloudflare.py --status

# Debug chapter trên production
curl "https://hacdaotruyen.com/api/debug/chapter/xich-tam-tuan-thien/1"
```

---

## 📊 Số liệu hiện tại

| Metric | Giá trị |
|---|---|
| Novel chính | Xích Tâm Tuần Thiên |
| Chapters đã dịch | ~1580 |
| Files trong R2 | ~1523 (sau filter split parts) |
| D1 rows | ~1523 chapters |
| Glossary terms | ~3339 |
| Chi phí Cloudflare | $0/tháng (free tier) |
| Chi phí domain | ~$9/năm |
