# Phân tích website "Truyện Trung" (truyentrung.com) — tham chiếu cho HacDaoTruyen

Ngày quan sát: 26/11/2026. Phương pháp: chỉ quan sát công khai (không đăng nhập, không nhập dữ liệu, không vượt challenge).
Ký hiệu: **[QS]** = quan sát trực tiếp (kèm bằng chứng) · **[SL]** = suy luận.

## 0. Chọn domain

- `https://truyentrung.com` trả 200, title "Truyện Trung | Đọc Truyện Chữ - Truyện Convert - Truyện Dịch Full Miễn Phí", meta mô tả nguồn "Qidian, Fanqie, bFaloo, Tấn Giang". **[QS]**
- `truyentrung.net`, `truyentrung.org`, `truyentrung.vip`: web_fetch báo `ROBOTS_DISALLOWED (robots.txt unreachable)` → không xác định được là có site đang chạy hay không. **[QS]**
- WebSearch "truyentrung đọc truyện" không ra kết quả liên quan (toàn trang spam backlink). **[QS]**
- => Chọn **truyentrung.com**: là domain duy nhất phản hồi, đúng mô tả "truyện Trung dịch/convert", danh mục `Tìm thấy 137406 truyện` ở `/loc-truyen`. Không có số liệu traffic so sánh giữa các domain (giới hạn).

## 1. Tech stack

| Hạng mục | Phát hiện | Loại |
|---|---|---|
| Framework | **Next.js 16.2.9**, App Router + React Server Components (`window.next.version === "16.2.9"`, có `self.__next_f`, không có `__NEXT_DATA__`), bundler **Turbopack** (`/_next/static/chunks/turbopack-0lhz1v57mre1b.js`, `globalThis.TURBOPACK`) | QS |
| Render | SSR/streaming RSC; điều hướng client lấy `?_rsc=` payload. Mọi tab trong trang truyện (giới thiệu/bình luận/bản dịch…) nằm sẵn trong HTML (`#novel-panel-intro`, `#novel-panel-ban-dich`, …) | QS |
| Mutations | **Server Actions** (không REST): `createServerReference(...,"toggleReaction")`, `submitComment`, `loadMoreReplies`, `submitReport`, `setPinned`, `saveReaderPrefs`, `logReadingSignal`, `tipTranslator`, `rewardNovel`, `unlockBdChapters`, `rateBanDich` | QS (chunk `3wvck19hjx6n0.js`, `3yu1y8ofxgbnb.js`, `3ceo-t7gd9epa.js`) |
| Route Handlers | `/api/me/nav` (→ `{"loggedIn":false}`), `/api/tts`, `/api/luot-doc`, `/api/reading-progress` | QS |
| Backend dữ liệu | Ảnh tại `https://api.truyentrung.com/storage/v1/object/public/{covers,site,innerbox,novel-covers}/…` = đúng mẫu URL **Supabase Storage** → khả năng cao Supabase (Postgres + Auth + Storage). Trường snake_case `user_no`, `anonymous_until`, `created_at`, `pinned_at` khớp Postgres | SL (mạnh) |
| CDN/edge | **Cloudflare** phía trước: `POST /cdn-cgi/rum`, `window.__cfBeacon`, robots.txt có khối "BEGIN Cloudflare Managed content" + `Content-Signal: search=yes,ai-train=no` | QS |
| Hosting app | Query `?dpl=b3d0cd0e…` trên mọi asset = Next `deploymentId` (skew protection) → thường gặp ở Vercel, nhưng cũng có thể self-host | SL (yếu) |
| UI | Tailwind + shadcn-style (`data-slot="avatar"`, `buttonVariants`), primitives kiểu Base UI (`useRenderElement`), icon lucide; font `next/font` Mulish + Geist Mono; `<html class="… dark">` | QS |
| Ảnh | `next/image` (`/_next/image?url=…&w=3840&q=75`); một số bìa hotlink thẳng `bookcover.yuewen.com` (Qidian) và `cdn.cdnshu.com` | QS |
| Analytics | GTM `GTM-MGXF434G`, GA4 `G-Y8MFKQH9YK`, Cloudflare Web Analytics; cookie khách chỉ `_ga`, `_ga_*` | QS |
| PWA | Có `manifest.webmanifest`; **không** có Service Worker điều khiển trang (`navigator.serviceWorker.controller === null`) | QS |
| App | Trang `/tai-app` (Android); link store ở footer là `https://play.google.com/` chung chung | QS |

## 2. Mô hình dữ liệu (suy ra từ URL, props, hằng số)

- **Novel** (truyện gốc): slug, id số (vd `novel=10000658`), tác giả (`/tac-gia/{slug}`), nguồn (Qidian…), trạng thái nguồn (Đang ra/Hoàn thành), thể loại (`?category=di-the-dai-luc`), thẻ, số chữ ("446.77 vạn chữ"), nhân khí, kim phiếu tháng/tổng, rating. **[QS]**
- **Bản dịch (ban_dich / bd)** — thực thể riêng, *một truyện có nhiều bản dịch*: URL `/truyen/{slug}/ban-dich/{bdId}/{chapterIndex}`; mỗi bd có dịch giả (vd "Lv.1 Tự Động"), loại (Convert / Convert Full), số chương, giá `price` (Linh Thạch/chương), `vipFrom` (chương bắt đầu tính phí), cập nhật lúc. Route RSC: `["slug","quy-bi-chi-chu","d"] → ["bd","44","d"]`. **[QS]**
- Hằng số `bdMienPhiToanBo(vipFrom) = vipFrom > 30000` → "Miễn phí toàn bộ" được mã hoá bằng vipFrom rất lớn. **[QS]** (`3ceo-t7gd9epa.js`)
- Trạng thái dịch hiển thị trên thẻ truyện: "Chưa Dịch", "Đang Convert", "Convert Full", "Khóa Đọc". **[QS]**
- **Chapter**: index + title; `MAX_CHAPTER_CHARS = 2e5`, `MAX_CHAPTER_TITLE = 300`. Nội dung đoạn văn render thành `article p[data-tp="{i}"]` trong `#tl-reader-root`, thân chương có `[data-chapter-body]`. **[QS]**
- **Profile**: `user_no`, `username`, `level` (cảnh giới 1–9), `elements` (linh căn kim/mộc/thủy/hỏa/thổ), `title`, `avatar_url`, `anonymous_until`, `role`. **[QS]**
- **Comment**: `id, content, created_at, pinned_at, reading_chapter_index, reactions{likes,dislikes,mine}, profile`, thread `{comment, replies, replyTotal}`. **[QS]**
- Sitemap index: `truyen-0..3.xml`, `tac-gia-0..2.xml`, `ban-dich-0.xml`, `khac-0.xml`. **[QS]**

## 3. Cơ chế đọc chương

- **Bắt buộc đăng nhập để xem nội dung chương, kể cả chương miễn phí**: trang `/truyen/cuc-pham-phi-tien/ban-dich/2161/4642` hiện "Nội dung chương chỉ dành cho thành viên. Đăng nhập để đọc và nghe chương truyện." Mục lục & thông tin truyện vẫn công khai. **[QS]**
- Trang chương đặt `meta robots: noindex, follow`; trang mục lục bản dịch `index, follow`. **[QS]**
- Mục lục phân trang 100 chương/trang `?p=2…47`. **[QS]**
- Nội dung chương nằm trong HTML SSR (không thấy API riêng lấy chương). **[SL]** — không xác minh được vì không đăng nhập.
- **Chống copy** (`CopyReportGuard`): chặn `copy`, `cut`, `contextmenu` khi vùng chọn nằm trong `[data-chapter-body]`; mỗi lần copy gọi server action `logReadingSignal(novelId, chapterIndex)` (throttle 30 s). Không thấy mã hoá/xáo trộn font. **[QS]**
- **Quyền đọc có hạn**: props `expiresAt` → khi hết hạn báo "Quyền đọc chương đã hết hạn — không thể nghe"; nút "tự chuyển sang chương kế **đã thuê**". **[QS]** → token/quyền đọc theo phiên có TTL. **[SL]**
- Điều hướng phím ←/→ (`ChapterKeyNav`), bỏ qua khi đang gõ input. Link mục lục `prefetch:false` (tránh prefetch hàng trăm chương). **[QS]**
- **Đếm lượt đọc chống gian lận** (`ReadCounter`): chỉ `POST /api/luot-doc {token, cuonHet, tuongTac}` khi (a) tab hiển thị đủ **30 s** (tạm dừng khi ẩn tab) VÀ (b) cuộn tới đoạn cuối (IntersectionObserver trên `[data-tp=doanCuoi]`) HOẶC có tương tác (`pointerdown/keydown/wheel/touchstart`); `keepalive:true`; token ký từ server. **[QS]**

## 4. Reader

- Cài đặt đọc (mở được khi chưa đăng nhập): cỡ chữ 14–30 (mặc định 18), giãn dòng 1.4–2.4 (1.9), font serif "Có chân (E-ink)" (Palatino/Georgia/Noto Serif) hoặc sans, theme Sáng/Giấy(sepia, mặc định)/Tối, 7 màu nền + 7 màu chữ. **[QS]** (`DEFAULT_READER_PREFS`)
- **Kiểm tra tương phản WCAG**: `readableCombo(bg,fg)` tính luminance, < 4.5:1 thì disable swatch kèm aria-label "tương phản quá thấp". **[QS]**
- Áp dụng bằng CSS variables `--tl-size, --tl-lh, --tl-font, --tl-bg, --tl-fg, --tl-muted` trên `#tl-reader-root`; lưu server qua `saveReaderPrefs` debounce 600 ms (đồng bộ đa thiết bị). **[QS]**
- **TTS 2 tầng** (`ReaderTtsPlayer`):
  - Tầng 1 "neural" phía server: `GET /api/tts?slug&idx&voice&seg&bd` trả audio từng **segment** (gộp nhiều đoạn `paraStart..paraEnd`); `&meta=1` trả danh sách segment. Giọng `vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`; thông báo lỗi nhắc "giọng neural (edge-tts)" → server dùng **edge-tts**. **[QS]**
  - Prefetch segment kế, cache blob URL giữ cửa sổ ±2 segment; retry 429/503/`synth_throttled` với backoff 1.5 s / 3.5 s / 6 s (tối đa 3 lần), sau đó **fallback Web Speech API** (`speechSynthesis`, chọn giọng vi theo giới tính). Lý do lỗi: `edge_disabled`, `synth_throttled`, `empty`, `synth_failed`. **[QS]**
  - Highlight đoạn đang đọc (`.tl-tts-active`), tự cuộn, ước lượng đoạn theo `currentTime/duration` tỉ lệ độ dài ký tự; tốc độ 0.5–2×; MediaSession (điều khiển màn hình khoá); mẹo "unlock" audio iOS bằng WAV rỗng + utterance câm; "Nghe toàn bộ" tự sang chương kế qua `sessionStorage['tt:tts-continue']` (TTL 30 s). **[QS]**
- **Lưu tiến độ cấp đoạn** (`ReadingProgressTracker`): IntersectionObserver trên `p[data-tp]` với `rootMargin:"-42% 0px -53% 0px"` (dải giữa màn hình); lưu `localStorage['tt:rp:{slug}:{idx}']`, debounce 4 s rồi `POST /api/reading-progress {novelId, chapterIndex, paragraphIndex, banDichId}`; flush bằng `navigator.sendBeacon` khi `visibilitychange/pagehide`; khi mở lại tự cuộn về đoạn và hiện pill "Đã về chỗ đọc dở · Lên đầu chương". TTS cũng phát sự kiện `tt:tts-progress` để cập nhật tiến độ. **[QS]**
- Offline: không có Service Worker → không đọc offline trên web. **[QS]** (App Android có thể có — không kiểm chứng.)

## 5. Nguồn nội dung

- Danh mục lấy từ Qidian/Fanqie/bFaloo/Tấn Giang (meta), bìa hotlink `bookcover.yuewen.com/qdbimg/…`, BXH "Qidian" mirror (nguyệt phiếu, bán chạy, lượt đọc, sách mới, đơn vị "vạn chữ"). **[QS]**
- 137.406 truyện nhưng phần lớn "Chưa Dịch — 0 chương" → **catalog metadata trước, nội dung sau**. **[QS]**
- Bản dịch "Lv.1 **Tự Động**" loại "Convert" → dịch máy/convert tự động là một "dịch giả" hệ thống. **[QS]** Dịch AI hay convert Hán-Việt kiểu QT: tên chương như "Lần bên ngoài 1 linh dương tiễn đưa tử", "Chương 578: Chương 111: trăm (Cầu đuổi theo đọc cầu vé tháng)" → chất lượng kiểu convert máy thô, giữ nguyên số chương gốc lồng nhau. **[SL]**
- Dịch giả người: "Mở Bản Dịch cho truyện này →" (`/dang-truyen/dich/tim-truyen?novel=…`), "Truyện Chờ Dịch", thông báo "Mời dịch giả thử nghiệm chức năng đăng truyện" (21/11/26), có cả "sáng tác Việt". **[QS]**
- Cùng 1 truyện, nhiều bản dịch cạnh tranh; đánh giá bản dịch 1–10 (chỉ người đã mở khoá chương), thưởng dịch giả 10/50/100/500 LT. **[QS]**

## 6. Cộng đồng & gamification

- Bình luận theo truyện (có `reading_chapter_index` → hiện badge "Chương N" của người bình luận), trả lời lồng 1 cấp, tải thêm 5 reply/lần, like/dislike optimistic, ghim (mod), báo cáo. Ràng buộc: comment 3–500 từ (thu gọn ở 50), review 50–500 từ, quick review tối đa 5/ngày. **[QS]**
- Kiểm duyệt: từ cấm → "Nội dung chờ kiểm duyệt"; bảng phạt `BOT_REPORT_ACTIONS` (xoá nội dung / khoá 1/3/7/30 ngày / vĩnh viễn) cho spam, xúc phạm, nội dung lậu… **[QS]**
- **Hệ thống tiền tệ/điểm** **[QS]**:
  - *Linh Thạch (LT)*: nạp tiền (`/nap`), mở khoá chương VIP, thưởng dịch giả.
  - *Lượng*: kiếm qua hoạt động ("Bấm 'Đọc Bản Dịch' … để nhận thưởng Lượng"), dùng tặng quà truyện (8 vật phẩm 1 → 10.000.000 Lượng: Kẹo Hồ Lô, Rượu Nữ Nhi Hồng, … Phiên Vũ Thần Mã) → "Điểm Hào Phóng", "Hào Phóng Bảng".
  - *Kim Phiếu*: vote truyện → BXH Kim Phiếu tháng.
  - *Truy Thư Lệnh*: mua ở cửa hàng để "treo yêu cầu tìm truyện" (bounty); tặng miễn phí cho tài khoản mới.
- **Cảnh giới người dùng**: 9 bậc khoa cử "Thư Đồng → Thư Sinh → Tú Tài → Cử Nhân → Tiến Sĩ → Thám Hoa → Bảng Nhãn → Trạng Nguyên → Thư Thánh", màu tên + hiệu ứng aura; Linh Căn ngũ hành vẽ vòng SVG cạnh tên; "hộp đột phá" cấp 2–9; tab "Tu Luyện" ở trang truyện; chế độ ẩn danh tạm (`anonymous_until`). **[QS]**
- Tủ truyện công khai (`/tu-truyen/100016` — "7 truyện trong tủ", "1 người theo dõi"), BXH thành viên, chatbox có "Gieo Quẻ", mini-game vòng quay (`/mini-game/vong-quay`), nhiệm vụ (`/nhiem-vu` trong robots), thông báo (`/thong-bao`), ticket hỗ trợ. **[QS]**
- BXH reset ngày 1 hàng tháng (FAQ). **[QS]**

## 7. Khám phá truyện

- `/loc-truyen`: sắp xếp, nguồn, thể loại, trạng thái nguồn, **trạng thái dịch**, thẻ, **số chương** (Trên 100/500/1000/2000), đánh giá; xem lưới/danh sách (`?view=list`); query trên URL (`?category=…`, `?q=` cho search). **[QS]**
- Trang truyện: "Truyện cùng tác giả", "Truyện Tương Tự", huy hiệu thứ hạng ("Top 3 Nguyệt Phiếu", "Top 14 Bán Chạy"). **[QS]**
- Trang chủ: "Truyện Đang Đọc", Đề cử, BXH Truyện Trung (Nhân khí tháng), Mới cập nhật dạng bảng theo thể loại + chương mới nhất, widget "Gợi ý · Đang dịch". **[QS]**

## 8. SEO

- JSON-LD: `Organization`, `WebSite` + `SearchAction` (`/loc-truyen?q={search_term_string}`), `Book` (name, author Person+url, image, genre, inLanguage vi), `BreadcrumbList`. **[QS]**
- `canonical` mọi trang; `og:type=book` cho trang truyện; meta description cắt 160 ký tự từ giới thiệu. **[QS]**
- Slug Việt không dấu (`/truyen/quy-bi-chi-chu`, `/tac-gia/ai-tiem-thuy-dich-o-tac`); slug đôi khi lệch tiêu đề (`/truyen/nguoi-khoe-1983` cho "Nhĩ Hảo,1983") → slug sinh từ bản convert đầu. **[QS]/[SL]**
- Chương `noindex` (vì cần login) → nội dung chương không lên Google; SEO dựa vào trang truyện + mục lục + tác giả + tin tức/review. **[QS]**
- robots chặn `/api /auth /profile /user /tu-truyen /cua-hang /nhiem-vu /dich-gia …`; chặn hàng loạt AI crawler (GPTBot, ClaudeBot, CCBot…). **[QS]**
- Nội dung "Tin tức" (review truyện, tin ngành Qidian/Fanqie) làm content marketing. **[QS]**

## 9. Hiệu năng

- ~23 chunk JS trên trang truyện, 2 CSS; preload 2 font woff2 + logo. **[QS]**
- HTML: `cache-control: max-age=1800` — **không xác minh được** (header lấy được trong phiên bị nhiễu, xem Giới hạn).
- `next/image` có lúc yêu cầu `w=3840` cho bìa (lãng phí băng thông nếu `sizes` không đặt đúng). **[QS]/[SL]**
- Mục lục 100 chương/trang, `prefetch:false` cho link chương. **[QS]**

## 10. Kiếm tiền

- Freemium theo **bản dịch**: chương < `vipFrom` miễn phí, từ `vipFrom` trả `price` LT/chương, mở khoá **vĩnh viễn** cho bản dịch đó ("Mỗi bản dịch là độc lập — đổi sang bản dịch khác cần mở khóa lại"). Mở lẻ, mở theo dải (tối đa **200** chương/lần), "Mở khóa tất cả trang này", quick 5/10/20/50 chương. **[QS]**
- An toàn thanh toán ở client: `idem = crypto.randomUUID()` (idempotency key) + `expected_unit` (giá kỳ vọng, chống đổi giá giữa chừng) + chỉ trừ chương VIP *chưa* mở; công tắc `salesPaused` của admin. Tip cũng có idempotency (`duplicate` → "không trừ thêm"). **[QS]**
- Nạp tiền `/nap`, chính sách hoàn tiền; điều khoản đăng truyện cho phép nền tảng "thu hộ" và chia doanh thu với người đăng. **[QS]**
- Không thấy mạng quảng cáo (không `adsbygoogle`, không iframe quảng cáo) trên các trang đã xem; điều khoản có nhắc "khai thác quảng cáo". **[QS]**

## 11. Mobile UX

- Nút chạm `min-h-11` (44 px) cho các hành động mua/thưởng; nút nổi góc phải dưới (Cài đặt, Nghe, Lên đầu trang) xếp tầng `bottom-5/20/36`; settings dạng sheet bên phải; player TTS dạng thanh dưới cùng, `backdrop-blur`. **[QS]**
- Link "Bỏ qua tới nội dung chính" (a11y), aria-label đầy đủ. **[QS]**

## 12. Giới hạn của nghiên cứu

- Không đăng nhập → không thấy nội dung chương, HTML reader thật, cửa hàng, nạp tiền, tủ truyện cá nhân, chat.
- Sandbox Linux bị proxy allowlist chặn (`403 host is not on the allow list`) → không curl được; `rea-agents@6.7.0 analyze-web-bundle` cần endpoint CDP + targetId (không có Chromium/CDP trong sandbox) → **không chạy được REA trên bundle**. Phân tích bundle làm thủ công trên 3 chunk reader tải qua web_fetch (`3wvck19hjx6n0.js`, `3yu1y8ofxgbnb.js`, `3ceo-t7gd9epa.js`).
- Bất thường: trong một lần thao tác, tab browser pane chuyển sang `web.archive.org` (bản lưu của một site khác, truyenon.net) và các `fetch()` HEAD trả về header của Wayback Machine. Không xác định được nguyên nhân (script của site hay môi trường trình duyệt) → **đã loại bỏ toàn bộ header lấy trong lần đó**, không dùng để kết luận.
- Không có dữ liệu traffic để so sánh các domain trùng tên.
- Số request tới site: ~16 web_fetch + ~6 lượt tải trang trong browser (kèm subresource tự động).

---

## TOP 8 tính năng/cơ chế đáng học nhất cho HacDaoTruyen

### 1. Mô hình "Truyện ↔ nhiều Bản dịch" (bd) + bản "Tự Động"
- **Vì sao hay:** tách metadata truyện gốc khỏi bản dịch; bản AI của HacDao là 1 "dịch giả hệ thống", sau này mở cho dịch giả người/biên tập AI cạnh tranh, rating riêng từng bản, URL ổn định `/truyen/{slug}/ban-dich/{bdId}/{idx}`.
- **Độ khó:** Trung bình. D1: thêm bảng `translations(id, novel_id, translator_id, kind, vip_from, price, …)`, khoá chapters theo `(translation_id, idx)`; R2 key `bd/{id}/{idx}.json`. Cần migration dữ liệu hiện có sang 1 bd mặc định.
- **Rủi ro:** migration URL cũ (cần redirect 301), phân mảnh bình luận/tiến độ theo bd; D1 cần index tốt.

### 2. TTS 2 tầng: edge-tts theo segment + fallback Web Speech
- **Vì sao hay:** giọng neural Hoài My/Nam Minh miễn phí, highlight + auto-scroll, prefetch segment kế, backoff khi nghẽn, tự chuyển chương, MediaSession nghe khi khoá màn hình.
- **Độ khó:** Trung bình–Cao. Worker không chạy được Python edge-tts → đặt synth ở backend Python hiện có (hoặc container), cache MP3 vào R2 theo `(bd, idx, voice, seg)`, Worker chỉ phục vụ từ R2/stream. Frontend React port gần như 1-1.
- **Rủi ro:** edge-tts là endpoint không chính thức của Microsoft (có thể bị chặn/ToS); chi phí lưu R2; iOS autoplay.

### 3. Lưu tiến độ cấp đoạn (paragraph-level) + sendBeacon
- **Vì sao hay:** quay lại đúng đoạn đang đọc, rẻ (debounce 4 s, beacon khi ẩn tab), offline-first qua localStorage.
- **Độ khó:** Thấp. `p[data-tp]` + IntersectionObserver dải giữa màn hình; Worker endpoint upsert D1 `reading_progress(user, novel, bd, chapter, para)`.
- **Rủi ro:** ghi D1 nhiều → nên gộp/giới hạn tần suất, dùng `INSERT … ON CONFLICT`.

### 4. Đếm lượt đọc "thật" (30 s hiển thị + cuộn hết/tương tác + token)
- **Vì sao hay:** BXH lượt đọc khó bị bơm, số liệu sạch cho gợi ý/kiếm tiền.
- **Độ khó:** Thấp. Token HMAC ký trong Worker khi render chương (chứa user/ip-hash, chapter, ts), `POST /api/luot-doc` verify + chống trùng bằng KV/D1.
- **Rủi ro:** người dùng tắt JS/bot vẫn đọc mà không đếm (chấp nhận được).

### 5. Cài đặt Reader bằng CSS variables + kiểm tra tương phản WCAG + lưu server
- **Vì sao hay:** đổi giao diện không re-render nội dung; chặn combo màu khó đọc; đồng bộ giữa máy.
- **Độ khó:** Thấp. Port hằng số `DEFAULT_READER_PREFS`, `readableCombo` (≥4.5:1); lưu D1 `user_prefs` JSON, debounce 600 ms; khách dùng localStorage.
- **Rủi ro:** gần như không.

### 6. Unlock chương an toàn: idempotency key + expected_unit + batch tối đa 200 + kill-switch
- **Vì sao hay:** tránh trừ tiền 2 lần khi double-click/mạng chập, tránh đổi giá giữa chừng, admin dừng bán tức thì.
- **Độ khó:** Trung bình. D1 không có transaction đa câu lệnh kiểu interactive, nhưng có `batch()` atomic → bảng `ledger(idem UNIQUE, …)` + `unlocks(user, bd, idx)` ghi trong một batch; giá đọc lại ở server so với `expected_unit`.
- **Rủi ro:** pháp lý thu phí trên nội dung dịch chưa có bản quyền (Truyện Trung dựa vào "dịch giả tự chịu trách nhiệm"); hoàn tiền/chargeback.

### 7. Catalog metadata trước + "Truyện chờ dịch" + Truy Thư Lệnh (bounty)
- **Vì sao hay:** 137k trang truyện (metadata Qidian) phủ SEO long-tail ngay cả khi chưa dịch; người đọc "đặt hàng" truyện → HacDao biết nên đốt quota AI dịch truyện nào trước.
- **Độ khó:** Trung bình. Crawl/ingest metadata vào D1, sitemap chia file; hàng đợi ưu tiên dịch theo vote/bounty cho backend Python.
- **Rủi ro:** trang mỏng (thin content) bị Google phạt; hotlink bìa từ yuewen có thể vỡ/bị chặn → nên mirror R2 (lưu ý bản quyền ảnh).

### 8. SEO có cấu trúc + gamification danh tính (cảnh giới/linh căn) và BXH tháng
- **Vì sao hay:** JSON-LD `Book`/`BreadcrumbList`/`SearchAction`, sitemap index phân mảnh, chương gated `noindex`; cảnh giới khoa cử + linh căn tạo bản sắc "tu tiên" giữ chân người dùng; BXH reset hàng tháng tạo nhịp quay lại.
- **Độ khó:** SEO: Thấp (Worker sinh HTML/JSON-LD; React/Vite SPA cần pre-render/SSR ở Worker cho trang truyện). Gamification: Trung bình (bảng XP, cron Worker reset BXH).
- **Rủi ro:** HacDao là SPA Vite → nếu không SSR các trang truyện thì JSON-LD/meta không được bot đọc tốt; gamification dễ bị farm nếu không có cơ chế #4.

### Ghi chú thêm (không vào top nhưng đáng cân nhắc)
- Bắt đăng nhập để đọc mọi chương: tăng tài khoản nhưng mất SEO nội dung chương — HacDao nên cân nhắc mở N chương đầu công khai + index.
- Chống copy chỉ chặn sự kiện + log server (nhẹ, không mã hoá) — đủ "ngăn người thường", không ngăn crawler.
