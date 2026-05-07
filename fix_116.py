"""
fix_116.py — Fix nhanh chương 116 bị truncate
Chạy: python fix_116.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from novel_manager import load_novel
from translator import NovelTranslator

profile    = load_novel("xich-tam-tuan-thien")
translator = NovelTranslator()

stem     = "第116章 相敬"
raw_path = os.path.join(profile.raw_dir, f"{stem}.txt")
out_path = os.path.join(profile.translated_dir, f"{stem}_VI.md")

print(f"\n{'='*55}")
print(f"  Fix: {stem}")
print(f"  Raw size : {os.path.getsize(raw_path)} bytes")
print(f"  Trans size (trước): {os.path.getsize(out_path)} bytes")
print(f"{'='*55}\n")

with open(raw_path, "r", encoding="utf-8") as f:
    content = f.read().strip()

print(f"[*] Dịch {len(content)} chars...")
translated, summary, _ = translator.translate_chapter(
    title=stem,
    content=content,
    glossary=profile.glossary,
    translation_style=profile.translation_style,
    max_retries=3,
)

if "[Translation failed" in translated[:200]:
    print(f"❌ FAILED: {translated[:200]}")
    sys.exit(1)

with open(out_path, "w", encoding="utf-8") as f:
    f.write(translated)

print(f"\n✅ Saved: {out_path}")
print(f"   Trans size (sau): {os.path.getsize(out_path)} bytes")
print(f"   Preview: {translated[:120].replace(chr(10), ' ')}...")
