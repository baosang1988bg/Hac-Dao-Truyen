import sys
import re
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def _normalize_title_key(title: str) -> str:
    """Loại bỏ dấu câu và ký tự đặc biệt để so sánh 2 tiêu đề."""
    t = title.lstrip('#').strip().lower()
    t = re.sub(r'[^\w\s]', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def format_chapter_content(title: str, text: str) -> str:
    """
    Format nội dung chương:
    1. Xóa tiêu đề trùng lặp ở đầu bài (bỏ qua dấu câu khác nhau như '.' vs ';')
    2. Gom các dòng tự sự ngắn đứng cạnh nhau thành đoạn văn hoàn chỉnh (paragraph)
    3. Giữ nguyên các dòng hội thoại (bắt đầu bằng ", «, ', “) hoặc dải phân cách (. . ., ---)
    """
    if not text:
        return ""

    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    if not paragraphs:
        return ""

    title_key = _normalize_title_key(title)
    
    cleaned_paras = []
    for i, p in enumerate(paragraphs):
        p_key = _normalize_title_key(p)
        # Bỏ nếu khớp với tiêu đề chính
        if p_key == title_key or (len(title_key) > 5 and (title_key in p_key or p_key in title_key)):
            if i < 2:
                continue
        cleaned_paras.append(p)

    if not cleaned_paras:
        cleaned_paras = paragraphs

    merged_paras = []
    current_block = []

    def is_standalone_line(p_str: str) -> bool:
        if p_str.startswith('#'):
            return True
        if p_str in ('---', '. . .', '...', '***'):
            return True
        first_char = p_str[0]
        if first_char in ('"', '«', '“', "'", '‘', '「', '【', '（', '('):
            return True
        if p_str.startswith('- ') or p_str.startswith('* ') or re.match(r'^\d+[\.\)]\s', p_str):
            return True
        # Nếu dòng bắt đầu bằng ký tự đặc biệt « hoặc dạng thông báo hệ thống «...»
        if p_str.startswith('«') or p_str.startswith('»'):
            return True
        return False

    for p in cleaned_paras:
        if is_standalone_line(p):
            if current_block:
                merged_paras.append(' '.join(current_block))
                current_block = []
            merged_paras.append(p)
        else:
            curr_len = sum(len(x) for x in current_block)
            if curr_len > 450:
                merged_paras.append(' '.join(current_block))
                current_block = [p]
            else:
                current_block.append(p)

    if current_block:
        merged_paras.append(' '.join(current_block))

    clean_body = '\n\n'.join(merged_paras).strip()
    if not clean_body.startswith('#'):
        clean_body = f"# {title}\n\n{clean_body}"

    return clean_body


if __name__ == '__main__':
    f = Path('novels/1-cap-1-cai-dong-vang-toan-dan-hang-hai-ta-vo-dich/translated/0001_chương-1-toàn-dân-đại-hàng-hải-chỉ-có-ta-thiên-hồ_VI.md')
    if f.exists():
        text = f.read_text(encoding='utf-8')
        res = format_chapter_content('Chương 1. Toàn dân đại hàng hải, chỉ có ta Thiên Hồ', text)
        print("=== TEST FORMATTED OUTPUT (FIRST 2000 CHARS) ===")
        print(res[:2000])
