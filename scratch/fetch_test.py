#!/usr/bin/env python3
import asyncio
import sys
from pathlib import Path

# Add parent dir to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from scraper import NovelScraper

async def main():
    scraper = NovelScraper()
    await scraper.start()
    
    url = "https://www.novel543.com/0315291074/8012_75.html"
    try:
        html = await scraper.fetch_html(url)
        title, content, prev_url, next_url = scraper.parse_content(html, url)
        print(f"URL: {url}")
        print(f"Title: {title}")
        print(f"Content length: {len(content)}")
        print(f"Prev URL: {prev_url}")
        print(f"Next URL: {next_url}")
        
        # Print first few lines of content
        print("\nContent Preview:")
        print("\n".join(content.split("\n")[:10]))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await scraper.close()

if __name__ == "__main__":
    asyncio.run(main())
