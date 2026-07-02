import sys as _sys, os as _os; _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))  # cho phép import module ở root
import os
import re
from collections import defaultdict

NOVELS_DIR = "novels"

def extract_chapter_num(filename):
    # Matches "第123章", "chuong-123", or just "123"
    match = re.search(r'(?:第|chuong-)?(\d+)', filename)
    return int(match.group(1)) if match else None

def check_novel_health(slug):
    novel_dir = os.path.join(NOVELS_DIR, slug)
    if not os.path.isdir(novel_dir):
        print(f"Error: Novel directory '{slug}' not found.")
        return

    raw_dir = os.path.join(novel_dir, "text_raw")
    trans_dir = os.path.join(novel_dir, "translated")

    print(f"\n" + "="*60)
    print(f" HEALTH CHECK: {slug.upper()}")
    print("="*60)

    # 1. Collect files
    raw_files = [f for f in os.listdir(raw_dir) if f.endswith('.txt')] if os.path.exists(raw_dir) else []
    trans_files = [f for f in os.listdir(trans_dir) if f.endswith('.md')] if os.path.exists(trans_dir) else []

    raw_chapters = defaultdict(list)
    for f in raw_files:
        num = extract_chapter_num(f)
        if num is not None:
            raw_chapters[num].append(f)

    trans_chapters = defaultdict(list)
    for f in trans_files:
        num = extract_chapter_num(f)
        if num is not None:
            trans_chapters[num].append(f)

    # 2. Check for missing chapters in sequence
    all_nums = sorted(set(list(raw_chapters.keys()) + list(trans_chapters.keys())))
    if all_nums:
        min_ch = all_nums[0]
        max_ch = all_nums[-1]
        print(f"Chapter range: {min_ch} to {max_ch}")
        
        gaps = []
        for i in range(min_ch, max_ch + 1):
            if i not in trans_chapters:
                gaps.append(i)
        
        if gaps:
            print(f"❌ Missing chapters in 'translated': {gaps[:20]}{'...' if len(gaps) > 20 else ''} (Total: {len(gaps)})")
        else:
            print(f"✅ No gaps found in 'translated' folder (1 to {max_ch}).")
    else:
        print("No chapters found.")

    # 3. Check for split chapters (multiple files for one chapter)
    splits = {num: files for num, files in trans_chapters.items() if len(files) > 1}
    if splits:
        print(f"\n⚠️ Split chapters (multiple files):")
        for num in sorted(splits.keys()):
            print(f"  Chapter {num}: {splits[num]}")
    else:
        print("✅ No duplicate/split chapter files found.")

    # 4. Check for title irregularities (the " - 1" issue)
    suffix_issues = []
    re_suffix = re.compile(r'^# Chương.* - \d+$')
    for f in trans_files:
        path = os.path.join(trans_dir, f)
        try:
            with open(path, 'r', encoding='utf-8') as file:
                first_line = file.readline().strip()
                if re_suffix.match(first_line):
                    suffix_issues.append((f, first_line))
        except:
            pass
    
    if suffix_issues:
        print(f"\n❌ Title suffix issues found in {len(suffix_issues)} files:")
        for f, title in suffix_issues[:10]:
            print(f"  {f}: {title}")
        if len(suffix_issues) > 10:
            print(f"  ... and {len(suffix_issues) - 10} more.")
    else:
        print("✅ All chapter titles are clean (no ' - 1' suffixes).")

    print("="*60)

def main():
    if not os.path.exists(NOVELS_DIR):
        print("No novels directory found.")
        return

    slugs = [d for d in os.listdir(NOVELS_DIR) if os.path.isdir(os.path.join(NOVELS_DIR, d))]
    for slug in slugs:
        check_novel_health(slug)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        check_novel_health(sys.argv[1])
    else:
        main()
