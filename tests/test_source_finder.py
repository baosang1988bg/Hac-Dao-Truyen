import asyncio
import urllib.request
from unittest.mock import patch, MagicMock

from source_finder import (
    SOURCE_DOMAINS,
    detect_source,
    find_source,
    probe_candidate,
    search_candidates,
)


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


def run(coro):
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())
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
