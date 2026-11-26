#!/usr/bin/env python3
"""
tools/converter/vietphrase.py
-----------------------------
Động cơ Convert tiếng Trung sang VietPhrase/Hán-Việt siêu tốc ($0, 0.01s/chương).
Sử dụng cấu trúc dữ liệu Trie với thuật toán Maximum Forward Matching (khớp từ dài nhất).

Thứ tự ưu tiên dịch:
  1. Glossary riêng của từng truyện (novel.json) — Ưu tiên cao nhất
  2. Từ điển cụm từ Vietphrase (phrases_dict.json)
  3. Từ điển âm Hán Việt đơn âm (chinese_phienam.txt — ~5.400 chữ Hán, sinh bởi
     tools/build_hanviet.py từ Unihan kVietnamese 18.0.0 + glossary + bảng sửa tay
     tools/converter/hanviet_overrides.json; xem THIRD_PARTY_LICENSES.md)
  4. Ký tự giữ nguyên (chữ cái Latin, số, dấu câu)

Hỗ trợ chuẩn hóa dấu câu và viết hoa đầu câu tự động.
"""

import os
import re
import json
import time
import argparse
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
PHIENAM_FILE = DATA_DIR / "chinese_phienam.txt"
PHRASES_FILE = DATA_DIR / "phrases_dict.json"

# Bảng chuyển đổi dấu câu tiếng Trung sang dấu câu chuẩn tiếng Việt
PUNCTUATION_MAP = {
    '，': ', ',
    '。': '. ',
    '！': '! ',
    '？': '? ',
    '：': ': ',
    '；': '; ',
    '“': '"',
    '”': '" ',
    '‘': "'",
    '’': "' ",
    '（': ' (',
    '）': ') ',
    '【': ' [',
    '】': '] ',
    '《': ' "',
    '》': '" ',
    '「': '"',
    '」': '" ',
    '、': ', ',
    '……': '...',
    '…': '...',
    '—': '-',
    '——': ' - ',
    '\u3000': ' ',
}


class TrieNode:
    __slots__ = ('children', 'value', 'is_end')

    def __init__(self):
        self.children = {}
        self.value = None
        self.is_end = False


class VietphraseTrie:
    def __init__(self):
        self.root = TrieNode()

    def insert(self, key: str, value: str):
        if not key or not value:
            return
        node = self.root
        for char in key:
            if char not in node.children:
                node.children[char] = TrieNode()
            node = node.children[char]
        node.is_end = True
        node.value = value


class VietphraseConverter:
    _instance = None

    def __init__(self, novel_glossary: dict | None = None):
        self.trie = VietphraseTrie()
        self.hanviet_dict = {}
        self.load_dictionaries()
        if novel_glossary:
            self.load_glossary(novel_glossary)

    def load_dictionaries(self):
        # 1. Load single character Hán-Việt dictionary
        if PHIENAM_FILE.exists():
            with open(PHIENAM_FILE, 'r', encoding='utf-8-sig') as f:
                for line in f:
                    line = line.strip()
                    if '=' in line:
                        k, v = line.split('=', 1)
                        self.hanviet_dict[k.strip()] = v.strip()

        # 2. Load common phrases dictionary
        if PHRASES_FILE.exists():
            try:
                with open(PHRASES_FILE, 'r', encoding='utf-8') as f:
                    phrases = json.load(f)
                    for k, v in phrases.items():
                        self.trie.insert(k.strip(), v.strip())
            except Exception as e:
                print(f"[vietphrase] Cảnh báo khi tải phrases: {e}")

    def load_glossary(self, glossary: dict):
        """Nạp glossary riêng của truyện vào Trie với độ ưu tiên cao nhất."""
        if not glossary or not isinstance(glossary, dict):
            return
        for k, v in glossary.items():
            if isinstance(k, str) and isinstance(v, str):
                self.trie.insert(k.strip(), v.strip())

    def convert_paragraph(self, text: str) -> str:
        """Chuyển đổi một đoạn văn từ tiếng Trung sang VietPhrase/Hán-Việt."""
        if not text:
            return ""

        words = []
        i = 0
        n = len(text)

        while i < n:
            char = text[i]

            # Kiểm tra dấu câu trước
            if char in PUNCTUATION_MAP:
                words.append(PUNCTUATION_MAP[char])
                i += 1
                continue

            # Thuật toán Maximum Forward Matching (Khớp từ dài nhất trên Trie)
            node = self.trie.root
            match_end = -1
            match_val = None
            j = i

            while j < n and text[j] in node.children:
                node = node.children[text[j]]
                if node.is_end:
                    match_end = j + 1
                    match_val = node.value
                j += 1

            if match_val is not None:
                words.append(match_val)
                i = match_end
            elif char in self.hanviet_dict:
                # Nếu không có cụm từ, tra âm Hán-Việt từng chữ đơn
                words.append(self.hanviet_dict[char])
                i += 1
            else:
                # Ký tự thông thường (số, chữ Latin, khoảng trắng)
                words.append(char)
                i += 1

        # Ghép các từ lại và làm sạch khoảng trắng
        combined = " ".join(words)

        # Chuẩn hóa khoảng trắng quanh dấu câu
        combined = re.sub(r'\s+([,.:;?!])', r'\1', combined)
        combined = re.sub(r'([(\[])\s+', r'\1', combined)
        combined = re.sub(r'\s+([)\]])', r'\1', combined)
        combined = re.sub(r'"+', '"', combined)
        combined = re.sub(r'\s{2,}', ' ', combined)

        # Viết hoa đầu câu
        return self._capitalize_sentences(combined.strip())

    def _capitalize_sentences(self, text: str) -> str:
        """Tự động viết hoa chữ cái đầu tiên của mỗi câu."""
        if not text:
            return ""

        def cap(match):
            return match.group(1) + match.group(2).upper()

        # Viết hoa chữ cái đầu đoạn văn
        result = text[0].upper() + text[1:] if len(text) > 0 else text
        # Viết hoa sau các dấu kết thúc câu (. ! ?)
        result = re.sub(r'([.!?]\s+)([a-zà-ỹ])', cap, result)
        # Viết hoa sau dấu mở ngoặc kép
        result = re.sub(r'(["“]\s*)([a-zà-ỹ])', cap, result)
        return result

    def convert_chapter(self, raw_content: str, chapter_title: str = "") -> str:
        """Chuyển đổi toàn bộ chương truyện sang Markdown."""
        lines = raw_content.splitlines()
        converted_paragraphs = []

        for line in lines:
            line = line.strip()
            if not line:
                continue
            converted_paragraphs.append(self.convert_paragraph(line))

        body = "\n\n".join(converted_paragraphs)
        if chapter_title:
            return f"# {chapter_title}\n\n{body}\n"
        return body


def convert_novel_chapters(slug: str, from_chapter: int = 1, to_chapter: int = 0):
    """Convert các chương của truyện từ thư mục raw/ sang converted/."""
    base_dir = Path("novels") / slug
    if not base_dir.exists():
        raise SystemExit(f"❌ Không tìm thấy thư mục truyện: {base_dir}")

    novel_json_path = base_dir / "novel.json"
    glossary = {}
    if novel_json_path.exists():
        try:
            novel_data = json.loads(novel_json_path.read_text(encoding='utf-8'))
            glossary = novel_data.get('glossary', {})
        except Exception:
            pass

    converter = VietphraseConverter(glossary)

    catalog_path = base_dir / "catalog.json"
    catalog_map = {}
    if catalog_path.exists():
        try:
            catalog_list = json.loads(catalog_path.read_text(encoding='utf-8'))
            for item in catalog_list:
                num = item.get('number')
                title = item.get('title')
                if num is not None and title:
                    catalog_map[num] = title
        except Exception:
            pass

    raw_dir = base_dir / "raw"
    converted_dir = base_dir / "converted"
    converted_dir.mkdir(parents=True, exist_ok=True)

    raw_files = sorted(
        raw_dir.glob("*.txt"),
        key=lambda p: int(p.stem) if p.stem.isdigit() else 999999
    )

    if not raw_files:
        print(f"⚠️ Không có file raw nào trong {raw_dir}")
        return

    count = 0
    t0 = time.time()

    for p in raw_files:
        if not p.stem.isdigit():
            continue
        num = int(p.stem)
        if num < from_chapter:
            continue
        if to_chapter > 0 and num > to_chapter:
            continue

        raw_text = p.read_text(encoding='utf-8')
        title = catalog_map.get(num, f"Chương {num}")
        output_text = converter.convert_chapter(raw_text, title)

        out_path = converted_dir / f"Chương {num}_VI.md"
        out_path.write_text(output_text, encoding='utf-8')
        count += 1
        print(f"  [Convert] Chương {num}: {title} ({len(output_text)} chars)")

    elapsed = time.time() - t0
    print(f"\n🎉 Đã convert thành công {count} chương trong {elapsed:.3f}s (Trung bình: {elapsed / max(count, 1):.4f}s/chương)")


def main():
    parser = argparse.ArgumentParser(description="VietPhrase Trie Converter CLI")
    parser.add_argument("--novel", required=True, help="Slug của truyện trong novels/")
    parser.add_argument("--from", dest="from_chap", type=int, default=1, help="Chương bắt đầu")
    parser.add_argument("--to", dest="to_chap", type=int, default=0, help="Chương kết thúc (0 = hết)")
    args = parser.parse_args()

    convert_novel_chapters(args.novel, args.from_chap, args.to_chap)


if __name__ == "__main__":
    main()
