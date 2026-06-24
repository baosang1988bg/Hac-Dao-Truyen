#!/usr/bin/env python3
import os
import sys
import json
from pathlib import Path

# Add parent dir to sys.path to import modules
sys.path.append(str(Path(__file__).resolve().parent.parent))

from novel_manager import load_novel
from main import get_output_path, is_already_translated, is_failed_translation

def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    profile = load_novel(slug)
    
    catalog_path = Path("novels") / profile.slug / "catalog.json"
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    missing_chapters = []
    for item in catalog:
        title = item["original_title"]
        out_path = get_output_path(profile, title)
        if not is_already_translated(out_path) or is_failed_translation(out_path):
            missing_chapters.append(item)
            
    if not missing_chapters:
        print("🎉 ALL CHAPTERS ARE TRANSLATED SUCCESSFULLY!")
    else:
        print(f"❌ Found {len(missing_chapters)} missing/failed chapters:")
        for item in missing_chapters:
            print(f"   - Chapter {item['number']}: {item['original_title']}")

if __name__ == "__main__":
    main()
