#!/usr/bin/env python3
import os
import json
import argparse
from pathlib import Path
from main import load_novel, get_output_path, is_already_translated, is_failed_translation, cmd_translate_async

class MockArgs:
    def __init__(self, novel, chapters=1, url=None):
        self.novel = novel
        self.chapters = chapters
        self.url = url
        self.provider = "auto"
        self.force = False
        self.mode = "batch"

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--novel', required=True, help='Slug of the novel')
    args_cli = parser.parse_args()

    # Load novel profile
    try:
        profile = load_novel(args_cli.novel)
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

    # Scan and find missing indices
    missing_items = []
    for item in catalog:
        title = item["original_title"]
        out_path = get_output_path(profile, title)
        if not is_already_translated(out_path) or is_failed_translation(out_path):
            missing_items.append(item)

    if not missing_items:
        print("🎉 All chapters in catalog are already translated successfully!")
        return

    print(f"🔍 Found {len(missing_items)} missing/failed chapters out of {len(catalog)} total chapters.")
    print("Missing chapters numbers:", [item["number"] for item in missing_items])

    import asyncio
    # Translate one by one by passing explicit URL to translator
    for idx, item in enumerate(missing_items, 1):
        print(f"\n🚀 [{idx}/{len(missing_items)}] Translating missing chapter {item['number']}: {item['original_title']}")
        mock_args = MockArgs(profile.slug, chapters=1, url=item["url"])
        try:
            await cmd_translate_async(mock_args)
        except Exception as ex:
            print(f"❌ Error translating chapter {item['number']}: {ex}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
