#!/usr/bin/env python3
import os
import sys
import json
import time
import urllib.request
import urllib.error
import re
from pathlib import Path

# Add parent dir to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from novel_manager import load_novel
from main import safe_filename

def get_page_content(url):
    jina_url = f"https://r.jina.ai/{url}"
    print(f"Fetching: {jina_url}")
    try:
        req = urllib.request.Request(
            jina_url, 
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
            if len(content) > 300 and "Title:" in content:
                # Extract markdown content after "Markdown Content:"
                marker = "Markdown Content:"
                idx = content.find(marker)
                if idx != -1:
                    text = content[idx + len(marker):].strip()
                    # Clean up some common Jina stuff if needed, but keeping it simple is best
                    return text
                else:
                    return content
    except Exception as e:
        print(f"  ❌ Error fetching {url}: {e}")
    return None

def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    profile = load_novel(slug)
    
    catalog_path = Path("novels") / profile.slug / "catalog.json"
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    # Map chapter number -> catalog item
    catalog_map = {}
    for item in catalog:
        # Match chapter number using regex from original_title (e.g. 第74章 -> 74)
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
    
    updated_count = 0
    for filename in raw_files:
        # Extract chapter number from filename
        m = re.search(r'第(\d+)章', filename)
        if not m:
            print(f"⚠️ Could not parse chapter number from filename: {filename}")
            continue
        chap_num = int(m.group(1))
        
        if chap_num not in catalog_map:
            print(f"⚠️ Chapter {chap_num} not found in catalog map (file: {filename})")
            continue
            
        catalog_item = catalog_map[chap_num]
        url = catalog_item["url"]
        if not url.endswith(".html"):
            print(f"⚠️ URL does not end with .html: {url}")
            continue
            
        base_url = url[:-5]
        page2_url = f"{base_url}_2.html"
        
        # Read current content to check if we already appended it
        raw_path = raw_dir / filename
        with open(raw_path, "r", encoding="utf-8") as f:
            current_content = f.read()
            
        if "--- PAGE 2 ---" in current_content or "Title: 第" in current_content and "(2/2)" in current_content:
            print(f"ℹ️ {filename} already has page 2 content. Skipping fetch.")
            continue
            
        print(f"\nProcessing {filename} (Chapter {chap_num})")
        page2_text = get_page_content(page2_url)
        if page2_text:
            # Append page 2 text
            # Write to raw file
            new_content = current_content.strip() + "\n\n\n--- PAGE 2 ---\n\n\n" + page2_text
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"✅ Appended page 2 content to {filename}")
            
            # Delete corresponding translated file to trigger retranslation
            stem = filename[:-4] # strip .txt
            
            # Delete both possible translated files (with and without suffix)
            translated_names = [
                f"{safe_filename(stem)}_VI.md",
                f"{safe_filename(catalog_item['original_title'])}_VI.md"
            ]
            for t_name in translated_names:
                t_path = translated_dir / t_name
                if t_path.exists():
                    t_path.unlink()
                    print(f"🗑️ Deleted translated file: {t_name}")
            
            updated_count += 1
            # Rate limiting delay for Jina Reader
            time.sleep(2)
        else:
            print(f"❌ Failed to fetch page 2 for Chapter {chap_num}")
            
    print(f"\n🎉 Done! Successfully updated {updated_count} chapters with page 2 content.")

if __name__ == "__main__":
    main()
