import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
from novel_manager import load_novel
from translator import NovelTranslator
from dotenv import load_dotenv

load_dotenv()

def translate(chapter_name):
    slug = "xich-tam-tuan-thien"
    print(f"[*] Đang dịch: {chapter_name}")
    profile = load_novel(slug)
    raw_path = os.path.join(profile.raw_dir, f"{chapter_name}.txt")
    out_path = os.path.join(profile.translated_dir, f"{chapter_name}_VI.md")
    
    with open(raw_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    
    translator = NovelTranslator()
    translated, summary, usage = translator.translate_chapter(
        title=chapter_name,
        content=content,
        glossary=profile.glossary,
        translation_style=profile.translation_style
    )
    
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(translated)
    print(f"[+] Đã lưu: {out_path}")

def main():
    translate("我非神临第七卷总结-2")
    translate("我非神临第七卷总结-3")

if __name__ == "__main__":
    main()
