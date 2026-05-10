import os
import glob

def check_stuck_paragraphs(directory):
    files = glob.glob(os.path.join(directory, "*.md"))
    stuck_files = []
    
    for file_path in files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            if not lines:
                continue
                
            # Filter out empty lines and header
            content_lines = [l.strip() for l in lines if l.strip() and not l.startswith('#')]
            
            if not content_lines:
                continue
                
            max_line_len = max(len(l) for l in content_lines)
            avg_line_len = sum(len(l) for l in content_lines) / len(content_lines)
            
            # If any line is longer than 2000 chars, or avg length is very high
            if max_line_len > 1500 or avg_line_len > 1000:
                stuck_files.append({
                    "path": file_path,
                    "max_len": max_line_len,
                    "avg_len": avg_line_len,
                    "line_count": len(lines)
                })
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            
    return stuck_files

if __name__ == "__main__":
    dir_path = "/Users/sangpls/Documents/AI00/HacDaoTruyen/novels/xich-tam-tuan-thien/translated/"
    results = check_stuck_paragraphs(dir_path)
    
    print(f"Found {len(results)} potentially stuck files:")
    for res in sorted(results, key=lambda x: x['avg_len'], reverse=True):
        print(f"- {os.path.basename(res['path'])} (Avg: {res['avg_len']:.0f}, Max: {res['max_len']}, Lines: {res['line_count']})")
