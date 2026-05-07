import os
import re

NOVELS_DIR = "novels"

def extract_chapter_num(filename):
    match = re.search(r'\d+', filename)
    return int(match.group()) if match else None

def clean_title_string(title, chap_num):
    # Remove leading '# '
    if title.startswith('# '):
        title = title[2:]
    
    # Remove 'Chương xx:' or 'Chương xx :' etc.
    title = re.sub(rf'^Chương\s+{chap_num}\s*[:\-]*\s*', '', title, flags=re.IGNORECASE)
    return title.strip()

def fix_all_titles():
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
            
            # If the first line is already perfectly formatted, skip.
            # E.g. "# Chương 10: Title"
            if re.match(rf'^# Chương {chap_num}:\s+\S+', first_line, re.IGNORECASE):
                continue
            
            # Otherwise, we need to fix it.
            # Let's find the actual title from the first 15 lines.
            found_title = ""
            title_line_idx = -1
            
            for i in range(min(15, len(lines))):
                line = lines[i].strip()
                if line.startswith('# '):
                    found_title = line
                    title_line_idx = i
                    break
                elif line.lower().startswith('chương '):
                    found_title = line
                    title_line_idx = i
                    break
            
            # If we couldn't find a title in the text, use the filename as fallback
            if not found_title:
                found_title = filename.replace('_VI.md', '').replace('.txt', '')
                
            pure_title = clean_title_string(found_title, chap_num)
            if not pure_title:
                pure_title = filename.replace('_VI.md', '').replace('.txt', '')
                pure_title = clean_title_string(pure_title, chap_num)
                
            new_title_line = f"# Chương {chap_num}: {pure_title}\n"
            
            # Now, reconstruct the file
            # If we found a title line, we can remove it (to avoid duplication if it's further down)
            if title_line_idx != -1:
                lines.pop(title_line_idx)
                
            # Prepend the new title line at the very top (or replace line 0 if line 0 was the old title, which was already popped)
            # Wait, if line 0 was popped, lines[0] is now the next line. We just insert at 0.
            lines.insert(0, new_title_line)
            
            # Ensure there's a blank line after the title if the next line isn't blank
            if len(lines) > 1 and lines[1].strip() != "":
                lines.insert(1, "\n")
                
            with open(filepath, 'w', encoding='utf-8') as f:
                f.writelines(lines)
            
            print(f"Fixed: {slug}/{filename} -> {new_title_line.strip()}")
            fixed_count += 1
            
    print(f"\nTotal files fixed: {fixed_count}")

if __name__ == "__main__":
    fix_all_titles()
