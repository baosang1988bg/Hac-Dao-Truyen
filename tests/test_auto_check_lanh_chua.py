from tools import auto_check_lanh_chua


class _FakeResponse:
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self._body


def test_fetch_latest_chapters_bypasses_jina_cache(monkeypatch):
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        seen["timeout"] = timeout
        return _FakeResponse(
            "* [第1512章 跨界征軍]"
            "(https://www.novel543.com/0606657941/8096_1512.html)"
        )

    monkeypatch.setattr(auto_check_lanh_chua.urllib.request, "urlopen", fake_urlopen)

    chapters = auto_check_lanh_chua.fetch_latest_chapters()

    assert seen["timeout"] == 30
    assert seen["request"].get_header("X-no-cache") == "true"
    assert seen["request"].get_header("X-cache-tolerance") == "0"
    assert chapters == [
        {
            "number": 1512,
            "original_title": "第1512章 跨界征軍",
            "raw_title": "跨界征軍",
            "url": "https://www.novel543.com/0606657941/8096_1512.html",
        }
    ]
