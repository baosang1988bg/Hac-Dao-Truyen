"""
tests/test_scraper_novel543.py
-------------------------------
Test cho bug: scraper.py trước đây set `is_blocked = True` VÔ ĐIỀU KIỆN cho
domain novel543.com trong NovelScraper.fetch_html, khiến hàm luôn bỏ qua HTML
thật để dùng fallback Jina Reader (r.jina.ai). HTML dựng lại từ Jina chỉ có
<h1> + text thô, không có thẻ <a>, nên fetch_novel_metadata (scan
`a[href*='read']`) luôn trả về 0 chapter cho novel543 — tính năng import
1-click gần như vô dụng với nguồn này.

Các test này KHÔNG gọi mạng thật (không Playwright, không r.jina.ai) — dùng
fixture HTML tĩnh + mock hàm fetch_html để verify:
  (a) is_blocked (qua NovelScraper._detect_block) không còn bị set cứng True
      cho novel543.com khi HTML hợp lệ.
  (b) fetch_novel_metadata trả về đúng số chương từ fixture khi fetch_html
      (đã mock) trả về HTML thật thay vì rơi vào nhánh Jina rỗng thẻ <a>.

Chạy:  python3 -m pytest tests/test_scraper_novel543.py -v
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402

from scraper import NovelScraper  # noqa: E402


NOVEL543_CATALOG_URL = "https://www.novel543.com/0001/dir"

# Fixture HTML tĩnh giả lập trang mục lục chương của novel543 — có đủ selector
# mong đợi (h1, #content) và vài thẻ <a href="...read..."> chương thật.
NOVEL543_CATALOG_HTML = """
<html>
<head><title>Truyện Mẫu</title></head>
<body>
    <h1>Truyện Mẫu Test</h1>
    <div class="writer">Tác Giả Test</div>
    <div id="content">
        <div class="intro">Đây là tóm tắt truyện mẫu dùng để test scraper.</div>
        <ul class="catalog">
            <li><a href="/0001/read_1.html">第1章 Chương Mở Đầu</a></li>
            <li><a href="/0001/read_2.html">第2章 Gặp Gỡ</a></li>
            <li><a href="/0001/read_3.html">第3章 Rời Đi</a></li>
            <li><a href="/0001/read_4.html">第4章 Trở Về</a></li>
            <li><a href="/0001/read_5.html">第5章 Kết Thúc</a></li>
        </ul>
    </div>
</body>
</html>
""" + ("<!-- padding to simulate realistic page size --> " * 20)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── (a) is_blocked không còn set cứng True cho novel543.com ─────────────────

def test_detect_block_not_forced_true_for_novel543_valid_html():
    """HTML hợp lệ (đủ dài, không có dấu hiệu chặn thật, status 200) thì
    is_blocked phải là False cho novel543.com — bug cũ set cứng True vô điều kiện."""
    scraper = NovelScraper()
    is_blocked = scraper._detect_block(
        html=NOVEL543_CATALOG_HTML,
        status_code=200,
        url=NOVEL543_CATALOG_URL,
    )
    assert is_blocked is False, (
        "is_blocked phải False khi HTML novel543 hợp lệ và không có dấu hiệu "
        "chặn thật — bug cũ set cứng True vô điều kiện cho domain này."
    )


def test_detect_block_true_on_real_block_signals():
    """is_blocked vẫn phải True khi có dấu hiệu chặn THẬT (status 403, hoặc
    nội dung chứa từ khóa Cloudflare/captcha), kể cả với novel543.com."""
    scraper = NovelScraper()

    # status code 403
    assert scraper._detect_block(
        html=NOVEL543_CATALOG_HTML, status_code=403, url=NOVEL543_CATALOG_URL
    ) is True

    # nội dung chứa từ khóa chặn phổ biến
    blocked_html = "<html><body>Checking your browser... Cloudflare Ray ID: 123</body></html>"
    assert scraper._detect_block(
        html=blocked_html, status_code=200, url=NOVEL543_CATALOG_URL
    ) is True

    # response ngắn bất thường (trang lỗi/captcha)
    assert scraper._detect_block(
        html="<html></html>", status_code=200, url=NOVEL543_CATALOG_URL
    ) is True


def test_detect_block_other_domains_unaffected():
    """Không đổi hành vi domain khác: 69shuba/default vẫn dựa trên tín hiệu
    thật (không có is_blocked ép cứng ngoài phạm vi qidian.com)."""
    scraper = NovelScraper()
    shuba_url = "https://www.69shuba.com/txt/43484/28931795"
    assert scraper._detect_block(
        html=NOVEL543_CATALOG_HTML, status_code=200, url=shuba_url
    ) is False

    # qidian.com vẫn giữ hành vi ép fallback cũ (ngoài phạm vi sửa lỗi này)
    assert scraper._detect_block(
        html=NOVEL543_CATALOG_HTML, status_code=200, url="https://www.qidian.com/book/1"
    ) is True


# ── (b) fetch_novel_metadata parse đúng số chương từ fixture ─────────────────

def test_fetch_novel_metadata_parses_chapters_from_real_html():
    """Khi fetch_html (đã mock, không gọi mạng thật) trả về HTML thật có thẻ
    <a href*='read'>, fetch_novel_metadata phải trả về đúng 5 chương —
    không còn rơi vào nhánh Jina (mock_html không có thẻ <a>) làm mất hết
    danh sách chương."""
    scraper = NovelScraper()
    scraper.fetch_html = AsyncMock(return_value=NOVEL543_CATALOG_HTML)

    meta = _run(scraper.fetch_novel_metadata(NOVEL543_CATALOG_URL))

    assert meta is not None
    assert meta["title"] == "Truyện Mẫu Test"
    assert meta["author"] == "Tác Giả Test"
    assert len(meta["chapters"]) == 5, (
        f"Kỳ vọng 5 chương từ fixture, được {len(meta['chapters'])}. "
        "Nếu về 0, nghĩa là luồng lại rơi vào fallback Jina mất thẻ <a>."
    )
    numbers = [c["number"] for c in meta["chapters"]]
    assert numbers == [1, 2, 3, 4, 5]
    assert meta["chapters"][0]["url"].endswith("/0001/read_1.html")


def test_fetch_novel_metadata_jina_markdown_links_still_parsed():
    """Trường hợp thật sự bị chặn và phải dùng mock_html dựng từ Jina: nếu
    markdown Jina có link dạng [text](url), fetch_novel_metadata vẫn phải
    trích được chương thay vì luôn 0 chapter."""
    scraper = NovelScraper()
    jina_style_mock_html = (
        "<html><body><h1>Truyện Mẫu Test</h1>"
        "<div id='content'>Mục lục chương</div>"
        "<div id='jina-links'>"
        "<a href='https://www.novel543.com/0001/read_1.html'>Chương 1</a>"
        "<a href='https://www.novel543.com/0001/read_2.html'>Chương 2</a>"
        "</div></body></html>"
    )
    scraper.fetch_html = AsyncMock(return_value=jina_style_mock_html)

    meta = _run(scraper.fetch_novel_metadata(NOVEL543_CATALOG_URL))

    assert meta is not None
    assert len(meta["chapters"]) == 2


# ── Chạy trực tiếp không cần pytest ─────────────────────────────────────────

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {fn.__name__}: lỗi {type(e).__name__}: {e}")
    total = len(fns)
    print(f"\n{passed}/{total} PASS")
    sys.exit(0 if passed == total else 1)
