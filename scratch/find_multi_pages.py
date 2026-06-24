#!/usr/bin/env python3
import os
import sys
import json
import urllib.request
import urllib.error
import asyncio
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

# Add parent dir to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from novel_manager import load_novel

def check_page_exists(url):
    jina_url = f"https://r.jina.ai/{url}"
    try:
        req = urllib.request.Request(
            jina_url, 
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            # If 200 OK and response contains a reasonable length of text
            content = resp.read().decode("utf-8")
            if len(content) > 300 and "Title:" in content:
                return True
    except Exception:
        pass
    return False

async def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    profile = load_novel(slug)
    
    catalog_path = Path("novels") / profile.slug / "catalog.json"
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    print(f"Scanning {len(catalog)} chapters for page 2...")
    
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=20) as executor:
        tasks = []
        for item in catalog:
            url = item["url"]
            # e.g. "https://www.novel543.com/0315291074/8012_75.html" -> "https://www.novel543.com/0315291074/8012_75_2.html"
            if url.endswith(".html"):
                base_url = url[:-5]
                page2_url = f"{base_url}_2.html"
                
                # Check page 2
                task = loop.run_in_executor(executor, lambda u=page2_url, c=item: (c, u, check_page_exists(u)))
                tasks.append(task)
                
        results = await asyncio.gather(*tasks)
        
    multi_page_chapters = []
    for item, url, exists in results:
        if exists:
            multi_page_chapters.append((item, url))
            print(f"  [Multi-Page] Chapter {item['number']}: {item['original_title']} has page 2 -> {url}")
            
    print(f"\nScan finished! Found {len(multi_page_chapters)} multi-page chapters.")

if __name__ == "__main__":
    asyncio.run(main())
