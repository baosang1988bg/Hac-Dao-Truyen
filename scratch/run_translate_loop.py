import os
import sys
import json
import time
import subprocess
from pathlib import Path

NOVEL_SLUG = "lanh-chu-tranh-ba-bat-dau-tu-nam-tuoc-co-dao"
PROFILE_PATH = Path("novels") / NOVEL_SLUG / "novel.json"

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

def load_novel_profile():
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def run_translation(chapters_to_translate):
    python_exe = r"C:\Users\ADMIN\AppData\Local\Python\bin\python.exe"
    cmd = [
        python_exe, "-u", "main.py", "translate",
        "--novel", NOVEL_SLUG,
        "--chapters", str(chapters_to_translate)
    ]
    print(f"\n🔄 Running: {' '.join(cmd)}")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    
    # We run the command and stream output
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        env=env
    )
    
    for line in iter(process.stdout.readline, ""):
        print(line, end="")
        
    process.stdout.close()
    return_code = process.wait()
    return return_code

def main():
    print("🚀 Starting self-healing translation loop...")
    
    consecutive_failures = 0
    last_known_chapter = -1
    
    while True:
        profile = load_novel_profile()
        last_chapter = profile.get("last_chapter_number", 0)
        total_chapters = profile.get("total_chapters", 118)
        
        print(f"\n📊 Status: Chapter {last_chapter}/{total_chapters}")
        
        if last_chapter >= total_chapters:
            print("🎉 Success: Reached the target chapter or catalog limit!")
            break
            
        if last_chapter == last_known_chapter:
            consecutive_failures += 1
            print(f"⚠️ Chapter progress stuck at {last_chapter}. Consecutive failures: {consecutive_failures}")
            if consecutive_failures >= 15:
                print("❌ Stopped: Too many consecutive failures on the same chapter.")
                sys.exit(1)
            # Wait longer on repeated failures
            wait_time = 10 * consecutive_failures
            print(f"💤 Waiting {wait_time} seconds before retrying...")
            time.sleep(wait_time)
        else:
            consecutive_failures = 0
            last_known_chapter = last_chapter
            time.sleep(2) # brief pause
            
        chapters_left = total_chapters - last_chapter
        run_translation(chapters_left)

if __name__ == "__main__":
    main()
