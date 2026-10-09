import asyncio
import logging

import pipeline


class FlakyScraper:
    """Trang 2 lỗi tạm thời ở lần gọi đầu (vd Jina Reader rate-limit)."""

    def __init__(self, fail_times):
        self.fail_times = dict(fail_times)
        self.calls = []

    async def fetch_html(self, url):
        self.calls.append(url)
        if self.fail_times.get(url, 0) > 0:
            self.fail_times[url] -= 1
            return None
        return url

    def parse_content(self, html, url):
        if url.endswith("_2.html"):
            return "第1章 x (2/2)", "trang hai", None, None
        return "第1章 x (1/2)", "trang một", None, None


def _run(coro):
    # Loop riêng, KHÔNG dùng asyncio.run (nó gỡ event loop hiện tại, làm hỏng
    # các test khác dùng asyncio.get_event_loop()).
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _no_sleep(monkeypatch):
    async def fake_sleep(_):
        return None
    monkeypatch.setattr(pipeline.asyncio, "sleep", fake_sleep)


def test_paginated_fetch_retries_transient_page_failure(monkeypatch):
    _no_sleep(monkeypatch)
    scraper = FlakyScraper({"https://x/8096_1.html": 1, "https://x/8096_1_2.html": 2})

    title, content, _, _ = _run(pipeline.fetch_and_merge_paginated_chapter_async(
        scraper, "https://x/8096_1.html", logging.getLogger("t")))

    assert title == "第1章 x"
    assert content == "trang một\n\ntrang hai"


def test_paginated_fetch_gives_up_after_max_attempts(monkeypatch):
    _no_sleep(monkeypatch)
    scraper = FlakyScraper({"https://x/8096_1_2.html": 99})

    try:
        _run(pipeline.fetch_and_merge_paginated_chapter_async(
            scraper, "https://x/8096_1.html", logging.getLogger("t")))
    except RuntimeError as e:
        assert "2/2" in str(e)
    else:
        raise AssertionError("phải raise khi trang vẫn lỗi sau khi thử lại")
    assert scraper.calls.count("https://x/8096_1_2.html") == pipeline.FETCH_ATTEMPTS
