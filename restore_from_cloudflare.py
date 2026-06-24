#!/usr/bin/env python3
import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime

# Set output encoding to UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

NOVELS_BASE_DIR = Path("novels")
D1_DB_NAME = "hacdao-db"
R2_BUCKET = "hacdao-chapters"
SYNC_STATE_PATH = Path(".sync_state.json")

def run_command(cmd_list):
    """Run command via cmd.exe on Windows to bypass PowerShell execution policy."""
    cmd_str = " ".join(cmd_list)
    result = subprocess.run(
        f"cmd /c {cmd_str}",
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding='utf-8'
    )
    return result

def query_d1(sql):
    """Execute SQL query on Cloudflare D1 and parse JSON results."""
    # Write SQL to temporary file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', encoding='utf-8', delete=False) as f:
        f.write(sql)
        tmp_name = f.name

    try:
        cmd = [
            "npx", "wrangler", "d1", "execute", D1_DB_NAME,
            "--remote", f"--file={tmp_name}", "--json"
        ]
        res = run_command(cmd)
        if res.returncode != 0:
            print(f"[D1-Error] Failed to execute query. Stderr: {res.stderr}")
            return None

        # Clean wrangler output to find JSON
        stdout = res.stdout.strip()
        data = None
        for i, line in enumerate(stdout.splitlines()):
            line = line.strip()
            if line.startswith('['):
                try:
                    data = json.loads('\n'.join(stdout.splitlines()[i:]))
                    break
                except json.JSONDecodeError:
                    continue
        
        if not data:
            return []
        
        return data[0].get('results', [])
    except Exception as e:
        print(f"[D1-Exception] {e}")
        return None
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)

def download_r2_object(r2_key, local_path):
    """Download an object from Cloudflare R2 bucket."""
    local_path = Path(local_path)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    
    cmd = [
        "npx", "wrangler", "r2", "object", "get",
        f"{R2_BUCKET}/{r2_key}", f'--file="{local_path}"', "--remote"
    ]
    res = run_command(cmd)
    return res.returncode == 0

def restore():
    print("=== STARTING RESTORE FROM CLOUDFLARE D1 + R2 ===")
    
    # 1. Fetch all novels from D1
    print("Fetching novels list from Cloudflare D1...")
    novels = query_d1("SELECT * FROM novels;")
    if novels is None:
        print("[-] Could not retrieve novels. Please make sure wrangler is authenticated.")
        return
    
    if not novels:
        print("[!] No novels found in Cloudflare D1 database.")
        return

    print(f"[+] Found {len(novels)} novels in database.")
    
    sync_state = {}
    
    for novel in novels:
        slug = novel['slug']
        title = novel['title']
        print(f"\nRestoring novel: {title} ({slug})...")
        
        novel_dir = NOVELS_BASE_DIR / slug
        trans_dir = novel_dir / "translated"
        raw_dir = novel_dir / "text_raw"
        
        trans_dir.mkdir(parents=True, exist_ok=True)
        raw_dir.mkdir(parents=True, exist_ok=True)
        
        # 2. Download glossary from R2
        glossary = {}
        glossary_key = f"{slug}/glossary.json"
        temp_glossary_path = Path(tempfile.gettempdir()) / f"{slug}_glossary.json"
        
        print("  -> Downloading glossary from R2...")
        if download_r2_object(glossary_key, temp_glossary_path):
            try:
                with open(temp_glossary_path, "r", encoding="utf-8") as f:
                    glossary = json.load(f)
                print(f"  [+] Loaded {len(glossary)} glossary terms.")
            except Exception as e:
                print(f"  [-] Failed to parse glossary JSON: {e}")
            finally:
                if temp_glossary_path.exists():
                    os.unlink(temp_glossary_path)
        else:
            print("  [-] No glossary found on R2 or download failed. Using empty glossary.")
            
        # 3. Recreate novel.json
        novel_profile = {
            "slug": slug,
            "title": title,
            "original_title": novel.get('original_title', ''),
            "author": novel.get('author', ''),
            "source_url": novel.get('source_url', ''),
            "genre": novel.get('genre', 'cultivation'),
            "last_translated_url": novel.get('last_translated_url', ''),
            "last_chapter_number": novel.get('last_chapter_number', 0),
            "total_chapters": novel.get('total_chapters', 0),
            "glossary": glossary,
            "translation_style": novel.get('translation_style', ''),
            "notes": novel.get('notes', '')
        }
        
        novel_json_path = novel_dir / "novel.json"
        with open(novel_json_path, "w", encoding="utf-8") as f:
            json.dump(novel_profile, f, ensure_ascii=False, indent=2)
        print(f"  [+] Recreated novel.json")
        
        # 4. Fetch chapters list from D1
        print("  -> Fetching chapters list from D1...")
        chapters = query_d1(f"SELECT filename, title, chapter_number, r2_key FROM chapters WHERE novel_slug='{slug}';")
        if chapters is None:
            print("  [-] Failed to fetch chapters list from D1.")
            continue
            
        print(f"  [+] Found {len(chapters)} chapters in D1.")
        
        # 5. Download chapters from R2
        downloaded_count = 0
        skipped_count = 0
        failed_count = 0
        
        last_filename = ""
        max_chap_num = -1
        
        for idx, chap in enumerate(chapters, 1):
            filename = chap['filename']
            r2_key = chap['r2_key']
            chap_num = chap['chapter_number']
            
            # Keep track of last chapter info for sync state
            if chap_num > max_chap_num:
                max_chap_num = chap_num
                last_filename = filename
                
            local_chap_path = trans_dir / filename
            
            if local_chap_path.exists():
                skipped_count += 1
                continue
                
            # print(f"    [{idx}/{len(chapters)}] Downloading {filename}...")
            if download_r2_object(r2_key, local_chap_path):
                downloaded_count += 1
            else:
                failed_count += 1
                
        print(f"  [+] Chapter Sync complete: {downloaded_count} downloaded, {skipped_count} skipped (existed), {failed_count} failed.")
        
        # 6. Build sync state info
        sync_state[slug] = {
            "last_synced_at": datetime.now().isoformat(),
            "last_chapter_number": max_chap_num if max_chap_num >= 0 else novel.get('last_chapter_number', 0),
            "last_filename": last_filename,
            "total_synced": len(chapters) - failed_count
        }

    # 7. Recreate .sync_state.json
    with open(SYNC_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(sync_state, f, ensure_ascii=False, indent=2)
    print("\n[+] Recreated .sync_state.json successfully!")
    print("\n=== RESTORE COMPLETED SUCCESSFULLY! ===")

if __name__ == "__main__":
    restore()
