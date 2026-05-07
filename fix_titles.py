import os
import re

NOVELS_DIR = "novels"

def extract_chapter_num(filename):
    match = re.search(r'\d+', filename)
    return int(match.group()) if match else None

def fix_titles():
    if not os.path.exists(NOVELS_DIR):
        print("No novels directory found.")
        return

    fixed_count = 0
    for slug in os.listdir(NOVELS_DIR):
        novel_dir = os.path.join(NOVELS_DIR, slug)
        if not os.path.isdir(novel_dir):
            continue

        trans_dir = os.path.join(novel_dir, "translated")
        if not os.path.exists(trans_dir):
            continue

        for filename in os.listdir(trans_dir):
            if not (filename.endswith(".md") or filename.endswith(".txt")):
                continue

            chap_num = extract_chapter_num(filename)
            if chap_num is None:
                continue

            filepath = os.path.join(trans_dir, filename)
            
            with open(filepath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            if not lines:
                continue
                
            first_line = lines[0].strip()
            
            if first_line.startswith("# "):
                title_content = first_line[2:].strip()
                
                # Check if it already starts with "Chương " (case insensitive)
                if not re.match(rf'^Chương\s+{chap_num}\s*:', title_content, re.IGNORECASE):
                    # It might have "Chương xx " without colon, or something else
                    # Let's strip any existing "Chương xx" just in case
                    clean_title = re.sub(rf'^Chương\s+{chap_num}\s*[:\-]*\s*', '', title_content, flags=re.IGNORECASE)
                    
                    new_first_line = f"# Chương {chap_num}: {clean_title}\n"
                    lines[0] = new_first_line
                    
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.writelines(lines)
                    
                    print(f"Fixed: {slug}/{filename} -> {new_first_line.strip()}")
                    fixed_count += 1
            
    print(f"\nTotal files fixed: {fixed_count}")

if __name__ == "__main__":
    fix_titles()
