"""
source_finder.py
-----------------
Tìm URL trang truyện thật trên Qidian / novel543 / 69shuba từ tên truyện.

Không đoán URL (khác discover.py cũ) — search DuckDuckGo Lite thật, rồi
verify từng candidate bằng cách scrape thật (source_finder.probe_candidate
dùng NovelScraper.fetch_novel_metadata đã có sẵn trong scraper.py).
"""

import json
import re
import urllib.parse
import urllib.request
from collections.abc import Callable

from scraper import NovelScraper

SOURCE_DOMAINS = {
    "qidian.com": "qidian",
    "novel543.com": "novel543",
    "69shuba.com": "69shuba",
    "69shuba.tw": "69shuba",
    "69shu.com": "69shuba",
}

_SOURCE_PRIORITY = {"69shuba": 0, "novel543": 1, "qidian": 2}

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_CHINESE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


def _generate_chinese_query_text(prompt: str) -> str:
    """Gọi Gemini qua hạ tầng key/model rotation sẵn có của NovelTranslator."""
    from translator import NovelTranslator

    translator = NovelTranslator()
    if translator._gemini is None:
        raise RuntimeError("Gemini không khả dụng để đề xuất tên tiếng Trung")
    return translator._call_gemini(prompt, max_retries=2)


def suggest_chinese_queries(
    query: str,
    author: str = "",
    generator: Callable[[str], str] | None = None,
) -> list[str]:
    """
    Đề xuất tối đa 3 query tiếng Trung để search.

    Gemini chỉ sinh cụm từ tìm kiếm, không sinh URL. Lỗi API hoặc output sai
    định dạng trả về [] để find_source() fallback sang query gốc.
    """
    original = " ".join(part for part in (query.strip(), author.strip()) if part)
    if _CHINESE_RE.search(original):
        return [original]

    prompt = f"""Bạn hỗ trợ tìm tiểu thuyết mạng Trung Quốc từ thông tin tiếng Việt.
Hãy suy luận tối đa 3 cụm từ tìm kiếm tiếng Trung có khả năng cao nhất.
Tên truyện: {query.strip()}
Tác giả: {author.strip() or '(không có)'}

Chỉ trả về một JSON array gồm các chuỗi query. Không trả URL, markdown hay giải thích.
Mỗi query nên chứa tên truyện tiếng Trung và thêm tên tác giả tiếng Trung nếu suy luận được.
"""
    try:
        raw = (generator or _generate_chinese_query_text)(prompt).strip()
        start, end = raw.find("["), raw.rfind("]")
        if start < 0 or end < start:
            return []
        parsed = json.loads(raw[start:end + 1])
    except Exception as e:
        print(f"[!] suggest_chinese_queries: không thể tạo query tiếng Trung: {e}")
        return []

    queries = []
    for item in parsed if isinstance(parsed, list) else []:
        candidate = " ".join(str(item).split())
        if candidate and _CHINESE_RE.search(candidate) and candidate not in queries:
            queries.append(candidate)
        if len(queries) == 3:
            break
    return queries


def detect_source(url: str) -> str | None:
    """Trả về tên nguồn ('qidian'/'novel543'/'69shuba') hoặc None nếu domain lạ."""
    netloc = urllib.parse.urlparse(url).netloc.lower()
    for domain, source in SOURCE_DOMAINS.items():
        if netloc == domain or netloc.endswith("." + domain):
            return source
    return None


def _extract_book_id(source: str, url: str) -> str | None:
    """Trích book_id để khử trùng lặp — mỗi site 1 định dạng path khác nhau."""
    path = urllib.parse.urlparse(url).path
    if source in ("qidian", "69shuba"):
        m = re.search(r"/book/(\d+)", path) or re.search(r"/txt/(\d+)", path)
        return m.group(1) if m else None
    if source == "novel543":
        parts = [p for p in path.split("/") if p]
        return parts[0] if parts and parts[0].isdigit() else None
    return None


def _extract_duckduckgo_links(html: str) -> list[str]:
    """Giải mã link thật ('uddg=') từ trang kết quả DuckDuckGo Lite/HTML."""
    links = []
    for href in re.findall(r'href="([^"]+)"', html):
        if "uddg=" not in href:
            continue
        parsed = urllib.parse.urlparse(href if href.startswith("http") else "https:" + href)
        qs = urllib.parse.parse_qs(parsed.query)
        if "uddg" in qs:
            links.append(qs["uddg"][0])
    return links


def search_candidates(query: str, max_results: int = 15) -> list[dict]:
    """
    Search DuckDuckGo Lite cho `query`, trả về candidate thuộc
    Qidian/novel543/69shuba, đã khử trùng lặp theo book_id, sắp theo độ ưu
    tiên nguồn (69shuba > novel543 > qidian).

    Không raise khi lỗi mạng — trả về [] để find_source() fallback êm.
    """
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"[!] search_candidates: lỗi search DuckDuckGo: {e}")
        return []

    seen_keys = set()
    candidates = []
    for link in _extract_duckduckgo_links(html):
        source = detect_source(link)
        if not source:
            continue
        book_id = _extract_book_id(source, link)
        if not book_id:
            continue
        key = f"{source}:{book_id}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        candidates.append({"source": source, "book_id": book_id, "url": link})

    candidates.sort(key=lambda c: _SOURCE_PRIORITY.get(c["source"], 99))
    return candidates[:max_results]


async def probe_candidate(scraper: "NovelScraper", candidate: dict) -> dict:
    """
    Verify 1 candidate bằng cách scrape thật metadata + mục lục.
    Không bao giờ raise — lỗi bất kỳ (network/Playwright) → valid=False.
    """
    try:
        meta = await scraper.fetch_novel_metadata(candidate["url"])
    except Exception as e:
        print(f"[!] probe_candidate: lỗi probe {candidate['url']}: {e}")
        meta = None

    chapters = (meta or {}).get("chapters") or []
    return {
        **candidate,
        "valid": bool(meta) and len(chapters) > 0,
        "chapter_count": len(chapters),
        "title": (meta or {}).get("title", ""),
        "author": (meta or {}).get("author", ""),
    }


async def find_source(query: str, max_results: int = 15, author: str = "") -> dict | None:
    """
    Tìm + verify nguồn thật cho `query`. Trả None nếu không có candidate nào
    (search rỗng) — phân biệt với {"best": None, "all": [...]} khi có
    candidate nhưng không cái nào scrape được.
    """
    original_query = " ".join(part for part in (query.strip(), author.strip()) if part)
    search_queries = suggest_chinese_queries(query, author)
    if original_query and original_query not in search_queries:
        search_queries.append(original_query)

    candidates = []
    seen_keys = set()
    for search_query in search_queries:
        print(f"[*] Đang tìm với query: {search_query}")
        for candidate in search_candidates(search_query, max_results):
            key = (candidate["source"], candidate["book_id"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            candidates.append(candidate)
            if len(candidates) == max_results:
                break
        if len(candidates) == max_results:
            break

    if not candidates:
        return None

    scraper = NovelScraper()
    await scraper.start()
    probed = []
    try:
        for candidate in candidates:
            probed.append(await probe_candidate(scraper, candidate))
    finally:
        await scraper.close()

    valid = [c for c in probed if c["valid"]]
    valid.sort(key=lambda c: c["chapter_count"], reverse=True)

    return {"best": valid[0] if valid else None, "all": probed}
