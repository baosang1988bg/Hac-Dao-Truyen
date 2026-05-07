"""
scraper.py
----------
Fetch và parse HTML từ các trang web tiểu thuyết.
Hỗ trợ multi-site thông qua SITE_SELECTORS trong config.py.
Tự động xử lý encoding (UTF-8 / GBK / GB2312) và relative URL.
"""

import asyncio
import re
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from config import USER_AGENT, HEADLESS, SITE_SELECTORS

# Các site dùng encoding GBK/GB2312 thay vì UTF-8
GBK_DOMAINS = {"69shuba.com", "69shu.com", "readnovel.com"}


class NovelScraper:
    def __init__(self):
        self.user_agent = USER_AGENT
        self.headless = HEADLESS

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _get_selectors(self, url: str) -> dict:
        """Trả về selector config phù hợp với domain của URL."""
        for domain, selectors in SITE_SELECTORS.items():
            if domain != "default" and domain in url:
                return selectors
        return SITE_SELECTORS["default"]

    def _is_gbk_site(self, url: str) -> bool:
        """Kiểm tra xem site có dùng encoding GBK không."""
        return any(domain in url for domain in GBK_DOMAINS)

    def _resolve_url(self, href: str, base_url: str) -> str | None:
        """Chuyển relative URL thành absolute URL."""
        if not href:
            return None
        if href.startswith("http"):
            return href
        parsed = urlparse(base_url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if href.startswith("/"):
            return base + href
        # relative path (e.g. "../chapter/2")
        return base + "/" + href.lstrip("./")

    def _select_first(self, soup: BeautifulSoup, css_selector: str):
        """Thử nhiều selector cách nhau bằng dấu phẩy, trả về element đầu tiên."""
        for sel in [s.strip() for s in css_selector.split(",")]:
            elem = soup.select_one(sel)
            if elem:
                return elem
        return None

    # ── Fetch ─────────────────────────────────────────────────────────────────

    async def fetch_html(self, url: str) -> str | None:
        """
        Fetch HTML dùng Playwright.
        - Dùng Windows Chrome UA (Mac UA bị một số site filter là bot)
        - Luôn include Referer và Accept-Language để trông giống user thật
        - Fallback: nếu content không tìm được, chờ thêm 3s và thử lại
        """
        is_gbk = self._is_gbk_site(url)
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context(
                # Windows Chrome UA — mạo danh tốt hơn Mac UA
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                extra_http_headers={
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Referer": origin + "/",
                    "Upgrade-Insecure-Requests": "1",
                },
            )
            page = await context.new_page()

            print(f"[*] Navigating to {url}...")
            try:
                await page.goto(url, wait_until="load", timeout=60000)
                await asyncio.sleep(2)
                html = await page.content()

                # Sanity check: nếu trang chưa có content (security page / captcha)
                # thì chờ thêm và thử lại 1 lần
                from bs4 import BeautifulSoup
                soup_check = BeautifulSoup(html, "html.parser")
                content_check = soup_check.select_one(
                    ".txtnav, #contentbox, .contentbox, #content, .readcontent"
                )
                if not content_check:
                    print(f"[*] Content not found yet, waiting 4s and retrying...")
                    await asyncio.sleep(4)
                    html = await page.content()

                await browser.close()
                return html

            except Exception as e:
                print(f"[!] Error fetching page: {e}")
                await browser.close()
                return None

    # ── Parse ─────────────────────────────────────────────────────────────────

    def parse_content(self, html: str, url: str = "") -> tuple[str, str, str | None, str | None]:
        """
        Parse nội dung chương và link điều hướng từ HTML.

        Trả về: (title, content, prev_url, next_url)
        """
        if not html:
            return None, None, None, None

        soup = BeautifulSoup(html, "html.parser")
        selectors = self._get_selectors(url)

        # ── Title ──
        title_elem = self._select_first(soup, selectors["title"])
        title = title_elem.get_text(strip=True) if title_elem else "Untitled Chapter"

        # ── Content ──
        content_elem = self._select_first(soup, selectors["content"])
        if content_elem:
            for tag in content_elem(["script", "style", "iframe", "ins", "noscript", "div"]):
                # Chỉ xóa div nếu là ad/nav, không xóa div chứa text chính
                if tag.name == "div":
                    cls = " ".join(tag.get("class", []))
                    if any(k in cls for k in ["ad", "nav", "btn", "tool", "share", "tip"]):
                        tag.decompose()
                else:
                    tag.decompose()
            content = content_elem.get_text(separator="\n", strip=True)
            # Lọc các dòng quảng cáo / watermark phổ biến
            content = self._clean_content(content)
        else:
            content = "Could not find chapter content."

        # ── Navigation ──
        prev_link = selectors["prev"](soup)
        next_link = selectors["next"](soup)

        prev_url = self._resolve_url(prev_link.get("href") if prev_link else None, url)
        next_url = self._resolve_url(next_link.get("href") if next_link else None, url)

        return title, content, prev_url, next_url

    def _clean_content(self, text: str) -> str:
        """Lọc các dòng noise phổ biến trong nội dung scrape (ads, watermark...)."""
        noise_patterns = [
            r"(?i)请收藏|请记住|最新章节|手机版|返回书架|加入书架|推荐票|月票|打赏",
            r"(?i)笔趣阁|顶点小说|起点中文|晋江文学|八八读书",
            r"(?i)本章未完.*点击下一页",
            r"(?i)www\.\S+\.com",
        ]
        lines = text.split("\n")
        cleaned = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if any(re.search(p, line) for p in noise_patterns):
                continue
            cleaned.append(line)
        return "\n".join(cleaned)


# ── Quick test ────────────────────────────────────────────────────────────────

async def main():
    scraper = NovelScraper()
    url = "https://www.69shuba.com/txt/43484/28931795"
    print(f"[*] Testing scraper on: {url}")
    html = await scraper.fetch_html(url)
    if html:
        title, content, prev_url, next_url = scraper.parse_content(html, url)
        print(f"\nTitle   : {title}")
        print(f"Prev URL: {prev_url}")
        print(f"Next URL: {next_url}")
        print(f"Content ({len(content)} chars):\n{content[:400]}...")
    else:
        print("Failed to fetch HTML.")


if __name__ == "__main__":
    asyncio.run(main())
