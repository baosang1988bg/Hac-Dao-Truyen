"""
test_scraper_ssrf.py
---------------------
Test tái hiện + xác nhận SSRF ở `scraper.py` (Playwright).

Trước khi sửa: `scraper.fetch_html()` gọi thẳng `page.goto(url, ...)` mà
KHÔNG hề gọi `security_utils.validate_source_url` — nghĩa là kiểm tra SSRF ở
`security_utils.py` chưa từng được áp dụng cho luồng scrape thật (chỉ được
áp dụng ở `routers/translate.py`, không phải ở `scraper.py`). Ngoài ra
Playwright tự follow redirect ở tầng browser nên chỉ kiểm tra URL đầu vào là
không đủ — cần chặn lại từng hop.

Không khởi động browser Playwright thật và không gọi mạng thật: dùng
đối tượng "fake" mô phỏng API `page`/`route`/`request` của Playwright, và
monkeypatch `scraper.validate_source_url` để không phải resolve DNS thật.
"""
import asyncio

import pytest
from fastapi import HTTPException

import scraper as scraper_module
from scraper import NovelScraper


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _mock_validate(monkeypatch, blocked_urls):
    """Giả lập validate_source_url: raise cho URL nằm trong blocked_urls."""
    def _fake(url, *args, **kwargs):
        if url in blocked_urls:
            raise HTTPException(status_code=400, detail="Không cho phép URL nội bộ")
        return url
    monkeypatch.setattr(scraper_module, "validate_source_url", _fake)


# ── _is_url_safe ─────────────────────────────────────────────────────────────

def test_is_url_safe_tra_ve_true_khi_url_hop_le(monkeypatch):
    _mock_validate(monkeypatch, blocked_urls=set())
    assert run(NovelScraper._is_url_safe("http://example.com/")) is True


def test_is_url_safe_tra_ve_false_khi_url_bi_chan(monkeypatch):
    _mock_validate(monkeypatch, blocked_urls={"http://169.254.169.254/"})
    assert run(NovelScraper._is_url_safe("http://169.254.169.254/")) is False


def test_is_url_safe_khong_raise_ma_tra_ve_false_khi_loi_bat_ngo(monkeypatch):
    def _raise_runtime_error(*args, **kwargs):
        raise RuntimeError("lỗi không mong muốn")
    monkeypatch.setattr(scraper_module, "validate_source_url", _raise_runtime_error)
    # Không được raise ra ngoài — phải fail-closed (trả về False).
    assert run(NovelScraper._is_url_safe("http://example.com/")) is False


# ── fetch_html: URL ban đầu bị chặn trước khi mở page ────────────────────────

def test_fetch_html_tra_ve_none_khi_url_ban_dau_la_noi_bo(monkeypatch):
    _mock_validate(monkeypatch, blocked_urls={"http://127.0.0.1/admin"})

    scraper = NovelScraper()

    async def _fail_if_called(*args, **kwargs):
        raise AssertionError("Không được mở page khi URL ban đầu bị chặn")
    # Nếu code cũ (không kiểm tra) chạy tới đây sẽ gọi start()/new_page() —
    # gán fail để phát hiện ngay nếu guard bị bỏ sót.
    scraper.start = _fail_if_called

    class _FakeContext:
        async def new_page(self):
            raise AssertionError("Không được tạo page khi URL bị chặn SSRF")
    scraper._context = _FakeContext()

    result = run(scraper.fetch_html("http://127.0.0.1/admin"))
    assert result is None


# ── _install_ssrf_guard: mô phỏng route handler chặn redirect/subresource ──

class _FakeRequest:
    def __init__(self, url, resource_type="document"):
        self.url = url
        self.resource_type = resource_type


class _FakeRoute:
    def __init__(self, request):
        self.request = request
        self.continued = False
        self.aborted = False

    async def continue_(self):
        self.continued = True

    async def abort(self):
        self.aborted = True


class _FakePage:
    """Mô phỏng đủ API `page.route()` của Playwright để test route handler."""
    def __init__(self):
        self._handler = None

    async def route(self, pattern, handler):
        self._handler = handler

    async def dispatch(self, request):
        route = _FakeRoute(request)
        await self._handler(route)
        return route


def test_ssrf_guard_cho_qua_request_hop_le(monkeypatch):
    _mock_validate(monkeypatch, blocked_urls=set())
    scraper = NovelScraper()
    page = _FakePage()
    run(scraper._install_ssrf_guard(page))

    route = run(page.dispatch(_FakeRequest("https://cdn.example.com/style.css", "stylesheet")))
    assert route.continued is True
    assert route.aborted is False


def test_ssrf_guard_chan_redirect_toi_noi_bo(monkeypatch):
    """
    Mô phỏng đúng kịch bản review lo ngại: URL ban đầu công khai, nhưng
    server trả redirect (3xx) tới địa chỉ nội bộ (vd. SSRF qua open redirect).
    Playwright coi hop redirect là 1 "document" request mới đi qua route
    handler — guard phải chặn hop này dù URL đầu vào hợp lệ.
    """
    redirected_url = "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
    _mock_validate(monkeypatch, blocked_urls={redirected_url})
    scraper = NovelScraper()
    page = _FakePage()
    run(scraper._install_ssrf_guard(page))

    route = run(page.dispatch(_FakeRequest(redirected_url, "document")))
    assert route.aborted is True
    assert route.continued is False


def test_ssrf_guard_chan_subresource_toi_noi_bo(monkeypatch):
    """Không chỉ document/navigation — ảnh/script/xhr trỏ nội bộ cũng bị chặn."""
    internal_img = "http://192.168.1.1/secret.png"
    _mock_validate(monkeypatch, blocked_urls={internal_img})
    scraper = NovelScraper()
    page = _FakePage()
    run(scraper._install_ssrf_guard(page))

    route = run(page.dispatch(_FakeRequest(internal_img, "image")))
    assert route.aborted is True
    assert route.continued is False
