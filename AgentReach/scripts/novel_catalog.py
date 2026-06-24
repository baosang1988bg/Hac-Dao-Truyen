#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Helper script to fetch and update web novel catalogs (Qidian, 69shuba, ixdzs8, novel543, truyendich.ai)."""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def request_get(url, headers=None, use_jina=False):
    """Perform a HTTP GET request, optionally routing through Jina Reader, with Gzip support."""
    if use_jina:
        url = f"https://r.jina.ai/{url}"
    
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }
    if headers:
        req_headers.update(headers)
        
    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        content_bytes = response.read()
        if response.info().get('Content-Encoding') == 'gzip':
            import gzip
            return gzip.decompress(content_bytes)
        return content_bytes


def request_post(url, data_dict, headers=None):
    """Perform a HTTP POST request with form data, with Gzip support."""
    req_headers = {
        "User-Agent": _UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept-Encoding": "gzip"
    }
    if headers:
        req_headers.update(headers)
        
    data = urllib.parse.urlencode(data_dict).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as response:
        content_bytes = response.read()
        if response.info().get('Content-Encoding') == 'gzip':
            import gzip
            return gzip.decompress(content_bytes)
        return content_bytes


def detect_source(url):
    """Detect source platform from URL."""
    netloc = urllib.parse.urlparse(url).netloc.lower()
    if "qidian.com" in netloc:
        return "qidian"
    elif "ixdzs8.com" in netloc or "ixdzs.tw" in netloc:
        return "ixdzs"
    elif "novel543.com" in netloc:
        return "novel543"
    elif "truyendich.ai" in netloc:
        return "truyendich"
    elif any(domain in netloc for domain in ["69shu", "69shuba"]):
        return "69shuba"
    else:
        return None


def fetch_ixdzs_catalog(url):
    """Fetch catalog from ixdzs8.com (all chapters are free on this site)."""
    match = re.search(r'/(?:read|book)/(\d+)', url)
    if not match:
        raise ValueError(f"Could not extract book ID from ixdzs URL: {url}")
    
    bid = match.group(1)
    api_url = "https://ixdzs8.com/novel/clist/"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching ixdzs catalog for ID {bid}...")
    
    resp_bytes = request_post(api_url, {"bid": bid})
    resp_json = json.loads(resp_bytes.decode("utf-8"))
    
    if resp_json.get("rs") != 200:
        raise RuntimeError(f"ixdzs API returned error status: {resp_json.get('rs')}")
        
    chapters = []
    for item in resp_json.get("data", []):
        if item.get("ctype") == 1:
            continue
        title = item.get("title")
        ordernum = item.get("ordernum")
        chapter_url = f"https://ixdzs8.com/read/{bid}/p{ordernum}.html"
        chapters.append({
            "title": title,
            "url": chapter_url,
            "ordernum": int(ordernum)
        })
    return chapters, "ixdzs"


def fetch_qidian_catalog_via_jina(book_id):
    """Fallback method using Jina Reader, filtering out VIP chapters."""
    toc_url = f"https://www.qidian.com/book/{book_id}/"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching Qidian catalog for ID {book_id} via Jina Reader...")
    
    resp_bytes = request_get(toc_url, use_jina=True)
    content = resp_bytes.decode("utf-8")
    
    chapters = []
    ordernum = 1
    current_volume_is_vip = False
    
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("###"):
            if any(k in line for k in ["VIP", "Vip", "vip"]):
                current_volume_is_vip = True
            elif any(k in line for k in ["免费", "免费章节"]):
                current_volume_is_vip = False
                
        match = re.search(r'\[([^\]]+)\]\((https?://[^/]*qidian\.com/chapter/' + book_id + r'/(\d+)/?[^)]*)\)', line)
        if match:
            title = match.group(1).strip()
            ch_url = match.group(2).split()[0].rstrip('"').rstrip("'")
            
            is_vip = "__" in line or "VIP" in line or "Vip" in line or current_volume_is_vip
            
            if any(k in title for k in ["最新章节", "免费试读", "立即阅读"]):
                continue
                
            if not is_vip:
                chapters.append({
                    "title": title,
                    "url": ch_url,
                    "ordernum": ordernum
                })
                ordernum += 1
                
    return chapters


def fetch_qidian_catalog(url):
    """Fetch catalog from qidian.com, filtering out VIP chapters."""
    match = re.search(r'/book/(\d+)', url)
    if not match:
        raise ValueError(f"Could not extract book ID from Qidian URL: {url}")
        
    book_id = match.group(1)
    
    try:
        api_url = f"https://m.qidian.com/majax/book/category?bookId={book_id}"
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Trying Qidian AJAX API for ID {book_id}...")
        resp_bytes = request_get(api_url)
        resp_json = json.loads(resp_bytes.decode("utf-8"))
        
        if resp_json.get("code") != 0:
            raise RuntimeError(f"Qidian API returned error code: {resp_json.get('code')}")
            
        chapters = []
        ordernum = 1
        volumes = resp_json.get("data", {}).get("vs", [])
        for vol in volumes:
            volume_is_vip = vol.get("vVip") == 1 or vol.get("isVip") == 1 or vol.get("vipStatus") == 1
            for ch in vol.get("cs", []):
                chapter_is_vip = (
                    ch.get("vipStatus") == 1 
                    or ch.get("isVip") == 1 
                    or ch.get("vip") == 1 
                    or ch.get("isVip") is True 
                    or volume_is_vip
                )
                
                if chapter_is_vip:
                    continue
                    
                title = ch.get("cName")
                uuid = ch.get("uuid")
                chapter_url = f"https://www.qidian.com/chapter/{book_id}/{uuid}/"
                chapters.append({
                    "title": title,
                    "url": chapter_url,
                    "ordernum": ordernum
                })
                ordernum += 1
        return chapters, "qidian"
        
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Qidian AJAX API failed ({e}). Falling back to Jina Reader...")
        try:
            chapters = fetch_qidian_catalog_via_jina(book_id)
            if not chapters:
                raise RuntimeError("No chapters parsed from Jina Reader markdown content.")
            return chapters, "qidian"
        except Exception as fallback_err:
            raise RuntimeError(f"Both Qidian API and Jina Reader fallback failed. Fallback error: {fallback_err}")


def fetch_69shuba_catalog(url):
    """Fetch catalog from 69shuba, trying direct fetch first, falling back to Jina Reader."""
    match = re.search(r'/book/(\d+)', url)
    if not match:
        raise ValueError(f"Could not extract book ID from 69shuba URL: {url}")
        
    book_id = match.group(1)
    parsed = urllib.parse.urlparse(url)
    netloc = parsed.netloc or "69shuba.com"
    toc_url = f"https://{netloc}/book/{book_id}/"
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching 69shuba catalog for ID {book_id} on {netloc}...")
    
    content = ""
    try:
        # Try direct fetch first
        resp_bytes = request_get(toc_url)
        try:
            content = resp_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content = resp_bytes.decode("gb18030", errors="ignore")
        if "69shu" not in content.lower():
            raise RuntimeError("Direct fetch returned invalid content.")
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Direct fetch successful.")
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Direct fetch failed ({e}). Trying via Jina Reader...")
        try:
            resp_bytes = request_get(toc_url, use_jina=True)
            content = resp_bytes.decode("utf-8")
        except Exception as fallback_err:
            raise RuntimeError(f"Both direct fetch and Jina fallback failed. Fallback error: {fallback_err}")
            
    chapters = []
    ordernum = 1
    
    # 1. Try Jina Markdown parsing
    markdown_matches = re.findall(r'\[([^\]]+)\]\((https?://[^/]*69shu[^/]+/txt/\d+/\d+)\)', content)
    if not markdown_matches:
        markdown_matches = re.findall(r'\[([^\]]+)\]\((https?://[^\)]+/txt/' + book_id + r'/\d+)\)', content)
        
    if markdown_matches:
        for title, ch_url in markdown_matches:
            chapters.append({
                "title": title.strip(),
                "url": ch_url,
                "ordernum": ordernum
            })
            ordernum += 1
            
    # 2. Try raw HTML parsing
    if not chapters:
        # Extract title and href from <a> tags
        html_matches = re.findall(r'href="([^"]+/txt/' + book_id + r'/\d+)"[^>]*>([^<]+)</a>', content)
        if not html_matches:
            # Try loose pattern
            html_matches = re.findall(r'href="([^"]+/txt/\d+/\d+)"[^>]*>([^<]+)</a>', content)
            
        for ch_url, title in html_matches:
            # Normalize relative URLs if needed
            if ch_url.startswith("/"):
                ch_url = f"https://{netloc}{ch_url}"
            chapters.append({
                "title": title.strip(),
                "url": ch_url,
                "ordernum": ordernum
            })
            ordernum += 1
            
    if not chapters:
        raise RuntimeError("No chapters found. The page layout may have changed, or both HTML and Markdown parsing failed.")
        
    return chapters, "69shuba"


def fetch_novel543_catalog(url):
    """Fetch catalog from novel543.com via Jina Reader (all chapters are free on this site)."""
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.rstrip('/')
    
    match = re.search(r'/(\d+)', path)
    if not match:
        raise ValueError(f"Could not extract book ID from novel543 URL: {url}")
        
    book_id = match.group(1)
    toc_url = f"https://www.novel543.com/{book_id}/dir"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching novel543 catalog for ID {book_id} via Jina Reader...")
    
    resp_bytes = request_get(toc_url, use_jina=True)
    content = resp_bytes.decode("utf-8")
    
    # Example link format in Markdown: [第1章 ...](https://www.novel543.com/0808693583/8096_1.html)
    pattern = r'\[([^\]]+)\]\((https?://[^/]*novel543\.com/' + book_id + r'/(\d+)_(\d+)\.html)\)'
    matches = re.findall(pattern, content)
    
    parsed_chapters = []
    for title, ch_url, sub_id, ch_num in matches:
        try:
            num_val = int(ch_num)
        except ValueError:
            num_val = 999999
        parsed_chapters.append({
            "title": title.strip(),
            "url": ch_url,
            "ch_num": num_val
        })
        
    if not parsed_chapters:
        raise RuntimeError("No chapters found. The page layout may have changed, or Jina Reader was blocked.")
        
    # Sort chapters by their parsed chapter number from URL
    parsed_chapters.sort(key=lambda x: x["ch_num"])
    
    chapters = []
    ordernum = 1
    for item in parsed_chapters:
        chapters.append({
            "title": item["title"],
            "url": item["url"],
            "ordernum": ordernum
        })
        ordernum += 1
        
    return chapters, "novel543"


def fetch_truyendich_catalog(url):
    """Fetch catalog from truyendich.ai (all chapters are free, query via API)."""
    parsed = urllib.parse.urlparse(url)
    path_parts = [p for p in parsed.path.split('/') if p]
    if not path_parts or len(path_parts) < 2 or path_parts[0] != "doc-truyen":
        raise ValueError(f"Could not extract novel slug from truyendich URL: {url}")
    
    novel_slug = path_parts[1]
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching truyendich.ai catalog for slug '{novel_slug}'...")
    
    # Query page 1 first to find the total chapters
    api_url = f"https://truyendich.ai/api/novels/{novel_slug}/chapters?page=1&size=100"
    resp_bytes = request_get(api_url)
    data = json.loads(resp_bytes.decode("utf-8"))
    
    total = data.get("total", 0)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Found total of {total} chapters.")
    
    chapters = []
    page = 1
    size = 100
    while True:
        if page > 1:
            page_url = f"https://truyendich.ai/api/novels/{novel_slug}/chapters?page={page}&size={size}"
            resp_bytes = request_get(page_url)
            data = json.loads(resp_bytes.decode("utf-8"))
            
        items = data.get("items", [])
        if not items:
            break
            
        for item in items:
            ch_num = item.get("chapter_number")
            title = item.get("title")
            ch_url = f"https://truyendich.ai/doc-truyen/{novel_slug}/chuong-{ch_num}"
            chapters.append({
                "title": title.strip(),
                "url": ch_url,
                "ordernum": int(ch_num)
            })
            
        if len(chapters) >= total or len(items) < size:
            break
        page += 1
        
    chapters.sort(key=lambda x: x["ordernum"])
    return chapters, "truyendich"


def search_duckduckgo(novel_name):
    """Search DuckDuckGo Lite for candidate URLs from supported domains."""
    query = novel_name.replace(":", " ").replace("-", " ").replace("章節列表", "").replace("章节列表", "").strip()
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Searching DuckDuckGo for '{query}'...")
    try:
        resp_bytes = request_get(url)
        html = resp_bytes.decode("utf-8")
        
        matches = re.findall(r'href="([^"]+)"', html)
        links = []
        for m in matches:
            if "uddg=" in m:
                parsed = urllib.parse.urlparse(m)
                qs = urllib.parse.parse_qs(parsed.query)
                if "uddg" in qs:
                    links.append(qs["uddg"][0])
            elif m.startswith("http"):
                links.append(m)
                
        # Filter and normalize links
        candidates = []
        seen_novels = set()
        
        for l in links:
            source = detect_source(l)
            if not source:
                continue
                
            novel_key = None
            normalized_url = l
            
            if source == "truyendich":
                parts = [p for p in urllib.parse.urlparse(l).path.split('/') if p]
                if len(parts) >= 2 and parts[0] == "doc-truyen":
                    slug = parts[1]
                    novel_key = f"truyendich:{slug}"
                    normalized_url = f"https://truyendich.ai/doc-truyen/{slug}"
            elif source == "ixdzs":
                match = re.search(r'/(?:read|book)/(\d+)', l)
                if match:
                    bid = match.group(1)
                    novel_key = f"ixdzs:{bid}"
                    normalized_url = f"https://ixdzs8.com/read/{bid}/"
            elif source == "qidian":
                match = re.search(r'/book/(\d+)', l)
                if match:
                    bid = match.group(1)
                    novel_key = f"qidian:{bid}"
                    normalized_url = f"https://www.qidian.com/book/{bid}/"
            elif source == "69shuba":
                match = re.search(r'/book/(\d+)', l)
                if match:
                    bid = match.group(1)
                    novel_key = f"69shuba:{bid}"
                    normalized_url = f"https://69shuba.tw/book/{bid}/"
            elif source == "novel543":
                parts = [p for p in urllib.parse.urlparse(l).path.split('/') if p]
                if parts:
                    bid = parts[0]
                    if bid.isdigit():
                        novel_key = f"novel543:{bid}"
                        normalized_url = f"https://www.novel543.com/{bid}/"
                        
            if novel_key and novel_key not in seen_novels:
                seen_novels.add(novel_key)
                candidates.append({
                    "source": source,
                    "url": normalized_url,
                    "key": novel_key
                })
                
        return candidates
    except Exception as e:
        print(f"Error during search: {e}")
        return []


def probe_chapter_count(source, url):
    """Probe a book URL to get its title/ID and total chapter count."""
    try:
        if source == "truyendich":
            parts = [p for p in urllib.parse.urlparse(url).path.split('/') if p]
            if len(parts) >= 2 and parts[0] == "doc-truyen":
                slug = parts[1]
                api_url = f"https://truyendich.ai/api/novels/{slug}/chapters?page=1&size=1"
                resp_bytes = request_get(api_url)
                data = json.loads(resp_bytes.decode("utf-8"))
                return data.get("total", 0), slug
        elif source == "ixdzs":
            match = re.search(r'/(?:read|book)/(\d+)', url)
            if match:
                bid = match.group(1)
                api_url = "https://ixdzs8.com/novel/clist/"
                resp_bytes = request_post(api_url, {"bid": bid})
                data = json.loads(resp_bytes.decode("utf-8"))
                if data.get("rs") == 200:
                    items = [item for item in data.get("data", []) if item.get("ctype") != 1]
                    return len(items), f"ixdzs-{bid}"
        elif source == "novel543":
            parts = [p for p in urllib.parse.urlparse(url).path.split('/') if p]
            if parts:
                bid = parts[0]
                toc_url = f"https://www.novel543.com/{bid}/dir"
                resp_bytes = request_get(toc_url, use_jina=True)
                content = resp_bytes.decode("utf-8")
                pattern = r'\[([^\]]+)\]\((https?://[^/]*novel543\.com/' + bid + r'/(\d+)_(\d+)\.html)\)'
                matches = re.findall(pattern, content)
                return len(matches), f"novel543-{bid}"
        elif source == "69shuba":
            match = re.search(r'/book/(\d+)', url)
            if match:
                bid = match.group(1)
                toc_url = f"https://69shuba.tw/book/{bid}/"
                resp_bytes = request_get(toc_url, use_jina=True)
                content = resp_bytes.decode("utf-8")
                pattern = r'\[([^\]]+)\]\((https?://[^/]*69shu[^/]+/txt/\d+/\d+)\)'
                matches = re.findall(pattern, content)
                if not matches:
                    pattern = r'\[([^\]]+)\]\((https?://[^\)]+/txt/' + bid + r'/\d+)\)'
                    matches = re.findall(pattern, content)
                return len(matches), f"69shuba-{bid}"
        elif source == "qidian":
            match = re.search(r'/book/(\d+)', url)
            if match:
                bid = match.group(1)
                api_url = f"https://m.qidian.com/majax/book/category?bookId={bid}"
                try:
                    resp_bytes = request_get(api_url)
                    data = json.loads(resp_bytes.decode("utf-8"))
                    if data.get("code") == 0:
                        count = 0
                        volumes = data.get("data", {}).get("vs", [])
                        for vol in volumes:
                            volume_is_vip = vol.get("vVip") == 1 or vol.get("isVip") == 1 or vol.get("vipStatus") == 1
                            for ch in vol.get("cs", []):
                                chapter_is_vip = ch.get("vipStatus") == 1 or ch.get("isVip") == 1 or ch.get("vip") == 1 or ch.get("isVip") is True or volume_is_vip
                                if not chapter_is_vip:
                                    count += 1
                        return count, f"qidian-{bid}"
                except:
                    pass
                toc_url = f"https://www.qidian.com/book/{bid}/"
                resp_bytes = request_get(toc_url, use_jina=True)
                content = resp_bytes.decode("utf-8")
                count = 0
                for line in content.split("\n"):
                    if "chapter/" in line and not any(k in line for k in ["__", "VIP", "Vip"]):
                        count += 1
                return count, f"qidian-{bid}"
    except Exception as e:
        print(f"Error probing {url}: {e}")
    return 0, None


def read_existing_catalog(file_path):
    """Read existing catalog file and find the last chapter number/title."""
    if not os.path.exists(file_path):
        return None, 0
        
    last_ordernum = 0
    last_title = None
    
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    matches = re.findall(r'\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|', content)
    if matches:
        for order_str, title_str in matches:
            try:
                num = int(order_str)
                if num > last_ordernum:
                    last_ordernum = num
                    last_title = title_str.strip()
            except ValueError:
                continue
                
    return last_title, last_ordernum


def write_catalog_to_file(file_path, novel_name, source_name, chapters, url):
    """Write the complete chapter list to the markdown file."""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(f"# Mục lục: {novel_name}\n\n")
        f.write(f"*   **Nguồn**: `{source_name}`\n")
        f.write(f"*   **Tổng số chương (Miễn phí)**: {len(chapters)}\n")
        f.write(f"*   **Liên kết gốc**: [Xem trên {source_name}]({url})\n")
        f.write(f"*   **Cập nhật cuối**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write("Danh sách chương được phân nhóm 100 chương dưới đây. Nhấp vào tên chương để mở liên kết đọc trực tiếp (Không yêu cầu VIP).\n\n")
        
        chunk_size = 100
        for i in range(0, len(chapters), chunk_size):
            chunk = chapters[i:i+chunk_size]
            start_ch = i + 1
            end_ch = min(i + chunk_size, len(chapters))
            
            f.write("<details>\n")
            f.write(f"<summary><b>Chương {start_ch} - {end_ch}</b></summary>\n\n")
            f.write("| Số thứ tự | Tên Chương | Liên kết đọc |\n")
            f.write("| :---: | :--- | :--- |\n")
            for item in chunk:
                ordernum = item.get("ordernum")
                title = item.get("title")
                ch_url = item.get("url")
                f.write(f"| {ordernum} | {title} | [Đọc chương {ordernum}]({ch_url}) |\n")
            f.write("\n</details>\n\n")


def main():
    parser = argparse.ArgumentParser(description="Fetch and update web novel catalogs.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    fetch_parser = subparsers.add_parser("fetch", help="Fetch or update catalog.")
    fetch_parser.add_argument("--name", required=True, help="Novel name for folder and filename.")
    fetch_parser.add_argument("--url", help="Specific catalog page URL.")
    fetch_parser.add_argument("--source", choices=["qidian", "69shuba", "ixdzs", "novel543", "truyendich"], help="Force source parser.")
    fetch_parser.add_argument("--output-dir", default="novel", help="Base directory for saving files.")
    fetch_parser.add_argument("--best", action="store_true", help="Auto-select source with the most chapters.")
    fetch_parser.add_argument("--lang", choices=["vi", "cn"], default="vi", help="Preferred language (vi or cn). Default: vi.")

    search_parser = subparsers.add_parser("search-online", help="Search novel online and print sources.")
    search_parser.add_argument("--name", required=True, help="Novel name to search.")
    
    args = parser.parse_args()
    
    if args.command == "search-online":
        name = args.name
        candidates = search_duckduckgo(name)
        if not candidates:
            print(f"No candidate sources found for '{name}'.")
            sys.exit(0)
            
        print(f"\nFound candidate sources for '{name}':")
        print(f"{'Source':<12} | {'Chapters':<10} | {'URL'}")
        print("-" * 100)
        for cand in candidates:
            count, title = probe_chapter_count(cand["source"], cand["url"])
            print(f"{cand['source']:<12} | {count:<10} | {cand['url']}")
        sys.exit(0)
        
    elif args.command == "fetch":
        name = args.name
        url = args.url
        source = args.source
        
        if not url:
            # Trigger search
            candidates = search_duckduckgo(name)
            if not candidates:
                print(f"Error: Could not find any online sources for novel: {name}", file=sys.stderr)
                sys.exit(1)
                
            print(f"Found {len(candidates)} online sources. Probing chapter counts...")
            for cand in candidates:
                count, title = probe_chapter_count(cand["source"], cand["url"])
                cand["count"] = count
                cand["title"] = title
                
            # Filter by language if specified
            if args.lang == "vi":
                lang_candidates = [c for c in candidates if c["source"] == "truyendich"]
                if not lang_candidates:
                    lang_candidates = [c for c in candidates if c["source"] != "truyendich"]
            else:
                lang_candidates = [c for c in candidates if c["source"] != "truyendich"]
                if not lang_candidates:
                    lang_candidates = [c for c in candidates if c["source"] == "truyendich"]
                    
            if not lang_candidates:
                lang_candidates = candidates
                
            # Sort by chapter count descending
            lang_candidates.sort(key=lambda x: x["count"], reverse=True)
            
            if args.best:
                best_cand = lang_candidates[0]
                print(f"Auto-selected best source: {best_cand['source']} ({best_cand['count']} chapters) - {best_cand['url']}")
                url = best_cand["url"]
                source = best_cand["source"]
            else:
                print("\nMultiple sources found. Please run with --best to auto-select, or run fetch with a specific --url:")
                print(f"{'Idx':<3} | {'Source':<12} | {'Chapters':<8} | {'URL'}")
                print("-" * 100)
                for idx, cand in enumerate(lang_candidates):
                    print(f"{idx+1:<3} | {cand['source']:<12} | {cand['count']:<8} | {cand['url']}")
                sys.exit(1)
                
        source = source or detect_source(url)
        if not source:
            print(f"Error: Could not automatically detect source for URL: {url}", file=sys.stderr)
            print("Please specify source manually with --source [qidian|69shuba|ixdzs|novel543|truyendich]", file=sys.stderr)
            sys.exit(1)
            
        try:
            if source == "ixdzs":
                chapters, source_name = fetch_ixdzs_catalog(url)
            elif source == "qidian":
                chapters, source_name = fetch_qidian_catalog(url)
            elif source == "69shuba":
                chapters, source_name = fetch_69shuba_catalog(url)
            elif source == "novel543":
                chapters, source_name = fetch_novel543_catalog(url)
            elif source == "truyendich":
                chapters, source_name = fetch_truyendich_catalog(url)
            else:
                raise ValueError(f"Unsupported source: {source}")
                
            if not chapters:
                print(f"Error: No free chapters fetched from {url}", file=sys.stderr)
                sys.exit(1)
                
            print(f"Successfully fetched {len(chapters)} free chapters from {source_name}.")
            
            file_name = f"{name}.md"
            file_name = re.sub(r'[\\/*?\":<>|]', "_", file_name)
            file_path = os.path.join(args.output_dir, source_name, file_name)
            
            last_title, last_num = read_existing_catalog(file_path)
            
            if last_num > 0:
                print(f"Local status: Found existing catalog up to Chapter {last_num} (Title: '{last_title}').")
                if len(chapters) > last_num:
                    new_count = len(chapters) - last_num
                    print(f"Update: Found {new_count} new chapters online.")
                    write_catalog_to_file(file_path, name, source_name, chapters, url)
                    print(f"Success: Updated catalog saved to: {file_path}")
                else:
                    print("Local status: Catalog is already up to date. No new chapters found.")
            else:
                print("Local status: No existing catalog found. Creating new catalog...")
                write_catalog_to_file(file_path, name, source_name, chapters, url)
                print(f"Success: New catalog saved to: {file_path}")
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Error: Operation failed. Reason: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
