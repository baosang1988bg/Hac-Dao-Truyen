import os
import re

def cleanup_splits(novel_slug):
    translated_dir = os.path.join("novels", novel_slug, "translated")
    raw_dir = os.path.join("novels", novel_slug, "text_raw")
    
    if not os.path.isdir(translated_dir):
        print(f"Không tìm thấy thư mục {translated_dir}")
        return

    # Lấy danh sách tất cả file trong translated
    trans_files = os.listdir(translated_dir)
    
    # regex tìm các file split: ví dụ "第1787章 黥面-1_VI.md"
    # \1 là tên gốc: "第1787章 黥面", \2 là số: "1"
    split_pattern = re.compile(r'^(.*?)-(\d+)_VI\.md$')
    
    # Tìm tất cả các file đã được merge (file gốc không có đuôi -1, -2)
    merged_files = set(f for f in trans_files if not split_pattern.match(f) and f.endswith("_VI.md"))
    
    deleted_trans_count = 0
    deleted_raw_count = 0

    print(f"[*] Bắt đầu dọn dẹp các file split cho truyện '{novel_slug}'...")

    for f in trans_files:
        match = split_pattern.match(f)
        if match:
            base_name = match.group(1) # "第1787章 黥面"
            part_num = match.group(2)  # "1"
            
            merged_filename = f"{base_name}_VI.md"
            
            # Kiểm tra xem file merged đã tồn tại chưa
            # Lưu ý: Cần kiểm tra prefix vì file merged có thể có thêm phần tử nhưng thông thường là khớp hoàn toàn.
            if merged_filename in merged_files:
                # File merged đã tồn tại, ta có thể an toàn xóa file split
                trans_path = os.path.join(translated_dir, f)
                try:
                    os.remove(trans_path)
                    print(f"  [Xóa] {f}")
                    deleted_trans_count += 1
                except Exception as e:
                    print(f"  [Lỗi] Không thể xóa {f}: {e}")
                
                # Xóa file raw tương ứng (nếu có)
                raw_filename = f"{base_name}-{part_num}.txt"
                raw_path = os.path.join(raw_dir, raw_filename)
                if os.path.exists(raw_path):
                    try:
                        os.remove(raw_path)
                        print(f"  [Xóa raw] {raw_filename}")
                        deleted_raw_count += 1
                    except Exception as e:
                        pass

    print(f"\n[✓] Dọn dẹp hoàn tất!")
    print(f"Đã xóa {deleted_trans_count} file bản dịch split (-1_VI.md, -2_VI.md,...)")
    print(f"Đã xóa {deleted_raw_count} file raw split (-1.txt, -2.txt,...)")

if __name__ == "__main__":
    # Bạn có thể đổi tên truyện ở đây nếu cần áp dụng cho truyện khác
    cleanup_splits("xich-tam-tuan-thien")
