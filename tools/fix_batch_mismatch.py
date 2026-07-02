import sys as _sys, os as _os; _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))  # cho phép import module ở root
"""
fix_batch_mismatch.py
---------------------
Fix các chương bị lỗi [Translation failed: Batch output mismatch]
và chương nghi ngờ quá ngắn so với raw.

Chạy: python fix_batch_mismatch.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from novel_manager import load_novel
from translator import NovelTranslator

profile    = load_novel("xich-tam-tuan-thien")
translator = NovelTranslator()

# Chương cần fix: 119 (ngắn bất thường), 120 + 121 (Batch output mismatch)
TO_FIX = [
    "第119章 白骨道子",
    "第120章 按剑四顾心茫然",
    "第121章 长恨人心不如水",
]

print(f"\n{'='*55}")
print(f"  Fix batch mismatch — {len(TO_FIX)} chương")
print(f"{'='*55}\n")

success = 0
for stem in TO_FIX:
    raw_path = os.path.join(profile.raw_dir, f"{stem}.txt")
    out_path = os.path.join(profile.translated_dir, f"{stem}_VI.md")

    if not os.path.exists(raw_path):
        print(f"❌ Raw không tìm thấy: {stem}")
        continue

    raw_size   = os.path.getsize(raw_path)
    trans_size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    print(f"[*] {stem}")
    print(f"    raw={raw_size}B  trans_trước={trans_size}B")

    with open(raw_path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    translated, summary, _ = translator.translate_chapter(
        title=stem,
        content=content,
        glossary=profile.glossary,
        translation_style=profile.translation_style,
        max_retries=3,
    )

    if "[Translation failed" in translated[:200]:
        print(f"    ❌ FAILED: {translated[:150]}\n")
        continue

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(translated)

    new_size = os.path.getsize(out_path)
    print(f"    ✅ trans_sau={new_size}B — {translated[:80].replace(chr(10),' ')}...\n")
    success += 1
    time.sleep(3)

print(f"{'='*55}")
print(f"  ✅ {success}/{len(TO_FIX)} chương đã fix thành công")
print(f"{'='*55}\n")
