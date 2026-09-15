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
