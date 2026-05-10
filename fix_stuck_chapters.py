import os
import glob
import re

def fix_stuck_paragraphs(text):
    """
    Detect and fix 'stuck' paragraphs (very long lines).
    If a line is > 500 chars, split at sentence endings.
    """
    if not text:
        return text
        
    lines = text.split('\n')
    fixed_lines = []
    
    for line in lines:
        stripped = line.strip()
        # Skip headers or already short lines
        if not stripped or line.startswith('#') or len(stripped) < 500:
            fixed_lines.append(line)
            continue
        
        # Split at sentence endings (. ! ? ...) followed by space
        # We replace it with the punctuation + double newline
        fixed_line = re.sub(r'([.!?…])\s+', r'\1\n\n', stripped)
        fixed_lines.append(fixed_line)
        
    return '\n'.join(fixed_lines)

def process_directory(directory):
    files = glob.glob(os.path.join(directory, "*.md"))
    fixed_count = 0
    
    print(f"Checking {len(files)} files in {directory}...")
    
    for file_path in files:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Quick check if it needs fixing (has any line > 500 chars)
        lines = content.split('\n')
        needs_fix = any(len(l.strip()) > 500 and not l.strip().startswith('#') for l in lines)
        
        if needs_fix:
            print(f"Fixing: {os.path.basename(file_path)}")
            fixed_content = fix_stuck_paragraphs(content)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(fixed_content)
            fixed_count += 1
            
    print(f"Done! Fixed {fixed_count} files.")

if __name__ == "__main__":
    target_dir = "/Users/sangpls/Documents/AI00/HacDaoTruyen/novels/xich-tam-tuan-thien/translated/"
    process_directory(target_dir)
