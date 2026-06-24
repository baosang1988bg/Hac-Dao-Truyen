#!/usr/bin/env python3
import os
import sys
import json
from pathlib import Path

# Add parent dir to sys.path to import modules
sys.path.append(str(Path(__file__).resolve().parent.parent))

from novel_manager import load_novel
from main import get_output_path, safe_filename

def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    profile = load_novel(slug)
    
    catalog_path = Path("novels") / profile.slug / "catalog.json"
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    translated_dir = profile.translated_dir
    files_on_disk = os.listdir(translated_dir)
    
    renamed_count = 0
    for item in catalog:
        title = item["original_title"]
        expected_base = safe_filename(title)
        expected_name = f"{expected_base}_VI.md"
        expected_path = os.path.join(translated_dir, expected_name)
        
        if not os.path.exists(expected_path):
            # Look for alternative names with suffixes
            for f in files_on_disk:
                # e.g., "第74章 你實力最強你說了算 1-2_VI.md"
                if f.startswith(expected_base) and f.endswith("_VI.md") and f != expected_name:
                    old_path = os.path.join(translated_dir, f)
                    os.rename(old_path, expected_path)
                    print(f"  ✓ Renamed: {f} → {expected_name}")
                    renamed_count += 1
                    break
                    
    print(f"\n🎉 Finished renaming! Renamed {renamed_count} files.")

if __name__ == "__main__":
    main()
