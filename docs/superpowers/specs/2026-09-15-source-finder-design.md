# Thiết kế: Tìm nguồn truyện tự động (Qidian / novel543 / 69shuba)

## Bối cảnh & mục tiêu

Hiện tại quy trình thêm truyện mới có 2 lệnh:

- `python main.py new` (interactive) — người dùng phải **tự tay** tìm URL trang
  truyện gốc rồi dán vào.
- `python main.py import --url <URL>` — đã tự động 1-click: gọi
  `NovelScraper.fetch_novel_metadata(url)` (trong `scraper.py:506`) để bóc tách
  title/author/genre/synopsis + toàn bộ mục lục chương, rồi tạo `novel.json` +
  `catalog.json` (xem `async_import_novel` trong `main.py:462-522`).
- `discover.py` chỉ dùng Gemini để **đoán** tên/thể loại truyện hot và đoán URL
  69shuba theo trí nhớ của model — không search web thật, độ chính xác thấp và
  không verify được URL có tồn tại/scrape được hay không.

Khoảng trống duy nhất còn thiếu: **từ một cái tên truyện, tìm ra URL trang
truyện thật** trên Qidian / novel543 / 69shuba để đưa vào `main.py import`.
Phần scrape/parse/tạo novel đã có sẵn và KHÔNG cần viết lại.

## Kiến trúc

```
source_finder.py (module mới, top-level, cùng cấp discover.py/scraper.py)
  search_candidates(query)
    → search DuckDuckGo Lite (HTML, không cần API key)
    → lọc link theo domain qidian.com / novel543.com / 69shuba.com|.tw
    → chuẩn hoá mỗi candidate về {source, book_id, url} (bỏ trùng theo book_id)

  find_source(query, want_chinese_title="")
    → với mỗi candidate: gọi NovelScraper.fetch_novel_metadata(candidate.url)
      (scraper.py:506 — đã tự xử lý Playwright + fallback Jina Reader, kể cả
      cho qidian.com vốn luôn bị coi là "blocked" ở tầng fetch trực tiếp)
    → candidate hợp lệ = meta không None VÀ len(meta["chapters"]) > 0
    → xếp hạng candidate hợp lệ theo số chương giảm dần
    → trả về SourceResult tốt nhất (kèm toàn bộ danh sách đã probe, để CLI in ra)

CLI: python main.py find-source "<tên truyện>" [--author "..."]
  → in bảng candidate (source, số chương, URL, hợp lệ/không)
  → nếu có candidate tốt nhất → in sẵn lệnh
    `python main.py import --url <url>` để copy-paste chạy tiếp

discover.py: interactive_search() / --search
  → gọi find_source(novel_name) THẬT trước
  → nếu tìm được → hiển thị URL đã verify + số chương (không hỏi Gemini nữa)
  → nếu KHÔNG tìm được → fallback nguyên trạng: hỏi Gemini đoán như code cũ
```

Không tạo thêm dependency ngoài (`urllib.request` có sẵn trong stdlib, giống
cách `tools/auto_check_lanh_chua.py` và `AgentReach/scripts/novel_catalog.py`
đã làm — module này viết mới hoàn toàn trong `HacDaoTruyen`, không import
hay gọi subprocess sang `AgentReach/` vì đó là dự án OSS vendor riêng
(`AgentReach/CLAUDE.md`: "NEVER modify upstream... Agent Reach is a glue
layer" — và cũng không nên trở thành dependency ngầm của pipeline chính).

## `source_finder.py` — chi tiết

```python
SOURCE_DOMAINS = {
    "qidian.com": "qidian",
    "novel543.com": "novel543",
    "69shuba.com": "69shuba",
    "69shuba.tw": "69shuba",
    "69shu.com": "69shuba",
}
```

- `detect_source(url: str) -> str | None` — parse netloc, so khớp hậu tố với
  `SOURCE_DOMAINS`, trả về key nguồn hoặc `None`.

- `search_candidates(query: str, max_results: int = 15) -> list[dict]`
  - Gọi `https://html.duckduckgo.com/html/?q=<query>` qua `urllib.request`
    (User-Agent giả lập trình duyệt, timeout 30s — cùng pattern với
    `request_get` tham khảo, viết lại mới trong file này).
  - Parse href trong HTML trả về (DuckDuckGo Lite bọc link thật trong query
    param `uddg=`) — decode `uddg` để lấy URL đích thật.
  - Với mỗi link: `detect_source(link)`; bỏ qua nếu không khớp
    `SOURCE_DOMAINS`.
  - Chuẩn hoá `book_id` bằng regex theo từng site để khử trùng lặp (2 link
    cùng trỏ 1 cuốn sách chỉ giữ 1):
    - qidian: `r'/book/(\d+)'`
    - 69shuba: `r'/book/(\d+)'` (áp dụng cho cả `/txt/<id>/...` → lấy id đầu)
    - novel543: segment số đầu tiên trong path, vd `/0808693583/...` → `0808693583`
  - Trả về list dict `{"source": str, "book_id": str, "url": str}`, KHÔNG quá
    `max_results` phần tử, thứ tự ưu tiên `69shuba > novel543 > qidian` (theo
    độ dễ scrape — trùng khớp ghi chú trong `scraper.py:204-205`).
  - Nếu request lỗi (timeout/network) → log cảnh báo, trả về `[]` (không raise
    — để `find_source` fallback về "không tìm thấy" thay vì crash).

- `async def probe_candidate(scraper: NovelScraper, candidate: dict) -> dict`
  - Gọi `await scraper.fetch_novel_metadata(candidate["url"])`.
  - Trả về `{**candidate, "valid": bool, "chapter_count": int, "title": str,
    "author": str}` — `valid = meta is not None and len(meta.get("chapters",
    [])) > 0`.
  - Bọc try/except quanh lời gọi: lỗi bất kỳ (exception từ Playwright) →
    `valid=False, chapter_count=0`, không để 1 candidate lỗi làm hỏng cả loạt.

- `async def find_source(query: str, max_results: int = 15) -> dict | None`
  - `candidates = search_candidates(query, max_results)`; nếu rỗng → `None`.
  - Tạo **1** `NovelScraper()` dùng chung cho toàn bộ candidate (tránh mở
    nhiều browser instance) — `await scraper.start()` trước vòng lặp,
    `await scraper.close()` trong `finally` sau khi probe xong tất cả.
  - Probe **tuần tự** (không song song) — tôn trọng rate limiter theo host đã
    có sẵn trong `scraper.py` (`HostRateLimiter`), tránh dội request.
  - Lọc `valid=True`, sort theo `chapter_count` giảm dần.
  - Trả về `{"best": <candidate hợp lệ đầu tiên hoặc None>, "all": <toàn bộ
    candidate đã probe, kể cả invalid, để hiển thị debug>}`.

## CLI: lệnh `find-source` trong `main.py`

- Thêm subparser mới cạnh `import` (main.py ~554):
  ```python
  p_find = subparsers.add_parser(
      "find-source",
      help="Tìm URL trang truyện thật trên Qidian/novel543/69shuba theo tên",
  )
  p_find.add_argument("query", type=str, help="Tên truyện cần tìm (tiếng Trung hoặc Việt)")
  ```
- `cmd_find_source(args)` → `asyncio.run(source_finder.find_source(args.query))`
  → in bảng kết quả (source, chapter_count, valid, url) sắp theo
  `chapter_count` giảm dần; nếu có `best` → in thêm dòng gợi ý:
  `👉 Chạy: python main.py import --url <best.url>`.
- Nếu `all` rỗng → in `❌ Không tìm thấy nguồn nào cho "<query>" trên
  Qidian/novel543/69shuba.` và thoát code khác 0 (giữ đúng convention lỗi các
  lệnh khác trong `main.py` đang dùng, ví dụ nhánh lỗi của `async_import_novel`).

## Tích hợp `discover.py`

- Trong `interactive_search()` (discover.py:159): trước khi gọi
  `build_search_help_prompt` + `ask_gemini`, gọi
  `asyncio.run(source_finder.find_source(novel_name))`.
  - Nếu có `best` → in URL + `chapter_count` + gợi ý lệnh `import`, **không**
    gọi Gemini nữa cho bước này.
  - Nếu không có `best` → giữ nguyên hành vi cũ (hỏi Gemini đoán URL) như một
    fallback, kèm dòng thông báo "[*] Không tìm thấy nguồn thật, thử hỏi
    Gemini gợi ý...".
- Không đổi hành vi của chế độ gợi ý danh sách 10 truyện (`build_recommendation_prompt`)
  — search thật chỉ chạy khi người dùng đã chọn 1 tên cụ thể, tránh tốn hàng
  chục request DuckDuckGo + probe browser mỗi lần chạy `discover.py --genre ...`.

## Error handling & politeness

- Không tạo cơ chế rate-limit mới: `probe_candidate` dùng chung 1
  `NovelScraper` instance nên tự động đi qua `HostRateLimiter` đã có sẵn
  trong `scraper.py` (khoảng cách tối thiểu 2s/host, circuit breaker sau 5 lỗi
  liên tiếp/host — xem `scraper.py:24-25`).
- `search_candidates` không retry — DuckDuckGo Lite lỗi 1 lần thì coi như
  "không tìm thấy nguồn", không spam request.
- Toàn bộ URL trước khi Playwright điều hướng đã được `NovelScraper._is_url_safe`
  (`scraper.py:219`) kiểm tra chống SSRF — module này không cần validate lại
  URL thủ công.

## Testing

- `tests/test_source_finder.py` (mới):
  - `detect_source`: test từng domain trong `SOURCE_DOMAINS` + 1 domain không
    khớp trả `None`.
  - `search_candidates`: mock `urllib.request.urlopen` trả về 1 đoạn HTML
    DuckDuckGo cố định (fixture string trong test, KHÔNG gọi mạng thật) —
    assert parse đúng URL thật từ `uddg=`, khử trùng đúng theo `book_id`, thứ
    tự ưu tiên `69shuba > novel543 > qidian`.
  - `find_source` ranking: mock `NovelScraper.fetch_novel_metadata` (patch
    method trên instance/class) trả về số chương khác nhau cho từng candidate
    giả — assert `best` là candidate nhiều chương nhất trong số `valid=True`.
  - `find_source` khi không có candidate nào hợp lệ (`fetch_novel_metadata`
    luôn trả `None`) — assert `best is None`, `all` vẫn liệt kê đủ candidate
    với `valid=False`.
  - Không test tích hợp thật với DuckDuckGo/Qidian/novel543 trong CI (tránh
    phụ thuộc mạng ngoài + tránh bị site chặn khi CI chạy) — theo đúng
    nguyên tắc test đã áp dụng cho `tests/test_scraper_politeness.py`.

## Kiểm thử thủ công sau khi implement (không phải CI)

Test case xác nhận tính năng hoạt động thật với 1 truyện cụ thể:

```
python main.py find-source "Phía trên tháp cao"
# tác giả tham khảo: Phong Phong Mang Mang
```

Nếu không tìm thấy candidate hợp lệ nào bằng tên tiếng Việt, thử lại kèm
`--author` hoặc tên gốc tiếng Trung nếu xác định được — đây là giới hạn đã
biết của search-by-title (nhiều truyện chỉ được index bằng tên gốc tiếng
Trung trên các site nguồn), không phải lỗi cần fix trong scope này.

## Ngoài phạm vi (out of scope)

- Không dịch/suy luận tên tiếng Trung từ tên tiếng Việt (không có API dịch
  ngược đáng tin cậy) — nếu search bằng tên Việt không ra kết quả, người dùng
  tự cung cấp tên gốc hoặc dùng `--author`.
- Không thêm nguồn mới ngoài Qidian/novel543/69shuba trong phạm vi này (dù
  `scraper.py` đã có sẵn selector cho `ixdzs8.com`, `ixdzs.com`) — theo đúng
  yêu cầu ban đầu, có thể mở rộng `SOURCE_DOMAINS` sau này mà không đổi kiến
  trúc.
- Không tự động chạy `import` sau khi tìm thấy nguồn — CLI chỉ in gợi ý lệnh,
  người dùng tự chạy `import` (giữ bước xác nhận thủ công trước khi ghi dữ
  liệu, tránh import nhầm truyện trùng tên khác tác giả).
