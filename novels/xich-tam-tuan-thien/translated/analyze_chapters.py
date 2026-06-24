import os
import re

dir_path = "/Users/sangpls/Documents/AI00/HacDaoTruyen/novels/xich-tam-tuan-thien/translated"
files = os.listdir(dir_path)

chapters = {}

# Patterns to match
# 第1411章 见我无须避道求月票-1_VI.md
# 01_chuong-1_nghi-luc-kinh-nguoi-cua-han-khong-co-khan-gia_VI.md
# 第10章 ...
re_filename = re.compile(r'(?:第|chuong-)(\d+)')

for f in files:
    if not f.endswith(".md"):
        continue
    
    match = re_filename.search(f)
    if match:
        ch_num = int(match.group(1))
        if ch_num not in chapters:
            chapters[ch_num] = []
        chapters[ch_num].append(f)
    else:
        # Check for files without chapter number in filename but maybe in content?
        # For now, just skip or log
        pass

sorted_ch = sorted(chapters.keys())

gaps = []
if sorted_ch:
    for i in range(len(sorted_ch) - 1):
        if sorted_ch[i+1] != sorted_ch[i] + 1:
            gaps.append((sorted_ch[i], sorted_ch[i+1]))

print(f"Total chapters found: {len(sorted_ch)}")
print(f"Min chapter: {sorted_ch[0] if sorted_ch else 'N/A'}")
print(f"Max chapter: {sorted_ch[-1] if sorted_ch else 'N/A'}")

if gaps:
    print("\nGaps found:")
    for start, end in gaps:
        print(f"Between {start} and {end}: missing {list(range(start + 1, end))}")
else:
    print("\nNo gaps found in numbering.")

# Find files with suffix -[0-9] in filename that might need title cleanup
suffix_files = [f for f in files if re.search(r'-\d+_VI\.md$', f)]
print(f"\nFiles with numeric suffix in filename: {len(suffix_files)}")
# for f in suffix_files[:10]:
#     print(f"  {f}")
