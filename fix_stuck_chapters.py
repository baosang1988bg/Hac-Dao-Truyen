import os
import glob
import re

def fix_stuck_paragraphs(text):
    """
    Phát hiện và sửa các đoạn văn bị 'dính' (quá dài).
    Chỉ ngắt đoạn khi khối văn bản > 300 ký tự và chọn điểm ngắt là sau 2-3 câu.
    """
    if not text:
        return text
        
    lines = text.split('\n')
    fixed_lines = []
    
    for line in lines:
        stripped = line.strip()
        # Bỏ qua tiêu đề hoặc dòng ngắn
        if not stripped or line.startswith('#') or len(stripped) < 300:
            fixed_lines.append(line)
            continue
        
        # Tách thành các câu (giữ lại dấu câu)
        parts = re.split(r'([.!?…])\s+', stripped)
        
        new_block = ""
        current_segment = ""
        
        # Duyệt qua các cặp (nội dung câu, dấu câu)
        for i in range(0, len(parts) - 1, 2):
            sentence = parts[i] + parts[i+1]
            current_segment += sentence + " "
            
            # Nếu đoạn hiện tại đã đủ dài (> 250 ký tự), thực hiện ngắt
            if len(current_segment) > 250:
                new_block += current_segment.strip() + "\n\n"
                current_segment = ""
        
        # Thêm phần còn lại
        new_block += current_segment.strip()
        fixed_lines.append(new_block.strip())
        
    return '\n\n'.join([l for l in fixed_lines if l.strip()])

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
