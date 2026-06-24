#!/usr/bin/env python3
"""
importer.py
-----------
Import truyện mới từ file mục lục .md của AgentReach (AR) sang HacDaoTruyen (HacDao).
Tạo cấu trúc thư mục, file novel.json và catalog.json chứa link chương tĩnh.

Cách dùng:
  python importer.py --catalog "/Users/sangpls/Documents/AI00/AgentReach/novel/ixdzs/Huyền Giám Tiên Tộc.md"
"""

import os
import re
import json
import argparse
from pathlib import Path

NOVELS_DIR = Path("novels")

def cn_to_int(cn_str: str) -> int:
    """Chuyển đổi số chữ Hán sang số nguyên (hỗ trợ đến hàng vạn)."""
    cn_map = {'零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
    unit_map = {'十': 10, '百': 100, '千': 1000, '万': 10000}
    
    # Rút trích phần số nằm giữa 第 và 章
    m = re.search(r'第([一二三四五六七八九十百千万零\d]+)章', cn_str)
    if not m:
        # Thử tìm số thường (ví dụ: 第100章)
        m_num = re.search(r'第(\d+)章', cn_str)
        if m_num:
            return int(m_num.group(1))
        return 0
        
    val_str = m.group(1)
    if val_str.isdigit():
        return int(val_str)
        
    total = 0
    temp = 0
    for char in val_str:
        if char in cn_map:
            temp = cn_map[char]
        elif char in unit_map:
            unit = unit_map[char]
            if unit == 10 and temp == 0:
                temp = 1  # Trường hợp "thập" đứng đầu (ví dụ: 十一 -> 11)
            temp = temp * unit
            if unit >= 10000:
                total += temp
                total *= unit
                temp = 0
            else:
                total += temp
                temp = 0
    total += temp
    return total

def slugify(text: str) -> str:
    """Tạo slug từ tên truyện (không dấu, gạch ngang)."""
    s1 = {
        'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ằ':'a','ắ':'a','ẳ':'a','ẵ':'a','ặ':'a','â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a',
        'đ':'d',
        'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e','ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e',
        'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
        'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ồ':'o','ố':'o','ổ':'o','ỗ':'o','ộ':'o','ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o',
        'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u','ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u',
        'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
        'À':'a','Á':'a','Ả':'a','Ã':'a','Ạ':'a','Ă':'a','Ằ':'a','Ắ':'a','Ẳ':'a','Ẵ':'a','Ặ':'a','Â':'a','Ầ':'a','Ấ':'a','Ẩ':'a','Ẫ':'a','Ậ':'a',
        'Đ':'d',
        'È':'e','É':'e','Ẻ':'e','Ẽ':'e','Ẹ':'e','Ê':'e','Ề':'e','Ế':'e','Ể':'e','Ễ':'e','Ệ':'e',
        'Ì':'i','Í':'i','Ỉ':'i','Ĩ':'i','Ị':'i',
        'Ò':'o','Ó':'o','Ỏ':'o','Õ':'o','Ọ':'o','Ô':'o','Ồ':'o','Ố':'o','Ổ':'o','Ỗ':'o','Ộ':'o','Ơ':'o','Ờ':'o','Ớ':'o','Ở':'o','Ỡ':'o','Ợ':'o',
        'Ù':'u','Ú':'u','Ủ':'u','Ũ':'u','Ụ':'u','Ư':'u','Ừ':'u','Ứ':'u','Ử':'u','Ữ':'u','ự':'u',
        'Ý':'y','Ý':'y','Ỷ':'y','Ỹ':'y','Ỵ':'y'
    }
    for k, v in s1.items():
        text = text.replace(k, v)
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")

def parse_catalog_md(md_path: Path):
    """Parse file catalog .md của AR."""
    content = md_path.read_text(encoding='utf-8')
    
    # 1. Parse Metadata
    title_match = re.search(r'^#\s*Mục lục:\s*(.+)$', content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else md_path.stem
    
    source_match = re.search(r'^\*\s*\*\*Liên kết gốc\*\*:\s*\[.+\]\((.+)\)$', content, re.MULTILINE)
    source_url = source_match.group(1).strip() if source_match else ""
    
    # 2. Parse Chapters Table
    # Định dạng: | STT | Tên chương | [Đọc chương X](URL) |
    chapters_raw = []
    pattern = r'\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*\[Đọc chương \d+\]\(([^)]+)\)'
    
    for line in content.splitlines():
        m = re.match(pattern, line.strip())
        if m:
            stt = int(m.group(1))
            ch_title = m.group(2).strip()
            ch_url = m.group(3).strip()
            
            # Tính toán số chương thực tế từ chữ Hán
            ch_num = cn_to_int(ch_title)
            chapters_raw.append({
                "stt": stt,
                "parsed_number": ch_num,
                "title": ch_title,
                "url": ch_url
            })
            
    # 3. Sắp xếp lại danh sách chương
    def sort_key(item):
        num = item["parsed_number"]
        return (0 if num > 0 else 1, num, item["stt"])
        
    sorted_raw = sorted(chapters_raw, key=sort_key)
    
    # Loại bỏ trùng lặp dựa trên parsed_number (nếu > 0) và url
    seen_nums = set()
    seen_urls = set()
    unique_chapters = []
    for item in sorted_raw:
        num = item["parsed_number"]
        url = item["url"]
        if num > 0:
            if num in seen_nums:
                continue
            seen_nums.add(num)
        else:
            if url in seen_urls:
                continue
            seen_urls.add(url)
        unique_chapters.append(item)
    
    # Cập nhật lại key "number" chuẩn từ số chương gốc hoặc số thứ tự cốt truyện
    final_chapters = []
    for i, item in enumerate(unique_chapters, 1):
        num = item["parsed_number"]
        final_num = num if num > 0 else i
        simple_title = f"Chương {final_num}"
        final_chapters.append({
            "number": final_num,
            "title": simple_title,
            "original_title": item["title"],
            "url": item["url"],
            "original_chapter_number": num
        })
        
    return title, source_url, final_chapters

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--catalog', required=True, help='Đường dẫn tuyệt đối tới file catalog .md trong AR')
    args = ap.parse_args()
    
    catalog_path = Path(args.catalog)
    if not catalog_path.exists():
        print(f"[!] File catalog không tồn tại: {catalog_path}")
        return
        
    print(f"[*] Đang parse file catalog: {catalog_path.name}...")
    title, source_url, chapters = parse_catalog_md(catalog_path)
    
    slug = slugify(title)
    novel_dir = NOVELS_DIR / slug
    novel_dir.mkdir(parents=True, exist_ok=True)
    (novel_dir / "text_raw").mkdir(exist_ok=True)
    (novel_dir / "translated").mkdir(exist_ok=True)
    
    # Tạo novel.json
    novel_data = {
        "slug": slug,
        "title": title,
        "original_title": "",
        "author": "",
        "source_url": source_url,
        "genre": "cultivation",
        "last_translated_url": "",
        "last_chapter_number": 0,
        "total_chapters": len(chapters),
        "glossary": {}
    }
    
    novel_json_path = novel_dir / "novel.json"
    with open(novel_json_path, 'w', encoding='utf-8') as f:
        json.dump(novel_data, f, ensure_ascii=False, indent=2)
        
    # Tạo catalog.json
    catalog_json_path = novel_dir / "catalog.json"
    with open(catalog_json_path, 'w', encoding='utf-8') as f:
        json.dump(chapters, f, ensure_ascii=False, indent=2)
        
    print(f"\n✅ Import thành công truyện: {title}")
    print(f"   Slug        : {slug}")
    print(f"   Tổng chương  : {len(chapters)}")
    print(f"   Novel profile: {novel_json_path}")
    print(f"   Catalog links: {catalog_json_path}")
    print(f"\n👉 Hãy chạy dịch thử: python main.py translate --novel {slug} --chapters 2")

if __name__ == '__main__':
    main()
