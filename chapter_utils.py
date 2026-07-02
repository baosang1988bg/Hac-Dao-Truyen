"""
chapter_utils.py
----------------
Các hàm tiện ích thuần (không side-effect ngoài filesystem đọc) dùng chung
cho main.py, pipeline.py, các router API và tools/:

  - chinese_to_arabic / extract_chapter_number_from_text : parse số chương
  - split_chapter_content / _split_at_sentence           : chia nhỏ chương dài
  - safe_filename                                        : làm sạch tên file
  - is_already_translated / is_failed_translation        : kiểm tra trạng thái file dịch
  - is_split_original / get_split_part_count             : nhận diện chương đã split
"""

import os
import re


# ── Parse số chương ───────────────────────────────────────────────────────────

def chinese_to_arabic(cn_str: str) -> int:
    """Chuyển số Trung Quốc (一, 二十四, 三百...) sang số Ả Rập."""
    cn_num = {
        '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
        '十': 10, '百': 100, '千': 1000, '廿': 20, '卅': 30
    }
    clean_str = ""
    for char in cn_str:
        if char in cn_num:
            clean_str += char
    if not clean_str:
        return 0
    val = 0
    temp = 0
    for char in clean_str:
        num = cn_num[char]
        if num == 10:
            if temp == 0:
                temp = 1
            val += temp * 10
            temp = 0
        elif num == 100:
            if temp == 0:
                temp = 1
            val += temp * 100
            temp = 0
        elif num == 1000:
            if temp == 0:
                temp = 1
            val += temp * 1000
            temp = 0
        else:
            temp = num
    val += temp
    return val


def extract_chapter_number_from_text(text: str) -> int:
    """Trích số chương từ tiêu đề/tên file (hỗ trợ cả số Trung Quốc: 第二十四章)."""
    m = re.search(r'\d+', text)
    if m:
        return int(m.group())
    m_cn = re.search(r'第([一二三四五六七八九十百千廿卅]+)章', text)
    if m_cn:
        return chinese_to_arabic(m_cn.group(1))
    m_cn_loose = re.search(r'([一二三四五六七八九十百千廿卅]+)章', text)
    if m_cn_loose:
        return chinese_to_arabic(m_cn_loose.group(1))
    return 999999


# ── Chapter split ─────────────────────────────────────────────────────────────

# Ngưỡng ký tự tối đa mỗi phần khi split chương lớn.
# 4500 chars ≈ 6750 tokens (1 Chinese char ≈ 1.5 token) → an toàn cho mọi model.
CHAPTER_SPLIT_THRESHOLD = int(os.getenv("CHAPTER_SPLIT_THRESHOLD", "4500"))


def split_chapter_content(content: str, threshold: int = CHAPTER_SPLIT_THRESHOLD) -> list[str]:
    """
    Chia nội dung chương dài thành các phần <= threshold ký tự.
    Tách tại ranh giới đoạn văn (dòng trống) để không cắt giữa câu.
    Nếu 1 đoạn đơn > threshold thì tách tại dấu câu cuối câu (。！？\n).

    Returns: list[str] — mỗi phần là 1 đoạn nội dung hoàn chỉnh.
    """
    if len(content) <= threshold:
        return [content]

    # Tách thành các đoạn tự nhiên (theo dòng trống)
    paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
    if not paragraphs:
        paragraphs = [p.strip() for p in content.split('\n') if p.strip()]

    parts: list[str] = []
    current: list[str] = []
    current_len = 0

    for para in paragraphs:
        para_len = len(para) + 2  # +2 cho \n\n

        # Nếu 1 đoạn đơn vượt threshold → tách thêm tại dấu câu
        if para_len > threshold:
            # Flush current trước
            if current:
                parts.append('\n\n'.join(current))
                current = []
                current_len = 0
            # Tách đoạn lớn tại dấu câu
            sub = _split_at_sentence(para, threshold)
            parts.extend(sub)
            continue

        if current_len + para_len > threshold and current:
            parts.append('\n\n'.join(current))
            current = []
            current_len = 0

        current.append(para)
        current_len += para_len

    if current:
        parts.append('\n\n'.join(current))

    return [p for p in parts if p.strip()]


def _split_at_sentence(text: str, threshold: int) -> list[str]:
    """Tách text tại dấu câu Chinese/Vietnamese khi đoạn quá dài."""
    # Dấu câu kết thúc câu
    sentence_ends = re.compile(r'(?<=[。！？\?\!])\s*')
    sentences = sentence_ends.split(text)
    parts = []
    current = ""
    for sent in sentences:
        if len(current) + len(sent) > threshold and current:
            parts.append(current.strip())
            current = sent
        else:
            current += sent
    if current.strip():
        parts.append(current.strip())
    return parts if parts else [text]


# ── File helpers ──────────────────────────────────────────────────────────────

def safe_filename(name: str) -> str:
    """Loại ký tự đặc biệt khỏi tên file (giữ chữ/số/khoảng trắng/-/_)."""
    return "".join(c for c in name if c.isalnum() or c in (" ", "-", "_")).strip()


def is_already_translated(path: str) -> bool:
    """File dịch đã tồn tại và không rỗng."""
    return os.path.exists(path) and os.path.getsize(path) > 0


def is_failed_translation(path: str) -> bool:
    """Kiểm tra xem file đã dịch có phải là bản lỗi không (translation failed message)."""
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read(200)  # chỉ đọc đầu file
        return "[Translation failed" in content
    except Exception:
        return False


def is_split_original(raw_dir: str, stem: str) -> bool:
    """
    Kiểm tra xem file này có phải là file gốc đã được split không.
    Dấu hiệu: tồn tại file stem-1.txt trong cùng thư mục.
    """
    return os.path.exists(os.path.join(raw_dir, f"{stem}-1.txt"))


def get_split_part_count(raw_dir: str, stem: str) -> int:
    """Đếm số phần split của file gốc (stem-1.txt, stem-2.txt, ...)."""
    count = 0
    for i in range(1, 20):
        if os.path.exists(os.path.join(raw_dir, f"{stem}-{i}.txt")):
            count = i
        else:
            break
    return count
