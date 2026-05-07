import os
import re

NOVELS_DIR = "novels"

def count_paragraphs(filepath):
    count = 0
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                count += 1
    return count

def get_char_count(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        return len(f.read().strip())

def extract_chapter_num(filename):
    match = re.search(r'\d+', filename)
    return int(match.group()) if match else None

def verify_translations():
    if not os.path.exists(NOVELS_DIR):
        print("No novels directory found.")
        return

    print("="*60)
    print(" TRANSLATION VERIFICATION REPORT")
    print("="*60)

    for slug in os.listdir(NOVELS_DIR):
        novel_dir = os.path.join(NOVELS_DIR, slug)
        if not os.path.isdir(novel_dir):
            continue

        raw_dir = os.path.join(novel_dir, "text_raw")
        trans_dir = os.path.join(novel_dir, "translated")

        if not os.path.exists(raw_dir) or not os.path.exists(trans_dir):
            continue

        raw_files = [f for f in os.listdir(raw_dir) if f.endswith('.txt')]
        trans_files = [f for f in os.listdir(trans_dir) if f.endswith('.md')]

        # Map by chapter number
        raw_map = {extract_chapter_num(f): os.path.join(raw_dir, f) for f in raw_files if extract_chapter_num(f) is not None}
        trans_map = {extract_chapter_num(f): os.path.join(trans_dir, f) for f in trans_files if extract_chapter_num(f) is not None}

        print(f"\n[Novel: {slug}]")
        issues_found = False

        for chap_num in sorted(trans_map.keys()):
            if chap_num not in raw_map:
                continue

            raw_path = raw_map[chap_num]
            trans_path = trans_map[chap_num]

            raw_paras = count_paragraphs(raw_path)
            trans_paras = count_paragraphs(trans_path)

            raw_chars = get_char_count(raw_path)
            trans_chars = get_char_count(trans_path)

            # Ignore extremely small files (e.g., just title)
            if raw_chars < 50:
                continue

            ratio = trans_chars / raw_chars if raw_chars > 0 else 0
            
            # Heuristics for flags:
            # 1. Paragraph count differs by more than 30%
            # 2. Ratio is less than 1.1x (Vietnamese is generally 1.4-2.2x longer than Chinese)
            para_diff = abs(raw_paras - trans_paras) / max(raw_paras, 1)
            
            flag_para = para_diff > 0.3
            flag_ratio = ratio < 1.1 or ratio > 3.0

            if flag_para or flag_ratio:
                issues_found = True
                print(f"  -> Chapter {chap_num} might be incomplete!")
                print(f"     Raw: {raw_paras} paras ({raw_chars} chars) | Trans: {trans_paras} paras ({trans_chars} chars)")
                if flag_ratio:
                    print(f"     [!] Suspicious character ratio: {ratio:.2f}x (Expected ~1.5x - 2.5x)")
                if flag_para:
                    print(f"     [!] Paragraph count mismatch ({raw_paras} vs {trans_paras})")
                print()

        if not issues_found:
            print("  All translated chapters look healthy and complete! ✅")

if __name__ == "__main__":
    verify_translations()
