"""
test_scraper_politeness.py
---------------------------
Test rate limit THEO HOST (không theo domain đích 1 truyện) và cơ chế
backoff/circuit-breaker khi 1 host trả lỗi liên tiếp (403/429/5xx hoặc bị
phát hiện chặn), thuộc mục F04 của kế hoạch xử lý review.

Không khởi động Playwright thật, không gọi mạng thật:
- Test `HostRateLimiter` (module-level, thuần asyncio) dùng clock/sleeper giả
  lập (fake time) để kiểm tra chính xác khoảng chờ mà KHÔNG phải chờ thời
  gian thực.
- Test tích hợp với `NovelScraper.fetch_html` dùng object "fake" mô phỏng
  API `context`/`page` của Playwright (cùng phong cách với
  `test_scraper_ssrf.py`) để xác nhận: khi 1 host đã bị circuit-breaker
  chặn, `fetch_html` trả về None NGAY LẬP TỨC mà không mở page / gọi mạng.
"""
import asyncio

import pytest
from fastapi import HTTPException

import scraper as scraper_module
from scraper import HostRateLimiter, NovelScraper, ScraperBlockedError


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeClock:
    """Đồng hồ giả: chỉ tiến khi `advance()` hoặc `fake_sleep` được gọi."""

    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def _make_fake_sleeper(clock: _FakeClock):
    """Sleeper giả: không chờ thời gian thực, chỉ tiến đồng hồ giả và ghi
    lại khoảng thời gian đã 'chờ' để test assert chính xác."""
    calls = []

    async def _fake_sleep(seconds):
        calls.append(seconds)
        clock.now += seconds

    return _fake_sleep, calls


# ── Rate limit theo host: 2 host khác nhau không bị chặn chéo ────────────────

def test_2_host_khac_nhau_khong_bi_cho_nhau():
    clock = _FakeClock()
    sleeper, calls = _make_fake_sleeper(clock)
    limiter = HostRateLimiter(min_interval=5.0, clock=clock, sleeper=sleeper)

    run(limiter.wait("http://host-a.com/chuong-1"))
    # Request ngay lập tức tới HOST KHÁC — không được chờ dù host-a vừa
    # request ở "cùng thời điểm" (host key khác nhau).
    run(limiter.wait("http://host-b.com/chuong-1"))

    assert calls == [], f"Không được sleep khi request tới host khác, nhưng đã sleep: {calls}"


# ── Rate limit theo host: cùng host bị giới hạn đúng khoảng cách tối thiểu ───

def test_cung_host_bi_gioi_han_dung_khoang_cach_toi_thieu():
    clock = _FakeClock()
    sleeper, calls = _make_fake_sleeper(clock)
    limiter = HostRateLimiter(min_interval=5.0, clock=clock, sleeper=sleeper)

    run(limiter.wait("http://host-a.com/chuong-1"))
    assert calls == []  # request đầu tiên không cần chờ

    run(limiter.wait("http://host-a.com/chuong-2"))
    assert calls == [5.0], f"Request thứ 2 cùng host phải chờ đủ min_interval, calls={calls}"


def test_host_key_dung_netloc_khong_phan_biet_hoa_thuong():
    assert HostRateLimiter.host_key("HTTP://Example.COM:8080/x") == "example.com:8080"


# ── Backoff tăng dần theo số lỗi liên tiếp ────────────────────────────────────

def test_backoff_tang_theo_cap_so_nhan_sau_moi_loi_lien_tiep():
    clock = _FakeClock()
    sleeper, calls = _make_fake_sleeper(clock)
    limiter = HostRateLimiter(
        min_interval=0.0, max_consecutive_errors=10,
        backoff_base=2.0, backoff_max=100.0,
        clock=clock, sleeper=sleeper,
    )
    url = "http://host-a.com/chuong-1"

    run(limiter.wait(url))  # request đầu tiên: không lỗi, không sleep
    assert calls == []

    limiter.record_error(url)  # 1 lỗi liên tiếp → backoff = 2 * 2^0 = 2
    run(limiter.wait(url))
    assert calls == [2.0]

    limiter.record_error(url)  # 2 lỗi liên tiếp → backoff = 2 * 2^1 = 4
    run(limiter.wait(url))
    assert calls == [2.0, 4.0]


def test_backoff_bi_gioi_han_boi_backoff_max():
    clock = _FakeClock()
    sleeper, calls = _make_fake_sleeper(clock)
    limiter = HostRateLimiter(
        min_interval=0.0, max_consecutive_errors=10,
        backoff_base=2.0, backoff_max=5.0,
        clock=clock, sleeper=sleeper,
    )
    url = "http://host-a.com/chuong-1"
    run(limiter.wait(url))
    for _ in range(5):  # backoff lý thuyết sẽ vượt xa 5.0 nếu không trần
        limiter.record_error(url)
    run(limiter.wait(url))
    assert calls == [5.0]


# ── Circuit breaker: dừng hẳn sau N lỗi liên tiếp ─────────────────────────────

def test_dung_han_sau_n_loi_lien_tiep_raise_scraper_blocked_error():
    clock = _FakeClock()
    sleeper, calls = _make_fake_sleeper(clock)
    limiter = HostRateLimiter(
        min_interval=0.0, max_consecutive_errors=3,
        backoff_base=1.0, backoff_max=10.0,
        clock=clock, sleeper=sleeper,
    )
    url = "http://host-a.com/chuong-1"

    for _ in range(3):
        limiter.record_error(url)

    with pytest.raises(ScraperBlockedError) as exc_info:
        run(limiter.wait(url))

    assert "host-a.com" in str(exc_info.value)
    # Không được sleep/gọi thêm gì — dừng NGAY, không lặp lại vô hạn.
    assert calls == []


def test_loi_lien_tiep_khong_anh_huong_host_khac():
    """Circuit breaker phải theo TỪNG HOST — host-b không bị ảnh hưởng bởi
    lỗi liên tiếp của host-a."""
    limiter = HostRateLimiter(min_interval=0.0, max_consecutive_errors=2)
    for _ in range(5):
        limiter.record_error("http://host-a.com/x")

    with pytest.raises(ScraperBlockedError):
        run(limiter.wait("http://host-a.com/x"))

    # host-b chưa từng lỗi → không bị chặn
    run(limiter.wait("http://host-b.com/x"))


def test_record_success_reset_bo_dem_loi_lien_tiep():
    limiter = HostRateLimiter(min_interval=0.0, max_consecutive_errors=2)
    url = "http://host-a.com/x"
    limiter.record_error(url)
    limiter.record_error(url)
    limiter.record_success(url)
    # Sau khi thành công, bộ đếm reset về 0 → wait() không raise nữa
    run(limiter.wait(url))


# ── Tích hợp với fetch_html: dừng hẳn KHÔNG mở page khi host đã bị chặn ──────

def _mock_validate(monkeypatch, blocked_urls=frozenset()):
    def _fake(url, *args, **kwargs):
        if url in blocked_urls:
            raise HTTPException(status_code=400, detail="URL nội bộ")
        return url
    monkeypatch.setattr(scraper_module, "validate_source_url", _fake)


def test_fetch_html_dung_han_khong_mo_page_khi_host_da_bi_circuit_break(monkeypatch):
    _mock_validate(monkeypatch)

    scraper = NovelScraper()
    url = "http://host-bi-chan.com/chuong-1"
    # Giả lập host này đã lỗi liên tiếp vượt ngưỡng (mặc định 5 lần).
    for _ in range(scraper._rate_limiter.max_consecutive_errors):
        scraper._rate_limiter.record_error(url)

    async def _fail_if_called(*args, **kwargs):
        raise AssertionError("Không được start()/mở page khi host đã bị circuit-break")
    scraper.start = _fail_if_called

    class _FakeContext:
        async def new_page(self):
            raise AssertionError("Không được tạo page khi host đã bị circuit-break")
    scraper._context = _FakeContext()

    result = run(scraper.fetch_html(url))
    assert result is None


def test_fetch_html_khong_bi_chan_cheo_giua_2_host(monkeypatch):
    """Host A bị circuit-break không được làm host B (khác hẳn) cũng bị
    chặn — dùng lại đúng 1 rate limiter instance cho 2 host khác nhau."""
    _mock_validate(monkeypatch)

    scraper = NovelScraper()
    blocked_url = "http://host-bi-chan.com/chuong-1"
    other_url = "http://host-binh-thuong.com/chuong-1"
    for _ in range(scraper._rate_limiter.max_consecutive_errors):
        scraper._rate_limiter.record_error(blocked_url)

    # host-binh-thuong.com chưa từng lỗi → wait() không raise.
    run(scraper._rate_limiter.wait(other_url))
