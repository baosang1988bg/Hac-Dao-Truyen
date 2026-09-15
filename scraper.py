"""
scraper.py
----------
Fetch và parse HTML từ các trang web tiểu thuyết.
Hỗ trợ multi-site thông qua SITE_SELECTORS trong config.py.
Tự động xử lý encoding (UTF-8 / GBK / GB2312) và relative URL.
"""

import asyncio
import json
import re
import time
import urllib.parse
import urllib.request
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from fastapi import HTTPException
from config import USER_AGENT, HEADLESS, SITE_SELECTORS
from security_utils import validate_source_url

# Các site dùng encoding GBK/GB2312 thay vì UTF-8
GBK_DOMAINS = {"69shuba.com", "69shuba.tw", "69shuba", "69shu.com", "readnovel.com"}


# ── Rate limit theo host + backoff/circuit-breaker khi nguồn từ chối ─────────

# Khoảng cách tối thiểu (giây) giữa 2 request liên tiếp TỚI CÙNG MỘT HOST.
# Đây là mặc định lịch sự (polite crawling), không phải giới hạn kỹ thuật để
# vượt qua bất kỳ chặn nào — mục đích là tránh dội request dồn dập vào 1 site.
DEFAULT_MIN_INTERVAL_PER_HOST = 2.0
# Số lần lỗi liên tiếp (403/429/5xx hoặc bị phát hiện chặn) cho phép trước khi
# NGỪNG HẲN việc gọi tới host đó (circuit breaker) thay vì lặp lại vô hạn.
DEFAULT_MAX_CONSECUTIVE_ERRORS = 5
DEFAULT_BACKOFF_BASE = 2.0
DEFAULT_BACKOFF_MAX = 60.0


class ScraperBlockedError(Exception):
    """
    Host đã trả lỗi (403/429/5xx) hoặc bị phát hiện chặn (Cloudflare/captcha)
    liên tiếp quá ngưỡng cho phép. Đây là tín hiệu "dừng hẳn" — không nên
    tiếp tục gọi mạng tới host này nữa cho tới khi có can thiệp thủ công
    (khởi tạo lại scraper / reset rate limiter), tránh vòng lặp gọi vô hạn
    vào một nguồn đang chủ động từ chối truy cập.
    """

    def __init__(self, host: str, consecutive_errors: int, last_status: int | None = None):
        self.host = host
        self.consecutive_errors = consecutive_errors
        self.last_status = last_status
        super().__init__(
            f"Host '{host}' đã lỗi {consecutive_errors} lần liên tiếp "
            f"(status cuối: {last_status}) — dừng crawl host này để tránh "
            f"lặp lại vô hạn vào nguồn đang từ chối truy cập."
        )


class HostRateLimiter:
    """
    Rate limit crawl THEO HOST (dùng `netloc` — host:port — làm khóa, KHÔNG
    phải theo domain đích của 1 truyện), để 2 truyện khác nhau nhưng chung 1
    host (vd. 2 bộ cùng lấy từ 69shuba.com) không thể lách rate limit bằng
    cách coi mỗi truyện là một "luồng" riêng, đồng thời request tới 2 host
    khác nhau không bị chặn chéo (chờ nhau) một cách không cần thiết.

    Đồng thời theo dõi số lỗi liên tiếp (403/429/5xx hoặc bị chặn) theo host:
    - Mỗi lỗi liên tiếp làm tăng khoảng chờ theo cấp số nhân (exponential
      backoff), tới mức trần `backoff_max`.
    - Sau `max_consecutive_errors` lần lỗi liên tiếp, `wait()` raise
      `ScraperBlockedError` ngay lập tức (không sleep, không gọi mạng thêm)
      — dừng hẳn thay vì tiếp tục thử lại vô hạn.
    - 1 lần thành công sẽ reset bộ đếm lỗi liên tiếp của host đó về 0.

    `clock` và `sleeper` có thể được inject (mặc định `time.monotonic` và
    `asyncio.sleep`) để unit test không phải chờ thời gian thực.
    """

    def __init__(
        self,
        min_interval: float = DEFAULT_MIN_INTERVAL_PER_HOST,
        max_consecutive_errors: int = DEFAULT_MAX_CONSECUTIVE_ERRORS,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
        backoff_max: float = DEFAULT_BACKOFF_MAX,
        clock=time.monotonic,
        sleeper=asyncio.sleep,
    ):
        self.min_interval = min_interval
        self.max_consecutive_errors = max_consecutive_errors
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max
        self._clock = clock
        self._sleeper = sleeper
        self._last_request_at: dict[str, float] = {}
        self._consecutive_errors: dict[str, int] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def host_key(url: str) -> str:
        """netloc (host[:port]) chuẩn hoá lowercase — đơn vị rate limit."""
        return (urlparse(url).netloc or "").lower()

    async def wait(self, url: str) -> None:
        """
        Chờ đủ khoảng cách lịch sự kể từ request gần nhất TỚI CÙNG HOST
        (cộng thêm backoff nếu host đang có lỗi liên tiếp), rồi đánh dấu
        thời điểm request hiện tại. Raise `ScraperBlockedError` ngay (không
        sleep) nếu host đã vượt ngưỡng lỗi liên tiếp.
        """
        host = self.host_key(url)
        async with self._lock:
            errors = self._consecutive_errors.get(host, 0)
            if errors >= self.max_consecutive_errors:
                raise ScraperBlockedError(host, errors)

            required_gap = self.min_interval
            if errors > 0:
                backoff = min(self.backoff_base * (2 ** (errors - 1)), self.backoff_max)
                required_gap = max(required_gap, backoff)

            last = self._last_request_at.get(host)
            now = self._clock()
            remaining = (last + required_gap - now) if last is not None else 0.0

        if remaining > 0:
            await self._sleeper(remaining)

        async with self._lock:
            self._last_request_at[host] = self._clock()

    def record_success(self, url: str) -> None:
        """Reset bộ đếm lỗi liên tiếp của host sau 1 lần fetch thành công."""
        self._consecutive_errors[self.host_key(url)] = 0

    def record_error(self, url: str, status_code: int | None = None) -> int:
        """Tăng bộ đếm lỗi liên tiếp của host, trả về số lỗi liên tiếp mới."""
        host = self.host_key(url)
        count = self._consecutive_errors.get(host, 0) + 1
        self._consecutive_errors[host] = count
        return count


# Jina Reader trả về nguyên <title> của trang (thường dạng
# "<Tên truyện>章節列表 - <Tên site>") thay vì tên truyện sạch — mock_html dựng
# từ đây dùng title này làm <h1>, khiến fetch_novel_metadata lấy nhầm cả hậu
# tố site/từ khoá mục lục vào meta["title"]. Dọn 2 lớp noise phổ biến trước
# khi dùng: (1) hậu tố "- <tên site>" cuối chuỗi, (2) từ khoá mục lục/chương
# còn sót lại ngay trước đó.
_JINA_TITLE_SITE_SUFFIX_RE = re.compile(r"\s*[-–—|｜]\s*[^-–—|｜]{1,24}$")
_JINA_TITLE_CATALOG_KEYWORDS_RE = re.compile(
    r"(章節列表|章节列表|章節目錄|章节目录|最新章節|最新章节|全文閱讀|全文阅读)+$"
)


def _clean_jina_title(raw_title: str) -> str:
    """Dọn noise (hậu tố site, từ khoá mục lục) khỏi <title> thô do Jina Reader trả về."""
    title = raw_title.strip()
    if not title:
        return title
    without_suffix = _JINA_TITLE_SITE_SUFFIX_RE.sub("", title).strip()
    # Chỉ chấp nhận bỏ hậu tố nếu phần còn lại vẫn có nội dung đáng kể —
    # tránh xoá sạch tiêu đề ngắn thật sự chứa dấu "-" (vd "A - B" 2 từ ngắn).
    if without_suffix:
        title = without_suffix
    return _JINA_TITLE_CATALOG_KEYWORDS_RE.sub("", title).strip()


class NovelScraper:
    def __init__(self, rate_limiter: "HostRateLimiter | None" = None):
        self.user_agent = USER_AGENT
        self.headless = HEADLESS
        self._playwright = None
        self._browser = None
        self._context = None
        # Rate limit theo host + backoff/circuit-breaker khi nguồn từ chối
        # (403/429/5xx hoặc bị phát hiện chặn liên tiếp). Cho phép truyền vào
        # từ ngoài (vd. chia sẻ 1 limiter giữa nhiều NovelScraper trong cùng
        # 1 phiên pipeline) — mặc định tạo mới riêng cho mỗi instance.
        self._rate_limiter = rate_limiter or HostRateLimiter()

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

    async def _request_json(self, url: str, data: dict | None = None) -> dict:
        """GET/POST JSON qua cùng SSRF check và HostRateLimiter của scraper."""
        if not await self._is_url_safe(url):
            raise ValueError(f"URL catalog không an toàn: {url}")
        await self._rate_limiter.wait(url)

        def request():
            body = urllib.parse.urlencode(data).encode("utf-8") if data is not None else None
            headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
            if body is not None:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))

        try:
            result = await asyncio.to_thread(request)
            self._rate_limiter.record_success(url)
            return result
        except Exception:
            self._rate_limiter.record_error(url)
            raise

    @staticmethod
    def _parse_qidian_catalog(data: dict, book_id: str) -> dict:
        """Parse catalog Qidian; đếm tất cả chương nhưng chỉ trả URL chương miễn phí."""
        chapters = []
        reported_count = 0
        for volume in data.get("data", {}).get("vs", []):
            volume_is_vip = any(volume.get(key) == 1 for key in ("vVip", "isVip", "vipStatus"))
            for chapter in volume.get("cs", []):
                reported_count += 1
                chapter_is_vip = volume_is_vip or any(
                    chapter.get(key) in (1, True)
                    for key in ("vipStatus", "isVip", "vip")
                )
                title = chapter.get("cName")
                uuid = chapter.get("uuid")
                if chapter_is_vip or not title or not uuid:
                    continue
                chapters.append({
                    "number": len(chapters) + 1,
                    "title": title,
                    "url": f"https://www.qidian.com/chapter/{book_id}/{uuid}/",
                })
        return {"chapters": chapters, "reported_chapter_count": reported_count}

    async def fetch_novel_catalog(self, url: str) -> dict | None:
        """Lấy catalog qua API chuyên biệt đã được kiểm chứng trong AgentReach."""
        parsed = urlparse(url)
        host = parsed.netloc.lower()

        try:
            if "qidian.com" in host:
                match = re.search(r"/book/(\d+)", parsed.path)
                if not match:
                    return None
                book_id = match.group(1)
                data = await self._request_json(
                    f"https://m.qidian.com/majax/book/category?bookId={book_id}"
                )
                if data.get("code") != 0:
                    return None
                return self._parse_qidian_catalog(data, book_id)

            if "ixdzs8.com" in host or "ixdzs.com" in host or "ixdzs.tw" in host:
                match = re.search(r"/(?:read|book)/(\d+)", parsed.path)
                if not match:
                    return None
                book_id = match.group(1)
                data = await self._request_json(
                    "https://ixdzs8.com/novel/clist/", {"bid": book_id}
                )
                if data.get("rs") != 200:
                    return None
                chapters = []
                for item in data.get("data", []):
                    if item.get("ctype") == 1:
                        continue
                    title, ordernum = item.get("title"), item.get("ordernum")
                    if not title or ordernum is None:
                        continue
                    chapters.append({
                        "number": int(ordernum),
                        "title": title,
                        "url": f"https://ixdzs8.com/read/{book_id}/p{ordernum}.html",
                    })
                chapters.sort(key=lambda chapter: chapter["number"])
                return {
                    "chapters": chapters,
                    "reported_chapter_count": len(chapters),
                }

            if "truyendich.ai" in host:
                parts = [part for part in parsed.path.split("/") if part]
                if len(parts) < 2 or parts[0] != "doc-truyen":
                    return None
                slug = parts[1]
                chapters = []
                page, size, total = 1, 100, 0
                while True:
                    data = await self._request_json(
                        f"https://truyendich.ai/api/novels/{slug}/chapters?page={page}&size={size}"
                    )
                    total = int(data.get("total") or total)
                    items = data.get("items") or []
                    for item in items:
                        number = item.get("chapter_number")
                        title = item.get("title")
                        if number is None or not title:
                            continue
                        chapters.append({
                            "number": int(number),
                            "title": title.strip(),
                            "url": f"https://truyendich.ai/doc-truyen/{slug}/chuong-{number}",
                        })
                    if not items or len(chapters) >= total or len(items) < size:
                        break
                    page += 1
                chapters.sort(key=lambda chapter: chapter["number"])
                return {
                    "chapters": chapters,
                    "reported_chapter_count": total or len(chapters),
                }
        except Exception as e:
            print(f"[!] Không thể lấy catalog chuyên biệt cho {url}: {e}")
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

    # ── Chống SSRF (Playwright điều hướng/redirect/subresource) ──────────────

    @staticmethod
    async def _is_url_safe(url: str) -> bool:
        """
        Kiểm tra 1 URL (điều hướng ban đầu HOẶC bất kỳ redirect/subresource
        nào phát sinh trong lúc Playwright tải trang) có an toàn để tải hay
        không, dùng chung `security_utils.validate_source_url` (chặn scheme
        lạ, credentials trong URL, IP nội bộ literal, và resolve DNS để chặn
        domain công khai trỏ về IP nội bộ — DNS rebinding).

        Trả về bool thay vì raise để router/caller có thể abort request một
        cách êm ái thay vì làm crash toàn bộ phiên fetch.

        DNS resolve là blocking I/O — chạy trong thread riêng (`asyncio.to_thread`)
        để không chặn event loop khi Playwright đang xử lý nhiều request song song.
        """
        try:
            await asyncio.to_thread(validate_source_url, url)
            return True
        except HTTPException as exc:
            print(f"[SSRF] Chặn URL nghi ngờ nội bộ: {url} ({exc.detail})")
            return False
        except Exception as exc:  # noqa: BLE001 — không để lỗi kiểm tra làm crash scraper
            print(f"[SSRF] Lỗi khi kiểm tra an toàn URL {url}: {exc}")
            return False

    async def _install_ssrf_guard(self, page) -> None:
        """
        Chặn SSRF ở TẦNG MẠNG của trang: mọi request Playwright thực hiện
        trên `page` (điều hướng ban đầu, mọi redirect 3xx tiếp theo, và mọi
        subresource — ảnh/script/xhr/fetch...) đều bị intercept và kiểm tra
        lại bằng `_is_url_safe` trước khi được phép tiếp tục.

        Quan trọng: Playwright coi mỗi hop redirect là 1 request riêng đi
        qua route handler này, nên đây là chỗ chặn redirect tới nội bộ —
        không chỉ kiểm tra URL đầu vào của `page.goto`.
        """
        async def _guard(route):
            request = route.request
            if await self._is_url_safe(request.url):
                await route.continue_()
            else:
                await route.abort()

        await page.route("**/*", _guard)

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

        # Chặn SSRF trước khi mở page: scheme lạ / credentials trong URL /
        # IP literal nội bộ / domain resolve về IP nội bộ (DNS rebinding).
        if not await self._is_url_safe(url):
            return None

        # Rate limit theo host (không phải theo domain đích 1 truyện — 2
        # truyện cùng lấy từ 1 host vẫn dùng chung ngân sách request của host
        # đó) + circuit breaker: nếu host đã lỗi liên tiếp quá ngưỡng, dừng
        # hẳn (không gọi mạng) thay vì tiếp tục thử lại vô hạn.
        try:
            await self._rate_limiter.wait(url)
        except ScraperBlockedError as exc:
            print(f"[!] {exc}")
            return None

        origin = f"{parsed.scheme}://{parsed.netloc}"
        page = await self._context.new_page()
        # Chặn thêm ở tầng network: mọi redirect/subresource phát sinh trong
        # lúc tải trang cũng được kiểm tra lại, không chỉ URL đầu vào.
        await self._install_ssrf_guard(page)
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
            is_error_status = status_code in (403, 429) or (status_code is not None and status_code >= 500)
            if (is_chapter_page and not content_check) or is_blocked or is_error_status:
                # Đếm là 1 lỗi liên tiếp của host (403/429/5xx hoặc bị phát
                # hiện chặn) TRƯỚC khi thử Jina fallback — kể cả khi Jina lấy
                # được nội dung thay thế, việc host này từ chối truy cập trực
                # tiếp vẫn cần được backoff cho các lần fetch trực tiếp sau.
                self._rate_limiter.record_error(url, status_code)
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
                                        title_val = _clean_jina_title(line.replace("Title:", "").strip())
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

            # Tới được đây nghĩa là fetch trực tiếp thành công (không bị chặn,
            # không lỗi status) — reset bộ đếm lỗi liên tiếp của host.
            self._rate_limiter.record_success(url)
            await page.close()
            return html

        except Exception as e:
            print(f"[!] Error fetching page: {e}")
            self._rate_limiter.record_error(url)
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
            "chapters": [],
            "reported_chapter_count": 0,
            "scraped_chapter_count": 0,
        }

        # Tổng chương được trang nguồn công bố có thể lớn hơn số link hiện diện
        # trong HTML (đặc biệt Qidian qua Jina chỉ lộ vài chương gần nhất).
        page_text = soup.get_text(" ", strip=True)
        reported_counts = [
            int(value)
            for value in re.findall(r"(?<!\d)(\d{1,6})\s*章", page_text)
        ]

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
        chap_links = soup.select(
            "a[href*='read'], a[href*='.html'], a[href*='/txt/'], "
            "a[href*='/chapter/'], .catalog a, .volume a"
        )
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
        meta["scraped_chapter_count"] = len(chapters)
        meta["reported_chapter_count"] = max(
            reported_counts + [len(chapters)],
            default=len(chapters),
        )

        specialized = await self.fetch_novel_catalog(url)
        if specialized:
            specialized_chapters = specialized.get("chapters") or []
            if len(specialized_chapters) > len(meta["chapters"]):
                meta["chapters"] = specialized_chapters
                meta["scraped_chapter_count"] = len(specialized_chapters)
            meta["reported_chapter_count"] = max(
                meta["reported_chapter_count"],
                int(specialized.get("reported_chapter_count") or 0),
            )
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
