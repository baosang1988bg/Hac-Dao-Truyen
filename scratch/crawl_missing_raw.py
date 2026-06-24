#!/usr/bin/env python3
import os
import sys
import json
import asyncio
from pathlib import Path

# Add parent dir to sys.path to import modules
sys.path.append(str(Path(__file__).resolve().parent.parent))

from novel_manager import load_novel
from scraper import NovelScraper
from main import get_output_path, is_already_translated, is_failed_translation, save_raw_parts

async def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    try:
        profile = load_novel(slug)
    except Exception as e:
        print(f"Error loading novel: {e}")
        return

    # Load catalog
    catalog_path = Path("novels") / profile.slug / "catalog.json"
    if not catalog_path.exists():
        print(f"Catalog not found at {catalog_path}")
        return

    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    # Find missing chapters
    missing_items = []
    for item in catalog:
        title = item["original_title"]
        out_path = get_output_path(profile, title)
        if not is_already_translated(out_path) or is_failed_translation(out_path):
            missing_items.append(item)

    if not missing_items:
        print("🎉 All chapters in catalog are already translated successfully!")
        return

    print(f"🔍 Found {len(missing_items)} missing chapters out of {len(catalog)} total.")
    print("Missing chapters numbers:", [item["number"] for item in missing_items])

    # Start scraper
    scraper = NovelScraper()
    await scraper.start()

    crawled_count = 0
    try:
        for idx, item in enumerate(missing_items, 1):
            url = item["url"]
            title_orig = item.get("original_title") or item.get("title") or f"Chương {item.get('number')}"
            
            # Check if raw files exist
            raw_file_name = f"{title_orig}.txt"
            raw_path_check = os.path.join(profile.raw_dir, raw_file_name)
            
            if os.path.exists(raw_path_check):
                print(f"[{idx}/{len(missing_items)}] Raw file already exists for: {title_orig}")
                continue
                
            print(f"[{idx}/{len(missing_items)}] Crawling: {title_orig} ({url})")
            try:
                html = await scraper.fetch_html(url)
                if not html:
                    print(f"  ❌ Error crawling HTML for: {title_orig}")
                    continue
                
                title, content, _, _ = scraper.parse_content(html, url)
                if not content or "Could not find" in content:
                    print(f"  ❌ Error parsing content for: {title_orig}")
                    continue
                
                # Save raw parts
                save_raw_parts(profile, title, content)
                print(f"  ✓ Saved raw file for: {title}")
                crawled_count += 1
                
                # Sleep briefly to be nice to the server
                await asyncio.sleep(0.5)
            except Exception as e:
                print(f"  ❌ Exception crawling {title_orig}: {e}")
    finally:
        await scraper.close()

    print(f"\n🎉 Finished crawling raw files! Crawled: {crawled_count} new chapters.")

if __name__ == "__main__":
    asyncio.run(main())
