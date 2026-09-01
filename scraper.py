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
GBK_DOMAINS = {"69shuba.com", "69shuba.tw", "69shuba", "69shu.com", "readnovel.com"}


class NovelScraper:
    def __init__(self):
        self.user_agent = USER_AGENT
        self.headless = HEADLESS
        self._playwright = None
        self._browser = None
        self._context = None

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

    # Từ khóa xuất hiện phổ biến trong trang chặn bot / Cloudflare / captcha.
    BLOCK_KEYWORDS = (
        "cloudflare", "verify you are human", "attention required",
        "access denied", "403 forbidden", "sorry, you have been blocked",
        "unusual traffic", "enable javascript and cookies",
    )

    def _detect_block(self, html: str, status_code: int | None, url: str) -> bool:
        """
        Phát hiện trang có THỰC SỰ bị chặn (Cloudflare/anti-bot/captcha) hay không,
        dựa trên tín hiệu thật thay vì set cứng True cho một domain cụ thể.

        Dấu hiệu bị chặn:
        - status code 403/503
        - nội dung chứa các từ khóa chặn phổ biến (Cloudflare, "verify you are human"...)
        - response ngắn bất thường (< 500 ký tự — trang lỗi/captcha thường rất ngắn)

        Ngoại lệ: qidian.com dùng chống bot JS challenge rất phức tạp, không có
        cách phát hiện đáng tin cậy qua HTML nên vẫn ép fallback Jina như cũ.
        """
        html_lower = (html or "").lower()
        is_blocked_status = status_code in (403, 503)
        is_blocked_keyword = any(k in html_lower for k in self.BLOCK_KEYWORDS)
        is_blocked_too_short = len((html or "").strip()) < 500
        is_blocked = is_blocked_status or is_blocked_keyword or is_blocked_too_short
        if "qidian.com" in url:
            is_blocked = True
        return is_blocked

    # ── Fetch ─────────────────────────────────────────────────────────────────

    async def start(self):
        """Khởi tạo Playwright browser và context một lần để dùng chung."""
        if self._playwright is None:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled"]
            )
            # Windows Chrome UA — let Playwright use its default UA to avoid mismatch
            self._context = await self._browser.new_context(
                extra_http_headers={
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Upgrade-Insecure-Requests": "1",
                },
            )

    async def close(self):
        """Đóng Playwright khi hoàn thành."""
        if self._context:
            await self._context.close()
            self._context = None
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

    async def fetch_html(self, url: str) -> str | None:
        """
        Fetch HTML dùng Playwright (tái sử dụng browser context).
        - Dùng Windows Chrome UA (Mac UA bị một số site filter là bot)
        - Luôn include Referer và Accept-Language để trông giống user thật
        - Fallback: nếu content không tìm được, chờ thêm 3s và thử lại
        """
        is_gbk = self._is_gbk_site(url)
        parsed = urlparse(url)
        if not self._context:
            await self.start()

        origin = f"{parsed.scheme}://{parsed.netloc}"
        page = await self._context.new_page()
        # Set referer dynamically per page
        await page.set_extra_http_headers({"Referer": origin + "/"})

        print(f"[*] Navigating to {url}...")
        try:
            nav_response = await page.goto(url, wait_until="load", timeout=60000)
            status_code = nav_response.status if nav_response else None

            if "69shuba" in url:
                print("[*] Detected 69shuba, waiting 10s for Turnstile challenge...")
                await page.wait_for_timeout(10000)
                # If redirected due to Turnstile check, go to the target URL again (cookie is now set)
                if "read" in url and "read" not in page.url:
                    print(f"[*] Redirected to {page.url}. Re-navigating to chapter URL: {url}...")
                    await page.goto(url, wait_until="load", timeout=45000)
                    await page.wait_for_timeout(5000)
            else:
                await asyncio.sleep(2)
                
            html = await page.content()

            # Sanity check: nếu trang chưa có content (security page / captcha)
            from bs4 import BeautifulSoup
            soup_check = BeautifulSoup(html, "html.parser")
            content_check = soup_check.select_one(
                "article, .txtnav, #contentbox, .contentbox, #content, .readcontent, #nr, .nr_nr"
            )
            title_check = soup_check.find("h1")
            
            # Only enforce content_check for chapter pages (which contain '/txt/', 'read', 'chapter', etc.)
            is_chapter_page = any(k in url for k in ["/txt/", "read", "chapter"])

            # Phát hiện chặn dựa trên tín hiệu THẬT, không set cứng theo domain
            # (trước đây "novel543.com" luôn bị set is_blocked=True vô điều kiện,
            # khiến HTML thật fetch được luôn bị bỏ qua để dùng Jina fallback).
            is_blocked = self._detect_block(html, status_code, url)
            if (is_chapter_page and not content_check) or is_blocked:
                print(f"[*] Content not found or blocked (title: {title_check.get_text(strip=True) if title_check else 'None'}), trying Jina Reader fallback...")
                for jina_attempt in range(1, 4):
                    try:
                        import urllib.request
                        jina_url = f"https://r.jina.ai/{url}"
                        req = urllib.request.Request(
                            jina_url, 
                            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
                        )
                        with urllib.request.urlopen(req, timeout=30) as resp:
                            jina_md = resp.read().decode("utf-8")
                            if jina_md and len(jina_md) > 100:
                                lines = jina_md.split("\n")
                                title_val = ""
                                for line in lines:
                                    if line.startswith("Title:"):
                                        title_val = line.replace("Title:", "").strip()
                                        break
                                content_body = jina_md
                                # Jina trả về markdown thô, không có thẻ <a> — nếu trang là
                                # mục lục chương, link dạng "[Chương 1](url)" vẫn tồn tại
                                # trong text. Trích xuất và dựng lại thành <a href> thật để
                                # fetch_novel_metadata (selector a[href*='read'] ...) vẫn
                                # lấy được danh sách chương thay vì luôn trả về 0 chapter.
                                md_link_pattern = re.compile(r'\[([^\]\[]+)\]\((https?://[^\s\)]+)\)')
                                chapter_links_html = "".join(
                                    f'<a href="{href}">{text}</a>'
                                    for text, href in md_link_pattern.findall(content_body)
                                )
                                mock_html = (
                                    f"<html><body><h1>{title_val}</h1>"
                                    f"<div id='content'>{content_body}</div>"
                                    f"<div id='jina-links'>{chapter_links_html}</div>"
                                    f"</body></html>"
                                )
                                await page.close()
                                return mock_html
                    except Exception as je:
                        print(f"[!] Jina Reader fallback attempt {jina_attempt}/3 failed: {je}")
                        if jina_attempt < 3:
                            await asyncio.sleep(2)
                
                if is_blocked:
                    await page.close()
                    return None
                
                print(f"[*] Content not found yet, waiting 4s and retrying...")
                await asyncio.sleep(4)
                html = await page.content()
                
                # Double check content in retried html
                soup_retry = BeautifulSoup(html, "html.parser")
                content_retry = soup_retry.select_one(
                    "article, .txtnav, #contentbox, .contentbox, #content, .readcontent"
                )
                if not content_retry:
                    print(f"[!] Content still not found after retry.")
                    await page.close()
                    return None

            await page.close()
            return html

        except Exception as e:
            print(f"[!] Error fetching page: {e}")
            await page.close()
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

    # ── Novel Metadata Extraction (1-Click Import) ───────────────────────────

    async def fetch_novel_metadata(self, url: str) -> dict | None:
        """
        Trích xuất thông tin metadata và mục lục từ Qidian / 69shuba / novel543 / Fanqie / Faloo.
        
        Trả về dict:
        {
            "title": str,
            "original_title": str,
            "author": str,
            "cover_url": str,
            "genre": str,
            "synopsis": str,
            "chapters": [ {"number": int, "title": str, "url": str}, ... ]
        }
        """
        html = await self.fetch_html(url)
        if not html:
            # Fallback dùng Jina Reader nếu bị rào cản bot
            import urllib.request
            try:
                jina_url = f"https://r.jina.ai/{url}"
                req = urllib.request.Request(
                    jina_url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    html = resp.read().decode("utf-8")
            except Exception as e:
                print(f"[!] Error fetching Jina fallback for metadata: {e}")
                return None

        if not html:
            return None

        soup = BeautifulSoup(html, "html.parser")
        meta = {
            "title": "",
            "original_title": "",
            "author": "",
            "cover_url": "",
            "genre": "Tiên Hiệp, Hệ Thống",
            "synopsis": "",
            "chapters": []
        }

        # 1. Title & Original Title
        title_elem = soup.select_one("h1, .book-name, .book-info h1, .title, meta[property='og:title']")
        if title_elem:
            meta["title"] = title_elem.get("content") if title_elem.name == "meta" else title_elem.get_text(strip=True)
            meta["original_title"] = meta["title"]

        # 2. Author
        author_elem = soup.select_one(".writer, .author, meta[property='og:novel:author'], a[href*='author'], a[href*='tac-gia']")
        if author_elem:
            meta["author"] = author_elem.get("content") if author_elem.name == "meta" else author_elem.get_text(strip=True)

        # 3. Cover URL
        cover_elem = soup.select_one("img[src*='qdbimg'], img[src*='cover'], img[src*='thumb'], meta[property='og:image']")
        if cover_elem:
            src = cover_elem.get("content") if cover_elem.name == "meta" else (cover_elem.get("src") or cover_elem.get("data-src"))
            meta["cover_url"] = self._resolve_url(src, url) or ""

        # 4. Genre
        genre_elem = soup.select_one(".tag, .sort, .category, meta[property='og:novel:category']")
        if genre_elem:
            meta["genre"] = genre_elem.get("content") if genre_elem.name == "meta" else genre_elem.get_text(strip=True)

        # 5. Synopsis
        syn_elem = soup.select_one(".intro, .book-intro, .synopsis, #intro, meta[property='og:description']")
        if syn_elem:
            meta["synopsis"] = syn_elem.get("content") if syn_elem.name == "meta" else syn_elem.get_text(strip=True)

        # 6. Chapters catalog links
        chap_links = soup.select("a[href*='read'], a[href*='.html'], a[href*='/txt/'], .catalog a, .volume a")
        chapters = []
        seen_urls = set()
        ch_idx = 1

        for a in chap_links:
            href = self._resolve_url(a.get("href"), url)
            text = a.get_text(strip=True)
            if not href or href in seen_urls or not text:
                continue

            # Match chapter title pattern (第N章 or Chapter N or Chương N)
            m = re.search(r'第(\d+)章|Chapter\s*(\d+)|Chương\s*(\d+)', text)
            if m:
                ch_num = int(m.group(1) or m.group(2) or m.group(3))
            else:
                ch_num = ch_idx

            seen_urls.add(href)
            chapters.append({
                "number": ch_num,
                "title": text,
                "url": href
            })
            ch_idx += 1

        meta["chapters"] = chapters
        return meta



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
