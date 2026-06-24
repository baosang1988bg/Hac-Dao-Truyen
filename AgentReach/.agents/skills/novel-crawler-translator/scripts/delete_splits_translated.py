#!/usr/bin/env python3
import os
import sys
import json
import re
from pathlib import Path

# Add Cwd/root path to sys.path
sys.path.append(os.getcwd())
try:
    from novel_manager import load_novel
    from main import safe_filename
except ImportError:
    # Fallback to parent resolves
    sys.path.append(str(Path(__file__).resolve().parents[4]))
    from novel_manager import load_novel
    from main import safe_filename

def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    profile = load_novel(slug)
    
    catalog_path = Path("novels") / profile.slug / "catalog.json"
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    catalog_map = {}
    for item in catalog:
        m = re.search(r'第(\d+)章', item["original_title"])
        if m:
            chap_num = int(m.group(1))
            catalog_map[chap_num] = item
        else:
            catalog_map[item["number"]] = item

    raw_dir = Path(profile.raw_dir)
    translated_dir = Path(profile.translated_dir)
    
    raw_files = sorted(f for f in os.listdir(raw_dir) if "(1-2).txt" in f)
    print(f"Found {len(raw_files)} raw files with '(1-2)' suffix.")
    
    deleted_count = 0
    for filename in raw_files:
        m = re.search(r'第(\d+)章', filename)
        if not m:
            continue
        chap_num = int(m.group(1))
        if chap_num not in catalog_map:
            continue
            
        catalog_item = catalog_map[chap_num]
        stem = filename[:-4]
        
        possible_names = [
            f"{safe_filename(stem)}_VI.md",
            f"{safe_filename(catalog_item['original_title'])}_VI.md"
        ]
        for name in possible_names:
            t_path = translated_dir / name
            if t_path.exists():
                t_path.unlink()
                print(f"🗑️ Deleted translated file: {name}")
                deleted_count += 1
                
    print(f"Deleted {deleted_count} files. Now starting re-translation...")

if __name__ == "__main__":
    main()
