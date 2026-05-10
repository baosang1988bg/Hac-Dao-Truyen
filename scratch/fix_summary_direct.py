import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
from novel_manager import load_novel
from translator import NovelTranslator
from dotenv import load_dotenv

load_dotenv()

def split_chapter_content(content: str, threshold: int = 4000) -> list[str]:
    """Logic chia nhỏ mạnh mẽ: Đoạn văn -> Dấu câu -> Cắt cứng"""
    if len(content) <= threshold:
        return [content]
    
    # Bước 1: Chia theo đoạn văn
    paragraphs = [p.strip() for p in content.split('\n') if p.strip()]
    
    parts = []
    current = []
    current_len = 0
    
    for para in paragraphs:
        para_len = len(para) + 1
        
        if para_len > threshold:
            # Nếu 1 đoạn đơn quá dài -> Chia theo dấu câu
            if current:
                parts.append('\n'.join(current))
                current = []
                current_len = 0
            
            sub_sentences = re.split(r'([。！？\n])', para)
            sub_current = []
            sub_len = 0
            for i in range(0, len(sub_sentences)-1, 2):
                s = sub_sentences[i] + sub_sentences[i+1]
                if sub_len + len(s) > threshold and sub_current:
                    parts.append(''.join(sub_current))
                    sub_current = []
                    sub_len = 0
                sub_current.append(s)
                sub_len += len(s)
            if sub_current:
                parts.append(''.join(sub_current))
            continue

        if current_len + para_len > threshold and current:
            parts.append('\n'.join(current))
            current = []
            current_len = 0
            
        current.append(para)
        current_len += para_len
        
    if current:
        parts.append('\n'.join(current))
        
    return parts

def main():
    slug = "xich-tam-tuan-thien"
    chapter_stem = "我非神临第七卷总结"
    
    print(f"[*] Bắt đầu xử lý: {chapter_stem}")
    profile = load_novel(slug)
    raw_path = os.path.join(profile.raw_dir, f"{chapter_stem}.txt")
    
    with open(raw_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    
    # Ép buộc threshold thấp hơn để chắc chắn chia nhỏ
    threshold = 4000
    work_items = split_chapter_content(content, threshold)
    print(f"[*] Chia thành {len(work_items)} phần (mỗi phần ~{threshold} ký tự).")
    
    translator = NovelTranslator()
    for i, part_content in enumerate(work_items):
        part_title = f"{chapter_stem}-{i+1}"
        suffix = f"-{i+1}"
        out_path = os.path.join(profile.translated_dir, f"{chapter_stem}{suffix}_VI.md")
        
        print(f"[*] Đang dịch {part_title} ({len(part_content)} chars)...")
        translated, summary, usage = translator.translate_chapter(
            title=part_title,
            content=part_content,
            glossary=profile.glossary,
            translation_style=profile.translation_style
        )
        
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(translated)
        print(f"[+] Đã lưu: {out_path}")

if __name__ == "__main__":
    main()
