# Tìm nguồn truyện tự động (Qidian/novel543/69shuba) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép tìm URL trang truyện thật trên Qidian/novel543/69shuba từ tên truyện, verify bằng cách probe thật (không đoán), rồi đưa thẳng vào lệnh `main.py import` đã có sẵn.

**Architecture:** Module mới `source_finder.py` (search DuckDuckGo Lite → lọc domain → probe từng candidate bằng `NovelScraper.fetch_novel_metadata` đã có sẵn trong `scraper.py` → xếp hạng theo số chương). Kết nối vào 2 nơi: lệnh CLI mới `main.py find-source` và fallback thật trong `discover.py --search`.

**Tech Stack:** Python 3, `urllib.request` (stdlib, không thêm dependency), `pytest` + `pytest-asyncio` (đã có sẵn trong repo — xem `test_scraper_politeness.py` dùng `@pytest.mark.asyncio`), `unittest.mock` để giả lập `NovelScraper.fetch_novel_metadata` và `urllib.request.urlopen`.

**Spec:** `docs/superpowers/specs/2026-09-15-source-finder-design.md`

## Global Constraints

- KHÔNG import hoặc gọi subprocess sang `AgentReach/` — module viết mới hoàn toàn, độc lập (spec, mục "Kiến trúc").
- KHÔNG thêm cơ chế rate-limit/retry mới — dùng chung `NovelScraper` + `HostRateLimiter` đã có trong `scraper.py` (spec, mục "Error handling & politeness").
- KHÔNG test tích hợp mạng thật (DuckDuckGo/Qidian/novel543) trong bộ test tự động — mock toàn bộ I/O mạng (spec, mục "Testing").
- `search_candidates` không raise khi lỗi mạng — trả về `[]` (spec, mục "`source_finder.py` — chi tiết").
- Ưu tiên nguồn theo thứ tự `69shuba > novel543 > qidian` khi có nhiều candidate hợp lệ cùng hạng (spec, mục "`source_finder.py` — chi tiết").

---

## Task 1: `detect_source` + `search_candidates` (parse DuckDuckGo, không cần mạng thật trong test)

**Files:**
- Create: `source_finder.py`
- Test: `tests/test_source_finder.py`

**Interfaces:**
- Consumes: `urllib.request.urlopen`, `urllib.request.Request` (stdlib).
- Produces:
  - `SOURCE_DOMAINS: dict[str, str]` — map hậu tố domain → tên nguồn (`"qidian"`, `"novel543"`, `"69shuba"`).
  - `detect_source(url: str) -> str | None`
  - `search_candidates(query: str, max_results: int = 15) -> list[dict]` — mỗi phần tử `{"source": str, "book_id": str, "url": str}`.

- [ ] **Step 1: Write the failing tests**

Tạo `tests/test_source_finder.py`:

```python
import urllib.request
from unittest.mock import patch, MagicMock

from source_finder import detect_source, search_candidates, SOURCE_DOMAINS


def test_detect_source_matches_known_domains():
    assert detect_source("https://www.qidian.com/book/1010935217/") == "qidian"
    assert detect_source("https://www.novel543.com/0808693583/dir") == "novel543"
    assert detect_source("https://www.69shuba.com/book/43484/") == "69shuba"
    assert detect_source("https://69shuba.tw/book/43484/") == "69shuba"


def test_detect_source_returns_none_for_unknown_domain():
    assert detect_source("https://example.com/whatever") is None


_DDG_HTML = """
<html><body>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.69shuba.com%2Fbook%2F43484%2F&amp;rut=abc">69shuba result</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.novel543.com%2F0808693583%2Fdir&amp;rut=def">novel543 result</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.qidian.com%2Fbook%2F1010935217%2F&amp;rut=ghi">qidian result</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnope&amp;rut=jkl">irrelevant</a>
</body></html>
"""


def test_search_candidates_parses_and_filters_and_orders_by_priority():
    fake_resp = MagicMock()
    fake_resp.read.return_value = _DDG_HTML.encode("utf-8")
    fake_resp.__enter__.return_value = fake_resp
    fake_resp.__exit__.return_value = False

    with patch.object(urllib.request, "urlopen", return_value=fake_resp):
        candidates = search_candidates("Phía trên tháp cao")

    sources = [c["source"] for c in candidates]
    assert sources == ["69shuba", "novel543", "qidian"]
    assert all(c["url"].startswith("http") for c in candidates)
    assert {"source", "book_id", "url"} <= candidates[0].keys()


def test_search_candidates_dedupes_same_book_id():
    html = """
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.69shuba.com%2Fbook%2F43484%2F">a</a>
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.69shuba.com%2Fbook%2F43484%2Fmenu">b</a>
    """
    fake_resp = MagicMock()
    fake_resp.read.return_value = html.encode("utf-8")
    fake_resp.__enter__.return_value = fake_resp
    fake_resp.__exit__.return_value = False

    with patch.object(urllib.request, "urlopen", return_value=fake_resp):
        candidates = search_candidates("bat ky")

    assert len(candidates) == 1
    assert candidates[0]["book_id"] == "43484"


def test_search_candidates_returns_empty_list_on_network_error():
    with patch.object(urllib.request, "urlopen", side_effect=OSError("network down")):
        assert search_candidates("bat ky") == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_source_finder.py -v`
Expected: FAIL với `ModuleNotFoundError: No module named 'source_finder'`.

- [ ] **Step 3: Implement `source_finder.py`**

```python
"""
source_finder.py
-----------------
Tìm URL trang truyện thật trên Qidian / novel543 / 69shuba từ tên truyện.

Không đoán URL (khác discover.py cũ) — search DuckDuckGo Lite thật, rồi
verify từng candidate bằng cách scrape thật (source_finder.probe_candidate
dùng NovelScraper.fetch_novel_metadata đã có sẵn trong scraper.py).
"""

import re
import urllib.parse
import urllib.request

SOURCE_DOMAINS = {
    "qidian.com": "qidian",
    "novel543.com": "novel543",
    "69shuba.com": "69shuba",
    "69shuba.tw": "69shuba",
    "69shu.com": "69shuba",
}

_SOURCE_PRIORITY = {"69shuba": 0, "novel543": 1, "qidian": 2}

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def detect_source(url: str) -> str | None:
    """Trả về tên nguồn ('qidian'/'novel543'/'69shuba') hoặc None nếu domain lạ."""
    netloc = urllib.parse.urlparse(url).netloc.lower()
    for domain, source in SOURCE_DOMAINS.items():
        if netloc == domain or netloc.endswith("." + domain):
            return source
    return None


def _extract_book_id(source: str, url: str) -> str | None:
    """Trích book_id để khử trùng lặp — mỗi site 1 định dạng path khác nhau."""
    path = urllib.parse.urlparse(url).path
    if source in ("qidian", "69shuba"):
        m = re.search(r"/book/(\d+)", path) or re.search(r"/txt/(\d+)", path)
        return m.group(1) if m else None
    if source == "novel543":
        parts = [p for p in path.split("/") if p]
        return parts[0] if parts and parts[0].isdigit() else None
    return None


def _extract_duckduckgo_links(html: str) -> list[str]:
    """Giải mã link thật ('uddg=') từ trang kết quả DuckDuckGo Lite/HTML."""
    links = []
    for href in re.findall(r'href="([^"]+)"', html):
        if "uddg=" not in href:
            continue
        parsed = urllib.parse.urlparse(href if href.startswith("http") else "https:" + href)
        qs = urllib.parse.parse_qs(parsed.query)
        if "uddg" in qs:
            links.append(qs["uddg"][0])
    return links


def search_candidates(query: str, max_results: int = 15) -> list[dict]:
    """
    Search DuckDuckGo Lite cho `query`, trả về candidate thuộc
    Qidian/novel543/69shuba, đã khử trùng lặp theo book_id, sắp theo độ ưu
    tiên nguồn (69shuba > novel543 > qidian).

    Không raise khi lỗi mạng — trả về [] để find_source() fallback êm.
    """
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"[!] search_candidates: lỗi search DuckDuckGo: {e}")
        return []

    seen_keys = set()
    candidates = []
    for link in _extract_duckduckgo_links(html):
        source = detect_source(link)
        if not source:
            continue
        book_id = _extract_book_id(source, link)
        if not book_id:
            continue
        key = f"{source}:{book_id}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        candidates.append({"source": source, "book_id": book_id, "url": link})

    candidates.sort(key=lambda c: _SOURCE_PRIORITY.get(c["source"], 99))
    return candidates[:max_results]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_source_finder.py -v`
Expected: PASS (4 tests trong step 1).

- [ ] **Step 5: Commit**

```bash
git add source_finder.py tests/test_source_finder.py
git commit -m "feat(source-finder): search Qidian/novel543/69shuba candidates via DuckDuckGo"
```

---

## Task 2: `probe_candidate` + `find_source` (verify thật bằng `NovelScraper`, xếp hạng theo số chương)

**Files:**
- Modify: `source_finder.py`
- Test: `tests/test_source_finder.py`

**Interfaces:**
- Consumes: `search_candidates` (Task 1); `scraper.NovelScraper` — `async def start(self)`, `async def fetch_novel_metadata(self, url: str) -> dict | None` (trả `{"title", "original_title", "author", "cover_url", "genre", "synopsis", "chapters": [...]}`), `async def close(self)` (đã có sẵn trong `scraper.py:141-606`, KHÔNG sửa file này).
- Produces:
  - `async def probe_candidate(scraper, candidate: dict) -> dict` — trả `{**candidate, "valid": bool, "chapter_count": int, "title": str, "author": str}`.
  - `async def find_source(query: str, max_results: int = 15) -> dict | None` — trả `{"best": dict | None, "all": list[dict]}`, hoặc `None` nếu `search_candidates` trả `[]`.

- [ ] **Step 1: Write the failing tests**

Thêm vào `tests/test_source_finder.py`. Repo này KHÔNG dùng `pytest-asyncio`
(kiểm tra `requirements-dev.lock` — không có plugin đó) — test async hiện có
trong repo (`test_scraper_politeness.py:26-27`) dùng helper `run(coro)` gọi
`asyncio.get_event_loop().run_until_complete(coro)`, KHÔNG dùng
`@pytest.mark.asyncio`. Theo đúng convention đó:

```python
import asyncio

from source_finder import probe_candidate, find_source


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeScraper:
    """Giả lập NovelScraper: mỗi book_id trả về số chương định sẵn qua `chapter_counts`."""

    def __init__(self, chapter_counts: dict[str, int], fail_ids: set[str] = frozenset()):
        self.chapter_counts = chapter_counts
        self.fail_ids = fail_ids
        self.started = False
        self.closed = False

    async def start(self):
        self.started = True

    async def close(self):
        self.closed = True

    async def fetch_novel_metadata(self, url: str):
        book_id = url.rstrip("/").rsplit("/", 1)[-1]
        if book_id in self.fail_ids:
            return None
        count = self.chapter_counts.get(book_id, 0)
        if count == 0:
            return None
        return {
            "title": f"Truyện {book_id}",
            "author": "Tác giả X",
            "chapters": [{"number": i, "title": f"Ch {i}", "url": url} for i in range(1, count + 1)],
        }


def test_probe_candidate_marks_valid_with_chapter_count():
    scraper = _FakeScraper(chapter_counts={"43484": 120})
    candidate = {"source": "69shuba", "book_id": "43484", "url": "https://www.69shuba.com/book/43484"}

    result = run(probe_candidate(scraper, candidate))

    assert result["valid"] is True
    assert result["chapter_count"] == 120
    assert result["title"] == "Truyện 43484"


def test_probe_candidate_marks_invalid_when_metadata_none():
    scraper = _FakeScraper(chapter_counts={}, fail_ids={"999"})
    candidate = {"source": "qidian", "book_id": "999", "url": "https://www.qidian.com/book/999"}

    result = run(probe_candidate(scraper, candidate))

    assert result["valid"] is False
    assert result["chapter_count"] == 0


def test_probe_candidate_swallows_exceptions():
    class _RaisingScraper(_FakeScraper):
        async def fetch_novel_metadata(self, url: str):
            raise RuntimeError("playwright crashed")

    scraper = _RaisingScraper(chapter_counts={})
    candidate = {"source": "qidian", "book_id": "1", "url": "https://www.qidian.com/book/1"}

    result = run(probe_candidate(scraper, candidate))

    assert result["valid"] is False
    assert result["chapter_count"] == 0


def test_find_source_picks_candidate_with_most_chapters(monkeypatch):
    candidates = [
        {"source": "69shuba", "book_id": "1", "url": "https://www.69shuba.com/book/1"},
        {"source": "novel543", "book_id": "2", "url": "https://www.novel543.com/2"},
    ]
    monkeypatch.setattr("source_finder.search_candidates", lambda query, max_results=15: candidates)
    monkeypatch.setattr(
        "source_finder.NovelScraper",
        lambda *a, **k: _FakeScraper(chapter_counts={"1": 50, "2": 200}),
    )

    result = run(find_source("bat ky ten truyen"))

    assert result["best"]["book_id"] == "2"
    assert result["best"]["chapter_count"] == 200
    assert len(result["all"]) == 2


def test_find_source_returns_none_best_when_no_candidate_valid(monkeypatch):
    candidates = [{"source": "qidian", "book_id": "1", "url": "https://www.qidian.com/book/1"}]
    monkeypatch.setattr("source_finder.search_candidates", lambda query, max_results=15: candidates)
    monkeypatch.setattr(
        "source_finder.NovelScraper",
        lambda *a, **k: _FakeScraper(chapter_counts={}, fail_ids={"1"}),
    )

    result = run(find_source("bat ky ten truyen"))

    assert result["best"] is None
    assert result["all"][0]["valid"] is False


def test_find_source_returns_none_when_no_candidates(monkeypatch):
    monkeypatch.setattr("source_finder.search_candidates", lambda query, max_results=15: [])

    result = run(find_source("truyen khong ton tai"))

    assert result is None
```

`find_source` gọi `NovelScraper(...)` trực tiếp (không nhận scraper qua tham
số) nên test patch thẳng `source_finder.NovelScraper` bằng 1 factory trả về
`_FakeScraper` — khớp với cách `find_source` (Task 2, Step 3) gọi
`NovelScraper()` không kèm argument.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_source_finder.py -v -k "probe_candidate or find_source"`
Expected: FAIL với `ImportError: cannot import name 'probe_candidate'`.

- [ ] **Step 3: Implement trong `source_finder.py`**

Thêm import và 2 hàm mới ở cuối file:

```python
from scraper import NovelScraper


async def probe_candidate(scraper: "NovelScraper", candidate: dict) -> dict:
    """
    Verify 1 candidate bằng cách scrape thật metadata + mục lục.
    Không bao giờ raise — lỗi bất kỳ (network/Playwright) → valid=False.
    """
    try:
        meta = await scraper.fetch_novel_metadata(candidate["url"])
    except Exception as e:
        print(f"[!] probe_candidate: lỗi probe {candidate['url']}: {e}")
        meta = None

    chapters = (meta or {}).get("chapters") or []
    return {
        **candidate,
        "valid": bool(meta) and len(chapters) > 0,
        "chapter_count": len(chapters),
        "title": (meta or {}).get("title", ""),
        "author": (meta or {}).get("author", ""),
    }


async def find_source(query: str, max_results: int = 15) -> dict | None:
    """
    Tìm + verify nguồn thật cho `query`. Trả None nếu không có candidate nào
    (search rỗng) — phân biệt với {"best": None, "all": [...]} khi có
    candidate nhưng không cái nào scrape được.
    """
    candidates = search_candidates(query, max_results)
    if not candidates:
        return None

    scraper = NovelScraper()
    await scraper.start()
    probed = []
    try:
        for candidate in candidates:
            probed.append(await probe_candidate(scraper, candidate))
    finally:
        await scraper.close()

    valid = [c for c in probed if c["valid"]]
    valid.sort(key=lambda c: c["chapter_count"], reverse=True)

    return {"best": valid[0] if valid else None, "all": probed}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_source_finder.py -v`
Expected: PASS (10 tests tổng — 4 từ Task 1 + 6 từ Task 2).

- [ ] **Step 5: Commit**

```bash
git add source_finder.py tests/test_source_finder.py
git commit -m "feat(source-finder): verify candidates via real scrape, rank by chapter count"
```

---

## Task 3: Lệnh CLI `python main.py find-source "<tên truyện>"`

**Files:**
- Modify: `main.py` (thêm subparser cạnh `import` ~dòng 554, thêm `cmd_find_source` cạnh `cmd_import` ~dòng 526, đăng ký vào dict `commands` ~dòng 589)
- Test: `tests/test_main_find_source.py`

**Interfaces:**
- Consumes: `source_finder.find_source` (Task 2) — signature `async def find_source(query: str, max_results: int = 15) -> dict | None`.
- Produces: `cmd_find_source(args)` — hàm sync, gọi `asyncio.run(...)`, không trả giá trị (in ra stdout), set `sys.exit(1)` khi không có candidate hợp lệ.

- [ ] **Step 1: Write the failing test**

Tạo `tests/test_main_find_source.py`:

```python
import sys
from unittest.mock import patch

import pytest

import main as main_module


def test_cmd_find_source_prints_best_and_import_hint(capsys):
    fake_result = {
        "best": {
            "source": "69shuba", "book_id": "43484",
            "url": "https://www.69shuba.com/book/43484",
            "valid": True, "chapter_count": 300,
            "title": "Phía trên tháp cao", "author": "Phong Phong Mang Mang",
        },
        "all": [{
            "source": "69shuba", "book_id": "43484",
            "url": "https://www.69shuba.com/book/43484",
            "valid": True, "chapter_count": 300,
            "title": "Phía trên tháp cao", "author": "Phong Phong Mang Mang",
        }],
    }

    async def _fake_find_source(query, max_results=15):
        return fake_result

    args = type("Args", (), {"query": "Phía trên tháp cao"})()

    with patch("main.source_finder.find_source", side_effect=_fake_find_source):
        main_module.cmd_find_source(args)

    out = capsys.readouterr().out
    assert "https://www.69shuba.com/book/43484" in out
    assert "python main.py import --url https://www.69shuba.com/book/43484" in out


def test_cmd_find_source_exits_nonzero_when_nothing_found(capsys):
    async def _fake_find_source(query, max_results=15):
        return None

    args = type("Args", (), {"query": "truyen khong ton tai"})()

    with patch("main.source_finder.find_source", side_effect=_fake_find_source):
        with pytest.raises(SystemExit) as exc_info:
            main_module.cmd_find_source(args)

    assert exc_info.value.code != 0
    assert "Không tìm thấy nguồn" in capsys.readouterr().out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_main_find_source.py -v`
Expected: FAIL với `AttributeError: module 'main' has no attribute 'cmd_find_source'` (hoặc `'source_finder'`).

- [ ] **Step 3: Implement trong `main.py`**

Thêm import ở đầu file (cạnh các import module khác, ví dụ gần dòng import `scraper`):

```python
import source_finder
```

Thêm hàm `cmd_find_source`, đặt cạnh `cmd_import` (main.py ~526):

```python
def cmd_find_source(args):
    result = asyncio.run(source_finder.find_source(args.query))

    if not result or not result["all"]:
        print(f"❌ Không tìm thấy nguồn nào cho \"{args.query}\" trên Qidian/novel543/69shuba.")
        sys.exit(1)

    print(f"\n🔍 Kết quả tìm nguồn cho \"{args.query}\":")
    print(f"{'Nguồn':<10} | {'Số chương':<10} | {'Hợp lệ':<6} | URL")
    print("-" * 90)
    ranked = sorted(result["all"], key=lambda c: c["chapter_count"], reverse=True)
    for c in ranked:
        print(f"{c['source']:<10} | {c['chapter_count']:<10} | {str(c['valid']):<6} | {c['url']}")

    best = result["best"]
    if best:
        print(f"\n✅ Nguồn tốt nhất: {best['source']} — {best['chapter_count']} chương")
        print(f"👉 Chạy: python main.py import --url {best['url']}")
    else:
        print("\n⚠️  Có candidate nhưng không cái nào scrape được (bị chặn/lỗi).")
        sys.exit(1)
```

Cần `import sys` ở đầu `main.py` nếu chưa có (kiểm tra trước khi thêm — tránh import trùng).

Thêm subparser, đặt ngay sau khối `import` (main.py ~554):

```python
    p_find = subparsers.add_parser(
        "find-source",
        help="Tìm URL trang truyện thật trên Qidian/novel543/69shuba theo tên",
    )
    p_find.add_argument("query", type=str, help="Tên truyện cần tìm (tiếng Trung hoặc Việt)")
```

Đăng ký vào dict `commands` (main.py ~589):

```python
    commands = {
        "new": cmd_new,
        "list": cmd_list,
        "info": cmd_info,
        "glossary": cmd_glossary,
        "translate": cmd_translate,
        "retranslate": cmd_retranslate,
        "import": cmd_import,
        "find-source": cmd_find_source,
    }
```

`find-source` nhận positional argument `args.query`, khớp với `type("Args", (), {"query": ...})()` dùng trong test.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_main_find_source.py tests/test_source_finder.py -v`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_main_find_source.py
git commit -m "feat(main): add 'find-source' CLI command"
```

---

## Task 4: Tích hợp fallback thật vào `discover.py --search`

**Files:**
- Modify: `discover.py` (`interactive_search`, dòng 159-172)
- Test: `tests/test_discover_search.py`

**Interfaces:**
- Consumes: `source_finder.find_source` (Task 2).
- Produces: `interactive_search(client, model)` giữ nguyên signature, thêm bước gọi `find_source` thật trước khi fallback Gemini.

- [ ] **Step 1: Write the failing test**

Tạo `tests/test_discover_search.py`:

```python
from unittest.mock import patch, MagicMock

import discover


def test_interactive_search_prints_real_url_when_found(capsys, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _: "Phía trên tháp cao")

    async def _fake_find_source(query, max_results=15):
        return {
            "best": {
                "source": "69shuba", "book_id": "1", "url": "https://www.69shuba.com/book/1",
                "valid": True, "chapter_count": 300, "title": "T", "author": "A",
            },
            "all": [],
        }

    fake_client, fake_model = MagicMock(), "gemini-3-flash-preview"

    with patch("discover.source_finder.find_source", side_effect=_fake_find_source):
        with patch("discover.ask_gemini") as mocked_ask_gemini:
            discover.interactive_search(fake_client, fake_model)

    out = capsys.readouterr().out
    assert "https://www.69shuba.com/book/1" in out
    assert "300" in out
    mocked_ask_gemini.assert_not_called()


def test_interactive_search_falls_back_to_gemini_when_nothing_found(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _: "truyen khong ton tai abc")

    async def _fake_find_source(query, max_results=15):
        return None

    fake_client, fake_model = MagicMock(), "gemini-3-flash-preview"

    with patch("discover.source_finder.find_source", side_effect=_fake_find_source):
        with patch("discover.ask_gemini", return_value="[gợi ý Gemini]") as mocked_ask_gemini:
            discover.interactive_search(fake_client, fake_model)

    mocked_ask_gemini.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_discover_search.py -v`
Expected: FAIL — `interactive_search` hiện luôn gọi `ask_gemini` (assert `not_called()` fail ở test đầu).

- [ ] **Step 3: Implement trong `discover.py`**

Thêm `import asyncio` và `import source_finder` ở đầu file (cạnh các import khác).

Sửa `interactive_search` (discover.py:159-172):

```python
def interactive_search(client, model):
    """Chế độ hỏi đáp về một truyện cụ thể."""
    print("\n" + "─"*50)
    print("  🔎 Tìm thông tin truyện cụ thể")
    print("─"*50)
    print("  Nhập tên truyện tiếng Trung hoặc tiếng Việt:")
    novel_name = input("  > ").strip()
    if not novel_name:
        return

    print(f"\n[*] Đang tìm nguồn thật cho '{novel_name}'...")
    result = asyncio.run(source_finder.find_source(novel_name))
    best = result["best"] if result else None

    if best:
        print(f"\n✅ Tìm thấy nguồn: {best['source']} — {best['chapter_count']} chương")
        print(f"   URL: {best['url']}")
        print(f"   👉 Chạy: python main.py import --url {best['url']}")
        return

    print("[*] Không tìm thấy nguồn thật, thử hỏi Gemini gợi ý...")
    prompt = build_search_help_prompt(novel_name)
    result = ask_gemini(client, model, prompt)
    print("\n" + result)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_discover_search.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discover.py tests/test_discover_search.py
git commit -m "feat(discover): use real source_finder lookup before falling back to Gemini guess"
```

---

## Task 5: Kiểm thử thủ công với test case thật (không phải CI)

Task này KHÔNG viết code mới — chỉ chạy tay để xác nhận toàn bộ pipeline hoạt động với 1 truyện thật, theo đúng test case đã chốt trong spec.

**Files:** không có (chỉ chạy lệnh, ghi lại kết quả trong PR description).

- [ ] **Step 1: Chạy toàn bộ test suite mới**

Run: `pytest tests/test_source_finder.py tests/test_main_find_source.py tests/test_discover_search.py -v`
Expected: Tất cả PASS.

- [ ] **Step 2: Chạy thử thật với novel test case**

Run: `python main.py find-source "Phía trên tháp cao"`

Ghi lại kết quả thật (không đoán trước):
- Nếu có `best` → copy URL, chạy thử `python main.py import --url <url>` để xác nhận `import` chạy được với URL do `find-source` trả về (đúng mục tiêu end-to-end của tính năng).
- Nếu KHÔNG có `best` → thử lại với tên gốc tiếng Trung nếu xác định được, hoặc thử `python main.py find-source "Phong Phong Mang Mang Phía trên tháp cao"` (ghép tên tác giả vào query để tăng độ chính xác search). Đây là giới hạn đã ghi trong spec (mục "Kiểm thử thủ công"), không phải bug cần fix trong plan này.

- [ ] **Step 3: Chạy toàn bộ test suite hiện có của repo để đảm bảo không phá vỡ gì**

Run: `pytest -v`
Expected: Không có test nào trước đây bị FAIL mới xuất hiện (so sánh với baseline trước khi bắt đầu Task 1).

- [ ] **Step 4: Ghi kết quả thủ công vào PR/commit description**

Không cần code thêm — chỉ cần note lại: candidate nào tìm được cho "Phía trên tháp cao", có `import` được không, nếu không thì lý do (không có candidate hợp lệ / bị chặn / search rỗng).
